import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { mergeCandidates } from './merge-candidates';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One merge, as a row (ARCHITECTURE anti-pattern 9: merges are rows, never deletes).
 * DEDUP-02: a merged lead retains every parent, and unmerge exists.
 *
 * The row is NEVER deleted. Unmerge stamps `undone_by` / `undone_at`, and the partial
 * unique index `business_merges_loser_uniq` (drizzle/0023) — `(org_id, loser_id) where
 * undone_at is null` — means a business can be merged away only once at a time.
 *
 * WHY `winner_fields_before` EXISTS. `source_records.business_id` is never re-pointed on a
 * merge, so the LOSER's fields are restored on unmerge by re-reading its own source records
 * through the same survivorship function the merge used — no snapshot needed. The WINNER's
 * `*_source_id` provenance pairs, however, were overwritten by the merge, and nothing else
 * remembers what they were. This column is that memory: every `*_source_id` and every
 * survivorship-owned scalar on the winner immediately before the merge.
 *
 * `score` and `features` are copied at merge time so a historical merge stays reproducible
 * after the scorer changes.
 *
 * 🔴 This table DOES carry `app.log_event` (drizzle/0023) and is in `EVENT_LOGGED`: it is
 * state-bearing and low volume (~10,000 rows), and a merge is exactly the change somebody
 * later needs attributed.
 *
 * `authenticated` holds SELECT only. The writers are SECURITY DEFINER functions (03-11)
 * that read the actor themselves, so `merged_by` cannot be forged (T-3-08).
 */
export const businessMerges = pgTable(
  'business_merges',
  {
    ...orgScoped,
    winnerId: uuid('winner_id')
      .notNull()
      .references(() => businesses.id),
    loserId: uuid('loser_id')
      .notNull()
      .references(() => businesses.id),
    // Nullable: a future manual merge has no candidate row.
    candidateId: uuid('candidate_id').references(() => mergeCandidates.id),
    reason: text('reason').notNull(),
    score: integer('score'),
    features: jsonb('features'),
    mergedBy: text('merged_by').notNull(),
    mergedAt: tstz('merged_at').notNull().defaultNow(),
    winnerFieldsBefore: jsonb('winner_fields_before').notNull(),
    undoneBy: text('undone_by'),
    undoneAt: tstz('undone_at'),
  },
  (t) => [
    index('business_merges_org_idx').on(t.orgId),
    // The detail view's merge history is "every merge this business won".
    index('business_merges_winner_idx').on(t.orgId, t.winnerId),
    check('bm_not_self', sql`winner_id <> loser_id`),
    check('bm_reason_known', sql`reason in ('auto','review')`),
    ...orgPolicies('business_merges'),
  ],
);
