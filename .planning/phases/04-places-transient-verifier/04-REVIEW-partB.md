---
phase: 04-places-transient-verifier
slice: B — Places core, placesSweep workflow, env, budget/estimate, their tests
reviewed: 2026-09-24T12:34:03Z
depth: standard (with cross-file contracts traced: request→client→meter→page-record→writer definers; planner→workflow steps→reducer)
files_reviewed: 66
files_reviewed_list:
  - src/env.ts
  - src/lib/budget/field-mask-tier.ts
  - src/lib/budget/second-wall.ts
  - src/lib/estimate/assumptions.ts
  - src/lib/estimate/estimate.ts
  - src/lib/estimate/expand-cells.ts
  - src/lib/places/candidates.ts
  - src/lib/places/change-detect.ts
  - src/lib/places/check-tile.ts
  - src/lib/places/client.ts
  - src/lib/places/host-class.ts
  - src/lib/places/match.ts
  - src/lib/places/meter.ts
  - src/lib/places/page-record.ts
  - src/lib/places/partition.ts
  - src/lib/places/place-types.ts
  - src/lib/places/plan-run.ts
  - src/lib/places/purge-status.ts
  - src/lib/places/request.ts
  - src/lib/places/reserved-call.ts
  - src/lib/places/response.ts
  - src/lib/places/search-tile.ts
  - src/lib/places/tiling.ts
  - src/workflows/places-sweep/reducer.ts
  - src/workflows/places-sweep/steps.ts
  - src/workflows/places-sweep/wire.ts
  - src/workflows/places-sweep/workflow.ts
  - tests/unit/msw/places.ts
  - tests/unit/msw/server.ts
  - tests/workflow/_json-imports.ts
  - tests/workflow/_seed.ts
  - tests/workflow/lane.test.ts
  - tests/workflow/places-sweep.test.ts
  - tests/unit/_walk.ts
  - tests/unit/anonymize-places.test.ts
  - tests/unit/change-detect.test.ts
  - tests/unit/estimate.test.ts
  - tests/unit/field-mask-tier.test.ts
  - tests/unit/fixtures/google-check.ts
  - tests/unit/host-class.test.ts
  - tests/unit/no-google-credential.test.ts
  - tests/unit/no-internal-leak.test.ts
  - tests/unit/no-map.test.ts
  - tests/unit/no-network.test.ts
  - tests/unit/page-record.test.ts
  - tests/unit/partition.test.ts
  - tests/unit/place-types.test.ts
  - tests/unit/places-candidates.test.ts
  - tests/unit/places-chips-contract.test.ts
  - tests/unit/places-client.test.ts
  - tests/unit/places-env.test.ts
  - tests/unit/places-format.test.ts
  - tests/unit/places-match.test.ts
  - tests/unit/places-meter-mode.test.ts
  - tests/unit/places-msw.test.ts
  - tests/unit/places-request.test.ts
  - tests/unit/places-sweep-imports.test.ts
  - tests/unit/places-sweep-wire.test.ts
  - tests/unit/plan-run.test.ts
  - tests/unit/preset-run-costs.test.ts
  - tests/unit/purge-route.test.ts
  - tests/unit/sweep-reducer.test.ts
  - tests/unit/tiling.test.ts
  - tests/unit/time.test.ts
  - tests/unit/ui-maps.test.ts
  - tests/unit/walk.test.ts
findings:
  critical: 3
  warning: 10
  info: 7
  total: 20
status: issues_found
---

# Phase 4 (slice B): Code Review Report

**Reviewed:** 2026-09-24T12:34:03Z
**Depth:** standard, with the cross-file contracts traced
**Files Reviewed:** 66
**Status:** issues_found

## Summary

Slice B covers the Places request builder, client, meter, matcher, candidate query, page record, tiler, partitioner and planner, the `placesSweep` workflow (steps, wire, reducer), env, budget/estimate, and their unit and workflow-lane tests. I also read, for context, drizzle/0028 and 0029 (the definers this code calls), `queue-run.ts` (admission, the other half of the plan and ceiling contracts), `scripts/lib/anonymize-places.ts`, and drizzle-orm's `pg-core/session.js`.

Most of the brief checks out against the code:

- **Mode gate.** It runs before any reservation, both in `queueRun` and in `reservePage`.
- **Reservation before every request.** Enforced by the branded `ReservedCall`: one minter, and a test holds it to that.
- **Charged vs released.** ok, timeout and a 200 `bad_shape` are charged; everything else is released.
- **Request ids and ceiling.** Request ids are per attempt, and the ceiling bump shares a transaction with the reservation.
- **Daily quota.** A daily-quota 429 is a returned stop, never retried.
- **Match bands.** The ≥95 / 80–95 / <80 bands and the tie-to-review rule hold. Merged rows are excluded twice (in the query and in the writer).
- **Candidate query.** It runs through `tx.execute`, with `set local` for the trigram threshold in the same transaction.
- **Persisted features.** Integer-only, with `nameSim`/`distanceM` dropped.
- **Step boundary.** Step payloads carry ids and enums only, and U+0000 is encoded at the step boundary.
- **Error realms.** The reducer's cross-realm `Error` check is sound.
- **Operator kills.** `finishRun`'s `status = 'running'` guard never overwrites an operator kill.
- **Partitions.** Pinned to both zone and locale.
- **Place types.** All 26 cluster types are in Table A.

Three defects can still produce wrong results or wasted spend:

1. **US results filtered out (CR-01).** The out-of-area rule depends on a `, USA` suffix. The request's own `regionCode: 'US'` tells Google to leave that suffix off. On a real call, every US result would be dropped as `outside`.
2. **Retries re-buy pages (CR-02).** A tile retry or re-execution starts again from page 1. Every page already paid for is bought again, which also counts against the 100/day quota and the ceiling.
3. **Radius tile collisions (CR-03).** Two radius presets in the same county with the same radius share tile keys. `place_tiles` keeps the first preset's rectangles, so change checks and the novelty rule read another preset's geography.

The synthetic fixtures all carry `, USA` and the msw handler returns an empty 200 for any request it does not recognise. So the suite cannot catch CR-01, and it misses several regressions of the same kind (WR-10).

## Critical Issues

### B-CR-01: Every US Places result will be classified `outside`, so nothing ever attaches

**File:** `src/lib/places/match.ts:126` (with `src/lib/places/request.ts:34,103`, `scripts/lib/anonymize-places.ts:125-129`)

**Issue:** `outOfArea: lastSegment !== undefined && lastSegment !== 'USA'`. The builder hard-codes `regionCode: 'US'` into every request. Google documents that parameter, for Text Search (New) and Place Details (New), like this: *"If the country name of the formattedAddress field in the response matches the regionCode, the country code is omitted from formattedAddress."* A real McAllen result therefore arrives as `"1200 N 10th St, McAllen, TX 78501"`, with no `, USA`. Its last segment is `TX 78501`, so `outOfArea` is true.

What follows from that:

- `decide()` returns `outside` for every US listing.
- `toPageRecord` strips every match (`matches: outOfArea ? [] : …`).
- `record_places_page` writes no attachment and no observation.
- The run report shows the whole run as "outside".
- The D-04 run, which is legally gated and quota-limited, is spent for nothing.

A pure SAB whose partial address reads `"McAllen, TX"` fails the same way.

The one real-payload path makes this worse. The 04-19 anonymizer keys on the same `last === 'USA'` test, so the first recording would turn every real US place into `"NNN Calle Sintetica, Synthetic, Mexico"`. The bug would then be committed into the fixtures.

Nothing in the suite can see this. Every fixture (`tests/unit/msw/fixtures/places-*.json`, the DB tests, the e2e seed) is hand-written with `, USA`. The assumption goes back to 04-RESEARCH L365 (`…, TX 78501, USA`) and was never checked against the documented `regionCode` behaviour.

**Fix:** Stop treating "no `USA` suffix" as out of area. Test for a foreign country positively, and treat a US state + ZIP tail as domestic:

```ts
// match.ts
const US_TAIL = /\b[A-Z]{2} \d{5}(?:-\d{4})?$/;          // "TX 78501" (regionCode=US omits the country)
const FOREIGN = /^(Mexico|México|Canada)$/i;              // extend as needed
const last = segments.at(-1);
const outOfArea =
  last !== undefined && last !== 'USA' && !US_TAIL.test(last) && (FOREIGN.test(last) || segments.length > 1 && !/\bTX\b/.test(formatted));
```

Two simpler options: drop `regionCode` from the body, so Google keeps the country (re-price nothing, since the field is not in the mask), or decide on the country code from `addressComponents` (Pro, free at the margin under Enterprise). Apply the same rule in `scripts/lib/anonymize-places.ts`. Add a fixture page whose US addresses have no `, USA`, and a named test that it attaches.

### B-CR-02: A tile retry or re-execution re-buys every page it already paid for; there is no (run, tile, page) idempotency

**File:** `src/lib/places/search-tile.ts:309-406`, `src/workflows/places-sweep/steps.ts:84-109,315` (same shape in `src/lib/places/check-tile.ts:73-138`)

**Issue:** `runSearchTile` always starts at page 1. Page tokens are not persisted, and the step never checks whether its `run_searches` row is already `done`. So every retry buys the tile again from the top. Three cases:

1. **A later page fails.** Page 3 gets a 503 or per-minute 429 → `RetryableError` → the retry re-requests pages 1 and 2, which Google bills again. The meter ledgers them honestly under fresh per-attempt ids. They count against the 1,000 free requests, the D-03 quota of 100/day and `ceiling_requests`. With `maxRetries = 3`, one flaky page 3 costs up to 6 extra billed requests.
2. **A post-call fault that repeats.** Any database refusal after the call is retried by default, because `stepError` returns a plain Error and plain Errors are retryable. Examples: `record_places_page`'s 22023 on a place id outside `^[A-Za-z0-9_-]+$`, a `pa_features_numeric` CHECK, or `toPageRecord` refusing a feature. The transaction rolls back, and on every retry `settleInFlight` charges the attempt and re-buys page 1. That is four billed page-1 requests, then the run fails with nothing recorded.
3. **A finished step re-executed.** At-least-once delivery can re-execute a completed step, for example after a crash between the body finishing and `step_completed` being written. `settleInFlight` finds no cursor, and the tile is bought again in full (up to 3 pages).

This contradicts the locked discretion note in CONTEXT: "Workflow step idempotency keyed by (run, tile, type, page) so a replay never double-bills". The per-attempt request id only stops the ledger from recording one attempt twice. It does not stop the same page being bought twice.

**Fix:**
- At the top of `runSearchTile` (after `settleInFlight`), read `status, saturated, subdivided, truncated, results_count` from `run_searches`. If the row is `done`, rebuild and return the `searched` result without calling Google. Planned children come back through the idempotent `plan_run_searches`.
- Make the deterministic faults fatal. In `guarded`, map a SQLSTATE of class 22/23/42 (read from `e.cause.code`, see WR-07) and `toPageRecord` refusals to `FatalError`, not a retryable error.
- For mid-tile retries, either resume from the last recorded page or accept the cost explicitly. Resuming means holding the opaque `nextPageToken` on the search row for the life of the run (it is a cursor, not business content; clear it at `done`). If you accept the cost, write it down, and cap a tile to one retry once `pages_done > 0`.
- Add a lane test: page 3 returns 503 once, then assert `placesRequests` for that tile is 4, not 6.

### B-CR-03: Two radius presets in one county with the same radius share tile keys; the tile rows keep the first preset's rectangles

**File:** `src/lib/estimate/expand-cells.ts:283`, `src/lib/places/tiling.ts:123-130`, `drizzle/0028_places_meter_retention.sql:141-148`, `src/workflows/places-sweep/steps.ts:170-215`

**Issue:** A radius cell's `unitId` is `` `${countyFips}\u0000${radiusMiles}mi` ``. The centre is not part of it. "5 mi around McAllen" and "5 mi around Edinburg" (both 48215) therefore produce the same `tileKey` (`radius:48215/5mi|plumber|r…`) and the same `cellKey`. `place_tiles` is keyed per (org, tile_key) and is shared across runs and presets. `plan_run_searches` upserts it with `do update set updated_at = now()`, so the stored `south/west/north/east` stay whatever the first preset wrote. The consequences:

- **Change checks read the wrong ground.** `storedLeaves` builds preset B's leaves from `place_tiles` rectangles, which are preset A's. Preset B's free listing searches preset A's area and diffs it against a membership that mixes both. The verdicts are wrong, and D-16 later relies on them.
- **Membership is merged.** Both presets add members to one `place_tile_members` set per key. `overlapWithParent` then measures novelty against the union, which triggers false `novelty` truncations.
- **Tile flags flap.** `is_leaf`, `saturated` and `truncated` get overwritten by whichever preset ran last.

**Fix:** Put the centre into the radius unit id, rounded to a stable precision, so the key names the geometry:

```ts
// expand-cells.ts (radius)
`${countyFips}${SEP}${lat.toFixed(5)},${lng.toFixed(5)}${SEP}${radiusMiles}mi`
```

(Adjust `wire.ts`'s encoding if `,` needs escaping; it does not today.) As a second defence, have `plan_run_searches` refuse, with 22023, an existing `place_tiles` row whose rectangle differs from the incoming one. That way a future key collision fails loudly instead of silently reusing geometry. Add a unit test: two radius specs with different centres produce different tile keys.

## Warnings

### B-WR-01: Saturation requires exactly 60 results; a capped search that returns fewer is marked `done` with no truncation warning

**File:** `src/lib/places/tiling.ts:134-136`, `src/lib/places/search-tile.ts:409`, `src/lib/places/change-detect.ts:32`

**Issue:** `isSaturated(total) === 60`. The 60 cap applies to what Google retrieves, but pages can come back short:

- `strictTypeFiltering` drops non-matching results after retrieval.
- Pages can contain duplicates.
- The cap is "subject to change".

In any of those cases a tile Google did cap reports 57 results on page 3 with no token. It is then `done`, never subdivided, and never counted as truncated. That is a silent partial, which criterion 3 forbids. If Google lowers the cap, nothing ever saturates.

**Fix:** Treat reaching the last page as saturation. In `runSearchTile`, track `reachedLastPage = (n === MAX_PAGES)`, so page 3 was requested because page 2 had a token. Use `saturated = reachedLastPage || total >= SATURATION_RESULTS`, and the same for `diffTile` (pass `pagesServed`).

### B-WR-02: The novelty rule truncates dense cores, which are the tiles that most need splitting

**File:** `src/lib/places/tiling.ts:111,322-324`, `src/lib/places/search-tile.ts:233-251`

**Issue:** Overlap is measured as "the share of the child's ids the parent already held". Google ranks the parent's 60 by prominence across the whole bbox. When those 60 sit mostly in one quadrant (downtown McAllen), that child's own top 60 are largely the same places. Overlap reaches ≥ 0.75, and the child is truncated as `novelty` even though it holds hundreds of listings. The rule meant to stop service-area loops also stops subdivision where density is highest. It is reported, not silent, but it permanently limits coverage of the core. The parent's membership also grows across runs, because Enterprise sweeps never set `gone_at`, so overlap drifts upward over time.

**Fix:** Apply novelty only when the repeated ids are service-area listings, e.g. overlap computed over `pureSab` ids, or require that the child's non-SAB ids are also mostly the parent's. Alternatively compare siblings: truncate when all four children return the same set. Restrict the parent membership read to the current run (`last_seen_at >= run.started_at`). Add a tiling test with a dense-quadrant parent that must still subdivide.

### B-WR-03: A change check on a saturated leaf marks live members `gone`

**File:** `src/lib/places/check-tile.ts:160-166`, `src/lib/places/change-detect.ts:39-49`, `drizzle/0029_places_writers.sql:361-363`

**Issue:** For a saturated listing, `diffTile` still computes `gone = stored − seen`, and `record_change_check` writes `gone_at` for those ids. A leaf that was truncated at min-size or novelty is saturated by definition. Its IDs-only listing is Google's top 60, while its membership (built up over Enterprise sweeps) can be larger or ranked differently. Places that simply fell outside the top 60 get marked gone. That corrupts the membership the next diff reads, and the membership `overlapWithParent` reads.

**Fix:** When the verdict is `saturated`, record `added` only and pass `gone = []`. A capped listing cannot prove absence.

### B-WR-04: Leaves from a previous tree stay `is_leaf`, so change checks list overlapping tiles

**File:** `src/workflows/places-sweep/steps.ts:170-215`, `drizzle/0028_places_meter_retention.sql:240-249`

**Issue:** `mark_run_search('done')` updates `is_leaf` for the one tile it closes. Suppose sweep 1 split `r` into `r0..r3`, and in sweep 2 `r` no longer saturates. Then `r` becomes `is_leaf = true`, and `r0..r3` stay `is_leaf = true` from before. `storedLeaves` returns the root and all its old descendants, so the change check lists overlapping rectangles. That means extra requests, double diffs, and a quicker hit on the ceiling (see WR-05).

**Fix:** When a tile closes as not subdivided, clear `is_leaf` on every stored descendant (`starts_with(tile_key, <this key>) and tile_key <> <this key>`) in `mark_run_search`. Alternatively, have `storedLeaves` drop any leaf whose ancestor is itself a leaf.

### B-WR-05: A change check's request ceiling comes from the root estimate, but the check runs over stored leaves

**File:** `src/server/actions/queue-run.ts:227` with `src/workflows/places-sweep/steps.ts:299`

**Issue:** `ceiling_requests = ceil(2 × requestsHi)`, where `requestsHi` is types × 3 pages × `FAN_OUT` (3). `beginRun` replaces each root with every stored leaf, and a depth-3 tree can have dozens per type. A routine change check of one city then stops `partial / exceeded_estimate` part-way. The operator reads that as a budget stop on a free SKU, and part of the geography goes unchecked.

**Fix:** For `change_check`, size the ceiling from the stored leaf count: count `place_tiles` leaves for the run's roots at admission, then use `ceil(2 × leaves × PAGES_HI)`. Alternatively, admit change checks without a ceiling on `ts_essentials`; the meter already charges $0.

### B-WR-06: 401/403/404 are retried as `unavailable`, and Retry-After has no upper bound

**File:** `src/lib/places/response.ts:99-100`, `src/lib/places/client.ts:64-68`

**Issue:** `classifyGoogleError` maps everything except 400 and 429 to `unavailable`, which is retryable. A bad or restricted key, Places API (New) not enabled, or billing disabled (403 `PERMISSION_DENIED`) is therefore retried three times on every run before the run fails as `places_unavailable`, which hides the real cause. Separately, `retryAfterMsOf` accepts any delta-seconds value. A `Retry-After: 86400` puts the step to sleep for a day, and admission reclaims the run as `abandoned` after 30 minutes.

**Fix:** Map 401/403/404 to `rejected`, or to a new `places_key_rejected` failure, as non-retryable. Clamp `retryAfterMs` to something like 5 minutes, and treat a longer wait as a stop.

### B-WR-07: `stepError` never sees a SQLSTATE, because drizzle wraps every query error

**File:** `src/workflows/places-sweep/steps.ts:84-92`

**Issue:** drizzle-orm 0.45 `pg-core/session.js` throws `new DrizzleQueryError(query, params, e)` for every failed `tx.execute`. That class has no `code` (the postgres error is on `.cause`) and does not set `name`. So every database fault in a step is recorded as `step_error:Error`. The SQLSTATE branch this helper was written for never runs on a real database error. It is dead code, and any test that feeds it a `{ code }` object is looser than what drizzle actually throws. It also blocks the fatal-vs-retryable split B-CR-02 needs.

**Fix:**

```ts
const src = (e as { cause?: unknown })?.cause ?? e;
const code = typeof (src as { code?: unknown })?.code === 'string' ? (src as { code: string }).code : …;
```

Keep dropping the message: `DrizzleQueryError.message` contains `params`, and some params come from Places responses. Add a test that throws a real query error through `withWorkerOrg` and asserts `step_error:22023`.

### B-WR-08: A `beginRun` failure leaves the run `queued` with its admission hold held

**File:** `src/workflows/places-sweep/workflow.ts:36`

**Issue:** `beginRun` runs outside the `try`. A fatal or exhausted failure in it (a DB fault, or the M46 refusal) throws out of the workflow without reaching `finishRun`. Because the transaction rolled back, the run stays `queued` with its `costHi` hold. The hold lasts until the reservation expiry self-heal, and the slot until queueRun's 15-minute `never_started` reclaim, which does not release the hold. The drawer's "nothing was reserved" is untrue for that window.

**Fix:** Wrap `beginRun` in its own try. On failure, call a small `abortRun` step that releases the run's unsettled holds and closes the run `failed / never_started` while it is still queued or running. Skip that for M46: a foreign org must not be able to close someone else's run.

### B-WR-09: Tile keys leave out the cluster, so a Places type shared by two clusters is planned once and searched twice

**File:** `src/lib/places/tiling.ts:123-130`, `src/workflows/places-sweep/reducer.ts:86-88`, `drizzle/0028_places_meter_retention.sql:150-158`

**Issue:** `tileKeyOf(unitKind, unitId, placesType, quadPath)` does not include the cluster. If two clusters ever list the same type, `plan_run_searches` returns the same `search_id` for both roots (`run_searches_key` is `do nothing`). `initialQueue` then holds two `PlannedSearch` entries with one `searchId`, and `applyResult` removes only the first match. The same tile is searched and billed twice. The second pass scores with cluster B in memory but writes outcomes under the row's `cluster_key` A, so B's "unmatched per cluster" never counts. Today's `clusters.json` types don't overlap, but nothing tests for that.

**Fix:** Either add a named test that asserts `placesTypes` are disjoint across clusters, or dedupe roots by `tileKey` in `planRootSearches` and carry every cluster the search serves. Also make `applyResult` refuse a queue that holds a duplicate `searchId`.

### B-WR-10: The msw Places handler answers unrecognised requests with an empty 200 and checks one body invariant

**File:** `tests/unit/msw/places.ts:253-255,286`

**Issue:** `if (!route) return HttpResponse.json(project(empty…))`. A regression in the rectangle, the type, or the page-2 body gets a valid empty page back, and the run completes green with no results. The header says a best-effort page would make a builder regression look right, but this default is exactly such a page. The handler also checks only `includePureServiceAreaBusinesses`. It does not check:

- `strictTypeFiltering: true`
- `pageSize: 20`
- `regionCode` / `languageCode`
- `includedType` ∈ Table A
- the page-2/3 body equals page 1 (Google returns INVALID_ARGUMENT otherwise; M49)
- the effect of `regionCode` on `formattedAddress` (the gap that hides B-CR-01)

The mock accepts more than Google does.

**Fix:** Return 501 when no route matches; tests that want an empty page should route to `PLACES_PAGES.empty` explicitly. Validate every invariant `request.ts` fixes, and record page 1's body per token so pages 2/3 can be compared against it. Once B-CR-01 is fixed, drop `, USA` from the domestic fixtures.

## Info

### B-IN-01: The known accented-city SAB miss is the only instance

**File:** `src/lib/places/candidates.ts:145`

**Issue:** Confirmed that the SAB trigram arm's `lower(b.city) = ${queriedCityLower}` is the only place a folded TypeScript value is compared with an unfolded column. `scoreSab` folds both sides (`match.ts:174`). So Peñitas: `'peñitas' ≠ 'penitas'`. The same line also misses multiple-space variants, because `queriedCityOf` collapses whitespace and `lower()` does not.

**Fix:** When the deferred item is picked up, add a folded `city_key` column written by the normalizer, and compare against that.

### B-IN-02: `decide` silently drops a third ≥95 candidate, and a later search in the same run can downgrade an attachment

**File:** `src/lib/places/match.ts:196-223`, `drizzle/0029_places_writers.sql:234-238`

**Issue:** A three-way collision carries only the top two as a tie, and the third business is never recorded. Also, the attachment upsert means the last search wins within a run. A place seen by two type searches that score it differently (for example with a different cluster point) can go from `attached` back to `tentative`.

**Fix:** Carry every candidate at or above the threshold into the tie. In the writer, keep the higher status within one run (`last_seen_run_id = excluded.last_seen_run_id and rank(excluded) < rank(existing)` → keep the existing status).

### B-IN-03: One unparseable place fails the whole run; a 2xx that isn't 200 is released

**File:** `src/lib/places/search-tile.ts:371-375`, `src/lib/places/response.ts:23-37`

**Issue:** A single place that fails `PlaceSchema` (for example `id` missing) turns the page into `bad_shape`, which becomes `FatalError`, so the entire run fails. `settle(out.status === 200)` releases any other 2xx, even though a request that got a 2xx was probably billed.

**Fix:** Consider dropping malformed places one at a time (counted), rather than failing the run. Charge any `2xx` status.

### B-IN-04: The workflow seed takes the change-check admission hold on the wrong SKU

**File:** `tests/workflow/_seed.ts:108`

**Issue:** The seed always reserves `'ts_enterprise'`, but `queueRun` holds a change check on `'ts_essentials'` (`queue-run.ts:224`). The fixture is looser than the real caller, so the release-at-begin proof never runs against an Essentials hold.

**Fix:** Pass `kind === 'change_check' ? 'ts_essentials' : 'ts_enterprise'`.

### B-IN-05: Two constants named `DEFAULT_RETRY_AFTER_MS` with different meanings

**File:** `src/lib/places/client.ts:43` (60 s, per-minute 429), `src/workflows/places-sweep/steps.ts:58` (2 s, everything else)

**Fix:** Rename them (`RATE_LIMIT_DEFAULT_WAIT_MS` / `TRANSIENT_RETRY_WAIT_MS`).

### B-IN-06: Setting `PLACES_MODE` to `off` does not stop a run already in flight

**File:** `src/workflows/places-sweep/steps.ts:311,320`

**Issue:** Steps read `env.PLACES_MODE` from the deployment the workflow run is pinned to. Setting it to `off` and redeploying affects new runs only. The in-flight kill lever is the run row's status (Pitfall 5), and the code handles that correctly.

**Fix:** State in the runbook that turning Places off requires failing the active run as well as the env edit.

### B-IN-07: A spent cap blocks the free change check

**File:** `src/lib/places/meter.ts:137-140`

**Issue:** An Essentials page still holds 1 µUSD, and `reserve_budget` refuses it once `spent == cap`. A free IDs-only check then stops with `budget_cap_reached` for the rest of the month.

**Fix:** Decide deliberately. Either exempt zero-priced SKUs from the cap check (keeping the ledger row), or document the behaviour on the preset page.

---

_Reviewed: 2026-09-24T12:34:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard + cross-file contracts_
