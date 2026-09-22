import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { orgs } from './orgs';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * A saved search preset. `org_id` is NOT NULL here — unlike the reference tables, a preset
 * always belongs to exactly one tenant; there is no such thing as a built-in search.
 *
 * CONVENTIONS § Naming: `name_internal` is the operator's label and `display_name` is what
 * a screen shows. They are never interchangeable. BIS's single `accounts.name` was the
 * agency's internal label and reached customers three times, which is the entire reason
 * these are two columns on every table that has a name.
 *
 * `current_version_id` is deliberately declared WITHOUT `.references()` in TypeScript. The
 * pair is circular — `search_versions.search_id -> searches.id` and
 * `searches.current_version_id -> search_versions.id` — and drizzle-kit cannot order
 * circular DDL. The FK is added by hand in drizzle/0013, with `on delete set null`: losing
 * a pointer to the current version must not delete the search.
 */
export const searches = pgTable(
  'searches',
  {
    ...orgScoped,
    nameInternal: text('name_internal').notNull(),
    displayName: text('display_name').notNull(),
    currentVersionId: uuid('current_version_id'),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    index('searches_org_idx').on(t.orgId),
    check('searches_status_known', sql`status in ('active','archived')`),
    ...orgPolicies('searches'),
  ],
);

/**
 * An immutable snapshot of what a search MEANT at one point in time. This table is the
 * whole of SRCH-03: "a past run still points at the version that produced it" is true
 * because of an FK and a revoked grant, and nothing above the database can undo it.
 *
 * APPEND-ONLY, exactly like `events`, and for the same reason and by the same mechanism:
 * `grant select, insert` + `revoke update, delete` in drizzle/0013. **Immutability is a
 * GRANT, not a policy.** A policy-only approach is a silent zero-row filter that reads as
 * "nothing matched"; the grant refusal is `42501 permission denied for table
 * search_versions`, which cannot be mistaken for an empty result. Pin the message, not
 * only the code.
 *
 * There is therefore NO `updated_at` and NO `updated_by` — nothing updates this row — and
 * no `app.touch_updated_at` trigger. `created_at` / `created_by` are spelled out rather
 * than spread from `orgScoped`, which would have brought the update columns with them.
 *
 * `unique (search_id, version)` is doing double duty: it enforces the version sequence AND
 * it is the optimistic-concurrency lock the UI relies on. The edit form carries the
 * version it was loaded from and inserts `loaded + 1`; if somebody else saved first, the
 * constraint raises `23505` and the UI shows its save-conflict copy. That is optimistic
 * concurrency for free, with no advisory lock and no extra column.
 *
 * `geo_kind` / `geo_payload` mirror `geo_presets.kind` / `payload` rather than pointing at
 * a preset row: a preset a tenant later edits must not retroactively change what a
 * finished run searched for.
 */
export const searchVersions = pgTable(
  'search_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    searchId: uuid('search_id')
      .notNull()
      .references(() => searches.id),
    version: integer('version').notNull(),
    clusterIds: uuid('cluster_ids').array().notNull(),
    geoKind: text('geo_kind').notNull(),
    geoPayload: jsonb('geo_payload').notNull(),
    // What the estimator quoted when this version was saved, so the spend view can show
    // estimate-vs-actual for a past run without re-deriving a price table that has moved.
    estimateSnapshot: jsonb('estimate_snapshot'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  // Select and insert only, declared inline rather than via orgPolicies(): this table has
  // no legitimate UPDATE or DELETE path. The policies are the second layer — the grant
  // layer in drizzle/0013 refuses first — and they are kept so that a later migration
  // re-granting UPDATE would still find the statement scoped rather than unscoped.
  (t) => [
    index('search_versions_org_idx').on(t.orgId),
    unique('search_versions_search_version_uniq').on(t.searchId, t.version),
    check('sv_geo_kind_known', sql`geo_kind in ('cities','counties','radius')`),
    pgPolicy('search_versions_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`org_id = (select app.current_org_id())`,
    }),
    pgPolicy('search_versions_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`org_id = (select app.current_org_id())`,
    }),
  ],
);
