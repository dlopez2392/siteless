---
phase: 01-foundations-tenancy
plan: 09
subsystem: database
tags: [postgres, trigger, plpgsql, audit-log, rls, grants, drizzle, security-definer, mutation-testing]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 05)
    provides: 'orgs / events / businesses, app.jwt(), app.current_org_id(), orgScoped + orgPolicies, tests/db/_fixtures.ts (withRollback, actAs, actAsOwner, seedTwoOrgs), the D-10 schema-audit enumeration'
  - phase: 01-foundations-tenancy (plan 07)
    provides: 'source_records with the retention CHECKs and the composite FK — the third table the touch trigger attaches to, and the table deliberately excluded from row-level event logging'
provides:
  - 'app.log_event() — SECURITY DEFINER AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW trigger function; a raw SQL write no application code made still produces an attributed events row (D-08)'
  - 'app.touch_updated_at() — BEFORE UPDATE trigger function filling D-07 denormalized updated_at / updated_by on orgs, businesses and source_records'
  - 'The DECIDED event-scope boundary: log_event on state-bearing tables only (orgs, businesses); source_records excluded because Phase 3 bulk ingest would write ~10k events per run'
  - 'events immutable by GRANT not by policy — revoke update, delete from authenticated, so the refusal is 42501 "permission denied for table events" and not a silent zero-row RLS filter (D-06)'
  - 'tests/db/event-trigger.test.ts — D-08 acceptance test, the D-07 domain-only UPDATE proof, and the trigger-coverage enumeration that also requires each trigger to be ENABLED'
  - 'tests/db/events-append-only.test.ts — two grant refusals in two separate transactions, each pinning 42501 AND the grant wording'
  - '.planning/CONVENTIONS.md — the schema, event-scope, migration and testing contract Phases 2 and 3 read instead of re-deriving'
affects: [01-10-prod-migrate, 01-11-phase-verification, phase-02-ui, phase-03-entity-resolution, phase-04-places-verifier, phase-07-triage-and-leads]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Attribution is a property of the database: an AFTER ... FOR EACH ROW trigger, never an application-tier write helper — the acceptance test is a raw SQL write and a helper cannot pass it'
    - 'Immutability is a GRANT, not a policy: a revoked privilege raises 42501 with a distinct message, where a missing policy merely filters to zero rows and a later `for all` policy would silently reopen it'
    - 'Every SECURITY DEFINER function pins set search_path on the SAME statement (ASVS V4)'
    - 'A coverage enumeration must assert the guard FIRES, not merely that its row exists — pg_trigger keeps the row after `disable trigger`'
    - 'Mutations are applied to the live database, never to the migration file, so the revert is provable by construction and verifiable from pg_trigger / pg_get_functiondef / information_schema.role_table_grants'
    - 'now() is transaction_timestamp() and is constant for the whole transaction: an insert-then-update inside one withRollback needs a deliberately aged baseline or the "strictly greater" assertion is unfalsifiable'

key-files:
  created:
    - drizzle/0007_event_triggers.sql
    - drizzle/meta/0007_snapshot.json
    - tests/db/event-trigger.test.ts
    - tests/db/events-append-only.test.ts
    - .planning/CONVENTIONS.md
  modified:
    - drizzle/meta/_journal.json

key-decisions:
  - 'Gate mutation M3 (`drop trigger businesses_event on businesses`) reds TWO tests, not the one 01-VALIDATION.md predicts: the behaviour test and the coverage enumeration. This is NOT 01-05 M1-style accidental coupling — the two assert different things (the trigger WORKS vs. the trigger EXISTS everywhere it must) and a drop removes the only thing both depend on. Independence was proven separately: disabling the trigger reds only the behaviour test, and collapsing the actor chain to the literal system reds only the behaviour test while coverage stays green.'
  - "Rule 2 fix: the coverage enumeration accepted a DISABLED trigger. `alter table businesses disable trigger businesses_event` leaves the pg_trigger row with tgenabled='D', so the test reported full attribution coverage while attribution was off — executed, and the suite stayed green except for the behaviour test. The query now returns tgenabled and refuses anything outside 'O'/'A'."
  - "The D-07 test backdates its insert (`updated_at = now() - interval '1 hour'`). now() is transaction_timestamp() and is CONSTANT for a transaction, so inside one withRollback the insert and the update would stamp the identical value and `toBeGreaterThan` could never discriminate a working trigger from a missing one. The trigger keeps now() — it is the correct semantic, and in production the two writes are two transactions."
  - "Two plan-prescribed comment texts were reworded because they spelled tokens the plan's own acceptance greps require absent from the same file: the bare `.rejects.toThrow()` form in the events-append-only header, and a second `set search_path = public` in the migration comment. Same house precedent as 01-06/01-07/01-08 — a comment naming the thing it forbids trips the guard it describes."
  - 'drizzle/meta/0007_snapshot.json is committed alongside the .sql even though the plan lists only the .sql and the journal. It is the diff base for the next generate; omitting it would make drizzle-kit re-emit the whole schema in Phase 2.'
  - 'The touch trigger is attached BEFORE UPDATE on source_records even though source_records gets no log_event trigger — the two boundaries are different questions: write amplification (events) vs. an honest updated_at (touch).'

patterns-established:
  - 'A mutation that reds two tests is not automatically a coupling defect — establish independence with a narrower mutation that reds one, and record both.'
  - 'Prove a DDL revert from the catalog, not from the fact that a script ran: md5(pg_get_functiondef(...)) captured before the mutation and compared after the restore.'
  - 'A guard over existence must be paired with a guard over effect. `present` and `firing` are different properties and only one of them is the requirement.'

requirements-completed: [FOUND-03, FOUND-01, FOUND-06]

# Metrics
duration: 20 min
completed: 2026-09-21
---

# Phase 1 Plan 09: Event Triggers and Append-Only Enforcement Summary

**`app.log_event()` as an AFTER-ROW trigger on `orgs` and `businesses` plus `app.touch_updated_at()` BEFORE UPDATE on those and `source_records`, with `update`/`delete` on `events` revoked from `authenticated` — so a raw SQL write nothing in `src/` made still produces an attributed, immutable audit row.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-22T03:02Z
- **Completed:** 2026-09-22T03:21Z
- **Tasks:** 3
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- **D-08 is enforced, not conventional.** A raw `insert into businesses …` issued by the test itself — no ORM, no helper, no `emit()` — produces `{ actor_id: 'user_danlo', entity_type: 'businesses', action: 'insert', after->>'display_name': 'direct-write' }` with a non-null `occurred_at`. The actor comes from `app.jwt()->>'sub'`, falling back to the `app.actor_id` GUC and then `'system'`.
- **D-06 is a GRANT.** `update events` and `delete from events` as `authenticated` are both `42501` **with the message `permission denied for table events`** — pinned separately from the RLS refusal's `new row violates row-level security policy`, in two separate transactions.
- **D-07 is honest.** An `update businesses set city = 'McAllen'` — naming no timestamp column — moves `updated_at` and stamps `updated_by = 'user_danlo'`.
- **The event-scope boundary is decided and written down**, closing RESEARCH open question 4 / assumption A7. `source_records` is deliberately excluded from row-level event logging.
- **Every `SECURITY DEFINER` function pins `set search_path = public`** on the same statement (T-1-07).
- **Three gate mutations run and recorded**, plus two extra discriminating mutations run to establish test independence — one of which found and closed a real hole in the coverage guard.

## Task Commits

1. **Task 1: Write the audit tests — and watch them fail** — `a25393e` (test)
2. **Task 2: The event and touch triggers, the events grant revocation, and green** — `a163879` (feat)
3. **Task 3: Mutation check, and write the conventions Phases 2 and 3 read** — `e757e19` (test, the Rule 2 coverage-guard fix) and `b4b8ff7` (docs, `.planning/CONVENTIONS.md`)

## Files Created/Modified

- `drizzle/0007_event_triggers.sql` — `app.log_event()`, `app.touch_updated_at()`, the two attachment loops, and the events grant/revoke
- `drizzle/meta/0007_snapshot.json` — the diff base for the next `db:generate`
- `drizzle/meta/_journal.json` — entry 7, `0007_event_triggers`
- `tests/db/event-trigger.test.ts` — D-08's acceptance test, D-07's domain-only UPDATE proof, the trigger-coverage enumeration
- `tests/db/events-append-only.test.ts` — the two grant refusals, one per transaction
- `.planning/CONVENTIONS.md` — the contract Phases 2 and 3 read

## Watched failing first

All four filtered runs were executed with `--reporter=verbose` (the default reporter prints no test names under `-t`, and a filter matching nothing exits 0 green). Each run exited **1** and named its test. The pg `Result` object dumps in runs 2's diff are ~60 lines of `TypeOverrides` builtins each and are elided below at the marked point; nothing else is trimmed.

### 1. `pnpm test:db -t "direct write still produces an event"` — EXIT 1

```
 × tests/db/event-trigger.test.ts > attribution is a property of the database > a direct write still produces an event 105ms
   → expected [] to have a length of 1 but got +0

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/db/event-trigger.test.ts > attribution is a property of the database > a direct write still produces an event
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ tests/db/event-trigger.test.ts:92:26
     90|
     91|       const first = await c.query<LatestEvent>(LATEST_BUSINESS_EVENT);
     92|       expect(first.rows).toHaveLength(1);
       |                          ^
     93|       expect(first.rows[0]).toMatchObject({
     94|         actor_id: 'user_danlo',
 ❯ withRollback tests/db/_fixtures.ts:43:5

 Test Files  1 failed | 7 skipped (8)
      Tests  1 failed | 24 skipped (25)
```

Expected reason, confirmed: the events query returns no rows.

### 2. `pnpm test:db -t "append-only"` — EXIT 1

```
 × tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: UPDATE as authenticated is refused 85ms
   → promise resolved "Result{ command: 'UPDATE', …(9) }" instead of rejecting
 × tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: DELETE as authenticated is refused 64ms
   → promise resolved "Result{ command: 'DELETE', …(9) }" instead of rejecting

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: UPDATE as authenticated is refused
AssertionError: promise resolved "Result{ command: 'UPDATE', …(9) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ Result {
    [... ~60 lines of pg TypeOverrides builtins elided ...]
+   "command": "UPDATE",
+   "fields": [],
+   "oid": null,
+   "rowAsArray": false,
+   "rowCount": 0,
+   "rows": [],
  }

 ❯ tests/db/events-append-only.test.ts:31:28
     29|       await actAs(c, ORG_A_CLAIMS);
     30|       const attempt = c.query("update events set action = 'hacked'");
     31|       await expect(attempt).rejects.toMatchObject({ code: '42501' });

 FAIL  tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: DELETE as authenticated is refused
AssertionError: promise resolved "Result{ command: 'DELETE', …(9) }" instead of rejecting
    [... same shape, "command": "DELETE", "rowCount": 0 ...]

 Test Files  1 failed | 7 skipped (8)
      Tests  2 failed | 23 skipped (25)
```

Expected reason, confirmed **and visible in the received object**: `rowCount: 0` with no error — RLS filtered the statement to zero rows because the grant was still in place. This is precisely the "reads as nothing happened" failure mode the revoke exists to eliminate.

### 3. `pnpm test:db -t "updated_at"` — EXIT 1

```
 × tests/db/event-trigger.test.ts > attribution is a property of the database > an UPDATE of only a domain column still moves updated_at and stamps updated_by 91ms
   → expected 1790043023.894173 to be greater than 1790043023.894173

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/db/event-trigger.test.ts > attribution is a property of the database > an UPDATE of only a domain column still moves updated_at and stamps updated_by
AssertionError: expected 1790043023.894173 to be greater than 1790043023.894173
 ❯ tests/db/event-trigger.test.ts:145:42
    143|       );
    144|       expect(upd.rows).toHaveLength(1);
    145|       expect(Number(upd.rows[0]?.epoch)).toBeGreaterThan(beforeEpoch);
       |                                          ^
    146|       expect(upd.rows[0]?.updated_by).toBe('user_danlo');
 ❯ withRollback tests/db/_fixtures.ts:43:5

 Test Files  1 failed | 7 skipped (8)
      Tests  1 failed | 24 skipped (25)
```

Expected reason, confirmed: `updated_at` is unchanged (the backdated insert value, byte-identical). `updated_by` was null and never reached.

### 4. `pnpm test:db -t "after-row trigger"` — EXIT 1

```
 × tests/db/event-trigger.test.ts > attribution is a property of the database > every state-bearing table has an app.log_event after-row trigger 191ms
   → expected [] to deeply equal [ 'businesses', 'orgs' ]

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/db/event-trigger.test.ts > attribution is a property of the database > every state-bearing table has an app.log_event after-row trigger
AssertionError: expected [] to deeply equal [ 'businesses', 'orgs' ]

- Expected
+ Received

- [
-   "businesses",
-   "orgs",
- ]
+ []

 ❯ tests/db/event-trigger.test.ts:155:52
 ❯ withRollback tests/db/_fixtures.ts:43:5

 Test Files  1 failed | 7 skipped (8)
      Tests  1 failed | 24 skipped (25)
```

Expected reason, confirmed: the queried set is empty, not `{orgs, businesses}`.

### 5. The Rule 2 strengthening, watched failing first (Task 3)

Run with `businesses_event` still **disabled** (`tgenabled = 'D'`), before the assertion existed the set-equality half was green:

```
 × tests/db/event-trigger.test.ts > attribution is a property of the database > every state-bearing table has an app.log_event after-row trigger 87ms
   → expected [ { table_name: 'businesses', …(1) } ] to deeply equal []
AssertionError: expected [ { table_name: 'businesses', …(1) } ] to deeply equal []
      Tests  1 failed | 24 skipped (25)
```

### Green, after the migration

All four filters re-run, each naming its test:

```
-t "direct write still produces an event"  ✓  Tests  1 passed | 24 skipped (25)   EXIT 0
-t "updated_at"                            ✓  Tests  1 passed | 24 skipped (25)   EXIT 0
-t "after-row trigger"                     ✓  Tests  1 passed | 24 skipped (25)   EXIT 0
-t "append-only"                           ✓  Tests  2 passed | 23 skipped (25)   EXIT 0
```

Full suite: `pnpm test:db` → **Test Files 8 passed (8) / Tests 25 passed (25)**, exit 0. Baseline was 20 across 6 files; the five new tests are all named in the verbose output alongside every test from plans 05, 06 and 07. `pnpm test:unit` → **11 passed (11)**, exit 0. `pnpm typecheck` → 0. `pnpm lint` → 0.

## Mutation checks

Every mutation was applied to the **live database**, never to a migration file — which is what makes `git diff --stat` empty by construction and the revert provable from the catalog rather than from the fact that a script ran. Total suite size throughout: **25 tests, 8 files**.

### Mutation 1 (gate M3) — `drop trigger businesses_event on businesses;`

Applied and confirmed from `pg_trigger` (remaining `log_event` triggers: `orgs.orgs_event` only).

```
 × a direct write still produces an event                                → expected [] to have a length of 1 but got +0
 × every state-bearing table has an app.log_event after-row trigger      → expected [ 'orgs' ] to deeply equal [ 'businesses', 'orgs' ]
      Tests  2 failed | 23 passed (25)
```

**TWO tests red, not the one 01-VALIDATION.md predicts.** Recorded as run, not as reasoned. See Deviations — this is not 01-05 M1-style coupling, and independence was established by mutations 4 and 5 below.

**Restored** with the exact statement from the migration (`create trigger businesses_event after insert or update or delete on businesses for each row execute function app.log_event()`). Verified from `pg_trigger`: `businesses.businesses_event log_event enabled=O`. `pnpm test:db` → 25 passed (25).

### Mutation 2 — `grant update, delete on events to authenticated;`

Grants confirmed as `DELETE,INSERT,SELECT,UPDATE` from `information_schema.role_table_grants`.

```
 × events are append-only: UPDATE as authenticated is refused   → promise resolved "Result{ command: 'UPDATE', …(9) }" instead of rejecting
 × events are append-only: DELETE as authenticated is refused   → promise resolved "Result{ command: 'DELETE', …(9) }" instead of rejecting
      Tests  2 failed | 23 passed (25)
```

Two tests for one mutation — exactly what the plan anticipated. The plan's remedy ("split the revoke assertion so each grant has its own test") was already the file's structure, and that split was then **proven to discriminate** by two narrower mutations:

| Mutation | Grants after | Red |
|---|---|---|
| `grant update on events to authenticated` | `INSERT,SELECT,UPDATE` | `events are append-only: UPDATE as authenticated is refused` — **1 failed \| 24 passed** |
| `grant delete on events to authenticated` | `DELETE,INSERT,SELECT` | `events are append-only: DELETE as authenticated is refused` — **1 failed \| 24 passed** |

**Restored** with `revoke update, delete on events from authenticated;`. Verified: grants back to `INSERT,SELECT`. `pnpm test:db` → 25 passed (25).

### Mutation 3 — `drop trigger businesses_touch on businesses;`

The second mutation named in `tests/db/event-trigger.test.ts`'s own header.

```
 × an UPDATE of only a domain column still moves updated_at and stamps updated_by
   → expected 1790043400.258913 to be greater than 1790043400.258913
      Tests  1 failed | 24 passed (25)
```

**Exactly one test red.** Restored with the migration's statement; verified from `pg_trigger` (`businesses.businesses_touch touch_updated_at enabled=O`). `pnpm test:db` → 25 passed (25).

### Mutation 4 (extra) — `alter table businesses disable trigger businesses_event;`

Run to establish that the behaviour test discriminates independently of the coverage enumeration.

```
 × a direct write still produces an event   → expected [] to have a length of 1 but got +0
      Tests  1 failed | 24 passed (25)
```

**One test red — and the coverage enumeration stayed GREEN with the trigger disabled.** That is the hole the Rule 2 fix closes (see Deviations). After the fix, the same mutation reds both, so mutation 5 was added.

### Mutation 5 (extra) — collapse `app.log_event()`'s actor chain to the literal `'system'`

Applied via `create or replace` against the live database only; `md5(pg_get_functiondef(...))` moved `ffa7bea6…` → `4360a33c…`.

```
 × a direct write still produces an event
   → expected { actor_id: 'system', …(8) } to match object { actor_id: 'user_danlo', …(4) }
      Tests  1 failed | 24 passed (25)
```

**Exactly one test red, with the trigger present, enabled and the coverage enumeration green.** This is the discriminating mutation for the behaviour test under the strengthened guard, and it pins the attribution chain itself rather than the mere existence of an event row.

**Restored** by replaying the function block out of `drizzle/0007_event_triggers.sql`; `md5(pg_get_functiondef(...))` back to `ffa7bea61ab6109898beb268d081f2ab` — **byte-identical to the pre-mutation capture**. `pnpm test:db` → 25 passed (25).

### Post-revert state

```
$ git diff --stat
(no output — zero changed files)
$ git status --short
(no output — clean tree)
```

## Database state

- `drizzle.__drizzle_migrations`: **8 rows** (7 before + `0007_event_triggers`). `pnpm db:migrate` exited 0 **twice in a row**.
- `pg_trigger` non-internal: **5** — `orgs_event`, `businesses_event` (`log_event`); `orgs_touch`, `businesses_touch`, `source_records_touch` (`touch_updated_at`); all `tgenabled = 'O'`.
- `events` grants for `authenticated`: **`INSERT, SELECT`** only (was `DELETE, INSERT, SELECT, UPDATE`).
- `pnpm db:generate --name=noop` → `No schema changes, nothing to migrate 😴`. **No file and no journal entry were produced**, so there was nothing to delete. Triggers, functions and grants are not in the Drizzle TS schema and drizzle-kit did not try to remove them.
- `git diff --stat pnpm-lock.yaml package.json` → empty (see Deviation 4).
- Production Supabase was not touched. Every command ran against `TEST_DATABASE_URL` (local PostgreSQL 18 `siteless_test`); `scripts/db.ts --target=test` refuses a Supabase host by construction.

## Decisions Made

- **The coverage enumeration asserts the trigger FIRES, not just that it exists.** `tgenabled` must be `'O'` or `'A'`.
- **`source_records` gets the touch trigger but not the event trigger.** These are two different questions — write amplification versus an honest `updated_at` — and conflating them would either lose `updated_at` on ingest rows or write 10k events per Phase 3 run.
- **The trigger keeps `now()`**, not `clock_timestamp()`. `now()` is the correct semantic (the write's transaction time); the test carries the burden of an aged baseline instead.
- **`drizzle/meta/0007_snapshot.json` is committed** even though the plan's `files_modified` omits it — it is the diff base for the next `generate`.
- **`.planning/CONVENTIONS.md` was written from the code**: all four `src/db/schema/*.ts` files, migrations `0000`–`0007`, and a cross-check against `information_schema.columns` on the live database.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The trigger-coverage enumeration accepted a DISABLED trigger**

- **Found during:** Task 3 (mutation check)
- **Issue:** The enumeration existed to stop a state-bearing table shipping without attribution, but it only counted `pg_trigger` rows. `alter table businesses disable trigger businesses_event` leaves the row in place with `tgenabled = 'D'` — so the guard reported **full attribution coverage while attribution was silently off**. Executed and confirmed: with the trigger disabled, the whole suite was green except the behaviour test (mutation 4 above). A trigger that is present but never fires is the same failure the guard exists to catch, with a different cause, and `disable trigger` is a one-line thing a bulk-load script or a future migration does.
- **Fix:** `LOG_EVENT_TRIGGERS` now returns `t.tgenabled::text`, and the test refuses anything outside `'O'` (fires on ordinary writes) and `'A'` (fires always).
- **Files modified:** `tests/db/event-trigger.test.ts`
- **Verification:** Watched failing first with the trigger still disabled — `expected [ { table_name: 'businesses', …(1) } ] to deeply equal []`. Green once re-enabled; full suite 25/25.
- **Committed in:** `e757e19`

**2. [Rule 1 - Bug] The D-07 test's timestamp assertion was unfalsifiable as specified**

- **Found during:** Task 1 (writing the tests)
- **Issue:** The plan says "insert as owner, read `updated_at`, then … assert the new `updated_at` is strictly greater". `now()` is `transaction_timestamp()` and is **constant for the whole transaction**, and `withRollback` puts the insert and the update in one transaction — so both stamps are byte-identical whether the trigger fires or not, and `toBeGreaterThan` could never distinguish a working trigger from a missing one.
- **Fix:** The insert deliberately backdates its baseline (`updated_at = now() - interval '1 hour'`), restoring the discrimination two separate transactions would give in production. The trigger itself keeps `now()` — the plan's and RESEARCH's spelling — because that is the correct semantic. Documented in the test with the reason.
- **Files modified:** `tests/db/event-trigger.test.ts`
- **Verification:** RED reason is now exactly the plan's prediction (`expected 1790043023.894173 to be greater than 1790043023.894173` — unchanged), and mutation 3 (`drop trigger businesses_touch`) reds this test and only this test.
- **Committed in:** `a25393e`

**3. [Rule 3 - Blocking] Two plan-prescribed comment texts spelled tokens their own acceptance greps require absent**

- **Found during:** Tasks 1 and 2
- **Issue:** (a) `grep -c 'rejects.toThrow()' tests/db/events-append-only.test.ts` must return **0**, but the plan's verbatim header for that file contains `.rejects.toThrow()`; measured 1. (b) `grep -c 'set search_path = public' drizzle/0007_event_triggers.sql` must return **1**, but the plan's verbatim comment block above `app.log_event()` repeats the literal; would have measured 2.
- **Fix:** Both comments reworded to describe the doctrine without spelling the token, each noting that a grep counts it. Identical to the precedent set in 01-06, 01-07 and 01-08 — a comment naming the thing it forbids trips the guard it describes.
- **Files modified:** `tests/db/events-append-only.test.ts`, `drizzle/0007_event_triggers.sql`
- **Verification:** `grep -c 'rejects.toThrow()'` → 0; `grep -c 'permission denied for table events'` → 2; `grep -c 'security definer'` → 1; `grep -c 'set search_path = public'` → 1. The append-only filter was re-run after the header edit and is still red for the identical reason.
- **Committed in:** `a25393e`, `a163879`

**4. [Rule 3 - Blocking] The pnpm launcher added `@pnpm/exe` to the lockfile**

- **Found during:** Task 2
- **Issue:** This plan changes no dependencies, but running pnpm through the 12.5.1 launcher (bare `pnpm` on this machine resolves to a broken 11.9.0 shim — 01-01 deviation 1) added a 25-line `@pnpm/exe@12.5.1` entry to `pnpm-lock.yaml`.
- **Fix:** `git checkout -- pnpm-lock.yaml`. It was never staged or committed.
- **Files modified:** none (reverted)
- **Verification:** `git diff --stat pnpm-lock.yaml package.json` → empty, re-checked at the end of the plan.
- **Committed in:** n/a — reverted, as the machine's standing instruction requires.

### Recorded, not auto-fixed

**5. Gate mutation M3 reds two tests, where 01-VALIDATION.md predicts one**

Recorded as run rather than reasoned, per the plan's own instruction. `drop trigger businesses_event on businesses` reds both `a direct write still produces an event` and `every state-bearing table has an app.log_event after-row trigger`.

This is **not** the 01-05 M1 failure mode (two tests sharing one refusal, so a mutation cannot tell you which guard broke). The two assert genuinely different properties — that the trigger **works** versus that it **exists everywhere it must** — and dropping the trigger removes the single object both depend on, so both correctly fail. Making the coverage test survive a dropped trigger would defeat its only purpose.

Independence was established with two narrower mutations that each red exactly one test with the other green: disabling the trigger (mutation 4, pre-fix) and collapsing the actor chain (mutation 5, post-fix). **Recommendation for 01-VALIDATION.md:** record M3's expected result as two named tests, or re-point M3 at the actor-chain mutation, which reds exactly one.

---

**Total deviations:** 4 auto-fixed (1 missing critical, 1 bug, 2 blocking) + 1 recorded finding.
**Impact on plan:** No scope creep. Deviation 1 strengthens a guard this plan ships and was proven necessary by execution. Deviation 2 is the difference between a real assertion and a vacuous one. Deviations 3 and 4 are mechanical contradictions between plan text and plan acceptance criteria / a known machine quirk, both with established precedent in this phase.

## Issues Encountered

- **`pnpm verify` cannot run on this machine.** It exits 1 with `'…\bin\\..\node_modules\pnpm\pnpm' is not recognized as an internal or external command` — the script body is `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db` and the nested bare `pnpm` resolves to the broken 11.9.0 self-switch shim (the standing machine fact from 01-01). **All four constituents were run individually and each exited 0** (typecheck 0, lint 0, test:unit 11/11, test:db 25/25), which is the full content of `verify`. This is an environment defect, not a code defect, and it is unchanged by this plan. It will not affect CI, which invokes the constituents through its own pnpm.
- `psql` rejected `t.tgenabled` in a `||` concatenation with `operator is not unique: text || "char"` — `tgenabled` is `"char"`, not `text`. Cast added (`::text`) in both the ad-hoc queries and the test's SQL.

## Known Stubs

None. Every column, trigger, grant and test in this plan is wired to real behaviour and exercised against the live database.

## Threat Flags

None. The files changed introduce no new network endpoint, auth path, file-access pattern or trust-boundary schema change beyond the ones the plan's `<threat_model>` already registers (T-1-06, T-1-07, T-1-30, T-1-31, T-1-32), and each of those five is mitigated and tested here.

## User Setup Required

None — no external service configuration required. Everything in this plan ran against the local PostgreSQL 18 test database.

## Next Phase Readiness

**Ready for 01-10** (production migrate + Vercel deploy). What 01-10 inherits:

- Migration `0007_event_triggers` is committed and applies cleanly and idempotently. It contains **no Supabase-specific syntax** and will apply to the production project through `pnpm db:migrate:prod` alongside `0000`–`0006`.
- One thing for 01-10 to confirm on the real project: `app.log_event()` is `SECURITY DEFINER` and inserts into `events`, which has RLS enabled. On the local database the function owner is the superuser and RLS is bypassed. On Supabase the migration owner is `postgres`, which owns `events` and therefore also bypasses RLS — **unless a later migration adds `alter table events force row level security`**, which nothing does today. Worth one assertion after the production migrate.
- `.planning/CONVENTIONS.md` exists and is the contract Phases 2 and 3 read. **`CLAUDE.md`'s `GSD:conventions` block still reads "Conventions not yet established"** — it is a generated block sourced from `CONVENTIONS.md` and was deliberately not hand-edited; whichever step owns that generator should re-run it.
- **Suggested for 01-VALIDATION.md at phase gate:** update M3's expected result to name two tests, or re-point it at the actor-chain mutation (mutation 5), which reds exactly one.

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-21*

## Self-Check: PASSED

**Files claimed as created — all present on disk:**

```
FOUND: drizzle/0007_event_triggers.sql
FOUND: drizzle/meta/0007_snapshot.json
FOUND: tests/db/events-append-only.test.ts
FOUND: tests/db/event-trigger.test.ts
FOUND: .planning/CONVENTIONS.md
```

**Commits claimed — all present in git:**

```
FOUND: a25393e  test(01-09): add the five audit tests, watched failing first
FOUND: a163879  feat(01-09): enforce attribution by trigger and make events immutable by grant
FOUND: e757e19  test(01-09): require the log_event triggers to be ENABLED, not merely present
FOUND: b4b8ff7  docs(01-09): record the schema, event-scope and testing contract for Phases 2 and 3
```

**Plan `<verification>` re-run:**

| Check | Result |
|---|---|
| `pnpm verify` exits 0 | ⚠️ script unrunnable on this machine (see Issues); all four constituents exit 0 — typecheck 0, lint 0, test:unit 11/11, test:db 25/25 |
| `pnpm test:db` names all five new tests plus every earlier test, exits 0 | ✅ 8 files, 25 tests, exit 0 |
| Recorded red output for four named filters | ✅ above, under "Watched failing first" |
| Mutation records name the test(s) that went red; `git diff --stat` empty after reverts | ✅ five mutations recorded; `git diff --stat` empty, `git status --short` empty |
| `pnpm db:generate` produces no statements | ✅ `No schema changes, nothing to migrate 😴` |
| `.planning/CONVENTIONS.md` passes the content check | ✅ `CONTENT CHECK ok` (all 11 required tokens) |

**Plan `<success_criteria>` re-run:**

| Criterion | Result |
|---|---|
| Raw SQL insert/update on `businesses` produces an `events` row with actor, entity, action, before/after and a `timestamptz` | ✅ |
| `update`/`delete events` as `authenticated` refused 42501 with "permission denied for table events" | ✅ both, in separate transactions |
| A domain-only UPDATE moves `updated_at` and stamps `updated_by` | ✅ |
| Exactly `orgs` and `businesses` carry an `app.log_event` after-row trigger; `source_records` does not | ✅ asserted in both directions, plus enabled |
| Every SECURITY DEFINER function pins `set search_path = public` | ✅ `grep -c` → 1 and 1 |
| `.planning/CONVENTIONS.md` records the schema contract, event-scope boundary and testing rules | ✅ |

STATE.md, ROADMAP.md and REQUIREMENTS.md were **not** modified — the orchestrator owns those writes.
