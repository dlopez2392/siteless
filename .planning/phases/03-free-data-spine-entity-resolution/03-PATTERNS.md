# Phase 3: Free-Data Spine & Entity Resolution — Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** 71 (new or modified), derived from `03-CONTEXT.md` D-01…D-20 + Claude's Discretion, `03-RESEARCH.md` § Recommended project structure (L1314–1353) + § Wave 0 Gaps (L1770–1788), and `03-UI-SPEC.md` §§ 0–4
**Analogs found:** 63 / 71 (8 genuinely new shapes — see § No Analog Found)

Every analog below was opened and read in this session. Where CONTEXT's `## Existing Code Insights` named a file, it was verified against the tree; three of its claims needed correction and are flagged 🔴 **CONTEXT CORRECTION** inline.

---

## File Classification

### Schema and migrations

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/db/schema/ingest-runs.ts` | model | batch | `src/db/schema/runs.ts` | exact |
| `src/db/schema/merge-candidates.ts` | model | batch | `src/db/schema/runs.ts` | role-match |
| `src/db/schema/business-merges.ts` | model | CRUD | `src/db/schema/runs.ts` + `searches.ts` | role-match |
| `src/db/schema/business-aliases.ts` | model | CRUD | `src/db/schema/outlet-counts.ts` | role-match |
| `src/db/schema/overture-categories.ts` | model (reference) | CRUD | `src/db/schema/clusters.ts` (`industryClusters`) | **exact** |
| `src/db/schema/businesses.ts` **(MOD)** | model | CRUD | itself + `source-records.ts` | exact |
| `src/db/schema/source-records.ts` **(MOD)** | model | batch | itself | exact |
| `src/db/schema/index.ts` **(MOD)** | config | — | itself (barrel, L1–12) | exact |
| `drizzle/00NN_extensions.sql` (`db:custom`, FIRST) | migration | — | `drizzle/0006_retention_constraints.sql` | role-match |
| `drizzle/00NN_<generated>.sql` (`db:generate`) | migration | — | `drizzle/0012_eager_vertigo.sql`, `0014`, `0017` | exact |
| `drizzle/00NN_spine_constraints_grants.sql` (`db:custom`) | migration | — | `drizzle/0013_reference_policies_and_grants.sql` | **exact** |

### Ingest (desk scripts + pure transforms)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `scripts/ingest-comptroller.ts` | script | batch / file-I/O | `scripts/refresh-outlet-counts.ts` + `scripts/seed.ts` | role-match |
| `scripts/ingest-overture.ts` | script | batch / streaming | `scripts/seed.ts` (owner conn + target gate) | partial |
| `scripts/resolve.ts` | script | batch | `scripts/seed.ts` | partial |
| `src/lib/socrata/client.ts` | service | request-response | `scripts/refresh-outlet-counts.ts` L40–94 | **exact (lift)** |
| `src/lib/socrata/permits.ts` | transform | transform | `src/lib/geocode/census.ts` (zod-over-payload) | role-match |
| `src/lib/socrata/closures.ts` | transform | transform | same | role-match |
| `src/lib/overture/transform.ts` | transform | transform | `src/lib/geocode/census.ts` L86–187 | role-match |
| `src/lib/geocode/census-batch.ts` | service | batch / file-I/O | `src/lib/geocode/census.ts` | **exact (sibling)** |
| `src/env.ts` **(MOD)** — `SOCRATA_APP_TOKEN` | config | — | itself | exact |

### Normalization, scoring, merge (pure TS)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/normalize/name.ts` · `phone.ts` · `address.ts` · `index.ts` | utility | transform | `src/lib/budget/field-mask-tier.ts` | role-match |
| `src/lib/resolve/score.ts` | service | transform | `src/lib/estimate/estimate.ts` | **exact** |
| `src/lib/resolve/survivorship.ts` | service | transform | `src/lib/estimate/estimate.ts` | role-match |
| `src/lib/resolve/block.ts` | service | batch (SQL gen) | — | **none** |
| `src/lib/resolve/merge.ts` | service | CRUD (transaction) | `src/server/actions/duplicate-preset.ts` L57–131 | partial |
| `src/lib/ids/external-key.ts` | utility | transform | `src/lib/ids.ts` (house shape only) | partial |

### Server (queries + actions)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/server/queries/review-queue.ts` | query | request-response | `src/server/queries/preset-cards.ts` | **exact** |
| `src/server/queries/sources.ts` | query | request-response | `src/server/queries/preset-cards.ts` | exact |
| `src/server/queries/businesses.ts` | query | request-response | `src/server/queries/preset-cards.ts` | exact |
| `src/server/actions/record-review-decision.ts` | action | CRUD | `src/server/actions/duplicate-preset.ts` | **exact** |
| `src/server/actions/unmerge-business.ts` | action | CRUD | `src/server/actions/duplicate-preset.ts` | exact |

### Routes and components

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/(app)/review/page.tsx` | route (RSC) | request-response | `src/app/(app)/presets/page.tsx` | **exact** |
| `src/app/(app)/sources/page.tsx` | route (RSC) | request-response | `src/app/(app)/presets/page.tsx` | exact |
| `src/app/(app)/businesses/page.tsx` | route (RSC) | request-response | `src/app/(app)/presets/page.tsx` | exact |
| `src/app/(app)/businesses/[id]/page.tsx` | route (RSC) | request-response | `src/app/(app)/presets/[id]/page.tsx` | **exact** |
| `src/components/app-shell/app-sidebar.tsx` **(MOD)** | component | — | itself L34–152 | exact |
| `src/components/app-shell/mobile-tab-bar.tsx` **(MOD)** | component | — | itself L25–63 | exact |
| `src/components/app-shell/more-sheet.tsx` | component | — | `src/components/app-shell/top-bar.tsx` L26–41 | **exact** |
| `src/components/review/candidate-pair.tsx` | component | — | `src/components/preset-list/preset-card.tsx` | role-match |
| `src/components/review/signal-chips.tsx` | component | — | `src/lib/ui/run-tone.ts` + `ui/badge` | role-match |
| `src/components/review/review-actions.tsx` | component (client) | request-response | `src/components/preset-detail/duplicate-dialog.tsx` L92–111 | **exact** |
| `src/components/sources/source-ledger.tsx` | component | — | `src/components/spend/by-run.tsx` (+ `run-tone.ts`) | role-match |
| `src/components/sources/confidence-distribution.tsx` | component | — | `src/components/spend/budget-gauge.tsx` | partial |
| `src/components/sources/attribution-block.tsx` | component | — | `src/components/preset-list/presets-empty.tsx` | partial |
| `src/components/business-list/*` | component | — | `src/components/preset-list/*` | exact |
| `src/components/business-detail/fields-and-sources.tsx` | component | — | `src/components/preset-detail/summary-card.tsx` | role-match |
| `src/components/business-detail/merge-history.tsx` | component | — | `src/components/preset-detail/version-history.tsx` | **exact** |
| `src/components/business-detail/unmerge-dialog.tsx` | component (client) | request-response | `src/components/preset-detail/duplicate-dialog.tsx` | **exact** |
| `src/lib/ui/copy.ts` **(MOD)** | config | — | itself L1–55 | exact |

### Seed and export

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/seed/data/overture-categories.json` | config (data) | — | `src/seed/data/clusters.json` | exact |
| `src/seed/types.ts` **(MOD)** | config | — | itself L26–45 | exact |
| `scripts/seed.ts` **(MOD)** | script | file-I/O → CRUD | itself L71–96, L127–136, L199–205 | exact |
| `src/lib/export/registry.ts` **(MOD)** | config | — | itself L1–18 | exact |
| `src/lib/export/public-business.ts` **(MOD)** | model | — | itself L26–41 | exact |

### Tests

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `tests/db/extensions.test.ts` | test (db) | — | `tests/db/retention.test.ts` L112–121 | exact |
| `tests/db/texas-side.test.ts` | test (db) | — | `tests/db/reference-rows.test.ts` (positive-control-first) | exact |
| `tests/db/_ingest-fixtures.ts` | test fixture | — | `tests/db/_fixtures.ts` | exact |
| `tests/db/ingest-idempotency.test.ts` | test (db) | — | `tests/db/event-trigger.test.ts` | role-match |
| `tests/db/merge-unmerge.test.ts` | test (db) | — | `tests/db/versioned-presets.test.ts` | role-match |
| `tests/db/external-key.test.ts` · `alias-consistency.test.ts` · `chain-closures.test.ts` | test (db) | — | `tests/db/retention.test.ts` | exact |
| `tests/db/grants-audit.test.ts` **(MOD)** | test (db) | — | itself L34–58 | exact |
| `tests/db/event-trigger.test.ts` **(MOD)** | test (db) | — | itself L52–75 | exact |
| `tests/db/retention.test.ts` **(MOD)** | test (db) | — | itself L79–110 | exact |
| `tests/db/reference-rows.test.ts` **(MOD)** | test (db) | — | itself L64–90 | exact |
| `tests/unit/normalize.test.ts` · `score.test.ts` · `external-key.test.ts` | test (unit) | — | `tests/unit/estimate.test.ts`, `field-mask-tier.test.ts` | exact |
| `tests/unit/socrata.test.ts` · `overture-transform.test.ts` · `census-batch.test.ts` | test (unit, msw) | — | `tests/unit/census.test.ts` | **exact** |
| `tests/unit/msw/server.ts` **(MOD)** | test harness | — | itself L1–113 | exact |
| `tests/unit/msw/fixtures/socrata-*.json`, `census-batch-*.txt` | fixture | — | `tests/unit/msw/fixtures/census-*.json` + `README.md` | exact |
| `tests/unit/fixtures/overture-rgv-sample.json`, `merge-pairs.json` | fixture | — | `tests/unit/fixtures/preset.ts`, `business.ts` | role-match |
| `tests/unit/no-internal-leak.test.ts` **(MOD)** | test (unit) | — | itself L24–94 | exact |
| `tests/e2e/touch-targets.spec.ts` **(MOD)** | test (e2e) | — | itself L56–78 | exact |
| `tests/e2e/review.spec.ts` · `sources.spec.ts` · `businesses.spec.ts` | test (e2e) | — | `tests/e2e/preset-detail.spec.ts` (incl. its trap) | role-match |

### Docs / infra

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `docs/runbooks/ingest.md` | doc | — | — | **none** |
| `.vercelignore` | config | — | — | **none** (Phase-2 debt, one line) |
| `package.json` **(MOD)** | config | — | itself L10–29 | exact |

---

## Pattern Assignments

### `src/db/schema/ingest-runs.ts` · `merge-candidates.ts` · `business-merges.ts` · `business-aliases.ts` (model, batch/CRUD)

**Analog:** `src/db/schema/runs.ts` (tenant table with CHECK + two indexes + `orgPolicies`), read in full.

**The whole shape** (`src/db/schema/runs.ts` L1–63) — imports, the doc block that records *why* each constraint exists, the `...orgScoped` spread, the CHECK whose values are the UI's status union, and the `(t) => [...]` array that carries the `_org_idx` **and** the policies:

```typescript
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { searchVersions } from './searches';
import { orgPolicies, orgScoped, tstz } from './_helpers';

export const runs = pgTable(
  'runs',
  {
    ...orgScoped,
    searchVersionId: uuid('search_version_id')
      .notNull()
      .references(() => searchVersions.id, { onDelete: 'no action' }),
    status: text('status').notNull().default('queued'),
    stoppedReason: text('stopped_reason'),
    callsCount: integer('calls_count').notNull().default(0),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    index('runs_org_idx').on(t.orgId),
    index('runs_version_idx').on(t.searchVersionId),
    check(
      'runs_status_known',
      sql`status in ('queued','running','complete','partial','refused','failed')`,
    ),
    ...orgPolicies('runs'),
  ],
);
```

Map directly onto `ingest_runs`: `source_key` CHECK ↔ `runs_status_known`; `status` CHECK `('running','complete','stopped','failed')` (RESEARCH L1032 — note the UI-SPEC badge words are "Complete / Stopped early / Failed", so extend `src/lib/ui/run-tone.ts`'s union rather than writing a second tone map); `startedAt`/`finishedAt` via `tstz` (**never** a bare `timestamp` — `_helpers.ts` L6–9 and the schema audit).

🔴 **Comment discipline is a pattern here, not decoration.** `runs.ts` L9–27 records four decisions (`onDelete: 'no action'`, bigint-not-integer, the six statuses, the deliberate absence of `log_event`). Every new table must carry the same: `merge_candidates` and `business_aliases` and `ingest_runs` are **deliberately excluded** from `log_event` and the reason belongs in the file, because `EVENT_LOGGED` asserts set equality both ways.

**Adding any `pgPolicy` auto-enables RLS** — `src/db/schema/businesses.ts` L30–33:

```typescript
  // The index is not optional: an RLS predicate on org_id gets no index for free
  // (RESEARCH Pitfall 5). Adding any policy auto-enables RLS in drizzle-orm 0.45.2 — do
  // not also call .enableRLS(), and .withRLS() does not exist in this version.
  (t) => [index('businesses_org_idx').on(t.orgId), ...orgPolicies('businesses')],
```

---

### `src/db/schema/overture-categories.ts` (model, reference rows)

**Analog:** `src/db/schema/clusters.ts` L19–35 — *exact*. This is the `org_id IS NULL` built-in pattern, verbatim.

```typescript
import { orgScopedNullable, referencePolicies } from './_helpers';

export const industryClusters = pgTable(
  'industry_clusters',
  {
    ...orgScopedNullable,
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('industry_clusters_org_idx').on(t.orgId),
    unique('industry_clusters_org_key_uniq').on(t.orgId, t.key).nullsNotDistinct(),
    ...referencePolicies('industry_clusters'),
  ],
);
```

🔴 **`.nullsNotDistinct()` is load-bearing and must be spelled.** `_helpers.ts` L91–94 and `clusters.ts` L15–17: `UNIQUE (org_id, key)` alone does not stop a duplicate built-in, because `NULL != NULL` — a second `(null, 'restaurant')` inserts cleanly and the seed loader doubles the table on its second run. Measured: 4 rows → 8.

`_helpers.ts` L96–120 is `referencePolicies()` itself — READ admits `org_id is null`, all three WRITE policies carry `org_id is not null and org_id = (select app.current_org_id())`. Do not hand-roll a fifth policy set.

---

### `src/db/schema/businesses.ts` — **MODIFIED** (may ADD, may not rename)

**Analog:** itself, L18–34. The provenance-pair pattern the three new pairs must copy exactly:

```typescript
    // FOUND-05 provenance pairs. The `_src_ret` twin is GENERATED ALWAYS AS ('durable')
    // STORED, so the composite FK added in migration 0006 can only resolve against a
    // source record whose retention_class is 'durable'.
    legalNameSourceId: uuid('legal_name_source_id'),
    legalNameSrcRet: text('legal_name_src_ret').generatedAlwaysAs(sql`'durable'`),
    displayNameSourceId: uuid('display_name_source_id'),
    displayNameSrcRet: text('display_name_src_ret').generatedAlwaysAs(sql`'durable'`),
    phoneSourceId: uuid('phone_source_id'),
    phoneSrcRet: text('phone_src_ret').generatedAlwaysAs(sql`'durable'`),
```

Add `addressSourceId/addressSrcRet`, `locationSourceId/locationSrcRet`, `closedAtSourceId/closedAtSrcRet` in the same form (RESEARCH L1146–1161).

**The compile-time bridge that must be kept alive** (`businesses.ts` L36–43) — every new column added to `BusinessLike` fails `tsc` here until somebody decides public-or-internal:

```typescript
type BusinessLikeIsSubset =
  BusinessLike extends Pick<typeof businesses.$inferSelect, keyof BusinessLike> ? true : never;
export const businessLikeBridge: BusinessLikeIsSubset = true;
```

**Array column** (for a `text[]`, e.g. a sources-present projection or a chain member list) — `src/db/schema/geography.ts` L68–71:

```typescript
    nameVariants: text('name_variants')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
```

---

### `src/db/schema/source-records.ts` — **MODIFIED** (`sr_source_key_known`, `last_seen_at`, `source_version`)

**Analog:** itself, L19–41 — the CHECK that must be replaced (drop + re-add in a `db:custom` migration, because drizzle-kit's differ does not emit table-level constraints):

```typescript
    check(
      'sr_source_key_known',
      sql`source_key in ('overture','tx_comptroller','osm','county_dba','google_places','firecrawl','http_probe','dns_probe','manual')`,
    ),
    check('sr_retention_class_known', sql`retention_class in ('durable','ephemeral')`),
```

New value set per RESEARCH L1123–1126: add `'tx_comptroller_closures'` and `'census_geocoder'`. `sr_google_is_ephemeral` (drizzle/0006 L16–17) is **untouched**.

---

### `drizzle/00NN_spine_constraints_grants.sql` (migration, `pnpm db:custom`)

**Analog:** `drizzle/0013_reference_policies_and_grants.sql` — *exact*. It is the canonical "the half drizzle-kit cannot emit" migration and it does all four obligations a new table owes in one file.

**Header that names the tool** (0013 L1–7):

```sql
-- The half of migration 0012 that drizzle-kit's differ cannot emit: the circular foreign
-- key, the explicit DML grants every new table now needs, search_versions' grant-level
-- immutability, and the audit trigger attachments.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09) — nothing here was applied by any other tool, and no
-- generated file was hand-edited.
```

🔴 There is **no `drizzle-kit push`** in this repo. Every migration goes `pnpm db:generate` (schema) or `pnpm db:custom --name=<name>` (functions/grants/constraints/extensions), then `pnpm db:migrate` — `scripts/db.ts` L18–52 is the only gate, and `--target=test` refuses a Supabase host (L36–40).

**`--> statement-breakpoint` between EVERY statement**, function bodies kept whole (CONVENTIONS § Migrations L83–86).

**The four obligations a new table owes, as one excerpt** (0013 L25–47, L88–91, L103–115, L118–141):

```sql
-- 2. EXPLICIT DML GRANTS. A new table inherits NOTHING.
-- Migration 0008 retired the platform default ACL for anon and authenticated on tables in
-- public ... A table created without its grant fails loudly with
-- `42501 permission denied for table <t>` on the first user-role statement.
grant select, insert, update, delete on industry_clusters, industry_terms, counties, cities, geo_presets, outlet_counts to authenticated;
--> statement-breakpoint

-- A COLUMN GRANT, following migration 0010's orgs precedent. PostgreSQL checks a column
-- privilege against the statement's SET list BEFORE any policy is evaluated.
grant select, insert on runs to authenticated;
--> statement-breakpoint
grant update (status, stopped_reason, cost_micro_usd, calls_count, started_at, finished_at) on runs to authenticated;
--> statement-breakpoint

-- 3. TRIGGER ATTACHMENT, copying migration 0007's loop.
do $$ declare t text;
begin
  foreach t in array array['searches','search_versions'] loop
    execute format(
      'create trigger %I_event after insert or update or delete on %I
         for each row execute function app.log_event()', t, t);
  end loop;
  foreach t in array array['searches','runs','industry_clusters',...] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
--> statement-breakpoint

-- 4. WHAT DELIBERATELY HAS NO app.log_event TRIGGER, AND WHY.
comment on table search_versions is 'Append-only. Immutable by GRANT (0013)...';
```

**Phase 3's grant matrix** (RESEARCH L1169–1177) mapped onto this shape:

| Table | Grant line to write | `log_event`? |
|---|---|---|
| `ingest_runs` | `grant select on ingest_runs to authenticated;` | ❌ — run-level `app.emit_event` instead |
| `merge_candidates` | `grant select, update on merge_candidates to authenticated;` (consider a **column** grant on `decision, decided_by, decided_at` — 0013 L68–91 is the precedent) | ❌ volume |
| `business_merges` | `grant select on business_merges to authenticated;` — written by a definer so `merged_by` cannot be forged | ✅ |
| `business_aliases` | `grant select on business_aliases to authenticated;` | ❌ derived |
| `overture_category_map` | `grant select, insert, update, delete ... to authenticated;` (the reference-table line, 0013 L47 — safe because `referencePolicies` excludes built-ins from every write policy) | ❌ |

**Belt-and-braces revoke** — `drizzle/0015_budget_grants_and_triggers.sql` L42–51 explains why a `revoke` beside a narrow `grant` is not redundant, and is the closest analog for the SELECT-only tables:

```sql
grant select on budget_periods, cost_reservations, cost_ledger to authenticated;
--> statement-breakpoint
revoke insert, update, delete on budget_periods, cost_reservations, cost_ledger from authenticated;
```

**The composite provenance FKs** — `drizzle/0006_retention_constraints.sql` L20–36, copied three times:

```sql
-- The composite FK target. A plain FK to source_records(id) could cite anything; this
-- pair makes the retention class part of the reference.
alter table source_records add constraint sr_durable_uniq unique (id, retention_class);
--> statement-breakpoint

alter table businesses add constraint businesses_phone_src_fk
  foreign key (phone_source_id, phone_src_ret)
  references source_records (id, retention_class);
```

**Partial index with a predicate a test then greps** — 0006 L40 + `retention.test.ts` L112–121:

```sql
create index sr_expiry on source_records (expires_at) where expires_at is not null;
```

That is the exact shape for `businesses_phone_idx`, `businesses_addr_idx`, `businesses_chain_idx`, `businesses_merged_idx` and the partial unique on `business_merges (org_id, loser_id) where undone_at is null` (RESEARCH L329–336, L887).

---

### `drizzle/00NN_extensions.sql` (migration, FIRST of the phase)

**Analog:** `drizzle/0006` for the file form; there is **no existing `create extension` migration** — `plpgsql` is the only installed extension today (RESEARCH L181). The excerpt to copy is `drizzle/0015` L9–20, which shows a `db:custom` migration whose first statement is an index and whose comment carries the measurement that justified it. The `app.distance_m()` body goes in as a **single statement** with `--> statement-breakpoint` around it — CONVENTIONS L83–86: "each function body kept as one statement. A naive splitter otherwise cuts a `$$ … $$` body on its first internal `;`".

Function-declaration style to copy from `drizzle/0011_events_no_caller_insert.sql` L31–33 (note `set search_path = public` on the same statement for anything `SECURITY DEFINER`; `app.distance_m` is **not** a definer — it is `language sql immutable parallel safe`).

---

### `scripts/ingest-comptroller.ts` (script, batch)

**Analog:** `scripts/refresh-outlet-counts.ts` — the working Socrata client. 🔴 **CONTEXT is right: lift, do not rewrite.**

**The four helpers to move into `src/lib/socrata/client.ts` verbatim** (L56–94):

```typescript
/** Socrata string literals are single-quoted; a quote inside one is doubled. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** The Comptroller's own county number, zero-padded — `outlet_county_code` is TEXT. */
function comptrollerCode(code: number): string {
  return String(code).padStart(3, '0');
}

/** `lo` inclusive, `hi` exclusive — the same half-open form the seed types document. */
function naicsPredicate(ranges: Array<{ lo: number; hi: number }>): string {
  return (
    '(' +
    ranges
      .map((r) => `(outlet_naics_code >= ${r.lo} and outlet_naics_code < ${r.hi})`)
      .join(' or ') +
    ')'
  );
}
```

🔴 **`comptrollerCode()` is correct for `jrea-zgmq` and WRONG for `3kx8-uryv`** (RESEARCH L358–368): `loc_county = '031'` returns 0 rows, `'31'` returns 21,062. The lifted module needs a second, unpadded formatter and a unit test asserting the two differ for 31.

**The error-body echo** (L71–83) — keep it; "request failed" alone sent an earlier reader looking at the network:

```typescript
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    // A type-mismatch on outlet_naics_code arrives as a 400 with a SoQL error body. Print
    // it: "request failed" alone sent an earlier reader looking at the network.
    throw new Error(
      `refresh-outlet-counts: ${res.status} for ${where}\n${(await res.text()).slice(0, 400)}`,
    );
  }
```

**The grep gate travels with the lift** (L17–25): the file is grepped for the absence of the SoQL string-prefix function, *including in comments*. `src/lib/socrata/**` inherits that grep — so do not quote the forbidden function name anywhere under it.

**The `000` sentinel** (L27–31, L42–43) — `outlet_county_code between '001' and '254'` for the statewide chain-detection request RESEARCH L1087 recommends.

**Owner connection + target gate** — `scripts/seed.ts` L14–18 and L328–336 (the gate is *copied in shape from `scripts/db.ts`, deliberately not imported*, because `db.ts` runs its gate at module load):

```typescript
export function resolveSeedTarget(argv: string[]): { target: 'test' | 'prod'; url: string } {
  const targetArg = argv.find((a) => a.startsWith('--target='));
  const target = targetArg ? targetArg.slice('--target='.length) : 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('scripts/seed.ts: unknown target ' + target + ' (test | prod)');
  }
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
```

**The ETL actor** is the one thing no script does yet. The GUC the ingest sets is read here (`drizzle/0007` L23–25):

```sql
    -- Clerk sub, then a GUC workers/ETL can set, then 'system'. current_setting with the
    -- missing_ok flag returns NULL rather than erroring on an unset GUC.
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
```

So the script writes, per transaction (RESEARCH L1370): `select set_config('app.actor_id', 'etl:ingest-comptroller', true)` — the `true` is the transaction-LOCAL form, same reason as `withOrg` (`src/db/with-org.ts` L45–48).

**The idempotent upsert with `(xmax = 0)`** — `scripts/seed.ts` L82–88 + L127–136:

```typescript
export const CLUSTER_UPSERT = `
  insert into industry_clusters (org_id, key, display_name, sort_order)
  values (null, $1, $2, $3)
  on conflict on constraint industry_clusters_org_key_uniq do update set
    display_name = excluded.display_name,
    sort_order   = excluded.sort_order
  returning (xmax = 0) as inserted`;

async function upsert(c: Client, sql: string, params: unknown[], tally: Tally): Promise<void> {
  const r = await c.query<{ inserted: boolean }>(sql, params);
  const row = r.rows[0];
  // A DO UPDATE whose USING is filtered returns no row at all. Silence there would let the
  // loader report success while writing nothing, which is the one failure this script
  // must never have.
  if (!row) throw new Error('seed: upsert affected no row. SQL: ' + sql.trim().split('\n')[0]);
  if (row.inserted) tally.inserted += 1;
  else tally.updated += 1;
}
```

🔴 `on conflict **on constraint** <name>`, never the column-list inference form — `seed.ts` L20–33 records the executed proof and notes the repo greps for the inference form's absence. The Phase 3 `source_records` upsert (RESEARCH L992–1006) uses the same `returning (xmax = 0) as inserted` discriminator and adds `payload_hash is distinct from excluded.payload_hash as changed`.

The "select-then-DO NOTHING" get-or-create variant CONTEXT names is `drizzle/0009_ensure_org_no_write.sql` L40–51 — read it for the *race* arm, which the external-key retry loop needs:

```sql
  select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  if v_id is not null then return v_id; end if;
  insert into orgs (...) values (...)
  on conflict (clerk_org_id) do nothing
  returning id into v_id;
  if v_id is null then
    -- Lost the race to a concurrent first request: DO NOTHING returned no row.
    select id into v_id from orgs where clerk_org_id = p_clerk_org_id;
  end if;
```

---

### `src/lib/geocode/census-batch.ts` (service, batch)

**Analog:** `src/lib/geocode/census.ts` — same directory, same provider, different endpoint. Copy wholesale:

**Hard-coded host/path + fixed query, caller input as a value only** (L36–49, L138–141):

```typescript
/** Hard-coded. T-2-13: no caller-supplied value ever reaches the host or the path. */
const CENSUS_HOST = 'https://geocoding.geo.census.gov';
const CENSUS_PATH = '/geocoder/geographies/onelineaddress';
const CENSUS_FIXED_QUERY =
  'benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json';
```

**Never throws; every outcome is a named reason** (L108–128):

```typescript
export type GeocodeFailureReason = 'no_match' | 'not_texas' | 'unreachable' | 'bad_shape';

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; countyFips: string; countyName: string; matchedAddress: string }
  | { ok: false; reason: GeocodeFailureReason };
```

The batch variant adds `'tie'` and `'non_exact'` (RESEARCH L1418, L1731: `Non_Exact` never promotes to the `address_exact` signal).

**The axis-order pin** (L96–102) — the single most-copied comment in this phase:

```typescript
  // 🔴 `x` is LONGITUDE and `y` is LATITUDE. The Census Geocoder does NOT return
  // `(lat, lng)`, and reading these in written order puts every RGV point in the Indian
  // Ocean. `census.test.ts` pins the axis order with a sign assertion, because that is the
  // one defect a `toBeDefined` would sail straight past.
  coordinates: z.object({ x: z.number(), y: z.number() }),
```

and its assertion (`tests/unit/census.test.ts` L60–68):

```typescript
    // 🔴 AXIS ORDER, asserted three ways. The RGV is north of the equator and west of
    // Greenwich, so a swap flips both signs at once.
    expect(result.lat).toBeGreaterThan(0);
    expect(result.lng).toBeLessThan(0);
    expect(result.lat).toBe(mcallenMatch.coordinates.y);
    expect(result.lng).toBe(mcallenMatch.coordinates.x);
```

**Bounded timeout, HTTP-200-is-not-success, zod strips the rest** (L55–58, L144–170) — all four branches (`unreachable` on throw, `unreachable` on `!res.ok`, `bad_shape` on unparseable, `no_match` on empty) are the batch parser's branch table too.

---

### `src/lib/overture/transform.ts` and `src/lib/socrata/permits.ts` (transform, pure)

**Analog:** `src/lib/geocode/census.ts` L86–106 for the zod discipline — *exactly the fields we read, nothing else*:

```typescript
/**
 * Exactly the fields the county resolution reads. zod strips everything else, so the TIGER
 * ids and address components in the real payload never become ours by accident.
 */
const countyGeographySchema = z.object({ GEOID: z.string(), COUNTY: z.string(), NAME: z.string(), STATE: z.string() });
```

**Pattern 3 (RESEARCH L1363–1365): I/O lives at the edge.** `overtureRowToSourceRecord()` is pure over an already-parsed row; DuckDB appears only in `scripts/ingest-overture.ts` and **never in the test's import graph**. `census.ts` already models this — the module has `import 'server-only'` and the network call, while the *test* drives it through msw. For the Overture transform, go one step further: no `server-only`, no fetch, so `tests/unit/overture-transform.test.ts` feeds it `tests/unit/fixtures/overture-rgv-sample.json` directly.

Two traps the transform must encode (RESEARCH L488, L490): store `ST_X/ST_Y(geometry)` and never `bbox.*`; read `row.phones.items[0]`, never `row.phones[0]`.

---

### `src/lib/resolve/score.ts` (service, transform)

**Analog:** `src/lib/estimate/estimate.ts` — a pure, fixture-pinned scoring module with no database in its import graph. Its exported shape is the template:

```typescript
export type EstimateContext = { ... };
export type EstimateAssumptions = { ... };
export type EstimateRange = { ... };
export function estimatePreset(spec: PresetSpec, ctx: EstimateContext): EstimateRange
```

→ `export function score(pair: CandidatePair): ScoreResult` returning `{ score, band, signals, features }` (D-09's component vector, which the chip band renders).

**The "refuses, never defaults" house shape** — `src/lib/budget/field-mask-tier.ts` L11–17:

```
 * THIS FUNCTION REFUSES; IT NEVER DEFAULTS. An unknown field throws. Defaulting to
 * Essentials is exactly how a field that costs $40 per 1,000 gets priced at $0 ...
 * Same house shape as src/lib/auth/require-org.ts: deny by default.
 *
 * The union type is the compile-time half of the same guard — a wildcard mask cannot be
 * spelled, so it is a type error rather than a runtime surprise on the invoice.
```

Apply verbatim to the structural rules R1–R6: a pair missing a location cannot reach 95 by *construction* (a union type / a required discriminant), not by an `if` somebody can delete. M13–M15 in `03-VALIDATION` mutate exactly those clauses.

**The grep-gate precedent** — `field-mask-tier.ts` L6–8 records that "the header name may be spelled in at most one module under `src/`". That is the pattern for DEDUP-04's `unaccent(` grep (RESEARCH L1728) and for the `cross join lateral` / `on … % …` grep (L1714). And the self-exclusion trick, so a guard does not trip on its own comment — `src/lib/ui/run-tone.ts` L13–16:

```
 * The guard that enforces this is a BARE TOKEN SEARCH over `src/lib/ui/`, so this comment
 * deliberately does not spell the directive out ... A file inside a guarded tree must not
 * write the string the guard hunts for, or the guard reports the warning as the violation.
```

---

### `src/server/actions/record-review-decision.ts` and `unmerge-business.ts` (action, CRUD)

**Analog:** `src/server/actions/duplicate-preset.ts` — *exact*. 🔴 **CONTEXT CORRECTION:** CONTEXT said "whatever `/presets` uses for its write path — find it". It is `src/server/actions/*.ts` with `_result.ts`/`_pg.ts` beside them; there are seven actions, and `duplicate-preset.ts` is the cleanest multi-statement-transaction example.

**The whole skeleton** (L1–11, L40–58, L133–141):

```typescript
'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { requireOrg } from '@/lib/auth/require-org';
import { COPY_OF, NOT_FOUND, PRESET_NAME_MISSING, UNEXPECTED_ERROR } from '@/lib/ui/copy';
import { rowsOf } from '@/server/queries/budget';
import { fail, ok, type ActionResult } from './_result';

export async function duplicatePreset(input: unknown): Promise<ActionResult<{...}>> {
  // 🔴 T-2-01. First statement.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = duplicateInputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', ...);

  try {
    const result = await withOrg(claims, async (tx) => { /* every statement, one tx */ });
    if (result.kind === 'missing') return fail('not_found', NOT_FOUND('version'));
    revalidatePath('/presets');
    revalidatePath(`/presets/${result.searchId}`);
    return ok({ ... });
  } catch {
    return fail('unexpected', UNEXPECTED_ERROR('this preset'));
  }
}
```

🔴 **`requireOrg()` is the first statement, always.** 🔴 **RLS is the access control**, so a foreign id is `not_found`, never `forbidden` (L21–23) — the unmerge action inherits this for a `business_merges` id from another tenant.

**Input validation is `z.strictObject` + `safeParse`** (L30–38). For the review decision: `z.strictObject({ candidateId: z.uuid(), decision: z.enum(['merged','distinct','skip']) })`.

**An expected refusal is a result, not a throw** — `src/server/actions/_result.ts` L20–51 is the closed union every action returns; `ActionErrorCode` already carries `conflict` (somebody decided this pair first) and `not_found`. Add nothing unless a screen has a branch for it.

**Reading a SQLSTATE out of the driver stack** — `src/server/actions/_pg.ts` L1–21, L51–61. Unmerge needs this for `23505` on the alias unique index and `23514` on the external-key shape CHECK:

```typescript
/** `23505` raised by one NAMED constraint. Both halves, always — see the header. */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  const failure = pgFailure(error);
  return failure?.code === '23505' && failure.constraint === constraint;
}
```

🔴 `_pg.ts` L4–10: "**THE SQLSTATE IS NOT ON THE ERROR YOU CATCH.** drizzle wraps every failure in a `DrizzleQueryError` whose `cause` is the postgres.js error." Matching on `err.code` alone matches nothing, silently.

**The array trap, already paid for once** — `duplicate-preset.ts` L76–101:

```typescript
      /**
       * 🔴 A JS ARRAY IN A DRIZZLE `sql` TEMPLATE BECOMES N PLACEHOLDERS, NOT ONE ARRAY.
       *   2+ clusters -> 42846 cannot cast type record to uuid[]
       *   1 cluster   -> 22P02 malformed array literal
       */
      const clusterIdsLiteral = `{${source.cluster_ids.join(',')}}`;
      // ... ${clusterIdsLiteral}::uuid[] ...
```

Phase 3 hits this in at least four places (RESEARCH L1432–1433): the RGV county-code list, the toll-free NPA list, the `basic_category` lookup, the criterion-5 Mexican-locality list. Bind an array literal as **one** parameter, or use `sql.join(xs, sql\`, \`)`.

---

### `src/server/queries/review-queue.ts` · `sources.ts` · `businesses.ts` (query, request-response)

**Analog:** `src/server/queries/preset-cards.ts` — *exact*, and it is the newest query module in the tree.

**Module shape** (L1–12, L133–204): `import 'server-only'`, a `tx`-taking `read*` function **and** a `withOrg`-opening `list*` wrapper, so a page can compose several reads inside one transaction:

```typescript
import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { periodWindow, rowsOf, type Tx } from './budget';

export async function readPresetCards(tx: Tx, index: ReferenceIndex): Promise<PresetCards> { ... }

export async function listPresetCards(claims: OrgClaims): Promise<PresetCards> {
  return withOrg(claims, async (tx) => {
    const index = await readReferenceIndex(tx);
    return readPresetCards(tx, index);
  });
}
```

🔴 **ONE transaction per request, never nested** (`preset-cards.ts` L23–27, and `presets/[id]/page.tsx` L68–73): `src/db/client.ts` pools with `max: 1`, so a second `withOrg` opened inside a first waits forever on a connection the outer one holds and the **request hangs rather than failing**. `/businesses/[id]` reads the business, its source records, its merge history and its aliases — all in one `withOrg`.

**The lateral-join list query** (L151–176) — the literal shape `/review` and `/businesses` want:

```typescript
  const rows = rowsOf<CardRow>(
    await tx.execute(sql`
      select s.id, s.display_name, cv.version, ..., lr.last_run_at, lr.runs_this_month
        from searches s
        left join search_versions cv on cv.id = s.current_version_id
        left join lateral (
          select max(coalesce(r.started_at, r.created_at)) as last_run_at,
                 count(*) filter (
                   where coalesce(r.started_at, r.created_at) >= ${fromIso}::timestamptz
                     and coalesce(r.started_at, r.created_at) <  ${toIso}::timestamptz
                 )::int as runs_this_month
            from runs r join search_versions v on v.id = r.search_version_id
           where v.search_id = s.id
        ) lr on true
       where s.status = 'active'
       order by s.updated_at desc`),
  );
```

🔴 **The two drizzle traps this file already documents, both of which Phase 3 hits harder:**

1. **Bind `toISOString()` with an explicit cast, never a `Date`** (L140–149):

```typescript
  // 🔴 ISO STRINGS WITH AN EXPLICIT CAST, NEVER A `Date` OBJECT. ... a bound Date throws
  // `TypeError: The "string" argument must be of type string ... Received an instance of
  // Date` at query time, inside drizzle's "Failed query" wrapper. Typecheck, lint and
  // build are all green against it, and the page 500s the first time it is loaded.
  const fromIso = from.toISOString();
```

Phase 3 binds `last_seen_at`, `run_started_at`, `closed_at`, `merged_at`, `undone_at`, `fetched_at` (RESEARCH L1436).

2. **A `timestamptz` read through `tx.execute` comes back as a STRING** (L72–98):

```typescript
function instantOf(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);            // parsed AS-IS, with its space — do not ISO-ify
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
```

Every `/sources` "Last run", every merge-history timestamp and every `last_seen_at` on the detail view goes through this. `presets/[id]/page.tsx` L54–61 records the same defect from the other side (`requireInstant` in `server/queries/budget.ts` is the shared helper — reuse it, do not write a third).

**Names resolved from reference rows, never from a payload's own strings** (L100–131 `geographyLabelOf`) — the `/businesses` list's Cluster column resolves `cluster_key` → `industry_clusters.display_name` the same way. CONVENTIONS § Naming: a key is never shown to a person.

---

### `src/app/(app)/review/page.tsx` · `sources/page.tsx` · `businesses/page.tsx` (route, RSC)

**Analog:** `src/app/(app)/presets/page.tsx` — *exact*.

**The whole file is the template** (L1–11, L38–52, L100–124):

```tsx
export const dynamic = 'force-dynamic';

const TITLE = 'Search presets';

function PageHeading() {
  return <h1 className="text-xl font-semibold leading-tight">{TITLE}</h1>;
}

async function PresetListRegion() {
  const claims = await orgClaims();
  const { cards, runThisMonth } = await listPresetCards(claims);
  const isEmpty = cards.length === 0;
  return ( ... isEmpty ? <PresetsEmpty /> : <> ... </> );
}

export default function PresetsPage() {
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Suspense fallback={<PresetListSkeleton />}>
        <PresetListRegion />
      </Suspense>
    </div>
  );
}
```

🔴 **The heading paints before the data** (L22–25): the skeleton fallback renders the same `PageHeading` from the same constant, so first paint is the real heading, never a blank page or a centred spinner. 03-UI-SPEC § States → Loading demands exactly this on all four screens, and Executor Rule 27 makes it explicit for `/sources` ("the four source rows render before any run exists — they are static structure, not data").

🔴 **`requireOrg()` is already enforced by `src/app/(app)/layout.tsx`**; a page calls `orgClaims()` only to scope its own query (L16–20).

**The sticky thumb-zone bar** (L83–93) — this is `/review`'s action bar, one breakpoint up in importance:

```tsx
          {/* The thumb zone (MOB-01). A full-width 48px primary button on the `--card`
              surface with a 1px top border, sitting directly above the 64px tab bar and
              its safe-area inset. Hidden from 640px up, where the header CTA takes over —
              so exactly one of the two is ever visible, each with its own hook. */}
          <Card className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-none border-0 border-t p-4 shadow-none sm:hidden">
            <CreatePresetCta label="Create preset" data-testid="presets-create-cta-mobile" className="h-12 w-full" />
          </Card>
```

Note `h-12` = 48px, matching 03-UI-SPEC § 1's "48px tall" review actions, and `bottom-[calc(4rem+env(safe-area-inset-bottom))]` — the inset is **added** to the 64px tab bar, never substituted (UI-SPEC § Spacing exceptions). The review bar is **two rows** (UI-SPEC § 1), so the content area's bottom padding must account for both rows plus the tab bar.

**Count line assembled in one place so the singular cannot drift** (L30–36) — `/review`'s "{n} pairs left to review" / "1 pair left to review" and `/businesses`' "{n} businesses · showing the first {m}":

```tsx
function countLine(total: number, runThisMonth: number): string {
  const presets = total === 1 ? '1 preset' : `${total} presets`;
  ...
}
```

…except per UI-SPEC Executor Rule 5 those strings now live in `src/lib/ui/copy.ts`, not in the page.

---

### `src/app/(app)/businesses/[id]/page.tsx` (route, RSC)

**Analog:** `src/app/(app)/presets/[id]/page.tsx` — *exact*.

**The uuid guard** (L156–160):

```tsx
  const { id } = await params;
  // WR-08: shared with /presets/[id]/edit, which had no guard at all and answered a 500
  // where this route answered a 404, on the same mistyped url.
  if (!isUuid(id)) notFound();
```

`src/lib/ids.ts` L25–34 is the module; `tests/unit/ids.test.ts` **walks every `[id]` route** and proves each one calls it, so `/businesses/[id]` is red until it does. `ids.ts` L20–23 also records why the module carries no client directive.

🔴 **An unknown id and a foreign id are the same answer** (L61–66): `notFound()` for both; no ownership check in the file, because RLS already settled it.

---

### `src/components/app-shell/app-sidebar.tsx` + `mobile-tab-bar.tsx` — **MODIFIED** (3 → 6 destinations)

**Analog:** themselves. The nav is defined **once** and consumed by both breakpoints (`app-sidebar.tsx` L49–87):

```tsx
export type NavItem = {
  href: string;
  base: string;      // the path prefix that makes this row the active one
  label: string;
  Icon: LucideIcon;
  iconName: string;  // rendered as data-icon so a probe can assert the shipped glyph
  testId: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/presets', base: '/presets', label: NAV.presets, Icon: ListChecks, iconName: 'list-checks', testId: 'nav-presets' },
  ...
];

/** `/presets` and `/presets/abc` both light Presets; `/presetsomething` does not. */
export function isNavActive(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}
```

The Phase 3 change is to split this one array into the two groups UI-SPEC § 0 fixes (`Leads` = Presets · Review · Businesses; `Operations` = Sources · Spend · Settings) while keeping **one definition** — the sidebar renders both groups with a `Separator` and eyebrows, the tab bar renders `Leads` + a `More` button, the More sheet renders `Operations`.

**Row geometry to preserve** (L125–133): `h-11` (44px), `rounded-lg`, `px-4`, `size-5` icon, `gap-2`, `text-base font-normal`, the 2px accent bar as `absolute inset-y-1 left-0 w-0.5 bg-primary`.

**Tab geometry** (`mobile-tab-bar.tsx` L31–35, L45–57): `grid grid-cols-3` → **`grid-cols-4`**, `h-16 min-h-11 min-w-11`, `pb-[env(safe-area-inset-bottom)] sm:hidden`, `size-6` icon over a `text-sm font-normal` label. L13–16: **never icon-only** — the label is the accessible-name fallback and there is no visually-hidden stand-in anywhere in that file.

**`more-sheet.tsx` analog:** `src/components/app-shell/top-bar.tsx` L26–41 — the tablet off-canvas already does `Sheet` + `SheetTrigger` + `SheetContent` + `SheetHeader`/`SheetTitle` around the **same** `SidebarNav`. Copy that composition with `side="bottom"`, `data-testid="more-sheet"`, title "More".

🔴 **This nav change breaks `tests/e2e/touch-targets.spec.ts` and it must be fixed in the same task** (UI-SPEC Executor Rule 21). The spec asserts exactly one *visible* element per nav testid (L30–33, L68–70):

```typescript
async function expectTargetAtLeast44(page: Page, testId: string) {
  const control = page.locator(`[data-testid="${testId}"]:visible`);
  await expect(control, `${testId} should have exactly one visible match`).toHaveCount(1);
  ...
}
  for (const testId of ['nav-presets', 'nav-spend', 'nav-settings', 'user-menu']) {
    await expectTargetAtLeast44(page, testId);
  }
```

With `nav-spend`/`nav-settings` inside a closed `Sheet` that count is **0**. The fix pattern is already in the file (L72–77): open the surface first, then measure — exactly what it does for `theme-switch` inside the user menu.

Also copy the poll-don't-sample rule (L35–53): a bounding box read mid-Radix-transform reported 43.07px for a control that is exactly 44.

---

### `src/components/review/review-actions.tsx` and `business-detail/unmerge-dialog.tsx` (component, client)

**Analog:** `src/components/preset-detail/duplicate-dialog.tsx` — *exact*, including the desk/phone `Dialog`-vs-`Drawer` split the unmerge confirmation needs.

**Imports and the desk/phone switch** (L1–31):

```tsx
'use client';
import { useCallback, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, ... } from '@/components/ui/dialog';
import { Drawer, DrawerContent, ... } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { duplicatePreset } from '@/server/actions/duplicate-preset';
import { useIsDesk } from './run-drawer';
```

`useIsDesk()` lives in `src/components/preset-detail/run-drawer.tsx` L43–49 (`matchMedia('(min-width: 640px)')` + `useSyncExternalStore`) — import it, do not write a second one.

**The action call** (L92–111) — this is the review decision path verbatim:

```tsx
  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await duplicatePreset({ ... });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast(`Preset duplicated as “${trimmed}”`);
      setOpen(false);
      router.push(`/presets/${result.data.searchId}`);
    });
  }, [defaultName, fromVersionId, name, router]);
```

🔴 **No `<form action>`** (L49–51 and `run-drawer.tsx` L22–25): React resets a form even when the action **failed**, and a Radix control driven by that reset walks its state backwards. `onClick` inside `useTransition`, always.

🔴 **Toast on success only; a refusal is a persistent `Alert`** (`run-drawer.tsx` L16–20): "a toast that has been dismissed is indistinguishable from one that never fired." UI-SPEC Executor Rule 20 goes further for `/review`: **never advance the queue before the decision is recorded** — the pressed button enters the busy state and the pair advances only on a successful write.

🔴 **No `motion` wrapper on the dialog/drawer** (`run-drawer.tsx` L27–29): vaul and Radix own those animations. `motion` appears on `/review` only for the 150ms queue advance (UI-SPEC § Motion).

---

### `src/components/business-detail/merge-history.tsx` (component)

**Analog:** `src/components/preset-detail/version-history.tsx` L45–65 — a history list whose rows each carry a consequential named action, with a per-row props type and a shared context object:

```tsx
export type HistoryVersion = {
  id: string;
  version: number;
  isCurrent: boolean;
  clauses: string[];          // already resolved to display names, server-side
  usedByRuns: number;
  createdAt: Date;
  costRange: string | null;
};

/** Everything the two row dialogs need that is the same for every row. Passed once rather
 *  than repeated on each `HistoryVersion`, so "which preset am I duplicating" cannot end
 *  up answered differently on two rows of the same table. */
export type HistoryContext = { presetName: string; ... };
```

→ `MergeRow { mergeId, loserName, winnerName, reason: 'auto'|'review', score, actor, mergedAt, undoneAt, undoneBy }` + `MergeContext { businessName, businessId }`. The "Unmerge {loser}" text button per row is the analog of this file's per-row Duplicate; UI-SPEC § 4 requires it be named ("on a screen of near-identical rows the consequential choice is the unambiguous one").

---

### `src/lib/ui/copy.ts` — **MODIFIED**

**Analog:** itself L1–41. Every string in 03-UI-SPEC § Copy Table lands here (Executor Rule 5).

🔴 **No client-boundary directive in this file, and the comment must not spell it** (L5–8, and `run-tone.ts` L4–16): a client module's exports become client *references* inside a server component — plain data objects included — and arrive `undefined` at runtime with `tsc`, `eslint` and `next build` all green. Two recorded BIS 500s.

```typescript
/** UI-SPEC § Copy Table → Shell. */
export const NAV = { presets: 'Presets', spend: 'Spend', settings: 'Settings' } as const;
```

→ extend with `review`, `businesses`, `sources`, `more`, plus the group eyebrows.

**Dates and money never formatted here** (L21–24): `America/Chicago` appears as prose only; every formatting call site resolves its zone from `src/lib/time.ts`, the only file in `src/` that names a zone for a machine. UI-SPEC Executor Rule 26 restates this for Phase 3 and adds the `libphonenumber-js` display formatter.

**Tone map to extend, not duplicate** — `src/lib/ui/run-tone.ts` L31–61. `ingest_runs.status` is `('running','complete','stopped','failed')`; `RUN_TONE`/`RUN_LABEL` already map five of the six run statuses and L24–30 records the invariant: "a seventh status in the database with no tone here renders as `undefined` — an unstyled badge with no word in it — so this union and that constraint move together."

---

### `src/lib/export/registry.ts` and `public-business.ts` — **MODIFIED**

**Analog:** themselves. `name_norm`, `street_norm`, `phone_blockable` and every other new internal column must be visible to the sentinel.

`public-business.ts` L26–41 is where the decision is forced:

```typescript
export type BusinessLike = {
  id: string; orgId: string;
  legalName: string | null;
  displayName: string;
  /** THE INTERNAL ONE. Never in an export row, never in a push payload. */
  internalNotes: string | null;
  phoneE164: string | null; city: string | null; status: string;
};
export type PublicBusiness = Omit<BusinessLike, 'internalNotes'>;
```

and `no-internal-leak.test.ts` L36–48 is the mechanism that makes forgetting impossible:

```typescript
    // What a builder is actually handed. Written out field by field rather than
    // destructured on purpose: when a column is added to BusinessLike this object stops
    // compiling, and somebody has to decide public-or-internal instead of inheriting a
    // spread. Excess-property checking rejects internalNotes here.
    const publicBusiness: PublicBusiness = { id: fixture.id, orgId: fixture.orgId, ... };
```

🔴 Adding `nameNorm` to `BusinessLike` breaks this object **and** `businessLikeBridge` in `businesses.ts` until both are updated — which is the intended failure. UI-SPEC Executor Rule 17: `name_norm` appears in no component, no table cell, no tooltip, no `data-` attribute.

The second half (L77–94) enumerates the directory so an unregistered builder module is red. Unchanged by this phase, but do not break it.

---

### `tests/db/*.test.ts` (test, db)

**Analog:** `tests/db/retention.test.ts` — the three new "cites durable" tests are literally this file's L79–110, three times over, with the constraint name swapped.

**The refusal + its positive control:**

```typescript
  it('durable cites durable: a durable field citing an ephemeral source is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const src = await c.query<{ id: string }>(INSERT_SOURCE_TTL, [a, 'google_places', 'ephemeral']);
      const sourceId = src.rows[0]?.id;
      expect(sourceId).toBeTruthy();
      const attempt = c.query(INSERT_BUSINESS_CITING, [a, 'Alpha Roofing', sourceId]);
      await expect(attempt).rejects.toMatchObject({
        code: '23503',
        constraint: 'businesses_phone_src_fk',
      });
    }));

  it('positive control: a durable field citing a durable source is accepted', () =>
    withRollback(async (c) => {
      ...
      // A refusal test with no positive control passes when everything is broken.
      const ok = await c.query(INSERT_BUSINESS_CITING, [a, 'Alpha Roofing', sourceId]);
      expect(ok.rowCount).toBe(1);
    }));
```

**The header block is part of the pattern** (L1–21): it names the mutation, names which single test must go red, and states "one refused statement per `withRollback`: a refusal aborts the transaction and the next statement reports `25P02` instead of its own reason."

**Index-shape assertion** (L112–121) — the template for `tests/db/extensions.test.ts` and for every new blocking index:

```typescript
      const { rows } = await c.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'source_records' and indexname = 'sr_expiry'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/where \(expires_at IS NOT NULL\)/i);
```

**Fixtures** — `tests/db/_fixtures.ts` L27–48 (`withRollback`, refuses a Supabase `TEST_DATABASE_URL`), L65–68 (`actAs`, transaction-local `set_config`), L80–88 (`actAsRole`, allow-listed because `set role` takes no bound parameter), L103–114 (`seedTwoOrgs`, inserts as the **owner** because `orgs` has no insert policy). `tests/db/_ingest-fixtures.ts` composes on top of these — **tens of rows, never thousands** (RESEARCH L1682, L1779).

**The RLS refusal matrix, verbatim from `_fixtures.ts` L18–25** — get this wrong and a test is green for the wrong reason:

```
 *     select                              -> own rows only, no error
 *     update                              -> rowCount 0, no error
 *     delete                              -> rowCount 0, no error
 *     insert carrying a foreign org_id    -> 42501 "new row violates row-level security policy"
 *     update that MOVES org_id            -> 42501 (WITH CHECK)
```

**Positive control FIRST when a mutation must red one named test** — `tests/db/reference-rows.test.ts` L81–85:

```typescript
      // POSITIVE CONTROL FIRST, deliberately. ... It runs first so that the targeted
      // mutation below reds the built-in assertion specifically — the control has already
      // executed and passed by then, instead of being skipped by the failure.
```

Criterion 5's test (RESEARCH L1191–1214) is exactly this shape: assert `rows.length > 20` before asserting zero Mexican rows.

**The two lists that must be widened, and where** —

`tests/db/grants-audit.test.ts` L34–58 (16 entries today → 21):

```typescript
const TENANT_TABLES = [
  'orgs', 'businesses', 'source_records', 'events',
  // Phase 2 plan 03. Six reference tables ... Every one of them grants its own DML in
  // drizzle/0013 — since migration 0008 a new table inherits nothing ...
  'industry_clusters', 'industry_terms', 'counties', 'cities', 'geo_presets', 'outlet_counts',
  'searches', 'search_versions', 'runs',
  'budget_periods', 'cost_reservations', 'cost_ledger',
];
```

Test 1 asserts this array equals the live catalog, so *forgetting* is red rather than silently unguarded. The privilege matrix (L67–84) then checks `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` absent on every one.

`tests/db/event-trigger.test.ts` L52–75 — add `business_merges`, and bump the trigger-row count:

```typescript
const EVENT_LOGGED = new Set(['orgs', 'businesses', 'searches', 'search_versions', 'budget_periods']);
const LOG_EVENT_TRIGGER_ROWS = 6;   // 5 tables, 6 triggers
```

L193–212 asserts set equality **both directions** *and* `tgenabled` — "PRESENT is not FIRING": `alter table businesses disable trigger businesses_event` leaves the `pg_trigger` row where it was with `tgenabled = 'D'`.

---

### `tests/unit/*.test.ts` + msw fixtures

**Analog:** `tests/unit/census.test.ts` + `tests/unit/msw/server.ts` — *exact*, and the harness is explicitly designed to be reused: "the same harness is what Places and Firecrawl will use in Phase 4" (`server.ts` L9–10).

**The no-network guard lives in one place** (`server.ts` L4–7, L107–113):

```typescript
/** Start the replay server. 🔴 The `onUnhandledRequest` setting lives here, once, so it
 *  cannot be relaxed per test file. */
export function startCensusServer(): void {
  server.listen({ onUnhandledRequest: 'error' });
}
```

**Dispatch by a value read OUT of the fixture, never a restated string** (L12–15, L34–46):

```typescript
export const RECORDED_ADDRESS = {
  mcallen: mcallen.result.input.address.address,
  ...
} as const;
```

— "a substring rule would be worse than wrong: the no-match fixture was recorded for 'Joe's Taqueria, McAllen, TX', so any rule that keys on 'mcallen' would serve it the McAllen hit and the no-match test would prove nothing." The Socrata handlers must dispatch on the recorded `$where`, not on a hand-typed predicate.

**An envelope fixture is checked at load** (L48–59) — the pattern for the `socrata-400-type-mismatch.json` fixture, which is a status+body envelope and not a 200 payload.

**One-shot failure injection, reset in `afterEach`** (L65–85) — needed for the Socrata 400 and the Census batch retry tests.

**Test file harness** (`census.test.ts` L33–48): `beforeAll(startCensusServer)`, `afterEach(server.resetHandlers + resetCensus)`, `afterAll(server.close)`, and a load-time guard that the fixture carries what the test will read.

---

### `tests/e2e/review.spec.ts` · `sources.spec.ts` · `businesses.spec.ts`

**Analog:** `tests/e2e/preset-detail.spec.ts` — read it for both the pattern **and** the trap.

**Assert on `data-testid` and numbers, never on copy** (L7–12):

```
 * 🔴 ASSERTS ON `data-testid` AND ON NUMBERS, NEVER ON COPY. Every sentence this screen
 * renders lives in `src/lib/ui/copy.ts` ... Where a count matters the markup carries
 * `data-used-by-count`, so the test pins SRCH-03's real claim ... rather than the phrase.
```

03-UI-SPEC § Accessibility fixes 30+ testids (`review-action-same`, `sources-count-{sourceKey}-{added|changed|unchanged|gone}`, `business-field-{field}-source`, …). Follow the `data-*` attribute precedent for the numbers: `data-score`, `data-remaining`.

🔴 **The two-databases trap, and the decided remedy** (L36–45):

```
 * 🔴 THE FIXTURE AND THE APP MUST BE THE SAME DATABASE, AND THEY ONLY ARE WHEN THE TARGET
 * IS LOCAL. ... `withDb()` opens `TEST_DATABASE_URL` — always the LOCAL `siteless_test` —
 * while `tenantId()` reads the org id out of the app that `E2E_BASE_URL` points at.
 * Against a DEPLOYED url they are two different databases.
```

The guard is a `TARGET_IS_LOCAL` self-skip; the alternative CONTEXT names is to seed **through the product**, which for `/review` and `/businesses` is impossible in Phase 3 (the ingest is a desk script). So: self-skip, prefixed rows, teardown in FK order (L22–27), and the `presets.spec.ts` teardown debt is owed here too (03-CONTEXT § Deferred).

---

## Shared Patterns

### Tenancy — every new table, four obligations in one migration

**Source:** `src/db/schema/_helpers.ts` L11–68 + `drizzle/0013` L25–47 + `tests/db/grants-audit.test.ts` L34–58
**Apply to:** all five new tables

1. `...orgScoped` (or `...orgScopedNullable` for the category map) — `_helpers.ts` L12–38
2. `index('<t>_org_idx').on(t.orgId)` — "an RLS predicate on `org_id` gets no index for free"
3. `...orgPolicies('<t>')` / `...referencePolicies('<t>')` — auto-enables RLS; never also call `.enableRLS()`
4. An explicit `grant` in the **creating** migration + a row in `TENANT_TABLES`

```typescript
export const orgScoped = {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
};

const CURRENT_ORG = sql`(select app.current_org_id())`;  // InitPlan once per statement, not per row
```

### Auth — one entry point, one guard, first statement

**Source:** `src/lib/auth/require-org.ts` L16–38 · `src/db/with-org.ts` L54–64
**Apply to:** every page under `(app)` and every server action

```typescript
export async function requireOrg() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/no-access?reason=none');
  return { userId, orgId, orgSlug: orgSlug ?? null };
}

export async function withOrg<T>(claims: OrgClaims, fn: (tx) => Promise<T>): Promise<T> {
  if (!ROLES.has(claims.role)) throw new Error('withOrg: refusing role ' + claims.role);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql.raw('set local role ' + claims.role));   // safe: allow-listed above
    return fn(tx);
  });
}
```

🔴 Claims are a **bound parameter**, never interpolated. The `true` is the transaction-LOCAL form — the non-local form survives the COMMIT and hands the next request the previous tenant's claims on a transaction-mode pooler. Both pinned by `tests/db/with-org.test.ts`.

🔴 Use `orgClaims()` (L32–38), not a hand-built claims object, on any path that may reach a role-gated definer — `duplicate-preset.ts` L45 builds its own and therefore carries **no `org_role`**; that omission was a real, verified 42501 on the cap edit (`with-org.ts` L11–19).

### Error handling — expected refusals are results

**Source:** `src/server/actions/_result.ts` L20–68 · `_pg.ts` L33–71
**Apply to:** both new server actions

```typescript
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; detail?: Record<string, string | number> };
```

Only a genuine bug throws; a thrown action is a 500 the UI has no copy for. Every message comes from `src/lib/ui/copy.ts`.

### Audit — one run-level event, never one per row

**Source:** `drizzle/0011_events_no_caller_insert.sql` L31–57 · CONVENTIONS § Audit L183–220

```sql
create or replace function app.emit_event(
  p_entity_type text, p_entity_id uuid, p_action text, p_after jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_org uuid;
begin
  v_org := app.current_org_id();
  if v_org is null then
    raise exception 'emit_event: no current org' using errcode = '42501';
  end if;
  insert into events (org_id, actor_id, entity_type, entity_id, action, after)
  values (v_org,
    coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system'),
    p_entity_type, p_entity_id, p_action, p_after)
  returning id into v_id;
  return v_id;
end $$;
```

`authenticated` holds **no INSERT on `events`** (L61). Every writer is a definer and neither `org_id` nor `actor_id` is a parameter.

🔴 The trap CONVENTIONS did not anticipate (RESEARCH L1041–1053): `businesses` **is** in `EVENT_LOGGED`, and this phase writes ~92k rows. The `payload_hash` diff must gate the `businesses` write as well as the `source_records` write, and the DATA-04 test ("a second identical ingest writes zero `businesses` rows and zero new `events` rows") is simultaneously the idempotency proof and the event-volume guard.

### Drizzle traps — the four this phase will hit

**Sources:** `duplicate-preset.ts` L76–101 · `preset-cards.ts` L72–98 and L140–149 · `_pg.ts` L4–10
**Apply to:** every `tx.execute` in `src/server/**`, `src/lib/resolve/**` and the ingest scripts

| Trap | Symptom | Fix |
|---|---|---|
| JS array in a `sql` template → N placeholders | `42846 cannot cast type record to uuid[]` (2+) / `22P02 malformed array literal` (1) | bind one array-literal string + one cast, or `sql.join(xs, sql\`, \`)` |
| `Date` bound through `tx.execute` with `prepare:false` | `TypeError: The "string" argument must be of type string … Received an instance of Date` | bind `d.toISOString()` with an explicit `::timestamptz` |
| `timestamptz` read back as a string | `RangeError: Invalid time value` inside `Intl`, 500 on the page, every gate green | `instantOf()` / `requireInstant()` — parse as-is, with its space; never ISO-ify |
| SQLSTATE not on the caught error | every expected refusal becomes `unexpected` | `pgFailure(err)` walks the `cause` chain; match code **and** constraint name |

### Time

**Source:** CONVENTIONS § Time L269–284 · `preset-cards.ts` L133–138 · `src/lib/time.ts`

Every timestamp is `tstz(...)`. Day buckets are `at time zone 'America/Chicago'` in SQL and `APP_TZ` in TS. Tests run `TZ=UTC` with the locale pinned, and assert **one instant in two zones with opposite verdicts**. Compare in SQL (`extract(epoch from …)`), never as round-tripped JS `Date`s. `now()` is `transaction_timestamp()` — constant for a whole `withRollback`.

Phase 3 addition (RESEARCH L1439): Socrata's `out_of_business_date` arrives as `"1993-03-03T00:00:00.000"` with **no zone suffix**. Interpret it in `America/Chicago`, never as UTC.

### Naming — three fields, never interchangeable

**Source:** CONVENTIONS § Naming L225–244 · `public-business.ts` L1–23
**Apply to:** the review queue, the business list, the business detail, every export

`display_name` renders verbatim (an `ñ` is the business's own name). `legal_name` is the Comptroller DBA and is never on a card. `internal_notes` never renders on any screen in this phase. `name_norm` renders nowhere, ever, and registers with the leak sentinel.

### UI — the five executor rules Phase 3 will actually trip

**Source:** 03-UI-SPEC § Executor Rules + the files that record each defect

1. `[var(--x)]`, never `[--x]` — Tailwind v4 dropped the shorthand and emits invalid CSS silently.
2. Painted values, never CSS custom properties, for anything a test pins.
3. Copy constants and tone maps stay in server-safe modules — `src/lib/ui/copy.ts`, `src/lib/ui/run-tone.ts`, neither carrying the client directive (`run-tone.ts` L4–16).
4. No hand-rolled surfaces — grep `bg-card`, `rounded-`, `border border-` on raw `div`s before calling a screen done. `app-sidebar.tsx` L13–25 is the one argued exception in the tree (CSS-breakpoint chrome over the sidebar **surface tokens**), and it explains itself at length.
5. Source tags are text; badges are state (UI-SPEC Rule 22). `Badge variant="secondary"` for agreement chips, `variant="outline"` for disagreement, plain `text-sm text-muted-foreground` for source tags.

---

## No Analog Found

Eight shapes the planner must budget for as genuinely new work. RESEARCH already carries measured code for the first four.

| File | Role | Data Flow | Reason | Where to get the shape instead |
|---|---|---|---|---|
| `src/lib/resolve/block.ts` | service | batch (SQL generation) | Nothing in the tree generates blocking SQL, and the naive form is a **269 s** trap the codebase has no memory of | RESEARCH § The shape that works (L273–298), § Measured blocking-key comparison (L300–316), § Code Examples (L1457–1480) |
| `scripts/ingest-overture.ts` | script | streaming | No DuckDB, no native binary, no S3 range-read anywhere in the repo; `@duckdb/node-api` is not yet a dependency | RESEARCH § Exact path form and the bbox range-read (L430–500) — verified Parquet schema, the `.items` trap, `threads:'4'/memory_limit:'6GB'` |
| `drizzle/00NN_extensions.sql` + `app.distance_m()` | migration | — | **`plpgsql` is the only installed extension today** (RESEARCH L181); there is no `create extension` migration and no SQL distance function to copy | RESEARCH § Path B (L198–234), incl. the `tests/db/extensions.test.ts` version pin |
| `src/lib/ids/external-key.ts` | utility | transform | `src/lib/ids.ts` is a *validator*, not a generator; nothing in the tree generates a human-readable key or retries on conflict | RESEARCH § The External Lead Key (L917–984) — the Crockford alphabet, why `b % 32` is uniform, the shape CHECK, the ON CONFLICT retry |
| `src/lib/normalize/{name,phone,address}.ts` | utility | transform | No text-normalization module exists; `libphonenumber-js` is not yet a dependency | RESEARCH § The Normalization Module (L658–777) — incl. the measured `42P17` that settles TS-is-authoritative, and the toll-free `blockable:false` flag |
| `src/components/sources/confidence-distribution.tsx` | component | — | No composed bar-chart surface exists; `budget-gauge.tsx` is a single `Progress`, not a banded distribution | 03-UI-SPEC § 2 — `Collapsible` + `Progress` + painted divs, **no chart library** (Executor Rule 24) |
| `docs/runbooks/ingest.md` | doc | — | `docs/` holds `local-postgres.md` only; there is no runbook precedent in this repo | BIS's `docs/runbooks/clerk-setup.md` is the house shape if one is wanted; otherwise RESEARCH § Wave 0 Gaps L1786 states the contents (desk procedure, ~20-minute wall clock, the numbers the run must report) |
| `.vercelignore` | config | — | Does not exist; Phase 2 debt (`coverage/*.ts` is gitignored but the Vercel CLI uploads it and `next build` type-checks it) | One line: `coverage/` |

**Partial-only matches worth flagging to the planner** (an analog exists but covers less than half the work):

- `src/lib/resolve/merge.ts` — `duplicate-preset.ts` supplies the multi-statement `withOrg` transaction shape, but nothing in the tree does a **survivorship snapshot + alias move + `decision='distinct'` write + `emit_event`** as one unit, nor the `coalesce(merged_into_id, id)` re-point that Pitfall 12 requires.
- `scripts/resolve.ts` — `seed.ts` supplies the owner connection, the target gate and the tally; the block→score→merge orchestration and the per-block size cap (RESEARCH L315) are new.
- `tests/unit/fixtures/merge-pairs.json` — `tests/unit/fixtures/preset.ts` is a factory, not a pinned-expectation table. The ten-pair fixture with exact expected scores has no precedent; `tests/unit/outlet-counts.test.ts` (which pins committed totals as a drift alarm) is the nearest idea.

---

## Metadata

**Analog search scope:** `src/db/schema/`, `src/db/`, `src/lib/`, `src/server/`, `src/app/(app)/`, `src/components/`, `src/seed/`, `scripts/`, `drizzle/`, `tests/db/`, `tests/unit/`, `tests/e2e/`, `package.json`, `.planning/CONVENTIONS.md`
**Files scanned:** 214 tracked source files enumerated; 34 opened and mined
**Repo state at mapping:** `1105d9d docs(03): phase research and validation strategy`
**Pattern extraction date:** 2026-09-22
