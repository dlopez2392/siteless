import { sql } from 'drizzle-orm';
import { pgPolicy, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { orgs } from './orgs';

/** timestamptz, no exceptions. mode:'date' returns a JS Date (one instant, no zone);
 *  mode:'string' hands back a session-zone-dependent string, which is how
 *  "it looked right locally" happens. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** D-01 + D-07. Spread into every org-scoped table. */
export const orgScoped = {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
};

/**
 * D-05. The reference variant: `org_id` is NULLABLE, and `org_id IS NULL` means
 * "built-in, shipped by the seed loader and shared by every tenant". Everything else is
 * identical to `orgScoped` — same id, same created_at/updated_at/updated_by — so the
 * D-10 enumeration in tests/db/schema-audit.test.ts still sees an `org_id` column and
 * `ALLOW_NO_ORG_ID` never has to be widened for a reference table.
 *
 * Use it only with `referencePolicies()`. Paired with `orgPolicies()` the built-ins
 * would be invisible to every tenant, which is the opposite of the point.
 */
export const orgScopedNullable = {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => orgs.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
};

/** Wrapped in (select ...) so Postgres runs it as an InitPlan once per statement
 *  instead of once per row. Unwrapped, app.current_org_id() is re-evaluated per row. */
const CURRENT_ORG = sql`(select app.current_org_id())`;

export function orgPolicies(t: string) {
  return [
    pgPolicy(`${t}_select`, {
      for: 'select',
      to: authenticatedRole,
      using: sql`org_id = ${CURRENT_ORG}`,
    }),
    pgPolicy(`${t}_insert`, {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`org_id = ${CURRENT_ORG}`,
    }),
    pgPolicy(`${t}_update`, {
      for: 'update',
      to: authenticatedRole,
      using: sql`org_id = ${CURRENT_ORG}`,
      withCheck: sql`org_id = ${CURRENT_ORG}`,
    }),
    pgPolicy(`${t}_delete`, {
      for: 'delete',
      to: authenticatedRole,
      using: sql`org_id = ${CURRENT_ORG}`,
    }),
  ];
}

/**
 * D-05. The NULL-org variant of `orgPolicies`. READ admits a built-in; every WRITE policy
 * excludes one. That asymmetry — and nothing else — is what makes a shared reference row
 * unmutatable by any tenant: a built-in is simply outside the scope of insert, update and
 * delete, so there is no row for a tenant's statement to reach.
 *
 * 🔴 Two things surprise every reader of this, both executed against PG 18.6 during
 * research and both load-bearing for the tests in plan 02-06:
 *
 * 1. A tenant's attempt to mutate a built-in is a SILENT ZERO-ROW FILTER, not a refusal.
 *    `update … where org_id is null` comes back `rowCount 0`; so does `delete`. Only an
 *    INSERT carrying `org_id = null` raises `42501 new row violates row-level security
 *    policy`. That is inherent to RLS — an invisible row cannot produce a targeted
 *    refusal — so the test asserts `rowCount === 0` for UPDATE/DELETE and pins `42501`
 *    for the forged INSERT alone.
 *
 * 2. A `BEFORE UPDATE OR DELETE` trigger CANNOT make that loud, and must not be added.
 *    RLS filters the row before the row trigger fires, so `authenticated` still saw
 *    `rowCount 0` — while the owner, who bypasses RLS but NOT triggers, was refused its
 *    own legitimate seed update. Verified locally; do not re-derive it.
 *
 * The companion guard is on the table, not here: `UNIQUE (org_id, key)` does NOT stop a
 * duplicate built-in, because `NULL != NULL` and a second `(null, 'home_services')`
 * inserts cleanly. Every reference table therefore spells `.nullsNotDistinct()`, which
 * refuses it with `23505` and is what makes the seed loader idempotent.
 */
export function referencePolicies(t: string) {
  const MINE = sql`org_id is not null and org_id = ${CURRENT_ORG}`;
  return [
    pgPolicy(`${t}_select`, {
      for: 'select',
      to: authenticatedRole,
      using: sql`org_id is null or org_id = ${CURRENT_ORG}`,
    }),
    pgPolicy(`${t}_insert`, {
      for: 'insert',
      to: authenticatedRole,
      withCheck: MINE,
    }),
    pgPolicy(`${t}_update`, {
      for: 'update',
      to: authenticatedRole,
      using: MINE,
      withCheck: MINE,
    }),
    pgPolicy(`${t}_delete`, {
      for: 'delete',
      to: authenticatedRole,
      using: MINE,
    }),
  ];
}
