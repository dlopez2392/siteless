import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { runs } from './runs';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One Google place linked (or refused a link) to one spine business. D-05, D-07, D-08.
 *
 * `status`:
 *   * `attached`  — the matcher scored ≥95, or a human confirmed it. The ONLY status that feeds
 *                   the `business_place_signal` view (drizzle/0027).
 *   * `tentative` — below the bar, or a tie (`reason = 'tie'`, `tie_business_id` names the
 *                   other business). Worked in the review queue; never a verdict input (D-08).
 *   * `rejected`  — a human said no. STICKY: the writer's upsert never changes a rejected
 *                   row, so a re-run cannot re-attach a pair somebody already refused.
 *
 * `features` holds the score's integer points, its `signals` / `rule` enums and the 0|1 listing
 * flags — never Places text (no displayName, no formattedAddress), and since 2026-09-23 never the
 * continuous `nameSim` / `distanceM` either (memory-only; src/lib/places/page-record.ts drops
 * them). That is the legal line (D-13), and since drizzle/0030 (A-WR-06) the table CHECK
 * `pa_features_numeric` → `app.places_features_ok` enforces exactly it: the 11 keys, integer
 * points, anything else 23514.
 *
 * `authenticated` holds SELECT only (drizzle/0027). Every write is a SECURITY DEFINER that
 * resolves the org and the actor from the claims, so `decided_by` cannot be forged.
 *
 * The audit trigger fires on a STATUS CHANGE only (`place_attachments_event_upd`, drizzle/0027):
 * confirm / reject / detach / re-score are the state-bearing events; the matcher's per-run
 * inserts are audited at run level by 04-22 via `app.emit_event` — the `budget_periods`
 * precedent. Since drizzle/0030 (A-WR-05) it runs `app.log_place_attachment_event`, whose
 * before/after carry ids, status, reason, tie and decider only — never `score` or `features`,
 * because `events` is immutable and keeps every copy forever.
 */
export const placeAttachments = pgTable(
  'place_attachments',
  {
    ...orgScoped,
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    placeId: text('place_id').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    score: integer('score').notNull(),
    features: jsonb('features').notNull(),
    tieBusinessId: uuid('tie_business_id').references(() => businesses.id),
    firstSeenRunId: uuid('first_seen_run_id').references(() => runs.id),
    lastSeenRunId: uuid('last_seen_run_id').references(() => runs.id),
    decidedBy: text('decided_by'),
    decidedAt: tstz('decided_at'),
  },
  (t) => [
    index('place_attachments_org_idx').on(t.orgId),
    unique('place_attachments_pair_key').on(t.orgId, t.businessId, t.placeId),
    // The listing review queue reads the highest-scoring tentative pair first.
    index('place_attachments_queue_idx').on(t.orgId, t.status, t.score.desc()),
    // "Which businesses does this place touch?" — the tie check and the writer's upsert.
    index('place_attachments_place_idx').on(t.orgId, t.placeId),
    check('pa_status_known', sql`status in ('attached','tentative','rejected')`),
    check('pa_reason_known', sql`reason in ('score','tie','confirmed','rejected','detached')`),
    check('pa_score_range', sql`score between 0 and 100`),
    ...orgPolicies('place_attachments'),
  ],
);
