/**
 * The per-page meter against the real database (plan 04-16, criterion 5, D-15, D-16).
 *
 * What these prove, each where it can fail:
 *   - a refused mode (off, no key) leaves NO reservation — the gate runs before any SQL (M28);
 *   - the reservation and the request ceiling are one transaction: the page past
 *     `ceiling_requests` is refused AND its reservation rolls back (M34);
 *   - a cap refusal is a returned `budget_cap_reached`, never an exception;
 *   - settlement per attempt: free-allowance price, list price past it, zero-cost ts_essentials
 *     row (D-16), release with no ledger row, and a crashed in-flight attempt settled as charged
 *     exactly once (Pitfall 9);
 *   - the worker context: another org's run fails closed (M46), a stopped run reserves nothing
 *     (Pitfall 5), and the REAL withWorkerOrg installs exactly `{o:{id}}` + the actor GUC.
 *
 * 🔴 THE DOUBLE. `@/db/with-worker-org` is replaced (vi.doMock + dynamic import, undone in
 * afterAll — the DB suite runs `isolate: false`, so a hoisted vi.mock could leak into another
 * file) by a SAVEPOINT on the test's rolled-back transaction that does what the real helper
 * does inside it: the `{o:{id}}` claim (no subject, no role claim), the actor GUC, and
 * `set local role authenticated`. There is NO `actAs` anywhere on the meter's path: the claims
 * the meter runs under are the ones the worker tier really sets, never a fixture's more
 * permissive ones. A refusal inside the savepoint rolls back only the savepoint, the same way
 * the real transaction would roll back. On success the double resets the role and clears both
 * GUCs before releasing, because a released savepoint's `set local` would otherwise persist
 * into the owner's fixture statements that follow.
 *
 * The real helper is proven separately (last test), on the runtime app_user pool, read-only.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@/server/queries/budget';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { seedPlacesRun, seedRunSearch } from './_places-fixtures';

// Hoisted above every import: src/env.ts parses process.env at module load and src/db/client.ts
// opens its pool from it (tests/db/with-org.test.ts, the same prelude). The runtime pool must
// be the NON-OWNER app_user URL; CI names it RUNTIME_DB_URL.
vi.hoisted(() => {
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/places-meter.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set (the non-owner runtime role).',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/places-meter.test.ts: the database URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

vi.mock('server-only', () => ({}));

type Meter = typeof import('@/lib/places/meter');
type WorkerOrg = typeof import('@/db/with-worker-org').withWorkerOrg;

/** The test's open transaction, and how many times the meter opened a worker context. */
const state: { tx: Tx | null; workerCalls: number } = { tx: null, workerCalls: 0 };

let meter: Meter;
let realWithWorkerOrg: WorkerOrg;
let realDb: typeof import('@/db/client').db;

const workerDouble = async <T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const outer = state.tx;
  if (!outer) throw new Error('places-meter: no test transaction is open');
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
  // A fresh module graph: another file in this non-isolated suite may already have ended the
  // shared runtime pool (tests/db/with-org.test.ts does, in its afterAll).
  vi.resetModules();
  realWithWorkerOrg = (await import('@/db/with-worker-org')).withWorkerOrg;
  realDb = (await import('@/db/client')).db;
  vi.doMock('@/db/with-worker-org', () => ({ withWorkerOrg: workerDouble }));
  meter = await import('@/lib/places/meter');
});

afterAll(async () => {
  vi.doUnmock('@/db/with-worker-org');
  state.tx = null;
  await realDb.$client.end({ timeout: 5 });
  vi.resetModules();
  await closeDrizzleTx();
});

const TILE = { tileKey: 'city:48215/McAllen|plumber|r', placesType: 'plumber' };
const ADMIN_A = {
  o: { id: 'org_A', rol: 'admin' },
  sub: 'user_admin_A',
  role: 'authenticated',
} as const;

type World = {
  tx: Tx;
  orgA: string;
  orgB: string;
  runId: string;
  searchId: string;
  ctx: { clerkOrgId: string; runId: string };
};

/** Two orgs, a run in org A (status/ceiling as asked) and one planned search, all as the owner. */
function inWorld(
  opts: { ceilingRequests?: number; status?: 'running' | 'failed' },
  fn: (w: World) => Promise<void>,
): Promise<void> {
  return withTxRollback(async (tx) => {
    state.tx = tx;
    state.workerCalls = 0;
    try {
      const c = asPg(tx);
      const { a, b } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a, {
        ceilingRequests: opts.ceilingRequests ?? 10,
        status: opts.status ?? 'running',
      });
      const search = await seedRunSearch(c, a, run.runId, TILE);
      await fn({
        tx,
        orgA: a,
        orgB: b,
        runId: run.runId,
        searchId: search.runSearchId,
        ctx: { clerkOrgId: 'org_A', runId: run.runId },
      });
    } finally {
      state.tx = null;
    }
  });
}

function rows<T>(r: unknown): T[] {
  return r as T[];
}

async function reservationsOf(tx: Tx, runId: string): Promise<number> {
  const r = rows<{ n: number }>(
    await tx.execute(sql`select count(*)::int as n from cost_reservations where run_id = ${runId}`),
  );
  return r[0]?.n ?? -1;
}

async function reservationsOfOrg(tx: Tx, orgId: string): Promise<number> {
  const r = rows<{ n: number }>(
    await tx.execute(sql`select count(*)::int as n from cost_reservations where org_id = ${orgId}`),
  );
  return r[0]?.n ?? -1;
}

async function ledgerOf(tx: Tx, runId: string) {
  return rows<{ request_id: string; sku: string; units: number; micro: string }>(
    await tx.execute(sql`
      select request_id, sku, units, micro_usd::text as micro
        from cost_ledger where run_id = ${runId} order by occurred_at, id`),
  );
}

async function callsCount(tx: Tx, runId: string): Promise<number> {
  const r = rows<{ n: number }>(
    await tx.execute(sql`select calls_count as n from runs where id = ${runId}`),
  );
  return r[0]?.n ?? -1;
}

async function inflightOf(tx: Tx, searchId: string) {
  return rows<{ res: string | null; req: string | null; status: string }>(
    await tx.execute(sql`
      select inflight_reservation_id::text as res, inflight_request_id as req, status
        from run_searches where id = ${searchId}`),
  )[0];
}

async function reservationRow(tx: Tx, id: string) {
  return rows<{ est: string; sku: string; settled: boolean; released: boolean; run_id: string }>(
    await tx.execute(sql`
      select est_micro_usd::text as est, sku, settled_at is not null as settled,
             released_at is not null as released, run_id::text as run_id
        from cost_reservations where id = ${id}`),
  )[0];
}

async function periodTotals(tx: Tx, orgId: string) {
  return rows<{ reserved: string; spent: string }>(
    await tx.execute(sql`
      select reserved_micro_usd::text as reserved, spent_micro_usd::text as spent
        from budget_periods where org_id = ${orgId} and provider = 'places'`),
  )[0];
}

const ENTERPRISE = { mode: 'enterprise', keyConfigured: true, sku: 'ts_enterprise' } as const;

async function reserved(
  w: World,
  a: Partial<Parameters<Meter['reservePage']>[1]> = {},
): Promise<import('@/lib/places/reserved-call').ReservedCall> {
  const out = await meter.reservePage(w.ctx, {
    searchId: w.searchId,
    page: 1,
    ...ENTERPRISE,
    ...a,
  });
  if (out.kind !== 'reserved')
    throw new Error('expected a reservation, got ' + JSON.stringify(out));
  return out.call;
}

describe('the Places meter (criterion 5)', () => {
  it('off mode refuses before any reservation', () =>
    inWorld({}, async (w) => {
      const before = await reservationsOfOrg(w.tx, w.orgA);
      const out = await meter.reservePage(w.ctx, {
        searchId: w.searchId,
        page: 1,
        sku: 'ts_enterprise',
        mode: 'off',
        keyConfigured: true,
      });
      expect(out).toEqual({ kind: 'refused', reason: 'places_off' });
      expect(await reservationsOfOrg(w.tx, w.orgA)).toBe(before);
      expect(await callsCount(w.tx, w.runId)).toBe(0);
      // Not one statement: the worker context was never opened.
      expect(state.workerCalls).toBe(0);
    }));

  it('a missing key refuses before any reservation', () =>
    inWorld({}, async (w) => {
      const out = await meter.reservePage(w.ctx, {
        searchId: w.searchId,
        page: 1,
        ...ENTERPRISE,
        keyConfigured: false,
      });
      expect(out).toEqual({ kind: 'refused', reason: 'places_key_missing' });
      expect(await reservationsOfOrg(w.tx, w.orgA)).toBe(0);
      expect(state.workerCalls).toBe(0);
    }));

  it('a run stops at 2x its estimate-high', () =>
    inWorld({ ceilingRequests: 2 }, async (w) => {
      const first = await meter.reservePage(w.ctx, {
        searchId: w.searchId,
        page: 1,
        ...ENTERPRISE,
      });
      const second = await meter.reservePage(w.ctx, {
        searchId: w.searchId,
        page: 2,
        ...ENTERPRISE,
      });
      const third = await meter.reservePage(w.ctx, {
        searchId: w.searchId,
        page: 3,
        ...ENTERPRISE,
      });
      expect(first.kind).toBe('reserved');
      expect(second.kind).toBe('reserved');
      expect(third).toEqual({ kind: 'stop', reason: 'exceeded_estimate' });
      // The third page's reservation was granted by the meter and then ROLLED BACK with the
      // refused ceiling bump — one transaction, so exactly two exist and the budget holds two.
      expect(await reservationsOf(w.tx, w.runId)).toBe(2);
      expect(await callsCount(w.tx, w.runId)).toBe(2);
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '70000', spent: '0' });
      // The cursor still names the second page's attempt, not a rolled-back third.
      if (second.kind !== 'reserved') throw new Error('unreachable');
      expect((await inflightOf(w.tx, w.searchId))?.res).toBe(second.call.reservationId);
    }));

  it('a refused reservation stops with budget_cap_reached', () =>
    inWorld({}, async (w) => {
      // The cap, lowered below one Enterprise page through the real admin path.
      const c = asPg(w.tx);
      await actAs(c, ADMIN_A);
      await c.query('select app.set_budget_cap($1, $2)', ['places', 10000]);
      await actAsOwner(c);

      const out = await meter.reservePage(w.ctx, { searchId: w.searchId, page: 1, ...ENTERPRISE });
      expect(out).toEqual({ kind: 'stop', reason: 'budget_cap_reached' });
      expect(await reservationsOf(w.tx, w.runId)).toBe(0);
      // A refused page is not a request: the ceiling counter did not move.
      expect(await callsCount(w.tx, w.runId)).toBe(0);
      expect((await inflightOf(w.tx, w.searchId))?.res).toBeNull();
    }));

  it('a zero-price page still reserves one micro-dollar', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w, { mode: 'ids_only', sku: 'ts_essentials' });
      expect(await reservationRow(w.tx, call.reservationId)).toMatchObject({
        est: '1',
        sku: 'ts_essentials',
        settled: false,
        released: false,
        run_id: w.runId,
      });
      expect(call.sku).toBe('ts_essentials');
      // The request id is per ATTEMPT: run, search, page, and a fresh uuid.
      expect(call.requestId).toMatch(
        new RegExp(`^places:${w.runId}:${w.searchId}:p1:[0-9a-f-]{36}$`),
      );
      expect(await inflightOf(w.tx, w.searchId)).toEqual({
        res: call.reservationId,
        req: call.requestId,
        status: 'searching',
      });
    }));

  it('a change check ledgers a zero-cost row', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w, { mode: 'ids_only', sku: 'ts_essentials' });
      await workerDouble('org_A', `workflow:${w.runId}`, (tx) => meter.settleInTx(tx, call, true));
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { request_id: call.requestId, sku: 'ts_essentials', units: 1, micro: '0' },
      ]);
      expect(await reservationRow(w.tx, call.reservationId)).toMatchObject({ settled: true });
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '0' });
    }));

  it('a free-allowance page settles at zero and counts a unit', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w);
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '35000', spent: '0' });
      await workerDouble('org_A', `workflow:${w.runId}`, (tx) => meter.settleInTx(tx, call, true));
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { request_id: call.requestId, sku: 'ts_enterprise', units: 1, micro: '0' },
      ]);
      // The hold came back and nothing was spent: the call was inside Google's free 1,000.
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '0' });
    }));

  it('a page past the free allowance settles at the list price', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w);
      // 1,000 Enterprise units already used this period, seeded as the owner against the
      // period the reservation points at.
      const res = rows<{ period: string }>(
        await w.tx.execute(sql`
          select budget_period_id::text as period from cost_reservations
           where id = ${call.reservationId}`),
      )[0]!;
      const seed = rows<{ id: string }>(
        await w.tx.execute(sql`
          insert into cost_reservations (org_id, budget_period_id, run_id, sku, est_micro_usd,
                                         expires_at, settled_at)
          values (${w.orgA}, ${res.period}, ${w.runId}, 'ts_enterprise', 1, now(), now())
          returning id`),
      )[0]!;
      await w.tx.execute(sql`
        insert into cost_ledger (org_id, budget_period_id, reservation_id, run_id, provider, sku,
                                 units, micro_usd, request_id)
        values (${w.orgA}, ${res.period}, ${seed.id}, ${w.runId}, 'places', 'ts_enterprise',
                1000, 0, ${'seed-free-1000:' + w.runId})`);

      await workerDouble('org_A', `workflow:${w.runId}`, (tx) => meter.settleInTx(tx, call, true));
      const mine = (await ledgerOf(w.tx, w.runId)).filter((r) => r.request_id === call.requestId);
      expect(mine).toEqual([
        { request_id: call.requestId, sku: 'ts_enterprise', units: 1, micro: '35000' },
      ]);
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '35000' });
    }));

  it('an error response releases the reservation and writes no ledger row', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w);
      await meter.settleOrRelease(w.ctx, call, { charged: false, searchId: w.searchId });
      expect(await reservationRow(w.tx, call.reservationId)).toMatchObject({
        settled: false,
        released: true,
      });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([]);
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '0' });
      expect(await inflightOf(w.tx, w.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('an unknown outcome on an abandoned page settles as charged and clears the cursor', () =>
    inWorld({}, async (w) => {
      const call = await reserved(w);
      await meter.settleOrRelease(w.ctx, call, { charged: true, searchId: w.searchId });
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { request_id: call.requestId, sku: 'ts_enterprise', units: 1, micro: '0' },
      ]);
      expect(await inflightOf(w.tx, w.searchId)).toMatchObject({ res: null, req: null });
    }));

  it('a retried page never under-ledgers', () =>
    inWorld({}, async (w) => {
      // The "crash": the attempt was reserved (cursor set) and the step died before settling.
      const crashed = await reserved(w);
      expect((await inflightOf(w.tx, w.searchId))?.req).toBe(crashed.requestId);

      // The replay settles it AS CHARGED, under the crashed attempt's own request id.
      expect(await meter.settleInFlight(w.ctx, w.searchId)).toBe(true);
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { request_id: crashed.requestId, sku: 'ts_enterprise', units: 1, micro: '0' },
      ]);
      expect(await inflightOf(w.tx, w.searchId)).toMatchObject({ res: null, req: null });

      // A second replay finds nothing in flight and writes nothing.
      expect(await meter.settleInFlight(w.ctx, w.searchId)).toBe(false);
      expect(await ledgerOf(w.tx, w.runId)).toHaveLength(1);
    }));

  it('two charged attempts at the same page are two ledger rows', () =>
    inWorld({}, async (w) => {
      // A retried page is a second real request. The request id is per ATTEMPT, so the
      // ledger's `on conflict (request_id) do nothing` cannot swallow the second charge.
      const first = await reserved(w, { page: 1 });
      await meter.settleOrRelease(w.ctx, first, { charged: true, searchId: w.searchId });
      const retry = await reserved(w, { page: 1 });
      await meter.settleOrRelease(w.ctx, retry, { charged: true, searchId: w.searchId });
      expect(retry.requestId).not.toBe(first.requestId);
      // Sorted: occurred_at is now(), the same instant for both rows inside one transaction.
      expect((await ledgerOf(w.tx, w.runId)).map((r) => r.request_id).sort()).toEqual(
        [first.requestId, retry.requestId].sort(),
      );
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '0' });
    }));

  it('a crashed attempt whose hold expired is still ledgered', () =>
    inWorld({}, async (w) => {
      const crashed = await reserved(w);
      // The hold expires and the self-heal frees it, while the call's outcome was never
      // recorded. Exactly what the next reserve_budget / ensure_budget_period would do.
      await w.tx.execute(sql`
        update cost_reservations set expires_at = now() - interval '1 minute'
         where id = ${crashed.reservationId}`);
      const c = asPg(w.tx);
      await actAs(c, { o: { id: 'org_A' }, role: 'authenticated' });
      await c.query(
        `select app.release_expired_reservations('places',
           (select period_start from budget_periods where org_id = $1 and provider = 'places'))`,
        [w.orgA],
      );
      await actAsOwner(c);
      expect(await reservationRow(w.tx, crashed.reservationId)).toMatchObject({
        settled: false,
        released: true,
      });

      expect(await meter.settleInFlight(w.ctx, w.searchId)).toBe(true);
      expect(await ledgerOf(w.tx, w.runId)).toEqual([
        { request_id: crashed.requestId, sku: 'ts_enterprise', units: 1, micro: '0' },
      ]);
      // The hold was already freed by the self-heal, so nothing is double-freed.
      expect(await periodTotals(w.tx, w.orgA)).toEqual({ reserved: '0', spent: '0' });
    }));

  it("a workflow step cannot write another org's run", () =>
    inWorld({}, async (w) => {
      const foreign = { clerkOrgId: 'org_B', runId: w.runId };
      await expect(
        meter.reservePage(foreign, { searchId: w.searchId, page: 1, ...ENTERPRISE }),
      ).rejects.toBeInstanceOf(meter.WorkerOrgMismatch);
      expect(await reservationsOf(w.tx, w.runId)).toBe(0);
      expect(await reservationsOfOrg(w.tx, w.orgB)).toBe(0);
      expect(await callsCount(w.tx, w.runId)).toBe(0);

      // The settle paths fail closed the same way.
      await expect(meter.settleInFlight(foreign, w.searchId)).rejects.toBeInstanceOf(
        meter.WorkerOrgMismatch,
      );
    }));

  it('a run that is no longer running reserves nothing', () =>
    inWorld({ status: 'failed' }, async (w) => {
      const out = await meter.reservePage(w.ctx, { searchId: w.searchId, page: 1, ...ENTERPRISE });
      expect(out).toEqual({ kind: 'not_running' });
      expect(await reservationsOf(w.tx, w.runId)).toBe(0);
      expect(await callsCount(w.tx, w.runId)).toBe(0);
    }));

  it('the meter ran only through the worker double', () =>
    inWorld({}, async (w) => {
      // Guards the harness itself: if the doMock had not taken, the meter would have used the
      // REAL helper on the app_user pool, outside this rolled-back transaction, and the
      // reservation would be invisible here.
      const call = await reserved(w);
      expect(state.workerCalls).toBe(1);
      expect(await reservationRow(w.tx, call.reservationId)).toMatchObject({ run_id: w.runId });
    }));
});

describe('withWorkerOrg, the real helper (D-14, M46)', () => {
  it('withWorkerOrg sets only the org claim and the workflow actor', async () => {
    const seen = await realWithWorkerOrg('org_worker_probe', 'workflow:probe-run', async (tx) =>
      rows<{ claims: string; who: string; actor: string; role: string | null }>(
        await tx.execute(sql`
          select current_setting('request.jwt.claims', true) as claims,
                 current_user::text as who,
                 current_setting('app.actor_id', true) as actor,
                 app.current_org_role() as role`),
      ),
    );
    const row = seen[0]!;
    // Exactly {o:{id}} — no subject, no role claim, nothing else.
    expect(JSON.parse(row.claims)).toEqual({ o: { id: 'org_worker_probe' } });
    expect(row.who).toBe('authenticated');
    expect(row.actor).toBe('workflow:probe-run');
    // Org context, not admin: no role-gated definer is reachable from a workflow.
    expect(row.role).toBeNull();

    // Transaction-local: the pooled connection (max 1) comes back without them.
    const after = rows<{ claims: string | null; actor: string | null; who: string }>(
      await realDb.execute(sql`
        select current_setting('request.jwt.claims', true) as claims,
               current_setting('app.actor_id', true) as actor,
               current_user::text as who`),
    )[0]!;
    expect(after.claims ?? '').toBe('');
    expect(after.actor ?? '').toBe('');
    expect(after.who).toBe('app_user');
  });

  it('withWorkerOrg refuses an empty org id before opening a transaction', async () => {
    await expect(realWithWorkerOrg('  ', 'workflow:x', async () => 'ran')).rejects.toThrow(
      'withWorkerOrg: a clerk org id is required',
    );
  });
});
