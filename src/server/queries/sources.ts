import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { instantOf } from '@/lib/instant';
import type { TransientStats } from '@/lib/places/purge-status';
import { rowsOf, type Tx } from './budget';

/**
 * `/sources` (03-UI-SPEC § 2, D-06 / D-17): the ingest ledger.
 *
 * 🔴 EXACTLY FOUR ROWS, WHETHER OR NOT A SOURCE HAS EVER RUN (UI-SPEC Executor Rule 27). The
 * four sources are static structure, not data: they come from a `values` list and the latest
 * `ingest_runs` row per source is LEFT-joined onto it, so a source that has never run is a row
 * of nulls and zeros rather than a missing row. A screen that shows nothing until an ingest
 * has run cannot tell you that an ingest has not run. Same shape as `readSpendByProvider`.
 *
 * 🔴 `stats` IS NEVER SELECTED WHOLE. The Comptroller run's `stats` carries
 * `statewide_name_frequency`, ~400 KB (03-12). The ledger reads the ONE key it renders —
 * `stats -> 'confidence_bands'`, on the Overture row only — and nothing else.
 *
 * 🔴 INSTANTS ARRIVE AS EPOCH-MILLISECOND TEXT AND GO THROUGH `instantOf`. A `timestamptz` read
 * through `tx.execute` is a zone-rendered string with a space separator; this module never
 * parses that text, never ISO-ifies it, and never calls `Intl` — the page formats through
 * `src/lib/time.ts`.
 *
 * ONE TRANSACTION PER REQUEST: `readSources` takes an open one, `listSources` opens it. The
 * page itself calls `listSourcesPage` (04-17), which opens the one transaction for the ledger
 * AND the Google Places transient figures (below).
 */

export const SOURCE_KEYS = [
  'tx_comptroller',
  'tx_comptroller_closures',
  'overture',
  'census_geocoder',
] as const;

export type SourceKey = (typeof SOURCE_KEYS)[number];

export type IngestRunStatus = 'running' | 'complete' | 'stopped' | 'failed';

export type SourceLedgerRow = {
  sourceKey: SourceKey;
  /** The dataset the last run read (`jrea-zgmq`, `3kx8-uryv`), or null when never run. */
  datasetId: string | null;
  /** Socrata `rowsUpdatedAt` / the Overture release string of the last run. */
  sourceVersion: string | null;
  /** When the last run started. Null means "Never run". */
  lastRunAt: Date | null;
  finishedAt: Date | null;
  status: IngestRunStatus | null;
  added: number;
  changed: number;
  unchanged: number;
  gone: number;
  /** Rows the last run saw — the `{rows}` figure in the failed / stopped Alert copy. */
  totalSeen: number;
  /** The recorded error text of a failed run, verbatim. */
  error: string | null;
  /** Overture only: rows per 0.1 confidence band, from `stats -> 'confidence_bands'`. */
  confidenceBands: Record<string, number> | null;
};

type RawLedgerRow = {
  source_key: SourceKey;
  dataset_id: string | null;
  source_version: string | null;
  started_ms: string | null;
  finished_ms: string | null;
  status: IngestRunStatus | null;
  added: number | null;
  changed: number | null;
  unchanged: number | null;
  gone: number | null;
  total_seen: number | null;
  error: string | null;
  confidence_bands: unknown;
};

/** A jsonb object of band → count, or null. Anything else is dropped rather than rendered. */
function bandsOf(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [band, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count)) out[band] = count;
  }
  return out;
}

export async function readSources(tx: Tx): Promise<SourceLedgerRow[]> {
  const rows = rowsOf<RawLedgerRow>(
    await tx.execute(sql`
      select s.source_key,
             lr.dataset_id,
             lr.source_version,
             lr.started_ms,
             lr.finished_ms,
             lr.status,
             lr.added,
             lr.changed,
             lr.unchanged,
             lr.gone,
             lr.total_seen,
             lr.error,
             lr.confidence_bands
        from (values ('tx_comptroller', 1),
                     ('tx_comptroller_closures', 2),
                     ('overture', 3),
                     ('census_geocoder', 4)) as s(source_key, ord)
        left join lateral (
          select r.dataset_id,
                 r.source_version,
                 (extract(epoch from r.started_at)  * 1000)::bigint::text as started_ms,
                 (extract(epoch from r.finished_at) * 1000)::bigint::text as finished_ms,
                 r.status,
                 r.added,
                 r.changed,
                 r.unchanged,
                 r.gone,
                 r.total_seen,
                 r.error,
                 case when r.source_key = 'overture'
                      then r.stats -> 'confidence_bands' end               as confidence_bands
            from ingest_runs r
           where r.org_id = (select app.current_org_id())
             and r.source_key = s.source_key
           order by r.started_at desc nulls last, r.id desc
           limit 1
        ) lr on true
       order by s.ord`),
  );

  return rows.map((r) => ({
    sourceKey: r.source_key,
    datasetId: r.dataset_id,
    sourceVersion: r.source_version,
    lastRunAt: instantOf(r.started_ms),
    finishedAt: instantOf(r.finished_ms),
    status: r.status,
    added: r.added ?? 0,
    changed: r.changed ?? 0,
    unchanged: r.unchanged ?? 0,
    gone: r.gone ?? 0,
    totalSeen: r.total_seen ?? 0,
    error: r.error,
    confidenceBands: bandsOf(r.confidence_bands),
  }));
}

export async function listSources(claims: OrgClaims): Promise<SourceLedgerRow[]> {
  return withOrg(claims, (tx) => readSources(tx));
}

/* --- The Google Places transient card (04-17, D-12; 04-UI-SPEC § Screen 4) ------------------- */

type RawTransientStats = {
  place_ids_held: string | number;
  coordinates_held: string | number;
  oldest_coordinate_ms: string | null;
  expired_awaiting_purge: string | number;
  oldest_expired_ms: string | null;
  last_purge_ms: string | null;
  last_rows_purged: number | null;
};

/** A bigint count arrives as TEXT through postgres.js; anything non-finite is refused, never 0. */
function countOf(value: string | number, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`readTransientStats: ${what} is not a count (${JSON.stringify(value)})`);
  }
  return n;
}

/**
 * The five figures, from `app.places_transient_stats()` (drizzle/0028 § 5; 0031 adds when the
 * longest-waiting expired row expired, for the purge-overdue rule) for the transaction's
 * org. `authenticated` holds NO privilege on `place_coordinates` (0027) and that stays true:
 * the definer returns counts and three epoch-ms timestamps, never a row. The function always
 * returns exactly one row (a cross join of aggregates); zero rows is refused, not defaulted.
 */
export async function readTransientStats(tx: Tx): Promise<TransientStats> {
  const [row] = rowsOf<RawTransientStats>(
    await tx.execute(sql`
      select place_ids_held, coordinates_held, oldest_coordinate_ms,
             expired_awaiting_purge, oldest_expired_ms, last_purge_ms, last_rows_purged
        from app.places_transient_stats()`),
  );
  if (!row) throw new Error('readTransientStats: app.places_transient_stats() returned no row');
  return {
    placeIdsHeld: countOf(row.place_ids_held, 'place_ids_held'),
    coordinatesHeld: countOf(row.coordinates_held, 'coordinates_held'),
    oldestCoordinateMs: instantOf(row.oldest_coordinate_ms)?.getTime() ?? null,
    expiredAwaitingPurge: countOf(row.expired_awaiting_purge, 'expired_awaiting_purge'),
    oldestExpiredMs: instantOf(row.oldest_expired_ms)?.getTime() ?? null,
    lastPurgeMs: instantOf(row.last_purge_ms)?.getTime() ?? null,
    lastRowsPurged: row.last_rows_purged === null ? null : countOf(row.last_rows_purged, 'last_rows_purged'),
  };
}

export type SourcesPage = {
  /** Always the four ledger rows (Rule 27); the transient source is NEVER a fifth (Rule 37). */
  rows: SourceLedgerRow[];
  /** Null when the transient read failed — the card shows its own error; the ledger stands. */
  transient: TransientStats | null;
};

/**
 * `/sources`' ONE read: the ledger, then the transient figures, in ONE `withOrg` — the pool is
 * `max: 1`, so a second `withOrg` from the page would HANG rather than fail.
 *
 * 🔴 THE TRANSIENT READ RUNS IN A SAVEPOINT. A failed statement aborts the whole transaction
 * (every later statement is `25P02`), so without one a broken definer would take the ledger
 * down with it. The savepoint rolls back only its own statement; the card renders its own
 * error copy and the ledger renders as ever (04-UI-SPEC § Error). The failure is logged by
 * error NAME only. A ledger failure still fails the whole read — the page's existing error.
 */
export async function listSourcesPage(claims: OrgClaims): Promise<SourcesPage> {
  return withOrg(claims, async (tx) => {
    const rows = await readSources(tx);
    let transient: TransientStats | null;
    try {
      transient = await tx.transaction((sp) => readTransientStats(sp as unknown as Tx));
    } catch (error) {
      console.error(
        'sources: the transient figures failed to load',
        error instanceof Error ? error.name : 'unknown',
      );
      transient = null;
    }
    return { rows, transient };
  });
}
