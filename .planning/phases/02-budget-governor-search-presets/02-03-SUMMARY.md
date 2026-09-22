---
phase: 02-budget-governor-search-presets
plan: 03
subsystem: database
tags: [schema, rls, grants, migrations, reference-data, versioning, audit]
requires:
  - 'Phase 1 drizzle/0000-0011 (app.current_org_id, app.log_event, app.touch_updated_at, the 0008 grant regime)'
  - 'src/db/schema/_helpers.ts orgScoped / orgPolicies'
provides:
  - 'industry_clusters, industry_terms (cluster reference data)'
  - 'counties, cities, geo_presets (geography reference data, SRCH-01s three kinds)'
  - 'outlet_counts (the estimators core table)'
  - 'searches + search_versions (the versioned preset pair, append-only by grant)'
  - 'runs (execution records, cost_micro_usd bigint, six statuses)'
  - 'orgScopedNullable + referencePolicies() for any later NULL-org table'
affects:
  - '02-05 (budget tables widen TENANT_TABLES again, to 16, and EVENT_LOGGED to 5)'
  - '02-06 (the reference-row refusal-shape tests read these policies)'
  - '02-04 / the estimator (reads outlet_counts, industry_terms)'
  - 'Phase 3 (the seed loader writes the built-ins as the owner)'
  - 'Phase 4 (the run executor writes runs through the column grant)'
tech-stack:
  added: []
  patterns:
    - 'RESEARCH Pattern 5 — reference rows: read admits org_id IS NULL, every write policy excludes it'
    - 'RESEARCH Pattern 6 — versioned presets: immutable by GRANT, circular FK set in a second statement'
    - 'CONVENTIONS § Grants — a new table inherits nothing and grants its own DML in the same migration'
    - 'Migration 0010 precedent — a key a policy cannot protect is a COLUMN grant'
key-files:
  created:
    - src/db/schema/clusters.ts
    - src/db/schema/geography.ts
    - src/db/schema/outlet-counts.ts
    - src/db/schema/searches.ts
    - src/db/schema/runs.ts
    - drizzle/0012_eager_vertigo.sql
    - drizzle/0013_reference_policies_and_grants.sql
    - drizzle/meta/0012_snapshot.json
    - drizzle/meta/0013_snapshot.json
  modified:
    - src/db/schema/_helpers.ts
    - src/db/schema/index.ts
    - drizzle/meta/_journal.json
    - tests/db/grants-audit.test.ts
    - tests/db/event-trigger.test.ts
decisions:
  - 'runs.cost_micro_usd defaults via sql`0`, not BigInt(0) — drizzle-kit 0.31.10 JSON.stringifys defaults into the snapshot and throws on a BigInt, emitting no migration at all'
  - 'The generated migration keeps drizzle-kits own name 0012_eager_vertigo.sql — renaming a generated file breaks its checksum'
  - 'searches.current_version_id FK is ON DELETE SET NULL while runs.search_version_id is ON DELETE NO ACTION — deliberately asymmetric'
  - 'Two new grant tests added: the plans prescribed mutation left the suite green, so T-2-12 had no detector at all'
metrics:
  duration: ~75 min
  completed: 2026-09-22
  tasks: 3
  commits: 3
  db-tests: 39 (was 37)
---

# Phase 02 Plan 03: Search & Reference Schema Summary

Nine tables — six `org_id IS NULL` reference tables, the versioned `searches`/`search_versions` pair and `runs` — applied to the local test database with their RLS policies, explicit DML grants, `search_versions`' grant-level immutability, the circular FK and the audit triggers, in one generated migration plus one custom one, with no drift.

## What shipped

| Table | org_id | Policies | Grant to `authenticated` | Triggers |
|---|---|---|---|---|
| `industry_clusters` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `industry_terms` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `counties` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `cities` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `geo_presets` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `outlet_counts` | nullable | `referencePolicies` (4) | S,I,U,D | touch |
| `searches` | NOT NULL | `orgPolicies` (4) | S,I,U,D | touch + **log_event** |
| `search_versions` | NOT NULL | select + insert (2) | **S,I only** (U,D revoked) | **log_event** |
| `runs` | NOT NULL | `orgPolicies` (4) | S,I + **column** UPDATE | touch |

`runs`' column grant is `update (status, stopped_reason, cost_micro_usd, calls_count, started_at, finished_at)`. `search_version_id`, `org_id`, `id`, `created_at`, `updated_at` and `updated_by` sit outside it.

## Migration file names drizzle-kit chose

The plan anticipated `0012_search_reference_schema.sql`. **drizzle-kit named it `drizzle/0012_eager_vertigo.sql`** and, per the plan's own instruction, it was not renamed — drizzle-kit hashes the SQL text and an applied file that changes is a broken checksum. The custom migration took the name given on the command line: `drizzle/0013_reference_policies_and_grants.sql`. Both `meta/0012_snapshot.json` and `meta/0013_snapshot.json` are committed.

## Pre-flight read (before any write)

Separate read-only connection, run before `db:migrate`:

```
--- server_version ---  [{ "v": "18.6", "n": "180006" }]
--- applied migrations --- ids 1..12  (drizzle/0000-0011)
--- public tables ---   businesses, events, orgs, source_records
```

`pnpm db:check` → `check-test-db: ok — PostgreSQL 18.6 on x86_64-windows`.

After `db:migrate`: **14** rows in `drizzle.__drizzle_migrations` (12 → 14), 13 tables in `public`. A second `db:migrate` applied nothing and returned immediately.

## Verbatim `db:generate` no-drift output

Run immediately after `db:migrate`:

```
13 tables
orgs 8 columns 0 indexes 0 fks
events 9 columns 1 indexes 1 fks
businesses 17 columns 1 indexes 1 fks
source_records 13 columns 1 indexes 2 fks
industry_clusters 8 columns 1 indexes 1 fks
industry_terms 10 columns 1 indexes 2 fks
cities 10 columns 1 indexes 2 fks
counties 11 columns 1 indexes 1 fks
geo_presets 9 columns 1 indexes 1 fks
outlet_counts 11 columns 1 indexes 3 fks
search_versions 10 columns 1 indexes 2 fks
searches 9 columns 1 indexes 1 fks
runs 12 columns 2 indexes 2 fks

No schema changes, nothing to migrate 😴
```

The triggers, grants, circular FK and the `comment on table` are not in the Drizzle TS schema and the differ does not try to claw any of them back.

## PostgreSQL 17 portability

Production is 17.6; local and CI are 18. The grep gate over **every** `drizzle/*.sql` returns zero matches for `returning old.`, `returning new.` and `uuidv7(`, and neither new migration declares a virtual generated column. `UNIQUE NULLS NOT DISTINCT` appears 6 times in 0012 and is PostgreSQL 15+, so 17.6 supports it.

⚠️ **The plan's Task 2 verify `pnpm test:unit -t "pg17"` is vacuous in this worktree** — see Deviation 2.

## `pnpm test:db` — 39 passed, 9 files, by NAME

```
✓ grants audit > authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table
✓ grants audit > anon holds no privilege on any tenant table
✓ grants audit > a TRUNCATE of events as authenticated is refused with 42501
✓ grants audit > a cascading TRUNCATE of every tenant table as authenticated is refused with 42501
✓ grants audit > the public schema default ACL grants nothing to anon or authenticated on tables
✓ grants audit > authenticated keeps the DML the policies rely on
✓ grants audit > authenticated holds exactly the DML each Phase 2 table needs        [NEW]
✓ grants audit > a finished run cannot be re-pointed at another search version       [NEW]
✓ grants audit > authenticated can update an orgs label but not its clerk_org_id
✓ attribution is a property of the database > a direct write still produces an event
✓ attribution is a property of the database > an UPDATE of only a domain column still moves updated_at and stamps updated_by
✓ attribution is a property of the database > every state-bearing table has an app.log_event after-row trigger
✓ RLS tenant isolation > org A sees only its own org rows under a v1 flat claim
✓ RLS tenant isolation > a token v2 nested claim resolves the same org as v1
✓ RLS tenant isolation > org A cannot INSERT into org B, and the refusal is 42501
✓ RLS tenant isolation > a second statement in the same aborted transaction reports 25P02
✓ RLS tenant isolation > a cross-org UPDATE and DELETE are filtered, not refused
✓ RLS tenant isolation > a tenant cannot re-key its own clerk_org_id
✓ RLS tenant isolation > positive control: a tenant can still rename itself, and the touch trigger still fires
✓ RLS tenant isolation > a connection without set local role authenticated is refused 42501
✓ withOrg binds the tenant claims and they die with the transaction
✓ events are immutable by grant > events are append-only: UPDATE as authenticated is refused
✓ events are immutable by grant > events are append-only: DELETE as authenticated is refused
✓ events are immutable by grant > a caller cannot author its own audit row
✓ events are immutable by grant > positive control: app.emit_event writes and stamps the actor itself
✓ Places retention is a database constraint > google content cannot be durable
✓ Places retention is a database constraint > an ephemeral source record without expires_at is refused
✓ Places retention is a database constraint > a durable source record with an expires_at is refused
✓ Places retention is a database constraint > durable cites durable: a durable field citing an ephemeral source is refused
✓ Places retention is a database constraint > positive control: a durable field citing a durable source is accepted
✓ Places retention is a database constraint > source_records has a partial index on expires_at
✓ app.ensure_org > app.ensure_org is idempotent for the caller own org
✓ app.ensure_org > app.ensure_org writes nothing on an already-provisioned org
✓ app.ensure_org > app.ensure_org refuses another org with 42501
✓ schema audit > every public table is org-scoped and has RLS enabled
✓ schema audit > every timestamp column in public is timestamptz
✓ schema audit > businesses has three distinct name fields
✓ timezone discipline in SQL > one instant, two zones, opposite verdicts
✓ timezone discipline in SQL > DST: the offset is not a constant, so "subtract six hours" is wrong twice a year

 Test Files  9 passed (9)
      Tests  39 passed (39)
```

The Phase 1 baseline on disk was **37**, not the 31 the plan estimated; this plan adds 2. `every public table is org-scoped and has RLS enabled` passes across all 13 tables **without** `ALLOW_NO_ORG_ID` being touched — every reference table carries an `org_id` column, merely nullable.

## Watched-red-first evidence

Both mutations applied to the **live database** only, never to a migration file.

**Mutation 1 — `revoke select on public.counties from authenticated;`**

Verbatim failing test name:

```
FAIL tests/db/grants-audit.test.ts > grants audit > authenticated holds exactly the DML each Phase 2 table needs
    "counties": [
 Test Files  1 failed | 8 passed (9)
      Tests  1 failed | 38 passed (39)
```

One test, red, naming `counties`. Reverted with `grant select on public.counties to authenticated;` and verified from `information_schema.role_table_grants`:
`[DELETE, INSERT, SELECT, UPDATE]` for grantee `authenticated`.

**Mutation 2 — `alter table searches disable trigger searches_event;`**

Verbatim failing test name:

```
FAIL tests/db/event-trigger.test.ts > attribution is a property of the database > every state-bearing table has an app.log_event after-row trigger
+     "enabled": "D",
 Test Files  1 failed | 8 passed (9)
      Tests  1 failed | 38 passed (39)
```

The failure is on the **`tgenabled`** assertion, not on set equality — which is precisely why that assertion exists. `alter table … disable trigger` leaves the `pg_trigger` row exactly where it was, so a row-counting enumeration would have reported full coverage while attribution was silently off. Reverted with `enable trigger` and verified from `pg_trigger`: `search_versions_event` = `O`, `searches_event` = `O`.

**Revert proven by construction:** `git diff --stat -- drizzle src` is **empty**, and `tests/db/schema-audit.test.ts` has no diff at all.

## Other verification

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 — compiled in 10.5s, 5 routes |
| `pnpm db:migrate` | exit 0, idempotent on a second run |
| `pnpm db:generate` (after) | `No schema changes, nothing to migrate` |
| `pnpm test:db` | 39 passed / 9 files |

`pnpm verify` was not run as a whole: it calls bare `pnpm` internally, which on this machine resolves to a broken global 11.9.0. Its five parts were run individually through the store launcher.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `db:generate` aborted on a BigInt default, emitting no migration**

- **Found during:** Task 2, the first `db:generate`
- **Issue:** `runs.costMicroUsd` was declared `.default(BigInt(0))` as the plan's `bigint … not null default 0` implies. drizzle-kit 0.31.10 serializes column defaults into `meta/NNNN_snapshot.json` with `JSON.stringify`, which cannot serialize a BigInt:
  ```
  TypeError: Do not know how to serialize a BigInt
      at JSON.stringify (<anonymous>)
      at diffSchemasOrTables (drizzle-kit/bin.cjs:22188:27)
  ```
  No migration file was written at all. Note that `pnpm typecheck` was **green** with this in place — the failure is only reachable through the generator.
- **Fix:** `.default(sql\`0\`)`, which emits the identical `"cost_micro_usd" bigint DEFAULT 0 NOT NULL` in the DDL. Commented at the call site so it is not "simplified" back.
- **Files modified:** `src/db/schema/runs.ts`
- **Commit:** `3ff3a3f`

**2. [Rule 2 - Missing guard] The plan's prescribed mutation left the entire suite GREEN**

- **Found during:** Task 3, watched-red-first step
- **Issue:** The plan specifies `revoke select on public.counties from authenticated` → "the grants audit goes red naming `counties`". It did not. Nothing in the suite asserted that the nine new tables hold the DML their policies need:
  - `TENANT_TABLES` only drives the **NON-DML** matrix (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN absence) and the live-catalog equality check.
  - `authenticated keeps the DML the policies rely on` hardcodes `businesses` and `events`.

  Since migration 0008 a new table inherits **nothing**, so a migration that forgets its grant ships a table no tenant can read — loud in production (`42501 permission denied for table <t>`), completely silent in the suite. Separately, **T-2-12 had no detector at all**: nothing asserted that `runs.search_version_id` is outside the column grant or that the FK is `no action`, so the threat register's headline mitigation for this plan was unfalsifiable.
- **Fix:** two tests added to `tests/db/grants-audit.test.ts`, both with per-table/per-column literals so a change is a diff a reviewer sees:
  - `authenticated holds exactly the DML each Phase 2 table needs` — expected `[SELECT, INSERT, UPDATE, DELETE]` per table, with a row-count control.
  - `a finished run cannot be re-pointed at another search version` — reads `has_table_privilege`, `has_any_column_privilege` and `has_column_privilege` side by side (the first cannot see a column grant), plus `confdeltype = 'a'` from `pg_constraint`. `any_col_update: true` is the positive control: revoking UPDATE entirely would otherwise satisfy the negative assertions while breaking the run executor.
  With these in place mutation 1 reds exactly one test, naming `counties`.
- **Files modified:** `tests/db/grants-audit.test.ts`
- **Commit:** `43be635`

### Documented, not fixed

**3. `pnpm test:unit -t "pg17"` (Task 2's verify) is vacuous in this worktree**

The `pg17` guard is **plan 02-02's deliverable** and lives in a sibling worktree; no test in this tree matches the filter. Run as written it reports:

```
 Test Files  5 skipped (5)
      Tests  16 skipped (16)
```

— **0 passed, exit 0**. This is exactly the "a vitest `-t` filter that matches nothing silently exits green" trap, and treating that exit code as a portability guarantee would have been false. Substituted the equivalent real check, recorded under *PostgreSQL 17 portability* above: a grep gate for `returning old.` / `returning new.` / `uuidv7(` over every file in `drizzle/`, which is what the pg17 test automates. **Once wave 1 merges, 02-02's `pg17` test covers these two migrations with no further change** — it reads `drizzle/*.sql` and `server_version_num`, both of which now include this plan's output. No action needed beyond the merge.

**4. `prettier --check` is red across the repo, including untouched Phase 1 files**

`src/db/schema/businesses.ts`, `events.ts`, `orgs.ts` and `source-records.ts` all fail it in this worktree, while the five files created here pass — the cause is CRLF line endings applied by git on worktree checkout, not content. Prettier is not part of `pnpm verify` and `pnpm lint` is green, so nothing was reformatted; running `--write` would have produced a large line-ending-only diff across unrelated files. Out of scope, logged here rather than fixed.

## Requirements satisfied

- **SRCH-01** — a preset's geography persists as cities, counties or a radius: `geo_presets.kind` and `search_versions.geo_kind` are both constrained to exactly `('cities','counties','radius')`, with the kind-specific body in the paired `jsonb` column.
- **SRCH-02** — reference rows ship `org_id IS NULL`, a tenant SEES them (`referencePolicies` select is `org_id is null or org_id = …`) and cannot mutate or forge one (all three write policies carry `org_id is not null and …`). Duplicate built-ins are refused by `UNIQUE NULLS NOT DISTINCT`. The refusal *shapes* (zero rows for UPDATE/DELETE, `42501` for a forged INSERT) are plan 02-06's tests.
- **SRCH-03** — `search_versions` is immutable by GRANT: `grant select, insert` + `revoke update, delete`, so the refusal is `42501 permission denied for table search_versions` and not a silent zero-row filter. `runs.search_version_id` is outside the column grant and its FK is `ON DELETE NO ACTION`, both now asserted.

## Notes for the next plan

- **`TENANT_TABLES` is 13 and `EVENT_LOGGED` is 4.** Plan 02-05 must widen `TENANT_TABLES` to 16 (`budget_periods`, `cost_reservations`, `cost_ledger`) and `EVENT_LOGGED` to 5 (`budget_periods` only — RESEARCH is explicit that `cost_ledger` and `cost_reservations` get **no** row trigger). It must also extend the new `authenticated holds exactly the DML each Phase 2 table needs` literal, or test 1's live-catalog equality goes red first and the DML claim quietly stops covering the budget tables.
- **The next migration is `0014`.** Grant its DML in the same migration; nothing is inherited.
- **The seed loader (Phase 3) runs as the OWNER with no Clerk claim.** That is why no reference table has a `log_event` trigger — `events.org_id` is NOT NULL and `app.current_org_id()` would be NULL, failing the seed with `23502`. Do not "fix" this by adding one.
- **`geo_presets.payload` and `search_versions.geo_payload` are unvalidated `jsonb`.** The shape-per-kind contract is enforced in TypeScript (Zod) by the plans that write them, not by the database. A CHECK over `jsonb` was not added because the three payload shapes are still being settled in 02-04.

## Known Stubs

None. This plan ships no UI and no placeholder values; every table it declares is applied and exercised.

## Threat Flags

None. Every security-relevant surface this plan introduces (the reference-row write exclusion, `search_versions` immutability, the `runs` column grant, the audit triggers) is in the plan's `<threat_model>` as T-2-09 through T-2-12, and each is now asserted by a named test.

## Self-Check: PASSED

Files verified present:

```
FOUND: src/db/schema/clusters.ts
FOUND: src/db/schema/geography.ts
FOUND: src/db/schema/outlet-counts.ts
FOUND: src/db/schema/searches.ts
FOUND: src/db/schema/runs.ts
FOUND: drizzle/0012_eager_vertigo.sql
FOUND: drizzle/0013_reference_policies_and_grants.sql
FOUND: drizzle/meta/0012_snapshot.json
FOUND: drizzle/meta/0013_snapshot.json
```

Commits verified in `git log`:

```
FOUND: 3c4283b  feat(02-03): declare the nine search and reference tables in Drizzle
FOUND: 3ff3a3f  feat(02-03): apply the nine tables with their policies, grants and triggers
FOUND: 43be635  test(02-03): widen the grant and event enumerations to the nine new tables
```
