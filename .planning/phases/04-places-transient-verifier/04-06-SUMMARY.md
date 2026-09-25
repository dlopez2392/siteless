---
phase: 04-places-transient-verifier
plan: 06
subsystem: matching
tags: [places, entity-resolution, pg_trgm, drizzle, jsonb, tdd]

requires:
  - phase: 03-free-data-spine-entity-resolution
    provides: "score() + weights + 95/80 thresholds (src/lib/resolve/score.ts); nameNorm/phoneE164/addressKey normalizers; the lateral trigram shape (block.ts)"
provides:
  - "src/lib/places/match.ts: toPlaceForMatch / placeSide / scoreLocated / scoreSab / decide, plus the PlacesResultLike, PlaceForMatch, PlaceFeatures, BusinessCandidate, ScoredCandidate and MatchDecision types"
  - "src/lib/places/candidates.ts: placeCandidatesQuery(probes, queriedCityLower), CandidateProbe, CandidateRow, PROXIMITY_DEG_LAT, PROXIMITY_DEG_LNG"
  - "score.ts type widening: Side.source gains 'google_places'; Features.rule gains 'sab_phone_city'"
affects: [04-07 places-format chips, 04-12 PlaceSchema, 04-15 attachment writer, 04-18 candidate DB proof]

tech-stack:
  added: []
  patterns:
    - "One jsonb parameter per page, unpacked by jsonb_to_recordset, with JSON keys equal to the recordset's column names"
    - "Every lateral arm built by one arm() helper that always carries org scope + merged exclusion"
    - "Places pairs scored with the unchanged Phase 3 score(), chain keys nulled on both sides"

key-files:
  created:
    - src/lib/places/match.ts
    - src/lib/places/candidates.ts
    - tests/unit/places-match.test.ts
    - tests/unit/places-candidates.test.ts
  modified:
    - src/lib/resolve/score.ts

key-decisions:
  - "The SAB trigram half of B3 is its own lateral arm (omitted without a queried city), so the statement has 5 arms with a city unit and 4 without. The plan's 4/3 counts were an arithmetic slip; the test counts filters against the real number of arms."
  - "Probe JSON is mapped to snake_case keys (name_norm, street_num). The plan's literal JSON.stringify(probes) would have sent camelCase keys, which jsonb_to_recordset unpacks as NULL."
  - "placeCandidatesQuery refuses more than 20 probes (one Text Search page), a construction-time bound for T-4-02."
  - "name_sim is coalesce(similarity(...), 0)::float8, so a probe or business with no name_norm scores 0 on the name, never NaN."
  - "No dispatcher is exported. The caller picks scoreSab when p.pureSab, otherwise scoreLocated (matches the plan's export list)."

patterns-established:
  - "places matcher: toPlaceForMatch reduces a result to KEYS only; the display text is never a field"
  - "candidate SQL: SCOPE and COLUMNS are spelled once and shared by every arm, so no arm can drop the org or merged filter"

requirements-completed: [PLACE-05, PLACE-02]

duration: 30min
completed: 2026-09-23
---

# Phase 4 Plan 06: Places matcher + per-page candidate query Summary

**Places results are scored in memory with Phase 3's unchanged `score()`: ties at ≥95 go to review, service-area listings need an exact phone plus the queried city, and features hold numbers only. Candidates for a whole page come from one bounded, org-scoped SQL statement with the probes bound as a single jsonb parameter.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-09-23
- **Tasks:** 2 of 2 (both TDD, RED then GREEN)
- **Files:** 4 created, 1 modified (score.ts: 2 type lines)

## Accomplishments

- `match.ts` (pure, no DB or server import). `toPlaceForMatch` normalizes Google's name, phone and address to keys through the spine's own normalizers. The ZIP is the one after `TX `. `outOfArea` is true when the last segment isn't `USA`. Any `pureServiceAreaBusiness` result drops its pin (A8). `placeSide` sets `source: 'google_places'` and `chainKey: null` (A4). `scoreLocated` calls `score()` unchanged. `scoreSab` lifts to `AUTO_MERGE_SCORE` only on an exact blockable phone, the queried city and a name at or above `PHONE_LOCALITY_NAME_SIM`; anything else gets the located score with no location, capped at `REVIEW_CEILING`. `decide` returns one of attached / tentative / unmatched / outside. A tie at ≥95 makes both top matches tentative with `reason: 'tie'`, each naming the other.
- `candidates.ts` builds one statement per page: a `jsonb_to_recordset($1::jsonb)` CTE, then `distinct on (idx, business_id)` over the `union all` of the bounded lateral arms: B1 phone (limit 10), B2 address (limit 10), B3 trigram in the postal (limit 5), B3 trigram in the queried city for SAB (limit 5, only when a city is given), and B4 ±150 m box (limit 10).
- Thresholds are imported, never restated. The grep `= 95|= 80|= 94|0\.6\b` on match.ts returns nothing.

## Task Commits

1. **Task 1 RED:** `fabf529` test(04-06): add failing tests for the places matcher
2. **Task 1 GREEN:** `847a019` feat(04-06): places matcher on the unchanged Phase 3 scorer
3. **Task 2 RED:** `5292fcd` test(04-06): add failing tests for the per-page places candidate query
4. **Task 2 GREEN:** `1b8e36f` feat(04-06): per-page places candidate query, one bounded statement
5. **Fix:** `d0c3171` fix(04-06): rename tie-test locals the no-network guard reads as S3

## Verification (outputs read, test names checked)

- `tests/unit/places-match.test.ts`: 12 passed. The PASS list includes `a place tying two businesses at 95 goes to review`, `service-area listing without an exact phone caps at 94`, `service-area listing with an exact phone, the queried city and name 0.6 scores 95`, `a service-area listing with a location still takes the service-area branch`, `a non-US listing is outside the area`, `chain keys are ignored for Places pairs`, `places features carry numbers only`, and the three `places match:` band tests.
- `tests/unit/places-candidates.test.ts`: 4 passed. The PASS list includes all three `places candidate query …` tests from the plan, plus `places candidate query refuses more than one page of probes`.
- `tests/unit/score.test.ts`: 26 passed, untouched. `git diff --stat src/lib/resolve/score.ts` shows 2 insertions and 2 deletions (type lines only).
- Full unit lane: 48 files / 356 tests green. The `sql-never-normalizes` guard is green.
- `npx tsc --noEmit` clean. `npx eslint . --ignore-pattern .claude` clean.
- Acceptance greps: `jsonb_to_recordset` matches in candidates.ts; `unaccent` does not.

### Mutation checks (each applied, seen red on exactly one named test, reverted, `git diff` clean)

| Mutation | Red test |
|---|---|
| M41: a tie at unequal scores resolves to the higher one | `a place tying two businesses at 95 goes to review` |
| M42: the SAB lift fires without the phone | `service-area listing without an exact phone caps at 94` (expected 95 to be 51) |
| chainKey passed through to score() | `chain keys are ignored for Places pairs` |
| SAB pin kept (lat/lng not nulled) | `a service-area listing with a location still takes the service-area branch` |
| `b.merged_into_id is null` dropped from the shared scope | `places candidate query excludes merged businesses on every arm` |
| probe JSON keys left camelCase | `places candidate query binds the probes as one jsonb parameter` |

### Local DB sanity check (read-only, rolled back, scratch file deleted)

- `EXPLAIN` on the local test DB puts every arm on its intended index: B1 `businesses_phone_idx`, B2 `businesses_addr_idx`, B3-postal a BitmapAnd of `businesses_name_trgm` and `businesses_addr_idx`, B3-SAB `businesses_name_trgm`, B4 `businesses_latlng_idx`. The latlng index was already in the shared test DB, presumably from 04-09 running concurrently.
- Executed through drizzle's postgres-js driver with a real org claim: 17 rows in 230 ms. The located probe found its own business at `name_sim = 1`, and the SAB city arm returned rows. JS types: `name_sim` number, `lat` number, `phone_blockable` boolean, `idx` number. One row per (idx, business).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Probe JSON keys must match the recordset column names**
- **Found during:** Task 2
- **Issue:** The plan's `${JSON.stringify(probes)}` would serialize `CandidateProbe`'s camelCase keys (`nameNorm`, `streetNum`). `jsonb_to_recordset(...) as p(name_norm text, street_num text, …)` unpacks keys by name, so those columns would be NULL and B2/B3 would silently find nothing.
- **Fix:** `probeJson()` maps each probe to snake_case keys and checks that `idx` is an integer. The binding test decodes the parameter and asserts the exact snake_case shape, and a mutation confirms the test reds.
- **Files:** src/lib/places/candidates.ts, tests/unit/places-candidates.test.ts
- **Commit:** 1b8e36f

**2. [Rule 1 - Spec arithmetic] Arm counts are 5 and 4, not 4 and 3**
- **Found during:** Task 2
- **Issue:** The plan's named test says `merged_into_id is null` appears 4 times with a city and 3 without. But the plan also requires B1, B2, B3 scoped by postal (located), B3 scoped by city (SAB, omitted without a city) and B4. That is 5 arms with a city and 4 without. The counts only work out if one required arm is dropped.
- **Fix:** Every arm is kept. The test counts `cross join lateral` (5/4) and asserts that the merged filter and the org filter each appear exactly that many times, so "every arm" is measured against the real arm count.
- **Commit:** 5292fcd / 1b8e36f

**3. [Rule 1 - Bug] The CI no-network guard flagged `s3.` in the tie test**
- **Found during:** full unit lane after Task 2
- **Issue:** `tests/unit/no-network.test.ts` treats the substring `s3.` as an AWS host reference, and it matched local variables `s1/s2/s3`.
- **Fix:** Renamed them to `tieA/tieB/weaker`.
- **Commit:** d0c3171

**4. [Rule 2 - Missing critical] Page-size bound (T-4-02)**
- `placeCandidatesQuery` throws on more than 20 probes, and a named test pins this. The plan states the ≤20 bound but gave nothing to enforce it.

### Extra tests beyond the plan's list

`places match: the best of several candidates wins, ties broken by business id` and `a county or radius unit has no queried city, so no service-area listing can reach 95`. The page-bound test is covered under deviation 4.

## Notes for the orchestrator / downstream plans

- **04-18 must execute through drizzle (`tx.execute(q)`), not `client.unsafe(text, params)`.** Raw postgres.js sees the `$1::jsonb` parameter type and JSON-encodes the already-stringified value a second time, so Postgres gets a JSON string scalar. Measured locally: `cannot call jsonb_to_recordset on a non-array`. Drizzle's postgres-js driver installs pass-through json serializers, so the production path works (verified above).
- **04-18 must run `similarityThresholdSql()` first, in the same transaction.** The `%` operator's cut-off is that GUC.
- **The SAB city arm compares `lower(b.city)` with a city folded in TypeScript.** A DB spelling with an accent (e.g. `Peñitas`) lowers to `peñitas` and misses a folded `penitas` in the B3-SAB arm; SQL may not fold (sql-never-normalizes). Impact is limited: the only SAB path to 95 needs an exact phone, and B1 finds that regardless of city. This is logged here rather than fixed, because fixing it would need a stored folded-city column, which is a schema decision.
- **CRLF:** `git checkout --` under autocrlf rewrote the working copies of match.ts and candidates.ts with CRLF, so `prettier --check` warns locally. The committed blobs are LF and prettier-clean.
- The shared local DB showed no cross-plan noise affecting this plan (it has no db-lane tests).

## Known Stubs

None.

## Threat Flags

None. Every surface introduced here (the candidate SQL, the persisted features) is in the plan's threat model, and T-4-02, T-4-05, T-4-06 and T-4-10 are each mitigated and pinned by a named test.

## TDD Gate Compliance

Both tasks have a `test(04-06)` RED commit followed by a `feat(04-06)` GREEN commit (fabf529 → 847a019, 5292fcd → 1b8e36f). Both RED runs failed on the missing module before any implementation existed.

## Self-Check: PASSED

- FOUND: src/lib/places/match.ts, src/lib/places/candidates.ts, tests/unit/places-match.test.ts, tests/unit/places-candidates.test.ts
- FOUND commits: fabf529, 847a019, 5292fcd, 1b8e36f, d0c3171
