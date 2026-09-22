# Phase 2: Budget Governor & Search Presets - Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** ~78 (7 schema modules · ~8 migrations · 6 seed/loader · 10 lib · 5 server actions · 11 app-route/shell · ~30 shadcn `components/ui/*` as one bucket · ~15 tests · 4 config/root edits)
**Analogs found:** 62 / 78 strong or partial matches inside this repo. 16 have **no in-repo analog** (the design system's first files, the Census fetch client, the multi-statement meter function, the msw/jsdom test harness) — each is called out below with the nearest *conventions* to follow instead of a copyable shape.

This phase is Phase 1 doubled: every schema/migration/test pattern below is a **direct extension** of a shipped, applied, tested Phase 1 shape — read `.planning/CONVENTIONS.md` first, it is the compiled version of everything cited here. The frontend has **zero prior art in this repo** (Phase 1 shipped an intentionally unstyled shell) — those rows point at UI-SPEC and RESEARCH.md's own verified code blocks instead of a codebase file.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/clusters.ts` (`industry_clusters`, `industry_terms`) | model (reference) | CRUD (read-mostly, org_id NULL) | `src/db/schema/source-records.ts` | role-match (org-scoped shape; NULL-org variant is new) |
| `src/db/schema/geography.ts` (`counties`, `cities`, `geo_presets`) | model (reference) | CRUD (read-mostly, org_id NULL) | `src/db/schema/source-records.ts` | role-match |
| `src/db/schema/outlet-counts.ts` (`outlet_counts`) | model (reference) | CRUD (read-mostly, org_id NULL) | `src/db/schema/source-records.ts` | role-match |
| `src/db/schema/searches.ts` (`searches`, `search_versions`) | model (tenant, versioned) | CRUD + append-only | `src/db/schema/events.ts` (immutable-by-grant shape) + `src/db/schema/businesses.ts` (orgScoped shape) | exact (compose both) |
| `src/db/schema/budget.ts` (`budget_periods`, `cost_reservations`, `cost_ledger`) | model (tenant, ledger) | CRUD + high-volume append-only | `src/db/schema/events.ts` (no-row-trigger ledger) | role-match |
| `src/db/schema/runs.ts` (`runs`) | model (tenant) | CRUD | `src/db/schema/businesses.ts` | exact |
| `src/db/schema/index.ts` (EDIT) | barrel | — | itself | exact |
| `drizzle/00XX_<schema>.sql` (drizzle-kit generated: all 6 new tables, FKs, indexes, `unique().nullsNotDistinct()`) | migration | DDL | `drizzle/0001_tenancy.sql` | exact |
| `drizzle/00XX_reference_policies.sql` (custom: `org_id IS NULL` read policy, explicit grants for `clusters`/`geography`/`outlet-counts`) | migration | DDL (RLS) | `drizzle/0003_policies.sql` (policy shape) + `drizzle/0008` (explicit-grant convention) | role-match (the NULL-org predicate itself is new — RESEARCH Pattern 5 is the spec) |
| `drizzle/00XX_current_org_role.sql` (custom: `app.current_org_role()`) | migration | function | `drizzle/0002_tenancy_functions.sql` (`app.current_org_id()`) | exact shape |
| `drizzle/00XX_set_budget_cap.sql` (custom: `app.set_budget_cap()`, admin re-check) | migration | function | `drizzle/0004_ensure_org.sql` (claim-check-then-write definer) | exact shape |
| `drizzle/00XX_reserve_budget.sql` (custom: `app.reserve_budget()`, self-heal, thresholds) | migration | function (meter) | `drizzle/0009_ensure_org_no_write.sql` (select-then-do-nothing definer shape) | role-match (the conditional-`UPDATE`-as-sole-statement body is new — RESEARCH § Code Examples is the spec, already PG17-safe) |
| `drizzle/00XX_settle_reservation.sql` (custom: `app.settle_reservation()`, idempotent by `request_id`) | migration | function | `drizzle/0011_events_no_caller_insert.sql` (`app.emit_event`, definer, no caller-supplied org/actor) | exact shape |
| `drizzle/00XX_versioned_presets_immutable.sql` (custom: grants only, no policy, on `search_versions`) | migration | DDL (grants) | `drizzle/0007_event_triggers.sql` (last statement: `grant select, insert` / `revoke update, delete`) | exact shape |
| `drizzle/00XX_event_triggers_ext.sql` (custom: attach `log_event`/`touch_updated_at` to `searches`, `search_versions`, `budget_periods`; explicit `cost_ledger`/`cost_reservations` exclusion) | migration | DDL (triggers) | `drizzle/0007_event_triggers.sql` (the `do $$ … foreach t in array …$$` block) | exact shape |
| `src/seed/data/clusters.json`, `cities.json`, `counties.json`, `outlet-counts.json` | config (seed data) | batch | *(no analog — first committed data files in the repo)* | none |
| `scripts/seed.ts` | utility (loader) | batch, idempotent upsert | `scripts/db.ts` (target-gate pattern) | role-match |
| `scripts/refresh-outlet-counts.ts` | utility (ETL refresh) | batch | `scripts/db.ts` (target-gate + spawnSync-to-Node shape) | role-match |
| `src/lib/budget/price-book.ts` | utility (pure) | transform | `src/lib/time.ts` (single-source-of-truth module, no I/O) | role-match |
| `src/lib/budget/field-mask-tier.ts` | utility (pure, refuses unknown input) | transform | `src/lib/auth/require-org.ts` (deny-by-default shape) + RESEARCH's own verified code block | role-match |
| `src/lib/budget/period.ts` | utility (pure, TZ) | transform | `src/lib/time.ts` | exact |
| `src/lib/budget/money.ts` | utility (pure, `Intl`) | transform | `src/lib/time.ts` (`formatLocal`) | exact |
| `src/lib/estimate/expand-cells.ts` | utility (pure) | transform | `src/lib/time.ts` (module shape only) | partial |
| `src/lib/estimate/assumptions.ts` | config (constants) | — | `src/lib/time.ts` (`APP_TZ`/`APP_LOCALE` — named, exported, single source) | role-match |
| `src/lib/estimate/estimate.ts` | utility (pure, composes the above + DB read) | transform | `src/lib/auth/require-org.ts` (`ensureOrgRow` composing a DB call) | partial |
| `src/lib/geocode/census.ts` | service (external fetch client) | request-response (external HTTP) | `src/env.ts` (`server-only` + zod-parsed-once pattern) | partial — **no fetch-client analog exists in this repo; this is the first one** |
| `src/lib/ui/run-tone.ts` | utility (server-safe tone/label map) | transform | `src/lib/export/registry.ts` (server-safe, no `"use client"`, exported constant map) | role-match |
| `src/lib/ui/copy.ts` | config (copy constants) | — | `src/lib/export/registry.ts` | role-match |
| `src/server/actions/estimate-preset.ts` (`"use server"`) | controller (server action) | request-response, debounced | `src/lib/auth/require-org.ts` + `src/app/page.tsx` (requireOrg → withOrg → typed read) | exact shape |
| `src/server/actions/geocode-address.ts` (`"use server"`) | controller (server action, calls external service) | request-response | `src/lib/auth/require-org.ts` (`requireOrg()` first line) | role-match |
| `src/server/actions/save-preset-version.ts` (`"use server"`) | controller (server action) | CRUD + optimistic concurrency | `src/lib/auth/require-org.ts` `ensureOrgRow()` (withOrg + raw SQL + typed return) | exact shape |
| `src/server/actions/queue-run.ts` (`"use server"`) | controller (server action) | CRUD (reservation) | `src/lib/auth/require-org.ts` `ensureOrgRow()` | exact shape |
| `src/server/actions/set-budget-cap.ts` (`"use server"`) | controller (server action, admin-gated) | CRUD | `src/lib/auth/require-org.ts` `ensureOrgRow()` | exact shape |
| `src/app/(app)/layout.tsx` | component (RSC shell) | request-response | `src/app/layout.tsx` (root layout: `requireOrg`-adjacent, `"use client"` boundary rule) | role-match (first *styled* shell — no visual analog) |
| `src/app/(app)/presets/page.tsx` | component (RSC page) | request-response | `src/app/page.tsx` (`requireOrg()` first, `data-testid` on every assertable node) | role-match |
| `src/app/(app)/presets/new/page.tsx` | component (mixed RSC+client form) | request-response, debounced | `src/app/page.tsx` (server half) + `src/components/activate-sole-organization.tsx` (`"use client"` half) | role-match |
| `src/app/(app)/presets/[id]/page.tsx` | component (RSC page) | request-response | `src/app/page.tsx` | role-match |
| `src/app/(app)/presets/[id]/edit/page.tsx` | component (mixed) | request-response | same as `new/page.tsx` | role-match |
| `src/app/(app)/spend/page.tsx` | component (RSC page) | request-response (read model) | `src/app/page.tsx` | role-match |
| `src/app/(app)/settings/budget/page.tsx` | component (RSC page, admin-gated) | request-response | `src/app/page.tsx` + `src/app/no-access/page.tsx` (the non-admin branch) | role-match |
| `src/app/(app)/settings/organization/page.tsx` | component (RSC page) | request-response | `src/app/page.tsx` (**the exact 3 testids move here verbatim**) | exact |
| `src/app/layout.tsx` (EDIT: font, `ThemeProvider`, `Toaster`, `globals.css`) | component (root layout) | — | itself (current unstyled version) | exact |
| `src/app/globals.css` (NEW) | config (design tokens) | — | *(none — first stylesheet in the repo)* | none |
| `src/app/no-access/page.tsx` (RESTYLE) | component | request-response | itself (current unstyled version) | exact |
| `components.json`, `postcss.config.mjs` | config | — | *(none — shadcn/Tailwind init output)* | none |
| `src/components/ui/*.tsx` (~30 shadcn copy-ins) | component (primitives) | — | *(none — first UI components in the repo)* | none |
| `tests/db/budget-concurrency.test.ts` | test (DB, multi-connection) | event-driven (real commits) | RESEARCH.md § Code Examples "The concurrency proof" (verified, ready to paste) — **`tests/db/_fixtures.ts`'s `withRollback` explicitly cannot express this** | partial (harness must diverge) |
| `tests/db/budget-meter.test.ts` (thresholds, self-heal, CHECK, admin gate, role coalesce) | test (DB) | CRUD | `tests/db/rls-isolation.test.ts` (message-pinned refusal pattern) + `tests/db/event-trigger.test.ts` (trigger/mutation shape) | exact shape |
| `tests/db/reference-rows.test.ts` (built-in mutation zero-row, forged INSERT 42501, seed idempotency) | test (DB) | CRUD | `tests/db/rls-isolation.test.ts` (`rowCount` filtered-vs-refused pattern, message pinning) | exact shape |
| `tests/db/counties-fips.test.ts` (254-row identity) | test (DB, pure data) | batch | `tests/db/schema-audit.test.ts` (live-catalog read + `expect(...).toEqual([])`) | role-match |
| `tests/db/versioned-presets.test.ts` (new version, run keeps its version, immutable grant, save conflict `23505`) | test (DB) | CRUD | `tests/db/event-trigger.test.ts` (direct-write assertion shape) + `tests/db/grants-audit.test.ts` (message-pinned grant refusal) | exact shape |
| `tests/db/grants-audit.test.ts` (EXTEND `TENANT_TABLES`) | test (DB) | CRUD | itself | exact |
| `tests/db/event-trigger.test.ts` (EXTEND `EVENT_LOGGED`) | test (DB) | event-driven | itself | exact |
| `tests/unit/field-mask-tier.test.ts` | test (unit) | transform | RESEARCH.md § Code Examples `fieldMaskTier()` (verified code, ready to paste) | exact |
| `tests/unit/estimate.test.ts` (committed cost-model test, free allowance, Texas multiplier) | test (unit) | transform | `tests/unit/no-internal-leak.test.ts` (structural-fixture + registry-style assertion pattern) | partial |
| `tests/unit/outlet-counts.test.ts` (RGV totals match measured matrix) | test (unit) | transform | `tests/unit/no-internal-leak.test.ts` | partial |
| `tests/unit/census.test.ts` (msw: hit / empty `addressMatches` / 503) | test (unit, network-mocked) | request-response | *(none — first `msw` usage in the repo)* | none |
| `tests/unit/no-google-credential.test.ts` (grep `src/` for a Google credential) | test (unit, static) | — | `tests/db/schema-audit.test.ts` (catalog-enumeration-as-assertion style, nearest in spirit) | partial |
| `tests/unit/stale-estimate.test.tsx` (component, out-of-order debounce) | test (component) | event-driven | *(none — first `.test.tsx` / jsdom usage in the repo)* | none |
| `tests/e2e/signed-in.spec.ts` (MOVE → org-scoped spec, testids relocate to `/settings/organization`) | test (e2e) | request-response | itself | exact |
| `tests/e2e/presets.spec.ts`, `spend.spec.ts`, `budget-banner.spec.ts`, `theme-tokens.spec.ts`, `touch-targets.spec.ts` | test (e2e) | request-response | `tests/e2e/signed-in.spec.ts` (`data-testid`-only assertions, never copy) | role-match |
| `vitest.config.ts` (EDIT: jsdom/`@vitejs/plugin-react` for `.test.tsx`) | config | — | itself | exact |
| `package.json` (EDIT: new deps, per STACK.md pins) | config | — | itself | exact |

---

## Pattern Assignments

### Group 1 — Reference-data schema modules: `clusters.ts`, `geography.ts`, `outlet-counts.ts`

**Analog:** `src/db/schema/source-records.ts` (whole file, 41 lines) for the orgScoped/policy/index shape, composed with **RESEARCH.md § Pattern 5** for the NULL-org variant these three tables actually need (no exact in-repo analog — plain `orgPolicies()` assumes `org_id` is always non-null).

**What to copy verbatim — the module shape** (`src/db/schema/source-records.ts:1-4, 19-41`):
```typescript
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { orgPolicies, orgScoped, tstz } from './_helpers';

export const sourceRecords = pgTable(
  'source_records',
  {
    ...orgScoped,
    sourceKey: text('source_key').notNull(),
    // ...
  },
  (t) => [
    index('source_records_org_idx').on(t.orgId),
    check('sr_source_key_known', sql`source_key in (...)`),
    ...orgPolicies('source_records'),
  ],
);
```

**What must change — `orgScoped` assumes `org_id NOT NULL`; the reference tables need `org_id` nullable and a different policy set.** Do not spread `orgScoped` as-is; either add an `orgScopedNullable` variant to `_helpers.ts` or declare the four columns inline (`id`, nullable `orgId`, `createdAt`/`updatedAt`/`updatedBy`) and write the four policies by hand per **RESEARCH.md § Pattern 5**:
```sql
-- Source: RESEARCH.md § Pattern 5, verified locally on PostgreSQL 18.6, 2026-09-22.
create policy ic_select on industry_clusters for select to authenticated
  using (org_id is null or org_id = (select app.current_org_id()));
create policy ic_insert on industry_clusters for insert to authenticated
  with check (org_id is not null and org_id = (select app.current_org_id()));
create policy ic_update on industry_clusters for update to authenticated
  using  (org_id is not null and org_id = (select app.current_org_id()))
  with check (org_id is not null and org_id = (select app.current_org_id()));
create policy ic_delete on industry_clusters for delete to authenticated
  using (org_id is not null and org_id = (select app.current_org_id()));
```
🔴 **Do not add a `BEFORE UPDATE/DELETE` trigger to make built-in mutation loud** — RESEARCH verified it does not fire (RLS filters the row before the row trigger runs) and it breaks the owner's own seed-update path. The correct test shape is `rowCount === 0` for UPDATE/DELETE and `42501` only for a forged INSERT (see Group 8 below).

**Uniqueness — `UNIQUE NULLS NOT DISTINCT`, not plain `UNIQUE`.** `NULL != NULL` in standard SQL, so a plain `unique(org_id, key)` lets a second `(null, 'home_services')` insert cleanly. Verified working syntax (`drizzle-orm@0.45.2`):
```typescript
unique('industry_clusters_org_key_uniq').on(t.orgId, t.key).nullsNotDistinct()
```

**Grant convention (CONVENTIONS § Grants):** these tables get the same explicit grant as every table since migration 0008 — `grant select, insert, update, delete on <table> to authenticated`. There is **no default ACL to rely on**; write it in the same migration that creates the table, exactly as `businesses`/`source_records` did.

---

### Group 2 — Tenant-scoped, non-versioned models: `runs.ts`

**Analog:** `src/db/schema/businesses.ts` (whole file, 45 lines) — a plain `orgScoped` table with a `status` text column and an index. This is the closest exact match in the repo: same `...orgScoped` spread, same `orgPolicies(t)` call, same `index('<t>_org_idx')`.
```typescript
// src/db/schema/businesses.ts:8-17, 33
export const businesses = pgTable(
  'businesses',
  {
    ...orgScoped,
    // ...
    status: text('status').notNull().default('active'),
  },
  (t) => [index('businesses_org_idx').on(t.orgId), ...orgPolicies('businesses')],
);
```
`runs` needs a foreign key to `search_versions` (`onDelete: 'no action'` — SRCH-03's "a run keeps pointing at the version that produced it" is a referential-integrity property) and a `status` CHECK (`queued|running|complete|partial|refused|failed`, per the spend-view badge tones in UI-SPEC § Status badge tones). Use `drizzle/0006_retention_constraints.sql`'s hand-written-constraint shape (`alter table … add constraint …`) as the migration analog for that CHECK — see Group 5.

---

### Group 3 — Versioned tenant model: `searches.ts` (`searches` + `search_versions`)

**Analog (compose two):** `src/db/schema/businesses.ts` for `searches` (a normal orgScoped row with a `currentVersionId` FK), and `src/db/schema/events.ts` for `search_versions` (immutable-by-grant, append-only).

**`events.ts`'s immutable shape to copy for `search_versions`** (`src/db/schema/events.ts:29-47`):
```typescript
// Select and insert only, declared inline rather than via orgPolicies(): events has no
// legitimate UPDATE or DELETE path (D-06).
(t) => [
  index('events_org_occurred_idx').on(t.orgId, t.occurredAt),
  pgPolicy('events_select', { for: 'select', to: authenticatedRole, using: sql`org_id = (select app.current_org_id())` }),
  pgPolicy('events_insert', { for: 'insert', to: authenticatedRole, withCheck: sql`org_id = (select app.current_org_id())` }),
],
```
`search_versions` needs the same select+insert-only policy pair, **plus** the grant-level revoke that makes it actually immutable (RESEARCH § Pattern 6): `grant select, insert on search_versions to authenticated; revoke update, delete on search_versions from authenticated;` — copy this from `drizzle/0007_event_triggers.sql:71-73` verbatim (see Group 5).

**The circular FK** (`searches.current_version_id → search_versions.id` and `search_versions.search_id → searches.id`): make `current_version_id` nullable and set it in a second statement inside the same transaction (RESEARCH § Pattern 6) — there is no in-repo precedent for a circular FK; this is new territory, handle it in the server action (`save-preset-version.ts`), not in the schema/migration.

**Optimistic concurrency (save conflict, UI-SPEC's exact copy is already written):** `unique (search_id, version)` and let a concurrent save raise `23505` — no in-repo analog for this exact technique, but it is a direct sibling of `orgs.clerk_org_id`'s `unique()` constraint (`src/db/schema/orgs.ts:13`) used the same way (a DB-enforced invariant instead of an app-tier check-then-write).

---

### Group 4 — Ledger model: `budget.ts` (`budget_periods`, `cost_reservations`, `cost_ledger`)

**Analog:** `src/db/schema/events.ts` for the **"no row trigger, high-volume, append-only"** shape `cost_ledger`/`cost_reservations` need (CONVENTIONS' T-1-32 exclusion, same reasoning as `source_records`). `budget_periods` itself is a normal mutable orgScoped row (closer to `businesses.ts`) since its `cap_micro_usd`/`reserved_micro_usd`/`spent_micro_usd` are updated in place by the meter function, not versioned.

**The `CHECK` constraint pattern to copy** — `drizzle/0006_retention_constraints.sql:9-17` (hand-written, table-level, exactly the `spent+reserved<=cap` shape this table needs):
```sql
alter table source_records add constraint sr_ephemeral_has_expiry
  check ((retention_class = 'ephemeral') = (expires_at is not null));
--> statement-breakpoint
alter table source_records add constraint sr_google_is_ephemeral
  check (source_key <> 'google_places' or retention_class = 'ephemeral');
```
For `budget_periods`: `alter table budget_periods add constraint bp_not_over check (spent_micro_usd + reserved_micro_usd <= cap_micro_usd);` — 🔴 **every literal touching this arithmetic needs `bigint` or an explicit `::bigint` cast** (RESEARCH Pitfall 2: `(50*1000000)*80/100` raises `22003 integer out of range` on `int4`).

**The partial index pattern** — `drizzle/0006_retention_constraints.sql:40` (`sr_expiry`) is the exact analog for `cost_reservations`' open-reservation index:
```sql
create index sr_expiry on source_records (expires_at) where expires_at is not null;
-- → create index cost_reservations_open on cost_reservations (budget_period_id, expires_at)
--     where settled_at is null and released_at is null;
```

**`cost_cents` generated column** — no in-repo analog (first generated column of this kind), but the technique is the same class as `businesses.ts`'s `legalNameSrcRet: text(...).generatedAlwaysAs(sql\`'durable'\`)` (`src/db/schema/businesses.ts:24`) — Drizzle's `.generatedAlwaysAs(sql\`...\`)` API is already proven working in this schema.

---

### Group 5 — Custom SQL migrations (functions, triggers, grants)

**Analog set:** `drizzle/0002_tenancy_functions.sql`, `drizzle/0004_ensure_org.sql`, `drizzle/0007_event_triggers.sql`, `drizzle/0009_ensure_org_no_write.sql`, `drizzle/0011_events_no_caller_insert.sql`. Every one of these is `pnpm db:custom` output (hand-written PL/pgSQL, `--> statement-breakpoint` between every statement).

**`app.current_org_role()`** — copy `drizzle/0002_tenancy_functions.sql:5-9`'s exact shape (a `stable security definer set search_path = public` SQL function coalescing two claim shapes):
```sql
create or replace function app.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.orgs
   where clerk_org_id = coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')
$$;
```
🔴 **The role trap (RESEARCH § Admin gate):** `app.jwt()->'o'->>'rol'` is bare (`'admin'`); `auth().orgRole` on the TypeScript side is prefixed (`'org:admin'`). Do not coalesce them with the same string — normalize to the bare form in SQL, as RESEARCH's own verified function does:
```sql
-- Source: RESEARCH.md § Admin gate, verified against @clerk/shared/dist/jwtPayloadParser.mjs.
create or replace function app.current_org_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(app.jwt()->'o'->>'rol',
                  nullif(replace(coalesce(app.jwt()->>'org_role',''), 'org:', ''), ''))
$$;
```

**`app.set_budget_cap()`** — copy `drizzle/0004_ensure_org.sql`'s claim-check-then-write shape (whole file, 21 lines):
```sql
create or replace function app.ensure_org(p_clerk_org_id text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_claim text;
begin
  v_claim := coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id');
  if p_clerk_org_id is distinct from v_claim then
    raise exception 'ensure_org: org does not match the caller claim' using errcode = '42501';
  end if;
  -- ... insert/select ...
end $$;
--> statement-breakpoint
grant execute on function app.ensure_org(text, text) to authenticated;
```
For `set_budget_cap`: replace the claim check with `if app.current_org_role() <> 'admin' then raise exception ... using errcode = '42501'; end if;` and give `authenticated` **no UPDATE grant on `budget_periods.cap_micro_usd`** at all — the function is the only write path (same pattern as `orgs`'s column-grant story in Group 9, but here it's "no grant at all" rather than "narrow column grant").

**`app.reserve_budget()`** — the self-healing get-or-create shape is the same *family* as `drizzle/0009_ensure_org_no_write.sql` (select-then-do-nothing idempotency, whole file, 53 lines — re-read for the `on conflict … do nothing` / fallback-select pattern), but the actual meter body (conditional `UPDATE` as the sole concurrency-control statement, self-heal via `for update … skip locked`, thresholds via `RETURNING`) is **new to this repo** — RESEARCH.md § Code Examples "The meter, end to end" is the verified, PG17-safe, ready-to-paste source (lines 837-892 of `02-RESEARCH.md`). Follow its exact structure; do not re-derive.

**`app.settle_reservation()`** — copy `drizzle/0011_events_no_caller_insert.sql`'s `app.emit_event()` shape (whole file, 61 lines): `security definer`, `set search_path = public`, resolves org/actor from claims itself (never a parameter), `grant execute … to authenticated`, and the file's own closing `revoke insert on public.events from authenticated` is the exact sibling of what a settlement migration does for `cost_ledger` (insert only via the definer, `ON CONFLICT (request_id) DO NOTHING` for idempotency — RESEARCH § Pattern 4).

**Trigger attachment (`log_event`/`touch_updated_at` on `searches`/`search_versions`/`budget_periods`)** — copy `drizzle/0007_event_triggers.sql:52-64`'s `do $$ … foreach t in array array[...] loop … end $$` block verbatim, just with a different array:
```sql
do $$ declare t text;
begin
  foreach t in array array['searches','search_versions','budget_periods'] loop
    execute format('create trigger %I_event after insert or update or delete on %I
       for each row execute function app.log_event()', t, t);
  end loop;
  -- touch_updated_at on the mutable ones only (search_versions is append-only, no UPDATE)
  foreach t in array array['searches','budget_periods'] loop
    execute format('create trigger %I_touch before update on %I
       for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
```
🔴 **`cost_ledger` and `cost_reservations` get NO `log_event` trigger** (CONVENTIONS' T-1-32 exclusion, same reasoning `source_records` already carries) — do not add them to this array.

**Immutability by grant (`search_versions`)** — copy `drizzle/0007_event_triggers.sql:67-73` verbatim, table name swapped:
```sql
grant select, insert on events to authenticated;
--> statement-breakpoint
revoke update, delete on events from authenticated;
-- → grant select, insert on search_versions to authenticated;
-- → revoke update, delete on search_versions from authenticated;
```

---

### Group 6 — Seed loader: `scripts/seed.ts`, `scripts/refresh-outlet-counts.ts`

**Analog:** `scripts/db.ts` (whole file, 81 lines) — the target-gate pattern (`--target=test` refuses a Supabase host; the URL selection; `spawnSync(process.execPath, …)` rather than a bare `pnpm` child process because of the broken local pnpm shim). `seed.ts` should follow the **same gate**, not re-derive it:
```typescript
// scripts/db.ts:26-44 — the shape to copy for seed.ts's own target gate
if (target !== 'test' && target !== 'prod') { throw new Error(...); }
const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
if (target === 'test' && looksLikeSupabase) { throw new Error('... D-04.'); }
```
Seed rows are written **as the migration owner** (bypasses RLS; `authenticated` cannot write `org_id IS NULL` rows at all, by design — RESEARCH § Seed loader). No in-repo analog for the `insert … on conflict (org_id, key) do update` idempotent-upsert body itself; it is new, but the `on conflict … do nothing` / `do update` technique is already proven in `drizzle/0004_ensure_org.sql:16-18` and `0009`'s replacement of it.

---

### Group 7 — Pure lib modules: `price-book.ts`, `field-mask-tier.ts`, `period.ts`, `money.ts`, `assumptions.ts`

**Analog:** `src/lib/time.ts` (whole file, 63 lines) — the "one file names the thing, everyone else imports it" pattern. Copy its shape exactly for `period.ts` and `money.ts`:
```typescript
// src/lib/time.ts:20-28 — the single-export-constant pattern
export const APP_TZ = 'America/Chicago';
export const APP_LOCALE = 'en-US';
// src/lib/time.ts:60-62 — money/date formatting goes through ONE function
export function formatLocal(instant: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { ...options, timeZone: APP_TZ }).format(instant);
}
```
CONVENTIONS is explicit: `grep -rn "America/Chicago" src/` must only ever name `src/lib/time.ts` — so `budget/period.ts` **imports** `APP_TZ` from `src/lib/time.ts` rather than re-declaring the zone string, and `budget/money.ts` uses `Intl.NumberFormat('en-US', {...})` importing `APP_LOCALE` the same way, never a second literal `'en-US'`.

**`fieldMaskTier()`** — RESEARCH.md § Code Examples has the full, verified, ready-to-paste implementation (lines 916-944 of `02-RESEARCH.md`) — refuses an unknown field rather than defaulting, exactly the deny-by-default posture `src/lib/auth/require-org.ts`'s `requireOrg()` already establishes as house style:
```typescript
// src/lib/auth/require-org.ts:16-20 — deny-by-default is the house shape to match
export async function requireOrg() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/no-access?reason=none');
  return { userId, orgId, orgSlug: orgSlug ?? null };
}
```

---

### Group 8 — External fetch client: `src/lib/geocode/census.ts`

**No fetch-client analog exists anywhere in `src/`.** The closest pattern is `src/env.ts`'s "parse once, validate with zod, throw loudly rather than default" posture (whole file, 52 lines):
```typescript
// src/env.ts:18-21, 43-50
const serverSchema = z.object({ CLERK_SECRET_KEY: z.string().min(1), SUPABASE_DB_POOL_URL: z.string().url() });
const parsed = serverSchema.safeParse({ ... });
if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(`src/env.ts: missing or invalid server environment variable(s): ${missing}. ...`);
}
```
`census.ts` applies the same "validate the untrusted shape, fail loud, never silently coerce" instinct to a per-**call** zod parse instead of a module-load parse — RESEARCH.md § The Census Geocoder (D-02) has the exact verified zod schema and the guard list (`STATE === '48'`, `addressMatches.length === 0` is a documented non-error). Mark the module `import 'server-only'` exactly as `src/env.ts` and `src/db/with-org.ts` both do (`src/db/with-org.ts:1`). This is the only external HTTP call in Phase 2 — no msw precedent exists in the repo either (Group "No Analog Found").

---

### Group 9 — Server actions (all five)

**Analog:** `src/lib/auth/require-org.ts`'s `ensureOrgRow()` (whole function, `src/lib/auth/require-org.ts:40-47`) is the exact shape every `"use server"` action in this phase should follow — `requireOrg()`/`orgClaims()` first, then `withOrg(claims, async (tx) => {...})`, then a typed return:
```typescript
export async function ensureOrgRow(claims: OrgClaims, displayName: string): Promise<string> {
  return withOrg(claims, async (tx) => {
    const res = await tx.execute(sql`select app.ensure_org(${claims.o.id}, ${displayName}) as id`);
    const row = (res as unknown as Array<{ id: string }>)[0];
    if (!row?.id) throw new Error('ensureOrgRow: app.ensure_org returned no id');
    return row.id;
  });
}
```
`src/db/with-org.ts` (`withOrg()`, whole file, 37 lines) is **the** underlying runtime entry point every one of these must go through — bound parameters only, `set_config(..., true)` (transaction-LOCAL), `set local role`. RESEARCH.md § The live debounced estimate (D-08) already has the client-side half of `estimate-preset.ts`'s caller (the `useTransition` + monotonic `seq` guard) fully worked out with citations — copy that block directly; it names the exact BIS regression (`<form action>` resetting on failure) that makes `onSubmit` + `useTransition` mandatory instead.

🔴 **`requireOrg()` is the first line of every action, no exception** — `src/proxy.ts` carries no authorization by design (CVE-2025-29927), so a server action reached directly (not through a rendered page) is a real, unauthenticated entry point until the action itself checks.

---

### Group 10 — App shell & routes (`(app)/layout.tsx` and every page under it)

**No visual/styled analog exists** — Phase 1's `src/app/layout.tsx` is deliberately unstyled (its own comment says so). The **structural** pattern to copy is `src/app/page.tsx` (whole file, 25 lines): `requireOrg()` first, `orgClaims()`, then render `data-testid`-bearing nodes with **no dependence on copy**:
```typescript
// src/app/page.tsx:13-24
export default async function Home() {
  const { userId, orgId, orgSlug } = await requireOrg();
  const claims = await orgClaims();
  const orgRowId = await ensureOrgRow(claims, orgSlug ?? orgId);
  return (
    <main>
      <p data-testid="signed-in-as">Signed in as {userId}</p>
      <p data-testid="org-id">Org {orgId}</p>
      <p data-testid="org-row-id">Tenant {orgRowId}</p>
    </main>
  );
}
```
🔴 **These exact three testids move to `src/app/(app)/settings/organization/page.tsx`, verbatim, in the same task that moves `tests/e2e/signed-in.spec.ts`** (UI-SPEC § Executor Rule 7; RESEARCH § Route-group and e2e move). A retired testid fails silently — grep `tests/e2e/` for every one being moved before calling the task done.

**The `"use client"` boundary rule** — `src/app/layout.tsx`'s own comment and `src/components/activate-sole-organization.tsx` (whole file, 95 lines) are the two places this repo already learned the lesson UI-SPEC's Executor Rule 5 restates: a `"use client"` module's **exports** are client references inside a server component, even plain data objects, and resolve to `undefined` at runtime with typecheck/lint/build all green. `run-tone.ts` and `copy.ts` (Group 7 above) must **not** carry `"use client"` for exactly this reason — they are imported by RSC pages.
```typescript
// src/app/layout.tsx:9-12 — the comment IS the pattern
// The activation element below is imported as a COMPONENT across the client boundary,
// never as a data object: a "use client" module's exports become client REFERENCES inside
// a server component and resolve to undefined at runtime with typecheck, lint and build
// all green (two recorded BIS occurrences, each a 500).
```
The preset editor's client-side form (`presets/new/page.tsx`, `presets/[id]/edit/page.tsx`) is the first genuinely interactive client component in this repo — `activate-sole-organization.tsx`'s shape (`'use client'` at the top, `useEffect`/`useRef` for once-only side effects, a `.catch()` that leaves the UI as it was rather than blanking it) is the nearest structural precedent, even though its *purpose* (org activation) is unrelated.

---

### Group 11 — DB tests (thresholds, self-heal, reference rows, versioning)

**Analog set:** `tests/db/_fixtures.ts` (whole file — `withRollback`, `actAs`, `actAsRole`, `seedTwoOrgs`) is the harness every new DB test imports, **except** `budget-concurrency.test.ts`, which RESEARCH is explicit cannot use `withRollback` (one transaction cannot express two workers seeing each other's commits) — its own § Code Examples block (`02-RESEARCH.md:894-914`) is the verified replacement shape, opening raw `pg.Client` connections and cleaning up in `finally`.

**Message-pinned refusal pattern to copy** — `tests/db/rls-isolation.test.ts:110-121` (the `clerk_org_id` re-key refusal):
```typescript
const attempt = c.query("update orgs set clerk_org_id = 'org_X' where id = $1", [a]);
await expect(attempt).rejects.toMatchObject({ code: '42501' });
await expect(attempt).rejects.toThrow(/permission denied for table orgs/);
```
Use this exact two-assertion shape (SQLSTATE **and** message) for `search_versions`' immutability refusal (RESEARCH: pin `42501 permission denied for table search_versions`, distinct from an RLS refusal's `new row violates row-level security policy` wording) and for `set_budget_cap`'s non-admin refusal.

**Zero-row (not refused) pattern to copy** — `tests/db/rls-isolation.test.ts:79-92`:
```typescript
const updated = await c.query('update businesses set display_name = $2 where org_id = $1', [b, 'x']);
expect(updated.rowCount).toBe(0);
```
Use this for the built-in-mutation test in `reference-rows.test.ts` (RESEARCH Pitfall 3: UPDATE/DELETE on an `org_id IS NULL` row is a silent zero-row filter, not a refusal — only the forged INSERT raises `42501`).

**Live-catalog enumeration pattern to copy** — `tests/db/schema-audit.test.ts:29-50` (query `pg_class`/`pg_policy` live, assert against the whole set, never a fixed count) — the shape for `counties-fips.test.ts`'s "all 254 rows satisfy `fips = 2*comptroller-1`" assertion.

**Set-literal-in-the-test-file convention** — both `tests/db/grants-audit.test.ts`'s `TENANT_TABLES` (line 34) and `tests/db/event-trigger.test.ts`'s `EVENT_LOGGED` (line 32) are plain arrays/Sets **declared in the test file itself, never a config file** — extend them exactly that way (add `'clusters'`, `'geography'`, `'outlet_counts'`, `'searches'`, `'search_versions'`, `'budget_periods'`, `'cost_reservations'`, `'cost_ledger'`, `'runs'` to `TENANT_TABLES`; add `'searches'`, `'search_versions'`, `'budget_periods'` only to `EVENT_LOGGED`), so widening them is a diff a reviewer sees.

**The direct-write acceptance-test shape to copy** — `tests/db/event-trigger.test.ts:77-116` ("a direct write still produces an event", raw SQL, no application code in the path) — apply verbatim to `budget_periods`'s cap-change audit test (D-10/FOUND-03 in the phase requirements table).

---

### Group 12 — Unit tests: `field-mask-tier.test.ts`, `estimate.test.ts`, `outlet-counts.test.ts`

**Analog:** `tests/unit/no-internal-leak.test.ts` (whole file, 96 lines) for its two-sided-proof discipline — never assert only absence, also assert the **right** value is present:
```typescript
// tests/unit/no-internal-leak.test.ts:65-74
const everything = payloads.map((p) => p.json).join('\n');
if (PAYLOAD_BUILDERS.length > 0) {
  expect(everything).toContain('Rio Roofing');   // proves the RIGHT thing went out, not just that nothing broke
}
```
Apply the same discipline to `estimate.test.ts`'s free-allowance test (assert **both** "$0.00 with 1,000 free remaining" and "$2.38 with 0 remaining" — a test that only proves "cost is not $2.40" would pass on a broken calculation too) and to the mutation check for `fieldMaskTier()` (RESEARCH: appending `places.reviews` must move **both** the tier and the ledger price — assert both, not just one).

**The committed cost-model test** (ROADMAP's "a committed test, not a spreadsheet", SRCH-04) has no exact in-repo analog — nearest structural precedent is `tests/db/schema-audit.test.ts`'s "read the real thing, assert an invariant over all of it" style, applied here to the real seeded cell list instead of `information_schema`.

---

### Group 13 — Component test harness: `stale-estimate.test.tsx`

**No analog — first `.test.tsx` / jsdom / `@testing-library/react` file in this repo.** `vitest.config.ts` currently globs `**/*.test.tsx` but declares neither `environment: 'jsdom'` nor `@vitejs/plugin-react` (verified: `vitest.config.ts` sets `environment: 'node'` unconditionally). RESEARCH flags this exactly (§ Validation Architecture, harness change 2): add a third config or an `environmentMatchGlobs`-style split, and **do not change the node-environment default for plain `tests/unit/**/*.test.ts`** — `tests/unit/suite-zone.test.ts` and `tests/unit/time.test.ts` depend on it staying `node`. The `TZ='UTC'` pin at line 1 of `vitest.config.ts` (before any import) must be preserved in whatever new config is added — it is what makes `tests/unit/suite-zone.test.ts`'s discriminating pair work.

---

### Group 14 — E2E tests

**Analog:** `tests/e2e/signed-in.spec.ts` (whole file, 16 lines) — assert on `data-testid` only, never on copy, because Phase 2 restyles every screen this spec (and its successors) touch:
```typescript
// tests/e2e/signed-in.spec.ts:10-15
test('signs in and is org-scoped', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('signed-in-as')).toContainText('user_');
  await expect(page.getByTestId('org-id')).toContainText('org_');
  await expect(page.getByTestId('org-row-id')).not.toBeEmpty();
});
```
This file's own comment (line 8) says it explicitly: *"Asserts on data-testid, never on copy — Phase 2 restyles every one of these screens."* Every new e2e spec in this phase (`presets.spec.ts`, `spend.spec.ts`, `budget-banner.spec.ts`, `theme-tokens.spec.ts`, `touch-targets.spec.ts`) follows the same rule and the same `data-testid="{screen}-{element}-{qualifier}"` convention UI-SPEC's Accessibility section already fixes.

---

## Shared Patterns

### Deny-by-default / fail-loud
**Source:** `src/lib/auth/require-org.ts` (`requireOrg()`, lines 16-21) + `src/env.ts` (module-load throw, lines 43-50)
**Apply to:** every server action (`requireOrg()` first line, no exception), `set-budget-cap.ts` (admin re-check both in the definer function and for UI affordance), `field-mask-tier.ts` (refuse an unknown field rather than default to Essentials).

### `withOrg()` as the sole runtime DB entry point
**Source:** `src/db/with-org.ts`, whole file
**Apply to:** every server action, every page component that reads tenant data. The one exception in the whole repo is `/api/health`'s bare `select 1` — nothing in Phase 2 needs a second exception.

### Explicit grants, no default ACL
**Source:** `.planning/CONVENTIONS.md` § Grants + `drizzle/0008_revoke_platform_grants.sql` (whole file)
**Apply to:** every new table's migration. A table created without its own explicit `grant select, insert, update, delete on <t> to authenticated` (scoped to what its policies actually need) fails loudly with `42501` on first use — this is the *intended* failure mode, not a bug to route around.

### Immutable-by-grant, not by policy
**Source:** `drizzle/0007_event_triggers.sql:67-73` (`events`) + `drizzle/0011_events_no_caller_insert.sql` (closing revoke)
**Apply to:** `search_versions` (grant select+insert, revoke update+delete — RESEARCH § Pattern 6).

### `SECURITY DEFINER` + `set search_path = public`, every time, same statement
**Source:** `drizzle/0002_tenancy_functions.sql`, `0004_ensure_org.sql`, `0007_event_triggers.sql` (`app.log_event`), `0011` (`app.emit_event`) — every definer function in this repo pins it inline, never on a separate statement.
**Apply to:** `app.current_org_role()`, `app.set_budget_cap()`, `app.reserve_budget()`, `app.settle_reservation()`. ASVS V4: an unpinned search_path on a definer function is attacker-controlled and runs as the owner.

### Message-pinned refusals (SQLSTATE **and** wording)
**Source:** `tests/db/rls-isolation.test.ts:116-121`, `tests/db/grants-audit.test.ts:100-101`
**Apply to:** every new refusal test — `42501` alone covers both an RLS refusal (`new row violates row-level security policy`) and a grant refusal (`permission denied for table <t>`); only the message tells them apart, and `search_versions`'/`budget_periods`' refusals in this phase are grant refusals, not RLS ones.

### One refused statement per rolled-back transaction
**Source:** `tests/db/_fixtures.ts` doc comment (lines 14-16) + demonstrated across every DB test file read
**Apply to:** every new DB test — a refusal aborts the transaction; the *next* statement reports `25P02`, not its own reason. Each refusal in Phase 2's new tests (built-in mutation, forged built-in insert, version immutability, save conflict, admin-only cap change) must rest on a *different* invariant so a single mutation reds exactly one test.

### Timezone: one file names the zone, zone AND locale pinned in tests
**Source:** `src/lib/time.ts` (whole file) + `vitest.config.ts` lines 1-11
**Apply to:** `src/lib/budget/period.ts` (imports `APP_TZ`, never redeclares it) and every threshold/period-boundary test (one instant, two zones, opposite verdicts — `vitest.config.ts` already pins `TZ=UTC` for exactly this reason; do not weaken it for the new `.test.tsx` config).

---

## No Analog Found

Files with no close match in this repo — the planner should lean on RESEARCH.md's own verified code blocks and UI-SPEC directly, not search further:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/seed/data/*.json` | config | batch | First committed data files in the repo. Shape: plain JSON arrays matching the Drizzle insert shape; RESEARCH § Seed Data has the exact verified counts to encode. |
| `src/lib/geocode/census.ts` | service | request-response | First external-fetch client in `src/`. RESEARCH.md § The Census Geocoder has the full verified zod schema and guard list — use it directly. |
| `drizzle/00XX_reserve_budget.sql` (the meter function body) | migration | — | The conditional-`UPDATE`-as-sole-statement + self-heal + threshold-`RETURNING` body is new to this repo. RESEARCH.md § Code Examples "The meter, end to end" (lines 837-892) is the verified, PG17-safe source — copy its structure exactly rather than reassembling Patterns 1-3 by hand. |
| `src/app/globals.css`, `components.json`, `postcss.config.mjs` | config | — | First stylesheet/design-tokens/shadcn config in the repo — this phase is where the design system is born (UI-SPEC's own framing). Follow UI-SPEC's Design System, Color and Typography sections verbatim; there is nothing in `src/` to pattern-match against. |
| `src/components/ui/*.tsx` (~30 shadcn copy-ins) | component | — | Generated by `npx shadcn@4.21.0 add`, not hand-written from a pattern. UI-SPEC § Components has the exact command and the full inventory. |
| `tests/unit/census.test.ts` | test | request-response (mocked) | First `msw` usage in the repo. No fixture-recording convention exists yet — record the four payloads RESEARCH.md § The Census Geocoder lists (McAllen hit, Rio Grande City hit, empty `addressMatches`, 503). |
| `tests/unit/stale-estimate.test.tsx` | test | event-driven | First `.test.tsx` / jsdom file. `vitest.config.ts` needs a harness change (§ Validation Architecture, harness change 2) before this file can even run — do that first, in Wave 0, as its own task. |

---

## Metadata

**Analog search scope:** `src/` (all 21 files), `drizzle/` (all 12 applied migrations), `tests/` (all 20 files), `scripts/` (both files), `.planning/CONVENTIONS.md`, `.planning/phases/02-budget-governor-search-presets/02-{CONTEXT,RESEARCH,UI-SPEC}.md`
**Files scanned:** 21 source files (full reads), 12 migrations (9 full reads: 0001-0004, 0006-0011; 2 read in Phase-1-summary form via CONVENTIONS.md's compiled table for 0000/0005), 12 test files (9 full reads), 2 scripts, `vitest.config.ts` + `vitest.db.config.ts`, `package.json`
**Pattern extraction date:** 2026-09-22

## PATTERN MAPPING COMPLETE

**Phase:** 02 - Budget Governor & Search Presets
**Files classified:** ~78 (grouped into 14 pattern-assignment sections above; the full per-file table is in § File Classification)
**Analogs found:** 62 / 78 (strong or partial in-repo matches) — 16 have no in-repo analog and are pointed at RESEARCH.md's own verified code blocks or UI-SPEC directly instead

### Coverage
- Files with exact analog: ~28 (schema barrel edit, `runs.ts`, most server actions, `settings/organization/page.tsx`'s testid move, `root layout.tsx` edit, `no-access/page.tsx` restyle, several migrations, `grants-audit.test.ts`/`event-trigger.test.ts` extensions, `signed-in.spec.ts` move)
- Files with role-match analog: ~34 (reference-data schema modules, most lib modules, most app routes, most new DB/unit tests)
- Files with no analog: 16 (seed JSON, Census fetch client, the meter function body, the entire design-system birth — CSS/shadcn/components.json — msw and jsdom test harness firsts)

### Key Patterns Identified
- **Every new table follows the same three-part shape Phase 1 already proved**: `orgScoped`/`orgPolicies` (or the new `org_id IS NULL` variant from RESEARCH § Pattern 5) + an explicit grant in the *same* migration (no default ACL exists since 0008) + a row in `TENANT_TABLES`/`EVENT_LOGGED` as a plain array literal in the test file.
- **`SECURITY DEFINER` functions are the one write path for anything privileged** (cap changes, budget reservation, settlement, org provisioning) — `set search_path = public` pinned inline, no caller-supplied `org_id`/`actor_id`, `grant execute` explicit. Four functions already ship this shape (`app.current_org_id`, `app.ensure_org`, `app.log_event`, `app.emit_event`); Phase 2 adds three more to the same family.
- **Immutability is always a GRANT, not a policy** — `events` and (new) `search_versions` both refuse UPDATE/DELETE at the grant layer so the refusal reads as `42501 permission denied for table <t>`, never a silent RLS zero-row filter.
- **The frontend has zero prior art** — every app-route and UI file is either a direct extension of Phase 1's *structural* discipline (`requireOrg()` first, `data-testid` on everything, no copy-dependent assertions) with no visual analog, or genuinely first-of-kind (CSS, shadcn, msw, jsdom) and should follow UI-SPEC + RESEARCH's own verified code rather than search the repo further.

### File Created
`C:/Users/danlo/prospector/.planning/phases/02-budget-governor-search-presets/02-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns and RESEARCH.md's verified code blocks directly in PLAN.md files.
