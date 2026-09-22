---
phase: 01-foundations-tenancy
reviewed: 2026-09-22T08:26:53Z
depth: standard
files_reviewed: 68
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - .gitignore
  - .vercelignore
  - docs/deploy.md
  - docs/local-postgres.md
  - drizzle.config.ts
  - drizzle/0000_bootstrap.sql
  - drizzle/0001_tenancy.sql
  - drizzle/0002_tenancy_functions.sql
  - drizzle/0003_policies.sql
  - drizzle/0004_ensure_org.sql
  - drizzle/0005_retention.sql
  - drizzle/0006_retention_constraints.sql
  - drizzle/0007_event_triggers.sql
  - drizzle/0008_revoke_platform_grants.sql
  - drizzle/meta/_journal.json
  - eslint.config.mjs
  - next.config.ts
  - package.json
  - playwright.config.ts
  - pnpm-workspace.yaml
  - scripts/check-test-db.ts
  - scripts/db.ts
  - src/app/api/health/route.ts
  - src/app/layout.tsx
  - src/app/no-access/page.tsx
  - src/app/page.tsx
  - src/app/sign-in/[[...sign-in]]/page.tsx
  - src/components/activate-sole-organization.tsx
  - src/db/client.ts
  - src/db/schema/_helpers.ts
  - src/db/schema/businesses.ts
  - src/db/schema/events.ts
  - src/db/schema/index.ts
  - src/db/schema/orgs.ts
  - src/db/schema/source-records.ts
  - src/db/with-org.ts
  - src/env.ts
  - src/lib/auth/require-org.ts
  - src/lib/auth/sole-organization.ts
  - src/lib/export/public-business.ts
  - src/lib/export/registry.ts
  - src/lib/time.ts
  - src/proxy.ts
  - tests/db/_fixtures.ts
  - tests/db/ensure-org.test.ts
  - tests/db/event-trigger.test.ts
  - tests/db/events-append-only.test.ts
  - tests/db/grants-audit.test.ts
  - tests/db/retention.test.ts
  - tests/db/rls-isolation.test.ts
  - tests/db/schema-audit.test.ts
  - tests/db/time.test.ts
  - tests/db/with-org.test.ts
  - tests/e2e/_required-env.ts
  - tests/e2e/auth.setup.ts
  - tests/e2e/no-access.spec.ts
  - tests/e2e/signed-in.spec.ts
  - tests/unit/fixtures/business.ts
  - tests/unit/no-internal-leak.test.ts
  - tests/unit/sole-organization.test.ts
  - tests/unit/suite-zone.test.ts
  - tests/unit/time.test.ts
  - tsconfig.json
  - vercel.json
  - vitest.config.ts
  - vitest.db.config.ts
findings:
  critical: 2
  warning: 7
  info: 11
  total: 20
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-22T08:26:53Z
**Depth:** standard
**Files Reviewed:** 68
**Status:** issues_found

Severity vocabulary: **BLOCKER** (listed under Critical Issues) = incorrect behaviour, security gap, or data-integrity risk that must be fixed before this foundation is built on. **WARNING** = degrades correctness of a gate, maintainability, or robustness; should be fixed. **INFO** = dead code, unused declarations, doc/impl drift, tooling gaps.

## Summary

Reviewed every file in scope, read-only, without connecting to any database. Package claims were verified against the installed `node_modules` (drizzle-orm 0.45.2 `foreignKey`/`unique`/`index().where()`, `@clerk/testing` 2.2.36 `emailAddress` overload, `drizzle-kit/bin.cjs`, zod's `.url()` deprecation) and structural claims against the tree (`grep` of `drizzle/meta/0008_snapshot.json`, `src/`, `.env.example`). HEAD at review time: `27e722f`.

The tenancy core is sound where it was designed to be: claims are bound not interpolated, `set_config` is transaction-local, the runtime role is NOINHERIT and owns nothing, TRUNCATE/MAINTAIN are revoked, every SECURITY DEFINER function pins `search_path`, the composite-FK retention design is correct, and the db suite pins SQLSTATEs with one refusal per transaction. The e2e suite deliberately contains no `setActive` workaround. Those are the properties the phase claims and they hold.

Two BLOCKERs sit in the same place the phase's guarantees live, the database:

1. **`app.ensure_org` writes on every page view.** Its `ON CONFLICT DO UPDATE` fires `orgs_touch` and `orgs_event` on the conflict path, so every `GET /` by a signed-in user emits an `update` row into the append-only `events` table and moves `orgs.updated_at`/`updated_by`. D-06's "record of truth for every state change" and D-07's "changed 2h ago by danlo" are both falsified from the first page load, and the CI e2e run does this against production.
2. **`orgs_update` lets a tenant re-key itself.** The policy protects `id` but not `clerk_org_id`, so a member of tenant A can point A's row at any not-yet-provisioned Clerk org id; that org's users then land inside A's data. The RLS suite proves `businesses.org_id` cannot be moved and has no equivalent for the tenant root's own key.

The seven WARNINGs are mostly gate integrity: the e2e job can go green against the previous deployment, CI never runs `next build`, CI never connects as `app_user`, the failure artifact points at a directory the reporter never writes, `db:check --bootstrap` cannot pass on a migrated database, the audit log accepts caller-authored rows, and six hand-written constraints exist only in SQL while the Drizzle schema and snapshot know nothing of them.

## Critical Issues

### CR-01: `app.ensure_org` emits a spurious audit event and rewrites `updated_at`/`updated_by` on every render of `/`

**Severity:** BLOCKER
**File:** `drizzle/0004_ensure_org.sql:16-19`, `src/app/page.tsx:16`, `src/lib/auth/require-org.ts:40-47`, `drizzle/0007_event_triggers.sql:52-64`
**Issue:** `page.tsx` calls `ensureOrgRow()` on every render, and `ensure_org` resolves the already-provisioned case with

```sql
insert into orgs (clerk_org_id, name_internal, display_name)
     values (p_clerk_org_id, p_display_name, p_display_name)
on conflict (clerk_org_id) do update set clerk_org_id = excluded.clerk_org_id
returning id into v_id;
```

PostgreSQL executes the `DO UPDATE` arm as a real row UPDATE (a same-value SET is not a no-op), and row-level `BEFORE UPDATE` and `AFTER UPDATE` triggers fire for the conflicting row. Migration 0007 attaches `orgs_touch` (BEFORE UPDATE) and `orgs_event` (AFTER INSERT OR UPDATE OR DELETE) to `orgs`. Consequences, per signed-in page view:

- `orgs_touch` sets `updated_at = now()` and `updated_by = <viewer's Clerk sub>`. D-07's columns now mean "last viewed by", not "last changed by".
- `orgs_event` inserts an `events` row with `action = 'update'` whose `before` and `after` differ only in `updated_at`/`updated_by`. The append-only audit log grows by one fabricated state change per request, with `actor_id` = whoever loaded the page.
- Each call takes a row lock on the tenant's `orgs` row, serialising concurrent renders of the same tenant.
- `tests/e2e/signed-in.spec.ts` loads `/` against the production alias on every push to `main`, so CI writes an `events` row into production per run.

The doc comment on `ensureOrgRow` ("provision the orgs row just-in-time on the first authenticated request carrying a Clerk org claim not yet seen") describes behaviour the code does not have. `tests/db/ensure-org.test.ts` proves idempotence of the *return value* only; it never counts `events`.

**Fix:** make the conflict path a read, not a write. `ensure_org` is SECURITY DEFINER and runs as the owner, so the follow-up `select` bypasses RLS and always finds the row:

```sql
create or replace function app.ensure_org(p_clerk_org_id text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_claim text;
begin
  v_claim := coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id');
  if p_clerk_org_id is distinct from v_claim then
    raise exception 'ensure_org: org does not match the caller claim' using errcode = '42501';
  end if;
  select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  if v_id is not null then return v_id; end if;
  insert into orgs (clerk_org_id, name_internal, display_name)
       values (p_clerk_org_id, p_display_name, p_display_name)
  on conflict (clerk_org_id) do nothing
  returning id into v_id;
  if v_id is null then  -- lost a race to a concurrent first request
    select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  end if;
  return v_id;
end $$;
```

Add to `tests/db/ensure-org.test.ts`, under the existing idempotence test: call `ensure_org` twice, then assert `select count(*) from events where entity_type = 'orgs' and action = 'update'` is `0` and `... and action = 'insert'` is `1`, and that `orgs.updated_at` is unchanged between the two calls (backdate it on the first insert as `event-trigger.test.ts:127-131` does, since `now()` is constant within the transaction). Run it against the current SQL first and watch it fail on the `update` count.

Separately, consider whether `ensureOrgRow` belongs on every render at all; after this fix the cost is one indexed SELECT per request, which is tolerable, but a Phase 2 layout could do it once and pass the row id down.

### CR-02: `orgs_update` policy allows a tenant to change its own `clerk_org_id`, re-keying the tenant onto another Clerk organisation

**Severity:** BLOCKER
**File:** `drizzle/0003_policies.sql:5`, `src/db/schema/orgs.ts:32-37`, `drizzle/0008_revoke_platform_grants.sql:46`
**Issue:** The policy is

```sql
CREATE POLICY "orgs_update" ON "orgs" FOR UPDATE TO "authenticated"
  USING (id = (select app.current_org_id()))
  WITH CHECK (id = (select app.current_org_id()));
```

and migration 0008 step 2 leaves `authenticated` with table-level UPDATE on `orgs`. `id` is protected (the InitPlan evaluates `current_org_id()` against the statement snapshot, so NEW.id must equal the caller's org), but nothing constrains `clerk_org_id`. A member of tenant A with claims `{o:{id:'org_A'}}` can execute

```sql
update orgs set clerk_org_id = 'org_X' where id = <A.id>;
```

USING passes (`A.id = A.id`), WITH CHECK passes (NEW.id is still `A.id`; `current_org_id()` is STABLE and sees the pre-statement row), and the row is rewritten. From then on:

- Any Clerk organisation whose id is `org_X` and whose row has not yet been provisioned resolves, through `app.current_org_id()` and through `app.ensure_org` (whose `ON CONFLICT (clerk_org_id)` returns the existing row), to tenant A. Its members read and write A's `businesses`, `source_records` and `events`; A's data is exposed to X and X's writes land in A.
- Tenant A's own members lose access to their tenant until an owner repairs the row.

The db suite pins that `businesses.org_id` cannot be moved across tenants (`rls-isolation.test.ts:77-90`) but has no test that the tenant root's own key is immutable to `authenticated`. Phase 1 exposes no UPDATE path to `orgs`, so this is a latent gap in the backstop rather than a reachable exploit today; it becomes reachable the first time an org-settings server action does `db.update(orgs).set(input)` with a form-derived object. The stated purpose of RLS here is to make that class of mistake harmless. This policy does not.

**Fix:** move UPDATE on `orgs` to column-level privilege, which PostgreSQL checks against the statement's SET list (a BEFORE trigger writing `updated_at`/`updated_by` is not subject to it):

```sql
-- drizzle/0009_orgs_key_immutable.sql (drizzle-kit generate --custom)
revoke update on public.orgs from authenticated;
grant update (name_internal, display_name, timezone) on public.orgs to authenticated;
```

Add to `tests/db/rls-isolation.test.ts`, its own `withRollback`:

```ts
it('a tenant cannot re-key its own clerk_org_id', () =>
  withRollback(async (c) => {
    const { a } = await seedTwoOrgs(c);
    await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
    const attempt = c.query("update orgs set clerk_org_id = 'org_X' where id = $1", [a]);
    await expect(attempt).rejects.toMatchObject({ code: '42501' });
    await expect(attempt).rejects.toThrow(/permission denied for table orgs/);
  }));
```

and a positive control in the same file that `update orgs set display_name = 'Renamed' where id = $1` as the same caller returns `rowCount 1`. Extend `grants-audit.test.ts`'s DML matrix with `has_column_privilege('authenticated','public.orgs','clerk_org_id','UPDATE') = false`. Watch the new refusal test fail against 0008 first.

## Warnings

### WR-01: `authenticated` can insert arbitrary rows into the audit log with any `actor_id`

**Severity:** WARNING
**File:** `drizzle/0007_event_triggers.sql:71`, `drizzle/0003_policies.sql:7`, `src/db/schema/events.ts:35-39`
**Issue:** `events` is append-only by grant, but `authenticated` holds INSERT (0007 line 71, re-granted by 0008 step 2) and `events_insert` permits any row whose `org_id` matches the caller. The trigger `app.log_event()` is SECURITY DEFINER and does not need that grant. So a tenant session can write `insert into events (org_id, actor_id, entity_type, entity_id, action, before, after) values (<own org>, 'user_someone_else', 'businesses', <id>, 'delete', ...)` and the "record of truth" now records a state change that never happened, attributed to someone who never acted. D-06's integrity rests on the application tier never issuing that statement, which is the property the trigger design was chosen to stop relying on. The 0008 comment keeps the sequence grant specifically so `authenticated` can INSERT, anticipating Phase 3's run-level event; that use case does not need a caller-controlled `actor_id`.

**Fix:** revoke direct INSERT and route the one legitimate app-tier event through a definer that stamps the actor itself:

```sql
revoke insert on public.events from authenticated;
create or replace function app.emit_event(p_entity_type text, p_entity_id uuid, p_action text, p_after jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into events (org_id, actor_id, entity_type, entity_id, action, after)
  values ((select app.current_org_id()),
          coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
          p_entity_type, p_entity_id, p_action, p_after)
  returning id into v_id;
  if v_id is null then raise exception 'emit_event: no current org' using errcode = '42501'; end if;
  return v_id;
end $$;
```

Update `grants-audit.test.ts:171-181` (`e_insert: false`) and add a test that a direct `insert into events ...` as `authenticated` is refused with `permission denied for table events`, while `event-trigger.test.ts` continues to prove the trigger path still lands rows. Keep the sequence grant: the trigger still needs it? It does not, since the definer runs as owner; you can drop `usage, select on sequences` for `authenticated` too, but do that as its own migration with its own test.

### WR-02: The e2e gate can pass against the previous deployment

**Severity:** WARNING
**File:** `.github/workflows/ci.yml:46-73`, `docs/deploy.md:156-157`
**Issue:** The `e2e` job runs on `push` to `main` against `vars.E2E_BASE_URL` (the production alias). `docs/deploy.md` records that `vercel git connect` was run, so a push to `main` also starts a Vercel git deployment asynchronously. Nothing in the job waits for or verifies that deployment: Playwright starts as soon as `pnpm install` finishes, typically before the build completes, and the suite exercises whatever the alias served last time. A regression pushed to `main` is therefore reported green by the same push that introduced it, and only a later, unrelated push would surface it. `docs/deploy.md` already names the check ("confirm the commit it names equals `git rev-parse --short HEAD`") and `/api/health` already exposes `commit`; the workflow simply does not use it.

**Fix:** gate the suite on the running commit:

```yaml
      - name: Wait for the deployment of this commit
        run: |
          for i in $(seq 1 60); do
            got=$(curl -fsS "$E2E_BASE_URL/api/health" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
            if [ "$got" = "$GITHUB_SHA" ]; then echo "deployed $got"; exit 0; fi
            sleep 10
          done
          echo "::error::$E2E_BASE_URL never served commit $GITHUB_SHA (last: $got)"; exit 1
```

placed before `pnpm test:e2e`. If `main` is deployed by CLI rather than git integration, replace the poll with a `workflow_run`/`deployment_status` trigger; either way the job must prove the sha before it asserts anything.

### WR-03: CI never runs `next build`; the artifact that deploys is not gated

**Severity:** WARNING
**File:** `.github/workflows/ci.yml:7-21`, `package.json:20`
**Issue:** `verify` runs `typecheck`, `lint`, `test:unit`. `tsc --noEmit` is not `next build`: the build additionally validates route-segment exports and `PageProps`/`searchParams` shapes against generated `.next/types`, bundles server/client boundaries (the `"use client"` export-reference class of bug this repo documents twice), and evaluates `src/env.ts` at collect-time. `.vercelignore` itself records a build that "compiled fine and then FAILED type checking on Vercel", found only after deploy. The `verify` script mirrors the gap. A push that breaks the build is green in CI and red on Vercel.

**Fix:** add a build step. `src/env.ts` throws at import when its two variables are absent, so supply placeholders that satisfy the zod shape without reaching anything:

```yaml
      - run: pnpm build
        env:
          CLERK_SECRET_KEY: sk_test_placeholder_for_build_only
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
          SUPABASE_DB_POOL_URL: postgres://app_user:x@localhost:5432/unused
```

and add `pnpm build` to the `verify` npm script. `postgres()` does not connect at construction, so the placeholder URL is never dialled.

### WR-04: CI never exercises the runtime role; `grant authenticated to app_user` is untested in CI

**Severity:** WARNING
**File:** `.github/workflows/ci.yml:35-36`, `scripts/db.ts:68-80`, `tests/db/with-org.test.ts:29-45`, `drizzle/0000_bootstrap.sql:33`
**Issue:** `scripts/db.ts` sets `app_user`'s local password after every `--target=test` migrate "so the dev server and CI can connect as the non-owner runtime role (D-11b)". CI never does: the `db` job sets only `TEST_DATABASE_URL`, so `with-org.test.ts` falls back to the owner (`SUPABASE_DB_POOL_URL ?? TEST_DATABASE_URL`, line 31) and its own header admits it "proves claim LOCALITY only". As the superuser, `set local role authenticated` always succeeds. The membership that makes the production path work, `grant authenticated to app_user` in 0000, is therefore proven only on a developer machine whose `.env.local` happens to carry the `app_user` URL. Delete line 33 of 0000 and CI stays green while production returns 42501 on every request. `rls-isolation.test.ts:92-102` proves `app_user` *lacks* direct grants; nothing in CI proves it *can* become `authenticated`.

**Fix:** in the `db` job:

```yaml
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/siteless_test
      SUPABASE_DB_POOL_URL: postgres://app_user:app_user@localhost:5432/siteless_test
```

`db:migrate` runs before `test:db` and sets that password, so the order already works. Then drop the fallback in `with-org.test.ts:31` to `process.env.SUPABASE_DB_POOL_URL` alone and add one assertion that the connection is not the owner: `select current_user` inside `withOrg` must be `authenticated` and outside it must be `app_user`. Verify by temporarily removing the 0000 grant locally and reading the failing test's name.

### WR-05: The Playwright failure artifact uploads a directory that is never produced

**Severity:** WARNING
**File:** `playwright.config.ts:21`, `.github/workflows/ci.yml:74-76`
**Issue:** `reporter: 'list'` writes nothing to disk. `trace: 'retain-on-failure'` writes traces under Playwright's `outputDir`, which defaults to `test-results/`. The workflow uploads `playwright-report/` on failure, which does not exist, so the step logs "No files were found" and the only diagnostic a failed e2e run leaves is the `list` reporter's console output. The traces that would show *why* a signed-in assertion failed against production are discarded.

**Fix:** either produce the HTML report or upload the traces, ideally both:

```ts
reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
```

```yaml
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-artifacts, path: |
                 playwright-report/
                 test-results/
               retention-days: 7 }
```

### WR-06: `pnpm db:check --bootstrap` cannot pass against any migrated database

**Severity:** WARNING
**File:** `scripts/check-test-db.ts:108-122`
**Issue:** Step 7 asserts `drizzle.__drizzle_migrations` holds exactly one row and that `rows[0].created_at` equals the `0000_bootstrap` journal `when`. The journal now has nine entries, so on every correctly migrated database the script throws `expected exactly 1 drizzle.__drizzle_migrations row, got 9`. Even with the count relaxed, the query has no `ORDER BY`, so `rows[0]` is whichever row the heap returns first. The script's `--bootstrap` mode, documented as "proof that migration 0000 took", now proves the opposite on a healthy database, and `docs/local-postgres.md`/`docs/deploy.md` still point new setups at it.

**Fix:**

```ts
const applied = await c.query<{ n: number }>(
  'select count(*)::int as n from drizzle.__drizzle_migrations where created_at = $1',
  [String(bootstrapEntry.when)],
);
if (applied.rows[0]?.n !== 1) throw new Error('check-test-db: 0000_bootstrap is not recorded exactly once');
const total = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
if (total.rows[0]?.n !== journal.entries.length) {
  throw new Error(`check-test-db: ${total.rows[0]?.n} migrations applied, journal has ${journal.entries.length}`);
}
```

### WR-07: Six retention constraints and one index exist only in hand-written SQL; the Drizzle schema and snapshot know nothing of them

**Severity:** WARNING
**File:** `drizzle/0006_retention_constraints.sql:5-7,9-40`, `src/db/schema/businesses.ts:23-33`, `src/db/schema/source-records.ts:32-41`, `drizzle/meta/0008_snapshot.json` (0 matches for any of the six names)
**Issue:** 0006's header says these are "table-level constraints drizzle-kit's differ does not emit". That is not the case for drizzle-orm 0.45.2: `foreignKey({ columns, foreignColumns, name })` supports composite keys, `unique(name).on(...)` supports composite uniques, `check()` is already used in `source-records.ts`, and `index(name).on(col).where(sql)` emits partial indexes (all verified in the installed `pg-core` typings). The consequence of declaring them only in SQL is that `src/db/schema/*` is no longer the whole truth D-09 promises: the snapshot does not carry `sr_durable_uniq`, the three composite FKs, `sr_ephemeral_has_expiry`, `sr_google_is_ephemeral`, or `sr_expiry`. `drizzle-kit check`/`push` will report drift, `$inferSelect` and relation typing cannot see the FKs, and any future generated migration that rebuilds either table (a type change on `id`, a table rename) will drop them without a diff line anyone reviews. The retention suite would catch the loss, but only after the migration is written and applied.

**Fix:** declare them in the schema and regenerate, expecting an empty (or constraint-name-only) migration:

```ts
// source-records.ts extras
unique('sr_durable_uniq').on(t.id, t.retentionClass),
check('sr_ephemeral_has_expiry', sql`(retention_class = 'ephemeral') = (expires_at is not null)`),
check('sr_google_is_ephemeral', sql`source_key <> 'google_places' or retention_class = 'ephemeral'`),
index('sr_expiry').on(t.expiresAt).where(sql`expires_at is not null`),
// businesses.ts extras (import sourceRecords lazily via a function to avoid the cycle, or move the FKs to source-records.ts side)
foreignKey({ name: 'businesses_phone_src_fk', columns: [t.phoneSourceId, t.phoneSrcRet],
             foreignColumns: [sourceRecords.id, sourceRecords.retentionClass] }),
```

`businesses` and `sourceRecords` already reference each other (`sourceRecords.businessId -> businesses.id`), so the composite FKs must be declared with a lazy `() => sourceRecords` reference or via `relations`; if that cycle proves unworkable, keep the SQL but add a `drizzle-kit check` step to CI and a comment that accurately states *why* the schema omits them.

## Info

### IN-01: `useRouter` is dead in the activation component

**Severity:** INFO
**File:** `src/components/activate-sole-organization.tsx:4,58,92`
**Issue:** `router` is declared, listed in the effect's dependency array, and never used; the comment on lines 78-83 explains the soft refresh is deliberately avoided. It survives lint only because the deps array counts as a use.
**Fix:** delete the import, the `const router = useRouter();` line, and `router` from the deps array.

### IN-02: `withOrg`'s allow-list admits `anon`, a role `app_user` cannot become

**Severity:** INFO
**File:** `src/db/with-org.ts:6`, `drizzle/0000_bootstrap.sql:33`, `drizzle/0008_revoke_platform_grants.sql:54-55`
**Issue:** `ROLES = new Set(['authenticated', 'anon'])`, but `app_user` is granted only `authenticated`, so `set local role anon` from the runtime connection is refused, and 0008 revokes every table privilege from `anon` with the comment "anon is never a Siteless caller". The type already forbids it; the runtime allow-list contradicts the migration.
**Fix:** `const ROLES = new Set(['authenticated'] as const);`

### IN-03: Provisioning writes the Clerk slug into both `name_internal` and `display_name`

**Severity:** INFO
**File:** `drizzle/0004_ensure_org.sql:16-17`, `src/app/page.tsx:16`
**Issue:** `ensure_org` receives `orgSlug ?? orgId` and stores it in both columns, so the "two columns, never interchangeable" rule (`orgs.ts:14-15`) holds structurally but the values are identical and neither is the organisation's actual name. `auth()` does not expose the org name; `clerkClient().organizations.getOrganization({ organizationId })` does.
**Fix:** on first provision only (after CR-01's fix makes that path distinct), fetch the org name server-side and pass it as `display_name`, leaving `name_internal` as the slug.

### IN-04: `.env.example` and `docs/deploy.md` name variables nothing reads

**Severity:** INFO
**File:** `.env.example:8-9,12-14`, `docs/deploy.md:134-135,142`
**Issue:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CLERK_FRONTEND_API_URL` and `CLERK_JWKS_URL` appear in no source file (grep over the tree excluding `.planning/`); `supabase-js` is not a dependency. `docs/deploy.md` §6 nonetheless instructs setting two of them on Vercel, and its `vercel env add` example uses one. A reader following the runbook provisions credentials the app cannot consume.
**Fix:** remove the five from `.env.example` or move them under a "reserved for later phases, unused today" header, and trim §6 to the four the app reads.

### IN-05: Unused dependencies and a deprecated zod API

**Severity:** INFO
**File:** `package.json:29-30`, `src/env.ts:20`
**Issue:** `date-fns` and `@date-fns/tz` are not imported anywhere under `src/` (`lib/time.ts` uses `Intl` only). zod 4.6.5 marks `z.string().url()` as `@deprecated Use z.url() instead`.
**Fix:** drop the two packages until a formatter needs them; change line 20 to `SUPABASE_DB_POOL_URL: z.url()`.

### IN-06: `--target=prod` accepts the direct `db.<ref>.supabase.co` address the docs say it refuses

**Severity:** INFO
**File:** `scripts/db.ts:36-49`, `docs/deploy.md:75-79`
**Issue:** `looksLikeSupabase` matches `supabase\.(co|com)`, and the port check is `url.includes(':5432')`, so `postgres://postgres:x@db.jahgeqshuesndyscnmjo.supabase.co:5432/postgres` passes both guards. `docs/deploy.md` states the script "refuses anything that is not a Supabase session-pooler URL on 5432" and separately "Never the direct `db.<ref>.supabase.co` address".
**Fix:** `if (target === 'prod' && !/pooler\.supabase\.com:5432\//.test(url)) throw new Error('--target=prod must use the session pooler host on 5432');`

### IN-07: `auth()` is awaited twice per render of `/`

**Severity:** INFO
**File:** `src/app/page.tsx:14-15`, `src/lib/auth/require-org.ts:23-26`
**Issue:** `Home` calls `requireOrg()` and then `orgClaims()`, which calls `requireOrg()` again. Harmless today; it doubles the Clerk verification and is the kind of pair that drifts when one call gains an argument.
**Fix:** `export function orgClaims(ctx: Awaited<ReturnType<typeof requireOrg>>): OrgClaims` and pass the first result.

### IN-08: Dead allow-list entry in the schema audit

**Severity:** INFO
**File:** `tests/db/schema-audit.test.ts:18`
**Issue:** `ALLOW_NO_ORG_ID` includes `__drizzle_migrations`, but that table lives in schema `drizzle` (see `check-test-db.ts:109`), and the audit query is scoped to `n.nspname = 'public'`, so the entry can never match. If the table ever were in `public` the test would still fail on `rls_enabled`/`policy_count`.
**Fix:** `const ALLOW_NO_ORG_ID = new Set(['orgs']);`

### IN-09: ESLint has no React Hooks rules

**Severity:** INFO
**File:** `eslint.config.mjs:14-20`
**Issue:** Only `typescript-eslint` recommended is enabled. `react-hooks/exhaustive-deps` and `rules-of-hooks` are absent, which is why IN-01's dead dependency and any future stale-closure effect in client components go unflagged. Next 16 removed `next lint`, so nothing else supplies them.
**Fix:** add `eslint-plugin-react-hooks` (flat config `reactHooks.configs['recommended-latest']`) and, optionally, `@next/eslint-plugin-next`.

### IN-10: A type-only assertion is exported as a runtime value into the Drizzle schema object

**Severity:** INFO
**File:** `src/db/schema/businesses.ts:42-44`, `src/db/schema/index.ts:5`
**Issue:** `export const businessLikeBridge: BusinessLikeIsSubset = true;` is re-exported by the barrel and handed to `drizzle({ client, schema })`, which iterates the object looking for tables and relations. Drizzle ignores the boolean, but the schema namespace now carries a non-table export for the sake of a compile-time check.
**Fix:** keep the check without the export:

```ts
type BusinessLikeIsSubset = BusinessLike extends Pick<typeof businesses.$inferSelect, keyof BusinessLike> ? true : never;
const _bridge: BusinessLikeIsSubset = true; void _bridge;
```

or use `true satisfies BusinessLikeIsSubset;` inside a `tests/unit` type test.

### IN-11: `pnpm db:generate` demands a database URL it never uses

**Severity:** INFO
**File:** `scripts/db.ts:30-32`
**Issue:** The URL guard runs for every command, including `generate` and `custom`, which diff schema against snapshot and never connect. A machine without `TEST_DATABASE_URL` cannot generate a migration.
**Fix:** move the `if (!url) throw` and the host/port checks under `if (command === 'migrate')`, and pass an empty `DRIZZLE_DB_URL` for the other two.

---

_Reviewed: 2026-09-22T08:26:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
