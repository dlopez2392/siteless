import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * Where the Google Maps Platform Terms live in the schema.
 *
 * Places responses may not become the durable record: place_id is the only field exempt
 * from the caching restriction, lat/lng may be cached for 30 consecutive days, and
 * everything else must go. retention_class turns that from a convention somebody forgets
 * in month four into an invariant the database refuses to break. The constraints that
 * enforce it arrive in migration 0006.
 *
 * The policies and the org_id index ship WITH the table, not later: the D-10 enumeration
 * (tests/db/schema-audit.test.ts) is already green and must stay green, so a table can
 * never exist un-scoped even for one commit.
 */
export const sourceRecords = pgTable(
  'source_records',
  {
    ...orgScoped,
    sourceKey: text('source_key').notNull(),
    externalId: text('external_id'),
    businessId: uuid('business_id').references(() => businesses.id),
    payload: jsonb('payload'),
    payloadHash: text('payload_hash'),
    retentionClass: text('retention_class').notNull(),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at'),
  },
  (t) => [
    index('source_records_org_idx').on(t.orgId),
    check(
      'sr_source_key_known',
      sql`source_key in ('overture','tx_comptroller','osm','county_dba','google_places','firecrawl','http_probe','dns_probe','manual')`,
    ),
    check('sr_retention_class_known', sql`retention_class in ('durable','ephemeral')`),
    ...orgPolicies('source_records'),
  ],
);
