import { index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { orgScopedNullable, referencePolicies } from './_helpers';

/**
 * Overture `basic_category` -> Siteless industry cluster key. Reference rows (D-05), exactly
 * like `industry_clusters`: the built-ins ship with `org_id IS NULL`, every tenant reads them,
 * and no tenant can edit one, because `referencePolicies()` excludes NULL-org rows from all
 * three write policies (T-3-07). A tenant's own mapping carries its `org_id`.
 *
 * 🔴 `.nullsNotDistinct()` is load-bearing. `UNIQUE (org_id, basic_category)` alone does not
 * stop a duplicate built-in — `NULL != NULL`, so a second `(null, 'restaurant')` inserts
 * cleanly and the seed loader doubles the table on its second run (measured on
 * `industry_clusters`: 4 rows -> 8). With it, the duplicate is `23505`.
 *
 * `cluster_key` is the cluster's stable machine key ('food_hospitality'), not a uuid FK: the
 * seed loader and a preset both match on the key, and a basic_category nobody mapped is
 * reported in the ingest run's stats rather than refused.
 *
 * Deliberately NO `app.log_event` trigger: reference rows, whose history is the seed script
 * in version control (drizzle/0013's reasoning for the six Phase 2 reference tables).
 */
export const overtureCategoryMap = pgTable(
  'overture_category_map',
  {
    ...orgScopedNullable,
    basicCategory: text('basic_category').notNull(),
    clusterKey: text('cluster_key').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('overture_category_map_org_idx').on(t.orgId),
    unique('overture_category_map_org_category_uniq')
      .on(t.orgId, t.basicCategory)
      .nullsNotDistinct(),
    ...referencePolicies('overture_category_map'),
  ],
);
