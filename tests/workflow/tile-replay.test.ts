/**
 * B-CR-02 (case 3): a tile step that already FINISHED is re-executed — at-least-once delivery,
 * or a crash between the step body finishing and its completion being recorded. The workflow
 * runtime cannot be made to do that on demand, so the step BODIES are driven directly, twice,
 * against the REAL local database and the msw replay (the same modules the step bundle runs;
 * only Google is replayed, and no request can leave — `onUnhandledRequest: 'error'`).
 *
 * The property: the second execution buys NOTHING and returns the first execution's result, and
 * (for a change check) does not overwrite the verdict the first one recorded.
 */
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withWorkerOrg } from '@/db/with-worker-org';
import { runCheckTile } from '@/lib/places/check-tile';
import { planRunSearches, runSearchTile } from '@/lib/places/search-tile';
import { rootSpec, type GeoShapesFile } from '@/lib/places/tiling';
import geoShapes from '@/seed/data/geo-shapes.json';
import type { PlannedSearch } from '@/workflows/places-sweep/reducer';
import { server, startReplayServer } from '../unit/msw/server';
import { PLACES_PAGES, placesRequests, resetPlaces, setPlacesRoutes } from '../unit/msw/places';
import { ownerClient, seedSweepWorld, teardownOrg, type SweepWorld } from './_seed';

const SHAPES = geoShapes as GeoShapesFile;
const MCALLEN_ID = '48215\u0000McAllen';
const MCALLEN = SHAPES.units.find((u) => u.unitKind === 'city' && u.unitId === MCALLEN_ID);
if (!MCALLEN) throw new Error('tile-replay.test: no McAllen outline in geo-shapes.json');

let owner: Client;
const worlds: SweepWorld[] = [];

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
  } finally {
    await owner.end();
    const { db } = await import('@/db/client');
    await db.$client.end({ timeout: 5 });
  }
});

/** A committed world whose run is RUNNING, with the McAllen plumber root planned. */
async function plannedRoot(kind: 'full_sweep' | 'change_check'): Promise<{
  w: SweepWorld;
  search: PlannedSearch;
}> {
  const w = await seedSweepWorld(owner, {
    kind,
    ...(kind === 'change_check' ? { admissionHoldMicroUsd: 1 } : {}),
  });
  worlds.push(w);
  await owner.query(
    `update runs set status = 'running', started_at = now(), heartbeat_at = now() where id = $1`,
    [w.runId],
  );
  const root = rootSpec({
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId: MCALLEN_ID,
    placesType: 'plumber',
    kind: kind === 'change_check' ? 'ids_only' : 'enterprise',
    shape: { kind: 'polygon', unitKind: 'city', unitId: MCALLEN_ID },
    bbox: MCALLEN!.bbox,
  });
  const [search] = await withWorkerOrg(w.clerkOrgId, `workflow:${w.runId}`, (tx) =>
    planRunSearches(tx, w.runId, [root]),
  );
  return { w, search: search! };
}

async function ledgerCount(runId: string): Promise<number> {
  const r = await owner.query<{ n: number }>(
    'select count(*)::int as n from cost_ledger where run_id = $1',
    [runId],
  );
  return r.rows[0]!.n;
}

describe('a finished tile step re-executed (B-CR-02)', () => {
  it('a finished search tile re-executed buys nothing and returns the same result', async () => {
    const { w, search } = await plannedRoot('full_sweep');
    setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
    const deps = { mode: 'enterprise' as const, shapes: SHAPES };

    const first = await runSearchTile(w.input, search, deps);
    expect(first.kind).toBe('searched');
    if (first.kind !== 'searched') return;
    expect(first.next.action).toBe('subdivide');
    expect(placesRequests).toHaveLength(3);
    const ledgered = await ledgerCount(w.runId);
    expect(ledgered).toBe(3);

    const again = await runSearchTile(w.input, search, deps);
    // Not one more request, not one more ledger row — and the SAME result, children and their
    // search ids included (plan_run_searches is idempotent per run × tile).
    expect(placesRequests).toHaveLength(3);
    expect(await ledgerCount(w.runId)).toBe(ledgered);
    expect(again).toEqual(first);
  });

  it('a page hold outlives the abandoned-run reclaim', async () => {
    // A-WR-08 (TS half): a crashed attempt's hold is settled AS CHARGED by settleInFlight when
    // the step replays — after the workflow's backoff, possibly after admission's 30-minute
    // abandoned reclaim. At the 10-minute default TTL the expiry self-heal would already have
    // released it, racing the late settle; a page hold lives an hour.
    const { w, search } = await plannedRoot('full_sweep');
    setPlacesRoutes([{ name: 'match', when: () => true, pages: PLACES_PAGES.matchPage }]);
    await runSearchTile(w.input, search, { mode: 'enterprise', shapes: SHAPES });
    const holds = await owner.query<{ minutes: number }>(
      `select extract(epoch from (expires_at - created_at)) / 60 as minutes
         from cost_reservations
        where run_id = $1 and id <> $2`,
      [w.runId, w.admissionReservationId],
    );
    expect(holds.rows).toHaveLength(1);
    expect(Number(holds.rows[0]!.minutes)).toBeGreaterThanOrEqual(59);
  });

  it('a finished change check re-executed lists nothing and keeps its verdict', async () => {
    const { w, search } = await plannedRoot('change_check');
    setPlacesRoutes([{ name: 'ids', when: () => true, pages: PLACES_PAGES.idsOnly }]);

    const first = await runCheckTile(w.input, search, { mode: 'enterprise' });
    expect(first).toEqual({ kind: 'checked', tileKey: search.tileKey, changed: false });
    expect(placesRequests).toHaveLength(1);

    const again = await runCheckTile(w.input, search, { mode: 'enterprise' });
    expect(placesRequests).toHaveLength(1);
    expect(again).toEqual(first);
    const verdict = await owner.query<{ change_verdict: string }>(
      'select change_verdict from run_searches where id = $1',
      [search.searchId],
    );
    // A second diff against the membership the first one wrote would have said `unchanged`.
    expect(verdict.rows[0]!.change_verdict).toBe('baseline');
  });
});
