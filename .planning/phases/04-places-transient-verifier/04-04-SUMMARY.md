---
phase: 04-places-transient-verifier
plan: 04
subsystem: estimate / seed
tags: [places, place-types, estimate, cost-model, D-18, D-15, M48]
requires: []
provides:
  - "PLACES_TABLE_A / isTableAType (src/lib/places/place-types.ts)"
  - "type-aware estimatePreset(spec, ctx, { onlyCells }) with EstimateRange.typeSearches"
  - "RUN_CEILING_MULTIPLIER, RUN_NEVER_STARTED_AFTER_MINUTES, RUN_ABANDONED_AFTER_MINUTES"
  - "CELL_KEY_SEP, cellKey(clusterKey, unitId), placesTypesFor(clusterKey, seed)"
  - "SeedTables.clusters"
affects: [04-12, 04-13, 04-03, 04-26, 04-27, preset screens, queue-run admission]
tech-stack:
  added: []
  patterns: ["published external table committed as data with source URL + fetch date (like price-book.ts)"]
key-files:
  created:
    - src/lib/places/place-types.ts
    - tests/unit/place-types.test.ts
  modified:
    - src/seed/data/clusters.json
    - src/lib/estimate/assumptions.ts
    - src/lib/estimate/estimate.ts
    - src/lib/estimate/expand-cells.ts
    - src/server/queries/presets.ts
    - tests/unit/estimate.test.ts
    - tests/unit/stale-estimate.test.tsx
decisions:
  - "general_contractor removed from home_services (Table B only); 26 seeded types, all Table A"
  - "The estimate is type-aware (D-18): requestsHi = Σ placesTypes × PAGES_HI × FAN_OUT; the RGV baseline is 3,978 requests high and is refused at admission against the $50 cap"
  - "estimateRangeSchema requires typeSearches, so estimate snapshots written by the per-cell model read as absent"
metrics:
  duration: "~25 min"
  completed: 2026-09-23
  tasks: 2
  files: 9
---

# Phase 4 Plan 04: Table A type validation and the type-aware estimate. Summary

All 26 seeded Places types are now checked against a committed snapshot of Google's Table A (478 types), which removed the Table B-only `general_contractor`. The estimator now counts each cell's Places types (D-18), so the RGV baseline moves from 612 to 3,978 requests high. The run ceiling constant `RUN_CEILING_MULTIPLIER = 2` now sits beside `FAN_OUT`.

## What was built

**Task 1: Table A snapshot, validity test, corrected seed**
- `src/lib/places/place-types.ts`. I fetched the raw HTML of the place-types page into the session scratchpad ("Last updated 2026-09-17 UTC", fetched 2026-09-23) and parsed every `<code>` cell of `<table id="place-types">`: **Table A = 478, Table B = 36, disjoint**, which matches 04-RESEARCH. The types are committed sorted, one per line, as `PLACES_TABLE_A: ReadonlySet<string>` plus `isTableAType()`. The URL appears only on a comment line.
- `tests/unit/place-types.test.ts` has two tests. "every placesTypes entry is a Table A type" reports the failures as `cluster: type` strings. "the Table A snapshot is the published table" checks size 478, `plumber`, `roofing_contractor`, `hair_salon` and `car_repair`, and that `general_contractor` is absent.
- `clusters.json`: `general_contractor` is removed and every `placesTypesNote` is replaced with the plan's text. `outlet-counts.test.ts` stays green unchanged because the new note still contains "Phase 4 validates every type". The seed now has 6 + 6 + 7 + 7 = 26 types.

**Task 2: type-aware estimate, ceiling constant, cellKey**
- `assumptions.ts`:
  - adds `RUN_CEILING_MULTIPLIER = 2`, `RUN_NEVER_STARTED_AFTER_MINUTES = 15` and `RUN_ABANDONED_AFTER_MINUTES = 30`, with the plan's doc text;
  - re-documents `FAN_OUT` as tiles per (cell × Places type), still UNMEASURED BY DESIGN.
- `expand-cells.ts`:
  - `SeedTables` gains `clusters: ClustersFile`;
  - exports `CELL_KEY_SEP = '\u0000'` (`SEP` is kept as an alias) and `cellKey(clusterKey, unitId)`;
  - exports `placesTypesFor(clusterKey, seed)`, which throws with the key's name if the cluster isn't seeded.
- `estimate.ts`: `estimatePreset(spec, ctx, opts?: { onlyCells })` filters the cells first, then:
  - `typeSearches = Σ placesTypesFor(...).length`;
  - `requestsLo = ceil(typeSearches × PAGES_LO)`;
  - `requestsHi = ceil(typeSearches × PAGES_HI × FAN_OUT)`.
  `typeSearches` is added to `EstimateRange`. The free allowance and the percentage calculation are unchanged.
- `presets.ts`: `clusters.json` is added to `SEED`, and `typeSearches` is added to `estimateRangeSchema` (see deviation 2).

### Re-pinned cost model (every number checked by hand against the seed)

| Test | Old | New | Derivation |
|---|---|---|---|
| RGV baseline (free exhausted) | 68 cells, 204 / 612, 7.14M / 21.42M µUSD, ≤ cap | 68 cells, **442** type searches, **442 / 3978**, **15,470,000 / 139,230,000** µUSD, **> cap** | 17 cities × 26 types = 442; × 9 = 3978; × 35,000 |
| RGV counties | 16 cells, 144, 5,040,000 | 16 cells, 104 type searches, **936**, **32,760,000** | 4 × 26 × 9; × 35,000 |
| Texas | 9144, 285,040,000 | **59,436**, **2,045,260,000** | 254 × 26 × 9; (59,436 − 1,000) × 35,000 |
| Free allowance, early month | 612 → $0.00 | 3978 → **104,230,000** | (3978 − 1000) × 35,000 |
| Free allowance, exhausted | 21,420,000 | **139,230,000** | 3978 × 35,000 |
| Texas multiplier | 9144 / 612 | **59436 / 3978** (still 14.9) | both equal 254/17 exactly |
| NEW McAllen × home services | n/a | 1 cell, 6 type searches, 54 requests high, $0.00 early, ceiling ceil(2 × 54) = 108; 1,890,000 once the free allowance is spent | 6 × 9 |
| NEW subset (home_services only) | n/a | 17 cells, 102 type searches, **918** | 17 × 6 × 9 |
| NEW cellKey | n/a | `cellKey('home_services', '48215\u0000McAllen') === 'home_services\u000048215\u0000McAllen'` | n/a |

Every one of the planner's numbers matched the seed; I changed none of them.

## TDD gate record

**RED 1, M48's target** (commit `80b19bf`, before the seed edit):
```
 × tests/unit/place-types.test.ts > Places type validity > every placesTypes entry is a Table A type
   → expected [ 'home_services: general_contractor' ] to deeply equal []
 ✓ tests/unit/place-types.test.ts > Places type validity > the Table A snapshot is the published table
 Tests  1 failed | 1 passed (2)
```
GREEN 1 (`7f2d32a`): place-types 2/2, outlet-counts 3/3 and no-network 1/1, all passing.

**RED 2a, the new pins against the old per-cell code** (commit `9d623b2`): 8 of 13 red. The baseline, counties and McAllen tests fail with `expected undefined to be 442/104/6` because `typeSearches` doesn't exist yet. Texas fails with `expected 9144 to be 59436`, free allowance with `expected 612 to be 3978`, subset with `expected 68 to be 17`, cellKey with `cellKey is not a function`, and pct with `expected 42.84 to be close to 278.46`. `texas multiplier` stays green on the old code because the ratio is 254/17 under both models; its literal was re-pinned for readability.

**RED 2b, the old 612-pinned test file (clusters added to SEED only) against the new code**, as the plan requires:
```
 × cost model: the RGV baseline priced over the real seeded cell list   → expected 442 to be 204
 × cost model: the RGV county baseline                                   → expected 936 to be 144
 × cost model: Texas exceeds the cap and says so                         → expected 59436 to be 9144
 × free allowance: 68 requests                                           → expected 3978 to be 612
 × estimate: percent of remaining budget never divides by zero           → expected 104230000 to be +0
 Tests  5 failed | 5 passed (10)
```
I then restored the committed test file with `git checkout -- tests/unit/estimate.test.ts` and confirmed an empty diff.

GREEN 2 (`6d1c4b7`): estimate.test.ts 13/13 passing.

## Mutation checks (each applied, the named test seen red, reverted, diff confirmed clean)

| ID | Mutation | Named test red | Reverted |
|---|---|---|---|
| **M48** | restore `"general_contractor"` in home_services | `every placesTypes entry is a Table A type` → `expected [ 'home_services: general_contractor' ] to deeply equal []` | `git checkout -- src/seed/data/clusters.json`, diff empty |
| extra | `requestsHi` back to `cellCount × PAGES_HI × FAN_OUT` | `cost model: the RGV baseline…` (612≠3978), `RGV county baseline` (144≠936), `Texas…` (9144≠59436), `McAllen × home services…` (9≠54) | Edit back; `git diff` shows the intended lines only |
| extra | ignore `onlyCells` | `the estimate can price a subset of cells` → `expected 68 to be 17` | Edit back; diff confirmed |

## Gates

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: exit 0. I used explicit directories because the sandbox refused the `--ignore-pattern ".claude/**"` form. The scope is the same, since it excludes the other worktrees.
- `npx vitest run tests/unit`: **47 files, 345 tests, all passing**
- DB lane: not run. No `tests/db` file reads `EstimateRange`, `SeedTables` or the estimate numbers, and this plan touches no schema or migration.
- Prettier: new and changed code is formatted. The remaining `--check` warnings are CRLF working-copy line endings plus pre-existing long-line issues on lines this plan did not touch (estimate.ts L15/L162, presets.ts L351, stale-estimate.test.tsx L211). The `verify` script has no prettier step.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's test said `PLACES_TABLE_A.length === 478`, but the export is a `ReadonlySet`**
- **Found during:** Task 1
- **Fix:** the test asserts `PLACES_TABLE_A.size === 478`. A Set has no `.length`, and a test written that way would compare `undefined`.
- **Commit:** 80b19bf

**2. [Rule 3 - Blocking] `estimateRangeSchema` is a `z.strictObject` that mirrors `EstimateRange`**
- **Found during:** Task 2
- **Issue:** adding `typeSearches` to `EstimateRange` without adding it to the schema would compile, because `toStoredEstimate` spreads the range. But `fromStoredEstimate`'s strict parse would then reject every NEW snapshot (unknown key), so every preset card's stored estimate would silently disappear.
- **Fix:** `typeSearches: z.number()` is now required in `estimateRangeSchema` (the stored schema spreads it). Consequence: snapshots written before D-18 have no `typeSearches`, fail the parse, and read as absent. That follows the function's documented contract ("an unreadable one is simply absent"), and it's the right outcome, because their request figures came from the per-cell model.
- **Files modified:** src/server/queries/presets.ts
- **Commit:** 6d1c4b7

**3. [Rule 3 - Blocking] `tests/unit/stale-estimate.test.tsx` builds a literal `EstimateRange`**
- **Fix:** added `typeSearches: 204` to its fixture so `tsc` passes. That test's `requestsHi: 612` is an arbitrary UI fixture, not a cost-model pin, so I left it alone.
- **Commit:** 6d1c4b7

**4. [Rule 1 - Test correctness] One test the plan didn't list broke on the new numbers: "estimate: percent of remaining budget never divides by zero"**
- **Issue:** its "free estimate at a spent-out cap is 0, not 100" check used the RGV baseline, which no longer fits in the free 1,000 (104,230,000 µUSD early in the month).
- **Fix:** that half now uses `RGV_COUNTIES_SPEC` (936 requests, so still $0.00), which keeps the check that catches a blanket "return 100". The other half is re-pinned to `(100 × 139_230_000) / CAP`.
- **Commit:** 9d623b2

**5. [Plan inconsistency, not changed] The acceptance check `grep -c "general_contractor" clusters.json` returns 0, but the plan's own note text says "general_contractor was removed"**
- I kept the note exactly as the plan wrote it, which puts four bare mentions in note lines. The stricter check, `grep -c '"general_contractor"'` (the JSON string value), returns **0**, and the Table A test enforces the real condition.

**Additions beyond the literal behavior block (not deviations):** the McAllen test also checks the free-exhausted cost (1,890,000), so a $0 result can't pass on a calculation that returns zero for everything. The subset test also checks that no filter still prices 3978. The cellKey test also checks a real `expandCells` cell.

## 🔴 Flag for danlo (D-18's accepted consequence, not a regression)

- The preset screens now show D-18 numbers. **The RGV baseline estimate is about 3,978 requests: ~$104.23 early in the month and $139.23 once the free 1,000 are spent** (it was 612 requests and $0.00 / $21.42).
- **"Run full sweep" on the RGV baseline will be refused at admission** (it's over the $50 cap). A partition, or one city × one cluster (54 requests, $0.00), fits.
- Estimate snapshots stored before this change won't render on preset cards until the version is re-saved (deviation 2).

## Notes for the orchestrator (merge)

- **e2e risk, `tests/e2e/spend.spec.ts` ("the by-run tab lists a queued run")**: it queues a run from the FIRST preset card, ordered by `updated_at desc`. If that preset is RGV-baseline-sized, D-18 now refuses it at admission and the spec fails. `preset-detail.spec.ts`'s fixture (≤ 2 clusters × 3 cities) still fits. I didn't run e2e here, because it needs the deployed app and Clerk.
- Downstream plans can use `cellKey` / `CELL_KEY_SEP` / `placesTypesFor` / `EstimateOptions.onlyCells` / `RUN_CEILING_MULTIPLIER` / `RUN_NEVER_STARTED_AFTER_MINUTES` / `RUN_ABANDONED_AFTER_MINUTES` as 04-13, 04-26 and 04-27 expect.
- Any other plan that builds a `SeedTables` literal must now include `clusters`. `tsc` will catch it.
- No DB, migration or production changes; nothing pushed.

## Known Stubs

None.

## Threat Flags

None. The only new surface is committed data (the Table A snapshot) and pure arithmetic. T-4-02 (type-aware `ceil` formula, exact-number tests), T-4-10 (Table A snapshot + M48) and T-4-12 (committed ceiling constant) are mitigated as planned.

## Self-Check: PASSED

- FOUND: src/lib/places/place-types.ts, tests/unit/place-types.test.ts, src/seed/data/clusters.json, src/lib/estimate/{assumptions,estimate,expand-cells}.ts, src/server/queries/presets.ts, tests/unit/estimate.test.ts, tests/unit/stale-estimate.test.tsx
- FOUND commits: 80b19bf, 7f2d32a, 9d623b2, 6d1c4b7
