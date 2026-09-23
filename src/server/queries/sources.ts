import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { instantOf } from '@/lib/instant';
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
 * ONE TRANSACTION PER REQUEST: `readSources` takes an open one, `listSources` opens it.
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
