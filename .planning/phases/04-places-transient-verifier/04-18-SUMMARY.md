---
phase: 04-places-transient-verifier
plan: 18
subsystem: places-sweep
tags: [places, workflow-step, meter, matcher, tiling, msw, legal, criterion-5, place-01, place-02, place-03, place-05]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-03 hostClass; 04-05 tiling + reducer; 04-06 matcher + candidate query; 04-09 fixtures; 04-10 msw Places replay; 04-11 plan_run_searches / mark_run_search; 04-12 client + request builder; 04-15 toPageRecord + record_places_page; 04-16 meter + withWorkerOrg"
provides:
  - "src/lib/places/search-tile.ts: SweepInput, TileStepResult, queriedCityOf, runSearchTile"
  - "tests/db/places-search-tile.test.ts: 13 named DB proofs against the msw replay"
affects: [04-19, 04-22, 04-28]

tech-stack:
  added: []
  patterns:
    - "Per page: reserve (own tx) -> HTTP call with no tx open -> derive in memory -> settle + match + record in ONE tx"
    - "Request-time assertion: an msw hook reads the DB on the test's own connection while the request is in flight"
    - "Sentinel scan with a positive control (the same scan finds the spine name in businesses) and a before/after row diff"

key-files:
  created:
    - src/lib/places/search-tile.ts
    - tests/db/places-search-tile.test.ts
  modified:
    - tests/unit/msw/fixtures/places-match-page.json
    - tests/unit/msw/fixtures/README.md

key-decisions:
  - "bad_shape is settled charged only when the status was 200 (04-12's rule) and fails NON-retryable: a body we could not parse will not parse better on a retry"
  - "Only a blockable phone is sent as a candidate probe's phone (B1 already requires the business side blockable)"
  - "The novelty overlap reads the parent tile's CURRENT members (gone_at is null), org-filtered explicitly as well as by RLS"
  - "A stop (cap, ceiling, daily quota) does not move the search's status; the reducer keeps it pending and 04-22's finishRun reports it"
  - "synthetic-match-tentative renamed 'Ortiz Plumbing and Drain' -> 'Ortiz Plumbing TX' (the one permitted adjustment): score 74 -> 82"

requirements-completed: [PLACE-01, PLACE-02, PLACE-03, PLACE-05]

duration: ~45min
completed: 2026-09-23
---

# Phase 4 Plan 18: One Enterprise tile search Summary

**`runSearchTile` runs one `(Places type × tile)` Enterprise search of up to 3 pages. Each page is reserved at the meter before the request leaves. The request is made with no transaction open. The response is reduced to match keys and derived flags in memory. The attempt is then settled, matched and recorded in one transaction. The step returns only ids, counts, rects and enums. All of this is proven against the msw replay through the real meter, matcher, candidate query and writers.**

## Performance

- **Duration:** about 45 min (20:35Z to 21:20Z)
- **Tasks:** 2, 2 commits
- **Files:** 2 created, 2 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `344749c` | feat(04-18): runSearchTile - one Enterprise tile search, reserve before call |
| 2 | `86b5361` | test(04-18): DB-lane proofs for the tile search against msw |

## The exported contract (04-22 wraps it in a step; 04-19 imports the types)

```ts
// src/lib/places/search-tile.ts  ('server-only')
export type SweepInput = { runId: string; clerkOrgId: string };
export type TileStepResult =
  | SearchResult                                    // src/workflows/places-sweep/reducer.ts
  | { kind: 'fail'; tileKey: string; reason: FailReason; retryable: boolean; retryAfterMs?: number };
export function queriedCityOf(search: TileSpec): string | null;
export async function runSearchTile(
  input: SweepInput,
  search: PlannedSearch,
  deps: { mode: PlacesMode; shapes: GeoShapesFile },
): Promise<TileStepResult>;
```

**Outcome table:**

| Outcome | Ledger / reservation | Return |
|---|---|---|
| `reservePage` → `stop` | nothing reserved | `stopped / budget_cap_reached \| exceeded_estimate` |
| `reservePage` → `not_running` | nothing | `fail / places_unavailable`, non-retryable |
| `refused / places_key_missing` | nothing (before any SQL) | `fail / places_key_missing`, non-retryable |
| `refused / places_off \| mode_forbids_sku` | nothing | `fail / places_request_rejected`, non-retryable |
| 200 | settled charged, same tx as the page write | continues; `searched` at the end |
| 429 daily | released, no ledger row | `stopped / google_daily_quota` (D-19) |
| 429 per-minute | released | `fail / places_unavailable`, retryable, `retryAfterMs` |
| 5xx | released | `fail / places_unavailable`, retryable |
| 400 | released | `fail / places_request_rejected`, non-retryable |
| `no_key` | released | `fail / places_key_missing`, non-retryable |
| timeout / transport | **settled charged** (unknown outcome, Pitfall 9) | `fail / places_unavailable`, retryable |
| `bad_shape` | charged iff status 200 | `fail / places_unavailable`, non-retryable |

- An `ids_only` search throws `runSearchTile: an ids_only search is not an Enterprise search`. This is a programming error, not a run outcome.
- Step 0 is `settleInFlight`, so a replayed step settles a crashed attempt as charged before calling again.
- `WorkerOrgMismatch` from the meter propagates as a throw. `failReasonOf` maps it to `places_unavailable`.
- On `subdivide`, the children come back as `PlannedSearch[]`. Their `run_searches` rows are already `planned`, created through `app.plan_run_searches` with a DB-safe `unitId`. In memory, each child keeps its **raw** `unitId` (with U+0000), as the `TileSpec` contract requires.
- The final `mark_run_search` sets `status: 'done'`, `saturated`, `subdivided`, `truncated` and `truncated_why`. That also moves `place_tiles.is_leaf`, `saturated`, `truncated` and `last_swept_*`.

## Verification

### Gates (branch `worktree-agent-ac7f9c619805467b8`, HEAD `86b5361`)

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: exit 0. Prettier is clean on every touched file.
- `npx vitest run tests/unit`: **69 files, 515 tests passed**. The fixture rename changes `PLACES_SENTINELS` but no unit assertion.
- `places-search-tile.test.ts` alone: **13/13**.
- **Full `test:db`** (`npx vitest run --config vitest.db.config.ts --pool=forks --reporter=verbose`): **36 files, 320 tests passed**, exit 0, 141 s. There was no cross-plan noise on this run. The branch and HEAD were printed after the gate and were unchanged.
- The 13 names, read from the full-lane PASS list:
  1. `no places request leaves without a reservation`
  2. `no Places text reaches the database`
  3. `the match page attaches, ties, tentatives and counts`
  4. `a service-area listing is observed with its flag`
  5. `a saturated tile returns its children planned`
  6. `a saturated child that repeats its parent truncates by novelty` (extra)
  7. `every Enterprise page is ledgered with its SKU`
  8. `a daily quota 429 stops the tile and releases its reservation`
  9. `a per-minute 429 asks for a retry`
  10. `a 400 fails the run without retry`
  11. `a timeout is settled as charged`
  12. `a refused reservation ends the tile and sends nothing`
  13. `the step result satisfies the reducer's contract`

### Acceptance greps

- `reservePage` (L319) comes before `searchText(` (L337) in source order.
- `grep -n "console\.\|JSON.stringify(p)\|JSON.stringify(out)"` returns nothing.
- The two `withWorkerOrg(` calls are at L385 (after the call) and L403 (post-loop). Neither wraps `searchText(`.
- `PLACES_SENTINELS` appears in the test at L34, L333 and L660.

### Mutation checks

For each one: applied to `src/lib/places/search-tile.ts`, the file run, the red names read, then reverted with `git checkout -- src/lib/places/search-tile.ts`. `git diff --stat src/` was empty after every revert.

| # | Mutation | Red (exact names, only these) |
|---|---|---|
| **M32** | `searchText` called BEFORE `reservePage` (with a placeholder call carrying the right sku) | `no places request leaves without a reservation` ("expected null not to be null": the hook saw no cursor), and `a refused reservation ends the tile and sends nothing` (a request left before the refusal) |
| **M36** (plan's) | `p.displayName?.text` copied into every match's features as `label` | `no Places text reaches the database`, `the match page attaches…`, `a service-area listing…`, `the step result satisfies the reducer's contract`. Each threw `toPageRecord: feature label is not allow-listed`, and the value was not echoed. |
| M36b | the page transaction's actor set to `workflow:<first displayName>`, which gets text past `toPageRecord` into a GUC | `no Places text reaches the database` only: `{table: 'cost_reservations', hits: ['Ortiz Plumbing']}`, via `updated_by`. This proves the scan itself catches text that reaches a table. |
| Q | daily quota → retryable fail | `a daily quota 429 stops the tile…`, `the step result satisfies the reducer's contract` |
| T | timeout settled NOT charged | `a timeout is settled as charged` |
| O | overlap with the parent never computed | `a saturated child that repeats its parent truncates by novelty` |
| C | queried city forced to null (the SAB city arm dropped) | `the match page attaches, ties, tentatives and counts` |

About M36: the plan's mutation is caught by `toPageRecord` **before** the database, so it proves the refusal, not the scan. M36b was added so that the scan itself is shown to go red. The test also has a positive control: the same scan over `businesses` must find `Ortiz Plumbing`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan-sanctioned fixture adjustment] `synthetic-match-tentative` scored 74, not 80–94**
- **Found during:** Task 2, first run. The near miss came back `unmatched`.
- **Cause:** `nameNorm` drops `and`. pg_trgm then scores `ortiz plumbing drain` against `ortiz plumbing` at 0.714, which gives name 24 + address 30 + distance 15 (24 m) + cluster 5 = 74. The suite is on one side only, so there is no unit conflict. The phone is 555, which is never blockable.
- **Fix:** Renamed the place to `Ortiz Plumbing TX`. Its similarity is 0.833, just under the 0.85 name-signal bar, so the pair still has two signals and cannot merge. The score is 32 + 30 + 15 + 5 = **82**. Nothing else in the record changed. The score is pinned as `NEAR_MISS_SCORE = 82`, and the README explains why. The sidecar count stays 7.
- **Files:** tests/unit/msw/fixtures/places-match-page.json, tests/unit/msw/fixtures/README.md
- **Commit:** `86b5361`

**2. [Rule 2 - Missing proof] One extra test and one extra mutation**
- `a saturated child that repeats its parent truncates by novelty`: without it, `overlapWithParent` had no test, and mutation O would have survived.
- M36b: explained under Mutation checks.

**3. [Choice within the plan's latitude] Small behaviours the plan left open**
- `bad_shape` is charged only when the status was 200, and it is non-retryable.
- Candidate probes carry a phone only when it is blockable.
- The overlap counts only the parent's current members (`gone_at is null`).

### Process notes

- **Commands:** used `npx vitest …`, `npx tsc`, `npx eslint` directly, per the Windows notes.
- **Similarity probe:** the numbers were measured with a short scratch script in the gitignored `coverage/`, deleted before commit, and one `node -e` query against the local test DB (read-only `select similarity(...)`).
- **TDD:** Task 2 is `tdd="true"`, but the plan orders its subject (Task 1) first. So the RED gate is the mutation table: each guard was watched red by name and then reverted.

**Total deviations:** 1 plan-sanctioned fixture adjustment, 1 Rule 2 addition (proof only), and 3 documented choices. No architectural change, no migration.

## Merge notes

- **Files:** 2 new files. The fixture edit is one line (`displayName.text` of `synthetic-match-tentative`). The README edit is its table row plus a new paragraph; prettier re-padded the Places table.
- **04-19 (same wave):** import `SweepInput` / `TileStepResult` from `search-tile.ts`. 04-22 dedupes them.
- **04-22:**
  - `searchTile` step: `r.kind === 'fail'` → `r.retryable ? RetryableError(r.reason, { retryAfter: r.retryAfterMs ?? … }) : FatalError(r.reason)`.
  - Load the shapes in the step, never in the workflow body.
- **U+0000 in step returns:** a subdivided result's children carry the RAW `unitId` (`'48215\u0000McAllen'`). It survives `JSON.stringify` → `JSON.parse` (asserted in the contract test). But a workflow world that stores step returns as Postgres `jsonb` would refuse it. 04-22's `beginRun` has the same shape, so check the world's event storage once there.
- **DB:** no migration. The local journal is unchanged at 30. Tests roll back, so nothing was committed to the shared DB.
- Nothing was pushed, production was not touched, and no Google call was made (msw `onUnhandledRequest: 'error'`).

## Known Stubs

None. `runSearchTile` has no production caller yet by design: 04-22's `searchTile` step is the first.

## Threat Flags

None beyond the plan's threat model:
- **T-4-05:** derived-only record, no logging, return value scanned, eleven-table scan; M36 and M36b.
- **T-4-02:** reserve before every page (M32), daily quota stops (Q), timeout charged (T).
- **T-4-06:** every transaction goes through `withWorkerOrg`, and the overlap query is org-filtered.
- **T-4-10:** candidates come from one jsonb-bound statement, with the threshold set via `similarityThresholdSql()` first.

## TDD Gate Compliance

- Task 1 (`feat`) came before Task 2 (`test`), as the plan orders. The Task 2 RED gate is the seven mutations above. Each went red on its named test and was reverted, and `git diff --stat src/` was empty after each.

## Self-Check: PASSED

- FOUND: src/lib/places/search-tile.ts, tests/db/places-search-tile.test.ts, tests/unit/msw/fixtures/places-match-page.json (modified), tests/unit/msw/fixtures/README.md (modified)
- FOUND commits: 344749c, 86b5361
