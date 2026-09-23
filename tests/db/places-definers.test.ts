/**
 * Phase 4 plan 11. The five definers of drizzle/0028 as DATABASE FACTS.
 *
 *   * D-15 / Pattern 6 / M53 — app.release_reservation frees an unsettled hold, writes NO
 *     ledger row, is idempotent, refuses another org's reservation and never un-settles one.
 *   * D-15 / D-16 / T-4-06 / T-4-10 — app.plan_run_searches records each planned search once
 *     per (run, tile_key); app.mark_run_search moves progress through an allow-listed key set
 *     and, on `done`, marks the tile.
 *   * D-12 / M38 / M39 / T-4-07 — app.purge_expired_place_coordinates deletes every expired
 *     coordinate across orgs, never an observation, records one place_purge_runs row per org,
 *     and is executable ONLY by siteless_cron — which can read no tenant table.
 *   * D-12 / T-4-04 — app.places_transient_stats reports the caller's org only and never
 *     counts an expired coordinate as held.
 *
 * Every refusal is its own `withRollback` (a refusal aborts the transaction; the next statement
 * reports 25P02), pinned by SQLSTATE AND message, and paired with a positive control. Seeds
 * go in as the OWNER before `actAs`: the Places tables are SELECT-only for `authenticated` and
 * place_coordinates grants it nothing (drizzle/0027).
 *
 * Mutations (live DB, each reverted and re-read from the catalog; 04-11-SUMMARY lists the reds):
 *   M53  release_reservation body replaced by a settle of the hold → the release tests red.
 *   M38  purge predicate inverted (`expires_at > now()`) → "the purge removes expired
 *        coordinates and keeps the observation" red.
 *   M39  `grant execute on function app.purge_expired_place_coordinates(text) to
 *        authenticated` → "the purge refuses a tenant session" red.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actAs, actAsOwner, actAsRole, seedTwoOrgs, withRollback } from './_fixtures';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedAttachmentWithObservation,
  seedPlacesRun,
  seedPlacesSpine,
  seedRunSearch,
} from './_places-fixtures';

const PROVIDER = 'places';
/** A fixed period. Every test rolls back, so it never collides with anything. */
const PERIOD = '2026-09-01';
const SKU = 'ts_enterprise';
/** The admission hold of a 9-request Enterprise estimate: 9 × 35,000 µUSD. */
const HOLD = 315_000;

const DAY_MS = 24 * 60 * 60 * 1000;

type Totals = { reserved: string; spent: string };
type LedgerTotals = { n: string; units: string };

async function periodTotals(c: Client, periodId: string): Promise<Totals> {
  const r = await c.query<Totals>(
    `select reserved_micro_usd::text as reserved, spent_micro_usd::text as spent
       from budget_periods where id = $1`,
    [periodId],
  );
  const row = r.rows[0];
  if (!row) throw new Error('periodTotals: no budget_periods row');
  return row;
}

async function ledgerTotals(c: Client, periodId: string): Promise<LedgerTotals> {
  const r = await c.query<LedgerTotals>(
    `select count(*)::text as n, coalesce(sum(units), 0)::text as units
       from cost_ledger where budget_period_id = $1`,
    [periodId],
  );
  return r.rows[0]!;
}

/** As the CURRENT session (a tenant): get-or-create the period, then reserve `micro`. */
async function reserveHold(
  c: Client,
  runId: string | null,
  micro = HOLD,
): Promise<{ periodId: string; reservationId: string }> {
  const p = await c.query<{ id: string }>('select app.ensure_budget_period($1, $2) as id', [
    PROVIDER,
    PERIOD,
  ]);
  const periodId = p.rows[0]!.id;
  const r = await c.query<{ reservation_id: string | null }>(
    'select reservation_id from app.reserve_budget($1, $2, $3, $4, $5)',
    [PROVIDER, PERIOD, micro, runId, SKU],
  );
  const reservationId = r.rows[0]?.reservation_id;
  if (!reservationId) throw new Error('reserveHold: the meter refused the fixture hold');
  return { periodId, reservationId };
}

async function release(c: Client, reservationId: string): Promise<string> {
  const r = await c.query<{ freed: string }>('select app.release_reservation($1)::text as freed', [
    reservationId,
  ]);
  return r.rows[0]!.freed;
}

/** One planned search element, in the shape 04-13's planner hands app.plan_run_searches. */
function searchEl(
  tileKey: string,
  opts: { kind?: 'enterprise' | 'ids_only'; parentTileKey?: string | null; depth?: number } = {},
) {
  return {
    tileKey,
    cellKey: 'home_services/48215/McAllen',
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId: '48215/McAllen',
    placesType: 'plumber',
    quadPath: tileKey.split('|')[2] ?? 'r',
    depth: opts.depth ?? 0,
    south: 26.15,
    west: -98.3,
    north: 26.3,
    east: -98.18,
    parentTileKey: opts.parentTileKey ?? null,
    kind: opts.kind ?? 'enterprise',
  };
}

const TILE_ROOT = 'city:48215/McAllen|plumber|r';

type PlannedRow = { search_id: string; tile_key: string };

async function plan(c: Client, runId: string, els: unknown[]): Promise<PlannedRow[]> {
  const r = await c.query<PlannedRow>(
    'select search_id, tile_key from app.plan_run_searches($1, $2::jsonb)',
    [runId, JSON.stringify(els)],
  );
  return r.rows;
}

type StatsRow = {
  place_ids_held: string;
  coordinates_held: string;
  oldest_coordinate_ms: string | null;
  expired_awaiting_purge: string;
  last_purge_ms: string | null;
  last_rows_purged: number | null;
};

async function stats(c: Client): Promise<StatsRow> {
  const r = await c.query<StatsRow>(
    `select place_ids_held::text as place_ids_held, coordinates_held::text as coordinates_held,
            oldest_coordinate_ms, expired_awaiting_purge::text as expired_awaiting_purge,
            last_purge_ms, last_rows_purged
       from app.places_transient_stats()`,
  );
  expect(r.rows).toHaveLength(1);
  return r.rows[0]!;
}

describe('app.release_reservation (D-15, M53)', () => {
  it('release_reservation frees the hold and writes no ledger row', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const p = await c.query<{ id: string }>('select app.ensure_budget_period($1, $2) as id', [
        PROVIDER,
        PERIOD,
      ]);
      const before = await periodTotals(c, p.rows[0]!.id);
      const ledgerBefore = await ledgerTotals(c, p.rows[0]!.id);

      const { periodId, reservationId } = await reserveHold(c, run.runId);
      // The control that the hold was real: without it, "back to the prior value" below
      // passes against a meter that never reserved anything.
      expect((await periodTotals(c, periodId)).reserved).toBe(
        String(Number(before.reserved) + HOLD),
      );

      expect(await release(c, reservationId)).toBe(String(HOLD));

      const res = await c.query<{ released: boolean; settled: boolean }>(
        `select released_at is not null as released, settled_at is not null as settled
           from cost_reservations where id = $1`,
        [reservationId],
      );
      expect(res.rows[0]).toEqual({ released: true, settled: false });
      // 🔴 M53. Settling the admission hold instead would ALSO bring reserved back down —
      // what separates a release from a settle is the ledger: no row, no unit, no spend.
      expect(await periodTotals(c, periodId)).toEqual(before);
      expect(await ledgerTotals(c, periodId)).toEqual(ledgerBefore);
    }));

  it('release_reservation is idempotent', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const { periodId, reservationId } = await reserveHold(c, run.runId);
      expect(await release(c, reservationId)).toBe(String(HOLD));
      const afterFirst = await periodTotals(c, periodId);
      const ledgerAfterFirst = await ledgerTotals(c, periodId);

      // The second call frees 0 and moves nothing — a double release would drive
      // reserved_micro_usd below the hold's true value (or abort on bp_non_negative).
      expect(await release(c, reservationId)).toBe('0');
      expect(await periodTotals(c, periodId)).toEqual(afterFirst);
      expect(await ledgerTotals(c, periodId)).toEqual(ledgerAfterFirst);
    }));

  it("release_reservation refuses another org's reservation", () =>
    withRollback(async (c) => {
      const { b } = await seedTwoOrgs(c);
      const runB = await seedPlacesRun(c, b);
      await actAs(c, CLAIMS_B);
      const { reservationId } = await reserveHold(c, runB.runId);

      await actAsOwner(c);
      await actAs(c, CLAIMS_A);
      // Loaded as the owner, so RLS cannot hide B's row from the definer — only the explicit
      // org comparison refuses it (T-4-06). The positive control is the test above: the same
      // call on the caller's own reservation frees it.
      const attempt = c.query('select app.release_reservation($1)', [reservationId]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /release_reservation: reservation belongs to another org/,
      );
    }));

  it('release_reservation will not release a settled reservation', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const { periodId, reservationId } = await reserveHold(c, run.runId, 35_000);
      const settled = await c.query<{ ok: boolean }>(
        'select app.settle_reservation($1, $2, $3, $4, $5, $6) as ok',
        [reservationId, 'places:test:settled:p1:attempt-1', 0, 1, SKU, PROVIDER],
      );
      expect(settled.rows[0]?.ok).toBe(true);
      const afterSettle = await periodTotals(c, periodId);
      const ledgerAfterSettle = await ledgerTotals(c, periodId);
      expect(ledgerAfterSettle.n).toBe('1');

      expect(await release(c, reservationId)).toBe('0');
      const res = await c.query<{ released: boolean }>(
        'select released_at is not null as released from cost_reservations where id = $1',
        [reservationId],
      );
      expect(res.rows[0]?.released).toBe(false);
      expect(await periodTotals(c, periodId)).toEqual(afterSettle);
      expect(await ledgerTotals(c, periodId)).toEqual(ledgerAfterSettle);
    }));
});

describe('app.plan_run_searches / app.mark_run_search (D-15, D-16, T-4-06, T-4-10)', () => {
  it('plan_run_searches is idempotent per tile', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);

      const first = await plan(c, run.runId, [searchEl(TILE_ROOT)]);
      expect(first).toHaveLength(1);
      expect(first[0]?.tile_key).toBe(TILE_ROOT);
      const second = await plan(c, run.runId, [searchEl(TILE_ROOT)]);
      expect(second).toEqual(first);

      const rs = await c.query<{ n: string; status: string; kind: string }>(
        `select count(*)::text as n, min(status) as status, min(kind) as kind
           from run_searches where run_id = $1 and tile_key = $2`,
        [run.runId, TILE_ROOT],
      );
      expect(rs.rows[0]).toEqual({ n: '1', status: 'planned', kind: 'enterprise' });
      const tiles = await c.query<{ n: string; unit_id: string; is_leaf: boolean }>(
        `select count(*)::text as n, min(unit_id) as unit_id, bool_and(is_leaf) as is_leaf
           from place_tiles where org_id = $1 and tile_key = $2`,
        [a, TILE_ROOT],
      );
      expect(tiles.rows[0]).toEqual({ n: '1', unit_id: '48215/McAllen', is_leaf: true });
    }));

  it("plan_run_searches refuses another org's run", () =>
    withRollback(async (c) => {
      const { b } = await seedTwoOrgs(c);
      const runB = await seedPlacesRun(c, b);
      await actAs(c, CLAIMS_A);
      const attempt = plan(c, runB.runId, [searchEl(TILE_ROOT)]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /plan_run_searches: run belongs to another org or does not exist/,
      );
    }));

  it('plan_run_searches gives a missing run the same refusal as a foreign one', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, CLAIMS_A);
      // Same code, same message: a different answer would be an existence oracle on run ids.
      const attempt = plan(c, '00000000-0000-4000-8000-000000000000', [searchEl(TILE_ROOT)]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /plan_run_searches: run belongs to another org or does not exist/,
      );
    }));

  it('plan_run_searches refuses an ids_only search on a sweep run', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a, { kind: 'full_sweep' });
      await actAs(c, CLAIMS_A);
      // An enterprise search on the same run is accepted in "is idempotent per tile" — the
      // positive control. Here the kind disagrees with the run.
      const attempt = plan(c, run.runId, [searchEl(TILE_ROOT, { kind: 'ids_only' })]);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /plan_run_searches: search kind does not match the run/,
      );
    }));

  it('mark_run_search refuses an unknown key', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const [s] = await plan(c, run.runId, [searchEl(TILE_ROOT)]);
      // Positive control: an allow-listed key on the same search is accepted.
      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ status: 'searching' }),
      ]);
      const attempt = c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ displayName: 'x' }),
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /mark_run_search: state carries a key that is not allowed/,
      );
    }));

  it('mark_run_search done marks the tile swept and non-leaf when subdivided', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const [s] = await plan(c, run.runId, [searchEl(TILE_ROOT)]);

      // Not done yet: the tile is untouched.
      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ status: 'searching', saturated: true }),
      ]);
      const mid = await c.query<{ is_leaf: boolean; swept: boolean }>(
        `select is_leaf, last_swept_at is not null as swept from place_tiles
          where org_id = $1 and tile_key = $2`,
        [a, TILE_ROOT],
      );
      expect(mid.rows[0]).toEqual({ is_leaf: true, swept: false });

      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ status: 'done', subdivided: true, truncated_why: null }),
      ]);
      const rs = await c.query<{ status: string; saturated: boolean; subdivided: boolean }>(
        'select status, saturated, subdivided from run_searches where id = $1',
        [s!.search_id],
      );
      // coalesce(new, old): `saturated` was set by the earlier call and survives this one.
      expect(rs.rows[0]).toEqual({ status: 'done', saturated: true, subdivided: true });
      const tile = await c.query<{
        is_leaf: boolean;
        saturated: boolean;
        truncated: boolean;
        swept_run: string | null;
        swept: boolean;
        checked: boolean;
      }>(
        `select is_leaf, saturated, truncated, last_swept_run_id as swept_run,
                last_swept_at is not null as swept, last_checked_at is not null as checked
           from place_tiles where org_id = $1 and tile_key = $2`,
        [a, TILE_ROOT],
      );
      expect(tile.rows[0]).toEqual({
        is_leaf: false,
        saturated: true,
        truncated: false,
        swept_run: run.runId,
        swept: true,
        // An enterprise search sweeps; only an ids_only change check stamps last_checked_at.
        checked: false,
      });
    }));

  it("mark_run_search refuses an in-flight reservation that is not this run's", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const [s] = await plan(c, run.runId, [searchEl(TILE_ROOT)]);
      // Positive control: a hold on this run is accepted as the in-flight cursor…
      const own = await reserveHold(c, run.runId, 35_000);
      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ inflight_reservation_id: own.reservationId, inflight_request_id: 'r1' }),
      ]);
      // …a hold of the same org that names no run is not.
      const loose = await reserveHold(c, null, 35_000);
      const attempt = c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ inflight_reservation_id: loose.reservationId }),
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/mark_run_search: reservation is not this run's/);
    }));

  it('mark_run_search clears the in-flight pair on a JSON null', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a);
      await actAs(c, CLAIMS_A);
      const [s] = await plan(c, run.runId, [searchEl(TILE_ROOT)]);
      const own = await reserveHold(c, run.runId, 35_000);
      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({
          status: 'searching',
          inflight_reservation_id: own.reservationId,
          inflight_request_id: 'places:run:search:p1:attempt',
        }),
      ]);
      const set = await c.query<{ res: string | null; req: string | null }>(
        'select inflight_reservation_id as res, inflight_request_id as req from run_searches where id = $1',
        [s!.search_id],
      );
      expect(set.rows[0]).toEqual({ res: own.reservationId, req: 'places:run:search:p1:attempt' });

      await c.query('select app.mark_run_search($1, $2::jsonb)', [
        s!.search_id,
        JSON.stringify({ inflight_reservation_id: null, inflight_request_id: null }),
      ]);
      const cleared = await c.query<{ res: string | null; req: string | null; status: string }>(
        'select inflight_reservation_id as res, inflight_request_id as req, status from run_searches where id = $1',
        [s!.search_id],
      );
      // Cleared, and the status the call did not name is untouched.
      expect(cleared.rows[0]).toEqual({ res: null, req: null, status: 'searching' });
    }));
});

describe('app.purge_expired_place_coordinates (D-12, M38, M39, T-4-07)', () => {
  /** Org A: one expired and one fresh coordinate; org B: one expired. All as the owner. */
  async function seedPurgeWorld(c: Client) {
    const { a, b } = await seedTwoOrgs(c);
    const spineA = await seedPlacesSpine(c, a);
    const spineB = await seedPlacesSpine(c, b);
    const runA = await seedPlacesRun(c, a);
    const runB = await seedPlacesRun(c, b);
    const now = Date.now();
    // observed now − 31 d → expires now − 1 d (the fixture sets observed + 30 d).
    const expiredA = await seedAttachmentWithObservation(c, {
      orgId: a,
      businessId: spineA.ortiz,
      placeId: 'synthetic-place-a-expired',
      runId: runA.runId,
      status: 'attached',
      hadWebsiteUri: false,
      hostClass: 'none',
      observedAt: new Date(now - 31 * DAY_MS),
      withCoordinates: true,
    });
    const freshA = await seedAttachmentWithObservation(c, {
      orgId: a,
      businessId: spineA.garza,
      placeId: 'synthetic-place-a-fresh',
      runId: runA.runId,
      status: 'attached',
      hadWebsiteUri: true,
      hostClass: 'social',
      observedAt: new Date(now),
      withCoordinates: true,
    });
    const expiredB = await seedAttachmentWithObservation(c, {
      orgId: b,
      businessId: spineB.ortiz,
      placeId: 'synthetic-place-b-expired',
      runId: runB.runId,
      status: 'attached',
      hadWebsiteUri: false,
      hostClass: 'none',
      observedAt: new Date(now - 31 * DAY_MS),
      withCoordinates: true,
    });
    return { a, b, expiredA, freshA, expiredB };
  }

  it('the purge removes expired coordinates and keeps the observation', () =>
    withRollback(async (c) => {
      const { a, b, expiredA, freshA, expiredB } = await seedPurgeWorld(c);
      const obsBefore = await c.query<{ n: string }>(
        'select count(*)::text as n from place_observations where org_id = any($1::uuid[])',
        [[a, b]],
      );
      const purgeRowsBefore = await c.query<{ n: string }>(
        'select count(*)::text as n from place_purge_runs',
      );
      const orgCount = await c.query<{ n: number }>('select count(*)::int as n from orgs');

      await actAsRole(c, 'siteless_cron');
      const r = await c.query<{ purged_org: string; purged_rows: number }>(
        "select purged_org, purged_rows from app.purge_expired_place_coordinates('cron')",
      );
      await actAsOwner(c);

      const byOrg = new Map(r.rows.map((row) => [row.purged_org, row.purged_rows]));
      expect(byOrg.get(a)).toBe(1);
      expect(byOrg.get(b)).toBe(1);
      // One row per org, zero-count included.
      expect(r.rows).toHaveLength(orgCount.rows[0]!.n);
      for (const row of r.rows) {
        if (row.purged_org !== a && row.purged_org !== b) expect(row.purged_rows).toBe(0);
      }

      const left = await c.query<{ id: string }>(
        'select id from place_coordinates where id = any($1::uuid[]) order by id',
        [[expiredA.coordinateId, freshA.coordinateId, expiredB.coordinateId]],
      );
      // Both expired rows are gone; the fresh one is kept.
      expect(left.rows.map((x) => x.id)).toEqual([freshA.coordinateId]);
      const obsAfter = await c.query<{ n: string }>(
        'select count(*)::text as n from place_observations where org_id = any($1::uuid[])',
        [[a, b]],
      );
      expect(obsAfter.rows[0]?.n).toBe(obsBefore.rows[0]?.n);
      expect(obsAfter.rows[0]?.n).toBe('3');
      const purgeRowsAfter = await c.query<{ n: string }>(
        'select count(*)::text as n from place_purge_runs',
      );
      expect(Number(purgeRowsAfter.rows[0]!.n) - Number(purgeRowsBefore.rows[0]!.n)).toBe(
        orgCount.rows[0]!.n,
      );
      const mine = await c.query<{ rows_purged: number; trigger: string }>(
        'select rows_purged, trigger from place_purge_runs where org_id = $1',
        [a],
      );
      expect(mine.rows).toEqual([{ rows_purged: 1, trigger: 'cron' }]);
    }));

  it('the purge refuses a tenant session', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, CLAIMS_A);
      // The positive control is the test above: siteless_cron runs the same call. Here a
      // Clerk user WITH a valid org claim is refused by the grant, before the body runs.
      const attempt = c.query("select * from app.purge_expired_place_coordinates('cron')");
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /permission denied for function purge_expired_place_coordinates/,
      );
    }));

  it('the purge refuses an unknown trigger', () =>
    withRollback(async (c) => {
      await actAsRole(c, 'siteless_cron');
      const attempt = c.query("select * from app.purge_expired_place_coordinates('nightly')");
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(/purge_expired_place_coordinates: unknown trigger/);
    }));

  it('only siteless_cron may execute the purge', () =>
    withRollback(async (c) => {
      // The catalog half of M39, for every role the schema default hands EXECUTE to — the
      // attempt above covers authenticated, this covers anon and service_role too, and
      // app_user (NOINHERIT) without first `set local role siteless_cron`.
      const r = await c.query<{ role: string; can: boolean }>(
        `select r as role,
                has_function_privilege(r, 'app.purge_expired_place_coordinates(text)', 'EXECUTE') as can
           from unnest(array['siteless_cron','authenticated','anon','service_role','app_user']) r`,
      );
      expect(Object.fromEntries(r.rows.map((x) => [x.role, x.can]))).toEqual({
        siteless_cron: true,
        authenticated: false,
        anon: false,
        service_role: false,
        app_user: false,
      });
    }));

  it('siteless_cron can read no tenant table', () =>
    withRollback(async (c) => {
      // The catalog: no privilege of any kind on any table in public.
      const held = await c.query<{ table_name: string }>(
        `select c.relname as table_name
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'v', 'p')
            and (has_table_privilege('siteless_cron', c.oid, 'SELECT')
              or has_table_privilege('siteless_cron', c.oid, 'INSERT')
              or has_table_privilege('siteless_cron', c.oid, 'UPDATE')
              or has_table_privilege('siteless_cron', c.oid, 'DELETE')
              or has_table_privilege('siteless_cron', c.oid, 'TRUNCATE')
              or has_any_column_privilege('siteless_cron', c.oid, 'SELECT'))`,
      );
      expect(held.rows).toEqual([]);

      await actAsRole(c, 'siteless_cron');
      // Positive control: the one thing the role is for still works in this session.
      const ok = await c.query("select count(*) from app.purge_expired_place_coordinates('cron')");
      expect(ok.rowCount).toBe(1);
      // The attempt: a tenant table read is refused by the grant.
      const attempt = c.query('select 1 from runs');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table runs/);
    }));
});

describe('app.places_transient_stats (D-12, T-4-04)', () => {
  it('transient stats count only what the org holds', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a);
      const now = Date.now();
      const older = new Date(now - 2 * DAY_MS);
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-p1',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: older,
        withCoordinates: true,
      });
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-p2',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: new Date(now),
        withCoordinates: true,
      });
      // Tile members: p2 again (an attachment already holds it) and p3 (members only).
      const { tileId } = await seedRunSearch(c, a, run.runId, {
        tileKey: TILE_ROOT,
        placesType: 'plumber',
      });
      await c.query(
        `insert into place_tile_members (org_id, tile_id, place_id)
         values ($1, $2, 'synthetic-p2'), ($1, $2, 'synthetic-p3')`,
        [a, tileId],
      );
      await c.query(
        `insert into place_purge_runs (org_id, ran_at, rows_purged, trigger)
         values ($1, now() - interval '3 days', 7, 'cron'), ($1, now() - interval '1 day', 4, 'desk')`,
        [a],
      );
      const expected = await c.query<{ oldest: string; last: string }>(
        `select floor(extract(epoch from $1::timestamptz) * 1000)::bigint::text as oldest,
                floor(extract(epoch from now() - interval '1 day') * 1000)::bigint::text as last`,
        [older],
      );

      await actAs(c, CLAIMS_A);
      expect(await stats(c)).toEqual({
        // {p1, p2} ∪ {p2, p3}: distinct, so p2 counts once.
        place_ids_held: '3',
        coordinates_held: '2',
        oldest_coordinate_ms: expected.rows[0]!.oldest,
        expired_awaiting_purge: '0',
        last_purge_ms: expected.rows[0]!.last,
        last_rows_purged: 4,
      });
      // The definer counted rows the caller itself cannot read at all (0027): the figures
      // came from the function, not from a grant.
      await actAsOwner(c);
      await actAs(c, CLAIMS_B);
      expect(await stats(c)).toEqual({
        place_ids_held: '0',
        coordinates_held: '0',
        oldest_coordinate_ms: null,
        expired_awaiting_purge: '0',
        last_purge_ms: null,
        last_rows_purged: null,
      });
    }));

  it('transient stats never report an expired coordinate as held', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a);
      const now = Date.now();
      const fresh = new Date(now - 2 * DAY_MS);
      // Expired and not yet purged: observed 31 days ago, expired yesterday.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-expired',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: new Date(now - 31 * DAY_MS),
        withCoordinates: true,
      });
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-fresh',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: fresh,
        withCoordinates: true,
      });
      const expected = await c.query<{ oldest: string }>(
        'select floor(extract(epoch from $1::timestamptz) * 1000)::bigint::text as oldest',
        [fresh],
      );

      await actAs(c, CLAIMS_A);
      const s = await stats(c);
      expect(s.coordinates_held).toBe('1');
      expect(s.expired_awaiting_purge).toBe('1');
      // The oldest HELD coordinate is the fresh one — the 31-day-old row is not held.
      expect(s.oldest_coordinate_ms).toBe(expected.rows[0]!.oldest);
      expect(s.last_purge_ms).toBeNull();
      expect(s.last_rows_purged).toBeNull();
    }));
});
