import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { searchVersions } from './searches';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One execution of one search version.
 *
 * 🔴 `onDelete: 'no action'` is what makes SRCH-03 true BY CONSTRUCTION: a version that a
 * run points at cannot be removed, so "this run searched for X" stays answerable forever.
 * Not `cascade` (which would erase the run's own history) and not `set null` (which would
 * quietly orphan it into "we no longer know what this run did"). The second half of the
 * same property is that `search_version_id` sits OUTSIDE the column grant in
 * drizzle/0013, so a finished run cannot be re-pointed at a different version either.
 *
 * 🔴 `cost_micro_usd` is `bigint` micro-USD, like every money column in this phase. Not
 * cents (a Places request is 3.50¢ — integer cents cannot express it) and not `integer`:
 * `(50*1000000)*80/100` raises `22003 integer out of range` on int4, which is a CORRECT
 * threshold computation that errors. Verified locally.
 *
 * The six `status` values are exactly the six tones the UI-SPEC status badge map names.
 * `refused` is distinct from `failed` on purpose: the budget governor refusing to start a
 * run is a normal, explainable outcome, and a run that broke is not.
 *
 * Deliberately NO `app.log_event` trigger (see drizzle/0013's closing comment): run volume
 * is Phase 4's and Phase 9's, and `EVENT_LOGGED` asserts set equality in both directions,
 * so adding one silently would be red.
 */
export const runs = pgTable(
  'runs',
  {
    ...orgScoped,
    searchVersionId: uuid('search_version_id')
      .notNull()
      .references(() => searchVersions.id, { onDelete: 'no action' }),
    status: text('status').notNull().default('queued'),
    // Why a run stopped short — the budget cap, a provider outage, an operator cancel.
    // Paired with 'refused'/'partial', this is what the run screen explains to danlo
    // instead of showing a number that silently stopped moving.
    stoppedReason: text('stopped_reason'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'bigint' }).notNull().default(BigInt(0)),
    callsCount: integer('calls_count').notNull().default(0),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    index('runs_org_idx').on(t.orgId),
    // "Used by N runs" on a version screen is count(*) over this index — no denormalised
    // counter, so nothing can drift out of agreement with the rows themselves.
    index('runs_version_idx').on(t.searchVersionId),
    check(
      'runs_status_known',
      sql`status in ('queued','running','complete','partial','refused','failed')`,
    ),
    ...orgPolicies('runs'),
  ],
);
