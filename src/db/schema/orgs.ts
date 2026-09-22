import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

// Declared locally rather than imported from ./_helpers: _helpers imports `orgs` for the
// orgScoped foreign key, so importing back would be a module cycle.
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkOrgId: text('clerk_org_id').notNull().unique(),
    // name_internal is the operator's label ("BIS — dogfood"). BIS's single `accounts.name`
    // column leaked to customers three times; that is the entire reason this is two columns.
    nameInternal: text('name_internal').notNull(),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull().default('America/Chicago'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by'),
  },
  // Keyed on `id`, not org_id: this table IS the tenant root. No INSERT policy —
  // provisioning goes through the SECURITY DEFINER app.ensure_org, so `authenticated`
  // never holds blanket INSERT on the tenant root (T-1-23).
  () => [
    pgPolicy('orgs_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`id = (select app.current_org_id())`,
    }),
    pgPolicy('orgs_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`id = (select app.current_org_id())`,
      withCheck: sql`id = (select app.current_org_id())`,
    }),
  ],
);
