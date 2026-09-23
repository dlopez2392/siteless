import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * D-19: on a merge the winner keeps its external key and the LOSER's key resolves to the
 * winner — an alias row, never a rewrite. Unmerge stamps `released_at` and the loser's key
 * is the loser's again.
 *
 * `businesses.merged_into_id` stays the source of truth; this table is the indexed lookup a
 * `SL-…` search hits. The partial unique index `business_aliases_key_uniq` (drizzle/0023) —
 * `(org_id, external_key) where released_at is null` — means one live alias per key.
 *
 * 🔴 `external_key` is a plain text column here, with NO `references(`. The external key is
 * never a foreign key anywhere in the schema (T-3-13); both joins below are to the uuid.
 *
 * Deliberately NO `app.log_event` trigger: every row is derived from a `business_merges`
 * row, which is logged. `authenticated` holds SELECT only (drizzle/0023).
 */
export const businessAliases = pgTable(
  'business_aliases',
  {
    ...orgScoped,
    externalKey: text('external_key').notNull(),
    // The winner the key now resolves to.
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    // The loser the key originally belonged to — where it returns on unmerge.
    sourceBusinessId: uuid('source_business_id')
      .notNull()
      .references(() => businesses.id),
    releasedAt: tstz('released_at'),
  },
  (t) => [
    index('business_aliases_org_idx').on(t.orgId),
    index('business_aliases_key_idx').on(t.orgId, t.externalKey),
    ...orgPolicies('business_aliases'),
  ],
);
