---
phase: 04-places-transient-verifier
plan: 22
subsystem: places-sweep
tags: [workflow-devkit, d-14, d-15, d-16, d-19, msw, workflow-lane, place-03, place-04, place-05, legal]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-01 workflow lane; 04-05 reducer; 04-11 plan_run_searches / mark_run_search / release_reservation; 04-13 planRootSearches; 04-16 meter + withWorkerOrg; 04-18 runSearchTile; 04-19 runCheckTile"
provides:
  - "src/workflows/places-sweep/workflow.ts: placesSweep (the repo's first 'use workflow'), SweepOutcome"
  - "src/workflows/places-sweep/steps.ts: beginRun, searchTile, checkTile, finishRun ('use step'), BeginResult, FinishVerdict"
  - "src/workflows/places-sweep/wire.ts: toWire / fromWire / encodeUnitId / decodeUnitId (the NUL-free step boundary)"
  - "src/server/queries/preset-spec.ts: step-safe re-export of getSeedTables, readReferenceIndex, resolveSpec, specInputOfVersion"
  - "src/lib/places/search-tile.ts: planRunSearches exported (was the private planChildren)"
  - "tests/workflow/_seed.ts: seedSweepWorld / teardownOrg / ownerClient (committed org_wf_<random> worlds)"
  - "tests/workflow/places-sweep.test.ts: 12 named workflow-lane proofs"
affects: [04-26, 04-28, 04-31, 04-32]

tech-stack:
  added: []
  patterns:
    - "Workflow lane: a committed dedicated org per test, torn down from the catalog (every org_id table) under session_replication_role = replica"
    - "Step boundary: searches cross as a reversible NUL-free form (toWire/fromWire); step errors are reason keys or a SQLSTATE, never a foreign message"
    - "World-file scan: decode world-local's base64 Uint8Array payloads past the 4-byte format prefix before searching for sentinels, with positive controls"

key-files:
  created:
    - src/workflows/places-sweep/workflow.ts
    - src/workflows/places-sweep/steps.ts
    - src/workflows/places-sweep/wire.ts
    - src/server/queries/preset-spec.ts
    - tests/workflow/_seed.ts
    - tests/workflow/_json-imports.ts
    - tests/workflow/places-sweep.test.ts
    - tests/unit/places-sweep-wire.test.ts
    - tests/unit/places-sweep-imports.test.ts
  modified:
    - src/lib/places/check-tile.ts
    - src/lib/places/search-tile.ts
    - src/workflows/places-sweep/reducer.ts
    - tests/unit/sweep-reducer.test.ts
    - vitest.workflow.config.ts

key-decisions:
  - "presets.ts is already step-safe (no next/* or @clerk/*), so preset-spec.ts is a re-export, not a move; a unit test walks the step import graph to keep it that way"
  - "Searches cross every step boundary in a reversible NUL-free form (% -> %25, / -> %2F, NUL -> /), which equals dbSafe for every seeded unit id"
  - "An unplannable run (reference row gone, unit with no outline) is closed failed / never_started inside beginRun, after its hold is released, so it cannot hold the org's one active slot"
  - "A run the start input's org cannot see makes beginRun throw FatalError('places_request_rejected'): the workflow fails and nothing is written or sent"
  - "failReasonOf uses the cross-realm Error brand check: the workflow VM receives step failures as FatalErrors built outside it"
  - "Unknown step errors are rethrown as step_error:<SQLSTATE or name>, since a database error can quote a Places-derived parameter"

requirements-completed: [PLACE-03, PLACE-04, PLACE-05]

duration: ~45min
completed: 2026-09-23
---

# Phase 4 Plan 22: The places-sweep executor Summary

**`placesSweep` is now a real Vercel Workflow with four steps: `beginRun` claims the run, releases the admission hold and plans the searches the way admission priced them; `searchTile` or `checkTile` runs once per queued search; and `finishRun` closes the run from the ledger. The lane runs the compiled workflow in-process against msw and the local database. It shows that saturation subdivides and completes, and that each budget stop ends the run as `partial` with the right reason. A 400 fails the run without retry, a 5xx is retried a bounded number of times, and a change check lists only the stored leaves. No Places text and no U+0000 reach any payload the workflow world wrote.**

## Performance

- **Duration:** about 45 min (roughly 21:40Z to 22:25Z)
- **Tasks:** 2 planned, 3 commits (the reducer bug fix has its own commit)
- **Files:** 9 created, 5 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `821730c` | feat(04-22): placesSweep workflow and its four steps |
| 2 (fix found by the lane) | `a75e728` | fix(04-22): failReasonOf reads a step failure from outside the workflow sandbox |
| 2 | `ee68871` | test(04-22): workflow-lane proofs for the places sweep (compiled workflow, msw, local DB) |

## The start API (for 04-26)

```ts
import { start } from 'workflow/api';
import { placesSweep } from '@/workflows/places-sweep/workflow';

const run = await start(placesSweep, [{ runId, clerkOrgId }]);
// run.runId: 'wrun_…'  → store it in runs.workflow_run_id (column-granted to authenticated)
// await run.returnValue: SweepOutcome
```

- **Input:** `SweepInput = { runId: string; clerkOrgId: string }`, exported from `src/lib/places/search-tile.ts`.
  - `runId` is a `runs` row in status `queued`. It must already carry `ceiling_requests` and an admission reservation named with `run_id`.
  - `clerkOrgId` is the Clerk org id (the `o.id` claim), not the `orgs.id` uuid.
- **Return:** `SweepOutcome = { status: 'complete' | 'partial' | 'failed' | 'not_runnable'; reason: string | null }`.
  - `not_runnable` with a `null` reason: the run was already terminal.
  - `not_runnable` with reason `never_started`: `beginRun` found the run unplannable. It released the hold and closed the run as `failed / never_started`.
  - When an operator already ended the run, the outcome carries the row's own status and reason (for example `failed / abandoned`).
- **Throws:** `run.returnValue` rejects only when the start input's org cannot see the run (T-4-06), or when `beginRun` fails four times on a database fault. In that second case the run can stay `queued`. See Flags.
- 🔴 **Pitfall 11 is 04-26's to close.** `next build` reports `workflows build complete (3 steps, 0 workflows)`, and `grep -c placesSweep` over the generated `manifest.json` returns 0. `withWorkflow()` discovers workflows only from route or page files that reach `start()`, and nothing reaches `placesSweep` until `queue-run.ts` imports it. The lane builds its own bundles, so it is not affected. After 04-26, check the manifest.

## What each step does

- **`beginRun(input)`** runs as one `withWorkerOrg` transaction:
  1. Reads `runs ⋈ search_versions ⋈ searches` under RLS. Zero rows means `FatalError('places_request_rejected')`.
  2. Moves `queued` to `running` and stamps `started_at` and `heartbeat_at`. A replay finds the run `running` and continues. Any other status returns `not_runnable`.
  3. Releases every open reservation of the run through `app.release_reservation`, skipping any hold a page cursor points at. It never settles them (M53).
  4. Builds the spec exactly as `queueRun` does, through `preset-spec.ts`: `readReferenceIndex`, then `specInputOfVersion`, then `resolveSpec`. It then calls `planRootSearches` with `now = runs.created_at`, so a partition keeps the week it was queued in.
  5. For a change check, each root is replaced by the stored leaves under it: `starts_with(tile_key, root.tileKey) and is_leaf`. Each leaf becomes an `ids_only` spec with the root's shape, and a root with no stored tree stays as it is.
  6. Plans the specs through `planRunSearches` (04-18's payload mapping, now exported), then returns them through `toWire`.
- **`searchTile` / `checkTile`** each call `fromWire` and then the 04-18 or 04-19 body, with `mode: env.PLACES_MODE`. Geo shapes are loaded inside the step by dynamic import.
  - A `fail` result becomes an error. If it is retryable, the step throws `RetryableError(reason, { retryAfter: retryAfterMs ?? 2000 })`; otherwise it throws `FatalError(reason)`.
  - `WorkerOrgMismatch` becomes `FatalError('places_request_rejected')`.
  - Any other error becomes `Error('step_error:<SQLSTATE|name>')`.
  - Subdivided children leave the step through `toWire`.
  - Both steps set `maxRetries = 3`.
- **`finishRun(input, verdict)`**:
  1. Calls `settleInFlight` on every search that still has a cursor. Each call is its own transaction, because the pool has one connection and a nested transaction would deadlock.
  2. In one transaction, updates `status`, `stopped_reason`, `finished_at`, `heartbeat_at` and `cost_micro_usd = sum(cost_ledger.micro_usd)`, with `where status = 'running'`.
  3. Only when that update matched does it call `app.emit_event('runs', runId, 'places_run_finished', {status, reason, calls})`. The parameter order is drizzle/0011's (entity_type, entity_id, action, after); the plan's order was wrong. A replay therefore cannot emit twice.

## Verification

### Gates (branch `worktree-agent-a94665d22f98fcc64`, HEAD `ee68871`; printed after the build)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src tests scripts <configs>` | exit 0 (the sandbox refused `--ignore-pattern ".claude/**"`) |
| prettier `--check --end-of-line auto` on every touched file | clean |
| Workflow lane (`vitest.workflow.config.ts`, verbose) | **2 files, 13 tests passed**, 71 s |
| Full DB lane (`vitest.db.config.ts --pool=forks`) | **41 files, 365 tests passed**, 91 s, no cross-plan noise |
| `npx next build` (once) | exit 0; `/.well-known/workflow/v1/{flow,step,webhook/[token]}` emitted; `3 steps, 0 workflows` (see Pitfall 11 above) |
| `npx vitest run tests/unit` **after** the build (the walkers see the generated tree) | **72 files, 533 tests passed** |
| `select count(*) from orgs where clerk_org_id like 'org_wf_%'` after the lane | **0** |

**Workflow-lane PASS list, names read from verbose output.** The plan's eight:
- `a saturated tile subdivides and the run completes`
- `a refused reservation ends the run partial`
- `the run stops at its request ceiling`
- `google daily quota stops the run`
- `a rejected request fails the run without retry`
- `a change check run diffs the stored leaf tiles`
- `the admission hold is released when the run begins`
- `no step returns Places content`

Four more (Rule 2, for truths and threats the eight did not reach):
- `a 5xx is retried and the run completes`: RetryableError, and the 503 attempt is released.
- `a step that keeps failing stops retrying and fails the run`: `maxRetries = 3` means exactly 4 requests, then `failed / places_unavailable`.
- `a terminal status set by an operator is never overwritten` (T-4-03 / Pitfall 5).
- `a run another org cannot see is never executed` (T-4-06): zero requests, the victim's run stays `queued` and its hold stays open.

Plus `the workflow lane pins zone, locale and a fake Places key` (04-01).

**New unit names (all passing):**
- `every seeded unit id crosses a step as its DB-safe form and comes back raw`
- `the wire form is reversible where dbSafe is not`
- `a planned search leaves a step with no U+0000 and returns intact`
- `a step reaches no Next, no Clerk and no server-action module`
- `the workflow body imports only its steps and the pure reducer`
- `failReasonOf reads an Error from another realm`

### Mutation checks (each one: applied, the named test run, the red read by name, reverted with `git checkout --`, `git diff --stat src/` empty)

| # | Mutation | Red (exact name) |
|---|---|---|
| **M52** (watched first, on the committed tree) | `search-tile.ts`: `daily_quota` → `fail(…, 'places_unavailable', true)` | `google daily quota stops the run`: `expected { status: 'failed', … } to deeply equal { status: 'partial', … }`. Four retried attempts, then failed. |
| **M33** | `search-tile.ts`: a reserve `stop` → retryable fail | `a refused reservation ends the run partial`: `failed` where `partial` was expected |
| **M45** | `search-tile.ts` returns the first place's `displayName.text` in the `searched` result | `no step returns Places content`: `expected [ 'Ortiz Plumbing', …(2) ] to deeply equal []` |
| NUL | `wire.ts`: `toWire` returns the search unchanged | `no step returns Places content` (38 payloads carried `\u0000`) and the unit test `a planned search leaves a step with no U+0000 and returns intact` |
| Realm | `reducer.ts`: `isError` back to `instanceof Error` | `a rejected request fails the run without retry`: reason `places_unavailable` |
| M53 | `steps.ts`: the admission-release loop skipped | `the admission hold is released when the run begins`: `{ released: false }` |
| T-4-03 | `steps.ts`: `closeRun` without `status = 'running'` | `a terminal status set by an operator is never overwritten` |
| D-16 | `steps.ts`: a change check keeps the roots (no stored leaves) | `a change check run diffs the stored leaf tiles` |
| Import graph | `preset-spec.ts` imports `next/headers` | `a step reaches no Next, no Clerk and no server-action module`: `[['next/headers', …]]` |

## The U+0000 finding

- **Measured.** Workflow 4.8.9 serialises step arguments and returns as `devl` + devalue text, inside a binary payload. That payload is base64 in world-local's JSON files and binary (CBOR) in world-vercel.
  - I ran with the wire codec disabled and decoded the Local World's files. 38 of 88 payloads carried the unit id as the six-character JSON escape `48215\u0000McAllen`. Zero payloads carried a raw NUL byte.
  - So the local and Vercel worlds shipped today accept it. A world that parses that devalue text into Postgres `jsonb` would refuse the escape with **22P05**, and it is dead weight in an audit log in any case.
- **Fix.** Searches cross every step boundary in the reversible `wire.ts` form: `%` → `%25`, `/` → `%2F`, NUL → `/`. `fromWire` restores the raw id inside the step, so `queriedCityOf`, the geo-shape lookup and the partition hash see what the planner saw. For every seeded unit id the wire form equals `dbSafe(unitId)`, which is the value `place_tiles.unit_id` already holds. `toWire` also throws if any `\u0000` would still cross.
- **Proven** by `no step returns Places content`, which asserts that no decoded world payload contains a raw NUL or the `\u0000` escape, by the three wire unit tests, and by the NUL mutation above.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] `failReasonOf` mapped every step failure to `places_unavailable` inside the real workflow**
- **Found during:** Task 2, on the first full lane run. A 400 reported `failed / places_unavailable`.
- **Issue:** `@workflow/core` (step.js) rejects the workflow's awaited step with `new FatalError(message)`, which is built in the host realm. The workflow body runs in a VM sandbox, where `e instanceof Error` is false. 04-05's unit tests could not see this.
- **Fix:** `isError` = `instanceof Error` or the cross-realm brand check (`Object.prototype.toString.call(e) === '[object Error]'`). The existing rule that a plain `{ message }` object is not trusted still holds. New unit test `failReasonOf reads an Error from another realm` (uses `vm.runInNewContext`).
- **Files:** src/workflows/places-sweep/reducer.ts, tests/unit/sweep-reducer.test.ts
- **Commit:** `a75e728`

**2. [Rule 3 - Blocking] The lane could not load the step bundle: `ERR_IMPORT_ATTRIBUTE_MISSING`**
- **Issue:** `@workflow/vitest` builds `.workflow-vitest/steps.mjs` and imports it natively. The builder bundles project TypeScript but leaves JSON imports external and strips import attributes. That covers presets.ts' five seed files, the geo shapes, and `builtin-modules.json` from its own serde checker. Node refused all of them. The only symptom was a 60 s test timeout.
- **Tried first:** `with { type: 'json' }` on presets.ts' imports. The SWC transform strips the attribute, so I reverted it.
- **Fix:** `tests/workflow/_json-imports.ts` is a lane-only `module.registerHooks` load hook that adds `type: 'json'` to `file:` URLs ending in `.json`. It is registered through `setupFiles` in vitest.workflow.config.ts. No `src/` change was needed: in the deployed app, Next compiles the step route and bundles JSON normally, and `next build` is green.
- **Commit:** `ee68871`

**3. [Plan correction] `app.emit_event` parameter order.** The plan wrote `('places_run_finished', runId, 'runs', …)`. drizzle/0011's signature is `(entity_type, entity_id, action, after)`, so the call is `('runs', runId, 'places_run_finished', …)`. The lane reads the event back by `entity_type = 'runs'` and `action = 'places_run_finished'`.

**4. [Rule 2 - Correctness] Behaviour the plan left open, decided and tested**
- **Unplannable run.** Case: a reference row is gone, or a unit has no outline. The run is closed as `failed / never_started` inside `beginRun`, after the hold is released. Otherwise a `queued` or `running` row would block the org's `runs_one_active_per_org` slot forever. `never_started` is already in `STOPPED_REASONS`, and its sentence says the hold was released.
- **Step errors are sanitised** (T-4-05, Pitfall 1d). An unknown error is rethrown as `step_error:<SQLSTATE|name>`. A Postgres error can quote a parameter, and the candidate query's parameters are derived from a Places response.
- **Leftover in-flight settles.** `finishRun` settles them outside its closing transaction. `settleInFlight` opens its own transaction, the pool is `max: 1`, and nesting the two would deadlock. Each settle is idempotent, so a replay writes nothing more.
- **The admission-hold release skips any reservation a page cursor points at.** That is only reachable on an odd replay, and it leaves the hold to `settleInFlight` rather than releasing a hold whose request may have left.
- **Four extra workflow-lane tests** (listed above): a 5xx retry, the bounded retries, the operator kill, and a foreign run.

**5. [Plan-adjacent files]**
- `search-tile.ts`: the private `planChildren` became the exported `planRunSearches`, so `beginRun` and the subdivision share one payload mapping. The body is unchanged.
- `presets.ts` is untouched. Case 2 applied: it is already step-safe, so `preset-spec.ts` is a re-export.
- Two new unit test files: the wire codec, and the step import graph.

**6. [Plan wording] No per-minute 429 lane test.** The client's Retry-After default is 60 s when Google sends none (04-12), which is too long for a lane test. The 5xx test proves the same `RetryableError` path with the step's 2 s default.

### Process notes
- Tests were run with `npx vitest run --config … <file> -t "<name>" --reporter=verbose`, and I read the names. `-t` names avoid apostrophes because the sandbox refuses them. That is why the operator test is named `a terminal status set by an operator is never overwritten`.
- One throwaway decode script lived in the gitignored `coverage/` and was deleted.

## Flags for downstream plans

- **04-26:**
  - Wire `start(placesSweep, [{ runId, clerkOrgId }])` after the transaction commits. Afterwards, `grep -c placesSweep src/app/.well-known/workflow/v1/manifest.json` must be greater than 0. Today it is 0, because nothing reachable from a route imports the workflow yet.
  - `workflow_run_id` takes `run.runId`.
- **04-26 / the stale-run sweeper:** if `beginRun` fails four times on a database fault before it commits, the run stays `queued` and holds the org's one active slot. The sweeper should treat an old `queued` run with a `workflow_run_id` like an abandoned `running` one.
- **04-28 (report):** `run_searches` rows a stop left behind stay `planned`, as the reducer designed, and the ceiling test asserts they are listed. `finishRun` writes `cost_micro_usd` from the ledger, and the lane checks it equals the ledger sum.
- **Per-minute 429:** it waits 60 s by default (04-12's `DEFAULT_RETRY_AFTER_MS`) before each retry, and the step retries 3 times. So a sustained per-minute limit costs about 3 minutes before the run fails. That is fine on Vercel, where steps can wait. Reconsider after the D-04 run if it feels too slow.

## Merge notes

- **No migration.** The local journal is untouched at 30. Every lane org is committed and then torn down, and the lane leaves zero `org_wf_%` rows.
- **Shared files other plans may touch:**
  - `vitest.workflow.config.ts`: one `setupFiles` line.
  - `src/workflows/places-sweep/reducer.ts`: `failReasonOf` plus a helper.
  - `tests/unit/sweep-reducer.test.ts`: one test and one import.
  - `src/lib/places/search-tile.ts`: `planChildren` renamed to the exported `planRunSearches`.
  - `src/lib/places/check-tile.ts`: its two local type declarations replaced by a type re-export from search-tile.ts.
- **Not touched:** STATE.md, ROADMAP.md and production. Nothing was pushed. **No Google request was made.** msw ran with `onUnhandledRequest: 'error'`, the lane uses the forced fake key, and no real key exists on this machine.

## Known Stubs

None. `placesSweep` has no production caller yet by design: 04-26's `queueRun` is the first.

## Threat Flags

None beyond the plan's threat model:
- **T-4-05:** mitigated by the world-file scan with positive controls, the NUL-free boundary, and the sanitised step errors (M45, NUL).
- **T-4-06:** mitigated by the foreign-run test.
- **T-4-02:** mitigated by M33, M52, bounded retries, the ceiling and M53.
- **T-4-03:** mitigated by the operator-kill test and the `closeRun` guard mutation.

## TDD Gate Compliance

- Task 1 (`feat`) came before Task 2 (`test`), as the plan orders. The Task 2 RED gate is M52, which was watched red by name on the committed tree before the tests were committed, plus the eight further mutations in the table. Each was reverted and `git diff --stat src/` was empty.
- The reducer fix (`a75e728`) was driven by a lane failure (red: `a rejected request fails the run without retry`). Its unit test was added alongside the fix.

## Self-Check: PASSED

- FOUND: src/workflows/places-sweep/{workflow,steps,wire}.ts, src/server/queries/preset-spec.ts, tests/workflow/{_seed,_json-imports,places-sweep.test}.ts, tests/unit/places-sweep-{wire,imports}.test.ts
- FOUND commits: 821730c, a75e728, ee68871
