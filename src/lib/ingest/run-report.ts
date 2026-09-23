import { requireInstant } from '@/lib/instant';
import type { EtlExecutor } from './etl-actor';

/**
 * The `ingest_runs` lifecycle (D-06): start, tally, gone count, finish, ONE event.
 *
 * 🔴 `ingest_runs` carries `app.touch_updated_at` but NOT `app.log_event` (drizzle/0023's
 * `comment on table`): the run's own row IS the event, and a row trigger would duplicate it on
 * every counter update. The one run-level event goes through the event DEFINER — never a direct
 * insert: `authenticated` holds no INSERT on `events` (drizzle/0011) and every writer is a
 * definer.
 *
 * 🔴 That definer resolves the org from `request.jwt.claims` ONLY. The desk scripts are
 * owner connections with no Clerk session, so `finishRun` works only inside a transaction that
 * already ran `setEtlActor` AND `resolveEtlOrg` (src/lib/ingest/etl-actor.ts). Without the
 * second it raises 42501 "no current org" — at the END of the run, after every row
 * was written.
 */

/** Exactly `ir_source_key_known`: the four `/sources` rows. */
export type IngestSourceKey =
  | 'tx_comptroller'
  | 'tx_comptroller_closures'
  | 'overture'
  | 'census_geocoder';

/** `ir_status_known` minus 'running', which only `startRun` writes. */
export type FinishedRunStatus = 'complete' | 'stopped' | 'failed';

export interface RunTally {
  added: number;
  changed: number;
  unchanged: number;
  totalSeen: number;
}

export const emptyTally = (): RunTally => ({ added: 0, changed: 0, unchanged: 0, totalSeen: 0 });

/** One `upsertSourceRecord` outcome into the tally. The three outcomes are disjoint. */
export function recordOutcome(t: RunTally, r: { inserted: boolean; changed: boolean }): void {
  t.totalSeen += 1;
  if (r.inserted) t.added += 1;
  else if (r.changed) t.changed += 1;
  else t.unchanged += 1;
}

export interface StartedRun {
  id: string;
  /**
   * The run-start instant, at MILLISECOND precision — the column is written already truncated
   * to milliseconds, so this `Date` is exactly the stored value. Pass it as `seenAt` to every
   * `upsertSourceRecord` of the run and as `runStartedAt` to `countGone`: a row seen in this
   * run then has `last_seen_at = started_at`, never `<`.
   */
  startedAt: Date;
}

/**
 * Inserts the `status='running'` row.
 *
 * `started_at` is `clock_timestamp()`, not `now()`: `now()` is the TRANSACTION start, so two
 * runs inside one transaction (every DB test runs inside one rolled-back transaction) would
 * share a start instant and `countGone` could never see a row go missing. In a real desk run
 * `startRun` has its own short transaction and the two agree to within microseconds.
 */
export async function startRun(
  tx: EtlExecutor,
  args: {
    orgId: string;
    sourceKey: IngestSourceKey;
    datasetId: string | null;
    sourceVersion: string | null;
  },
): Promise<StartedRun> {
  const { rows } = await tx.query<{ id: string; started_ms: string | null }>(
    `insert into ingest_runs (org_id, source_key, dataset_id, source_version, status, started_at)
     values ($1, $2, $3, $4, 'running', date_trunc('milliseconds', clock_timestamp()))
     returning id, (extract(epoch from started_at) * 1000)::bigint::text as started_ms`,
    [args.orgId, args.sourceKey, args.datasetId, args.sourceVersion],
  );
  const row = rows[0];
  if (!row) throw new Error('startRun: the insert returned no row');
  return { id: row.id, startedAt: requireInstant(row.started_ms, 'ingest_runs.started_at') };
}

/**
 * Rows whose `last_seen_at` did not advance during this run are `gone`. NOTHING is deleted and
 * NOTHING is status-changed: Overture drops and re-adds ids between releases, so `gone` is a
 * report line, never a state transition (D-05).
 */
export async function countGone(
  tx: EtlExecutor,
  args: { orgId: string; sourceKey: IngestSourceKey; runStartedAt: Date },
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from source_records
      where org_id = $1 and source_key = $2 and last_seen_at < $3::timestamptz`,
    [args.orgId, args.sourceKey, args.runStartedAt.toISOString()],
  );
  return rows[0]?.n ?? 0;
}

export interface RunReport extends RunTally {
  status: FinishedRunStatus;
  gone: number;
  stats?: Record<string, unknown> | null;
  error?: string | null;
}

/**
 * Writes the report onto the run row, then emits EXACTLY ONE event for the run.
 *
 * The event's action is the run's final status — `'complete'` for every successful run, which
 * is the CONVENTIONS § Audit shape; a failed run is not recorded as `'complete'`. Its `after`
 * is the report itself, so the audit trail carries the four counts even if the run row is
 * later edited.
 *
 * Returns the `events.id` of that one event.
 */
export async function finishRun(tx: EtlExecutor, runId: string, report: RunReport): Promise<string> {
  const updated = await tx.query<{ id: string }>(
    `update ingest_runs
        set status = $2, added = $3, changed = $4, unchanged = $5, gone = $6, total_seen = $7,
            stats = $8::jsonb, error = $9, finished_at = clock_timestamp()
      where id = $1
      returning id`,
    [
      runId,
      report.status,
      report.added,
      report.changed,
      report.unchanged,
      report.gone,
      report.totalSeen,
      report.stats == null ? null : JSON.stringify(report.stats),
      report.error ?? null,
    ],
  );
  if (updated.rows.length === 0) throw new Error(`finishRun: no ingest_runs row ${runId}`);

  const after = {
    status: report.status,
    added: report.added,
    changed: report.changed,
    unchanged: report.unchanged,
    gone: report.gone,
    total_seen: report.totalSeen,
    stats: report.stats ?? null,
  };
  const { rows } = await tx.query<{ id: string }>(
    "select app.emit_event('ingest_runs', $1::uuid, $2, $3::jsonb)::text as id",
    [runId, report.status, JSON.stringify(after)],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('finishRun: the run-level event definer returned no id');
  return id;
}
