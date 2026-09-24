/**
 * The places-sweep executor, end to end (plan 04-22; D-14, D-15, D-16, D-19; PLACE-03/04/05).
 *
 * The REAL compiled workflow (`@workflow/vitest` builds the workflow and step bundles and runs
 * them in-process on a Local World), the REAL steps, meter, matcher and writers, against the
 * REAL local database. Only Google is replayed: msw (tests/unit/msw/places.ts — synthetic
 * fixtures, D-20) intercepts `fetch` inside step code, which `vi.mock` cannot reach (04-RESEARCH
 * spike). The replay server runs with `onUnhandledRequest: 'error'`, so no request can leave.
 *
 * Each test seeds its own committed org (tests/workflow/_seed.ts) and every org is torn down in
 * `afterAll` — the lane leaves no `org_wf_%` row behind.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { start } from 'workflow/api';
import { PLACES_IDS_ONLY_FIELD_MASK } from '@/lib/budget/field-mask-tier';
import { PRICE_BOOK } from '@/lib/budget/price-book';
import { quadrants, type GeoShapesFile, type Rect } from '@/lib/places/tiling';
import geoShapes from '@/seed/data/geo-shapes.json';
import { placesSweep, type SweepOutcome } from '@/workflows/places-sweep/workflow';
import { server, startReplayServer } from '../unit/msw/server';
import {
  PLACES_PAGES,
  PLACES_SENTINELS,
  onPlacesRequest,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
  type PlacesRoute,
} from '../unit/msw/places';
import { ownerClient, seedSweepWorld, teardownOrg, type SweepWorld } from './_seed';

// ─── The world ──────────────────────────────────────────────────────────────────────────

const SHAPES = geoShapes as GeoShapesFile;
const MCALLEN = SHAPES.units.find(
  (u) => u.unitKind === 'city' && u.unitId === '48215\u0000McAllen',
);
if (!MCALLEN) throw new Error('places-sweep.test: no McAllen outline in geo-shapes.json');
const MCALLEN_BBOX: Rect = MCALLEN.bbox;

/** DB-safe tile keys, exactly as the planner writes them (tiling.ts tileKeyOf). */
const tileKey = (placesType: string, quadPath: string) =>
  `city:48215/McAllen|${placesType}|${quadPath}`;

/** The six Table A types home_services searches (clusters.json), in planner order. */
const HOME_TYPES = [
  'plumber',
  'electrician',
  'roofing_contractor',
  'painter',
  'locksmith',
  'moving_company',
];

type Json = Record<string, unknown>;

function rectOf(body: Json): Rect | null {
  const r = (body.locationRestriction as { rectangle?: unknown } | undefined)?.rectangle as
    | {
        low: { latitude: number; longitude: number };
        high: { latitude: number; longitude: number };
      }
    | undefined;
  if (!r) return null;
  return {
    south: r.low.latitude,
    west: r.low.longitude,
    north: r.high.latitude,
    east: r.high.longitude,
  };
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return (
    a !== null &&
    a.south === b.south &&
    a.west === b.west &&
    a.north === b.north &&
    a.east === b.east
  );
}

const isType = (t: string) => (b: Json) => b.includedType === t;
const isRoot = (b: Json) => sameRect(rectOf(b), MCALLEN_BBOX);

/** Plumber root → the saturated 60 (3 pages); every plumber child → 12; anything else empty. */
const SATURATED_ROUTES: PlacesRoute[] = [
  {
    name: 'plumber-root-saturated',
    when: (b) => isType('plumber')(b) && isRoot(b),
    pages: PLACES_PAGES.saturated,
  },
  {
    name: 'plumber-child-12',
    when: (b) => isType('plumber')(b) && !isRoot(b),
    pages: PLACES_PAGES.child12,
  },
];

let owner: Client;
const worlds: SweepWorld[] = [];
/** The instant this file started: the world-file scan reads only what this file's runs wrote. */
const FILE_START_MS = Date.now() - 1_000;

async function world(opts: Parameters<typeof seedSweepWorld>[1] = {}): Promise<SweepWorld> {
  const w = await seedSweepWorld(owner, opts);
  worlds.push(w);
  return w;
}

async function sweep(w: SweepWorld): Promise<SweepOutcome> {
  const run = await start(placesSweep, [w.input]);
  return run.returnValue;
}

async function q<T extends Json>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await owner.query(text, params)).rows as T[];
}

async function runRow(runId: string) {
  return (
    await q<{
      status: string;
      stopped_reason: string | null;
      calls_count: number;
      cost: string;
      started: boolean;
      finished: boolean;
    }>(
      `select status, stopped_reason, calls_count, cost_micro_usd::text as cost,
              started_at is not null as started, finished_at is not null as finished
         from runs where id = $1`,
      [runId],
    )
  )[0]!;
}

async function searchesOf(runId: string) {
  return q<{
    tile_key: string;
    status: string;
    saturated: boolean;
    subdivided: boolean;
    truncated: boolean;
    change_verdict: string | null;
    inflight: boolean;
  }>(
    `select tile_key, status, saturated, subdivided, truncated, change_verdict,
            (inflight_reservation_id is not null or inflight_request_id is not null) as inflight
       from run_searches where run_id = $1 order by tile_key`,
    [runId],
  );
}

async function ledgerOf(runId: string) {
  return q<{ reservation_id: string; sku: string; micro: string; units: number }>(
    `select reservation_id, sku, micro_usd::text as micro, units
       from cost_ledger where run_id = $1`,
    [runId],
  );
}

async function openHoldsOf(runId: string): Promise<number> {
  const r = await q<{ n: number }>(
    `select count(*)::int as n from cost_reservations
      where run_id = $1 and settled_at is null and released_at is null`,
    [runId],
  );
  return r[0]!.n;
}

async function finishedEventsOf(runId: string) {
  return q<{ actor_id: string; after: Json }>(
    `select actor_id, after from events
      where entity_type = 'runs' and entity_id = $1 and action = 'places_run_finished'`,
    [runId],
  );
}

beforeAll(async () => {
  owner = await ownerClient();
  startReplayServer();
});

afterEach(() => {
  server.resetHandlers();
  resetPlaces();
});

afterAll(async () => {
  server.close();
  try {
    for (const w of worlds) await teardownOrg(owner, w.orgId);
    const left = await q<{ n: number }>('select count(*)::int as n from orgs where id = any($1)', [
      worlds.map((w) => w.orgId),
    ]);
    if (left[0]!.n !== 0)
      throw new Error(`places-sweep.test: ${left[0]!.n} lane org(s) survived teardown`);
  } finally {
    await owner.end();
  }
});

// ─── The proofs ─────────────────────────────────────────────────────────────────────────

describe('places-sweep workflow', () => {
  it('a saturated tile subdivides and the run completes', async () => {
    const w = await world();
    setPlacesRoutes(SATURATED_ROUTES);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'complete', reason: null });

    const searches = await searchesOf(w.runId);
    const root = searches.find((s) => s.tile_key === tileKey('plumber', 'r'));
    expect(root).toMatchObject({ status: 'done', saturated: true, subdivided: true });
    const children = searches.filter(
      (s) => s.tile_key.startsWith(tileKey('plumber', 'r')) && s !== root,
    );
    // McAllen's polygon touches at least two of its bbox's quadrants; each child was searched.
    expect(children.length).toBeGreaterThanOrEqual(2);
    expect(children.length).toBeLessThanOrEqual(4);
    for (const child of children) {
      expect(child).toMatchObject({ status: 'done', saturated: false, subdivided: false });
    }
    // Every root of every type was searched, and nothing is left in flight.
    for (const t of HOME_TYPES) {
      expect(searches.find((s) => s.tile_key === tileKey(t, 'r'))?.status).toBe('done');
    }
    expect(searches.filter((s) => s.inflight)).toEqual([]);

    // Requests: 3 saturated pages + one per child + one per other type. Every one reserved,
    // ledgered and counted — the three numbers agree.
    const sent = placesRequests.length;
    expect(sent).toBe(3 + children.length + (HOME_TYPES.length - 1));
    const run = await runRow(w.runId);
    const ledger = await ledgerOf(w.runId);
    expect(run).toMatchObject({
      status: 'complete',
      stopped_reason: null,
      started: true,
      finished: true,
    });
    expect(run.calls_count).toBe(sent);
    expect(ledger).toHaveLength(sent);
    expect(new Set(ledger.map((l) => l.sku))).toEqual(new Set(['ts_enterprise']));
    // The cost is the ledger's, and the free allowance makes it 0 for a fresh org.
    expect(run.cost).toBe(String(ledger.reduce((s, l) => s + Number(l.micro), 0)));
    expect(await openHoldsOf(w.runId)).toBe(0);

    // One run-level event, attributed to the workflow.
    const events = await finishedEventsOf(w.runId);
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_id).toBe(`workflow:${w.runId}`);
    expect(events[0]!.after).toEqual({ status: 'complete', reason: null, calls: sent });
  });

  it('a search capped short of 60 on its last page still subdivides', async () => {
    // B-WR-01: strictTypeFiltering can drop places AFTER Google's 60-cap, so a capped search can
    // serve 57 on page 3. Reaching page 3 is the cap; the tile must not close `done` as if it
    // held everything (a silent partial — criterion 3).
    const w = await world();
    const shortP3 = {
      places: (PLACES_PAGES.saturated[2]!.places as unknown[]).slice(0, 17),
    };
    setPlacesRoutes([
      {
        name: 'plumber-root-capped-short',
        when: (b) => isType('plumber')(b) && isRoot(b),
        pages: [PLACES_PAGES.saturated[0]!, PLACES_PAGES.saturated[1]!, shortP3],
      },
      SATURATED_ROUTES[1]!,
      { name: 'other-types-empty', when: () => true, pages: PLACES_PAGES.empty },
    ]);

    expect(await sweep(w)).toEqual({ status: 'complete', reason: null });
    const root = (await searchesOf(w.runId)).find((s) => s.tile_key === tileKey('plumber', 'r'));
    expect(root).toMatchObject({ status: 'done', saturated: true, subdivided: true });
  });

  it('a refused reservation ends the run partial', async () => {
    // A cap one micro-dollar short of one Enterprise page: the admission hold (1 µUSD, as
    // queueRun takes for a free estimate) fits, the first page never does.
    const w = await world({
      capMicroUsd: PRICE_BOOK.ts_enterprise.microUsdPerRequest - 1,
      admissionHoldMicroUsd: 1,
    });
    setPlacesRoutes(SATURATED_ROUTES);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'partial', reason: 'budget_cap_reached' });
    expect(placesRequests).toHaveLength(0);

    const run = await runRow(w.runId);
    expect(run).toMatchObject({
      status: 'partial',
      stopped_reason: 'budget_cap_reached',
      calls_count: 0,
      finished: true,
    });
    expect(await ledgerOf(w.runId)).toEqual([]);
    expect(await openHoldsOf(w.runId)).toBe(0);
    // The stop is a result, never a failure: every root is still listed, unsearched.
    const searches = await searchesOf(w.runId);
    expect(searches.map((s) => s.status)).toEqual(HOME_TYPES.map(() => 'planned'));
  });

  it('the run stops at its request ceiling', async () => {
    const w = await world({ ceilingRequests: 4 });
    setPlacesRoutes(SATURATED_ROUTES);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'partial', reason: 'exceeded_estimate' });
    // The plumber root's 3 pages and electrician's 1; the 5th reservation was refused.
    expect(placesRequests).toHaveLength(4);

    const run = await runRow(w.runId);
    expect(run).toMatchObject({
      status: 'partial',
      stopped_reason: 'exceeded_estimate',
      calls_count: 4,
    });
    expect(await ledgerOf(w.runId)).toHaveLength(4);
    expect(await openHoldsOf(w.runId)).toBe(0);

    // The planned searches remain listed — the report can name what was never reached.
    const searches = await searchesOf(w.runId);
    const planned = searches.filter((s) => s.status === 'planned').map((s) => s.tile_key);
    for (const t of ['roofing_contractor', 'painter', 'locksmith', 'moving_company']) {
      expect(planned).toContain(tileKey(t, 'r'));
    }
    expect(planned.some((k) => k.startsWith(tileKey('plumber', 'r')))).toBe(true);
  });

  it('google daily quota stops the run', async () => {
    const w = await world();
    setPlacesRoutes([{ name: 'daily-quota', when: () => true, error: 'daily', times: 10 }]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'partial', reason: 'google_daily_quota' });
    // M52: never retried into the wall — exactly one request reached Google.
    expect(placesRequests).toHaveLength(1);

    const run = await runRow(w.runId);
    expect(run).toMatchObject({ status: 'partial', stopped_reason: 'google_daily_quota' });
    // The refused attempt was released, not ledgered.
    expect(await ledgerOf(w.runId)).toEqual([]);
    expect(await openHoldsOf(w.runId)).toBe(0);
  });

  it('a rejected request fails the run without retry', async () => {
    const w = await world();
    setPlacesRoutes([{ name: 'invalid', when: () => true, error: 'invalid', times: 10 }]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'failed', reason: 'places_request_rejected' });
    expect(placesRequests).toHaveLength(1);

    const run = await runRow(w.runId);
    expect(run).toMatchObject({
      status: 'failed',
      stopped_reason: 'places_request_rejected',
      finished: true,
    });
    expect(await ledgerOf(w.runId)).toEqual([]);
    expect(await openHoldsOf(w.runId)).toBe(0);
    expect(await finishedEventsOf(w.runId)).toHaveLength(1);
  });

  it('a 5xx is retried and the run completes', async () => {
    // RetryableError, not a stop and not a failure. (A per-minute 429 takes the same path with
    // the client's Retry-After — 60 s when Google sends none, too long for a lane test.)
    const w = await world();
    setPlacesRoutes([
      { name: 'down-once', when: isType('plumber'), error: 'unavailable', times: 1 },
      { name: 'plumber-child', when: isType('plumber'), pages: PLACES_PAGES.child12 },
    ]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'complete', reason: null });
    // The plumber root twice (503, then served), every other root once.
    const plumber = placesRequests.filter((r) => r.body.includedType === 'plumber');
    expect(plumber).toHaveLength(2);
    expect(placesRequests).toHaveLength(HOME_TYPES.length + 1);
    // The 503 attempt was released: one ledger row per SERVED request, every request counted.
    expect(await ledgerOf(w.runId)).toHaveLength(HOME_TYPES.length);
    expect((await runRow(w.runId)).calls_count).toBe(HOME_TYPES.length + 1);
    expect(await openHoldsOf(w.runId)).toBe(0);
  });

  it('a page that fails mid-tile is retried in the step and no page is bought twice', async () => {
    // B-CR-02: page 3 of the saturated plumber root answers 503 once. The page token lives only
    // in the step's memory, so a step-level retry would start again at page 1 and re-buy pages
    // 1 and 2 (6 root requests). Retried in the step, it is 4: p1, p2, p3 (503), p3.
    const w = await world();
    let rootCalls = 0;
    setPlacesRoutes([
      {
        name: 'root-p3-down-once',
        when: (b) => isType('plumber')(b) && isRoot(b) && ++rootCalls === 3,
        error: 'unavailable',
        times: 1,
      },
      ...SATURATED_ROUTES,
      { name: 'other-types-empty', when: (b) => !isType('plumber')(b), pages: PLACES_PAGES.empty },
    ]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'complete', reason: null });

    const root = placesRequests.filter((r) => isType('plumber')(r.body) && isRoot(r.body));
    expect(root.map((r) => r.body.pageToken)).toEqual([
      undefined,
      'saturated:p2',
      'saturated:p3',
      'saturated:p3',
    ]);
    // Every attempt was its own reservation and counted; the 503 was released, not ledgered.
    const run = await runRow(w.runId);
    const ledger = await ledgerOf(w.runId);
    expect(run.calls_count).toBe(placesRequests.length);
    expect(ledger).toHaveLength(placesRequests.length - 1);
    expect(await openHoldsOf(w.runId)).toBe(0);
    const searches = await searchesOf(w.runId);
    expect(searches.find((s) => s.tile_key === tileKey('plumber', 'r'))).toMatchObject({
      status: 'done',
      saturated: true,
      subdivided: true,
    });
  });

  it('a database refusal after a bought page fails the run without buying it again', async () => {
    // B-CR-02 case 2 / B-WR-07: a place id outside the writer's alphabet makes
    // app.record_places_page refuse with 22023 — AFTER the page was bought. The refusal is the
    // same on every retry, so it is fatal: one request, one charged ledger row, run failed.
    const w = await world();
    const badPage = {
      places: [
        {
          id: 'synthetic bad id',
          displayName: { text: 'Synthetic Refused Plumber' },
          formattedAddress: '77 Synthetic Refused St, McAllen, TX 78501',
          location: { latitude: 26.2, longitude: -98.23 },
        },
      ],
    };
    setPlacesRoutes([
      { name: 'plumber-refused', when: isType('plumber'), pages: [badPage] },
      { name: 'other-types-empty', when: () => true, pages: PLACES_PAGES.empty },
    ]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'failed', reason: 'places_unavailable' });
    expect(placesRequests.filter((r) => isType('plumber')(r.body))).toHaveLength(1);
    // The rolled-back page left its attempt in flight; finishRun settled it AS CHARGED.
    const ledger = await ledgerOf(w.runId);
    expect(ledger).toHaveLength(placesRequests.length);
    expect(await openHoldsOf(w.runId)).toBe(0);
    expect((await searchesOf(w.runId)).filter((s) => s.inflight)).toEqual([]);
    // The step failed with the SQLSTATE, read through drizzle's `.cause` (B-WR-07).
    const scan = scanWorldFiles(Date.now() - 120_000);
    expect([...scan.raw, ...scan.payloads].some((t) => t.includes('step_error:22023'))).toBe(true);
  });

  it('a step that keeps failing stops retrying and fails the run', async () => {
    const w = await world();
    setPlacesRoutes([{ name: 'down', when: () => true, error: 'unavailable', times: 100 }]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'failed', reason: 'places_unavailable' });
    // searchTile.maxRetries = 3: the first attempt and three retries, then the run fails.
    expect(placesRequests).toHaveLength(4);
    expect(await ledgerOf(w.runId)).toEqual([]);
    expect(await openHoldsOf(w.runId)).toBe(0);
  });

  it('a change check run diffs the stored leaf tiles', async () => {
    const [r0, r1] = quadrants(MCALLEN_BBOX);
    const ids = (PLACES_PAGES.idsOnly[0]!.places as Array<{ id: string }>).map((p) => p.id);
    const w = await world({
      kind: 'change_check',
      admissionHoldMicroUsd: 1,
      extra: async (c, orgId) => {
        // The tree a previous sweep drew: the plumber root was split; r0 and r1 are its leaves.
        const tile = async (quadPath: string, rect: Rect, isLeaf: boolean) =>
          (
            await c.query<{ id: string }>(
              `insert into place_tiles (org_id, tile_key, unit_kind, unit_id, places_type,
                                        quad_path, depth, south, west, north, east, is_leaf,
                                        last_swept_at)
               values ($1, $2, 'city', '48215/McAllen', 'plumber', $3, $4, $5, $6, $7, $8, $9,
                       now() - interval '7 days')
               returning id`,
              [
                orgId,
                tileKey('plumber', quadPath),
                quadPath,
                quadPath.length - 1,
                rect.south,
                rect.west,
                rect.north,
                rect.east,
                isLeaf,
              ],
            )
          ).rows[0]!.id;
        await tile('r', MCALLEN_BBOX, false);
        const leaf0 = await tile('r0', r0!, true);
        await tile('r1', r1!, true);
        // r0 held five of the ids it will list, plus one it no longer lists.
        for (const placeId of [...ids.slice(0, 5), 'synthetic-gone-01']) {
          await c.query(
            'insert into place_tile_members (org_id, tile_id, place_id) values ($1, $2, $3)',
            [orgId, leaf0, placeId],
          );
        }
      },
    });
    setPlacesRoutes([
      {
        name: 'r0-ids',
        when: (b) => isType('plumber')(b) && sameRect(rectOf(b), r0!),
        pages: PLACES_PAGES.idsOnly,
      },
    ]);

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'complete', reason: null });

    // The plumber root is NOT listed again — its stored leaves are; every other type (no
    // stored tree) lists its root.
    const searches = await searchesOf(w.runId);
    const byKey = new Map(searches.map((s) => [s.tile_key, s]));
    expect(byKey.has(tileKey('plumber', 'r'))).toBe(false);
    expect(byKey.get(tileKey('plumber', 'r0'))).toMatchObject({
      status: 'done',
      change_verdict: 'both',
    });
    expect(byKey.get(tileKey('plumber', 'r1'))).toMatchObject({
      status: 'done',
      change_verdict: 'baseline',
    });
    for (const t of HOME_TYPES.slice(1)) {
      expect(byKey.get(tileKey(t, 'r'))).toMatchObject({
        status: 'done',
        change_verdict: 'baseline',
      });
    }
    expect(searches.every((s) => s.change_verdict !== null)).toBe(true);

    // Every request carried the IDs-only mask, and every one is a free, ledgered call.
    expect(placesRequests).toHaveLength(searches.length);
    expect(new Set(placesRequests.map((r) => r.mask))).toEqual(
      new Set([PLACES_IDS_ONLY_FIELD_MASK.join(',')]),
    );
    const ledger = await ledgerOf(w.runId);
    expect(ledger).toHaveLength(searches.length);
    expect(ledger.every((l) => l.sku === 'ts_essentials' && l.micro === '0')).toBe(true);

    // The gone member is marked, never deleted.
    const gone = await q<{ gone: boolean }>(
      `select m.gone_at is not null as gone from place_tile_members m
         join place_tiles t on t.id = m.tile_id
        where t.org_id = $1 and m.place_id = 'synthetic-gone-01'`,
      [w.orgId],
    );
    expect(gone).toEqual([{ gone: true }]);
  });

  it('the admission hold is released when the run begins', async () => {
    const w = await world();
    const before = await q<{ reserved: string }>(
      `select reserved_micro_usd::text as reserved from budget_periods
        where org_id = $1 and provider = 'places'`,
      [w.orgId],
    );
    expect(before[0]!.reserved).toBe(String(PRICE_BOOK.ts_enterprise.microUsdPerRequest));

    const outcome = await sweep(w);
    expect(outcome).toEqual({ status: 'complete', reason: null });

    const hold = await q<{ released: boolean; settled: boolean }>(
      `select released_at is not null as released, settled_at is not null as settled
         from cost_reservations where id = $1`,
      [w.admissionReservationId],
    );
    expect(hold).toEqual([{ released: true, settled: false }]);
    // M53: released, never settled — no ledger row carries the admission hold's id, so the
    // free allowance never counts a request that was not made.
    const ledger = await ledgerOf(w.runId);
    expect(ledger.filter((l) => l.reservation_id === w.admissionReservationId)).toEqual([]);
    expect(ledger).toHaveLength(HOME_TYPES.length);
    const after = await q<{ reserved: string }>(
      `select reserved_micro_usd::text as reserved from budget_periods
        where org_id = $1 and provider = 'places'`,
      [w.orgId],
    );
    expect(after[0]!.reserved).toBe('0');
  });

  it('a terminal status set by an operator is never overwritten', async () => {
    // T-4-03 / Pitfall 5: the kill lever for a run pinned to an old deployment is the row
    // itself. The operator fails the run while its first request is in flight.
    const w = await world();
    let killed = false;
    onPlacesRequest(async () => {
      if (killed) return;
      killed = true;
      await owner.query(
        `update runs set status = 'failed', stopped_reason = 'abandoned', finished_at = now()
          where id = $1`,
        [w.runId],
      );
    });

    const outcome = await sweep(w);
    // The next reservation saw a run that is not running; finishRun's guard matched nothing and
    // reported the operator's verdict instead of writing its own.
    expect(outcome).toEqual({ status: 'failed', reason: 'abandoned' });
    expect(placesRequests).toHaveLength(1);
    expect(await runRow(w.runId)).toMatchObject({ status: 'failed', stopped_reason: 'abandoned' });
    expect(await finishedEventsOf(w.runId)).toEqual([]);
    // The request that was already in flight is still ledgered, and nothing is left held.
    expect(await ledgerOf(w.runId)).toHaveLength(1);
    expect(await openHoldsOf(w.runId)).toBe(0);
  });

  it('a run another org cannot see is never executed', async () => {
    const victim = await world();
    const attacker = await world();
    setPlacesRoutes(SATURATED_ROUTES);

    // T-4-06 / M46: the attacker's org, the victim's run id.
    const run = await start(placesSweep, [
      { runId: victim.runId, clerkOrgId: attacker.clerkOrgId },
    ]);
    await expect(run.returnValue).rejects.toThrow();
    expect(placesRequests).toHaveLength(0);
    expect(await runRow(victim.runId)).toMatchObject({ status: 'queued', calls_count: 0 });
    expect(await searchesOf(victim.runId)).toEqual([]);
    expect(await openHoldsOf(victim.runId)).toBe(1);
    // Close both worlds' active slots the ordinary way, so teardown meets finished runs.
    expect(await sweep(victim)).toEqual({ status: 'complete', reason: null });
    expect(await sweep(attacker)).toEqual({ status: 'complete', reason: null });
  });

  it('no step returns Places content', async () => {
    // Two runs whose steps handled Places text in memory: the saturated tree and the match page.
    const saturated = await world();
    setPlacesRoutes(SATURATED_ROUTES);
    const a = await start(placesSweep, [saturated.input]);
    const outA = await a.returnValue;
    resetPlaces();

    const matched = await world();
    setPlacesRoutes([{ name: 'match', when: isType('plumber'), pages: PLACES_PAGES.matchPage }]);
    const b = await start(placesSweep, [matched.input]);
    const outB = await b.returnValue;
    expect(outA.status).toBe('complete');
    expect(outB.status).toBe('complete');

    // Positive control on the matcher: the match page did attach spine businesses, so Places
    // text really was in these steps' memory.
    const attached = await q<{ n: number }>(
      `select count(*)::int as n from place_attachments where org_id = $1`,
      [matched.orgId],
    );
    expect(attached[0]!.n).toBeGreaterThan(0);
    // B-CR-01: an ADDRESSED US listing attached — the fixtures carry no `, USA` (regionCode=US
    // omits it), so a matcher keyed on that suffix would leave only the address-less SABs.
    const addressed = await q<{ status: string }>(
      `select status from place_attachments
        where org_id = $1 and place_id = 'synthetic-match-ortiz'`,
      [matched.orgId],
    );
    expect(addressed).toEqual([{ status: 'attached' }]);

    const scan = scanWorldFiles(FILE_START_MS);
    // Positive controls on the scan: it read this file's step payloads (the plumber root tile
    // key and both run ids are in them), and none of them was encrypted past reading.
    expect(scan.encrypted).toBe(0);
    expect(scan.payloads.length).toBeGreaterThan(0);
    const all = scan.payloads.join('\n');
    expect(all).toContain(tileKey('plumber', 'r'));
    expect(all).toContain(saturated.runId);
    expect(all).toContain(matched.runId);

    const texts = [...scan.payloads, ...scan.raw, JSON.stringify(outA), JSON.stringify(outB)];
    const hits = PLACES_SENTINELS.filter((s) => texts.some((t) => t.includes(s)));
    expect(hits).toEqual([]);

    // No U+0000 crossed a step boundary (./wire.ts): neither raw nor as a JSON escape.
    expect(scan.payloads.filter((p) => p.includes('\u0000') || p.includes('\\u0000'))).toEqual([]);
  });
});

// ─── The world-file scan ────────────────────────────────────────────────────────────────

/**
 * Every file under `.workflow-data/` (the Local World's runs, steps and events — written since
 * `sinceMs`) and `.workflow-vitest/` (the compiled bundles), read raw; and every binary payload
 * inside the world's JSON (`{ __type: 'Uint8Array', data: <base64> }`, world-local's encoding)
 * decoded past its 4-byte format prefix — the devalue text a step received or returned. A raw
 * read alone would be blind: the payloads are base64.
 */
function scanWorldFiles(sinceMs: number): { raw: string[]; payloads: string[]; encrypted: number } {
  const root = process.cwd();
  const raw: string[] = [];
  const payloads: string[] = [];
  let encrypted = 0;

  const walk = (dir: string, filter: (mtimeMs: number) => boolean) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p, filter);
        continue;
      }
      if (!filter(st.mtimeMs)) continue;
      const text = readFileSync(p, 'utf8');
      raw.push(text);
      if (!name.endsWith('.json')) continue;
      try {
        JSON.parse(text, (_k, v: unknown) => {
          if (
            typeof v === 'object' &&
            v !== null &&
            (v as { __type?: unknown }).__type === 'Uint8Array' &&
            typeof (v as { data?: unknown }).data === 'string'
          ) {
            const bytes = Buffer.from((v as { data: string }).data, 'base64');
            const format = bytes.subarray(0, 4).toString('utf8');
            if (format === 'encr') encrypted += 1;
            else payloads.push(bytes.subarray(4).toString('utf8'));
          }
          return v;
        });
      } catch {
        // Not JSON after all (a lock or a partial write): the raw read above still covers it.
      }
    }
  };

  walk(join(root, '.workflow-data'), (m) => m >= sinceMs);
  walk(join(root, '.workflow-vitest'), () => true);
  return { raw, payloads, encrypted };
}
