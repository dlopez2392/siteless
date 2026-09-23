/**
 * `/sources` — the ledger `readSources` returns (plan 03-15, D-06 / D-17, UI-SPEC Rule 27).
 *
 * Driven through the SHIPPED query module on the runtime driver (`_drizzle-tx.ts`), as a Clerk
 * user under RLS — not re-typed SQL, and not a service-role fixture that is blind to grants.
 *
 * 🔴 RULE 27 AS AN ASSERTION: the four rows exist BEFORE any run does. A ledger built from
 * `ingest_runs` outwards returns zero rows on a fresh org, and a screen with zero rows cannot
 * tell "never ran" from "broken".
 *
 * 🔴 ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS ('two zones'). The suite process is pinned to
 * UTC (vitest.db.config.ts), so a Chicago-only assertion here would pass whichever zone the
 * code used; the instant below is a Chicago evening that is already tomorrow in UTC.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { localDate } from '@/lib/time';
import { readSources, type SourceLedgerRow } from '@/server/queries/sources';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { CLAIMS_A } from './_merge-fixtures';

// `server-only` throws outside a React Server Component graph.
vi.mock('server-only', () => ({}));

afterAll(async () => {
  await closeDrizzleTx();
});

const ORDER = ['tx_comptroller', 'tx_comptroller_closures', 'overture', 'census_geocoder'];

type RunSpec = {
  orgId: string;
  sourceKey: string;
  startedAt: string;
  status?: 'running' | 'complete' | 'stopped' | 'failed';
  datasetId?: string | null;
  sourceVersion?: string | null;
  counts?: [number, number, number, number];
  totalSeen?: number;
  stats?: Record<string, unknown> | null;
  error?: string | null;
};

/** As the OWNER: `ingest_runs` is SELECT-only for `authenticated`. */
async function seedRun(c: ReturnType<typeof asPg>, spec: RunSpec): Promise<void> {
  const [added, changed, unchanged, gone] = spec.counts ?? [0, 0, 0, 0];
  await c.query(
    `insert into ingest_runs (org_id, source_key, dataset_id, source_version, started_at,
                              finished_at, status, added, changed, unchanged, gone, total_seen,
                              stats, error)
     values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '3 minutes', $6,
             $7, $8, $9, $10, $11, $12::jsonb, $13)`,
    [
      spec.orgId,
      spec.sourceKey,
      spec.datasetId ?? null,
      spec.sourceVersion ?? null,
      spec.startedAt,
      spec.status ?? 'complete',
      added,
      changed,
      unchanged,
      gone,
      spec.totalSeen ?? added + changed + unchanged,
      spec.stats == null ? null : JSON.stringify(spec.stats),
      spec.error ?? null,
    ],
  );
}

const byKey = (rows: SourceLedgerRow[], key: string) => {
  const row = rows.find((r) => r.sourceKey === key);
  if (!row) throw new Error('no ledger row for ' + key);
  return row;
};

describe('sources ledger', () => {
  it('run report', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a, b } = await seedTwoOrgs(c);

      // ---- before any run: exactly four rows, fixed order, nulls and zeros ----
      await actAs(c, CLAIMS_A);
      const before = await readSources(tx);
      expect(before).toHaveLength(4);
      expect(before.map((r) => r.sourceKey)).toEqual(ORDER);
      for (const r of before) {
        expect(r.lastRunAt).toBeNull();
        expect(r.status).toBeNull();
        expect(r.sourceVersion).toBeNull();
        expect([r.added, r.changed, r.unchanged, r.gone]).toEqual([0, 0, 0, 0]);
        expect(r.error).toBeNull();
        expect(r.confidenceBands).toBeNull();
      }

      // ---- one run per source for org A; an older run and a foreign org's newer run ----
      await actAsOwner(c);
      const statewide: Record<string, number> = {};
      for (let i = 0; i < 2000; i += 1) statewide[`name ${i}`] = (i % 7) + 1;
      await seedRun(c, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        startedAt: '2026-09-01T10:00:00.000Z',
        counts: [1, 1, 1, 1],
        sourceVersion: 'older',
      });
      await seedRun(c, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        startedAt: '2026-09-20T15:04:05.123Z',
        datasetId: 'jrea-zgmq',
        sourceVersion: '2026-09-19T08:00:00.000Z',
        counts: [34928, 12, 3, 7],
        stats: { statewide_name_frequency: statewide },
      });
      await seedRun(c, {
        orgId: a,
        sourceKey: 'tx_comptroller_closures',
        startedAt: '2026-09-20T15:10:00.000Z',
        datasetId: '3kx8-uryv',
        sourceVersion: '2026-09-18T00:00:00.000Z',
        counts: [21062, 0, 0, 0],
      });
      await seedRun(c, {
        orgId: a,
        sourceKey: 'overture',
        startedAt: '2026-09-21T02:00:00.000Z',
        sourceVersion: '2026-08-19.0',
        counts: [57010, 44, 9, 2],
        stats: { confidence_bands: { '0.9': 35000, '0.5': 1200 }, release: '2026-08-19.0' },
      });
      await seedRun(c, {
        orgId: a,
        sourceKey: 'census_geocoder',
        startedAt: '2026-09-20T16:00:00.000Z',
        counts: [30000, 0, 0, 0],
      });
      await seedRun(c, {
        orgId: b,
        sourceKey: 'tx_comptroller',
        startedAt: '2026-09-22T00:00:00.000Z',
        sourceVersion: 'org B, never shown to A',
        counts: [9, 9, 9, 9],
      });

      await actAs(c, CLAIMS_A);
      const after = await readSources(tx);
      expect(after).toHaveLength(4);
      expect(after.map((r) => r.sourceKey)).toEqual(ORDER);

      const permits = byKey(after, 'tx_comptroller');
      expect(permits.sourceVersion).toBe('2026-09-19T08:00:00.000Z');
      expect(permits.datasetId).toBe('jrea-zgmq');
      expect(permits.status).toBe('complete');
      expect([permits.added, permits.changed, permits.unchanged, permits.gone]).toEqual([
        34928, 12, 3, 7,
      ]);
      // A parsed instant, not the driver's zone-rendered text — and the exact one inserted.
      expect(permits.lastRunAt).toBeInstanceOf(Date);
      expect(permits.lastRunAt?.toISOString()).toBe('2026-09-20T15:04:05.123Z');
      expect(permits.finishedAt?.toISOString()).toBe('2026-09-20T15:07:05.123Z');
      // The ~400 KB statewide map is never read: only the Overture row carries a stats key.
      expect(permits.confidenceBands).toBeNull();
      expect(Object.keys(permits)).not.toContain('stats');

      expect(byKey(after, 'tx_comptroller_closures').added).toBe(21062);
      expect(byKey(after, 'census_geocoder').added).toBe(30000);
      const overture = byKey(after, 'overture');
      expect(overture.sourceVersion).toBe('2026-08-19.0');
      expect([overture.added, overture.changed, overture.unchanged, overture.gone]).toEqual([
        57010, 44, 9, 2,
      ]);
      expect(overture.confidenceBands).toEqual({ '0.9': 35000, '0.5': 1200 });
    }));

  it('run report survives a failed run', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      await seedRun(c, {
        orgId: a,
        sourceKey: 'overture',
        startedAt: '2026-09-10T12:00:00.000Z',
        counts: [100, 0, 0, 0],
      });
      await seedRun(c, {
        orgId: a,
        sourceKey: 'overture',
        startedAt: '2026-09-21T12:00:00.000Z',
        status: 'failed',
        counts: [0, 0, 0, 0],
        totalSeen: 4210,
        error: 'DuckDB: HTTP 403 reading s3://overturemaps-us-west-2/release/2026-08-19.0',
      });
      await actAs(c, CLAIMS_A);

      const rows = await readSources(tx);
      expect(rows).toHaveLength(4);
      const overture = byKey(rows, 'overture');
      // The LATEST run is the failed one, and it is returned whole — the screen renders the
      // destructive Alert from these fields rather than a blank row or the older success.
      expect(overture.status).toBe('failed');
      expect(overture.error).toBe(
        'DuckDB: HTTP 403 reading s3://overturemaps-us-west-2/release/2026-08-19.0',
      );
      expect(overture.totalSeen).toBe(4210);
      expect(overture.lastRunAt?.toISOString()).toBe('2026-09-21T12:00:00.000Z');
    }));

  it('two zones', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      // 22:30 CDT on the 21st in the RGV is 03:30 UTC on the 22nd.
      await seedRun(c, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        startedAt: '2026-09-22T03:30:00.000Z',
        counts: [1, 0, 0, 0],
      });
      await actAs(c, CLAIMS_A);

      const lastRunAt = byKey(await readSources(tx), 'tx_comptroller').lastRunAt;
      if (!lastRunAt) throw new Error('two zones: lastRunAt came back null');
      expect(lastRunAt.getTime()).toBe(Date.UTC(2026, 8, 22, 3, 30, 0));
      expect(localDate(lastRunAt)).toBe('2026-09-21');
      expect(localDate(lastRunAt, 'UTC')).toBe('2026-09-22');
    }));
});
