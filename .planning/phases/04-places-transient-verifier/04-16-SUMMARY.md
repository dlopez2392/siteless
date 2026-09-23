---
phase: 04-places-transient-verifier
plan: 16
subsystem: places-meter
tags: [places, budget, meter, reservation, ceiling, workflow, rls, criterion-5, place-01, place-04]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-02 PLACES_MODE; 04-04 run request ceiling (runs.ceiling_requests); 04-09 run_searches in-flight columns; 04-11 app.release_reservation / app.mark_run_search; 04-12 ReservedCall + mintReservedCall"
  - phase: 02-search-presets-budget
    provides: "app.reserve_budget, app.settle_reservation (0019 WR-03), readUnitsUsedThisPeriod, price book"
provides:
  - "src/db/with-worker-org.ts: withWorkerOrg(clerkOrgId, actor, fn) — the workflow tier's tenant context"
  - "src/lib/places/meter.ts: modeAllows, reservePage, settleInTx, settleOrRelease, settleInFlight, WorkerOrgMismatch, PlacesMode, ModeRefusal, RunCtx, ReserveOutcome"
  - "tests/db/places-meter.test.ts: 18 named DB proofs (16 meter + 2 real-helper)"
  - "tests/unit/places-meter-mode.test.ts: 6 unit tests for the gate"
affects: [04-18, 04-19, 04-22, 04-33]

tech-stack:
  added: []
  patterns:
    - "Reservation + conditional ceiling UPDATE in one transaction; a refused ceiling THROWS inside it so the reservation rolls back, and the throw is mapped to a returned stop outside"
    - "Per-attempt request id (run:search:page:uuid) so the ledger's unique request_id never swallows a retried page's real charge"
    - "Savepoint double for a transaction helper that resets role and clears GUCs before release (a released savepoint's SET LOCAL persists into the outer transaction)"

key-files:
  created:
    - src/db/with-worker-org.ts
    - src/lib/places/meter.ts
    - tests/unit/places-meter-mode.test.ts
    - tests/db/places-meter.test.ts
  modified:
    - tests/unit/places-client.test.ts

key-decisions:
  - "The free allowance is counted in the RESERVATION's own budget period, not the current one (month-boundary correctness; also avoids ensure_budget_period's self-heal mid-settle)"
  - "settleInFlight settles any in-flight attempt that is not yet SETTLED, even if the self-heal released its expired hold: only expiry can leave a cursor pointing at a released hold, and the outcome is still unknown"
  - "Every ctx-taking meter function re-reads the run under RLS first (WorkerOrgMismatch on zero rows); only reservePage additionally requires status running — a killed run's last attempt must still be ledgered"
  - "modeAllows refuses an unknown mode as places_off, and enterprise permits exactly ts_essentials and ts_enterprise"

requirements-completed: [PLACE-01, PLACE-04]

duration: ~35min
completed: 2026-09-23
---

# Phase 4 Plan 16: The per-page Places meter and the worker tier context Summary

**Every Places page attempt now passes a pure mode gate, then one `withWorkerOrg` transaction.** That transaction re-reads the run under RLS, reserves the page's price, bumps `calls_count` only while it is under `ceiling_requests`, and sets the durable in-flight cursor. A refused ceiling rolls the reservation back. The meter is the only code under `src/` that mints a `ReservedCall`.

## Performance

- **Duration:** about 35 min (20:10Z to 20:45Z)
- **Tasks:** 3, as 5 commits (TDD: test then feat for Tasks 1 and 2; Task 3 is a test commit)
- **Files:** 4 created, 1 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | `0b37d11` | test(04-16): add failing tests for the Places mode gate |
| 1 GREEN | `36717bf` | feat(04-16): withWorkerOrg tier context and the pure Places mode gate |
| 2 RED | `60716a7` | test(04-16): add failing tests for the meter as the one minter |
| 2 GREEN | `7ce1abc` | feat(04-16): the per-page meter - reservePage, settleInTx, settleOrRelease, settleInFlight |
| 3 | `b4ff7f0` | test(04-16): DB proofs for the per-page meter and the worker context |

## Exported API (04-18, 04-19 and 04-22 call these)

```ts
// src/db/with-worker-org.ts ('server-only')
export async function withWorkerOrg<T>(
  clerkOrgId: string,                 // throws Error('withWorkerOrg: a clerk org id is required') if blank
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,         // Tx = drizzle postgres-js transaction (same as src/server/queries/budget Tx)
): Promise<T>;
// One db.transaction: set_config('request.jwt.claims', {"o":{"id":clerkOrgId}}, true),
// set_config('app.actor_id', actor, true), set local role authenticated. No sub claim, no role claim.

// src/lib/places/meter.ts ('server-only')
export type PlacesMode = 'off' | 'ids_only' | 'enterprise';
export type ModeRefusal = 'places_off' | 'mode_forbids_sku' | 'places_key_missing';
export function modeAllows(mode: PlacesMode, sku: TextSearchSku, keyConfigured: boolean): true | ModeRefusal;
export class WorkerOrgMismatch extends Error {}   // message 'places_run_not_visible', name 'WorkerOrgMismatch'
export type RunCtx = { clerkOrgId: string; runId: string };
export type ReserveOutcome =
  | { kind: 'reserved'; call: ReservedCall }
  | { kind: 'stop'; reason: 'budget_cap_reached' | 'exceeded_estimate' }
  | { kind: 'refused'; reason: ModeRefusal }
  | { kind: 'not_running' };
export async function reservePage(ctx: RunCtx, a: {
  searchId: string; page: 1 | 2 | 3; sku: TextSearchSku; mode: PlacesMode; keyConfigured: boolean; now?: Date;
}): Promise<ReserveOutcome>;          // throws only WorkerOrgMismatch or a database fault
export async function settleInTx(tx: Tx, call: ReservedCall, charged: boolean): Promise<void>;
export async function settleOrRelease(ctx: RunCtx, call: ReservedCall, a: { charged: boolean; searchId: string }): Promise<void>;
export async function settleInFlight(ctx: RunCtx, searchId: string): Promise<boolean>; // true = a ledger row was written
```

**Semantics the callers rely on:**
- **`reservePage`:**
  - A mode refusal returns before any SQL.
  - `not_running` means `runs.status` is not `'running'` (Pitfall 5's stop lever).
  - `budget_cap_reached` means the meter returned zero rows. Never retry it.
  - `exceeded_estimate` means `calls_count` is already at `ceiling_requests`. The reservation was rolled back and `calls_count` did not move.
  - On `reserved`, `run_searches` has `status = 'searching'` and the in-flight pair set to this attempt.
- **`settleInTx`** does NOT clear the in-flight cursor; 04-19's recorder must clear it in the same transaction. Charged means `app.settle_reservation` at the free-allowance price (units 1). Not charged means `app.release_reservation`, with no ledger row.
- **`settleOrRelease`** settles or releases, then clears the cursor, in one transaction. It re-reads the run but does not require `running`.
- **`settleInFlight`** must be called before re-trying a page. If the cursor points at an unsettled reservation, it is settled as charged under the crashed attempt's own request id. The cursor is then cleared, and a second call writes nothing.
- **Charging rule (04-12's outcome table):**
  - `ok`, `timeout`, and `bad_shape` with status 200: settle with `charged: true`.
  - Every other failure: `charged: false`.
- **`page` is typed `1 | 2 | 3`.** It only appears in the request id. The attempt uuid, not the page number, is what keeps retries distinct.

## Verification

### Gates (HEAD `b4ff7f0`, branch `worktree-agent-a8c4b80927619efd4`, printed after each gate)

- `npx tsc --noEmit`: exit 0
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0
- `prettier --check --end-of-line auto` is clean on all 5 touched files
- `npx vitest run tests/unit`: **64 files, 481 tests passed.** This includes `places-meter-mode` 6/6 and `places-client` 16/16, where the minter test is now an equality.
- `places-meter.test.ts` alone: **18/18.** Every name the plan lists passed, read by name:
  `off mode refuses before any reservation`, `a missing key refuses before any reservation`, `a run stops at 2x its estimate-high`, `a refused reservation stops with budget_cap_reached`, `a zero-price page still reserves one micro-dollar`, `a change check ledgers a zero-cost row`, `a free-allowance page settles at zero and counts a unit`, `a page past the free allowance settles at the list price`, `an error response releases the reservation and writes no ledger row`, `a retried page never under-ledgers`, `a workflow step cannot write another org's run`, `a run that is no longer running reserves nothing`.
  - Six more tests: `an unknown outcome on an abandoned page settles as charged and clears the cursor`, `two charged attempts at the same page are two ledger rows`, `a crashed attempt whose hold expired is still ledgered`, `the meter ran only through the worker double`, `withWorkerOrg sets only the org claim and the workflow actor`, `withWorkerOrg refuses an empty org id before opening a transaction`.
- **Full `test:db`** (`vitest run --config vitest.db.config.ts --pool=forks --reporter=verbose`): **33 files, 261 passed, 12 failed.** All 18 meter tests are in the pass list by name. The 12 failures are cross-plan and not caused by this plan (see below).

### Cross-plan DB noise (recorded, not fixed)

The shared local DB's migration journal moved from **29 to 30** during this plan: 04-15 applied 0029. That migration adds `place_attachments` CHECK `pa_features_numeric` = `app.places_features_ok(features)`. This worktree's tree contains no such constraint (`grep -rn pa_features_numeric drizzle src tests` finds nothing).

The 04-09 fixture `seedAttachmentWithObservation` (`tests/db/_places-fixtures.ts`) writes `features: {rule: 'fixture', nameSim: 1}`, which fails that check. Every one of the 12 reds is `new row for relation "place_attachments" violates check constraint "pa_features_numeric"`:
- `places-definers.test.ts`: 3 tests (the purge and the transient-stats tests)
- `places-schema.test.ts`: 9 tests

Neither file imports anything from this plan. **04-15 (or the wave merge) has to update the fixture's `features` to numeric-only values.**

### Mutation checks (each applied, red read BY NAME, reverted with `git checkout -- <file>`, `git diff --stat -- src/` empty)

| # | Mutation | Red (exact names, only these) |
|---|---|---|
| M29 | `modeAllows`: drop the `ids_only` sku refusal | `ids_only refuses an Enterprise mask` (unit, 1/5 at the time) |
| **M28** | `reservePage`: skip the mode-gate return | `off mode refuses before any reservation`, `a missing key refuses before any reservation` (2/17) |
| **M34a** | ceiling UPDATE without `and calls_count < ceiling_requests` | `a run stops at 2x its estimate-high` (1/17) |
| **M34b** | ceiling refusal `return`ed inside the transaction instead of thrown, so the reservation commits | `a run stops at 2x its estimate-high` (1/17), `expected 3 to be 2` (the third reservation survived) |
| **M46** | an invisible run read as `'running'` instead of `WorkerOrgMismatch` | `a workflow step cannot write another org's run` (1/17). The database is a second wall here: `reserve_budget` refused the foreign run with a raw query error, but the typed fail-closed error is gone, and the test pins the type. |
| S1 | `settleInFlight` open only when `settled_at is null and released_at is null` (the plan's literal predicate) | `a crashed attempt whose hold expired is still ledgered` (1/17) |
| S2 | settle ignores the free allowance (freeRemaining 0) | `a free-allowance page settles at zero and counts a unit`, `an unknown outcome on an abandoned page…`, `a retried page never under-ledgers`, `a crashed attempt whose hold expired…` (4/17) |
| S3 | settle always inside the allowance (freeRemaining ∞) | `a page past the free allowance settles at the list price` (1/17) |
| S4 | `settleOrRelease` always charges | `an error response releases the reservation and writes no ledger row` (1/17) |
| S5 | per-page request id (uuid dropped) | `a zero-price page still reserves one micro-dollar`, `two charged attempts at the same page are two ledger rows` (2/18) |
| W1 | real `withWorkerOrg` adds a `sub` claim | `withWorkerOrg sets only the org claim and the workflow actor` (1/18) |
| W2 | real `withWorkerOrg` drops `set local role authenticated` | same test (1/18) |
| W3 | real `withWorkerOrg` sets `app.actor_id` session-wide (`false`) | same test (1/18) |

S5 was first caught only by the request-id format regex. That is shape, not behaviour, so I added `two charged attempts at the same page are two ledger rows`. It goes red under the mutation because the ledger's `on conflict (request_id) do nothing` swallows the second real charge.

### Acceptance greps

- `grep -n "set local role authenticated" src/db/with-worker-org.ts` matches (L40).
- `grep -n "sub" src/db/with-worker-org.ts` matches only comment text ("subject").
- `grep -n "calls_count < ceiling_requests" src/lib/places/meter.ts` matches (L170).
- `randomUUID()` is inside the request-id template (L135).
- The importer-equality test passes with exactly `['src/lib/places/meter.ts']`.
- `grep -n "vi.doMock('@/db/with-worker-org'" tests/db/places-meter.test.ts` matches (L95).
- `grep -n "^vi.mock(" …` matches ONE line, `vi.mock('server-only', …)`. See deviation 5.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The free allowance is priced in the reservation's own period, not `readCurrentPeriod`'s**
- **Found during:** Task 2
- **Issue:** The plan's `settleInTx` read `readCurrentPeriod(tx, 'places')` for the units count. `settle_reservation` writes the ledger row into the period the RESERVATION points at. So an attempt reserved on the 30th and settled after local midnight would be priced against October's empty allowance while being recorded in September, which could turn a list-price call into a $0 row. `readCurrentPeriod` also runs `ensure_budget_period`, whose self-heal releases expired holds in the middle of a settlement.
- **Fix:** `settleAttempt` reads `budget_period_id` off the reservation (RLS-visible) and counts units there.
- **Commit:** `7ce1abc`

**2. [Rule 1 - Bug] `settleInFlight` settles an expired-and-self-healed hold instead of dropping it**
- **Found during:** Task 2
- **Issue:** The plan settles only when `settled_at is null and released_at is null`. Every deliberate release (`settleOrRelease`) clears the cursor in the same transaction. So a cursor that still points at a released hold can only mean the 10-minute hold EXPIRED and the self-heal freed it while the call's outcome was never recorded. The plan's predicate would drop that charge silently (Pitfall 9: under-ledgering). `settle_reservation` explicitly supports a late settle after a release (0019 WR-03).
- **Fix:** Settle whenever `settled_at is null`. Proven by the new test `a crashed attempt whose hold expired is still ledgered`, and mutation S1 turns it red.
- **Commit:** `7ce1abc`, `b4ff7f0`

**3. [Rule 2 - Correctness] `settleOrRelease` and `settleInFlight` re-read the run first (M46), without requiring `running`**
- **Issue:** The must-have says the step's first statement re-reads the run under RLS. The plan specified this only for `reservePage`.
- **Fix:** A foreign org now fails closed with `WorkerOrgMismatch` on the settle paths too (asserted for `settleInFlight`). `running` is deliberately NOT required, because a killed run's in-flight attempt still has to be ledgered.

**4. [Rule 2 - Correctness] Small hardening, each tested**
- `modeAllows` refuses an unknown mode as `places_off` instead of letting a cast value through.
- `withWorkerOrg` refuses a blank org id before opening a transaction.
- `settleInFlight` refuses a reservation whose sku is not a Text Search tier before minting.
- `reservePage` repeats `status = 'running'` in the ceiling UPDATE, so a kill that lands between the read and the bump still stops the page.

**5. Acceptance grep `^vi.mock(` is not empty: it matches `vi.mock('server-only', () => ({}))`**
- **Why it is needed:** `tests/db/_drizzle-tx.ts` statically imports `src/db/drizzle-executor.ts`, which imports `server-only`.
- **Precedent:** this is the same line four other DB files carry (review-actions, with-org, run-report, provenance-render).
- **What the grep protects is still true:** the worker helper is mocked only by `vi.doMock` plus dynamic import, and that mock is undone in `afterAll`.

**6. Added tests beyond the plan's twelve:**
- DB: `an unknown outcome on an abandoned page settles as charged and clears the cursor`, `two charged attempts at the same page are two ledger rows`, `a crashed attempt whose hold expired is still ledgered`, `the meter ran only through the worker double` (a harness guard: if the doMock had not taken, the reservation would be invisible in the rolled-back transaction), and two tests of the REAL `withWorkerOrg` on the app_user pool.
- Unit: `enterprise permits the full and the ids-only mask`, `an unknown mode refuses rather than defaulting open`, `a refused mode never reaches the database`.

**7. Verify commands.** Following the orchestrator's Windows notes, I used `npx vitest run [--config vitest.db.config.ts --pool=forks] <file> --reporter=verbose` rather than `$PNPM test:* -t`, and read every name.

**Total deviations:** 2 bug fixes (Rule 1) and 2 hardening items (Rule 2), all inside the plan's files. The two process notes are items 5 and 7. There was no architectural change and no migration.

## How the worker path is proven without `actAs`

- The meter's DB tests never call `actAs` on the meter path. The double installs exactly what the real helper does: `{o:{id}}` with no subject or role, the actor GUC, and `set local role authenticated`.
- The real helper is proven separately on the runtime `app_user` pool: the claims JSON is exactly `{"o":{"id":…}}`, `current_user = authenticated`, `app.current_org_role()` is null, and both GUCs are gone after COMMIT on the same pooled connection.
- `actAs` appears in only two places:
  1. The admin `set_budget_cap` fixture that lowers the cap.
  2. The self-heal call that simulates an expired hold.

  Both are fixture setup outside the meter.

## Merge notes

- **Files:** 4 new files and one edit in `tests/unit/places-client.test.ts`: the minter test's last assertion, two lines plus a comment, now an equality. 04-12's other tests in that file are untouched.
- **Not touched:** no migration, no `.planning` file other than this SUMMARY, and no STATE.md or ROADMAP.md.
- **Fixture fix needed before the phase suite is green:** 04-15's `pa_features_numeric` needs the fixture update described above. It is not in this plan's scope.
- **Guards:** `tests/unit/places-client.test.ts` now REQUIRES `src/lib/places/meter.ts` to mint. A later plan that moves minting elsewhere must change the equality deliberately.
- Nothing was pushed, production was not touched, and no Google call was made.

## Known Stubs

None. `reservePage` has no production caller yet by design: 04-18's workflow steps are its first.

## Threat Flags

None beyond the plan's threat model.
- T-4-02: mitigated (M28, M34a/b, S2–S5).
- T-4-03: mitigated (`a run that is no longer running reserves nothing`, plus the `status = 'running'` predicate in the UPDATE).
- T-4-06: mitigated (M46, W1–W3).
- T-4-12: accepted as planned. `calls_count` stays tenant-updatable; `ceiling_requests` has no UPDATE grant.

## TDD Gate Compliance

- **Task 1:** `test(04-16)` `0b37d11` was RED (module not found), then `feat(04-16)` `36717bf` was GREEN.
- **Task 2:** `test(04-16)` `60716a7` was RED: `reservePage is not a function`, and the equality failed with `[]`. Then `feat(04-16)` `7ce1abc` was GREEN.
- **Task 3:** the DB tests were written after the implementation, as the plan orders. Their RED gate is the mutation table above: every guard went red by name and then back to green.

## Self-Check: PASSED

- FOUND: src/db/with-worker-org.ts, src/lib/places/meter.ts, tests/unit/places-meter-mode.test.ts, tests/db/places-meter.test.ts
- FOUND commits: 0b37d11, 36717bf, 60716a7, 7ce1abc, b4ff7f0
