/**
 * The free IDs-only change check against the real database and the Places replay (plan 04-19,
 * D-16, PLACE-04).
 *
 * What these prove, each where it can fail:
 *   - the diff is written by app.record_change_check: new ids inserted, gone ids get `gone_at`
 *     and are NEVER deleted, the tile's `changed_at` moves only for a change (D-06, D-16);
 *   - a never-checked tile is a baseline, an unchanged tile is not a paid-sweep candidate, and
 *     a leaf now at 60 is `saturated`;
 *   - every page goes through the real meter: reserved, sent with exactly the IDs-only mask,
 *     ledgered at $0 with units 1 (criterion 5 holds for the free SKU too);
 *   - Google's daily quota stops the tile and releases the reservation (D-19), and a listing
 *     that fails part-way records NO diff — a half listing would mark live members gone.
 *
 * 🔴 THE DOUBLE. As in tests/db/places-meter.test.ts: `@/db/with-worker-org` is replaced (doMock
 * + dynamic import, undone in afterAll — the DB suite runs `isolate: false`) by a SAVEPOINT on
 * the test's rolled-back transaction that installs what the real helper installs: the `{o:{id}}`
 * claim, the actor GUC and `set local role authenticated`. No `actAs` on the change check's path.
 *
 * 🔴 THE NETWORK. msw's Places handler (tests/unit/msw/places.ts) is the only endpoint; the
 * server is started with `onUnhandledRequest: 'error'` and closed in afterAll. The lane's config
 * sets a fake key AFTER .env.local, so no real key can reach a request from here.
 */
import { sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@/server/queries/budget';
import type { PlannedSearch } from '@/workflows/places-sweep/reducer';
import { applyResult, initialQueue } from '@/workflows/places-sweep/reducer';
import { server, startReplayServer } from '../unit/msw/server';
import {
  PLACES_ENDPOINT,
  PLACES_PAGES,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
} from '../unit/msw/places';
import { seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { seedPlacesRun, seedRunSearch } from './_places-fixtures';

vi.hoisted(() => {
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/places-check-tile.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set (the non-owner runtime role).',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/places-check-tile.test.ts: the database URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

vi.mock('server-only', () => ({}));

type CheckTile = typeof import('@/lib/places/check-tile');

const state: { tx: Tx | null; workerCalls: number } = { tx: null, workerCalls: 0 };

let checkTile: CheckTile;
let realDb: typeof import('@/db/client').db;

const workerDouble = async <T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const outer = state.tx;
  if (!outer) throw new Error('places-check-tile: no test transaction is open');
  state.workerCalls += 1;
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
  checkTile = await import('@/lib/places/check-tile');
  startReplayServer();
});

afterEach(() => {
  resetPlaces();
  server.resetHandlers();
  server.events.removeAllListeners();
});

afterAll(async () => {
  server.close();
  vi.doUnmock('@/db/with-worker-org');
  state.tx = null;
  await realDb.$client.end({ timeout: 5 });
  vi.resetModules();
  await closeDrizzleTx();
});

const TILE_KEY = 'city:48215/McAllen|plumber|r';
const RECT = { south: 26.15, west: -98.3, north: 26.3, east: -98.18 };
const IDS_ONLY_MASK = 'places.id,nextPageToken';

type World = {
  tx: Tx;
  orgA: string;
  runId: string;
  searchId: string;
  tileId: string;
  input: { runId: string; clerkOrgId: string };
  search: PlannedSearch;
};

function plannedSearch(searchId: string, kind: PlannedSearch['kind'] = 'ids_only'): PlannedSearch {
  return {
    searchId,
    tileKey: TILE_KEY,
    cellKey: 'home_services/48215/McAllen',
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId: '48215\u0000McAllen',
    placesType: 'plumber',
    quadPath: 'r',
    depth: 0,
    rect: RECT,
    parentTileKey: null,
    kind,
    shape: { kind: 'polygon', unitKind: 'city', unitId: '48215\u0000McAllen' },
  };
}

/** Org A (and B), a running change_check run and one planned ids_only search on the McAllen root
 *  tile, with `stored` live members already on the tile — all as the owner. */
function inWorld(
  opts: { stored?: string[]; ceilingRequests?: number },
  fn: (w: World) => Promise<void>,
): Promise<void> {
  return withTxRollback(async (tx) => {
    state.tx = tx;
    state.workerCalls = 0;
    try {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a, {
        kind: 'change_check',
        ceilingRequests: opts.ceilingRequests ?? 10,
      });
      const s = await seedRunSearch(c, a, run.runId, {
        tileKey: TILE_KEY,
        placesType: 'plumber',
        kind: 'ids_only',
        rect: RECT,
      });
      for (const placeId of opts.stored ?? []) {
        await c.query(
          'insert into place_tile_members (org_id, tile_id, place_id) values ($1, $2, $3)',
          [a, s.tileId, placeId],
        );
      }
      await fn({
        tx,
        orgA: a,
        runId: run.runId,
        searchId: s.runSearchId,
        tileId: s.tileId,
        input: { runId: run.runId, clerkOrgId: 'org_A' },
        search: plannedSearch(s.runSearchId),
      });
    } finally {
      state.tx = null;
    }
  });
}

function rows<T>(r: unknown): T[] {
  return r as T[];
}

/** One IDs-only page as Google would serve it: ids and, optionally, the next token. */
function idsPage(ids: string[], nextPageToken?: string): Record<string, unknown> {
  return {
    places: ids.map((id) => ({ id })),
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
  };
}

function serve(pages: Record<string, unknown>[]): void {
  setPlacesRoutes([{ name: 'check', when: () => true, pages }]);
}

async function membersOf(tx: Tx, tileId: string) {
  return rows<{ place_id: string; gone: boolean }>(
    await tx.execute(sql`
      select place_id, gone_at is not null as gone
        from place_tile_members where tile_id = ${tileId} order by place_id`),
  );
}

async function tileOf(tx: Tx, tileId: string) {
  return rows<{ changed: boolean; checked: boolean; saturated: boolean }>(
    await tx.execute(sql`
      select changed_at is not null as changed, last_checked_at is not null as checked, saturated
        from place_tiles where id = ${tileId}`),
  )[0];
}

async function searchOf(tx: Tx, searchId: string) {
  return rows<{
    status: string;
    change_verdict: string | null;
    new_ids: number;
    gone_ids: number;
    results_count: number;
    saturated: boolean;
    res: string | null;
    req: string | null;
  }>(
    await tx.execute(sql`
      select status, change_verdict, new_ids, gone_ids, results_count, saturated,
             inflight_reservation_id::text as res, inflight_request_id as req
        from run_searches where id = ${searchId}`),
  )[0];
}

async function ledgerOf(tx: Tx, runId: string) {
  return rows<{ sku: string; units: number; micro: string }>(
    await tx.execute(sql`
      select sku, units, micro_usd::text as micro
        from cost_ledger where run_id = ${runId} order by occurred_at, id`),
  );
}

async function reservationsOf(tx: Tx, runId: string) {
  return rows<{ settled: boolean; released: boolean; sku: string }>(
    await tx.execute(sql`
      select settled_at is not null as settled, released_at is not null as released, sku
        from cost_reservations where run_id = ${runId} order by created_at, id`),
  );
}

describe('the IDs-only change check (D-16, PLACE-04)', () => {
  it('a change check against a never-checked tile records a baseline', () =>
    inWorld({}, async (w) => {
      serve([idsPage(['synthetic-cc-b', 'synthetic-cc-a'])]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toEqual({ kind: 'checked', tileKey: TILE_KEY, changed: false });
      expect(await membersOf(w.tx, w.tileId)).toEqual([
        { place_id: 'synthetic-cc-a', gone: false },
        { place_id: 'synthetic-cc-b', gone: false },
      ]);
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({
        status: 'done',
        change_verdict: 'baseline',
        new_ids: 2,
        gone_ids: 0,
        results_count: 2,
      });
      // A baseline is not a change: nothing is queued for a paid sweep on its account.
      expect(await tileOf(w.tx, w.tileId)).toMatchObject({ changed: false, checked: true });
    }));

  it('a change check marks new and gone place ids', () =>
    inWorld({ stored: ['synthetic-cc-a', 'synthetic-cc-b', 'synthetic-cc-c'] }, async (w) => {
      serve([idsPage(['synthetic-cc-b', 'synthetic-cc-c', 'synthetic-cc-d'])]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toEqual({ kind: 'checked', tileKey: TILE_KEY, changed: true });
      // `a` is gone — its row is still there, with gone_at set; `d` is new.
      expect(await membersOf(w.tx, w.tileId)).toEqual([
        { place_id: 'synthetic-cc-a', gone: true },
        { place_id: 'synthetic-cc-b', gone: false },
        { place_id: 'synthetic-cc-c', gone: false },
        { place_id: 'synthetic-cc-d', gone: false },
      ]);
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({
        status: 'done',
        change_verdict: 'both',
        new_ids: 1,
        gone_ids: 1,
        results_count: 3,
      });
      expect(await tileOf(w.tx, w.tileId)).toMatchObject({ changed: true, checked: true });
    }));

  it('an unchanged tile is not a paid-sweep candidate', () =>
    inWorld({ stored: ['synthetic-cc-a', 'synthetic-cc-b'] }, async (w) => {
      serve([idsPage(['synthetic-cc-a', 'synthetic-cc-b'])]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toEqual({ kind: 'checked', tileKey: TILE_KEY, changed: false });
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({
        change_verdict: 'unchanged',
        new_ids: 0,
        gone_ids: 0,
      });
      // changed_at untouched; last_checked_at moved.
      expect(await tileOf(w.tx, w.tileId)).toMatchObject({ changed: false, checked: true });
      expect((await membersOf(w.tx, w.tileId)).every((m) => !m.gone)).toBe(true);
    }));

  it('a change check flags a leaf that now returns 60 as saturated', () =>
    inWorld({ stored: ['synthetic-sat-001'] }, async (w) => {
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(placesRequests).toHaveLength(3);
      expect(r).toEqual({ kind: 'checked', tileKey: TILE_KEY, changed: true });
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({
        status: 'done',
        change_verdict: 'saturated',
        results_count: 60,
        saturated: true,
      });
      expect(await tileOf(w.tx, w.tileId)).toMatchObject({ changed: true, saturated: true });
    }));

  it('a change check never sends the Enterprise mask', () =>
    inWorld({}, async (w) => {
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
      const served: unknown[] = [];
      server.events.on('response:mocked', async ({ response }) => {
        served.push(await response.clone().json());
      });

      await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(placesRequests.map((r) => r.mask)).toEqual([
        IDS_ONLY_MASK,
        IDS_ONLY_MASK,
        IDS_ONLY_MASK,
      ]);
      expect(served).toHaveLength(3);
      const keys = new Set(
        served.flatMap((page) =>
          ((page as { places?: Record<string, unknown>[] }).places ?? []).flatMap((p) =>
            Object.keys(p),
          ),
        ),
      );
      expect([...keys]).toEqual(['id']);
    }));

  it('a change check ledgers every page at zero', () =>
    inWorld({}, async (w) => {
      setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);

      await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { sku: 'ts_essentials', units: 1, micro: '0' },
        { sku: 'ts_essentials', units: 1, micro: '0' },
        { sku: 'ts_essentials', units: 1, micro: '0' },
      ]);
      // Every reservation settled, and the cursor is clear.
      expect((await reservationsOf(w.tx, w.runId)).every((r) => r.settled)).toBe(true);
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({ res: null, req: null });
    }));

  it("a change check stops at Google's daily quota", () =>
    inWorld({ stored: ['synthetic-cc-a'] }, async (w) => {
      setPlacesRoutes([{ name: 'daily', when: () => true, error: 'daily' }]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toEqual({ kind: 'stopped', tileKey: TILE_KEY, reason: 'google_daily_quota' });
      const res = await reservationsOf(w.tx, w.runId);
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ released: true, settled: false });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
      // Nothing recorded: the member is untouched and the search carries no verdict.
      expect(await membersOf(w.tx, w.tileId)).toEqual([
        { place_id: 'synthetic-cc-a', gone: false },
      ]);
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({
        change_verdict: null,
        res: null,
        req: null,
      });
    }));

  it('a change check that fails part-way records no diff', () =>
    inWorld({ stored: ['synthetic-cc-a', 'synthetic-cc-z'] }, async (w) => {
      let calls = 0;
      setPlacesRoutes([
        // Evaluated first on every request: the SECOND request is the 503.
        { name: 'second-fails', when: () => ++calls === 2, error: 'unavailable' },
        { name: 'first-page', when: () => true, pages: [idsPage(['synthetic-cc-a'], 'check:p2')] },
      ]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toMatchObject({ kind: 'fail', reason: 'places_unavailable', retryable: true });
      // `z` was not on the one page that arrived — it must NOT be marked gone from half a listing.
      expect(await membersOf(w.tx, w.tileId)).toEqual([
        { place_id: 'synthetic-cc-a', gone: false },
        { place_id: 'synthetic-cc-z', gone: false },
      ]);
      expect((await searchOf(w.tx, w.searchId))?.change_verdict).toBeNull();
      // Page 1 ledgered at zero; page 2's error released with no row.
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { sku: 'ts_essentials', units: 1, micro: '0' },
      ]);
    }));

  it('a rejected change check fails without retry', () =>
    inWorld({}, async (w) => {
      setPlacesRoutes([{ name: 'invalid', when: () => true, error: 'invalid' }]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toEqual({
        kind: 'fail',
        tileKey: TILE_KEY,
        reason: 'places_request_rejected',
        retryable: false,
      });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
    }));

  it('a change check timeout is settled as charged', () =>
    inWorld({}, async (w) => {
      server.use(http.post(PLACES_ENDPOINT, () => HttpResponse.error()));

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });

      expect(r).toMatchObject({ kind: 'fail', reason: 'places_unavailable', retryable: true });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { sku: 'ts_essentials', units: 1, micro: '0' },
      ]);
      expect(await searchOf(w.tx, w.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('a change check refuses an enterprise search before any request', () =>
    inWorld({}, async (w) => {
      serve([idsPage(['synthetic-cc-a'])]);
      const enterprise = plannedSearch(w.searchId, 'enterprise' as PlannedSearch['kind']);

      await expect(
        checkTile.runCheckTile(w.input, enterprise, { mode: 'ids_only' }),
      ).rejects.toThrow(/not an ids_only search/);
      expect(placesRequests).toHaveLength(0);
      expect(state.workerCalls).toBe(0);
    }));

  it("a change check's result satisfies the reducer's contract", () =>
    inWorld({ stored: ['synthetic-cc-a'] }, async (w) => {
      serve([idsPage(['synthetic-cc-a', 'synthetic-cc-b'])]);

      const r = await checkTile.runCheckTile(w.input, w.search, { mode: 'ids_only' });
      if (r.kind === 'fail') throw new Error('expected a checked result');

      const next = applyResult(initialQueue([w.search]), w.search, r);
      expect(next).toMatchObject({ pending: [], searched: 1, stopped: null });
      // Only our ids, counts and enums cross the step boundary.
      expect(Object.keys(r).sort()).toEqual(['changed', 'kind', 'tileKey']);
    }));
});
