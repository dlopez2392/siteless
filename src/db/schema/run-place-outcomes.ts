import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { runs } from './runs';
import { orgPolicies, orgScoped } from './_helpers';

/**
 * What the matcher did with each place a run saw, per queried cluster. D-05, D-07, D-08.
 *
 * `outcome`: `attached | tentative | unmatched | outside` (outside = a located result beyond
 * the geography; recorded so the Matching counts add up, excluded from attachment). Drives the
 * run screen's Matching panel and the per-cluster counts. `place_id` only — no Places text.
 *
 * SELECT-only for `authenticated`; written by a SECURITY DEFINER. Carries
 * `app.touch_updated_at`, no `app.log_event` (drizzle/0027 comment).
 */
export const runPlaceOutcomes = pgTable(
  'run_place_outcomes',
  {
    ...orgScoped,
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    placeId: text('place_id').notNull(),
    clusterKey: text('cluster_key').notNull(),
    outcome: text('outcome').notNull(),
  },
  (t) => [
    index('run_place_outcomes_org_idx').on(t.orgId),
    unique('run_place_outcomes_key').on(t.runId, t.placeId, t.clusterKey),
    index('run_place_outcomes_run_idx').on(t.orgId, t.runId),
    check('rpo_outcome_known', sql`outcome in ('attached','tentative','unmatched','outside')`),
    ...orgPolicies('run_place_outcomes'),
  ],
);
