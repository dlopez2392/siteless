import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { orgScoped } from './_helpers';

// FOUND-04's three-name rule is a column layout, not a convention. BIS's single
// `accounts.name` reached customers three times.
export const businesses = pgTable(
  'businesses',
  {
    ...orgScoped,
    legalName: text('legal_name'), // Comptroller DBA, often mistyped
    displayName: text('display_name').notNull(), // what the triage card shows
    internalNotes: text('internal_notes'), // operator annotation — never in an export or push
    phoneE164: text('phone_e164'),
    city: text('city'),
    status: text('status').notNull().default('active'),
  },
  // Not optional: an RLS predicate on org_id gets no index for free (RESEARCH Pitfall 5).
  (t) => [index('businesses_org_idx').on(t.orgId)],
);
