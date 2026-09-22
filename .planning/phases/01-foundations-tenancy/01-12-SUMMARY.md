---
phase: 01-foundations-tenancy
plan: 12
subsystem: database
tags: [postgres, grants, rls, truncate, maintain, pg_default_acl, supabase, drizzle, mutation-testing, security]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 09)
    provides: 'migration 0007 — `revoke update, delete on events from authenticated` (D-06), and tests/db/events-append-only.test.ts, the guard whose reds under the reproduced platform condition prove the blanket grant really does re-open events'
  - phase: 01-foundations-tenancy (plan 10)
    provides: 'the Rule 4 finding this plan closes (probes P1–P8 on production), the psql-via-spawnSync pattern that keeps a connection URL out of the transcript, and the production-vs-local side-by-side format'
provides:
  - 'drizzle/0008_revoke_platform_grants.sql — applied by drizzle-kit to local (9 rows) and production (9 rows); revokes TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from `anon`+`authenticated`, ALL from `anon`, re-asserts 0007, and retires the default ACL for both roles'
  - 'tests/db/grants-audit.test.ts — six tests over the grant surface itself: two privilege enumerations, two LIVE TRUNCATE refusals pinned to 42501, the pg_default_acl assertion, and the positive control that the DML the policies rely on survives'
  - 'An identical per-table x per-role grant surface on dev, CI and production for `anon`, `authenticated` and `service_role` — verified side by side, not inferred from an exit code'
  - 'tests/db/_fixtures.ts — actAsRole accepts `authenticated`, the claimless session a grant-level guard needs'
  - '.planning/CONVENTIONS.md § Grants — the standing contract: a new table inherits NOTHING and grants its own DML in the migration that creates it'
  - 'The closure of T-1-30 (TRUNCATE/MAINTAIN DoS) and T-1-31 (future tables via pg_default_acl), and the revision of T-1-03'
affects: [01-11-phase-verification, phase-02-ui, phase-03-entity-resolution, phase-04-places-verifier, phase-07-triage-and-leads]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'A migration that must produce one end state on two different starting states REPRODUCES the richer starting state first, then converges. Steps 1-2 of 0008 are a no-op on production and the whole point on a bare Postgres — without them the revoke is untestable everywhere it could be watched.'
    - 'A guard over a privilege asserts the ATTEMPT as well as the catalog. has_table_privilege reports what pg_class.relacl holds; only the statement, inside a rolled-back transaction, reports what the server does.'
    - 'A grant-level refusal test carries NO claims. TRUNCATE is exempt from RLS, so a session with a valid org claim would only make the test look like an RLS test and hide which layer refused.'
    - 'An enumeration over a hard-coded list of tables asserts that list against the live catalog in the same test, or its own name ("any tenant table") is a claim it never checks.'
    - 'A privilege criterion is scoped to the roles that can actually create the objects it governs. An unscoped pg_default_acl assertion is red forever on a managed platform, for a row no migration you can write is permitted to touch.'

key-files:
  created:
    - drizzle/0008_revoke_platform_grants.sql
    - drizzle/meta/0008_snapshot.json
    - tests/db/grants-audit.test.ts
  modified:
    - drizzle/meta/_journal.json
    - tests/db/_fixtures.ts
    - .planning/CONVENTIONS.md

key-decisions:
  - "MAINTAIN is revoked alongside TRUNCATE, REFERENCES and TRIGGER, which the plan does not name. The production pre-flight found `anon` and `authenticated` already holding it on all four tables (`arwdDxtm`), and `grant all` on PostgreSQL 17+ would have re-granted it anyway. MAINTAIN carries VACUUM FULL, CLUSTER and REINDEX — an ACCESS EXCLUSIVE lock on a tenant table on demand, the same denial-of-service class as TRUNCATE (T-1-30). Leaving it would have meant shipping the fix and the hole together."
  - "Test 5 is scoped to the default ACLs of roles that OWN tables in `public`. Production carries TWO default ACLs for that schema: one owned by `postgres` (which 0008 fixes) and one owned by `supabase_admin` that still grants arwdDxtm to anon/authenticated. `postgres` is not a member of `supabase_admin` — `alter default privileges for role supabase_admin ...` is refused with `permission denied to change default privileges` (attempted on production, rolled back). Unscoped, the plan's assertion is unsatisfiable on production forever. Scoped, it asserts exactly the thing that matters: what the next table drizzle-kit creates as `postgres` will inherit. `supabase_admin` owns zero tables in `public`."
  - "Migration 0008 deliberately retires migration 0002's own `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated`. The plan's test 5 and its § Grants text both require the default ACL to grant nothing to `authenticated`, and the two cannot both stand. From here on a table-creating migration grants its own DML — a missing grant then fails loudly with 42501 on the first user-role statement instead of a table silently acquiring privileges nobody reviewed."
  - "The blanket `grant all` in step 2 re-opens `update`/`delete` on `events`, so step 5 replays 0007's revoke. This is not defensive duplication: without it THIS migration would silently undo D-06, and the two events-append-only tests going red under the reproduction are the proof."
  - "`actAsRole` gained `authenticated` rather than the grants-audit tests using `actAs` with claims. A claimless session is the stronger probe — it proves the refusal is the GRANT and not the policy, which is the entire distinction this plan exists to make."
  - "Sequences are untouched. Migration 0002's `usage, select on sequences to authenticated` stays: `events.id` is an identity column and an INSERT needs the sequence. Test 5 filters `defaclobjtype = 'r'`, so the sequence default ACL is deliberately out of scope."

patterns-established:
  - 'Read the production catalog BEFORE writing the migration, not only before applying it. The pre-flight changed two statements in 0008 (MAINTAIN) and one assertion in the test (the supabase_admin default ACL) — both would otherwise have shipped wrong and one would have been permanently red.'
  - 'Probe an unknown privilege by attempting the DDL inside a rolled-back transaction. "Can postgres alter supabase_admin default privileges?" was answered in 40ms by trying it, where reasoning about Supabase role hierarchies would have been a guess.'
  - 'When a plan predicts a green test and it is red, check whether the DATABASE already carried the condition. Test 5 was red before any reproduction because migration 0002 had set a default ACL the plan did not know about — the prediction was wrong, the test was right.'

requirements-completed: [FOUND-01, FOUND-03]

# Metrics
duration: 14 min
completed: 2026-09-22
---

# Phase 1 Plan 12: Revoke the Platform Grants Summary

**Migration 0008 takes `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN` away from `anon` and `authenticated` on every tenant table, everything away from `anon`, and the `pg_default_acl` inheritance away from both — applied by drizzle-kit to local and production, guarded by six tests watched failing under the Supabase platform condition reproduced on the dev machine, with a per-table x per-role privilege side-by-side that is now identical on both databases.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-22T04:01:22Z
- **Completed:** 2026-09-22T04:15:15Z
- **Tasks:** 3 of 3
- **Files modified:** 6 (3 created, 3 modified) + the production database

## Accomplishments

- **The 01-10 defect is closed on production, by grant, and proven by attempt.** `truncate public.events` as `authenticated` — which SUCCEEDED on production nine minutes earlier — is now `42501 permission denied for table events`. So is the four-table cascade, and so is `anon` touching `orgs` at all.
- **The platform condition was reproduced on the local database first**, so all six guards were watched failing for the real reason rather than a simulated one, and both `events-append-only` tests went red alongside them — the live proof that the blanket grant re-opens `events` and that 0008 must re-assert 0007.
- **A privilege the plan never named was found on production and closed.** `anon` and `authenticated` already held `MAINTAIN` (`arwdDxtm`) on all four tables: `VACUUM FULL` / `CLUSTER` / `REINDEX`, an `ACCESS EXCLUSIVE` lock on a tenant table on demand.
- **An unsatisfiable acceptance criterion was found before it was written into the codebase**, by probing production rather than trusting the plan: a second `supabase_admin`-owned default ACL that `postgres` has no privilege to alter, and no need to.
- **Dev, CI and production now hold a byte-identical grant surface** for `anon`, `authenticated` and `service_role` on all four tables — recorded side by side, not inferred from `exit 0`.
- **Both mutations behaved exactly as the plan predicted**, including the cascading-truncate test correctly staying green under mutation 1.

## Task Commits

1. **Task 1: Write the grants-audit test, then reproduce the platform condition locally and watch it fail** — `bce8dae` (test) — `tests/db/grants-audit.test.ts`, `tests/db/_fixtures.ts`
2. **Task 2: Migration 0008 — revoke the platform grants on both databases, prove parity** — `cbd10fa` (feat) — `drizzle/0008_revoke_platform_grants.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0008_snapshot.json`, `tests/db/grants-audit.test.ts`
3. **Task 3: Mutation check, conventions, and the record for the verifier** — `c3c4b1f` (docs) — `.planning/CONVENTIONS.md`

**Plan metadata:** this SUMMARY.

---

## Watched failing first

### Run 0 — the guard on the CURRENT local database, BEFORE any reproduction

The plan predicts "tests 1–6 are all GREEN". **Five were. Test 5 was already red**, and for a real reason the plan did not know about: `drizzle/0002_tenancy_functions.sql` sets the repo's *own* default ACL, `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated`, which stands as `{authenticated=arwd/postgres}` in `pg_default_acl`.

```
 ✓ authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table 80ms
 ✓ anon holds no privilege on any tenant table 52ms
 ✓ a TRUNCATE of events as authenticated is refused with 42501 127ms
 ✓ a cascading TRUNCATE of every tenant table as authenticated is refused with 42501 58ms
 × the public schema default ACL grants nothing to anon or authenticated on tables 58ms
   → expected 4 to be +0 // Object.is equality
 ✓ authenticated keeps the DML the policies rely on 51ms

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

### The reproduction, applied to the local test database permanently

```sql
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
```

Confirmed before running the suite — the reproduction took:

| | orgs | businesses | source_records | events |
|---|---|---|---|---|
| `authenticated` TRUNCATE | t | t | t | t |
| `anon` TRUNCATE | t | t | t | t |
| `anon` SELECT | t | t | t | t |
| `authenticated` UPDATE (events) | — | — | — | t |

`pg_default_acl` for tables became
`{anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — note the trailing **`m`**, `MAINTAIN`, which drove Deviation 1.

### Run 1 — the full suite under the reproduced platform condition — EXIT 1

```
 × tests/db/grants-audit.test.ts > grants audit > authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table 92ms
   → expected [ { tbl: 'businesses', …(2) }, …(15) ] to deeply equal []
 × tests/db/grants-audit.test.ts > grants audit > anon holds no privilege on any tenant table 64ms
   → expected [ { tbl: 'businesses', …(2) }, …(19) ] to deeply equal []
 × tests/db/grants-audit.test.ts > grants audit > a TRUNCATE of events as authenticated is refused with 42501 73ms
   → promise resolved "Result{ command: 'TRUNCATE', …(9) }" instead of rejecting
 × tests/db/grants-audit.test.ts > grants audit > a cascading TRUNCATE of every tenant table as authenticated is refused with 42501 224ms
   → promise resolved "Result{ command: 'TRUNCATE', …(9) }" instead of rejecting
 × tests/db/grants-audit.test.ts > grants audit > the public schema default ACL grants nothing to anon or authenticated on tables 57ms
   → expected 16 to be +0 // Object.is equality
 × tests/db/grants-audit.test.ts > grants audit > authenticated keeps the DML the policies rely on 53ms
   → expected { Object (b_select, b_insert, ...) } to deeply equal { Object (b_select, b_insert, ...) }
 × tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: UPDATE as authenticated is refused 64ms
   → promise resolved "Result{ command: 'UPDATE', …(9) }" instead of rejecting
 × tests/db/events-append-only.test.ts > events are immutable by grant > events are append-only: DELETE as authenticated is refused 67ms
   → promise resolved "Result{ command: 'DELETE', …(9) }" instead of rejecting

 Test Files  2 failed | 7 passed (9)
      Tests  8 failed | 23 passed (31)
```

**`promise resolved "Result{ command: 'TRUNCATE', …(9) }" instead of rejecting` is the defect itself, reproduced on the dev machine.** The TRUNCATE did not merely go unrefused — it ran, inside the rolled-back transaction, exactly as it did on production.

**Test 6 went red too, where the plan predicts it stays green.** Its received value names the reason:

```
  {
    "b_delete": true,
    "b_insert": true,
    "b_select": true,
    "b_update": true,
-   "e_delete": false,
+   "e_delete": true,
    "e_insert": true,
    "e_select": true,
-   "e_update": false,
+   "e_update": true,
  }
```

The blanket `grant all` re-opened `update`/`delete` on `events` — the same single cause that reds both `events-append-only` tests. This is not a defect in test 6; it is test 6 doing the job the plan assigned it ("plan 09's guarantee must survive this migration") and catching the migration's own step 2. It is why 0008 step 5 exists.

**Both `events-append-only` names, as required:** `events are append-only: UPDATE as authenticated is refused` and `events are append-only: DELETE as authenticated is refused`.

### Run 2 — the same suite after the Task 2 revisions, still under the reproduction

All six still red with the scoped test 5 and the strengthened test 1 (`expected 16 to be +0` — one role, two grantees, eight privileges), so the assertions that shipped are the assertions that were watched failing, not an earlier draft.

---

## Task 2 — production: pre-flight, migration, post-flight

Every production read is a separate command issued before any write, with the connection URL passed to `psql` through `spawnSync` argv from Node, so it appears in no transcript, no scrollback and no file (01-10 pattern). **No Supabase MCP `apply_migration`, no Supabase CLI, no dashboard SQL was used for anything in this plan** (D-09). There is no `supabase/` directory in this repository.

### Pre-flight READ

| Probe | Production, before |
|---|---|
| `current_user` / `server_version` | `postgres` / **17.6** |
| table owners in `public` | all four owned by `postgres` |
| `has_table_privilege('authenticated','public.events','TRUNCATE')` | **`t`** — the defect |
| `has_table_privilege('anon','public.orgs','SELECT')` | **`t`** — the defect |
| default-ACL grants to `anon`/`authenticated` on tables | **32** |
| `drizzle.__drizzle_migrations` | 8 rows, `first 1790043006920` / `last 1790046728009` |

`pg_default_acl` for schema `public` — **two owners, not one**:

```
  defacl_owner  | objtype | defaclacl
----------------+---------+-------------------------------------------------------------------------
 supabase_admin | r       | {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,
                          |  authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
 postgres       | r       | {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
                          |  authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
```

Per table x per role, **before**:

| table | role | privileges |
|---|---|---|
| businesses / orgs / source_records | `anon` | DELETE,INSERT,**MAINTAIN**,REFERENCES,SELECT,TRIGGER,**TRUNCATE**,UPDATE |
| businesses / orgs / source_records | `authenticated` | DELETE,INSERT,**MAINTAIN**,REFERENCES,SELECT,TRIGGER,**TRUNCATE**,UPDATE |
| events | `anon` | DELETE,INSERT,**MAINTAIN**,REFERENCES,SELECT,TRIGGER,**TRUNCATE**,UPDATE |
| events | `authenticated` | INSERT,**MAINTAIN**,REFERENCES,SELECT,TRIGGER,**TRUNCATE** |
| all four | `service_role` | all eight |

`MAINTAIN` is present and is absent from 01-10's report of the same surface — see Deviation 1.

### The supabase_admin default ACL — probed, not assumed

Attempted on production inside a transaction and rolled back:

```
=== can postgres alter supabase_admin default privileges? (rolled back) ===
BEGIN
ERROR:  permission denied to change default privileges
ROLLBACK
=== can postgres alter its OWN default privileges? (rolled back) ===
BEGIN
ALTER DEFAULT PRIVILEGES
 POSTGRES DEFACL: ALTERABLE
ROLLBACK
=== does supabase_admin own anything in public? ===
 tables_owned_by_supabase_admin | 0
```

`postgres` is a member of `anon`, `app_user`, `authenticated`, `authenticator`, `pg_create_subscription`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend`, `service_role`, `supabase_privileged_role` — **not** of `supabase_admin`. See Deviation 2.

### The migration

`pnpm db:migrate:prod` → **exit 0**. Second consecutive run → **exit 0, applied nothing**.

| Evidence | Local | Production |
|---|---|---|
| `drizzle.__drizzle_migrations` rows | **9** | **9** |
| `first_created_at` | — | `1790043006920` (= journal `when` of `0000_bootstrap`) |
| `last_created_at` | — | `1790050069242` |
| journal `when` of `0008_revoke_platform_grants` | `1790050069242` | same file |
| `pnpm db:migrate` second run (local) | exit 0, applied nothing | — |
| `pnpm db:generate` | `No schema changes, nothing to migrate 😴` | — |

`last_created_at` equalling the journal entry is the proof the row came from *this* migration file, not merely that a ninth row exists.

### Post-flight READ — the named probes

| Probe | Production, after |
|---|---|
| `has_table_privilege('authenticated','public.events','TRUNCATE')` | **`f`** |
| `has_table_privilege('anon','public.orgs','SELECT')` | **`f`** |
| default-ACL grants to `anon`/`authenticated`, scoped to table-owning roles | **0** |
| default-ACL grants to `anon`/`authenticated`, unscoped | 16 — all `supabase_admin`'s, inert and unalterable |

`pg_default_acl` for `public`, after: `postgres | r | {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`.

### Post-flight LIVE probes — every SQLSTATE, on production, inside rolled-back transactions

| Probe | Statement | Role | Result |
|---|---|---|---|
| P1 | `truncate public.events` | `authenticated` | **`ERROR: 42501: permission denied for table events`** |
| P6 | `truncate public.orgs, public.businesses, public.source_records, public.events cascade` | `authenticated` | **`ERROR: 42501: permission denied for table orgs`** |
| P7 | `truncate public.orgs` | `anon` | **`ERROR: 42501: permission denied for table orgs`** |
| P8 | `select count(*) from public.orgs` | `anon` | **`ERROR: 42501: permission denied for table orgs`** |
| Control | `select count(*) from public.orgs` | `authenticated` | **SUCCEEDED**, `control_rows = 0` |
| Control 2 | `has_table_privilege` INSERT on events / UPDATE on businesses | `authenticated` | **`t` / `t`** — the DML the policies rely on is intact |

P1 and P6 are 01-10's probes, which SUCCEEDED before this plan. All four refusals are **42501**, captured with `VERBOSITY verbose` so the SQLSTATE is in the output rather than inferred from the message.

### Side-by-side: per table x per role, production vs local — IDENTICAL

Both databases, the same eight rows, character for character:

| table | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `orgs` | *(no privileges at all)* | DELETE,INSERT,SELECT,UPDATE | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| `businesses` | *(no privileges at all)* | DELETE,INSERT,SELECT,UPDATE | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| `source_records` | *(no privileges at all)* | DELETE,INSERT,SELECT,UPDATE | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| `events` | *(no privileges at all)* | INSERT,SELECT | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |

`anon` produces **no rows** in the `aclexplode` enumeration on either database — it holds nothing, rather than holding something empty.

`has_table_privilege` matrix, identical on both:

| table | auth TRUNCATE | auth REFERENCES | auth TRIGGER | auth MAINTAIN | anon SELECT | anon TRUNCATE |
|---|---|---|---|---|---|---|
| orgs | f | f | f | f | f | f |
| businesses | f | f | f | f | f | f |
| source_records | f | f | f | f | f | f |
| events | f | f | f | f | f | f |

**One recorded difference, outside the criterion.** Production's `postgres`-owned default ACL retains an explicit `postgres=arwdDxtm/postgres` self-entry that local never materialises, and production additionally carries the `supabase_admin`-owned row. Neither grants anything to `anon` or `authenticated`; the criterion is scoped to those three roles and is identical. Recorded rather than papered over.

### Green, after the migration

```
 Test Files  9 passed (9)
      Tests  31 passed (31)
```

All six grants-audit names printed under `--reporter=verbose`, alongside every test from plans 05–09. `pnpm test:unit` → 11/11. `pnpm typecheck` → 0. `pnpm lint` → 0. (`pnpm verify` remains unrunnable on this machine — the standing 01-01 environment defect; all four constituents were run individually.)

---

## Mutation checks

Both mutations applied to the **live local database**, never to a migration file — which is what makes `git diff --stat` empty by construction and the revert provable from the catalog rather than from the fact that a script ran. Suite size throughout: **31 tests, 9 files**.

### Mutation 1 (gate M5) — `grant truncate on public.events to authenticated;`

Confirmed applied: `events` TRUNCATE `t`, `orgs` TRUNCATE `f`.

```
 × authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table
   → expected [ { tbl: 'events', …(2) } ] to deeply equal []
 × a TRUNCATE of events as authenticated is refused with 42501
   → promise resolved "Result{ command: 'TRUNCATE', …(9) }" instead of rejecting

 Test Files  1 failed | 8 passed (9)
      Tests  2 failed | 29 passed (31)
```

**Exactly the two the plan predicts**, and they assert different properties over the one object — the same shape as plan 09's M3. **`a cascading TRUNCATE of every tenant table as authenticated is refused with 42501` correctly stayed GREEN**: that statement names `orgs` first, where `authenticated` still holds no TRUNCATE, so it is still refused. The two TRUNCATE tests are therefore *not* redundant — this mutation discriminates between them.

**Reverted** with `revoke truncate on public.events from authenticated;`. Verified from `has_table_privilege`: `events` TRUNCATE `f`, INSERT `t`, SELECT `t`. Suite → 31/31.

### Mutation 2 — `grant select on public.orgs to anon;`

Confirmed applied: `anon` SELECT on `orgs` `t`, on `businesses` `f`.

```
 × anon holds no privilege on any tenant table
   → expected [ { tbl: 'orgs', …(2) } ] to deeply equal []

 Test Files  1 failed | 8 passed (9)
      Tests  1 failed | 30 passed (31)
```

**Exactly one test red**, as the plan predicts.

**Reverted** with `revoke select on public.orgs from anon;`. Verified from the catalog: `anon` SELECT on `orgs` `f`, and the full re-read — `anon`'s privileges anywhere in schema `public` — returns **`(none)`**. Suite → 31/31.

### Post-revert state

```
$ git status --short
(no output — clean tree)
$ git diff --stat pnpm-lock.yaml package.json
(no output)
```

### For plan 11's validation map

```
M5 | 01-12 T3 | grant truncate on public.events to authenticated | a TRUNCATE of events as authenticated is refused with 42501 (+ the privilege enumeration)
```

Recorded as RUN: M5 reds **two** named tests — `a TRUNCATE of events as authenticated is refused with 42501` **and** `authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table` — and leaves the cascading-truncate test green. Suggested companion row:

```
M6 | 01-12 T3 | grant select on public.orgs to anon | anon holds no privilege on any tenant table (exactly one)
```

---

## Files Created/Modified

- `drizzle/0008_revoke_platform_grants.sql` — six statements, five `--> statement-breakpoint`s. Steps 1–2 reproduce the Supabase default (no-op on production); step 3 revokes TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from `anon`+`authenticated`; step 4 revokes everything from `anon`; step 5 re-asserts 0007's events revoke; step 6 retires the default ACL. Idempotent, and the end state is identical whether the platform default was present or absent.
- `drizzle/meta/0008_snapshot.json` — the diff base for the next `generate`. Committed alongside the `.sql`, per CONVENTIONS § Migrations.
- `drizzle/meta/_journal.json` — entry 8, `0008_revoke_platform_grants`, `when: 1790050069242`.
- `tests/db/grants-audit.test.ts` — the six-test guard.
- `tests/db/_fixtures.ts` — `actAsRole` accepts `authenticated`.
- `.planning/CONVENTIONS.md` — new `## Grants` section between `## Migrations` and `## Audit and attribution`.

## Decisions Made

See `key-decisions` in the frontmatter. In short: MAINTAIN revoked as well; test 5 scoped to table-owning roles because the `supabase_admin` default ACL is unalterable and inert; migration 0002's default ACL deliberately retired so future tables grant their own DML; step 5 replays 0007 because step 2 would otherwise undo it; `actAsRole` given a claimless `authenticated`; sequences untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `MAINTAIN` revoked alongside TRUNCATE, REFERENCES and TRIGGER**

- **Found during:** Task 2 (production pre-flight)
- **Issue:** The plan's revoke names three privileges. PostgreSQL 17 added a fourth non-DML table privilege, `MAINTAIN`, which `grant all` includes — so step 2's reproduction would have *granted* it and step 3 would not have taken it back. Worse, the pre-flight showed production already holding it: `anon` and `authenticated` carry `arwdDxtm` on all four tables today. `MAINTAIN` permits `VACUUM FULL`, `CLUSTER` and `REINDEX`, each taking an `ACCESS EXCLUSIVE` lock on a tenant table — denial of service on demand, the same threat class the plan registers as T-1-30, and equally invisible to row-level security.
- **Fix:** `revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;` in 0008, and a fourth column in the test-1 privilege matrix (`NON_DML`), with the reasoning in both files.
- **Files modified:** `drizzle/0008_revoke_platform_grants.sql`, `tests/db/grants-audit.test.ts`
- **Verification:** `has_table_privilege('authenticated','public.<t>','MAINTAIN')` → `f` on all four tables on **both** databases; test 1 enumerates 16 pairs (4 tables x 4 privileges) and none is held.
- **Committed in:** `cbd10fa`

**2. [Rule 1 - Bug] Test 5's assertion is unsatisfiable on production as literally specified**

- **Found during:** Task 2 (production pre-flight)
- **Issue:** The plan's test 5 counts every `pg_default_acl` row for schema `public` granting to `anon`/`authenticated` on tables, and requires 0. Production has **two** such rows: one owned by `postgres` (which 0008 fixes) and one owned by `supabase_admin` (which it cannot). `alter default privileges for role supabase_admin ...` is refused — `permission denied to change default privileges` — because `postgres` is not a member of `supabase_admin`. The plan anticipates a different `defaclrole` and says to use `for role <that role>`; that remedy does not apply, because the `postgres` entry exists *as well* and the `supabase_admin` entry is not writable by any role this repo can connect as. Left unscoped, the criterion would have been red on production forever and green on local — the exact false-parity signal this plan exists to eliminate.
- **Fix:** the assertion is scoped to `d.defaclrole in (select distinct c.relowner from pg_class ... where nspname='public' and relkind='r')` — the roles that actually own tables in `public`, which is the set of roles that create them, and therefore the only default ACLs that can reach a future table here. `supabase_admin` owns **zero** tables in `public`; drizzle-kit creates every table as `postgres`. Both facts verified on production. The reasoning is written into the test, the migration header and CONVENTIONS § Grants.
- **Files modified:** `tests/db/grants-audit.test.ts`, `drizzle/0008_revoke_platform_grants.sql` (header), `.planning/CONVENTIONS.md`
- **Verification:** scoped count → **0** on production and **0** on local; unscoped count → 16 on production (all `supabase_admin`'s) and 0 on local, recorded above rather than hidden. The scoped assertion was re-run RED under the reproduction (`expected 16 to be +0`) before 0008 was applied, so the shipped form is the form that was watched failing.
- **Committed in:** `cbd10fa`

**3. [Rule 3 - Blocking] `actAsRole` refused the role the plan's tests 3 and 4 require**

- **Found during:** Task 1
- **Issue:** The plan specifies `actAsRole('authenticated')`, but `tests/db/_fixtures.ts` hard-refuses anything but `app_user` and `anon` (`actAsRole: refusing role authenticated`). Tests 3 and 4 could not be written as specified.
- **Fix:** `authenticated` added to the allow-list, with the reasoning: the list stays explicit (the role name is concatenated into `set local role`, which takes no bound parameter), and a claimless `authenticated` session is the *correct* probe for a grant refusal — a valid org claim would only make these look like RLS tests.
- **Files modified:** `tests/db/_fixtures.ts`
- **Verification:** tests 3 and 4 red under the reproduction (the TRUNCATE ran), green after 0008 (42501), and red again under mutation 1 — so the role switch demonstrably takes effect.
- **Committed in:** `bce8dae`

**4. [Rule 2 - Missing Critical] Test 1's table list did not assert it was complete**

- **Found during:** Task 1
- **Issue:** `TENANT_TABLES` is a hard-coded array, and the test's name claims something about "any tenant table". A table added in Phase 2 or 3 without being added to the array would leave the claim false and the test green — the guard would silently stop guarding exactly when it mattered, which is the failure mode plan 09 already hit once with a disabled trigger.
- **Fix:** test 1 reads `pg_class` for schema `public` first and asserts the live table set equals `TENANT_TABLES`. Forgetting to extend the list is now red. CONVENTIONS § Grants states the obligation.
- **Files modified:** `tests/db/grants-audit.test.ts`, `.planning/CONVENTIONS.md`
- **Verification:** green against the live four; the two privilege enumerations also assert their row counts (16 and 20) so a predicate typo that matched nothing cannot pass as "no violations".
- **Committed in:** `cbd10fa`

### Recorded, not auto-fixed

**5. Two of the plan's red-run predictions were wrong; the tests were right**

Recorded as run rather than reasoned, per the house rule.

- **"On the current local database tests 1–6 are all GREEN."** Test 5 was **already red** before any reproduction, because `drizzle/0002_tenancy_functions.sql` sets the repo's own default ACL (`{authenticated=arwd/postgres}`). The machine brief also stated local had no default ACL; it does. The prediction was wrong; nothing was changed to make it true.
- **"test 6 stays green."** It went red under the reproduction, because step 2's blanket `grant all` re-opens `update`/`delete` on `events` — the single cause that also reds both `events-append-only` tests. Test 6 catching the migration's own intermediate state is the plan's stated intent for it ("plan 09's guarantee must survive this migration") and is precisely why 0008 step 5 replays 0007's revoke.

**6. Migration 0002's default ACL is retired by 0008 — a standing obligation for Phases 2 and 3**

The plan's test 5 and its § Grants text both require `pg_default_acl` to grant nothing to `authenticated` on tables. Migration 0002 grants `select, insert, update, delete` there by design, so the two cannot both stand and 0008 removes it. **Consequence: a table created by a future migration inherits nothing and must carry its own `grant` in the same migration.** Existing tables are unaffected — a default ACL governs only objects created after it. The failure mode for forgetting is loud (`42501 permission denied for table <t>` on the first user-role statement), it is written into CONVENTIONS § Grants, and it is repeated under Next Phase Readiness.

**7. The plan's test-5 SQL does not parse on PostgreSQL 17/18**

`(aclexplode(d.defaclacl)).grantee in (...)` inside `WHERE` → `ERROR: set-returning functions are not allowed in WHERE`. The plan anticipates this and authorises a lateral form; a `cross join lateral aclexplode(...)` is used throughout, in the test and in every ad-hoc probe.

**8. Scope boundary — not fixed, deliberately**

`anon` retains `usage, select` on **sequences** in `public` on production (Supabase's default ACL for `S`, which 0008 does not touch — the plan scopes the fix to tables, and revoking sequence privileges from `authenticated` would break the `events` identity column). `anon` is unreachable by this application: `app_user` is `NOINHERIT` and holds `authenticated` alone, so nothing can `set role anon`. With no table privileges, the residual sequence access grants no data. Logged here rather than fixed, to keep the plan's scope.

---

**Total deviations:** 4 auto-fixed (2 missing critical, 1 bug, 1 blocking) + 4 recorded findings.
**Impact on plan:** No scope creep. Deviations 1 and 2 both came from reading production before writing the migration, and one of them (MAINTAIN) closes a live production hole the plan never named while the other prevents a permanently-red criterion. Deviations 3 and 4 are mechanical: one unblocked the plan's own test spelling, the other stops the guard from lying by omission. Nothing was changed to make a check pass.

## Issues Encountered

- **The plan's picture of the local database was out of date in both directions.** It expected no default ACL locally (migration 0002 sets one) and a clean `postgres`-only default ACL on production (Supabase keeps a second, unalterable one). Both were resolved by reading the catalogs rather than the brief, which is also what caught `MAINTAIN`.
- **`psql` hides the SQLSTATE by default.** The first production post-flight captured `ERROR: permission denied for table events` with no code. Re-run with `\set VERBOSITY verbose` to get `ERROR: 42501: permission denied for table events`, because "permission denied" alone is an inference and this plan's whole currency is the pinned code.
- **`pnpm verify` remains unrunnable on this machine** (the standing 01-01 defect: the nested bare `pnpm` resolves to the broken 11.9.0 shim). All four constituents were run individually — typecheck 0, lint 0, test:unit 11/11, test:db 31/31 — which is the entire content of `verify`. Unchanged by this plan; CI invokes the constituents through its own pnpm.

## Known Stubs

None. Every statement in migration 0008 and every assertion in the guard is exercised against a live database — both of them.

## Threat Flags

None new. The files changed introduce no network endpoint, auth path or file-access pattern. The trust-boundary changes are the ones the plan's `<threat_model>` registers, and all three are now mitigated and tested:

| Threat | Status |
|---|---|
| T-1-30 (Tampering / DoS via TRUNCATE) | **Mitigated**, and widened to cover `MAINTAIN`. Refused 42501 on both databases, by attempt. |
| T-1-31 (EoP via `pg_default_acl` on future tables) | **Mitigated** for every default ACL this repo's roles can own; the `supabase_admin` row is documented as unalterable and inert. |
| T-1-03 (revised — RLS bypass) | **Mitigated.** The original text assumed RLS covered every verb; TRUNCATE and MAINTAIN are the exceptions and are now closed by grant. |

## User Setup Required

None — no external service configuration. The production database was written by `drizzle-kit` alone, through `scripts/db.ts --target=prod`, using the session-pooler URL already present in the gitignored `.env.local`.

## Next Phase Readiness

**Ready for 01-11** (phase verification and deploy). The blocker 01-10 raised is cleared:

- Deploying now ships an application whose `authenticated` sessions **cannot** truncate a tenant's rows or the audit log, on production, proven by attempt rather than by catalog.
- `drizzle.__drizzle_migrations` is 9 rows on both databases and `pnpm db:generate` reports no drift, so plan 11's parity checks start from a known-equal state.
- The local database is left in the post-0008 state (the reproduction is now *in* the migration, so a fresh `db:migrate` on any machine reaches the same place).

**Carried forward — read before Phase 2 or 3 creates a table:**

- 🔴 **A new table inherits no privileges.** The migration that creates it must grant `authenticated` the DML its policies need, in that same migration, and must add the table name to `TENANT_TABLES` in `tests/db/grants-audit.test.ts` — test 1 compares that array to the live catalog, so omitting it is red. `.planning/CONVENTIONS.md` § Grants is the contract.
- `anon` retains sequence `usage, select` on production (Supabase's `S` default ACL). Unreachable by the application and harmless with no table privileges; worth one line in a future hardening pass, not a blocker.
- **Suggested for `01-VALIDATION.md`:** add M5 and M6 as written above, and record that M5 reds two named tests.

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-22*

## Self-Check: PASSED

**Files claimed created/modified — all present on disk:**

```
FOUND: drizzle/0008_revoke_platform_grants.sql
FOUND: drizzle/meta/0008_snapshot.json
FOUND: tests/db/grants-audit.test.ts
FOUND (modified): drizzle/meta/_journal.json
FOUND (modified): tests/db/_fixtures.ts
FOUND (modified): .planning/CONVENTIONS.md
```

**Commits claimed — all present in `git log`:**

```
FOUND: bce8dae  test(01-12): add the grants audit, watched failing under the reproduced platform condition
FOUND: cbd10fa  feat(01-12): revoke the Supabase platform grants on both databases
FOUND: c3c4b1f  docs(01-12): record the grant contract Phases 2 and 3 read
```

**Plan `<verification>` re-run:**

| Check | Result |
|---|---|
| `test:db --reporter=verbose` → 31 passed, six grants-audit names printed | ✅ 9 files, 31 tests, exit 0 |
| Production and local: `has_table_privilege('authenticated','public.events','TRUNCATE')` false | ✅ `f` on both |
| Production and local: `pg_default_acl` clean for `anon`/`authenticated` | ✅ 0 on both, scoped to table-owning roles (Deviation 2) |
| Production: TRUNCATE as `authenticated` refused 42501 | ✅ P1, P6, P7, P8 all `42501`; two controls succeed |
| `drizzle.__drizzle_migrations` = 9 rows on both | ✅ 9 / 9 |

**Plan `<success_criteria>` re-run:**

| Criterion | Result |
|---|---|
| The 01-10 defect is refused by grant on production, reproduced and refused on local, guarded by a test watched failing under the reproduced condition | ✅ |
| Dev, CI and production hold an identical grant surface for `anon`, `authenticated`, `service_role` on every tenant table | ✅ side-by-side above, identical; CI reaches it by running the same migration |
| Every prior DB test still passes | ✅ 25 → 31, no prior test changed behaviour |

**Task acceptance criteria:**

| Criterion | Result |
|---|---|
| six `it(` blocks, names exact | ✅ 6 |
| `grep -c '42501' tests/db/grants-audit.test.ts` ≥ 2 | ✅ 5 |
| `grep -c 'setActive' tests/db/grants-audit.test.ts` = 0 | ✅ 0 |
| reproduction grants left in place on local (0008 removes them) | ✅ applied, then converged by the migration |
| 0008 contains `revoke truncate`, `from anon`, `alter default privileges`, `revoke update, delete on public.events from authenticated` | ✅ 1 / 3 / 5 / 1 |
| journal has a 9th entry; 9 rows on BOTH databases | ✅ |
| `git diff --stat pnpm-lock.yaml package.json` empty | ✅ empty (no `@pnpm/exe` pollution this run) |
| `git status --short` empty | ✅ |
| no Supabase MCP / CLI / dashboard SQL used | ✅ stated and true; every write went through `scripts/db.ts` + drizzle-kit |
| `## Grants` in CONVENTIONS.md mentioning TRUNCATE, `anon`, `service_role`, `grants-audit` | ✅ all four present |
| both mutations recorded as run, reverted, verified from `has_table_privilege` | ✅ |

`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were **not** modified — the orchestrator owns those writes. Nothing was pushed and nothing was deployed.
