import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { orgScopedNullable, referencePolicies } from './_helpers';

/**
 * The four industry clusters the product is defined around — home services & trades,
 * food & hospitality, personal care & health, auto & retail — plus whatever a tenant adds
 * for itself.
 *
 * These are REFERENCE rows (D-05): the built-ins ship with `org_id IS NULL`, every tenant
 * reads them, and no tenant can edit one, because `referencePolicies()` excludes NULL-org
 * rows from all three write policies. A tenant's own cluster carries its `org_id` and
 * behaves exactly like any other tenant row.
 *
 * `.nullsNotDistinct()` is not decoration. `UNIQUE (org_id, key)` alone does not stop a
 * duplicate built-in — `NULL != NULL`, so a second `(null, 'home_services')` inserts
 * cleanly and the seed loader silently doubles every row on its second run.
 */
export const industryClusters = pgTable(
  'industry_clusters',
  {
    ...orgScopedNullable,
    // Stable machine key ('home_services'). What a preset and the seed loader match on.
    key: text('key').notNull(),
    // What a screen shows ("Home Services & Trades"). Never interchangeable with `key`.
    displayName: text('display_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    // An RLS predicate on org_id gets no index for free (CONVENTIONS § Tenancy).
    index('industry_clusters_org_idx').on(t.orgId),
    unique('industry_clusters_org_key_uniq').on(t.orgId, t.key).nullsNotDistinct(),
    ...referencePolicies('industry_clusters'),
  ],
);

/**
 * How a cluster is actually searched for. Two kinds, deliberately not one column:
 *
 * - `places_type` — a Google Places (New) `includedTypes` value, e.g. `'plumber'`. This is
 *   what a Places Nearby/Text search sends.
 * - `naics_range` — an inclusive NAICS code range, e.g. 238220–238220, which is how the
 *   Texas Comptroller sales-tax permit corpus is filtered.
 *
 * `it_naics_range_bounds` is an EQUIVALENCE, so it bites in both directions: a
 * `naics_range` term missing its bounds is refused, and so is a `places_type` term that
 * carries them. A one-directional check would let half a range through.
 *
 * NAICS bounds are `integer`, not `text`. `starts_with()` on a code string is the trap
 * research flagged: '7225' matching '72251' is fine but '722' matching '7229' is not what
 * anybody means, and a numeric range says what it means.
 */
export const industryTerms = pgTable(
  'industry_terms',
  {
    ...orgScopedNullable,
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => industryClusters.id),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    naicsLo: integer('naics_lo'),
    naicsHi: integer('naics_hi'),
  },
  (t) => [
    index('industry_terms_org_idx').on(t.orgId),
    unique('industry_terms_org_key_uniq')
      .on(t.orgId, t.clusterId, t.kind, t.value)
      .nullsNotDistinct(),
    check('it_kind_known', sql`kind in ('places_type','naics_range')`),
    check(
      'it_naics_range_bounds',
      sql`(kind = 'naics_range') = (naics_lo is not null and naics_hi is not null)`,
    ),
    ...referencePolicies('industry_terms'),
  ],
);
