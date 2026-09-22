---
phase: 01-foundations-tenancy
plan: 05
subsystem: database
tags: [drizzle, rls, postgres, tenancy, clerk, multi-tenant, security]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 03)
    provides: vitest.db.config.ts and tests/db/_fixtures.ts — withRollback, actAs, actAsRole, seedTwoOrgs, the Claims union
  - phase: 01-foundations-tenancy (plan 04)
    provides: drizzle/0000_bootstrap.sql applied (anon / authenticated / service_role / app_user, schema app, app.jwt()), scripts/db.ts, drizzle.config.ts
provides:
  - "orgs / events / businesses — the tenancy spine; columns are a contract Phases 2 and 3 build on concurrently and may ADD to but never rename"
  - "src/db/schema/_helpers.ts — orgScoped column spread, orgPolicies() factory and tstz(), making the D-01/D-07/D-10 guarantee a compile-time artifact"
  - "app.current_org_id() — the Clerk v1-flat / v2-nested claim resolver every policy in every later phase calls"
  - "app.ensure_org(text, text) — SECURITY DEFINER JIT org provisioning that validates its argument against the caller claim"
  - "Eight RLS policies proving criterion 2 in both halves (refused INSERT, filtered SELECT/UPDATE/DELETE) under both Clerk claim shapes"
  - "tests/db/schema-audit.test.ts — the D-10 enumeration that fails on any FUTURE public table lacking org_id, RLS or a policy, and on any naked timestamp"
affects: [01-07 retention constraints, 01-08 with-org runtime, 01-09 event triggers, 01-10 production migrate, phase 02, phase 03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RLS policies are declared in TypeScript next to their table and generated into SQL — drizzle-kit stays the single migration authority (D-09)"
    - "Every policy predicate is wrapped in (select app.current_org_id()) so Postgres runs it as an InitPlan once per statement rather than once per row"
    - "Every org-scoped table carries index('<table>_org_idx').on(t.orgId) — an RLS predicate gets no index for free"
    - "Adding any pgPolicy auto-enables RLS in drizzle-orm 0.45.2: never also call .enableRLS(), and .withRLS() does not exist in this version"
    - "One refused statement per withRollback, and each test's refusal rests on a DIFFERENT invariant so a mutation reds exactly one test"
    - "The D-10 allow-list is a Set literal in the test file, never a config file, so widening it is a diff a reviewer sees"

key-files:
  created:
    - src/db/schema/_helpers.ts
    - src/db/schema/orgs.ts
    - src/db/schema/events.ts
    - src/db/schema/businesses.ts
    - drizzle/0001_tenancy.sql
    - drizzle/0002_tenancy_functions.sql
    - drizzle/0003_policies.sql
    - drizzle/0004_ensure_org.sql
    - drizzle/meta/0001_snapshot.json
    - drizzle/meta/0002_snapshot.json
    - drizzle/meta/0003_snapshot.json
    - drizzle/meta/0004_snapshot.json
    - tests/db/rls-isolation.test.ts
    - tests/db/schema-audit.test.ts
    - tests/db/ensure-org.test.ts
  modified:
    - src/db/schema/index.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "The plan's M1 recipe — literally deleting the WITH CHECK clause from businesses_insert — does NOT discriminate on PostgreSQL 18.6. An INSERT policy with neither WITH CHECK nor USING fails CLOSED: the caller's own-org INSERT is refused too, so the test passes for the wrong reason and the suite stayed green. The discriminating mutation is WITH CHECK (true). Recorded for M2/M3/M4 and for anyone re-running M1."
  - "The 25P02 test was rewritten to take its refusal from an orgs INSERT rather than the cross-org businesses INSERT. Sharing one refusal coupled two tests to one policy and M1 turned both red; the plan requires exactly one. orgs has no INSERT policy for authenticated at all (T-1-23), which is a different invariant."
  - "events gets select + insert only, declared inline rather than through orgPolicies(), because D-06 leaves it no legitimate UPDATE or DELETE path. Plan 09 still owes the grant revoke — a missing policy denies by default today, but a later `for all` policy would silently re-open it."
  - "orgs deliberately has no INSERT policy: the only creation path is app.ensure_org, so authenticated never holds blanket INSERT on the tenant root (T-1-23)."
  - "orgs.ts declares its own local tstz() instead of importing from _helpers.ts, because _helpers.ts imports orgs for the orgScoped foreign key and the reverse import would be a module cycle."

patterns-established:
  - "A mutation that reds two tests is a failed mutation check, not a passed one — it no longer tells you which guard broke. Decouple the tests until exactly one reds."
  - "A mutation must be checked for direction: a guard that fails CLOSED makes the test pass for the wrong reason and is indistinguishable from a working guard by exit code alone. Probe the positive path (own-org INSERT) to tell the two apart."

requirements-completed: [FOUND-01, FOUND-02, FOUND-04, FOUND-06]

# Metrics
duration: 19 min
completed: 2026-09-22
---

# Phase 01 Plan 05: Tenancy Spine and RLS Isolation Summary

**Three org-scoped tables, eight RLS policies and a Clerk v1|v2 claim resolver, proven by eleven tests that were watched failing first and by a mutation check that had to be corrected twice before it told the truth.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-09-22T02:23:00Z
- **Completed:** 2026-09-22T02:42:00Z
- **Tasks:** 3
- **Files created:** 15 (2 modified)

## Accomplishments

- **Criterion 2 is proven in both halves, under both Clerk claim shapes.** A foreign-org INSERT raises `42501` with a row-level-security message; a cross-org UPDATE and DELETE report `rowCount 0` without raising; a cross-org SELECT returns only the caller's rows — and the v2 nested `{o:{id}}` claim resolves the same org as the v1 flat `org_id` claim.
- **The silent-failure mode this phase exists to avoid is closed.** `app.current_org_id()` coalesces both claim shapes. Copied verbatim from BIS it would return NULL under a Clerk v2 token, which yields zero rows and **no error** — the highest-probability invisible failure in this build. Both shapes are tested.
- **D-10 now guards every future table.** The `pg_class`/`pg_policy` enumeration fails on any public table lacking `org_id`, RLS or a policy, and a second test fails on any column that is not `timestamp with time zone`. Both exist to catch Phases 2 and 3, not this one.
- **`app.ensure_org` refuses to provision anybody else's org** (`42501`), and is idempotent for the caller's own.
- **The mutation check was wrong twice and both corrections are recorded** — see "Mutation check" below. This is the part of the plan that produced real information rather than confirmation.
- Migrations 0001–0004 applied to the shared local `siteless_test` additively; `db:migrate` exits 0 twice in a row and `db:generate` immediately after reports *"No schema changes, nothing to migrate"* — no drift between the TypeScript schema and the live database.

## Task Commits

1. **Task 1: tenancy tables + `app.current_org_id()`, RLS deliberately off** — `c8e86bc` (feat)
2. **Task 2: eleven tests, watched failing first** — `c14d6e7` (test)
3. **Task 3: RLS policies + `app.ensure_org`, all green** — `269afeb` (feat)
4. **Task 3 follow-up: decouple the 25P02 test so M1 reds exactly one** — `ad0bede` (test)

## Watched failing first

Written against wide-open tables on purpose. `relrowsecurity` was confirmed `false` on all three tables before these ran, so the red below is evidence the tests can discriminate rather than a promise that they do. **Every run was read for the failing test NAME** — a `-t` filter that matches nothing exits green, and that is the easiest way to fake a red-then-green record.

Full suite in the pre-policy state: **`Test Files 3 failed (3)` · `Tests 8 failed | 3 passed (11)`**.

### 1. `pnpm test:db -t "42501"` → exit **1**

```
 ❯ tests/db/rls-isolation.test.ts (6 tests | 1 failed | 4 skipped) 216ms
   ❯ RLS tenant isolation (6)
     × org A cannot INSERT into org B, and the refusal is 42501 131ms
 ❯ tests/db/ensure-org.test.ts (2 tests | 1 failed | 1 skipped) 60ms
   ❯ app.ensure_org (2)
     × app.ensure_org refuses another org with 42501 60ms

 FAIL  tests/db/rls-isolation.test.ts > RLS tenant isolation > org A cannot INSERT into org B, and the refusal is 42501
AssertionError: promise resolved "Result{ command: 'INSERT', …(9) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ Result {
    …
+   "command": "INSERT",
+   "rowCount": 1,
    …
  }

 FAIL  tests/db/ensure-org.test.ts > app.ensure_org > app.ensure_org refuses another org with 42501
AssertionError: expected error: function app.ensure_org(unknown, u… { …(15) } to match object { code: '42501' }

- {
-   "code": "42501",
+ DatabaseError {
+   "code": "42883",
  }

 Test Files  2 failed | 1 skipped (3)
      Tests  2 failed | 1 passed | 8 skipped (11)
```

The foreign INSERT **succeeded** (`command: 'INSERT'`, `rowCount: 1`) — exactly the predicted reason: no policy exists. (The pg `Result` object dump is elided at the `…` marks; nothing load-bearing was removed.)

### 2. `pnpm test:db -t "sees only its own org"` → exit **1**

```
     × org A sees only its own org rows under a v1 flat claim 111ms

 FAIL  tests/db/rls-isolation.test.ts > RLS tenant isolation > org A sees only its own org rows under a v1 flat claim
AssertionError: expected [ 'Alpha Roofing', 'Bravo Plumbing' ] to deeply equal [ 'Alpha Roofing' ]

  [
    "Alpha Roofing",
+   "Bravo Plumbing",
  ]
```

### 3. `pnpm test:db -t "filtered, not refused"` → exit **1**

```
     × a cross-org UPDATE and DELETE are filtered, not refused 104ms

 FAIL  tests/db/rls-isolation.test.ts > RLS tenant isolation > a cross-org UPDATE and DELETE are filtered, not refused
AssertionError: expected 1 to be +0 // Object.is equality

- 0
+ 1

 ❯ tests/db/rls-isolation.test.ts:77:32
     77|       expect(updated.rowCount).toBe(0);
```

### 4. `pnpm test:db -t "every public table is org-scoped"` → exit **1**

```
     × every public table is org-scoped and has RLS enabled 92ms

AssertionError: expected [ …(3) ] to deeply equal []

+ [
+   { "has_org_id": true,  "policy_count": 0, "rls_enabled": false, "table_name": "businesses" },
+   { "has_org_id": true,  "policy_count": 0, "rls_enabled": false, "table_name": "events" },
+   { "has_org_id": false, "policy_count": 0, "rls_enabled": false, "table_name": "orgs" },
+ ]
```

### 5. `pnpm test:db -t "ensure_org"` → exit **1**

```
 ❯ tests/db/ensure-org.test.ts (2 tests | 2 failed) 181ms
     × app.ensure_org is idempotent for the caller own org 86ms
     × app.ensure_org refuses another org with 42501 94ms

error: function app.ensure_org(unknown, unknown) does not exist
```

### Green already, and correctly so

Three tests passed in the red state, which is the expected outcome and not a gap:

| Test | Why it was already true |
|---|---|
| `a connection without set local role authenticated is refused 42501` | Rests on migration 0000's GRANT structure — `app_user` is NOINHERIT and owns nothing — not on any policy |
| `every timestamp column in public is timestamptz` | True from Task 1; it exists to catch a LATER phase |
| `businesses has three distinct name fields` | True from Task 1's columns; also exists to catch a later phase |

The plan predicted two; the third (`three distinct name fields`) is green for the same structural reason — it asserts Task 1's column layout, which Task 1 had already created. No behaviour differs from the plan's intent.

## Mutation check

**M1 (VALIDATION.md): drop the `WITH CHECK` clause from the `businesses_insert` policy → exactly one named test red.**

This took three attempts, and the two failures are the most useful output of the plan.

### Attempt 1 — the plan's literal recipe does not discriminate

Applied literally: `CREATE POLICY "businesses_insert" … FOR INSERT TO "authenticated";` with no `WITH CHECK` at all. Verified in the database (`pg_get_expr(polwithcheck, …)` → `null`).

Result: **`Tests 11 passed (11)`, exit 0.** No test went red.

Diagnosis, by probing the positive path rather than guessing:

```
OWN-ORG INSERT: REFUSED 42501 new row violates row-level security policy for table "businesses"
```

An INSERT policy with neither `WITH CHECK` nor `USING` fails **closed** on PostgreSQL 18.6 — the caller's *own-org* insert is refused too. The isolation test therefore still passed, but for entirely the wrong reason. **A mutation that makes the guard stricter is indistinguishable from a working guard by exit code alone.** The discriminating mutation is `WITH CHECK (true)`.

### Attempt 2 — discriminating, but reds two tests

`WITH CHECK (true)` → **`Tests 2 failed | 9 passed (11)`**:

```
 × org A cannot INSERT into org B, and the refusal is 42501
 × a second statement in the same aborted transaction reports 25P02
```

The 25P02 test borrowed the cross-org business INSERT as its "something that aborts the transaction", coupling two tests to one policy. The plan is explicit that more than one red means the tests are wrong — a mutation reding two tests no longer tells you which guard you broke. Fixed in `ad0bede`: the 25P02 refusal now comes from an `orgs` INSERT, refused because `orgs` has **no** INSERT policy for `authenticated` (T-1-23) — a different invariant.

### Attempt 3 — exactly one red

| | |
|---|---|
| **Mutation** | `businesses_insert` recreated as `WITH CHECK (true)`, in `drizzle/0003_policies.sql` and in the local database |
| **Result** | `Tests 1 failed | 10 passed (11)`, exit 1 |
| **The one red** | `org A cannot INSERT into org B, and the refusal is 42501` |
| **Test count** | 11 |
| **After revert** | `git diff --stat drizzle/0003_policies.sql` → **empty** (byte-identical); policy restored to `(org_id = ( SELECT app.current_org_id() AS current_org_id))`; `pnpm test:db` → `Tests 11 passed (11)`, exit 0 |

### Supporting mutation — the rewritten 25P02 test is not vacuous

Because the 25P02 test was rewritten *after* its red run was recorded, it was re-proven rather than assumed. Adding `orgs_insert_MUTATION` (`for insert to authenticated with check (true)`) to the local database:

```
 × tests/db/rls-isolation.test.ts > RLS tenant isolation > a second statement in the same aborted transaction reports 25P02
      Tests  1 failed | 10 passed (11)
```

Exactly one red, and it doubles as the guard that `orgs` must never gain a blanket INSERT policy (T-1-23). The mutation policy was dropped afterwards; the final policy set is exactly the eight intended:

```
["businesses_delete","businesses_insert","businesses_select","businesses_update",
 "events_insert","events_select","orgs_select","orgs_update"]
```

## Verification Evidence

Every exit code below was read with a redirect (`cmd > log 2>&1; echo $?`), never through a pipe — a trailing `echo $?` after a pipe reports the exit of `tail`.

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test:unit` | exit 0 — `Tests 1 passed (1)` |
| `pnpm test:db` | exit 0 — **`Test Files 3 passed (3)` · `Tests 11 passed (11)`**, output names all eleven |
| `pnpm db:migrate` ×2 | exit 0 both times |
| `pnpm db:generate --name=noop` | exit 0 — *"No schema changes, nothing to migrate"*, no file emitted, so nothing to delete |
| `git diff --stat pnpm-lock.yaml package.json` | empty — no `@pnpm/exe` entry appeared |

`pnpm verify` itself was **not** run as one command: it chains nested bare `pnpm`, which on this machine resolves to global 11.9.0 with a broken 12.5.1 self-switch shim. All four constituents were run individually and each exited 0.

Live database state after the plan:

```
migrations: [{"n":5}]
rls: [{"businesses":true},{"events":true},{"orgs":true}]   (relrowsecurity)
policies: 8
```

Task acceptance greps:

| Criterion | Value |
|---|---|
| `create table "orgs" / "events" / "businesses"` in 0001 | 1 / 1 / 1 |
| `drop role` in 0001 | **0** (`entities.roles.provider: 'supabase'` is working) |
| `row level security` in 0001 | 0 (deliberately off until 0003) |
| `coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')` in 0002 | 1 |
| `security definer set search_path = public` on one line in 0002 | 1 |
| `ENABLE ROW LEVEL SECURITY` in 0003 | 3 |
| `CREATE POLICY` in 0003 | **8** |
| `(select app.current_org_id())` occurrences in 0003 | 10 (≥8 required) |
| `events_update` / `events_delete` / `orgs_insert` in 0003 | 0 / 0 / 0 |
| `security definer`, `errcode = '42501'`, `on conflict (clerk_org_id)` in 0004 | 1 / 1 / 1 |
| `withRLS` / `agency` across `src/db/schema/*.ts` | 0 / 0 |
| `withTimezone: true` in `_helpers.ts` | 1; both `timestamp(` call sites repo-wide carry it |
| `it(` blocks / `withRollback` wrappers in rls-isolation | 6 / 6 |
| `toMatchObject({ code: '42501' })` in rls-isolation | **2** |
| `row-level security` / `permission denied` in rls-isolation | 1 / 1 (the two different 42501 messages are told apart) |
| `rejects.toThrow()` across `tests/db/*.test.ts` | **0** (a bare `toThrow()` passes on a SQL typo) |
| `new Set(['orgs', '__drizzle_migrations'])` in schema-audit | 1 |

## Decisions Made

Recorded in `key-decisions` above. The two that later phases must not re-derive:

- **M1's discriminating form is `WITH CHECK (true)`, not clause deletion.** Anyone re-running the phase gate with the plan's literal wording will get a green suite and conclude the guard works.
- **Each test's refusal must rest on a distinct invariant.** This is what makes M2, M3 and M4 able to red exactly one test each.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's M1 mutation recipe is not discriminating**

- **Found during:** Task 3, step 6
- **Issue:** The plan (and VALIDATION.md M1) says to "delete the `WITH CHECK` clause from the `businesses_insert` policy" and expect exactly one test red. Executed literally on PostgreSQL 18.6 the suite stayed **fully green** (`11 passed`). An INSERT policy with neither `WITH CHECK` nor `USING` denies every row, so the caller's own-org insert is refused as well and the isolation test passes for the wrong reason.
- **Fix:** Diagnosed by probing the positive path (own-org INSERT → `42501 new row violates row-level security policy`), then used `WITH CHECK (true)`, which removes the org constraint while leaving inserts possible. Recorded in `key-decisions` so the phase gate and M2/M3/M4 inherit the lesson.
- **Files modified:** none permanently — `drizzle/0003_policies.sql` was edited and reverted; `git diff --stat` empty
- **Verification:** attempt 3 → `1 failed | 10 passed`, the one red being the named test
- **Committed in:** recorded in `ad0bede`'s message and here; no code change

**2. [Rule 1 - Bug] Two tests shared one refusal, so M1 turned both red**

- **Found during:** Task 3, step 6 (attempt 2)
- **Issue:** `a second statement in the same aborted transaction reports 25P02` used the cross-org businesses INSERT to abort its transaction, so it was coupled to `businesses_insert`. Under the corrected mutation **two** tests went red. The plan requires exactly one: "If more than one test goes red, or none does, the tests are wrong — fix them before moving on."
- **Fix:** The 25P02 test now takes its refusal from an `orgs` INSERT, refused because `orgs` has no INSERT policy for `authenticated` at all — a different invariant, untouched by M1.
- **Files modified:** `tests/db/rls-isolation.test.ts`
- **Verification:** M1 re-run → exactly one red; and a targeted mutation (adding an `orgs` INSERT policy) reds this test and only this test, proving the rewrite is not vacuous
- **Committed in:** `ad0bede`

### Trivial

**3.** The plan's `db:generate --name=noop` step says to "delete that empty migration and its journal entry afterwards". drizzle-kit 0.31.10 emits **no file at all** when there is no diff (*"No schema changes, nothing to migrate"*), so there was nothing to delete. `git status` confirmed no stray artifact and the journal still holds exactly five entries.

**4.** `orgs.ts` declares a local `tstz()` rather than importing it from `_helpers.ts`. The plan's own code does this and the reason is load-bearing: `_helpers.ts` imports `orgs` for the `orgScoped` foreign key, so the reverse import would be a module cycle.

---

**Total deviations:** 2 auto-fixed (both bugs in the plan's own verification recipe) + 2 trivial
**Impact on plan:** No scope change. Every interface the plan fixed as a contract — the three tables' columns, the two exported helper shapes, the two SQL function signatures, and all eleven test names — is exactly as specified. Both deviations strengthened the evidence rather than altering the deliverable: without them the plan would have recorded a passing mutation check that proved nothing.

## Threat Flags

None. Every mitigation in the plan's register was implemented and exercised:

| Threat | Status |
|---|---|
| T-1-02 (Info disclosure, org-scoped tables) | 8 policies, all `to authenticated`, all predicated on the org resolver; proven by `sees only its own org` + `filtered, not refused`; guarded against drift by the D-10 enumeration |
| T-1-01 (Spoofing, `app.ensure_org`) | Raises `42501` when the argument differs from the caller claim; proven by `app.ensure_org refuses another org with 42501` |
| T-1-13 (Spoofing, `app.current_org_id`) | Coalesce serves both Clerk claim shapes; both tested (`token v2`) |
| T-1-03 (EoP, runtime connection role) | `app_user` NOINHERIT, owns nothing; proven by `without set local role`, pinned to `42501` + `permission denied` |
| T-1-07 (EoP, definer functions) | Both `app.current_org_id` and `app.ensure_org` are `security definer` with `set search_path = public` pinned on the function; `prosecdef` confirmed true in the live catalog |
| T-1-23 (Info disclosure, `orgs` INSERT) | No `orgs_insert` in 0003 (grep 0), and now actively guarded — adding one reds the 25P02 test |
| T-1-24 (DoS, RLS predicate evaluation) | Every predicate wrapped in `(select …)` (10 occurrences); `businesses_org_idx` and `events_org_occurred_idx` present |

No security-relevant surface was introduced beyond the register.

## Known Stubs

None. Every table, function, policy and test this plan declares is live and exercised.

One deliberate deferral, already owned by the plan that follows: `events` is append-only today because it has **no** UPDATE or DELETE policy, which denies by default. Plan 09 still owes the belt-and-braces `revoke update, delete on events from authenticated` — a later `for all` policy would otherwise silently re-open it. Noted in `events.ts`'s comment.

## Issues Encountered

- The worktree was created from `0ee86c0`, well behind the expected base `5434bbd` (missing all of waves 0 and 1). The `<worktree_branch_check>` caught it: HEAD was on `worktree-agent-a42046f89655aff3f` (never a protected ref), the tree was clean, and `git reset --hard 5434bbd` moved it forward. Known `EnterWorktree` base-selection issue (#2015), same as plan 04 hit.
- `node_modules` is not shared between worktrees; `pnpm install --frozen-lockfile` was run first via the 12.5.1 launcher (18.9s, exit 0). No lockfile drift.
- The M1 mutation temporarily dropped and recreated one policy on the **shared** local `siteless_test` while plan 01-06 may have been running its read-only `withRollback` tests concurrently. The window was seconds, confined to `businesses_insert` and one throwaway `orgs` policy, and both were restored and verified from `pg_policy`. No migration was re-applied and `__drizzle_migrations` was never touched.

## User Setup Required

None — no external service configuration. Nothing in this plan reaches production Supabase; every statement ran against the local `siteless_test`.

## Next Phase Readiness

**Ready for plans 01-07, 01-08 and 01-09.** They can now rely on:

- `orgScoped` and `orgPolicies(t)` for any new table — plan 07's `source_records` gets its org scoping and RLS for free, and the D-10 test will fail it if it forgets;
- `app.current_org_id()` as the resolver every new policy calls, and `tstz()` for every new timestamp column (the enumeration test will catch a naked `timestamp`);
- `app.ensure_org(text, text)` as the only `orgs` creation path — plan 08's `withOrg` should call it rather than inserting;
- `businesses.id` as an FK target for plan 07's provenance column pairs.

Notes for downstream:

- **Plan 09:** `events` has select + insert policies only. The `revoke update, delete on public.events from authenticated` is still owed, and its test must pin `42501` with a *grant* message, not a row-level-security one — this plan established that the two messages are distinguished.
- **Plans 07 / 09 (M2 / M3):** re-read the M1 finding before writing your mutation. Check the mutation's *direction*: a guard that fails closed leaves the suite green and looks identical to a working guard.
- **Phases 2 and 3:** the columns above are a contract. Add, never rename.

## Self-Check: PASSED

- All 15 files in `key-files.created` exist on disk (`[ -f ]` each → FOUND); both modified files present.
- All 4 commits present in `git log`: `c8e86bc`, `c14d6e7`, `269afeb`, `ad0bede`.
- `git diff --name-only 5434bbd..HEAD` lists exactly the 17 files above — **no `STATE.md`, no `ROADMAP.md`, no `REQUIREMENTS.md`**, nothing belonging to plan 01-06 (`src/lib/export/*`, `src/lib/time.ts`, `src/lib/auth/sole-organization.ts`, `tests/unit/*`, `tests/db/time.test.ts`), and nothing in the main working tree.
- `git status --short` is empty and `.env.local` never appeared in it.
- Every task's `<acceptance_criteria>` and the plan-level `<verification>` were re-run after the final edit; results are in the tables above.
- Live database re-probed after the mutation revert: 5 migrations, RLS true on all three tables, exactly 8 policies.

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-22*
