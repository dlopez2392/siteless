import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One candidate duplicate pair, produced by a resolve pass (DEDUP-01) and worked in the
 * `/review` queue (D-13).
 *
 * 🔴 `mc_pair_ordered` (`left_id < right_id`) plus `merge_candidates_pair_uniq` is what stops
 * one unordered pair becoming two rows. The writer inserts `least(a,b)` / `greatest(a,b)`;
 * the CHECK refuses a caller that forgets.
 *
 * 🔴 `skipped_at` is how D-13's "Skip leaves it pending and moves on" works WITHOUT a third
 * decision value. The queue reads
 * `decision = 'pending' order by skipped_at nulls first, score desc`, so a skipped pair sinks
 * below everything undecided and resurfaces once the rest has been worked. A 'skipped'
 * decision would instead be a state somebody has to remember to un-set.
 *
 * `decision = 'distinct'` is also D-20's "never auto-re-merges": unmerge writes it, and the
 * auto-merge pass skips any pair that carries it.
 *
 * Deliberately NO `app.log_event` trigger: a resolve pass writes ~30,000 rows, the same
 * write-amplification argument CONVENTIONS § Audit makes for `source_records`. The
 * decision is audited where it becomes state — `business_merges`, which does carry one.
 *
 * `authenticated` holds SELECT only (drizzle/0023). Every decision goes through a
 * SECURITY DEFINER (03-11) that reads the actor itself, so `decided_by` cannot be forged
 * (T-3-08).
 */
export const mergeCandidates = pgTable(
  'merge_candidates',
  {
    ...orgScoped,
    leftId: uuid('left_id')
      .notNull()
      .references(() => businesses.id),
    rightId: uuid('right_id')
      .notNull()
      .references(() => businesses.id),
    // Which blocker produced the pair ('phone', 'addr', 'trgm'), for the run report and
    // for refusing an over-size block rather than silently truncating it.
    blockKey: text('block_key').notNull(),
    blockSize: integer('block_size'),
    score: integer('score').notNull().default(0),
    // The component vector the score came from — the review card renders it.
    features: jsonb('features').notNull().default(sql`'{}'::jsonb`),
    decision: text('decision').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: tstz('decided_at'),
    skippedAt: tstz('skipped_at'),
  },
  (t) => [
    index('merge_candidates_org_idx').on(t.orgId),
    // `/review` reads one row: the highest-scoring pending pair.
    index('merge_candidates_queue_idx').on(t.orgId, t.decision, t.score.desc()),
    unique('merge_candidates_pair_uniq').on(t.orgId, t.leftId, t.rightId),
    check('mc_decision_known', sql`decision in ('pending','merged','distinct')`),
    check('mc_pair_ordered', sql`left_id < right_id`),
    ...orgPolicies('merge_candidates'),
  ],
);
