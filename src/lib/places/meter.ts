import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withWorkerOrg } from '@/db/with-worker-org';
import { periodStart } from '@/lib/budget/period';
import {
  PRICE_BOOK,
  TEXT_SEARCH_TIERS,
  freeRemaining,
  priceRequests,
  type TextSearchSku,
} from '@/lib/budget/price-book';
import { mintReservedCall, type ReservedCall } from '@/lib/places/reserved-call';
import { readUnitsUsedThisPeriod, rowsOf, type Tx } from '@/server/queries/budget';

/**
 * D-15 / criterion 5. The ONLY minter of ReservedCall. Reserve → call → settle; the reservation
 * and the request ceiling are one transaction.
 *
 * `searchText` (src/lib/places/client.ts) demands a `ReservedCall`, and this module is the one
 * place under src/ that calls `mintReservedCall` (tests/unit/places-client.test.ts holds that as
 * an equality). So "no Places request without a reservation" holds by TYPE as well as by test.
 *
 * The flow, per page ATTEMPT (04-RESEARCH Pattern 2 / Pattern 6, Pitfalls 5 and 9):
 *
 *   1. `reservePage` — the mode gate (pure, before any SQL); then ONE `withWorkerOrg`
 *      transaction: re-read the run under RLS (a foreign org sees zero rows → WorkerOrgMismatch,
 *      M46), require `status = 'running'` (the kill switch for a run pinned to an old
 *      deployment, Pitfall 5), reserve the page's price at the meter, bump `calls_count` only
 *      while it is under `ceiling_requests` (D-15: the ceiling is on REQUESTS, not dollars), and
 *      write the durable in-flight cursor on the search. A refused ceiling throws inside the
 *      transaction so the reservation ROLLS BACK with it (M34).
 *   2. The caller sends the request with the minted `ReservedCall`.
 *   3. Settle per attempt: a 200 or an unknown outcome (timeout, a 200 that failed to parse) is
 *      CHARGED — settled at the actual price, 0 inside the free allowance, units 1; an error
 *      response is RELEASED with no ledger row. A crashed attempt (the cursor still set when the
 *      step replays) is settled as charged by `settleInFlight` before anything is called again.
 *
 * 🔴 A REFUSED RESERVATION IS ZERO ROWS, NOT AN EXCEPTION (queue-run.ts' rule): it comes back as
 * `{ kind: 'stop', reason: 'budget_cap_reached' }`, and the caller stops the run — it never
 * retries a cap refusal.
 */

/** `PLACES_MODE` (src/env.ts, D-02). Passed in by the caller; this module never reads env. */
export type PlacesMode = 'off' | 'ids_only' | 'enterprise';

export type ModeRefusal = 'places_off' | 'mode_forbids_sku' | 'places_key_missing';

/**
 * The mode gate (D-02, M28, M29). Pure, and the FIRST thing `reservePage` does — before any SQL,
 * so a refusal leaves no reservation behind.
 *
 * Order matters: `off` wins over everything (it is the answer an operator set on purpose), then
 * the SKU the mode permits, then the key. `ids_only` permits only the free IDs-only mask;
 * `enterprise` permits exactly the two masks the adapter builds (ts_essentials, ts_enterprise) —
 * a Pro or Atmosphere request is one the estimate never priced. An unknown mode (a value that
 * slipped past env parsing) refuses as `off` rather than defaulting open.
 */
export function modeAllows(
  mode: PlacesMode,
  sku: TextSearchSku,
  keyConfigured: boolean,
): true | ModeRefusal {
  if (mode !== 'ids_only' && mode !== 'enterprise') return 'places_off';
  if (mode === 'ids_only' && sku !== 'ts_essentials') return 'mode_forbids_sku';
  if (mode === 'enterprise' && sku !== 'ts_essentials' && sku !== 'ts_enterprise') {
    return 'mode_forbids_sku';
  }
  if (!keyConfigured) return 'places_key_missing';
  return true;
}

/**
 * M46. The run named by the step's input is not visible under the org the step claims: either
 * the ids disagree or the run does not exist. Fails closed — never retried into another org.
 */
export class WorkerOrgMismatch extends Error {
  constructor() {
    super('places_run_not_visible');
    this.name = 'WorkerOrgMismatch';
  }
}

/** Thrown INSIDE the reserve transaction so the reservation rolls back with the refused bump. */
class CeilingReached extends Error {
  constructor() {
    super('places_run_ceiling_reached');
    this.name = 'CeilingReached';
  }
}

/** The run a workflow step acts for: the Clerk org from its start input, and the run id. */
export type RunCtx = { clerkOrgId: string; runId: string };

/**
 * How long a PAGE hold lives (A-WR-08, TS half). A crashed attempt's hold is settled AS CHARGED
 * by `settleInFlight` when the step replays — after the workflow's retry backoff, and possibly
 * after admission's 30-minute `abandoned` reclaim. At `reserve_budget`'s 10-minute default the
 * expiry self-heal could release the hold first and race the late settle (0019 accepts a late
 * settle, but the release/settle pair is the window A-WR-08 describes). An hour outlives both;
 * the cost is one page price held a little longer after a crash.
 */
export const PAGE_HOLD_TTL = '60 minutes';

export type ReserveOutcome =
  | { kind: 'reserved'; call: ReservedCall }
  | { kind: 'stop'; reason: 'budget_cap_reached' | 'exceeded_estimate' }
  | { kind: 'refused'; reason: ModeRefusal }
  | { kind: 'not_running' };

function actorOf(ctx: RunCtx): `workflow:${string}` {
  return `workflow:${ctx.runId}`;
}

/** The step's first statement: the run, under RLS. Zero rows → WorkerOrgMismatch (M46). */
async function readRunStatus(tx: Tx, runId: string): Promise<string> {
  const run = rowsOf<{ status: string }>(
    await tx.execute(sql`select status from runs where id = ${runId}::uuid`),
  )[0];
  if (!run) throw new WorkerOrgMismatch();
  return run.status;
}

/**
 * Reserve ONE page attempt. See the header for the transaction's order; every refusal is a
 * returned value, and only a tenancy mismatch or a database fault throws.
 */
export async function reservePage(
  ctx: RunCtx,
  a: {
    searchId: string;
    page: 1 | 2 | 3;
    sku: TextSearchSku;
    mode: PlacesMode;
    keyConfigured: boolean;
    now?: Date;
  },
): Promise<ReserveOutcome> {
  // 1. The mode gate. BEFORE any SQL (M28, M29).
  const m = modeAllows(a.mode, a.sku, a.keyConfigured);
  if (m !== true) return { kind: 'refused', reason: m };

  // 2. Per ATTEMPT, never per page: settle_reservation is `on conflict (request_id) do nothing`,
  //    so a per-page key would let a retried page's second real charge be silently swallowed.
  const requestId = `places:${ctx.runId}:${a.searchId}:p${a.page}:${randomUUID()}`;
  const period = periodStart(a.now ?? new Date());
  // A zero-price page (ts_essentials) still holds ONE µUSD: reserve_budget refuses a zero
  // estimate (22023), and the zero-cost ledger row needs a reservation to settle against (D-16).
  const price = PRICE_BOOK[a.sku].microUsdPerRequest;
  const hold = price > 0 ? BigInt(price) : 1n;

  try {
    return await withWorkerOrg(ctx.clerkOrgId, actorOf(ctx), async (tx) => {
      // a. The run, under RLS; and the stop lever (Pitfall 5).
      const status = await readRunStatus(tx, ctx.runId);
      if (status !== 'running') return { kind: 'not_running' } as const;

      // b. The meter. A denial is zero rows (reservation_id null), never an exception.
      const meter = rowsOf<{ reservation_id: string | null }>(
        await tx.execute(sql`
          select reservation_id
            from app.reserve_budget('places', ${period}::date, ${hold.toString()}::bigint,
                                    ${ctx.runId}::uuid, ${a.sku}, ${PAGE_HOLD_TTL}::interval)`),
      )[0];
      if (!meter) throw new Error('reservePage: app.reserve_budget returned no row');
      if (meter.reservation_id === null) {
        return { kind: 'stop', reason: 'budget_cap_reached' } as const;
      }
      const reservationId = meter.reservation_id;

      // c. The request ceiling (D-15), in the SAME transaction. `status = 'running'` again, so a
      //    kill landing between (a) and here still stops this page. Zero rows → throw, and the
      //    reservation from (b) rolls back with it.
      const counted = rowsOf<{ calls_count: number }>(
        await tx.execute(sql`
          update runs
             set calls_count = calls_count + 1, heartbeat_at = now()
           where id = ${ctx.runId}::uuid
             and status = 'running'
             and calls_count < ceiling_requests
          returning calls_count`),
      );
      if (counted.length === 0) throw new CeilingReached();

      // d. The durable in-flight cursor (Pitfall 9): if this step dies after the call leaves,
      //    the replay finds it and settles the attempt as charged before calling again.
      await tx.execute(sql`
        select app.mark_run_search(${a.searchId}::uuid,
                                   jsonb_build_object('status', 'searching',
                                                      'inflight_reservation_id', ${reservationId}::text,
                                                      'inflight_request_id', ${requestId}::text))`);

      // e. The one mint.
      return { kind: 'reserved', call: mintReservedCall(reservationId, requestId, a.sku) } as const;
    });
  } catch (e) {
    if (e instanceof CeilingReached) return { kind: 'stop', reason: 'exceeded_estimate' };
    throw e;
  }
}

/**
 * Settles (charged) or releases (not charged) one attempt inside the caller's transaction, and
 * reports whether a ledger row was written. The in-flight cursor is the caller's to clear.
 *
 * 🔴 THE FREE ALLOWANCE IS COUNTED IN THE RESERVATION'S OWN PERIOD, not "the current" one: the
 * ledger row lands in the period the reservation points at (settle_reservation derives it), so
 * an attempt reserved at 23:59 on the 30th and settled after midnight must be priced against
 * the month it is recorded in. Reading the period off the reservation also avoids
 * ensure_budget_period's self-heal running in the middle of a settlement.
 */
async function settleAttempt(tx: Tx, call: ReservedCall, charged: boolean): Promise<boolean> {
  if (!charged) {
    await tx.execute(sql`select app.release_reservation(${call.reservationId}::uuid)`);
    return false;
  }
  const res = rowsOf<{ budget_period_id: string }>(
    await tx.execute(sql`
      select budget_period_id from cost_reservations where id = ${call.reservationId}::uuid`),
  )[0];
  if (!res) throw new Error('settle: the reservation is not visible to this org');
  const units = await readUnitsUsedThisPeriod(tx, call.sku, res.budget_period_id);
  const actual = priceRequests(call.sku, 1, freeRemaining(call.sku, units)).microUsd;
  const settled = rowsOf<{ ok: boolean }>(
    await tx.execute(sql`
      select app.settle_reservation(${call.reservationId}::uuid, ${call.requestId},
                                    ${actual}::bigint, 1, ${call.sku}, 'places') as ok`),
  )[0];
  return settled?.ok === true;
}

/**
 * Per attempt, inside the caller's transaction (04-19's recorder settles in the same
 * transaction that writes the page and clears the cursor).
 *
 * charged → `app.settle_reservation` at the actual price (0 inside the free 1,000; units 1);
 * a replay of the same attempt writes nothing (the request id is unique).
 * not charged → `app.release_reservation`: the hold is freed and NO ledger row is written.
 */
export async function settleInTx(tx: Tx, call: ReservedCall, charged: boolean): Promise<void> {
  await settleAttempt(tx, call, charged);
}

const CLEAR_INFLIGHT = JSON.stringify({ inflight_reservation_id: null, inflight_request_id: null });

/**
 * One transaction for an attempt that writes no results (an error response, an unknown outcome
 * on a page that is abandoned): settle or release, then clear the search's in-flight cursor.
 * The run is re-read first (M46) but NOT required to be running — a killed run's last attempt
 * must still be ledgered.
 */
export async function settleOrRelease(
  ctx: RunCtx,
  call: ReservedCall,
  a: { charged: boolean; searchId: string },
): Promise<void> {
  await withWorkerOrg(ctx.clerkOrgId, actorOf(ctx), async (tx) => {
    await readRunStatus(tx, ctx.runId);
    await settleAttempt(tx, call, a.charged);
    await tx.execute(
      sql`select app.mark_run_search(${a.searchId}::uuid, ${CLEAR_INFLIGHT}::jsonb)`,
    );
  });
}

function isTextSearchSku(v: string): v is TextSearchSku {
  return (TEXT_SEARCH_TIERS as readonly string[]).includes(v);
}

/**
 * Pitfall 9. Before a page is (re)tried, settle whatever attempt the search still has in flight:
 * the step that made it died after the request may have left, so its outcome is UNKNOWN and is
 * settled AS CHARGED (pessimistic), under the crashed attempt's own request id — a replay of
 * this function then writes nothing more. Returns true when a ledger row was written.
 *
 * 🔴 "Not yet settled" is the test, not "neither settled nor released". Every deliberate release
 * (`settleOrRelease`) clears the cursor in the same transaction, so a cursor that still points
 * at a released hold can only mean the hold EXPIRED and the self-heal freed it while the call's
 * outcome was never recorded. settle_reservation accepts that late settle (drizzle/0019 WR-03):
 * the charge is recorded rather than lost.
 */
export async function settleInFlight(ctx: RunCtx, searchId: string): Promise<boolean> {
  return withWorkerOrg(ctx.clerkOrgId, actorOf(ctx), async (tx) => {
    await readRunStatus(tx, ctx.runId);
    return settleInFlightInTx(tx, ctx.runId, searchId);
  });
}

/**
 * `settleInFlight`'s body, inside the CALLER's transaction — for a caller that already holds one
 * under the right org (e.g. admission's stale-run reclaim, A-WR-09), so the pricing rule
 * (settleAttempt: charged at the actual price, free allowance counted in the reservation's own
 * period) is never restated. The caller is responsible for the org context and for having
 * re-read the run under it.
 */
export async function settleInFlightInTx(
  tx: Tx,
  runId: string,
  searchId: string,
): Promise<boolean> {
  const cursor = rowsOf<{
    inflight_reservation_id: string | null;
    inflight_request_id: string | null;
  }>(
    await tx.execute(sql`
      select inflight_reservation_id, inflight_request_id
        from run_searches
       where id = ${searchId}::uuid and run_id = ${runId}::uuid`),
  )[0];
  if (!cursor) throw new WorkerOrgMismatch();
  if (cursor.inflight_reservation_id === null && cursor.inflight_request_id === null) {
    return false;
  }

  let wrote = false;
  if (cursor.inflight_reservation_id !== null && cursor.inflight_request_id !== null) {
    const res = rowsOf<{ sku: string; open: boolean }>(
      await tx.execute(sql`
        select sku, (settled_at is null) as open
          from cost_reservations where id = ${cursor.inflight_reservation_id}::uuid`),
    )[0];
    if (res?.open) {
      if (!isTextSearchSku(res.sku)) {
        throw new Error('settleInFlight: the in-flight reservation is not a Text Search sku');
      }
      const call = mintReservedCall(
        cursor.inflight_reservation_id,
        cursor.inflight_request_id,
        res.sku,
      );
      wrote = await settleAttempt(tx, call, true);
    }
  }
  await tx.execute(sql`select app.mark_run_search(${searchId}::uuid, ${CLEAR_INFLIGHT}::jsonb)`);
  return wrote;
}
