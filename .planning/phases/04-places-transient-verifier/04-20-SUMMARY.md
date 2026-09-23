---
phase: 04-places-transient-verifier
plan: 20
subsystem: run-report
tags: [places, run-report, query, rls, d-17, criterion-3, place-03, place-04]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-07 RunKind / StoppedReason / STOPPED_REASONS; 04-09 run_searches, run_place_outcomes, place_attachments, place_observations + runs extension; 04-11 app.plan_run_searches / app.mark_run_search; 04-15 app.record_places_page / app.record_change_check / toPageRecord; 04-16 the meter (reserve_budget + settle_reservation, units 1 per request)"
  - phase: 02-search-presets-budget
    provides: "readCurrentPeriod, rowsOf, Tx, cost_ledger, periodResetInstant"
provides:
  - "src/server/queries/run-report.ts: RunReport, TextSearchSkuRow, TruncatedWhy, readRunReport(tx, runId), getRunReport(claims, runId)"
  - "tests/db/places-run-report.test.ts: 7 named DB proofs seeded only through the real writers"
affects: [04-23, 04-32]

tech-stack:
  added: []
  patterns:
    - "Static structure via values / unnest(cluster_ids) + left join lateral: every SKU, every version cluster and every host class exists at zero"
    - "Producer→consumer DB test: the consumer query is fed rows from the shipped definers, never hand-inserted Places rows"

key-files:
  created:
    - src/server/queries/run-report.ts
    - tests/db/places-run-report.test.ts
  modified: []

key-decisions:
  - "Run-wide attached / tentative / unmatched count each found place once, at its BEST outcome across clusters, so the three always sum to found; per-cluster counts are per (place, cluster)"
  - "requests and freeThisMonth are sum(units), not count(*): the same unit readUnitsUsedThisPeriod counts the free allowance in (identical at units 1)"
  - "totalRequests = every ledgered request of the run + refusedByMeter — the UI-SPEC Requests card's Total row (68 + 1 = 69)"
  - "capMicroUsd / capResetMs are the CURRENT month's places period (readCurrentPeriod, as the plan's interfaces say), read only after the run is found, so a foreign id never touches the budget"
  - "A malformed run id returns null before any SQL (a 22P02 would abort the caller's transaction)"
  - "An unknown stopped_reason narrows to null rather than being cast; a cluster id that resolves to no visible cluster throws instead of dropping a coverage-gap row"

requirements-completed: [PLACE-03, PLACE-04]

duration: ~40min
completed: 2026-09-23
---

# Phase 4 Plan 20: The run report's data layer Summary

**`readRunReport` reads every number `/runs/[id]` shows in one tenant-scoped transaction. That covers the ledger by SKU, tiles and still-truncated tiles, per-cluster outcomes with zero rows, the attached-only website split, and change-check verdicts. It is proven against rows written by the real Places writers, never by hand-inserted fixtures.**

## Performance

- **Duration:** about 40 min
- **Tasks:** 2, as 2 commits
- **Files:** 2 created

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `033079e` | feat(04-20): the run report's one-transaction data layer |
| 2 | `f3393ad` | test(04-20): prove the run report against the writer's real rows |

## Exported API (04-23 renders this)

```ts
// src/server/queries/run-report.ts ('server-only')
export type TextSearchSkuRow = 'ts_enterprise' | 'ts_essentials';
export type TruncatedWhy = 'max_depth' | 'min_size' | 'novelty';
export type RunReport = {
  run: { id: string; status: RunStatus; stoppedReason: StoppedReason | null; kind: RunKind;
         partitionIndex: number | null; presetId: string; presetName: string; versionNumber: number;
         createdMs: number; startedMs: number | null; finishedMs: number | null;
         costMicroUsd: number; callsCount: number;
         estimateRequestsLo: number | null; estimateRequestsHi: number | null;
         estimateMicroUsdLo: number | null; estimateMicroUsdHi: number | null;
         ceilingRequests: number; capMicroUsd: number; capResetMs: number };
  requests: { rows: Array<{ sku: TextSearchSkuRow; requests: number; freeThisMonth: number; costMicroUsd: number }>;
              refusedByMeter: number; totalRequests: number; totalMicroUsd: number };
  tiles: { total: number; searched: number; saturated: number; subdivided: number; stillTruncated: number;
           truncated: Array<{ tileKey: string; cellKey: string; placesType: string; why: TruncatedWhy | null }>;
           stillSubdividing: Array<{ tileKey: string; cellKey: string; placesType: string }> };
  outcomes: { found: number; attached: number; tentative: number; unmatched: number;
              byCluster: Array<{ clusterKey: string; displayName: string; found: number; attached: number; tentative: number; unmatched: number }>;
              website: { listed: number; none: number; byHostClass: Record<Exclude<HostClass, 'none'>, number> } };
  changes: { checked: number; unchanged: number; withNew: number; withGone: number;
             newIds: number; goneIds: number; changedTiles: number } | null;
};
export async function readRunReport(tx: Tx, runId: string): Promise<RunReport | null>;
export async function getRunReport(claims: OrgClaims, runId: string): Promise<RunReport | null>;
```

**What the consumer can rely on:**
- **`null`** is returned for a foreign run, an unknown run, or a malformed id. A malformed id returns before any SQL.
- **`requests.rows`** is always two rows, Enterprise first, even when both are zero.
- **`refusedByMeter`** is 1 exactly when `stoppedReason === 'budget_cap_reached'`. `totalRequests` already includes it.
- **`costMicroUsd`** is `sum(cost_ledger.micro_usd)` for the run, so it moves while the run is live. It equals `totalMicroUsd`.
- **`tiles.stillSubdividing`** is empty while the run is `queued` or `running`. When the run is terminal it lists the searches still `planned` or `searching`, ordered by tile key.
- **`tiles.truncated`** lists every search with `truncated = true`, ordered by tile key. `stillTruncated` equals its length.
- **`outcomes.byCluster`** has one row per cluster in the run's version, zeros included, ordered by `industry_clusters.sort_order`.
- **`outcomes.website`**:
  - It counts this run's observations whose attachment is currently `attached`.
  - `byHostClass` always has all five keys.
  - `listed` is their sum.
- **`changes`** is non-null only when `kind === 'change_check'`.
- **Money and instants are JS numbers.** A value that is not a safe integer throws; it is never rounded.

## Verification

### Gates (HEAD `f3393ad`, branch `worktree-agent-a8ccb1cd6cb1e91c0`, printed after the gates)

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: exit 0. The `--ignore-pattern ".claude/**"` form was refused by the worktree sandbox, so the directory form was used.
- `prettier --check --end-of-line auto` is clean on both files.
- `npx vitest run tests/unit`: **69 files, 515 tests passed**
- Full `vitest.db.config.ts` suite: **36 files, 314 tests passed**, exit 0, in 125s. No cross-plan noise.
- `places-run-report.test.ts` + `run-report.test.ts` run together, read by name: all 7 new `run report …` tests pass. The 3 existing `/sources` tests (`run report`, `run report survives a failed run`, `two zones`) also pass.

### Acceptance greps

- `grep -n "left join lateral\|from (values"` matches 5 lines (both `values` lists and three laterals).
- `grep -n "insert into place_\|insert into run_place_outcomes\|insert into run_searches" tests/db/places-run-report.test.ts` finds nothing (exit 1).
- `grep -c "withOrg"` returns **2**, not 1. The two lines are the import and the single call in `getRunReport`. The report opens exactly one transaction; the criterion's literal count cannot be met while the function is imported.

### Mutations (each applied to `run-report.ts`, run through the whole file, failing test read by NAME, reverted, `git diff` clean)

| # | Mutation | Red test | Evidence |
|---|----------|----------|----------|
| R1 (the plan's RED) | `stillTruncated` counts `rs.saturated` | **run report counts truncated tiles** (also the ceiling test) | `stillTruncated` expected 2, received 3 |
| R2 | website split `pa.status = 'attached'` → `is not null` | **run report splits the website signal over attached listings only** | `listed` expected 1, received 2 |
| R3 | clusters limited to those with outcomes (`and exists (…)`) | **run report counts outcomes per cluster with zero rows included** | 1 row received, 2 expected |
| R4 | `stillSubdividing` terminal gate removed | **run report lists tiles still subdividing when a run stopped at the ceiling** | expected `[]` while running, received 2 rows |

The RED gate was taken by mutation. Task 1 (the query) comes before Task 2 (the tests) in the plan, so the query existed when the tests were written. R1 is exactly the plan's suggested failure: count `saturated` instead.

**Not mutation-killable, and why:** removing the explicit `org_id = app.current_org_id()` predicates leaves "run report is tenant-scoped" green. RLS on every table read does the same job, and that test proves RLS through the `authenticated` role. The predicates are defence in depth, the same arrangement `/sources` uses.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] A malformed run id returns null instead of raising 22P02**
- **Found during:** Task 1
- **Issue:** `${runId}::uuid` on a non-uuid raises 22P02, which aborts the caller's whole transaction. The plan says an unknown id is `null`.
- **Fix:** A UUID regex guard runs before any SQL. It is asserted in the tenant-scoped test.
- **Commit:** `033079e`

**2. [Rule 1 - Type honesty] `truncated[].why` is `TruncatedWhy | null`, not the bare union**
- **Found during:** Task 1
- **Issue:** `app.mark_run_search` can set `truncated = true` without writing `truncated_why`, because each key is applied as `coalesce(new, old)`. The plan's non-null type would claim something the database does not guarantee. Dropping such a row would be exactly the silent partial that criterion 3 forbids.
- **Fix:** The row is listed with `why: null`. UI-SPEC's tile line does not render `why`, so 04-23 is unaffected.
- **Commit:** `033079e`

**3. [Rule 2] `stoppedReason` is narrowed through `STOPPED_REASONS`**
- **Found during:** Task 1
- **Issue:** `runs.stopped_reason` is unconstrained text, so a cast could hand `STOPPED_REASON[key]` an undefined key.
- **Fix:** An unknown key reads as `null`, and the renderer shows nothing for it. `tests/unit/ui-maps.test.ts` already pins every writer's literal to the list.
- **Commit:** `033079e`

**4. [Rule 2] A version cluster that resolves to no readable cluster row throws**
- **Found during:** Task 1
- **Issue:** Dropping that row silently would under-report the D-06 coverage gap.
- **Fix:** The query throws instead.
- **Commit:** `033079e`

**5. [Interpretation] `freeThisMonth` and `requests` are `sum(units)`, not `count(*)` rows**
- **Issue:** The plan says "count of … rows". Every settlement today is units 1 (04-16 `settleInTx`), so the two are identical.
- **Decision:** `sum(units)` is the unit `readUnitsUsedThisPeriod` uses for the free allowance, so the two cannot drift if a settlement ever carries more than one unit.

**6. [Test seeding] The two-cluster fixture is inserted inline**
- **Issue:** `seedPlacesRun` supports only one cluster.
- **Decision:** The per-cluster test inserts its `searches`, `search_versions` and `runs` rows as the owner, inline. The SQL is the same as `seedPlacesRun`'s. None of these is a Places table. `_places-fixtures.ts` was deliberately left alone because parallel plans share it.

## Threat surface

- **T-4-06:** one transaction, RLS on every table read, and an explicit org predicate on every statement. "run report is tenant-scoped" proves another org's run returns `null` through the `authenticated` role, after a positive control as the owning org.
- **T-4-04:** `place_coordinates` is never referenced.
- **T-4-05:** the query reads only counts, enums, keys and our own names (`searches.display_name`, `industry_clusters.display_name`).

No new surface beyond the plan's threat model.

## Merge notes

- The plan touches only two new files; no shared file was modified, so no conflict is expected with the other wave-4 plans.
- 04-23 imports `getRunReport` and `RunReport` from `@/server/queries/run-report`. Two types are widened from the plan's contract: `truncated[].why` includes `null`, and `stoppedReason` is narrowed through `STOPPED_REASONS`.

## Known Stubs

None.

## Self-Check: PASSED

- `src/server/queries/run-report.ts`: FOUND
- `tests/db/places-run-report.test.ts`: FOUND
- Commit `033079e`: FOUND
- Commit `f3393ad`: FOUND
