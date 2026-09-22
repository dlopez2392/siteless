---
phase: 02-budget-governor-search-presets
plan: 08
subsystem: budget-governor
tags: [database, concurrency, mutation-testing, rls, grants, clerk-claims, timezone, money]

# Dependency graph
requires:
  - 02-02 (tests/db/_concurrency.ts — openTestClients / withCommittedFixture, 40 distinct backend PIDs)
  - 02-05 (drizzle/0014-0016: the three tables, the five SECURITY DEFINER functions, the narrowed audit trigger)
  - phase-01 (tests/db/_fixtures.ts — withRollback / actAs / actAsOwner / seedTwoOrgs)
provides:
  - ROADMAP success criterion 5, EXECUTED: 40 concurrent workers, 10 granted, 30 denied, 0 errors, reserved+spent == cap
  - tests/db/budget-meter.test.ts — 14 single-worker meter invariants
  - tests/db/budget-admin-gate.test.ts — 11 admin-gate / audit / Chicago-month tests
  - tests/db/budget-concurrency.test.ts — the 4 committing burst tests
  - executed gate results for M7, M8, M9 (+M9b), M10 and two supporting mutations
affects: [02-15 (the phase gate re-runs M7-M12), phase-03-ingest, phase-04-places]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A mutation must be SURGICAL: swap the one statement under test, never rewrite the body — a rewrite reds tests it merely deleted"
    - "Reverting a function from its migration file requires normalising CRLF first, or pg_get_functiondef can never match the pre-mutation capture"
    - "A committing DB test verifies its own cleanup from a later test, rather than assuming the finally ran"
    - "Every burst assertion is two-sided: reserved+spent == cap refuses both the over-spend and the under-grant"

key-files:
  created:
    - tests/db/budget-meter.test.ts
    - tests/db/budget-admin-gate.test.ts
    - tests/db/budget-concurrency.test.ts
  modified:
    - tests/db/_concurrency.ts
    - tests/db/_fixtures.ts
    - .planning/phases/02-budget-governor-search-presets/02-VALIDATION.md

key-decisions:
  - "CONCURRENCY_PROVIDER changed from 'places_concurrency_fixture' to 'anthropic': bp_provider_known and app.ensure_budget_period both refuse any other value, so the fixture could not be inserted at all. Isolation comes from the dedicated ORG plus the 2099 period instead."
  - "M9 as specified reds FOUR tests, not one — the UNIQUE index is the arbiter of `on conflict (request_id)`, so dropping it makes every settlement raise 42P10. M9b (delete only the clause) is the one-test discriminator and is recorded beside it."
  - "M7 as specified does NOT over-spend on this schema: bp_not_over catches the naive body and turns 30 denials into 30 raised exceptions. RESEARCH's 40/400 control reproduces only with BOTH walls down (measured: 37 granted, 370 reserved)."
  - "The concurrency cleanup now also removes the fixture org's events rows, last — after the budget_periods DELETE trigger has written its own — so a committing test does not accumulate audit rows across runs."

requirements-completed: [BUDG-01, BUDG-02]

# Metrics
duration: 62min
completed: 2026-09-22
---

# Phase 2 Plan 08: The Budget Meter, Proven Summary

**Forty genuinely concurrent connections hit a cap that fits ten: ten granted, thirty refused with zero rows and zero errors, `reserved + spent` exactly 100 — and with the meter's single conditional UPDATE swapped for the naive read-then-decide body, 37 of 40 were granted and 370 reserved against that same cap of 100, while every single-worker test stayed green.**

---

## Performance

- **Duration:** 62 min
- **Tasks:** 3 of 3
- **Files created:** 3 · **modified:** 3
- **DB suite:** 31 tests at the Phase 1 baseline → **90** now (15 files), **+29 from this plan**

## Task Commits

| # | Task | Commit |
|---|------|--------|
| 1 | The single-worker meter invariants | `01011d6` |
| 2 | The admin gate, both Clerk spellings, the audited cap, the Chicago month | `14fd271` |
| 3 | The 40-way concurrent burst — success criterion 5 | `6575158` |

Plan metadata (this SUMMARY + 02-VALIDATION.md) committed separately. **STATE.md and ROADMAP.md deliberately untouched** — the orchestrator owns those.

---

## Success criterion 5, executed

```
[burst] N=40 cap=100 unit=10 -> granted=10 denied=30 errors=0 reserved=100 spent=0 in 177ms
[burst/self-heal]              granted=10            errors=0 reserved=100 released=5
```

Four assertions, and assertion 3 is two-sided on purpose:

1. exactly **10** rows carry a non-null `reservation_id`
2. exactly **30** carry `null` — a denial is zero rows, not an error
3. `reserved + spent === 100` — catches the over-spend **and** the under-grant a meter that refused everybody would produce
4. **zero** errors thrown by any of the 40 calls, asserted first and by content so a deadlock names itself

The self-heal variant pre-loads five EXPIRED reservations holding the entire cap and then fires the same 40-way burst: still exactly 10 granted, `reserved` back at 100, all five expired rows released. A crashed worker's budget is reclaimed by the next caller with no scheduler anywhere in the path.

---

## `pnpm test:db` — 15 files, 90 tests, exit 0, by NAME

The 29 this plan added (the other 61 are Phase 1's and waves 1–2's, all still green):

```
✓ budget-meter.test.ts > reserve: a grant returns a reservation id and moves reserved
✓ budget-meter.test.ts > denied returns null: a denial is zero rows, not an exception
✓ budget-meter.test.ts > bp_not_over refuses a hand-written over-reserve
✓ budget-meter.test.ts > cap at exactly spent plus reserved is accepted
✓ budget-meter.test.ts > cap below current spend is refused
✓ budget-meter.test.ts > self-heal: a crashed worker's expired reservations are released by the next reserve
✓ budget-meter.test.ts > self-heal does not release a live reservation
✓ budget-meter.test.ts > threshold: the 80 percent crossing emits exactly one events row per period
✓ budget-meter.test.ts > threshold: at 100 percent every new reservation is refused
✓ budget-meter.test.ts > settlement idempotency: settle twice with one request_id
✓ budget-meter.test.ts > settlement: reserve the worst case, settle the actual
✓ budget-meter.test.ts > settlement: a zero-cost paid-SKU call still writes a ledger row
✓ budget-meter.test.ts > cost_cents renders micro-USD exactly
✓ budget-meter.test.ts > server version: the test database is at least PostgreSQL 17
✓ budget-admin-gate.test.ts > current_org_role resolves the v2 bare claim
✓ budget-admin-gate.test.ts > current_org_role resolves the v1 prefixed claim
✓ budget-admin-gate.test.ts > current_org_role returns null for a member
✓ budget-admin-gate.test.ts > set_budget_cap refuses a member
✓ budget-admin-gate.test.ts > set_budget_cap accepts an admin
✓ budget-admin-gate.test.ts > budget_periods holds no direct UPDATE for authenticated
✓ budget-admin-gate.test.ts > cap change is audited
✓ budget-admin-gate.test.ts > a reservation does NOT write an events row
✓ budget-admin-gate.test.ts > two zones: one instant, opposite month verdicts in SQL
✓ budget-admin-gate.test.ts > two zones: October's period begins at 05:00Z and March's at 06:00Z
✓ budget-admin-gate.test.ts > set_budget_cap buckets the period in Chicago, not UTC
✓ budget-concurrency.test.ts > concurrent burst: 40 workers against a cap that fits 10
✓ budget-concurrency.test.ts > concurrent burst: open reservations equal the grants
✓ budget-concurrency.test.ts > concurrent burst survives a crashed worker holding the whole cap
✓ budget-concurrency.test.ts > the fixture cleans up after itself and leaves the org in place

Test Files  15 passed (15)
     Tests  90 passed (90)
```

Filtered runs, with the NAMES read (a `-t` filter matching nothing exits 0 green):

| Command | Result |
|---|---|
| `test:db -t "settlement idempotency"` | 1 passed / 74 skipped — names `settlement idempotency: settle twice with one request_id` |
| `test:db -t "set_budget_cap"` | 3 passed — names `refuses a member`, `accepts an admin`, `buckets the period in Chicago, not UTC` |
| `test:db -t "current_org_role"` | 3 passed — names all three |
| `test:db -t "concurrent burst"` | 3 passed — names all three |

Other gates (exit codes read directly, never through a pipe): `typecheck` **0** · `lint` **0** · `test:unit` **0** (16 files / 63 tests). `pnpm verify` was not run as a whole — it shells out to bare `pnpm`, which on this machine is the wrong global 11.9.0. `pnpm build` was not run: nothing outside `tests/` changed.

Branch and HEAD printed **after** the gates: `worktree-agent-aa437b26f5024d5a7` @ `6575158`.

---

## The mutation matrix — every red set side by side

Each applied to the **live local database only**, never to a migration file, and each reverted with `pg_get_functiondef` / `pg_constraint` / `information_schema.role_table_grants` compared **byte-for-byte against a capture taken before any mutation**. `git diff --stat` empty after each.

| Mutation | Tests it reds | Stayed green |
|---|---|---|
| **M8** `drop constraint bp_not_over` | `bp_not_over refuses a hand-written over-reserve`, `cap below current spend is refused` (2) | `cap at exactly spent plus reserved is accepted` — the boundary-exact positive control |
| **M9** `drop constraint cost_ledger_request_id_key` | `settlement idempotency`, `settlement: reserve the worst case`, `zero-cost paid-SKU`, `cost_cents` (**4**) | everything else |
| **M9b** delete only the `on conflict … do nothing` clause | `settlement idempotency: settle twice with one request_id` (**1**, `23505`) | the other three settlement tests |
| **M-self-heal** remove step 1 from `app.reserve_budget` | `self-heal: a crashed worker's expired reservations are released by the next reserve` (1) | `self-heal does not release a live reservation` |
| **M10** `current_org_role()` returns the literal `'admin'` | `set_budget_cap refuses a member`, `current_org_role returns null for a member` (2) | `set_budget_cap accepts an admin`, and both claim-spelling tests |
| **MGRANT** `grant update on budget_periods to authenticated` | `budget_periods holds no direct UPDATE for authenticated`, plus 02-05's `authenticated holds exactly the DML each Phase 2 table needs` (2) | `set_budget_cap refuses a member` — **the two cap refusals rest on different invariants** |
| **M7** naive meter, surgical | all three `concurrent burst` tests (3) | **every single-worker test in the suite — 87 passed** |
| **M7 + M8** both walls down | the same three | — |

No two rows share a red set. The guards are not coupled.

### M7, the control that makes criterion 5 a proof

```
real meter           granted=10 denied=30 errors=0  reserved=100          (cap 100)
M7 alone             granted=10 denied=0  errors=30 reserved=100
M7 + M8 (both walls) granted=37 denied=3  errors=0  reserved=370   <-- 3.7x OVER CAP
```

🔴 **M7 alone does not over-spend on this schema, and that is a finding, not a failure.** `bp_not_over` is the second wall underneath the conditional UPDATE: the naive body's unconditional `UPDATE` violates it, so 30 of the 40 workers get `23514` instead of a reservation. The meter's contract — *a denial is zero rows, never an exception* — is still broken (30 crashed workflow steps), and the burst test reds either way, but RESEARCH's measured 40-of-40 / reserved-400 only reproduces once the constraint is dropped as well. Measured there: **37 granted, 370 reserved against a cap of 100.**

🔴 **M7 must be surgical.** The first attempt rewrote the whole function body and reded `self-heal` and `threshold: the 80 percent crossing` as well — which would have proved only that the rewrite had deleted them. Swapping **only** the conditional UPDATE leaves every single-worker test green, which is the property that proves the concurrency file is not redundant with `budget-meter.test.ts`.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The concurrency fixture's provider could not exist**

- **Found during:** Task 3
- **Issue:** `tests/db/_concurrency.ts` (plan 02-02) declares `CONCURRENCY_PROVIDER = 'places_concurrency_fixture'`, and the plan repeats the "dedicated provider/period pair" instruction. But migration 0014's `bp_provider_known` admits exactly `('places','firecrawl','anthropic')`, and `app.ensure_budget_period` refuses anything else with `22023` before the constraint is even reached. The fixture row could not be inserted at all, so the burst would have failed on its own setup rather than on the meter. 02-02 could not have caught this: the budget tables did not exist when it shipped the harness, and its own smoke test was read-only.
- **Fix:** `CONCURRENCY_PROVIDER = 'anthropic'`, with a comment explaining why a free-form name is impossible. The isolation is **stricter** than a provider name would have been: the fixture has its own `orgs` row and a period start of 2099-01-01, and every other test in the suite runs inside a rolled-back transaction under `org_A`/`org_B`.
- **Commit:** `6575158`

**2. [Rule 1 — Bug] The cleanup scoped `cost_reservations` by a column that table does not have**

- **Found during:** Task 3
- **Issue:** `cleanupConcurrencyRows` ran `delete from cost_reservations where org_id = $1 and provider = $2`. `cost_reservations` has **no `provider` column** — the provider lives on the budget period it references, and only `cost_ledger` denormalises it (migration 0014). The delete raised `42703`, aborting a cleanup that runs inside a `finally`, which meant the burst's committed rows survived into the next run and the real failure was masked by the cleanup's.
- **Fix:** scope that delete by `budget_period_id in (select id from budget_periods where org_id = $1 and provider = $2)`. While there, each step now carries its **own** parameter list — a single shared `[org, provider]` list broke the moment one statement needed only the org (`08P01 bind message supplies 2 parameters…`, again from inside the `finally`).
- **Commit:** `6575158`

**3. [Rule 2 — Missing critical] The committing fixture accumulated audit rows forever**

- **Found during:** Task 3
- **Issue:** The burst commits, so the `budget_periods` INSERT and DELETE both fire `app.log_event` and leave `events` rows behind for an org no human will ever look at. Nothing cleaned them, so every CI run would add more.
- **Fix:** an `events` step scoped to the fixture org, ordered **last** — after the `budget_periods` delete, whose AFTER DELETE arm writes one more row. Deleting an events row is safe (nothing references it); deleting the **org** is not and still never happens (Pitfall 8).
- **Verification:** `events` is back to **0** rows after the full suite, matching the pre-run baseline exactly.
- **Commit:** `6575158`

**4. [Rule 3 — Blocking] `Claims` could not express the v1 prefixed role at all**

- **Found during:** Task 2
- **Issue:** `tests/db/_fixtures.ts`'s `Claims` union carries `org_id` but no `org_role`, so `actAs(c, { org_id: 'org_A', org_role: 'org:admin', … })` is a TypeScript excess-property error. The v1 half of the D-10 claim-spelling pair — the whole point of the test — could not be written.
- **Fix:** added `org_role?: string` to the v1 arm, with a comment recording why the two shapes spell the role differently and that `app.current_org_role()` is what normalises them.
- **Commit:** `14fd271`

**5. [Rule 1 — Bug] `cost_cents` arithmetic assertion compared the wrong rendering**

- **Found during:** Task 1
- **Issue:** The plan's `select (35000::bigint * 1428) / 10000.0` returns `4998.0000000000000000` — the same money, a different string. The assertion as written was red against a correct database.
- **Fix:** two assertions instead of one: the arithmetic (`… = 4998` is **true**, no remainder) and the rendering, cast to `cost_cents`'s own `numeric(12,2)` → `'4998.00'`. The point of the test — that integer cents would render `$57.12` or `$42.84` — is unchanged.
- **Commit:** `01011d6`

**6. [Rule 3 — Blocking] A function reverted from its migration file never matches the capture**

- **Found during:** Task 1 (the self-heal mutation's revert)
- **Issue:** The migration files are checked out with **CRLF**; the migrator that originally applied them fed PostgreSQL LF-only text. Re-creating a function straight from the file stores a semantically identical body that differs from the pre-mutation `pg_get_functiondef` by one `\r` per line, so the revert cannot be **proven** — only asserted.
- **Fix:** normalise `\r\n` → `\n` before executing. Both `app.reserve_budget` and `app.settle_reservation` were then restored byte-identical (0 `\r`, 5249 and 3103 chars), verified against the capture.
- **Recorded in:** `02-VALIDATION.md` (so plan 02-15's gate run does not rediscover it)

---

**Total deviations:** 6 auto-fixed (3 bugs, 1 missing-critical, 2 blocking). **Impact:** no scope change. Two of them (#1, #2) were latent defects in the 02-02 harness that only a consumer could surface; the rest are plan-text corrections whose underlying properties are unchanged.

### Plan text vs reality (no code change)

- **M9 reds four tests, not one** — the UNIQUE index is the `on conflict` arbiter. M9b is the one-test discriminator; both are recorded above and in `02-VALIDATION.md`.
- **M7's over-spend needs M8 applied too.** With `bp_not_over` standing, the naive body raises rather than over-spends.
- **M10 reds two tests, not one** — the gate and the resolver are independent properties, exactly as Phase 1's M3 and M5 were recorded. The plan anticipated this and asked for it to be recorded if it happened.
- The plan's `<verification>` cites `drizzle/0015_budget_meter_functions.sql` for the restore; the meter functions are in **0016** (02-05's SUMMARY records why).

---

## Database state — left as found

Read before any write and again after the final suite run, against the shared local `siteless_test`:

| | before | after |
|---|---|---|
| `drizzle.__drizzle_migrations` | 17 | **17** |
| `app` functions | 11 | **11**, all byte-identical |
| `budget_periods` / `cost_reservations` / `cost_ledger` / `events` | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** |
| reference tables (counties/cities/clusters/terms/outlet-counts/geo-presets) | 254 / 17 / 4 / 33 / 20 / 3 | **unchanged** |
| `orgs` | 0 | **1** |

🔴 **The one delta is deliberate and mandatory.** `orgs` holds the `org_concurrency_fixture` row, which the harness is forbidden to delete: `app.log_event`'s AFTER DELETE arm inserts an `events` row referencing the org that was just deleted and violates `events_org_id_orgs_id_fk`, wedging the suite (RESEARCH Pitfall 8). The plan's own acceptance criterion requires it to remain. It is created `on conflict do nothing`, so a re-run and a first run are identical.

No migration was applied, generated, seeded, dropped or truncated. The Supabase MCP was never used. `.env.local` was copied in from the main tree and is **not tracked**.

## Criterion-level greps

| Check | Required | Result |
|---|---|---|
| `grep -c 'withRollback' tests/db/budget-concurrency.test.ts` | 0 | **0** |
| `grep -cE 'delete +from +orgs' tests/db/budget-concurrency.test.ts` | 0 | **0** |
| the same grep over `tests/db/_concurrency.ts` | 0 | **0** |
| `grep -c 'org_role' tests/db/budget-admin-gate.test.ts` | ≥1 | **8** |
| `grep -c 'rol:' tests/db/budget-admin-gate.test.ts` | ≥2 | **3** |

## Issues Encountered

None outstanding. The two harness defects (#1, #2) were fixed at source rather than worked around in the test, so plan 02-15's gate run and Phase 3/4 inherit a working fixture.

## Known Stubs

None.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema — it is the evidence for T-2-02 through T-2-07 and T-2-11, every one of which now has a named test **and** a mutation that reds it.

## Next Phase Readiness

**Ready.** BUDG-01 and BUDG-02 now have their tests as well as their mechanism, so `REQUIREMENTS.md` can be marked (02-05 deliberately left them open pending this plan). Phase 3/4's instrumented paid call has a meter that is proven under concurrency, and plan 02-15's phase gate can re-run M7–M12 against the corrected recipes recorded in `02-VALIDATION.md`.

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All three created files exist on disk and are tracked by git.
- All three task commits resolve: `01011d6`, `14fd271`, `6575158`.
- Every mutation reverted; catalog compared byte-for-byte against the pre-mutation capture, all three checks `true` on each revert; `git status --short` shows only this SUMMARY and `02-VALIDATION.md` before this commit.
- Every scratch file used for the mutation runs deleted; `.env.local` not tracked.
- `.planning/STATE.md` and `.planning/ROADMAP.md` **unmodified** against the plan base `eff681b`.
- `pnpm test:db` exit **0**, 90/90, re-run after the last revert.
