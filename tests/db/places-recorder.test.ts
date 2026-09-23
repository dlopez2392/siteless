/**
 * The D-04 recorder's database and Places legs (scripts/lib/record-pages.ts, plan 04-19) against
 * the real database and the msw replay — NEVER Google. The recorder script itself makes real,
 * billed calls and is run only at 04-32; what it runs is proven here, piece by piece:
 *   - `openRecordingRun` finds the org from the version (no "only org" guess), writes a running
 *     run whose request ceiling IS the cap, and plans its one search through the definer;
 *   - `recordPages` reserves every page before it leaves (the hook reads an open reservation at
 *     request time), settles it at the free-allowance price, stops at the cap, and keeps only
 *     anonymized pages — no fixture string survives into what it returns;
 *   - `--ids-only` is one free call with the IDs-only mask, ledgered at $0 (04-31's D-03 check);
 *   - `closeRecordingRun` ends the run and never marks the tile swept.
 *
 * The worker double and the msw lifecycle are tests/db/places-check-tile.test.ts's.
 */
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@/server/queries/budget';
import { assertAnonymizedPage } from '../../scripts/lib/anonymize-places';
import { server, startReplayServer } from '../unit/msw/server';
import {
  PLACES_PAGES,
  onPlacesRequest,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
} from '../unit/msw/places';
import { seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { seedPlacesRun } from './_places-fixtures';

vi.hoisted(() => {
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/places-recorder.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set (the non-owner runtime role).',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/places-recorder.test.ts: the database URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

vi.mock('server-only', () => ({}));

type RecordPages = typeof import('../../scripts/lib/record-pages');

const state: { tx: Tx | null } = { tx: null };

let lib: RecordPages;
let realDb: typeof import('@/db/client').db;

const workerDouble = async <T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const outer = state.tx;
  if (!outer) throw new Error('places-recorder: no test transaction is open');
  return outer.transaction(async (sp) => {
    const tx = sp as unknown as Tx;
    await tx.execute(
      sql`select set_config('request.jwt.claims', json_build_object('o', json_build_object('id', ${clerkOrgId}::text))::text, true)`,
    );
    await tx.execute(sql`select set_config('app.actor_id', ${actor}, true)`);
    await tx.execute(sql`set local role authenticated`);
    const out = await fn(tx);
    await tx.execute(sql`reset role`);
    await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
    await tx.execute(sql`select set_config('app.actor_id', '', true)`);
    return out;
  });
};

beforeAll(async () => {
  vi.resetModules();
  realDb = (await import('@/db/client')).db;
  vi.doMock('@/db/with-worker-org', () => ({ withWorkerOrg: workerDouble }));
  lib = await import('../../scripts/lib/record-pages');
  startReplayServer();
});

afterEach(() => {
  resetPlaces();
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  vi.doUnmock('@/db/with-worker-org');
  state.tx = null;
  await realDb.$client.end({ timeout: 5 });
  vi.resetModules();
  await closeDrizzleTx();
});

type World = { tx: Tx; orgA: string; versionId: string };

/** Org A with a finished McAllen × home_services run (for its version) — no active run. */
function inWorld(fn: (w: World) => Promise<void>): Promise<void> {
  return withTxRollback(async (tx) => {
    state.tx = tx;
    try {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const old = await seedPlacesRun(c, a, { status: 'complete' });
      await fn({ tx, orgA: a, versionId: old.versionId });
    } finally {
      state.tx = null;
    }
  });
}

function rows<T>(r: unknown): T[] {
  return r as T[];
}

async function open(w: World, a: { idsOnly: boolean; maxRequests: number; quad?: string }) {
  const run = await lib.openRecordingRun(asPg(w.tx), {
    versionId: w.versionId,
    placesType: 'plumber',
    unit: 'city:48215/McAllen',
    ...(a.quad === undefined ? {} : { quad: a.quad }),
    idsOnly: a.idsOnly,
    maxRequests: a.maxRequests,
  });
  const anonymize = { rect: run.rect, city: run.unitName, placesType: 'plumber' };
  const record = () =>
    lib.recordPages(
      { clerkOrgId: run.clerkOrgId, runId: run.runId },
      {
        searchId: run.searchId,
        first: lib.firstRequest(run, 'plumber'),
        mode: a.idsOnly ? 'ids_only' : 'enterprise',
        maxRequests: a.maxRequests,
        anonymize,
      },
    );
  return { run, record };
}

async function ledgerOf(tx: Tx, runId: string) {
  return rows<{ sku: string; units: number; micro: string }>(
    await tx.execute(sql`
      select sku, units, micro_usd::text as micro
        from cost_ledger where run_id = ${runId} order by occurred_at, id`),
  );
}

describe('the recorder legs (D-04, D-20, criterion 5)', () => {
  it('the recorder opens a capped run in the version’s own org', () =>
    inWorld(async (w) => {
      const { run } = await open(w, { idsOnly: false, maxRequests: 3, quad: 'r2' });
      expect(run.orgId).toBe(w.orgA);
      expect(run.clerkOrgId).toBe('org_A');
      expect(run.tileKey).toBe('city:48215/McAllen|plumber|r2');
      expect(run.unitName).toBe('McAllen');
      const r = rows<{ status: string; kind: string; ceiling: number }>(
        await w.tx.execute(sql`
          select status, kind, ceiling_requests as ceiling from runs where id = ${run.runId}`),
      )[0];
      expect(r).toEqual({ status: 'running', kind: 'full_sweep', ceiling: 3 });
      const s = rows<{ kind: string; depth: number; parent: string | null }>(
        await w.tx.execute(sql`
          select kind, depth, parent_tile_key as parent from run_searches where id = ${run.searchId}`),
      )[0];
      expect(s).toEqual({ kind: 'enterprise', depth: 1, parent: 'city:48215/McAllen|plumber|r' });
    }));

  it('the recorder reserves every page before it leaves and ledgers it', () =>
    inWorld(async (w) => {
      const { run, record } = await open(w, { idsOnly: false, maxRequests: 3 });
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
      const openAtRequest: boolean[] = [];
      onPlacesRequest(async () => {
        const cur = rows<{ open: boolean }>(
          await w.tx.execute(sql`
            select (r.settled_at is null and r.released_at is null) as open
              from run_searches s join cost_reservations r on r.id = s.inflight_reservation_id
             where s.id = ${run.searchId}`),
        )[0];
        openAtRequest.push(cur?.open === true);
      });

      const result = await record();

      expect(result).toMatchObject({
        outcome: 'ok',
        requests: 3,
        idsSeen: 60,
        truncatedByCap: false,
      });
      expect(openAtRequest).toEqual([true, true, true]);
      expect(await ledgerOf(w.tx, run.runId)).toEqual([
        { sku: 'ts_enterprise', units: 1, micro: '0' },
        { sku: 'ts_enterprise', units: 1, micro: '0' },
        { sku: 'ts_enterprise', units: 1, micro: '0' },
      ]);
    }));

  it('the recorder keeps only anonymized pages', () =>
    inWorld(async (w) => {
      const { record } = await open(w, { idsOnly: false, maxRequests: 3 });
      // Real-LOOKING pages, built here (never a fixture file): every string distinctive.
      const place = (i: number) => ({
        id: `ChIJrecorderLooking${i}`,
        displayName: { text: `REAL-LOOKING Recorder Plumbing ${i}`, languageCode: 'en' },
        formattedAddress: `${700 + i} W Real Ave, McAllen, TX 78503, USA`,
        location: { latitude: 26.20007 + i / 1000, longitude: -98.24009 },
        types: ['plumber'],
        businessStatus: 'OPERATIONAL',
        nationalPhoneNumber: `(956) 682-${4400 + i}`,
        websiteUri:
          i % 2 === 0
            ? `https://realplumbing${i}.com`
            : `https://www.facebook.com/real-plumbing-${i}`,
        rating: 4.3,
        userRatingCount: 77,
      });
      setPlacesRoutes([
        {
          name: 'real-looking',
          when: () => true,
          pages: [
            { places: [0, 1, 2].map(place), nextPageToken: 'REALTOKEN:p2' },
            { places: [3, 4].map(place) },
          ],
        },
      ]);

      const result = await record();

      expect(result).toMatchObject({ outcome: 'ok', requests: 2, idsSeen: 5 });
      result.pages.forEach((p, i) => assertAnonymizedPage(p, `page ${i + 1}`));
      const text = JSON.stringify(result);
      const originals = [
        'REAL-LOOKING',
        'Real Ave',
        '78503',
        '682-',
        'realplumbing',
        'real-plumbing',
        'REALTOKEN',
        '26.20007',
        '26.20407',
        '-98.24009',
        '4.3',
        'languageCode',
      ];
      for (const s of originals) expect(text, s).not.toContain(s);
      const places = result.pages.flatMap((p) => p.places as Array<Record<string, unknown>>);
      // Ids survive in order; ratings are the synthetic constants (D-21).
      expect(places.map((x) => x.id)).toEqual(
        [0, 1, 2, 3, 4].map((i) => `ChIJrecorderLooking${i}`),
      );
      expect(
        new Set(places.map((x) => `${String(x.rating)}/${String(x.userRatingCount)}`)),
      ).toEqual(new Set(['4/10']));
      // The token is the replay's own.
      expect(result.pages.map((p) => p.nextPageToken)).toEqual(['recorded:p2', undefined]);
    }));

  it('the recorder stops at its request cap', () =>
    inWorld(async (w) => {
      const { run, record } = await open(w, { idsOnly: false, maxRequests: 2 });
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);

      const result = await record();

      expect(result).toMatchObject({ outcome: 'ok', requests: 2, truncatedByCap: true });
      expect(placesRequests).toHaveLength(2);
      expect(await ledgerOf(w.tx, run.runId)).toHaveLength(2);
    }));

  it('the run ceiling refuses what the recorder cap would allow', () =>
    inWorld(async (w) => {
      // The loop is told 3; the run was opened with a ceiling of 1. The meter is the wall.
      const { run } = await open(w, { idsOnly: false, maxRequests: 1 });
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);

      const result = await lib.recordPages(
        { clerkOrgId: run.clerkOrgId, runId: run.runId },
        {
          searchId: run.searchId,
          first: lib.firstRequest(run, 'plumber'),
          mode: 'enterprise',
          maxRequests: 3,
          anonymize: { rect: run.rect, city: run.unitName, placesType: 'plumber' },
        },
      );

      expect(result).toMatchObject({ outcome: 'exceeded_estimate', requests: 1 });
      expect(placesRequests).toHaveLength(1);
    }));

  it("the recorder's ids-only mode ledgers one free call", () =>
    inWorld(async (w) => {
      const { run, record } = await open(w, { idsOnly: true, maxRequests: 1 });
      setPlacesRoutes([{ name: 'ids', when: () => true, pages: PLACES_PAGES.idsOnly }]);

      const result = await record();

      expect(result).toMatchObject({ outcome: 'ok', requests: 1, idsSeen: 10 });
      expect(placesRequests.map((r) => r.mask)).toEqual(['places.id,nextPageToken']);
      expect(await ledgerOf(w.tx, run.runId)).toEqual([
        { sku: 'ts_essentials', units: 1, micro: '0' },
      ]);
      const kind = rows<{ kind: string }>(
        await w.tx.execute(sql`select kind from runs where id = ${run.runId}`),
      )[0];
      expect(kind?.kind).toBe('change_check');
    }));

  it('the recorder releases a refused page and names the reason', () =>
    inWorld(async (w) => {
      const { run, record } = await open(w, { idsOnly: false, maxRequests: 3 });
      setPlacesRoutes([{ name: 'daily', when: () => true, error: 'daily' }]);

      const result = await record();

      expect(result).toMatchObject({ outcome: 'daily_quota', status: 429, requests: 1, pages: [] });
      expect(await ledgerOf(w.tx, run.runId)).toEqual([]);
      const res = rows<{ released: boolean }>(
        await w.tx.execute(sql`
          select released_at is not null as released from cost_reservations where run_id = ${run.runId}`),
      );
      expect(res).toEqual([{ released: true }]);
    }));

  it('the recorder closes its run without claiming the tile was swept', () =>
    inWorld(async (w) => {
      const { run, record } = await open(w, { idsOnly: false, maxRequests: 3 });
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
      const result = await record();

      await lib.closeRecordingRun(asPg(w.tx), run, result.outcome);

      const r = rows<{ status: string; reason: string | null; finished: boolean }>(
        await w.tx.execute(sql`
          select status, stopped_reason as reason, finished_at is not null as finished
            from runs where id = ${run.runId}`),
      )[0];
      expect(r).toEqual({ status: 'complete', reason: null, finished: true });
      const s = rows<{ status: string; res: string | null }>(
        await w.tx.execute(sql`
          select status, inflight_reservation_id::text as res from run_searches where id = ${run.searchId}`),
      )[0];
      expect(s).toEqual({ status: 'stopped', res: null });
      const t = rows<{ swept: boolean; members: number }>(
        await w.tx.execute(sql`
          select t.last_swept_run_id is not null as swept,
                 (select count(*)::int from place_tile_members m where m.tile_id = t.id) as members
            from place_tiles t where t.org_id = ${w.orgA} and t.tile_key = ${run.tileKey}`),
      )[0];
      expect(t).toEqual({ swept: false, members: 0 });

      // A quota stop is partial, with its reason.
      const second = await open(w, { idsOnly: true, maxRequests: 1 }).catch((e: Error) => e);
      // One active run per org: the first is closed, so a second may open.
      expect(second).not.toBeInstanceOf(Error);
      if (second instanceof Error) return;
      await lib.closeRecordingRun(asPg(w.tx), second.run, 'daily_quota');
      const p = rows<{ status: string; reason: string | null }>(
        await w.tx.execute(sql`
          select status, stopped_reason as reason from runs where id = ${second.run.runId}`),
      )[0];
      expect(p).toEqual({ status: 'partial', reason: 'daily_quota' });
    }));
});
