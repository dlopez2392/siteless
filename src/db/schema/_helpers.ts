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
