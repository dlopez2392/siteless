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
    // `.default(sql\`0\`)`, not `.default(0n)`: drizzle-kit 0.31.10 serializes the default
    // into meta/NNNN_snapshot.json with JSON.stringify, which throws
    // "TypeError: Do not know how to serialize a BigInt" and emits no migration at all.
    // The SQL literal produces the identical `default 0` in the DDL.
    costMicroUsd: bigint('cost_micro_usd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    callsCount: integer('calls_count').notNull().default(0),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    // ---- Phase 4 plan 09 (D-15, D-16; 04-RESEARCH Pattern 8) ----
    // What kind of run this is. A full sweep pays for Enterprise pages over every tile; a
    // partition sweeps one quarter of the cells (D-16); a change check is IDs-only and free.
    kind: text('kind').notNull().default('full_sweep'),
    // 0..3 when kind = 'partition' (PARTITION_COUNT = 4); null otherwise.
    partitionIndex: integer('partition_index'),
    // The admission estimate (D-15), shown before the run starts and kept so the run screen
    // can set what was promised beside what was spent.
    estimateRequestsLo: integer('estimate_requests_lo'),
    estimateRequestsHi: integer('estimate_requests_hi'),
    estimateMicroUsdLo: bigint('estimate_micro_usd_lo', { mode: 'bigint' }),
    estimateMicroUsdHi: bigint('estimate_micro_usd_hi', { mode: 'bigint' }),
    // 🔴 Immutable after insert — deliberately OUTSIDE the UPDATE column grant (drizzle/0027,
    // T-4-12), so a tenant session cannot raise its own ceiling mid-run. 0 on legacy rows
    // means any reservation is refused: a Phase 2 run never had a ceiling.
    ceilingRequests: integer('ceiling_requests').notNull().default(0),
    // The Workflow DevKit run id, so the run screen can link to its trace. Column-granted.
    workflowRunId: text('workflow_run_id'),
    // The Clerk user (sub) who queued it. Null for a cron-started run.
    requestedBy: text('requested_by'),
    // Stamped by every workflow step; a running run whose heartbeat is stale is 'abandoned'.
    // Column-granted.
    heartbeatAt: tstz('heartbeat_at'),
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
    check('runs_kind_known', sql`kind in ('full_sweep','partition','change_check')`),
    check(
      'runs_partition_index_range',
      sql`partition_index is null or partition_index between 0 and 3`,
    ),
    // One active run per org is a UNIQUE PARTIAL INDEX in drizzle/0027
    // (`runs_one_active_per_org`), not here: 0027 must first fail the stale Phase 2 queued
    // rows as never_started, or creating the index fails on apply.
    ...orgPolicies('runs'),
  ],
);
