---
phase: 02-budget-governor-search-presets
plan: 02
subsystem: database
tags: [seed-data, socrata, census-geocoder, msw, fixtures, postgres, vitest, naics, fips]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tests/db/_fixtures.ts (the Supabase-host refusal and connection timeout this harness mirrors), tests/unit/no-internal-leak.test.ts (the two-sided guard discipline), src/lib/time.ts (the bare-token grep precedent), drizzle/0000-0011 (the twelve migrations the PG17 guard scans)
provides:
  - Five committed seed JSON files (4 clusters, 17 RGV cities, 254 Texas counties, the 20-row outlet matrix, 3 built-in geographies) with provenance
  - src/seed/types.ts - the compile-time shape contract every seed file satisfies
  - Four recorded Census Geocoder payloads plus a README, so CI never touches the network
  - tests/unit/fixtures/preset.ts - the single PresetSpec shared by the estimator (02-07) and component (02-10) tests
  - tests/db/_concurrency.ts - real-connection harness for the 40-way burst, smoke-proven at 40 distinct backend PIDs
  - tests/unit/no-google-credential.test.ts and tests/unit/pg17-compat.test.ts - two repo-wide guards, both watched red first
affects: [02-03, 02-05, 02-07, 02-10, 02-14, phase-03-ingest, phase-04-places]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seed rows ship as committed JSON read by a script, never as a migration: drizzle-kit hashes migration SQL and outlet counts are deliberately refreshable"
    - "Structure enforced by tsc, value domain enforced by a named test - because TypeScript widens every string in a resolved JSON module"
    - "Derived totals are never stored; the test computes them from the parts"
    - "A committing DB fixture cleans up in finally and never deletes an orgs row"
    - "A file inside a grep-guarded tree does not spell the guarded token (the src/lib/time.ts precedent)"

key-files:
  created:
    - src/seed/types.ts
    - src/seed/data/clusters.json
    - src/seed/data/cities.json
    - src/seed/data/counties.json
    - src/seed/data/outlet-counts.json
    - src/seed/data/geo-presets.json
    - tests/unit/outlet-counts.test.ts
    - tests/unit/msw/fixtures/census-mcallen.json
    - tests/unit/msw/fixtures/census-rio-grande-city.json
    - tests/unit/msw/fixtures/census-no-match.json
    - tests/unit/msw/fixtures/census-503.json
    - tests/unit/msw/fixtures/README.md
    - tests/unit/fixtures/preset.ts
    - tests/db/_concurrency.ts
    - tests/unit/no-google-credential.test.ts
    - tests/unit/pg17-compat.test.ts
  modified: []

key-decisions:
  - "The statewide outlet figures exclude the Comptroller's '000' sentinel county: 45612 / 120748 / 23846 / 362069, total 552275 — NOT RESEARCH's 552278"
  - "The 17-city list is the measured >=400-outlet set with name variants folded; it is the Phase 2 / Phase 3 shared contract and needs danlo's confirmation before Phase 3"
  - "nextCandidates came from a LIVE Socrata query this session, not from RESEARCH alone; Raymondville is naturally in the top five below the line"
  - "Rio Grande City folds the three Starr spellings to 843 and deliberately excludes a 1-outlet mis-coded Hidalgo row of the same name"
  - "geo-presets.json is generated FROM cities.json and counties.json so the built-in geographies cannot drift from their source"
  - "tests/db/_concurrency.ts does not spell the rollback helper's name, following the src/lib/time.ts bare-token-grep precedent"

patterns-established:
  - "Two-sided guards: every filesystem-walking test asserts it actually scanned a non-empty set, so a wrong path cannot pass by reading nothing"
  - "A comment-stripping grep gate ships with a companion test proving the stripper discriminates in both directions"
  - "Seed-derived test fixtures: no test fixture restates a city name or a FIPS code"

requirements-completed: [SRCH-02, BUDG-03]

# Metrics
duration: 27min
completed: 2026-09-22
---

# Phase 2 Plan 02: Seed Data, Census Fixtures & Repo-Wide Guards Summary

**The five provenanced seed JSON files every later plan reads (4 clusters / 17 RGV cities / 254 Texas counties / the 20-row outlet matrix / 3 built-in geographies), four recorded Census payloads so CI never spends a network call, a real-connection concurrency harness proven at 40 distinct backend PIDs, and two repo-wide guards both watched red first.**

---

## 🔴 FLAGGED FOR DANLO — ONE-LINE CONFIRMATION NEEDED BEFORE PHASE 3 RUNS

**The 17-city list is the Phase 2 / Phase 3 shared contract.** Phase 3's ingest scope reads it. Changing it after Phase 3 starts means re-ingesting.

The rule, now committed in `src/seed/data/cities.json` under `provenance`:

> **the cities in the four RGV counties with at least 400 active sales-tax outlets, name variants folded** — 17 cities, **90.9 %** of the 34,928-outlet RGV universe.

| # | City | County | Outlets | | # | City | County | Outlets |
|---|---|---|---|---|---|---|---|---|
| 1 | Brownsville | Cameron | 6,678 | | 10 | San Juan | Hidalgo | 791 |
| 2 | McAllen | Hidalgo | 5,985 | | 11 | **Rio Grande City** | Starr | **843** (folded) |
| 3 | Edinburg | Hidalgo | 3,092 | | 12 | Alamo | Hidalgo | 763 |
| 4 | Mission | Hidalgo | 3,034 | | 13 | Mercedes | Hidalgo | 748 |
| 5 | Harlingen | Cameron | 2,626 | | 14 | Hidalgo | Hidalgo | 566 |
| 6 | Pharr | Hidalgo | 1,942 | | 15 | Los Fresnos | Cameron | 490 |
| 7 | Weslaco | Hidalgo | 1,551 | | 16 | Palmview | Hidalgo | 465 |
| 8 | San Benito | Cameron | 948 | | 17 | South Padre Island | Cameron | 417 |
| 9 | Donna | Hidalgo | 821 | | | | | |

**The one product call in it:** ⚠️ **Willacy County has NO city above the line.** Its only town, Raymondville (221 outlets), is 45 % below the threshold. So the city picker shows three of the four RGV counties. If you want every county represented, promote Raymondville by moving its entry from `provenance.nextCandidates` into `cities`; nothing else needs editing, and `tests/unit/outlet-counts.test.ts` will tell you if you get it wrong.

**`nextCandidates` came from a LIVE Socrata query this session** (not from RESEARCH alone), and is the five cities immediately below the line: Roma (Starr, 336) · La Feria (Cameron, 324) · Alton (Hidalgo, 298) · Port Isabel (Cameron, 280) · **Raymondville (Willacy, 221)**.

**Answer needed:** *"17 as seeded"* or *"18, add Raymondville"*.

---

## Performance

- **Duration:** 27 min
- **Started:** 2026-09-22T13:44:00Z
- **Completed:** 2026-09-22T14:11:00Z
- **Tasks:** 3 of 3
- **Files created:** 16

## Accomplishments

- **Every number the estimator and Phase 3 need is committed, provenanced and pinned.** The 16-cell cluster × county matrix and all four RGV column totals (1452 / 5572 / 977 / 15977, grand 23978) were **re-measured live against Socrata this session and reproduce RESEARCH exactly, to the row**.
- **All 254 Texas counties ship with BOTH numbering systems** (Pitfall 7), generated from the authoritative Census file with `comptrollerCode = (countyFips + 1) / 2` and cross-checked against the four independently measured RGV Comptroller codes — never by sorting names, which breaks 15 of 254 rows under every collation.
- **CI can replay every Census outcome without a network call.** Three verbatim captures (the McAllen body is 1,154 bytes, confirming `layers=Counties` was set — 5,125 without it) plus one honestly-labelled hand-written 503 envelope.
- **The concurrency harness was actually executed, not just typechecked:** 40 parallel connections returning **40 distinct `pg_backend_pid()` values**, proving genuine concurrency rather than one reused socket.
- **Both guards were watched RED first** against planted violations, and the PG17 guard was additionally proven *not* self-invalidating on a real migration file.

## Task Commits

1. **Task 1: The committed seed data** — `76711d6` (feat)
2. **Task 2: Census payloads, shared PresetSpec, concurrency harness** — `b3fe9c6` (feat)
3. **Task 3: The two repo-wide guard tests** — `8b8b2a8` (test)

**Plan metadata:** committed with this SUMMARY.

## Verification Results

All four gates run through the store launcher, exit codes read directly (never through a pipe), and **branch + HEAD printed AFTER the gates** to rule out a parallel session moving the tree mid-run:

```
typecheck exit=0
lint      exit=0
test:unit exit=0
build     exit=0
--- branch/HEAD AFTER the gates ---
worktree-agent-a0423951ac3312fa8
8b8b2a8
```

### `pnpm test:unit` pass list, BY NAME (23 passed / 8 files, 0 failed)

The four names this plan added:

```
✓ tests/unit/outlet-counts.test.ts > seed data > outlet counts match the measured RGV matrix
✓ tests/unit/outlet-counts.test.ts > seed data > 254 counties seeded with both numbering systems
✓ tests/unit/outlet-counts.test.ts > seed data > the RGV 17-city list and its coverage
✓ tests/unit/pg17-compat.test.ts > production is PostgreSQL 17.6 > pg17: no migration uses PostgreSQL 18-only syntax
✓ tests/unit/pg17-compat.test.ts > production is PostgreSQL 17.6 > pg17: the comment-stripping guard is not self-invalidating
✓ tests/unit/no-google-credential.test.ts > no Google credential in the source tree > no google credential is read anywhere in src
✓ tests/unit/no-google-credential.test.ts > no Google credential in the source tree > src/env.ts declares no Google variable
```

The pre-existing 16 (env-alias ×5, sole-organization ×5, time ×3, no-internal-leak ×2, suite-zone ×1) all stayed green.

### Watched-red-first output — guard (a), the Google credential

Planted `src/scratch-planted-credential.ts` containing `const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;`:

```
FAIL tests/unit/no-google-credential.test.ts > ... > no google credential is read anywhere in src
AssertionError: src\scratch-planted-credential.ts:2 [GOOGLE_*KEY environment variable] const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
src\scratch-planted-credential.ts:2 [GOOGLE_API_KEY] const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
src\scratch-planted-credential.ts:3 [GOOGLE_*KEY environment variable] export const scratch = GOOGLE_API_KEY;
src\scratch-planted-credential.ts:3 [GOOGLE_API_KEY] export const scratch = GOOGLE_API_KEY;: expected [ …(4) ] to deeply equal []
 Tests  1 failed | 22 skipped (23)
```

Deleted → green again (`Tests 1 passed | 22 skipped`). The failure names the **file, the line and which pattern matched**.

### Watched-red-first output — guard (b), PostgreSQL 18-only SQL

Planted `drizzle/9999_scratch.sql` containing `update t set a = 1 returning old.a;`:

```
FAIL tests/unit/pg17-compat.test.ts > production is PostgreSQL 17.6 > pg17: no migration uses PostgreSQL 18-only syntax
AssertionError: drizzle\9999_scratch.sql:1 [RETURNING old.* (PostgreSQL 18)] returning old. — in: update t set a = 1 returning old.a;: expected [ Array(1) ] to deeply equal []
 Tests  1 failed | 1 passed | 21 skipped (23)
```

Note the `1 passed` alongside it: the companion stripper test stayed green, which is the **positive control** distinguishing a working guard from one that refuses everything.

**A second, stronger control** — the same scratch file rewritten so the forbidden tokens appear ONLY inside `--` and `/* */` comments:

```
✓ pg17: no migration uses PostgreSQL 18-only syntax
✓ pg17: the comment-stripping guard is not self-invalidating
  Tests  2 passed | 21 skipped
```

So the guard is proven on a **real migration file** in both directions: live SQL fails, the same tokens in a header paragraph do not. Without that, the guard would be self-invalidating — a migration documenting the rule would break the rule.

Both plants deleted; `git status --short` is **empty**.

### Concurrency harness smoke (read-only, no table touched)

```
openTestClient ok: { ok: 1, version: 180006 }
openTestClients(40) opened: 40 in 994 ms
distinct backend pids: 40 (40 = genuinely concurrent connections)
closeAll ok
closeAll on already-closed clients: no throw
supabase host refused: tests/db/_concurrency.ts: TEST_DATABASE_URL points at a Supabase host. D-04: ...
unset refused: tests/db/_concurrency.ts: TEST_DATABASE_URL is not set. Local dev: docs/...
SMOKE OK
```

`version: 180006` is the local server at **PostgreSQL 18.6** — the live evidence for Pitfall 1's premise that local ≠ production 17.6, which is exactly why the PG17 guard exists.

### Criterion-level greps

| Check | Result |
|---|---|
| `node -e` 254-row bijection check | prints `ok` |
| `grep -c '15977\|15,977' outlet-counts.json` | **0** |
| `5861` / `9355` / `606` / `155` in outlet-counts.json | 1 each |
| `cities.json` contains `Rio Grande City`, `RIO GRANDE CY`, `843`, `Raymondville`, `221`, `90.7`, `31760` | 1 each |
| `counties.json` contains `48215`, `48061`, `48427`, `48489` | 1 each |
| `geo-presets.json` contains `texas_254_counties` and `Texas (254 counties)` | 1 each |
| `clusters.json` contains all 12 NAICS bounds | 1 each |
| `census-mcallen.json` contains `"COUNTY"`, `"48"`, `"215"` | 1 each |
| `census-no-match.json` `addressMatches` is an empty array | true |
| `grep -c 'layers=Counties' msw/fixtures/README.md` | 3 |
| `preset.ts` exports all five specs; `grep -c Brownsville` | 5 exports, **0** |
| `_concurrency.ts`: `withRollback` / `delete from orgs` | **0** / **0** |
| `pg17-compat.test.ts` strips `--` lines (criterion grep) | 1 |

## Files Created

| File | What it does |
|---|---|
| `src/seed/types.ts` | The compile-time shape contract; documents why discriminating fields are `string` not a union |
| `src/seed/data/clusters.json` | Four atomic clusters (D-03), exact NAICS half-open ranges, Places types + Phase-4 note |
| `src/seed/data/counties.json` | All 254 Texas counties, both numbering systems, RGV flags + all-NAICS outlet counts |
| `src/seed/data/cities.json` | The 17 cities, folded name variants, full provenance, five next candidates |
| `src/seed/data/outlet-counts.json` | 16 county rows + 4 statewide rows; column totals deliberately not stored |
| `src/seed/data/geo-presets.json` | Three built-in geographies, generated from the two files above |
| `tests/unit/outlet-counts.test.ts` | Pins the matrix, the bijection and the 17-city coverage by exact value |
| `tests/unit/msw/fixtures/*.json` (4) | Recorded Census payloads: 2 hits, 1 empty-match 200, 1 hand-written 503 envelope |
| `tests/unit/msw/fixtures/README.md` | Exact URL per fixture, the date, and the two traps (200-is-the-failure-mode; x=lng) |
| `tests/unit/fixtures/preset.ts` | The one `PresetSpec`, every ref derived from the seed JSON |
| `tests/db/_concurrency.ts` | 40 real connections, Supabase refusal, committing fixture that never deletes an org |
| `tests/unit/no-google-credential.test.ts` | BUDG-03 / T-2-15 standing guard over `src/` |
| `tests/unit/pg17-compat.test.ts` | Pitfall 1 guard over `drizzle/*.sql`, with a tested comment stripper |

## Decisions Made

1. **Statewide figures exclude the `000` sentinel county** (see Deviations #1).
2. **`geo-presets.json` is generated, not hand-written** — the 254-FIPS list and the 17 city refs are derived from `counties.json`/`cities.json` by a throwaway script, so a built-in geography cannot drift from the data it is built on. The generator asserts every city resolves to a seeded county before writing.
3. **`tests/db/_concurrency.ts` never spells the rollback helper's name.** The plan requires both `grep -c 'withRollback'` = 0 **and** a comment explaining the divergence — resolvable only by the house pattern `src/lib/time.ts` already established: a file inside a bare-token-grep-guarded tree does not spell the guarded token, and says so. The explanation is intact and ~20 lines long.
4. **Rio Grande City folds three spellings to 843, and excludes a fourth.** Socrata also returns a single `RIO GRANDE CITY` row under county code **108 (Hidalgo)** with 1 outlet — a mis-coded source row, since Rio Grande City is in Starr. It is excluded; 843 = 776 + 35 + 32, all Starr.
5. **The 503 fixture is shaped differently from its neighbours on purpose** and says so in the file: the three captures are response *bodies*, the 503 is a `{status, body}` *envelope*, so a handler confusing the two fails loudly.
6. **`src/components/ui/**` is not excluded from the credential walk.** Generated shadcn primitives land there in a later plan and are exactly the code nobody re-reads.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The statewide outlet figures included a sentinel county that is in none of the 254**

- **Found during:** Task 1
- **Issue:** The plan (from RESEARCH) specifies statewide totals `120749` (food_hospitality), `362071` (auto_retail) and a grand total of `552278`. Re-measuring live, I got `120748` / `362069` / `552275`. Rather than assume intraday drift, I measured both ways and isolated it: the Comptroller dataset carries a **255th `outlet_county_code` value `'000'`** — a sentinel belonging to no Texas county and having no FIPS. RESEARCH's own Seed Data section mandates filtering `between '001' and '254'`, but its statewide figures were measured **without** that filter. The delta is exactly 1 food_hospitality row and 2 auto_retail rows; the other two clusters match to the unit either way.

  ```
  home_services          filtered 45612  unfiltered 45612  delta 0
  food_hospitality       filtered 120748 unfiltered 120749 delta 1
  personal_care_health   filtered 23846  unfiltered 23846  delta 0
  auto_retail            filtered 362069 unfiltered 362071 delta 2
  ```

  This matters because the `texas_254_counties` built-in preset (D-04) prices Texas by summing its 254 seeded counties. A statewide figure 3 outlets larger than that sum can never be reproduced from the seed, so the first person to check the estimator's arithmetic would find it "wrong" by an amount nobody could explain.
- **Fix:** Committed the sentinel-excluded figures. `outlet-counts.json` carries a `statewideScope` field stating the filter, the excluded sentinel, the old numbers and why; `tests/unit/outlet-counts.test.ts` asserts `552275` with the same explanation in a comment.
- **Files modified:** `src/seed/data/outlet-counts.json`, `tests/unit/outlet-counts.test.ts`
- **Verification:** Both queries executed live against Socrata this session; the county matrix and all four RGV column totals — the figures the plan's `must_haves` actually pin — are **unaffected and reproduce exactly**.
- **Committed in:** `76711d6`

**2. [Rule 3 - Blocking] Two acceptance criteria contradicted their own prescribed content**

- **Found during:** Tasks 1 and 2
- **Issue:** Three criteria could not all be satisfied as literally written:
  - (a) The plan prescribes the `outlet-counts.json` `caveat` **verbatim** including the string `15,977`, while another criterion requires `grep -c '15977\|15,977'` on that same file to be **0**.
  - (b) The plan requires `grep -c 'withRollback' tests/db/_concurrency.ts` = **0** *and* "the file carries a comment explaining why" it diverges from that helper.
  - (c) The plan requires `_concurrency.ts` to contain `pooler.supabase`. The guard's source text is the regex `/supabase\.(co|com)|pooler\.supabase/` — a plain grep for `pooler.supabase` cannot match `pooler\.supabase`. **Verified: the same grep returns 0 against the reference file `tests/db/_fixtures.ts`**, so the criterion fails against its own model implementation.
- **Fix:** Resolved each toward the criterion's *intent*, which is unambiguous in all three cases:
  - (a) Reworded the caveat's one numeral to "roughly sixteen times that", and added a sentence saying the total is deliberately not spelled out because every column total in the file is derived. The caveat's substance — that the Comptroller under-counts untaxed personal services, and that this is a permit count not a Places count — is intact.
  - (b) Applied the `src/lib/time.ts` precedent: the ~20-line explanation is present and names the file (`tests/db/_fixtures.ts`), just not the identifier, and explicitly states *why* it does not name it.
  - (c) Added prose naming the refused hosts — "rejects any supabase.co, supabase.com or pooler.supabase host (D-04)" — which both documents the guard and makes the criterion verifiable. The refusal logic itself is byte-identical to `_fixtures.ts`.
- **Files modified:** `src/seed/data/outlet-counts.json`, `tests/db/_concurrency.ts`
- **Verification:** All three greps now return their required values; the substantive guard in each case is unchanged.
- **Committed in:** `76711d6`, `b3fe9c6`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** No scope creep. #1 corrects a figure that would have made the Texas estimate unreproducible from its own seed; #2 is purely about satisfying self-contradictory criteria without weakening any guard.

## Issues Encountered

- **Socrata and both Census endpoints were reachable**, so nothing fell back to RESEARCH-only values. The 254-county file fetched at 126,639 bytes / HTTP 200; the McAllen geocode came back at exactly **1,154 bytes**, independently confirming RESEARCH's measured `layers=Counties` size win.
- **No `test:db` was run and no migration was written**, per the plan and the parallel-execution brief. Sibling plan 02-03 is applying migrations 0012/0013 to the same shared local database concurrently.

## Cross-Plan Dependencies (for the orchestrator)

- **`tests/db/_concurrency.ts` is the harness only.** The test that uses it is **plan 02-05**'s. Its cleanup targets `cost_ledger`, `cost_reservations` and `budget_periods` — tables **plan 02-03** creates. Every delete is guarded by `to_regclass`, so the file is safe to load today and starts cleaning the moment those tables exist. No coordination needed at merge.
- **The four Census payloads are replayed by `tests/unit/msw/server.ts`, which is plan 02-07's**, together with the zod schema and the `STATE === '48'` Texas-only guard.
- **`tests/unit/fixtures/preset.ts` is imported by plans 02-07 and 02-10.** `PresetSpec`/`GeoSpec` are declared there for now; if a later plan needs them in `src/`, move the type and re-export rather than redeclaring.
- **`tests/unit/pg17-compat.test.ts` asserts `files.length >= 12`.** Plan 02-03's new migrations only raise that count. It will also scan 02-03's migrations the moment the branches merge — which is the point.

## Known Stubs

None. Every file this plan created is complete and consumed by a passing test, except `tests/db/_concurrency.ts` (exercised by the read-only smoke above; its first real consumer is plan 02-05 by design) and the four msw fixtures (replayed by plan 02-07 by design). Both are declared in the plan as harness-only deliverables.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema. It *closes* T-2-15 (Google credential in `src/` or the client bundle) with a standing, watched-red-first guard, and supplies the T-2-06 mitigation (a committing fixture that cleans up in `finally` and never deletes an `orgs` row).

## User Setup Required

None for this plan. Note that **BUDG-03's second wall — the Google Cloud "Requests per day = 100" quota — remains a `checkpoint:human-action` in plan 02-14**, and the GCP project plus Places API (New) key still **do not exist**. This plan deliberately depends on neither: `tests/unit/no-google-credential.test.ts` makes "no test requires the key" an enforced contract rather than a temporary condition.

## Next Phase Readiness

**Ready.** The SRCH-02 seed contract is committed and pinned. Phase 3's ingest scope can read `src/seed/data/clusters.json` (NAICS predicates) and `geo-presets.json` (geography) directly.

**One blocker on the Phase 3 hand-off:** the 17-city list needs danlo's one-line confirmation (top of this document). It is cheap to change now — one file, one test — and expensive after Phase 3 ingests against it.

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*
