/**
 * 04-26. `queueRun` — the Run button's server action — against the real database as a Clerk
 * user: the mode refusal (D-02), the three run kinds (D-16), the planner-sized admission and
 * request ceiling (D-15 / D-18), one active run per org, the stale-run reclaim, and the
 * start-failure release.
 *
 * Also the home of "a confirmed run creates a runs row on the current version", moved here
 * from tests/e2e/preset-detail.spec.ts (UI-SPEC Rule 38): once the Run button starts a real
 * workflow, no e2e spec may ever confirm a run (Rule 39). Here `start()` is a double, so
 * nothing is queued and no Places request can leave.
 *
 * THE PLUMBING IS THE review-actions.test.ts PATTERN: `requireOrg`, `revalidatePath` and
 * `withOrg` are replaced; `withOrg` opens a SAVEPOINT in the test's rolled-back transaction
 * and sets the claims + `set local role authenticated` exactly as the real one does, so every
 * statement the action runs meets RLS and the column grants. `@/env` is a proxy over the real
 * env whose PLACES_MODE the test sets, and `workflow/api`'s `start` is a spy (it is reached
 * from the action, not from step code, so the double is honest).
 *
 * 🔴 `vi.doMock` + dynamic import, undone in `afterAll` — the DB suite runs `isolate: false`.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgClaims } from '@/db/with-org';
import { RUN_CEILING_MULTIPLIER } from '@/lib/estimate/assumptions';
import { currentPartition } from '@/lib/places/partition';
import { RUN_ALREADY_IN_PROGRESS, RUN_MODE_REFUSED, RUN_START_FAILED } from '@/lib/ui/copy';
import { rowsOf, type Tx } from '@/server/queries/budget';
import { seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';

vi.mock('server-only', () => ({}));

const USER_A: OrgClaims = {
  o: { id: 'org_A' },
  sub: 'user_reviewer_A',
  role: 'authenticated',
  org_role: 'org:admin',
};

type Mode = 'off' | 'ids_only' | 'enterprise';

/** What the mocked plumbing answers for. `depth` > 0 while a `withOrg` callback runs. */
const request: { tx: Tx | null; claims: OrgClaims; mode: Mode; depth: number } = {
  tx: null,
  claims: USER_A,
  mode: 'enterprise',
  depth: 0,
};

/** Every `start()` call: its arguments, whether a `withOrg` transaction was open, and the
 *  run row as the outer transaction saw it at that moment. */
type StartCall = {
  workflow: unknown;
  args: unknown;
  insideTransaction: boolean;
  row: { status: string; ceiling_requests: number } | null;
};
const startCalls: StartCall[] = [];
let startBehaviour: 'ok' | 'reject' = 'ok';

type QueueRun = typeof import('@/server/actions/queue-run').queueRun;
let queueRun: QueueRun;
let placesSweep: unknown;

const MOCKED = [
  '@/lib/auth/require-org',
  'next/cache',
  '@/db/with-org',
  '@/env',
  'workflow/api',
] as const;

beforeAll(async () => {
  vi.doMock('@/lib/auth/require-org', () => ({
    requireOrg: async () => ({
      userId: request.claims.sub,
      orgId: request.claims.o.id,
      orgSlug: null,
    }),
    orgClaims: async () => request.claims,
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.doMock('@/db/with-org', () => ({
    withOrg: async <T>(claims: OrgClaims, fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const outer = request.tx;
      if (!outer) throw new Error('queue-run test: no request transaction is open');
      return outer.transaction(async (sp) => {
        const tx = sp as unknown as Tx;
        await tx.execute(
          sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
        );
        await tx.execute(sql`set local role authenticated`);
        request.depth += 1;
        let out: T;
        try {
          out = await fn(tx);
        } finally {
          request.depth -= 1;
        }
        // A real withOrg's transaction ENDS here, and its `set local` ends with it. A released
        // savepoint keeps `set local` until the outer transaction ends, so restore the owner
        // by hand — or every fixture statement after the action would run as the user.
        await tx.execute(sql`reset role`);
        await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
        return out;
      });
    },
  }));
  vi.doMock('@/env', async (importOriginal) => {
    const real = await importOriginal<typeof import('@/env')>();
    const env = new Proxy(real.env, {
      get: (target, key, receiver) =>
        key === 'PLACES_MODE' ? request.mode : Reflect.get(target, key, receiver),
    });
    return { ...real, env };
  });
  vi.doMock('workflow/api', () => ({
    start: vi.fn(async (workflow: unknown, args: unknown) => {
      const runId = (args as Array<{ runId: string }>)[0]?.runId ?? '';
      const tx = request.tx;
      let row: StartCall['row'] = null;
      if (tx) {
        // Read as the connection's CURRENT role. Outside a withOrg savepoint that is the
        // owner, so the row is visible whatever the claims say.
        row =
          rowsOf<{ status: string; ceiling_requests: number }>(
            await tx.execute(
              sql`select status, ceiling_requests from runs where id = ${runId}::uuid`,
            ),
          )[0] ?? null;
      }
      startCalls.push({ workflow, args, insideTransaction: request.depth > 0, row });
      if (startBehaviour === 'reject') throw new Error('queue unavailable');
      return { runId: 'wrun_test' };
    }),
  }));
  ({ queueRun } = await import('@/server/actions/queue-run'));
  ({ placesSweep } = await import('@/workflows/places-sweep/workflow'));
});

afterAll(async () => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.resetModules();
  request.tx = null;
  await closeDrizzleTx();
});

beforeEach(() => {
  startCalls.length = 0;
  startBehaviour = 'ok';
  request.mode = 'enterprise';
  request.depth = 0;
});

/** One rolled-back world: two orgs, the action's transaction handed to the mocked withOrg. */
function inWorld(fn: (tx: Tx, orgA: string) => Promise<void>): Promise<void> {
  return withTxRollback(async (tx) => {
    const { a } = await seedTwoOrgs(asPg(tx));
    request.tx = tx;
    try {
      await fn(tx, a);
    } finally {
      request.tx = null;
    }
  });
}

/**
 * A search + version as the owner, with NO run. `cities` names built-in cities
 * (case-insensitive); `allCities` takes every built-in city; `allCounties` every built-in
 * county (the Texas preset — 250 of them have no outline).
 */
async function seedVersion(
  tx: Tx,
  orgId: string,
  opts: { clusterKey?: string; cities?: string[]; allCities?: boolean; allCounties?: boolean },
): Promise<string> {
  const c = asPg(tx);
  const clusterKey = opts.clusterKey ?? 'home_services';
  const cl = await c.query<{ id: string }>(
    'select id from industry_clusters where org_id is null and key = $1',
    [clusterKey],
  );
  const clusterId = cl.rows[0]?.id;
  if (!clusterId) throw new Error('seedVersion: no built-in cluster ' + clusterKey);

  let geoKind: 'cities' | 'counties';
  let payload: Record<string, string[]>;
  if (opts.allCounties) {
    const rows = await c.query<{ id: string }>(
      'select id from counties where org_id is null order by fips',
    );
    geoKind = 'counties';
    payload = { countyIds: rows.rows.map((r) => r.id) };
  } else {
    const rows = opts.allCities
      ? await c.query<{ id: string }>('select id from cities where org_id is null order by id')
      : await c.query<{ id: string }>(
          'select id from cities where org_id is null and lower(name) = any($1::text[]) order by id',
          [(opts.cities ?? ['McAllen']).map((n) => n.toLowerCase())],
        );
    geoKind = 'cities';
    payload = { cityIds: rows.rows.map((r) => r.id) };
  }

  const s = await c.query<{ id: string }>(
    'insert into searches (org_id, name_internal, display_name) values ($1, $2, $3) returning id',
    [orgId, 'queue-run fixture', 'Queue-run fixture'],
  );
  const v = await c.query<{ id: string }>(
    `insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
     values ($1, $2, 1, $3::uuid[], $4, $5::jsonb) returning id`,
    [orgId, s.rows[0]!.id, [clusterId], geoKind, JSON.stringify(payload)],
  );
  return v.rows[0]!.id;
}

async function countOf(tx: Tx, table: 'runs' | 'cost_reservations', orgId: string) {
  const r = rowsOf<{ n: number }>(
    await tx.execute(
      table === 'runs'
        ? sql`select count(*)::int as n from runs where org_id = ${orgId}::uuid`
        : sql`select count(*)::int as n from cost_reservations where org_id = ${orgId}::uuid`,
    ),
  );
  return r[0]?.n ?? -1;
}

type RunRow = {
  id: string;
  status: string;
  stopped_reason: string | null;
  kind: string;
  partition_index: number | null;
  estimate_requests_lo: number | null;
  estimate_requests_hi: number | null;
  estimate_micro_usd_lo: string | null;
  estimate_micro_usd_hi: string | null;
  ceiling_requests: number;
  requested_by: string | null;
  workflow_run_id: string | null;
  search_version_id: string;
  has_finished: boolean;
};

async function runRow(tx: Tx, runId: string): Promise<RunRow> {
  const r = rowsOf<RunRow>(
    await tx.execute(sql`
      select id, status, stopped_reason, kind, partition_index,
             estimate_requests_lo, estimate_requests_hi,
             estimate_micro_usd_lo::text as estimate_micro_usd_lo,
             estimate_micro_usd_hi::text as estimate_micro_usd_hi,
             ceiling_requests, requested_by, workflow_run_id, search_version_id,
             finished_at is not null as has_finished
        from runs where id = ${runId}::uuid`),
  )[0];
  if (!r) throw new Error('runRow: no run ' + runId);
  return r;
}

async function reservationsOf(tx: Tx, runId: string) {
  return rowsOf<{
    id: string;
    sku: string;
    est: string;
    released: boolean;
    settled: boolean;
  }>(
    await tx.execute(sql`
      select id, sku, est_micro_usd::text as est,
             released_at is not null as released, settled_at is not null as settled
        from cost_reservations where run_id = ${runId}::uuid`),
  );
}

describe('queueRun', () => {
  it('queueRun refuses in off mode before any reservation', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      const runsBefore = await countOf(tx, 'runs', orgA);
      const holdsBefore = await countOf(tx, 'cost_reservations', orgA);
      request.mode = 'off';

      const r = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });

      expect(r).toEqual({ ok: false, code: 'mode_refused', message: RUN_MODE_REFUSED('off') });
      expect(await countOf(tx, 'runs', orgA)).toBe(runsBefore);
      expect(await countOf(tx, 'cost_reservations', orgA)).toBe(holdsBefore);
      expect(startCalls).toHaveLength(0);
    }));

  it('queueRun refuses a full sweep in ids_only mode', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      request.mode = 'ids_only';

      for (const kind of ['full_sweep', 'partition'] as const) {
        const r = await queueRun({ searchVersionId: versionId, kind });
        expect(r).toEqual({
          ok: false,
          code: 'mode_refused',
          message: RUN_MODE_REFUSED('ids_only'),
        });
      }
      expect(await countOf(tx, 'runs', orgA)).toBe(0);
      expect(await countOf(tx, 'cost_reservations', orgA)).toBe(0);
      expect(startCalls).toHaveLength(0);

      // The free check is the one kind ids_only admits.
      const check = await queueRun({ searchVersionId: versionId, kind: 'change_check' });
      expect(check.ok).toBe(true);
      expect(startCalls).toHaveLength(1);
    }));

  it('a confirmed run creates a runs row on the current version', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});

      const r = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });
      if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);

      const queued = rowsOf<{ id: string }>(
        await tx.execute(sql`
          select id from runs where search_version_id = ${versionId}::uuid and status = 'queued'`),
      );
      expect(queued.map((q) => q.id)).toEqual([r.data.runId]);

      // McAllen × home_services: 1 cell × 6 Places types → 6 lo / 54 hi (04-04's pin);
      // inside the free 1,000 the dollar estimate is 0.
      const row = await runRow(tx, r.data.runId);
      expect(row).toMatchObject({
        status: 'queued',
        kind: 'full_sweep',
        partition_index: null,
        estimate_requests_lo: 6,
        estimate_requests_hi: 54,
        estimate_micro_usd_lo: '0',
        estimate_micro_usd_hi: '0',
        ceiling_requests: Math.ceil(RUN_CEILING_MULTIPLIER * 54),
        requested_by: 'user_reviewer_A',
        workflow_run_id: 'wrun_test',
      });
      expect(row.ceiling_requests).toBe(108);

      // The admission hold names the run; it is open until beginRun releases it.
      const holds = await reservationsOf(tx, r.data.runId);
      expect(holds).toEqual([
        {
          id: r.data.reservationId,
          sku: 'ts_enterprise',
          est: '1',
          released: false,
          settled: false,
        },
      ]);

      // start() ran once, with the Clerk org id, AFTER the admission transaction closed and
      // while the row already carried its ceiling.
      expect(startCalls).toHaveLength(1);
      const call = startCalls[0]!;
      expect(call.workflow).toBe(placesSweep);
      expect(call.args).toEqual([{ runId: r.data.runId, clerkOrgId: 'org_A' }]);
      expect(call.insideTransaction).toBe(false);
      expect(call.row).toEqual({ status: 'queued', ceiling_requests: 108 });
    }));

  it('queueRun stores the partition index for a partition run', () =>
    inWorld(async (tx, orgA) => {
      // 17 cities × home_services: enough cells that every week's partition holds some.
      const versionId = await seedVersion(tx, orgA, { allCities: true });
      const dbNow = rowsOf<{ ms: string }>(
        await tx.execute(sql`select (extract(epoch from now()) * 1000)::bigint::text as ms`),
      )[0]!;

      const r = await queueRun({ searchVersionId: versionId, kind: 'partition' });
      if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);

      const row = await runRow(tx, r.data.runId);
      expect(row.kind).toBe('partition');
      expect(row.partition_index).toBe(currentPartition(new Date(Number(dbNow.ms))));
      // A partition prices a subset: strictly fewer requests than the 17-cell whole (918).
      expect(row.estimate_requests_hi).toBeGreaterThan(0);
      expect(row.estimate_requests_hi).toBeLessThan(918);
      expect(row.ceiling_requests).toBe(
        Math.ceil(RUN_CEILING_MULTIPLIER * (row.estimate_requests_hi ?? 0)),
      );
    }));

  it('a change check holds one micro-dollar on ts_essentials', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});

      const r = await queueRun({ searchVersionId: versionId, kind: 'change_check' });
      if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);

      const row = await runRow(tx, r.data.runId);
      expect(row.kind).toBe('change_check');
      expect(row.estimate_micro_usd_lo).toBe('0');
      expect(row.estimate_micro_usd_hi).toBe('0');
      expect(await reservationsOf(tx, r.data.runId)).toEqual([
        {
          id: r.data.reservationId,
          sku: 'ts_essentials',
          est: '1',
          released: false,
          settled: false,
        },
      ]);
    }));

  it('queueRun refuses a second active run', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      const first = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });
      if (!first.ok) throw new Error(`expected ok, got ${first.code}: ${first.message}`);
      const holdsBefore = await countOf(tx, 'cost_reservations', orgA);

      const second = await queueRun({ searchVersionId: versionId, kind: 'change_check' });

      expect(second).toEqual({
        ok: false,
        code: 'conflict',
        message: RUN_ALREADY_IN_PROGRESS,
        detail: { reason: 'busy', runningRunId: first.data.runId },
      });
      expect(await countOf(tx, 'cost_reservations', orgA)).toBe(holdsBefore);
      expect(await countOf(tx, 'runs', orgA)).toBe(1);
      expect(startCalls).toHaveLength(1);
    }));

  it('queueRun fails stale runs before inserting', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      const c = asPg(tx);

      // 1. A queued run the workflow never picked up, 20 minutes old.
      const staleQueued = await c.query<{ id: string }>(
        `insert into runs (org_id, search_version_id, status, created_at)
         values ($1, $2, 'queued', now() - interval '20 minutes') returning id`,
        [orgA, versionId],
      );
      const first = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });
      if (!first.ok) throw new Error(`expected ok, got ${first.code}: ${first.message}`);
      expect(await runRow(tx, staleQueued.rows[0]!.id)).toMatchObject({
        status: 'failed',
        stopped_reason: 'never_started',
        has_finished: true,
      });

      // 2. That run starts and then stops reporting: running, heartbeat 40 minutes old.
      await c.query(
        `update runs set status = 'running', started_at = now() - interval '45 minutes',
                         heartbeat_at = now() - interval '40 minutes'
          where id = $1`,
        [first.data.runId],
      );
      const second = await queueRun({ searchVersionId: versionId, kind: 'change_check' });
      if (!second.ok) throw new Error(`expected ok, got ${second.code}: ${second.message}`);
      expect(await runRow(tx, first.data.runId)).toMatchObject({
        status: 'failed',
        stopped_reason: 'abandoned',
        has_finished: true,
      });
      expect((await runRow(tx, second.data.runId)).status).toBe('queued');
    }));

  // A-WR-09. closeRun (steps.ts) is the only writer of runs.cost_micro_usd and matches only
  // status = 'running', so a run reclaimed as abandoned kept cost 0 forever (the preset page
  // read "$0.00" for a run that spent money). And a search's in-flight cursor — a request that
  // may have been billed — was left for its hold to expire and be released with no ledger row.
  // The reclaim now settles each still-open in-flight attempt AS CHARGED (settleInFlight's
  // pessimistic rule, under the attempt's own request id), clears the cursor, and stamps the
  // run's cost from the ledger.
  it('an abandoned run is costed from the ledger and its in-flight attempt is charged', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      const c = asPg(tx);
      const first = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });
      if (!first.ok) throw new Error(`expected ok, got ${first.code}: ${first.message}`);
      const runId = first.data.runId;
      const period = rowsOf<{ id: string }>(
        await tx.execute(sql`
          select budget_period_id as id from cost_reservations where id = ${first.data.reservationId}::uuid`),
      )[0]!.id;

      // As the owner: the run started, settled one billed page, then died mid-page and stopped
      // reporting 40 minutes ago — one search still carries its in-flight cursor.
      await c.query(
        `update runs set status = 'running', started_at = now() - interval '45 minutes',
                         heartbeat_at = now() - interval '40 minutes' where id = $1`,
        [runId],
      );
      const paid = await c.query<{ id: string }>(
        `insert into cost_reservations (org_id, budget_period_id, run_id, sku, est_micro_usd,
                                        expires_at, settled_at)
         values ($1, $2, $3, 'ts_enterprise', 35000, now() + interval '5 minutes', now())
         returning id`,
        [orgA, period, runId],
      );
      await c.query(
        `insert into cost_ledger (org_id, budget_period_id, reservation_id, run_id, provider, sku,
                                  units, micro_usd, request_id)
         values ($1, $2, $3, $4, 'places', 'ts_enterprise', 1, 35000, 'a-wr-09-settled-page')`,
        [orgA, period, paid.rows[0]!.id, runId],
      );
      const tile = await c.query<{ id: string }>(
        `insert into place_tiles (org_id, tile_key, unit_kind, unit_id, places_type, quad_path, depth,
                                  south, west, north, east)
         values ($1, 'city:48215/McAllen|plumber|r', 'city', '48215/McAllen', 'plumber', 'r', 0,
                 26.15, -98.3, 26.3, -98.18)
         on conflict (org_id, tile_key) do update set updated_at = now() returning id`,
        [orgA],
      );
      const hold = await c.query<{ id: string }>(
        `insert into cost_reservations (org_id, budget_period_id, run_id, sku, est_micro_usd, expires_at)
         values ($1, $2, $3, 'ts_enterprise', 35000, now() + interval '5 minutes') returning id`,
        [orgA, period, runId],
      );
      await c.query(
        `update budget_periods set reserved_micro_usd = reserved_micro_usd + 35000 where id = $1`,
        [period],
      );
      const search = await c.query<{ id: string }>(
        `insert into run_searches (org_id, run_id, tile_id, tile_key, cell_key, cluster_key,
                                   places_type, kind, depth, status,
                                   inflight_reservation_id, inflight_request_id)
         values ($1, $2, $3, 'city:48215/McAllen|plumber|r', 'home_services/48215/McAllen',
                 'home_services', 'plumber', 'enterprise', 0, 'searching', $4, 'a-wr-09-crashed-page')
         returning id`,
        [orgA, runId, tile.rows[0]!.id, hold.rows[0]!.id],
      );

      const second = await queueRun({ searchVersionId: versionId, kind: 'change_check' });
      if (!second.ok) throw new Error(`expected ok, got ${second.code}: ${second.message}`);

      const run = rowsOf<{ status: string; reason: string; cost: string }>(
        await tx.execute(sql`
          select status, stopped_reason as reason, cost_micro_usd::text as cost
            from runs where id = ${runId}::uuid`),
      )[0];
      // The in-flight page is inside the free 1,000, so it settles at $0 — the cost is the
      // settled page's, and it is no longer 0.
      expect(run).toEqual({ status: 'failed', reason: 'abandoned', cost: '35000' });
      const ledger = rowsOf<{ request_id: string; units: number; micro: string }>(
        await tx.execute(sql`
          select request_id, units, micro_usd::text as micro from cost_ledger
           where run_id = ${runId}::uuid order by request_id`),
      );
      expect(ledger).toEqual([
        { request_id: 'a-wr-09-crashed-page', units: 1, micro: '0' },
        { request_id: 'a-wr-09-settled-page', units: 1, micro: '35000' },
      ]);
      const res = rowsOf<{ settled: boolean }>(
        await tx.execute(sql`
          select settled_at is not null as settled from cost_reservations
           where id = ${hold.rows[0]!.id}::uuid`),
      );
      expect(res).toEqual([{ settled: true }]);
      const cursor = rowsOf<{ res: string | null; req: string | null }>(
        await tx.execute(sql`
          select inflight_reservation_id::text as res, inflight_request_id as req
            from run_searches where id = ${search.rows[0]!.id}::uuid`),
      );
      expect(cursor).toEqual([{ res: null, req: null }]);
    }));

  it('queueRun refuses a version without geometry', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, { allCounties: true });

      const r = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });

      if (r.ok) throw new Error('expected a no-geometry refusal');
      expect(r.code).toBe('validation');
      expect(r.message).toMatch(/^Siteless has no map outline for Anderson County, /);
      expect(r.message).toContain('tile them for Google Places');
      // A name, never a FIPS code (UI-SPEC Rule 35).
      expect(r.message).not.toMatch(/\b48\d{3}\b/);
      expect(await countOf(tx, 'runs', orgA)).toBe(0);
      expect(await countOf(tx, 'cost_reservations', orgA)).toBe(0);
      expect(startCalls).toHaveLength(0);
    }));

  it('queueRun releases the hold when the workflow cannot start', () =>
    inWorld(async (tx, orgA) => {
      const versionId = await seedVersion(tx, orgA, {});
      startBehaviour = 'reject';

      const r = await queueRun({ searchVersionId: versionId, kind: 'full_sweep' });

      expect(r).toEqual({ ok: false, code: 'unexpected', message: RUN_START_FAILED });
      expect(startCalls).toHaveLength(1);
      const runs = rowsOf<{ id: string }>(
        await tx.execute(sql`select id from runs where org_id = ${orgA}::uuid`),
      );
      expect(runs).toHaveLength(1);
      const runId = runs[0]!.id;
      expect(await runRow(tx, runId)).toMatchObject({
        status: 'failed',
        stopped_reason: 'never_started',
        workflow_run_id: null,
        has_finished: true,
      });
      const holds = await reservationsOf(tx, runId);
      expect(holds).toHaveLength(1);
      expect(holds[0]).toMatchObject({ released: true, settled: false });
      const ledger = rowsOf<{ n: number }>(
        await tx.execute(
          sql`select count(*)::int as n from cost_ledger where run_id = ${runId}::uuid`,
        ),
      );
      expect(ledger[0]?.n).toBe(0);
      const period = rowsOf<{ reserved: string }>(
        await tx.execute(sql`
          select reserved_micro_usd::text as reserved from budget_periods
           where org_id = ${orgA}::uuid and provider = 'places'`),
      );
      expect(period.map((p) => p.reserved)).toEqual(['0']);
    }));
});
