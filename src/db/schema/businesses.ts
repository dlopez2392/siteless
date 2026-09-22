import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { BusinessLike } from '@/lib/export/public-business';
import { orgPolicies, orgScoped } from './_helpers';

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
    // FOUND-05 provenance pairs. The `_src_ret` twin is GENERATED ALWAYS AS ('durable')
    // STORED, so the composite FK added in migration 0006 can only resolve against a
    // source record whose retention_class is 'durable'. A field whose only source is a
    // Google payload cannot be set at all — the column stays NULL and the UI says
    // "not stored" rather than the row quietly becoming durable Google content.
    legalNameSourceId: uuid('legal_name_source_id'),
    legalNameSrcRet: text('legal_name_src_ret').generatedAlwaysAs(sql`'durable'`),
    displayNameSourceId: uuid('display_name_source_id'),
    displayNameSrcRet: text('display_name_src_ret').generatedAlwaysAs(sql`'durable'`),
    phoneSourceId: uuid('phone_source_id'),
    phoneSrcRet: text('phone_src_ret').generatedAlwaysAs(sql`'durable'`),
  },
  // The index is not optional: an RLS predicate on org_id gets no index for free
  // (RESEARCH Pitfall 5). Adding any policy auto-enables RLS in drizzle-orm 0.45.2 — do
  // not also call .enableRLS(), and .withRLS() does not exist in this version.
  (t) => [index('businesses_org_idx').on(t.orgId), ...orgPolicies('businesses')],
);

/**
 * Compile-time bridge. tests/unit/no-internal-leak.test.ts scans a structural fixture
 * rather than the Drizzle row, so that the sentinel stays a pure unit test with no
 * database in its import graph. This assertion is what stops the two drifting: rename a
 * column here and tsc fails, instead of the sentinel quietly scanning a stale shape.
 */
type BusinessLikeIsSubset =
  BusinessLike extends Pick<typeof businesses.$inferSelect, keyof BusinessLike> ? true : never;
export const businessLikeBridge: BusinessLikeIsSubset = true;
