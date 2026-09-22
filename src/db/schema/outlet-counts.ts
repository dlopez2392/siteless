import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { counties } from './geography';
import { industryClusters } from './clusters';
import { orgScopedNullable, referencePolicies, tstz } from './_helpers';

/**
 * The estimator's core table: how many outlets a given cluster has in a given county (or
 * state-wide). This is what turns "home services in Hidalgo County" into a request count,
 * and a request count into a dollar estimate before anybody spends anything.
 *
 * `scope` is `'county'` or `'state'`, and `oc_scope_target` is an EQUIVALENCE pinning the
 * target column to the scope: a `'county'` row must name a county and a `'state'` row must
 * not. One-directional would let a state row carry a stray county_id and double-count.
 *
 * `measured_at` and `source` are here because the count is a MEASUREMENT with an age, not
 * a constant — the UI can say where the number came from and when, which is the
 * difference between an estimate danlo trusts and a number he stops believing.
 */
export const outletCounts = pgTable(
  'outlet_counts',
  {
    ...orgScopedNullable,
    scope: text('scope').notNull(),
    countyId: uuid('county_id').references(() => counties.id),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => industryClusters.id),
    outlets: integer('outlets').notNull(),
    measuredAt: tstz('measured_at').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    index('outlet_counts_org_idx').on(t.orgId),
    unique('outlet_counts_org_scope_uniq')
      .on(t.orgId, t.scope, t.countyId, t.clusterId)
      .nullsNotDistinct(),
    check('oc_scope_known', sql`scope in ('county','state')`),
    check('oc_scope_target', sql`(scope = 'county') = (county_id is not null)`),
    ...referencePolicies('outlet_counts'),
  ],
);
