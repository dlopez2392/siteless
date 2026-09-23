import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One row per org per coordinate purge — zero-count purges included, so "last purge" on the
 * /sources screen is per tenant and true. D-12; 04-RESEARCH Pattern 10.
 *
 * Written by the cross-org purge definer (04-11, executable only by `siteless_cron`) or the
 * desk trigger. The row IS the purge's audit record: no `app.log_event`, and no
 * `app.touch_updated_at` because a purge record is never updated (drizzle/0027 comment).
 * SELECT-only for `authenticated`.
 */
export const placePurgeRuns = pgTable(
  'place_purge_runs',
  {
    ...orgScoped,
    ranAt: tstz('ran_at').notNull().defaultNow(),
    rowsPurged: integer('rows_purged').notNull(),
    trigger: text('trigger').notNull(),
  },
  (t) => [
    index('place_purge_runs_org_idx').on(t.orgId),
    index('place_purge_runs_recent_idx').on(t.orgId, t.ranAt.desc()),
    check('ppr_rows_non_negative', sql`rows_purged >= 0`),
    check('ppr_trigger_known', sql`trigger in ('cron','desk')`),
    ...orgPolicies('place_purge_runs'),
  ],
);
