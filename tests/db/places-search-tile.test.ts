/**
 * One Enterprise tile search, end to end against the real database and the msw replay (plan
 * 04-18: criteria 1, 3, 4, 5; PLACE-01, PLACE-02, PLACE-03, PLACE-05).
 *
 * The REAL meter, matcher, candidate query and writers run here; only the network is replayed
 * (tests/unit/msw/places.ts — synthetic fixtures, D-20) and only the worker transaction is a
 * double. No Google call is possible: the replay server is started with
 * `onUnhandledRequest: 'error'`.
 *
 * 🔴 THE DOUBLE (tests/db/places-meter.test.ts, the same one). `@/db/with-worker-org` is replaced
 * (vi.doMock + dynamic import, undone in afterAll — this suite runs `isolate: false`) by a
 * SAVEPOINT on the test's rolled-back transaction that installs exactly what the real helper
 * installs: the `{o:{id}}` claim (no subject, no role claim), the actor GUC and
 * `set local role authenticated`. There is no `actAs` on the tile's path. On success the double
 * resets the role and clears both GUCs before releasing, so the owner's assertions that follow
 * (and the M32 hook, which reads mid-request on the same connection) run as the owner.
 */
import { sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@/server/queries/budget';
import type { GeoShapesFile, Rect } from '@/lib/places/tiling';
import type { PlannedSearch } from '@/workflows/places-sweep/reducer';
import { applyResult, initialQueue } from '@/workflows/places-sweep/reducer';
import { rootSpec } from '@/lib/places/tiling';
import geoShapes from '@/seed/data/geo-shapes.json';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { seedPlacesRun, seedPlacesSpine, seedRunSearch, type SpineKey } from './_places-fixtures';
import { server, startReplayServer } from '../unit/msw/server';
import {
  PLACES_ENDPOINT,
  PLACES_PAGES,
  PLACES_SENTINELS,
  onPlacesRequest,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
} from '../unit/msw/places';

// Hoisted above every import: src/env.ts parses process.env at module load and src/db/client.ts
// opens its pool from it (the places-meter prelude). The runtime pool must be the NON-OWNER
// app_user URL; CI names it RUNTIME_DB_URL.
vi.hoisted(() => {
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/places-search-tile.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set (the non-owner runtime role).',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/places-search-tile.test.ts: the database URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

vi.mock('server-only', () => ({}));

type SearchTile = typeof import('@/lib/places/search-tile');
type TileStepResult = import('@/lib/places/search-tile').TileStepResult;

const state: { tx: Tx | null; workerCalls: number } = { tx: null, workerCalls: 0 };

let tile: SearchTile;
let realDb: typeof import('@/db/client').db;

const workerDouble = async <T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const outer = state.tx;
  if (!outer) throw new Error('places-search-tile: no test transaction is open');
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
  tile = await import('@/lib/places/search-tile');
  startReplayServer();
});

afterEach(() => {
  server.resetHandlers();
  resetPlaces();
});

afterAll(async () => {
  server.close();
  vi.doUnmock('@/db/with-worker-org');
  state.tx = null;
  await realDb.$client.end({ timeout: 5 });
  vi.resetModules();
  await closeDrizzleTx();
});

// ─── The world ──────────────────────────────────────────────────────────────────────────

const SHAPES = geoShapes as GeoShapesFile;
const MCALLEN_UNIT = '48215\u0000McAllen';
const MCALLEN = SHAPES.units.find((u) => u.unitKind === 'city' && u.unitId === MCALLEN_UNIT);
if (!MCALLEN) throw new Error('places-search-tile: no McAllen outline in geo-shapes.json');
const MCALLEN_BBOX: Rect = MCALLEN.bbox;

const ROOT = rootSpec({
  clusterKey: 'home_services',
  unitKind: 'city',
  unitId: MCALLEN_UNIT,
  placesType: 'plumber',
  kind: 'enterprise',
  shape: { kind: 'polygon', unitKind: 'city', unitId: MCALLEN_UNIT },
  bbox: MCALLEN_BBOX,
});

const ADMIN_A = {
  o: { id: 'org_A', rol: 'admin' },
  sub: 'user_admin_A',
  role: 'authenticated',
} as const;

type World = {
  tx: Tx;
  orgA: string;
  runId: string;
  search: PlannedSearch;
  biz: Record<SpineKey, string>;
  input: { runId: string; clerkOrgId: string };
};

function inWorld(fn: (w: World) => Promise<void>): Promise<void> {
  return withTxRollback(async (tx) => {
    state.tx = tx;
    state.workerCalls = 0;
    try {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const biz = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a, { ceilingRequests: 20 });
      const seeded = await seedRunSearch(c, a, run.runId, {
        tileKey: ROOT.tileKey,
        placesType: ROOT.placesType,
        rect: ROOT.rect,
      });
      await fn({
        tx,
        orgA: a,
        runId: run.runId,
        search: { ...ROOT, searchId: seeded.runSearchId },
        biz,
        input: { runId: run.runId, clerkOrgId: 'org_A' },
      });
    } finally {
      state.tx = null;
    }
  });
}

function rows<T>(r: unknown): T[] {
  return r as T[];
}

/**
 * The near miss's score, pinned (plan 04-18: "pin its score"). `synthetic-match-tentative` is
 * Ortiz's street number, street and ZIP with a suite, 24 m away, the name `Ortiz Plumbing TX`
 * (pg_trgm 0.833 — under the 0.85 name-signal bar) and a 555 phone (never blockable):
 * name 32 + address 30 + distance 15 + cluster 5 = 82. The review band, never an attachment.
 * The fixture was adjusted once to get here (tests/unit/msw/fixtures/README.md).
 */
const NEAR_MISS_SCORE = 82;

const DEPS = { mode: 'enterprise', shapes: SHAPES } as const;

function run(w: World, search: PlannedSearch = w.search): Promise<TileStepResult> {
  return tile.runSearchTile(w.input, search, DEPS);
}

const MATCH_ROUTE = { name: 'match', when: () => true, pages: PLACES_PAGES.matchPage };
const SATURATED_ROUTE = { name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated };

async function ledgerOf(tx: Tx, runId: string) {
  return rows<{ request_id: string; sku: string; units: number; micro: string }>(
    await tx.execute(sql`
      select request_id, sku, units, micro_usd::text as micro
        from cost_ledger where run_id = ${runId} order by occurred_at, id`),
  );
}

async function reservationsOf(tx: Tx, runId: string) {
  return rows<{ id: string; settled: boolean; released: boolean }>(
    await tx.execute(sql`
      select id::text as id, settled_at is not null as settled, released_at is not null as released
        from cost_reservations where run_id = ${runId} order by created_at, id`),
  );
}

async function searchRow(tx: Tx, searchId: string) {
  return rows<{
    status: string;
    saturated: boolean;
    subdivided: boolean;
    truncated: boolean;
    truncated_why: string | null;
    pages_done: number;
    results_count: number;
    res: string | null;
    req: string | null;
  }>(
    await tx.execute(sql`
      select status, saturated, subdivided, truncated, truncated_why, pages_done, results_count,
             inflight_reservation_id::text as res, inflight_request_id as req
        from run_searches where id = ${searchId}`),
  )[0];
}

async function attachmentsOf(tx: Tx, orgId: string) {
  return rows<{
    place_id: string;
    business_id: string;
    status: string;
    reason: string;
    score: number;
    tie: string | null;
    features: Record<string, unknown>;
  }>(
    await tx.execute(sql`
      select place_id, business_id::text as business_id, status, reason, score,
             tie_business_id::text as tie, features
        from place_attachments where org_id = ${orgId} order by place_id, business_id`),
  );
}

async function outcomesOf(tx: Tx, runId: string): Promise<Record<string, string>> {
  const r = rows<{ place_id: string; outcome: string }>(
    await tx.execute(sql`
      select place_id, outcome from run_place_outcomes where run_id = ${runId}`),
  );
  return Object.fromEntries(r.map((x) => [x.place_id, x.outcome]));
}

// ─── Tests ──────────────────────────────────────────────────────────────────────────────

describe('one Enterprise tile search (04-18)', () => {
  it('no places request leaves without a reservation', () =>
    inWorld(async (w) => {
      setPlacesRoutes([SATURATED_ROUTE]);
      // AT REQUEST TIME, on the test's own connection (the tile holds no transaction open while
      // the request is in flight, so the connection is free): the search's durable cursor must
      // name an OPEN reservation of this run.
      const seen: Array<{
        res: string | null;
        open: boolean;
        run: string | null;
        page: string | undefined;
      }> = [];
      onPlacesRequest(async ({ body }) => {
        const cursor = await searchRow(w.tx, w.search.searchId);
        const res = cursor?.res ?? null;
        const r =
          res === null
            ? []
            : rows<{ open: boolean; run: string }>(
                await w.tx.execute(sql`
                  select (settled_at is null and released_at is null) as open, run_id::text as run
                    from cost_reservations where id = ${res}::uuid`),
              );
        seen.push({
          res,
          open: r[0]?.open === true,
          run: r[0]?.run ?? null,
          page: typeof body.pageToken === 'string' ? body.pageToken : undefined,
        });
      });

      const out = await run(w);
      expect(out.kind).toBe('searched');
      expect(placesRequests).toHaveLength(3);
      expect(seen).toHaveLength(3);
      for (const s of seen) {
        expect(s.res).not.toBeNull();
        expect(s.open).toBe(true);
        expect(s.run).toBe(w.runId);
      }
      // One reservation per page ATTEMPT, never one shared across pages.
      expect(new Set(seen.map((s) => s.res)).size).toBe(3);
      expect(seen.map((s) => s.page)).toEqual([undefined, 'saturated:p2', 'saturated:p3']);
      // And afterwards every one of them is settled, and the cursor is clear.
      const res = await reservationsOf(w.tx, w.runId);
      expect(res).toHaveLength(3);
      expect(res.every((r) => r.settled && !r.released)).toBe(true);
      expect(await searchRow(w.tx, w.search.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('no Places text reaches the database', () =>
    inWorld(async (w) => {
      const TABLES = [
        'place_attachments',
        'place_observations',
        'place_tiles',
        'place_tile_members',
        'run_searches',
        'run_place_outcomes',
        'place_purge_runs',
        'cost_ledger',
        'cost_reservations',
        'runs',
        'events',
      ] as const;
      const snapshot = async (table: string): Promise<string[]> =>
        rows<{ j: string }>(
          await w.tx.execute(
            sql`select row_to_json(t)::text as j from ${sql.raw(table)} t where t.org_id = ${w.orgA}`,
          ),
        ).map((r) => r.j);
      const hits = (texts: string[]) =>
        texts.flatMap((j) => PLACES_SENTINELS.filter((s) => j.includes(s)));

      // The scan is not vacuous: the spine the page matches against DOES carry the names (it is
      // the durable record, D-06), so the same scan over `businesses` must find them.
      expect(hits(await snapshot('businesses'))).toContain('Ortiz Plumbing');

      const before = new Map<string, Set<string>>();
      for (const t of TABLES) before.set(t, new Set(await snapshot(t)));

      setPlacesRoutes([MATCH_ROUTE]);
      const out = await run(w);
      expect(out.kind).toBe('searched');

      let written = 0;
      for (const t of TABLES) {
        const fresh = (await snapshot(t)).filter((j) => !before.get(t)!.has(j));
        written += fresh.length;
        expect({ table: t, hits: hits(fresh) }).toEqual({ table: t, hits: [] });
      }
      // The page really wrote: members, attachments, observations, outcomes, ledger.
      expect(written).toBeGreaterThan(20);
      const obs = rows<{ n: number }>(
        await w.tx.execute(
          sql`select count(*)::int as n from place_observations where run_id = ${w.runId}`,
        ),
      );
      expect(obs[0]?.n).toBeGreaterThan(0);
    }));

  it('the match page attaches, ties, tentatives and counts', () =>
    inWorld(async (w) => {
      setPlacesRoutes([MATCH_ROUTE]);
      const out = await run(w);
      expect(out).toEqual({
        kind: 'searched',
        tileKey: ROOT.tileKey,
        resultsCount: 7,
        saturated: false,
        next: { action: 'done' },
      });

      expect(await outcomesOf(w.tx, w.runId)).toEqual({
        'synthetic-match-ortiz': 'attached',
        'synthetic-match-garza': 'attached',
        'synthetic-match-rio': 'tentative',
        'synthetic-match-valley': 'attached',
        'synthetic-match-tentative': 'tentative',
        'synthetic-match-nothing': 'unmatched',
        'synthetic-match-mexico': 'outside',
      });

      const att = await attachmentsOf(w.tx, w.orgA);
      const of = (place: string) => att.filter((a) => a.place_id === `synthetic-match-${place}`);

      expect(of('ortiz')).toEqual([
        expect.objectContaining({ business_id: w.biz.ortiz, status: 'attached', reason: 'score' }),
      ]);
      expect(of('garza')).toEqual([
        expect.objectContaining({ business_id: w.biz.garza, status: 'attached', reason: 'score' }),
      ]);
      // D-08: one place, two businesses at the attach threshold — both tentative, each naming
      // the other.
      const rio = of('rio');
      expect(rio.map((a) => [a.business_id, a.status, a.reason, a.tie]).sort()).toEqual(
        [
          [w.biz.rio, 'tentative', 'tie', w.biz.rioCo],
          [w.biz.rioCo, 'tentative', 'tie', w.biz.rio],
        ].sort(),
      );
      expect(of('valley')).toEqual([
        expect.objectContaining({ business_id: w.biz.valley, status: 'attached', reason: 'score' }),
      ]);
      expect(of('valley')[0]?.features.rule).toBe('sab_phone_city');
      // The near miss: tentative, its score pinned inside the review band.
      const near = of('tentative');
      expect(near).toEqual([
        expect.objectContaining({ business_id: w.biz.ortiz, status: 'tentative', reason: 'score' }),
      ]);
      expect(near[0]!.score).toBe(NEAR_MISS_SCORE);
      expect(near[0]!.score).toBeGreaterThanOrEqual(80);
      expect(near[0]!.score).toBeLessThan(95);
      expect(of('nothing')).toEqual([]);
      expect(of('mexico')).toEqual([]);

      // Website classes, derived in memory (D-09): the URL itself is nowhere.
      const hosts = rows<{ place_id: string; had: boolean; host: string }>(
        await w.tx.execute(sql`
          select distinct place_id, had_website_uri as had, host_class as host
            from place_observations where run_id = ${w.runId}`),
      );
      const hostOf = (place: string) =>
        hosts.find((h) => h.place_id === `synthetic-match-${place}`);
      expect(hostOf('ortiz')).toMatchObject({ had: false, host: 'none' });
      expect(hostOf('garza')).toMatchObject({ had: true, host: 'business_site_dead' });
      expect(hostOf('rio')).toMatchObject({ had: true, host: 'social' });

      // The search is done, one page, seven results, cursor clear; one ledger row.
      expect(await searchRow(w.tx, w.search.searchId)).toMatchObject({
        status: 'done',
        saturated: false,
        subdivided: false,
        truncated: false,
        pages_done: 1,
        results_count: 7,
        res: null,
        req: null,
      });
      expect(await ledgerOf(w.tx, w.runId)).toHaveLength(1);
    }));

  it('a service-area listing is observed with its flag', () =>
    inWorld(async (w) => {
      setPlacesRoutes([MATCH_ROUTE]);
      await run(w);
      const valley = rows<{ id: string; pure_sab: boolean; business_id: string }>(
        await w.tx.execute(sql`
          select id::text as id, pure_sab, business_id::text as business_id
            from place_observations
           where run_id = ${w.runId} and place_id = 'synthetic-match-valley'`),
      );
      expect(valley).toHaveLength(1);
      expect(valley[0]).toMatchObject({ pure_sab: true, business_id: w.biz.valley });
      // A service area's pin is not a storefront: no coordinate row for it (D-07, D-13).
      const coords = rows<{ n: number }>(
        await w.tx.execute(sql`
          select count(*)::int as n from place_coordinates where observation_id = ${valley[0]!.id}::uuid`),
      );
      expect(coords[0]?.n).toBe(0);
      // Control: a located listing on the same page DID keep its (30-day) coordinate.
      const ortiz = rows<{ n: number }>(
        await w.tx.execute(sql`
          select count(*)::int as n
            from place_coordinates c join place_observations o on o.id = c.observation_id
           where o.run_id = ${w.runId} and o.place_id = 'synthetic-match-ortiz'`),
      );
      expect(ortiz[0]?.n).toBe(1);
    }));

  it('a saturated tile returns its children planned', () =>
    inWorld(async (w) => {
      setPlacesRoutes([SATURATED_ROUTE]);
      const out = await run(w);
      expect(placesRequests).toHaveLength(3);
      if (out.kind !== 'searched') throw new Error('expected searched, got ' + out.kind);
      expect(out.resultsCount).toBe(60);
      expect(out.saturated).toBe(true);
      if (out.next.action !== 'subdivide') throw new Error('expected subdivide');
      const children = out.next.children;
      expect(children.length).toBeGreaterThan(0);
      expect(children.length).toBeLessThanOrEqual(4);
      for (const child of children) {
        expect(child.parentTileKey).toBe(ROOT.tileKey);
        expect(child.depth).toBe(1);
        expect(child.tileKey).toBe(`city:48215/McAllen|plumber|${child.quadPath}`);
        // In memory the unit id stays raw (the partition-hash input) …
        expect(child.unitId).toBe(MCALLEN_UNIT);
        const row = rows<{ status: string; kind: string; parent: string; unit_id: string }>(
          await w.tx.execute(sql`
            select s.status, s.kind, s.parent_tile_key as parent, t.unit_id
              from run_searches s join place_tiles t on t.id = s.tile_id
             where s.id = ${child.searchId}::uuid and s.run_id = ${w.runId}`),
        );
        // … and in the database it is DB-safe.
        expect(row[0]).toEqual({
          status: 'planned',
          kind: 'enterprise',
          parent: ROOT.tileKey,
          unit_id: '48215/McAllen',
        });
      }
      expect(await searchRow(w.tx, w.search.searchId)).toMatchObject({
        status: 'done',
        saturated: true,
        subdivided: true,
        truncated: false,
        pages_done: 3,
        results_count: 60,
      });
      const parent = rows<{ is_leaf: boolean; saturated: boolean }>(
        await w.tx.execute(sql`
          select is_leaf, saturated from place_tiles
           where org_id = ${w.orgA} and tile_key = ${ROOT.tileKey}`),
      );
      expect(parent[0]).toEqual({ is_leaf: false, saturated: true });
    }));

  it('a saturated child that repeats its parent truncates by novelty', () =>
    inWorld(async (w) => {
      setPlacesRoutes([SATURATED_ROUTE]);
      const root = await run(w);
      if (root.kind !== 'searched' || root.next.action !== 'subdivide') {
        throw new Error('expected the root to subdivide');
      }
      const child = root.next.children[0]!;
      // The child's 60 ids are exactly its parent's: nothing new, so it is not split again.
      const out = await run(w, child);
      expect(out).toEqual({
        kind: 'searched',
        tileKey: child.tileKey,
        resultsCount: 60,
        saturated: true,
        next: { action: 'truncate', why: 'novelty' },
      });
      expect(await searchRow(w.tx, child.searchId)).toMatchObject({
        status: 'done',
        truncated: true,
        truncated_why: 'novelty',
        subdivided: false,
      });
    }));

  it('every Enterprise page is ledgered with its SKU', () =>
    inWorld(async (w) => {
      setPlacesRoutes([SATURATED_ROUTE]);
      await run(w);
      const ledger = await ledgerOf(w.tx, w.runId);
      expect(ledger).toHaveLength(3);
      for (const row of ledger) {
        expect(row).toMatchObject({ sku: 'ts_enterprise', units: 1, micro: '0' });
      }
      expect(new Set(ledger.map((r) => r.request_id)).size).toBe(3);
      const calls = rows<{ n: number }>(
        await w.tx.execute(sql`select calls_count as n from runs where id = ${w.runId}`),
      );
      expect(calls[0]?.n).toBe(3);
    }));

  it('a daily quota 429 stops the tile and releases its reservation', () =>
    inWorld(async (w) => {
      setPlacesRoutes([{ name: 'daily', when: () => true, error: 'daily' }]);
      const out = await run(w);
      expect(out).toEqual({ kind: 'stopped', tileKey: ROOT.tileKey, reason: 'google_daily_quota' });
      expect(placesRequests).toHaveLength(1);
      const res = await reservationsOf(w.tx, w.runId);
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ released: true, settled: false });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
      expect(await searchRow(w.tx, w.search.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('a per-minute 429 asks for a retry', () =>
    inWorld(async (w) => {
      setPlacesRoutes([{ name: 'minute', when: () => true, error: 'minute' }]);
      const out = await run(w);
      if (out.kind !== 'fail') throw new Error('expected fail, got ' + out.kind);
      expect(out).toMatchObject({
        tileKey: ROOT.tileKey,
        reason: 'places_unavailable',
        retryable: true,
      });
      expect(out.retryAfterMs).toBeGreaterThan(0);
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
      expect((await reservationsOf(w.tx, w.runId))[0]).toMatchObject({ released: true });
    }));

  it('a 400 fails the run without retry', () =>
    inWorld(async (w) => {
      setPlacesRoutes([{ name: 'invalid', when: () => true, error: 'invalid' }]);
      const out = await run(w);
      expect(out).toEqual({
        kind: 'fail',
        tileKey: ROOT.tileKey,
        reason: 'places_request_rejected',
        retryable: false,
      });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
      expect((await reservationsOf(w.tx, w.runId))[0]).toMatchObject({ released: true });
    }));

  it('a timeout is settled as charged', () =>
    inWorld(async (w) => {
      // A transport failure: the request may have reached Google, so the outcome is unknown.
      server.use(http.post(PLACES_ENDPOINT, () => HttpResponse.error()));
      const out = await run(w);
      expect(out).toEqual({
        kind: 'fail',
        tileKey: ROOT.tileKey,
        reason: 'places_unavailable',
        retryable: true,
      });
      const res = await reservationsOf(w.tx, w.runId);
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ settled: true });
      const ledger = await ledgerOf(w.tx, w.runId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ sku: 'ts_enterprise', units: 1 });
      expect(await searchRow(w.tx, w.search.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('a refused reservation ends the tile and sends nothing', () =>
    inWorld(async (w) => {
      // The cap, lowered below one Enterprise page through the real admin path (fixture setup,
      // outside the tile's path).
      const c = asPg(w.tx);
      await actAs(c, ADMIN_A);
      await c.query('select app.set_budget_cap($1, $2)', ['places', 10000]);
      await actAsOwner(c);

      setPlacesRoutes([MATCH_ROUTE]);
      const out = await run(w);
      expect(out).toEqual({ kind: 'stopped', tileKey: ROOT.tileKey, reason: 'budget_cap_reached' });
      expect(placesRequests.length).toBe(0);
      expect(await reservationsOf(w.tx, w.runId)).toEqual([]);
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
    }));

  it("the step result satisfies the reducer's contract", async () => {
    const results: Array<{ search: PlannedSearch; r: TileStepResult }> = [];
    await inWorld(async (w) => {
      setPlacesRoutes([MATCH_ROUTE]);
      results.push({ search: w.search, r: await run(w) });
    });
    await inWorld(async (w) => {
      setPlacesRoutes([SATURATED_ROUTE]);
      results.push({ search: w.search, r: await run(w) });
    });
    await inWorld(async (w) => {
      setPlacesRoutes([{ name: 'daily', when: () => true, error: 'daily' }]);
      results.push({ search: w.search, r: await run(w) });
    });

    const [done, subdivided, stopped] = results.map(({ search, r }) => {
      if (r.kind === 'fail') throw new Error('a fail is thrown by the step, never applied');
      // The step's return is JSON-serialized into the workflow event log: it must survive that
      // round trip unchanged, and carry no Places text.
      const wire = JSON.parse(JSON.stringify(r)) as typeof r;
      expect(wire).toEqual(r);
      expect(PLACES_SENTINELS.filter((s) => JSON.stringify(r).includes(s))).toEqual([]);
      return applyResult(initialQueue([search]), search, wire);
    });

    expect(done).toMatchObject({ pending: [], searched: 1, saturated: 0, subdivided: 0 });
    const sat = results[1]!.r;
    if (sat.kind !== 'searched' || sat.next.action !== 'subdivide') {
      throw new Error('expected subdivide');
    }
    expect(subdivided).toMatchObject({ searched: 1, saturated: 1, subdivided: 1, stopped: null });
    expect(subdivided!.pending).toEqual(sat.next.children);
    expect(stopped).toMatchObject({ searched: 0, stopped: 'google_daily_quota' });
    expect(stopped!.pending).toEqual([results[2]!.search]);
  });
});
