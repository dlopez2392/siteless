import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { BusinessLike } from '@/lib/export/public-business';
import { orgPolicies, orgScoped, tstz } from './_helpers';

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

    // ---- Phase 3 plan 05: the spine. ADDED only; nothing above is renamed. ----

    // 'taxpayer_number-outlet_number'. NULL on an Overture-only row.
    comptrollerKey: text('comptroller_key'),
    // 'tx_comptroller' | 'overture' — which source created the row; the blocker's driver.
    primarySource: text('primary_source'),
    // D-19: SL-XXXXXX, Crockford base32. Unique PER ORG and shape-checked in drizzle/0023.
    // 🔴 Never a foreign key and never a route parameter — the uuid `id` is both (T-3-13).
    externalKey: text('external_key').notNull(),
    // 🔴 INTERNAL (D-12). The normalized match key: never displayed, never exported, never in
    // a push payload. `display_name` is the only name that leaves the building.
    nameNorm: text('name_norm'),
    street: text('street'),
    streetNum: text('street_num'),
    // 🔴 INTERNAL, for the same reason as name_norm.
    streetNorm: text('street_norm'),
    // The suite, stripped from the match key and KEPT here so the address still reads right.
    unit: text('unit'),
    postal: text('postal'), // ZIP5
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    // 'overture' | 'census_exact' | 'census_non_exact'
    locationMatchType: text('location_match_type'),
    // False for a toll-free NPA: blocking on one produced a 215-row block (RESEARCH B1).
    phoneBlockable: boolean('phone_blockable').notNull().default(false),
    basicCategory: text('basic_category'),
    clusterKey: text('cluster_key'),
    confidence: doublePrecision('confidence'),
    // Overture's 'permanently_closed' lives HERE and never writes closed_at. Only a
    // Comptroller closure is evidence enough to close a business.
    operatingStatus: text('operating_status'),
    // D-11: the name_norm itself, derived — no provenance pair.
    chainKey: text('chain_key'),
    closedAt: tstz('closed_at'),
    // NULL on a live row. Merges are rows (business_merges), never deletes.
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => businesses.id),
    // Three more FOUND-05 pairs, identical in shape to the three above. Their composite
    // FKs to source_records (id, retention_class) are in drizzle/0023. 🔴 location's is the
    // constraint that stops a Places sweep's ephemeral lat/lng becoming the durable
    // businesses.lat/lng in Phase 4 (T-3-06).
    addressSourceId: uuid('address_source_id'),
    addressSrcRet: text('address_src_ret').generatedAlwaysAs(sql`'durable'`),
    locationSourceId: uuid('location_source_id'),
    locationSrcRet: text('location_src_ret').generatedAlwaysAs(sql`'durable'`),
    closedAtSourceId: uuid('closed_at_source_id'),
    closedAtSrcRet: text('closed_at_src_ret').generatedAlwaysAs(sql`'durable'`),
  },
  // The index is not optional: an RLS predicate on org_id gets no index for free
  // (RESEARCH Pitfall 5). Adding any policy auto-enables RLS in drizzle-orm 0.45.2 — do
  // not also call the RLS-enabling builder methods, which do not exist in this version
  // anyway. The blocking and lookup indexes (GIN trigram, phone, address, chain, merged,
  // comptroller key, external key) are hand-written in drizzle/0023: partial indexes and
  // an operator class are the half drizzle-kit does not emit faithfully.
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
