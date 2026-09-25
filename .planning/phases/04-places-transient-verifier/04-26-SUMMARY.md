---
phase: 04-places-transient-verifier
plan: 26
subsystem: run-admission
tags: [workflow-devkit, d-02, d-14, d-15, d-16, d-18, queue-run, run-drawer, e2e-safety, rule-38, rule-39, pitfall-11]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-04 type-aware estimatePreset + RUN_* constants + cellKey; 04-07 run copy; 04-09 runs columns + runs_one_active_per_org; 04-11 app.release_reservation; 04-13 cellsForRun / missingGeometry; 04-22 placesSweep"
provides:
  - "src/server/actions/queue-run.ts: queueRun({ searchVersionId, kind }) — mode refusal, stale reclaim, planner-sized admission, ceiling, one active run, start(placesSweep) after commit, start-failure release"
  - "src/server/actions/_result.ts: ActionErrorCode 'mode_refused'"
  - "src/components/preset-detail/run-drawer.tsx: RunDrawer kind 'full' | 'partition' | 'check' (+ RunPartition), navigate-on-success, run-mode-refused / run-already-running alerts; RunDrawerKind, RunPartition exported"
  - "src/lib/time.ts: formatWeekRange(mondayIso, sundayIso) — 'Sep 21–27' / 'Sep 28–Oct 4'"
  - "tests/db/queue-run.test.ts: 9 DB-lane proofs incl. 'a confirmed run creates a runs row on the current version' (moved from e2e)"
  - "tests/unit/run-drawer.test.tsx: 4 dom-lane proofs of the drawer's branches"
affects: [04-27, 04-28, 04-31, 04-32, 04-33]

tech-stack:
  added: []
  patterns:
    - "Admission and execution share one clock: cells are planned at the admission transaction's own now(), which is the value runs.created_at defaults to and the instant beginRun plans from"
    - "One-active-run as INSERT … ON CONFLICT (org_id) WHERE status IN ('queued','running') DO NOTHING — a race is the same zero-row 'busy' answer as a sequential second click"
    - "DB-lane action test harness: the withOrg savepoint double resets role + claims on release (a released savepoint keeps SET LOCAL until the outer transaction ends)"

key-files:
  created:
    - tests/db/queue-run.test.ts
    - tests/unit/run-drawer.test.tsx
  modified:
    - src/server/actions/queue-run.ts
    - src/server/actions/_result.ts
    - src/components/preset-detail/run-drawer.tsx
    - src/components/preset-detail/version-history.tsx
    - src/app/(app)/presets/[id]/page.tsx
    - src/app/(app)/presets/page.tsx
    - src/lib/ui/copy.ts
    - src/lib/time.ts
    - tests/unit/ui-maps.test.ts
    - tests/unit/time.test.ts
    - tests/e2e/spend.spec.ts
    - tests/e2e/preset-detail.spec.ts

key-decisions:
  - "One active run is enforced by ON CONFLICT DO NOTHING on runs_one_active_per_org, not select-then-insert + a 23505 catch: the race and the sequential case are one tested path"
  - "Admission plans cells at the transaction's now() (read in SQL), so a run queued at a week boundary prices and executes the same partition"
  - "The stale-run abandon test uses coalesce(heartbeat_at, started_at, created_at): a running row with neither stamp would otherwise hold the slot forever"
  - "A no-geometry refusal names units for people: counties by name ('Anderson County'), at most three then 'N more' — the Texas preset has 250 unshaped counties"
  - "Stamping workflow_run_id after start() is best-effort: once the workflow is running it owns the run, so a failed stamp must not report a started run as failed"
  - "The drawer navigates inside the transition (router.push), so the confirm keeps saying 'Starting…' until the report replaces the page; no toast"

requirements-completed: [PLACE-04, PLACE-01]

duration: ~35min
completed: 2026-09-23
---

# Phase 4 Plan 26: Wire the executor behind the Run button Summary

**The Run button now starts the places-sweep workflow. `queueRun` refuses a mode that forbids the run before anything is written. It reclaims stale runs, then sizes the admission with the same planner the workflow runs: the run's own cells, the type-aware estimate, a stored request ceiling of 2 × requestsHi, and a by-name refusal for units with no outline. It admits one active run per org and calls `start(placesSweep)` only after its transaction commits. If `start()` fails, the hold is released and the run is closed as `never_started`. The drawer runs all three kinds and lands on `/runs/{id}`. The Phase 2 notice is gone. No e2e spec can confirm a run any more. `next build` now registers `placesSweep`.**

## Performance

- **Duration:** about 35 min (22:20Z to 22:57Z)
- **Tasks:** 3 planned, 4 commits (Task 1 is TDD: RED, then GREEN)
- **Files:** 2 created, 12 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | `fa904e6` | test(04-26): add failing DB-lane tests for queueRun admission and start |
| 1 GREEN | `7e10eba` | feat(04-26): queueRun starts the places sweep after a mode-checked, planner-sized admission |
| 2 | `b9e2ce1` | feat(04-26): run drawer runs all three kinds and lands on the report; retire the phase 2 notice |
| 3 | `9b42a6f` | test(04-26): make the e2e suite incapable of starting a run (Rules 38, 39) |

## The contract 04-27 renders

```ts
// src/server/actions/queue-run.ts ('use server')
queueRun(input: { searchVersionId: string /* uuid */; kind?: 'full_sweep' | 'partition' | 'change_check' /* default full_sweep */ })
  : Promise<ActionResult<{ runId: string; reservationId: string; pctAfter: number; at80: boolean }>>
```

| Result | When | `message` | `detail` |
|---|---|---|---|
| `ok` | admitted and `start()` returned | none | `data.runId` is the `runs.id`, and the drawer pushes `/runs/{runId}` |
| `fail('mode_refused')` | `PLACES_MODE` is `off`, or it is `ids_only` and the kind is not `change_check` | `RUN_MODE_REFUSED(mode)` | none |
| `fail('conflict')` | another run is `queued` or `running` in this org | `RUN_ALREADY_IN_PROGRESS` | `{ reason: 'busy', runningRunId }`. `runningRunId` is omitted only if that run finished between the conflict and the read |
| `fail('validation')` | a unit has no outline | `RUN_NO_GEOMETRY(names)` | none |
| `fail('validation')` | the version cannot be priced (inherited) | inherited sentence | none |
| `fail('budget_refused')` | the meter refused (inherited) | `RUN_REFUSED(cap)` | `{ pctAfter }` |
| `fail('not_found')` | the version is not visible to this org | `NOT_FOUND('preset version')` | none |
| `fail('unexpected')` | `start()` threw. The hold is released and the run is `failed / never_started` | `RUN_START_FAILED` | none |
| `fail('unexpected')` | the transaction threw | `UNEXPECTED_ERROR('this run')` | none |

**Drawer (`RunDrawer`)**
- The props are a discriminated union: `kind: 'partition'` requires `partition: RunPartition` (`{ index, isoWeek, mondayIso, sundayIso, cells, totalCells }`, from `isoWeekOf` and `cellsForRun`); `'full'` and `'check'` take no `partition`.
- The trigger is `children`, which the caller renders, so 04-27 keeps `run-preset`, `run-partition` and `run-check-changes` on its own buttons.
- Testids:
  - `run-drawer`, which carries `data-run-kind`
  - `run-estimate`
  - `run-partition-cells`
  - `run-remaining`
  - `run-confirm`
  - `run-dismiss`
  - `run-refused` (unchanged)
  - `run-mode-refused` and `run-mode-refused-reload`. The reload closes the drawer and calls `router.refresh()`.
  - `run-already-running` and `run-already-running-link`. The link goes to `/runs/{runningRunId}`.
  - `run-error` (unchanged)
- Both existing callers pass `kind="full"`. The Run button in the `presets/[id]` title row still reads "Run this preset". **04-27 renames it and adds the other two triggers.**

## What each step of `queueRun` does

1. `requireOrg()` runs first, then the input is parsed.
2. **D-02:** `env.PLACES_MODE` is checked outside any transaction.
3. In one `withOrg` transaction:
   1. **Stale-run reclaim.** A `queued` run older than 15 min becomes `failed / never_started`. A `running` run whose `coalesce(heartbeat_at, started_at, created_at)` is older than 30 min becomes `failed / abandoned`. Both stamp `finished_at`.
   2. The version is read under RLS, together with the transaction's `now()`.
   3. The spec is built through `readReferenceIndex`, `specInputOfVersion` and `resolveSpec`.
   4. `cellsForRun(spec, seed, kind, now)` picks the run's cells.
   5. `missingGeometry` returns `no_geometry` when any unit has no outline.
   6. `estimatePreset(spec, ctx, { onlyCells: key ∈ cellKey set })` prices exactly those cells.
   7. The SKU is `ts_essentials` for a change check (cost 0, hold 1 µUSD) and `ts_enterprise` otherwise (hold = `costHi`, or 1 µUSD when that is 0).
   8. `ceiling = ceil(RUN_CEILING_MULTIPLIER × requestsHi)`.
   9. `insert … on conflict (org_id) where status in ('queued','running') do nothing returning id`. Zero rows means `busy`. The insert writes `kind`, `partition_index`, the four estimate columns, `ceiling_requests` and `requested_by = userId`.
   10. `app.reserve_budget(..., sku)`. A refusal becomes `refused / budget_cap_reached`, as before.
4. After commit, `start(placesSweep, [{ runId, clerkOrgId: orgId }])`. `orgId` is Clerk's `o.id` from `requireOrg()`.
5. The workflow run id is stamped into `runs.workflow_run_id` on a best-effort basis.

## Verification

### Gates (branch `worktree-agent-af59d29a24e907689`, HEAD `9b42a6f`; printed after the final build)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint . --ignore-pattern ".claude/**"` | exit 0 |
| Unit lane `npx vitest run tests/unit`, run after the build | **79 files, 605 tests passed** |
| Full DB lane (`vitest.db.config.ts --pool=forks`) | **42 files, 375 tests passed**, 91 s |
| Workflow lane (`vitest.workflow.config.ts`) | **2 files, 13 tests passed**, 69 s |
| `npx next build` | exit 0. The build line, verbatim: **`workflows build complete (8 steps, 1 workflow, time 66ms)`**. Before this plan it was `3 steps, 0 workflows` (04-22). |
| Prettier on new or changed code | clean. The remaining warnings in `copy.ts`, `presets/[id]/page.tsx`, `version-history.tsx` and `preset-detail.spec.ts` are on lines this plan did not touch; I checked each diff. |

**Manifest proof, Pitfall 11 (closed).** `src/app/.well-known/workflow/v1/manifest.json` (generated and gitignored):
```
37:      "placesSweep": {
38:        "workflowId": "workflow//./src/workflows/places-sweep/workflow//placesSweep",
```
`workflows` = `{"src/workflows/places-sweep/workflow.ts":["placesSweep"]}`, so `placesSweep` is the only registered workflow (T-4-14). Discovery followed the import from `queue-run.ts`, which the drawer reaches from the preset pages. No explicit `withWorkflow` registration was needed.

**DB-lane PASS list (`tests/db/queue-run.test.ts`, names read from the verbose output).** All nine planned tests:
- `queueRun refuses in off mode before any reservation`
- `queueRun refuses a full sweep in ids_only mode`. It also checks `partition`, and that `change_check` succeeds in `ids_only`.
- `a confirmed run creates a runs row on the current version`. This is the McAllen × home_services version. It checks:
  - `estimate_requests` 6 / 54, `ceiling_requests` 108, `requested_by` `user_reviewer_A` and `workflow_run_id` `wrun_test`;
  - one open `ts_enterprise` hold of 1 µUSD;
  - that `start` was called once, with the real `placesSweep` and `[{ runId, clerkOrgId: 'org_A' }]`, with **no `withOrg` transaction open**, and that the row it saw was already `queued` with ceiling 108.
- `queueRun stores the partition index for a partition run`
- `a change check holds one micro-dollar on ts_essentials`
- `queueRun refuses a second active run`
- `queueRun fails stale runs before inserting`. It covers both reclaims in sequence: one org can hold only one active row at a time.
- `queueRun refuses a version without geometry`. This is all 254 counties. The message starts "…for Anderson County, " and contains no FIPS code.
- `queueRun releases the hold when the workflow cannot start`. It also checks that no ledger row was written and that `reserved_micro_usd` returned to 0.

**Unit and dom additions:**
- `tests/unit/run-drawer.test.tsx`:
  - `a confirmed run navigates to its report without a toast`
  - `each drawer kind sends its own run kind`
  - `a mode refusal replaces the confirm with a reload`
  - `a second active run links to the running run`
- `tests/unit/ui-maps.test.ts`: `the phase 2 run notice is retired everywhere`
- `tests/unit/time.test.ts`: `formatWeekRange renders the calendar week it was given`

### Mutation checks

For each mutation: I applied it, ran the named test with `-t`, read the red by name, and restored the file. After each one, `git diff` showed only the intended work.

| # | Mutation | Red (exact name) |
|---|---|---|
| 1 | drop the `off` arm of the mode check | `queueRun refuses in off mode before any reservation`: `expected { ok: true … } to deeply equal { ok: false … }` |
| 2 | `ids_only` admits every kind | `queueRun refuses a full sweep in ids_only mode` |
| 3 | ceiling = `1 × requestsHi` | `a confirmed run creates a runs row on the current version` (the row does not match) |
| 4 | `start()` moved inside the transaction | `a confirmed run creates a runs row on the current version`: `expected true to be false` (`insideTransaction`) |
| 5 | no `release_reservation` on start failure | `queueRun releases the hold when the workflow cannot start`: `{ released: true }` expected |
| 6 | no `never_started` reclaim | `queueRun fails stale runs before inserting`: `got conflict` |
| 7 | no `abandoned` reclaim | `queueRun fails stale runs before inserting`: `got conflict` |
| 8 | `missingGeometry` result ignored | `queueRun refuses a version without geometry`: `expected 'budget_refused' to be 'validation'` |
| 9 | county names left as FIPS | `queueRun refuses a version without geometry`: the message starts "…for count…" |
| 10 | the SKU is always `ts_enterprise` | `a change check holds one micro-dollar on ts_essentials` |
| 11 | no `on conflict … do nothing` | `queueRun refuses a second active run`: `code: 'unexpected'` where `'conflict'` was expected (the raw 23505) |
| 12 | `onlyCells` accepts every cell | `queueRun stores the partition index for a partition run`: `expected 918 to be less than 918` |
| 13 | drawer `router.push` → `router.refresh` | `a confirmed run navigates to its report without a toast` |
| 14 | the drawer always sends `full_sweep` | `each drawer kind sends its own run kind` |
| 15 | `mode_refused` falls through to `run-error` | `a mode refusal replaces the confirm with a reload`: `Unable to find … run-mode-refused` |
| 16 | `busy` falls through to `run-error` | `a second active run links to the running run` |
| 17 | `PHASE4_RUN_NOTICE` reintroduced in copy.ts | `the phase 2 run notice is retired everywhere`: `[ 'src\lib\ui\copy.ts' ]` |
| 18 | `formatWeekRange` anchored at 00:00 UTC | `formatWeekRange renders the calendar week it was given`: `expected 'Sep 20–26' to be 'Sep 21–27'` |

### Acceptance greps

- `grep -rn "PHASE4_RUN_NOTICE" src tests/unit` returns nothing. The guard test spells the two strings in halves.
- `grep -n "router.push" run-drawer.tsx` returns line 199. `grep -n "gap-3" run-drawer.tsx` returns nothing: the radio rows use `gap-2` and the footer uses `gap-4` (Rule 41).
- `grep -n "run-confirm\|run-preset" tests/e2e/spend.spec.ts` returns nothing (exit 1).
- `grep -n "run-phase4-notice" tests/e2e/preset-detail.spec.ts` returns nothing.
- `grep -rln "run-confirm" tests/e2e` lists only `tests/e2e/preset-detail.spec.ts`. That spec is local-only, and its test now asserts `run-mode-refused`.
- In `queue-run.ts`, `outcome = await runInTransaction()` is at L303 and `start(placesSweep, …)` is at L343.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Race correctness] One active run is an `ON CONFLICT DO NOTHING` insert, not select-then-insert + a 23505 catch**
- **Issue:** the plan pre-selected an active run and then mapped a racing `23505` to `busy`. A catch like that is reachable only under true concurrency, so no single-connection test can kill a mutation of it. It would be a guard that nothing tests.
- **Fix:** the insert is `on conflict (org_id) where status in ('queued','running') do nothing returning id`. Zero rows means `busy`, and a follow-up read names the running run. The sequential case and the race are now one path, and mutation 11 kills it: with the clause removed, the raw 23505 surfaces as `unexpected`.
- **Commit:** `7e10eba`

**2. [Rule 1 - Bug] The partition week comes from the database clock, not `new Date()`**
- **Issue:** `beginRun` plans a partition from `runs.created_at`, which is the transaction's `now()`. Admission using the JS clock could price week *w* and execute week *w+1* at a Monday-midnight boundary.
- **Fix:** the version read also returns `now()` as epoch ms, and `cellsForRun` uses that value.

**3. [Rule 2 - Correctness] `abandoned` also falls back to `created_at`**
- **Issue:** the plan's `coalesce(heartbeat_at, started_at)` is null for a `running` row with neither stamp, and such a row would hold the org's slot forever.

**4. [Rule 2 - Rule 35] No-geometry names are human**
- **Issue:** `missingGeometry` names a county `county 48001`, which is a machine key.
- **Fix:** counties render by name (`Anderson County`), with at most three names and then `N more`.

**5. [Rule 3 - Blocking] `ActionErrorCode` gained `'mode_refused'`**
- The closed union had no code for the plan's `fail('mode_refused', …)`.

**6. [Rule 2 - Correctness] `start()` failure handling is split**
- The cleanup (release the hold, close as `never_started` while `queued`) runs only when `start()` throws, and is itself guarded.
- The `workflow_run_id` stamp is best-effort. The plan put both inside one try, so a failed stamp after a successful start would have released the hold and reported "didn't start" for a run that had in fact started.

**7. [Rule 2 - Tests the plan did not list]**
- The dom-lane drawer tests (4). The drawer's four result branches had no test at all.
- The retirement guard test.
- `formatWeekRange` and its test. `RUN_DRAWER_CELLS` needs a formatted week range, and Rule 26 forbids calling `Intl` in a component.

**8. [Plan wording] The e2e run test refuses to click when Places is on**
- `preset-detail.spec.ts` self-skips if `.env.local` sets `PLACES_MODE` to anything but `off` or empty. Playwright and the local dev server read the same file, so the "local mode is off" precondition is now asserted instead of assumed (T-4-09).

**9. [Harness] The `withOrg` savepoint double resets role and claims on release**
- A released savepoint keeps `SET LOCAL` until the outer transaction ends. Without the reset, every fixture statement after the action would have run as the user.

### Process notes

- Tests were run with `npx vitest run --config … <file> -t "<name>" --reporter=verbose`, and I read the names.
- The mutation runners and log files lived in the gitignored `coverage/` and were deleted.
- A first `next build` failed type-checking on scratch `.tsx` copies I had placed in `coverage/`. I removed them and rebuilt. Keep scratch copies of source files out of the repo tree.

## Flags for downstream plans

- **04-27:**
  - Render the three triggers. For the partition trigger, pass `partition = { index, isoWeek, mondayIso, sundayIso, cells, totalCells }`, computed on the server with the same `cellsForRun(..., 'partition', now)` / `isoWeekOf(now)` the action uses.
  - Rename "Run this preset" to "Run full sweep" (`run-preset` stays).
  - Replace `preset-detail.spec.ts`'s `run is refused while places is off` with the off-state assertions from Rule 38.
  - The presets/[id] `gap-3` at L310 (Rule 41) is still there; this plan did not edit that line.
- **A partition with zero cells this week is admitted.** It holds 1 µUSD and completes with nothing. There is no copy for "nothing to run this week"; 04-27 can hide or disable the action when `partition.cells === 0`.
- **Missing Places key:** `queueRun` checks only the mode, as planned. In `enterprise` mode with no key, the run is admitted, and the first search fails `places_key_missing`, which the report already has copy for. Nothing is charged.
- **The stale reclaim covers 04-22's flag.** A `queued` run whose `beginRun` failed four times is reclaimed as `never_started` after 15 minutes, whether or not it has a `workflow_run_id`.

## Merge notes

- **No migration.** The journal is untouched at 30. Every DB test rolls back, and the lane leaves no rows.
- **Shared files other plans touch:**
  - `src/lib/ui/copy.ts`: one deletion (`PHASE4_RUN_NOTICE`).
  - `src/lib/time.ts`: one added export.
  - `src/server/actions/_result.ts`: one union member.
  - `presets/[id]/page.tsx` and `version-history.tsx`: one prop line each.
  - `tests/unit/ui-maps.test.ts`: one import line and one assertion removed, and one new describe block.
- **Not touched:** STATE.md, ROADMAP.md, production and the deployed URL. Nothing was pushed. **No Google request was made.** `start()` is a double in the DB lane, and the workflow lane runs under msw with a fake key.

## Known Stubs

None. The drawer's `partition` and `check` kinds have no caller yet; 04-27 renders those triggers, as the plan intends.

## Threat Flags

None beyond the plan's threat model:
- **T-4-02:** mutations 1, 2, 3, 5, 6, 7, 8, 10, 11 and 12.
- **T-4-06:** `clerkOrgId` is taken from `requireOrg()` and asserted as `'org_A'`.
- **T-4-09:** the spend spec only reads, and the preset-detail spec is local-only, asserts the refusal and refuses to click when Places is on.
- **T-4-14:** the manifest registers `placesSweep` only.

## TDD Gate Compliance

- RED `fa904e6` (`test(04-26)`): all nine tests failed against the pre-plan action, which rejected `kind` as an unknown key.
- GREEN `7e10eba` (`feat(04-26)`): 9/9 pass. No refactor commit was needed.

## Self-Check: PASSED

- FOUND: src/server/actions/queue-run.ts, src/components/preset-detail/run-drawer.tsx, tests/db/queue-run.test.ts, tests/unit/run-drawer.test.tsx, tests/e2e/spend.spec.ts, tests/e2e/preset-detail.spec.ts
- FOUND commits: fa904e6, 7e10eba, b9e2ce1, 9b42a6f
