/**
 * Phase 4 plan 20. The run report's data layer (D-17; criterion 3) against the WRITER'S REAL ROWS.
 *
 * 🔴 PRODUCER→CONSUMER CONTRACT (Phase 3's `lng`-vs-`lon` lesson: parallel plans meet at data
 * contracts). Nothing the report reads is hand-inserted into a Places table. Every row comes
 * from the shipped producers, called as the tenant would call them:
 *   * searches and tiles — `app.plan_run_searches` (04-11);
 *   * progress flags — `app.mark_run_search` (04-11), the only writer of saturated / subdivided /
 *     truncated / truncated_why;
 *   * outcomes, attachments, observations — `app.record_places_page` (04-15) fed a `PageRecord`
 *     built by the real chain `toPlaceForMatch` → `decide` → `toPageRecord`;
 *   * change-check verdicts — `app.record_change_check` (04-15);
 *   * the ledger — `app.reserve_budget` + `app.settle_reservation` (Phase 2 meter; 04-16's
 *     `settleInTx` calls exactly these, units 1 per request).
 * The only owner-side seeds are the spine businesses and the preset/version/run rows
 * (`seedPlacesSpine`, `seedPlacesRun`), neither of which is a Places table.
 *
 * Driven through the SHIPPED query (`readRunReport`) on the RUNTIME driver (`_drizzle-tx.ts`:
 * postgres.js, `prepare: false`) as a Clerk user under RLS — not a service-role read that is
 * blind to grants.
 *
 * Mutations (each applied to src/server/queries/run-report.ts, watched red on the named test,
 * reverted, `git diff` clean — 04-20-SUMMARY lists them):
 *   R1  `stillTruncated` counts `saturated` instead of `truncated` → "run report counts truncated tiles"
 *   R2  the website split drops `pa.status = 'attached'` → "run report splits the website signal …"
 *   R3  `byCluster` from the outcomes (inner) instead of the version's clusters → "… zero rows included"
 *   R4  `stillSubdividing` ignores the terminal gate → "… still subdividing when a run stopped …"
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';

import { periodStart } from '@/lib/budget/period';
import type { HostClass } from '@/lib/places/host-class';
import {
  decide,
  toPlaceForMatch,
  type PlaceFeatures,
  type ScoredCandidate,
} from '@/lib/places/match';
import { toPageRecord, type PageRecordItem } from '@/lib/places/page-record';
import { readRunReport, type RunReport } from '@/server/queries/run-report';
import type { Tx } from '@/server/queries/budget';

import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedPlacesRun,
  seedPlacesSpine,
  type SpineKey,
} from './_places-fixtures';

// `server-only` throws outside a React Server Component graph.
vi.mock('server-only', () => ({}));

afterAll(async () => {
  await closeDrizzleTx();
});

const UNIT = '48215/McAllen';
const ROOT = `city:${UNIT}|plumber|r`;
const CTX = { clusterKey: 'home_services', queriedCity: 'McAllen' };

const FEATURES: PlaceFeatures = {
  name: 30,
  phone: 40,
  address: 25,
  distance: 0,
  cluster: 5,
  nameSim: 1,
  distanceM: 12,
  signals: ['name', 'phone', 'address'],
  listingPhone: 1,
  listingLocation: 1,
};

type Spine = Record<SpineKey, string>;

/** One planned search, in the element shape `app.plan_run_searches` reads. */
function searchSpec(
  quad: string,
  opts: { kind?: 'enterprise' | 'ids_only'; clusterKey?: string } = {},
): Record<string, unknown> {
  const clusterKey = opts.clusterKey ?? 'home_services';
  return {
    tileKey: `city:${UNIT}|plumber|${quad}`,
    cellKey: `${clusterKey}/${UNIT}`,
    clusterKey,
    unitKind: 'city',
    unitId: UNIT,
    placesType: 'plumber',
    quadPath: quad,
    depth: quad.length - 1,
    south: 26.15,
    west: -98.3,
    north: 26.3,
    east: -98.18,
    parentTileKey: quad === 'r' ? null : ROOT,
    kind: opts.kind ?? 'enterprise',
  };
}

/** As the tenant: plan the searches; returns search ids by quad path. */
async function plan(
  c: Client,
  runId: string,
  specs: Record<string, unknown>[],
): Promise<Record<string, string>> {
  const r = await c.query<{ search_id: string; tile_key: string }>(
    'select search_id, tile_key from app.plan_run_searches($1, $2::jsonb)',
    [runId, JSON.stringify(specs)],
  );
  const out: Record<string, string> = {};
  for (const row of r.rows) out[row.tile_key.split('|')[2]!] = row.search_id;
  return out;
}

async function mark(c: Client, searchId: string, state: Record<string, unknown>): Promise<void> {
  await c.query('select app.mark_run_search($1, $2::jsonb)', [searchId, JSON.stringify(state)]);
}

function cand(businessId: string, score: number): ScoredCandidate {
  return { businessId, score, features: FEATURES };
}

/** One listing through the real producer chain (as tests/db/places-writer.test.ts). */
function listing(
  placeId: string,
  cands: ScoredCandidate[],
  opts: { outside?: boolean; host?: HostClass } = {},
): PageRecordItem {
  const pfm = toPlaceForMatch(
    {
      id: placeId,
      formattedAddress: opts.outside
        ? 'Calle 1, Reynosa, Tamps., Mexico'
        : 'McAllen, TX 78501, USA',
      location: { latitude: 26.2159, longitude: -98.2336 },
      pureServiceAreaBusiness: false,
    },
    CTX,
  );
  const host = opts.host ?? 'none';
  return {
    decision: decide(pfm, cands),
    pureSab: pfm.pureSab,
    hadWebsiteUri: host !== 'none',
    hostClass: host,
    lat: pfm.lat,
    lng: pfm.lng,
  };
}

async function writePage(c: Client, searchId: string, items: PageRecordItem[]): Promise<void> {
  const record = toPageRecord({ page: 1, sku: 'ts_enterprise', resultsSoFar: items.length, items });
  await c.query('select app.record_places_page($1, $2::jsonb)', [searchId, JSON.stringify(record)]);
}

let requestSeq = 0;

/**
 * As the tenant: one metered request — reserve, then settle at `microUsd` with units 1, exactly
 * the two definers 04-16's `settleInTx` calls. A zero-price request still holds one µUSD
 * (reserve_budget refuses a zero estimate), as the meter does.
 */
async function ledger(
  c: Client,
  runId: string,
  sku: 'ts_enterprise' | 'ts_essentials',
  microUsd: number,
): Promise<void> {
  const res = await c.query<{ reservation_id: string | null }>(
    'select reservation_id from app.reserve_budget($1, $2::date, $3::bigint, $4::uuid, $5)',
    ['places', periodStart(new Date()), String(Math.max(microUsd, 1)), runId, sku],
  );
  const reservationId = res.rows[0]?.reservation_id;
  if (!reservationId) throw new Error('ledger: the meter refused the reservation');
  requestSeq += 1;
  const settled = await c.query<{ ok: boolean }>(
    'select app.settle_reservation($1::uuid, $2, $3::bigint, 1, $4, $5) as ok',
    [reservationId, `run-report-test:${runId}:${requestSeq}`, String(microUsd), sku, 'places'],
  );
  expect(settled.rows[0]?.ok).toBe(true);
}

async function report(tx: Tx, runId: string): Promise<RunReport> {
  const r = await readRunReport(tx, runId);
  if (!r) throw new Error('report: the run came back null for its own org');
  return r;
}

type Setup = { a: string; b: string; spine: Spine; runId: string };

async function setup(c: Client, opts: Parameters<typeof seedPlacesRun>[2] = {}): Promise<Setup> {
  const { a, b } = await seedTwoOrgs(c);
  const spine = await seedPlacesSpine(c, a);
  const run = await seedPlacesRun(c, a, { ceilingRequests: 100, ...opts });
  return { a, b, spine, runId: run.runId };
}

describe('run report (D-17, criterion 3)', () => {
  it('run report counts requests by SKU from the ledger', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c);
      await actAs(c, CLAIMS_A);

      // 3 Enterprise (two inside the free 1,000, one paid) and 2 Essentials (always free).
      await ledger(c, s.runId, 'ts_enterprise', 0);
      await ledger(c, s.runId, 'ts_enterprise', 0);
      await ledger(c, s.runId, 'ts_enterprise', 35_000);
      await ledger(c, s.runId, 'ts_essentials', 0);
      await ledger(c, s.runId, 'ts_essentials', 0);

      const r = await report(tx, s.runId);
      expect(r.requests.rows).toEqual([
        { sku: 'ts_enterprise', requests: 3, freeThisMonth: 2, costMicroUsd: 35_000 },
        { sku: 'ts_essentials', requests: 2, freeThisMonth: 2, costMicroUsd: 0 },
      ]);
      expect(r.requests.refusedByMeter).toBe(0);
      expect(r.requests.totalRequests).toBe(5);
      expect(r.requests.totalMicroUsd).toBe(35_000);
      expect(r.run.costMicroUsd).toBe(35_000);
      // The header: our own names, the current cap, a parsed instant.
      expect(r.run).toMatchObject({
        id: s.runId,
        status: 'running',
        kind: 'full_sweep',
        stoppedReason: null,
        presetName: 'McAllen home_services',
        versionNumber: 1,
        ceilingRequests: 100,
        capMicroUsd: 50_000_000,
      });
      expect(Number.isFinite(r.run.createdMs)).toBe(true);
      expect(r.run.capResetMs).toBeGreaterThan(Date.now());
      expect(r.changes).toBeNull();

      // The meter refused the next request: one "Refused by the meter" row joins the total.
      await c.query(
        `update runs set status = 'partial', stopped_reason = 'budget_cap_reached',
                         finished_at = now() where id = $1`,
        [s.runId],
      );
      const stopped = await report(tx, s.runId);
      expect(stopped.run.stoppedReason).toBe('budget_cap_reached');
      expect(stopped.requests.refusedByMeter).toBe(1);
      expect(stopped.requests.totalRequests).toBe(6);
      expect(stopped.requests.totalMicroUsd).toBe(35_000);
    }));

  it('run report counts truncated tiles', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const ids = await plan(c, s.runId, [
        searchSpec('r'),
        searchSpec('r0'),
        searchSpec('r1'),
        searchSpec('r2'),
      ]);
      await writePage(c, ids.r!, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      // The root saturated and split; two children still hit 60 at the smallest size; one did not.
      await mark(c, ids.r!, { status: 'done', saturated: true, subdivided: true });
      await mark(c, ids.r0!, {
        status: 'done',
        saturated: true,
        truncated: true,
        truncated_why: 'min_size',
      });
      await mark(c, ids.r1!, {
        status: 'done',
        saturated: true,
        truncated: true,
        truncated_why: 'novelty',
      });
      await mark(c, ids.r2!, { status: 'done' });

      const r = await report(tx, s.runId);
      expect(r.tiles).toMatchObject({
        total: 4,
        searched: 4,
        saturated: 3,
        subdivided: 1,
        stillTruncated: 2,
      });
      expect(r.tiles.truncated).toEqual([
        {
          tileKey: `city:${UNIT}|plumber|r0`,
          cellKey: `home_services/${UNIT}`,
          placesType: 'plumber',
          why: 'min_size',
        },
        {
          tileKey: `city:${UNIT}|plumber|r1`,
          cellKey: `home_services/${UNIT}`,
          placesType: 'plumber',
          why: 'novelty',
        },
      ]);
      // Still running: nothing is "still subdividing when it stopped".
      expect(r.tiles.stillSubdividing).toEqual([]);
    }));

  it('run report counts outcomes per cluster with zero rows included', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const clusters = await c.query<{ id: string; key: string; display_name: string }>(
        `select id, key, display_name from industry_clusters
          where org_id is null and key in ('home_services', 'food_hospitality')
          order by sort_order, key`,
      );
      expect(clusters.rows.map((x) => x.key).sort()).toEqual(['food_hospitality', 'home_services']);
      // A two-cluster version (seedPlacesRun seeds one): the preset rows as the owner, as there.
      const cityId = (
        await c.query<{ id: string }>(
          "select id from cities where org_id is null and lower(name) = 'mcallen' order by id limit 1",
        )
      ).rows[0]!.id;
      const searchId = (
        await c.query<{ id: string }>(
          `insert into searches (org_id, name_internal, display_name)
           values ($1, 'two clusters — run report fixture', 'McAllen two clusters') returning id`,
          [a],
        )
      ).rows[0]!.id;
      const versionId = (
        await c.query<{ id: string }>(
          `insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
           values ($1, $2, 1, $3::uuid[], 'cities', $4::jsonb) returning id`,
          [
            a,
            searchId,
            `{${clusters.rows.map((x) => x.id).join(',')}}`,
            JSON.stringify({ cityIds: [cityId] }),
          ],
        )
      ).rows[0]!.id;
      const runId = (
        await c.query<{ id: string }>(
          `insert into runs (org_id, search_version_id, status, kind, ceiling_requests)
           values ($1, $2, 'running', 'full_sweep', 100) returning id`,
          [a, versionId],
        )
      ).rows[0]!.id;

      await actAs(c, CLAIMS_A);
      const ids = await plan(c, runId, [searchSpec('r')]);
      await writePage(c, ids.r!, [
        listing('ChIJ-ortiz', [cand(spine.ortiz, 97)]),
        listing('ChIJ-valley', [cand(spine.valley, 85)]),
        listing('ChIJ-nothing', [cand(spine.garza, 50)]),
        listing('ChIJ-mexico', [cand(spine.rio, 97)], { outside: true }),
      ]);

      const r = await report(tx, runId);
      // Run-wide: the outside listing is not "found"; the three sum to found.
      expect(r.outcomes).toMatchObject({ found: 3, attached: 1, tentative: 1, unmatched: 1 });
      const zeros = { found: 0, attached: 0, tentative: 0, unmatched: 0 };
      const hit = { found: 3, attached: 1, tentative: 1, unmatched: 1 };
      expect(r.outcomes.byCluster).toEqual(
        clusters.rows.map((x) => ({
          clusterKey: x.key,
          displayName: x.display_name,
          ...(x.key === 'home_services' ? hit : zeros),
        })),
      );
    }));

  it('run report splits the website signal over attached listings only', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const ids = await plan(c, s.runId, [searchSpec('r')]);
      await writePage(c, ids.r!, [
        listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)], { host: 'none' }),
        listing('ChIJ-garza', [cand(s.spine.garza, 97)], { host: 'business_site_dead' }),
        // Tentative: observed by the writer, but not a signal (D-08).
        listing('ChIJ-valley', [cand(s.spine.valley, 85)], { host: 'social' }),
      ]);

      const r = await report(tx, s.runId);
      expect(r.outcomes.website).toEqual({
        listed: 1,
        none: 1,
        byHostClass: {
          other: 0,
          social: 0,
          directory: 0,
          platform_subdomain: 0,
          business_site_dead: 1,
        },
      });

      // A detached listing (now `rejected`) stops counting (D-05): the split reads the
      // attachment's CURRENT status, not the one it had when observed.
      const att = await c.query<{ id: string }>(
        "select id from place_attachments where place_id = 'ChIJ-garza'",
      );
      await c.query("select * from app.decide_place_attachment($1, 'detach')", [att.rows[0]!.id]);
      const after = await report(tx, s.runId);
      expect(after.outcomes.website).toMatchObject({ listed: 0, none: 1 });
      expect(after.outcomes.website.byHostClass.business_site_dead).toBe(0);
    }));

  it('run report lists tiles still subdividing when a run stopped at the ceiling', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const ids = await plan(c, s.runId, [searchSpec('r'), searchSpec('r0'), searchSpec('r1')]);
      await writePage(c, ids.r!, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      await mark(c, ids.r!, { status: 'done', saturated: true, subdivided: true });

      // Positive control: while the run is running, planned children are not "still subdividing".
      expect((await report(tx, s.runId)).tiles.stillSubdividing).toEqual([]);

      await c.query(
        `update runs set status = 'partial', stopped_reason = 'exceeded_estimate',
                         finished_at = now() where id = $1`,
        [s.runId],
      );
      const r = await report(tx, s.runId);
      expect(r.run).toMatchObject({ status: 'partial', stoppedReason: 'exceeded_estimate' });
      expect(r.requests.refusedByMeter).toBe(0);
      expect(r.tiles.stillSubdividing).toEqual([
        {
          tileKey: `city:${UNIT}|plumber|r0`,
          cellKey: `home_services/${UNIT}`,
          placesType: 'plumber',
        },
        {
          tileKey: `city:${UNIT}|plumber|r1`,
          cellKey: `home_services/${UNIT}`,
          placesType: 'plumber',
        },
      ]);
      expect(r.tiles).toMatchObject({ total: 3, searched: 1, stillTruncated: 0 });
    }));

  it("run report reads a change check's changes", () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c, { kind: 'change_check' });
      await actAs(c, CLAIMS_A);
      const ids = await plan(c, s.runId, [
        searchSpec('r0', { kind: 'ids_only' }),
        searchSpec('r1', { kind: 'ids_only' }),
        searchSpec('r2', { kind: 'ids_only' }),
      ]);
      const check = (id: string, added: string[], gone: string[], verdict: string, seen: number) =>
        c.query('select app.record_change_check($1, $2::jsonb, $3::jsonb, $4, $5)', [
          id,
          JSON.stringify(added),
          JSON.stringify(gone),
          verdict,
          seen,
        ]);
      await check(ids.r0!, [], [], 'unchanged', 5);
      await check(ids.r1!, ['ChIJ-n1', 'ChIJ-n2'], [], 'new', 7);
      await check(ids.r2!, ['ChIJ-n3'], ['ChIJ-g1'], 'both', 6);

      const r = await report(tx, s.runId);
      expect(r.run.kind).toBe('change_check');
      expect(r.changes).toEqual({
        checked: 3,
        unchanged: 1,
        withNew: 2,
        withGone: 1,
        newIds: 3,
        goneIds: 1,
        changedTiles: 2,
      });
      // A change check matches nothing: the outcome counts are zero, not absent.
      expect(r.outcomes).toMatchObject({ found: 0, attached: 0, tentative: 0, unmatched: 0 });
    }));

  it('run report is tenant-scoped', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const ids = await plan(c, s.runId, [searchSpec('r')]);
      await writePage(c, ids.r!, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      await ledger(c, s.runId, 'ts_enterprise', 0);
      // Positive control: the owning org reads it.
      expect((await report(tx, s.runId)).outcomes.attached).toBe(1);

      await actAsOwner(c);
      await actAs(c, CLAIMS_B);
      expect(await readRunReport(tx, s.runId)).toBeNull();
      // An id that is not a uuid is an unknown run, not a 22P02 that aborts the transaction.
      expect(await readRunReport(tx, 'not-a-run-id')).toBeNull();
    }));
});
