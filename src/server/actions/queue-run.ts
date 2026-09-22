'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { requireOrg } from '@/lib/auth/require-org';
import { periodStart } from '@/lib/budget/period';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { estimatePreset as computeEstimate } from '@/lib/estimate/estimate';
import { NOT_FOUND, PHASE4_RUN_NOTICE, RUN_REFUSED, UNEXPECTED_ERROR } from '@/lib/ui/copy';
import {
  readCurrentPeriod,
  readUnitsUsedThisPeriod,
  rowsOf,
} from '@/server/queries/budget';
import {
  getSeedTables,
  readReferenceIndex,
  resolveSpec,
  specInputOfVersion,
} from '@/server/queries/presets';
import { fail, ok, type ActionResult } from './_result';

/**
 * BUDG-02. "Run this preset" — a `runs` row in status `queued`, and a REAL budget
 * reservation.
 *
 * 🔴 THE RESERVATION IS THE POINT. Nothing in Phase 2 makes a paid call — the Places
 * verifier is Phase 4 — so it would have been easy to queue a row and reserve nothing. Then
 * success criterion 5's refusal at 100 % would exist only in a test, and the first time a
 * user met it would be in production with real money already spent. The meter is exercised
 * from the UI now, against a cap that is real, months before the first call is billed.
 *
 * 🔴 A DENIAL IS ZERO ROWS, NOT AN EXCEPTION. `app.reserve_budget` returns a row whose
 * `reservation_id` is NULL when the conditional UPDATE granted nothing. There is nothing to
 * catch; a try/catch around the reserve would never fire, and treating the refusal as an
 * error is how a sentence becomes a 500.
 *
 * 🔴 RESERVE THE WORST CASE, SETTLE THE ACTUAL. The hold is `costMicroUsdHi`, the top of the
 * estimate range. Reserving one page and discovering three is the only way to breach the cap.
 * The true-up is `app.settle_reservation`'s, in Phase 4, and an UNTAKEN reservation is
 * released by the next caller's self-heal — there is deliberately no cleanup code here.
 */
const queueRunInputSchema = z.strictObject({
  searchVersionId: z.uuid(),
});

export async function queueRun(input: unknown): Promise<
  ActionResult<{
    runId: string;
    reservationId: string;
    pctAfter: number;
    at80: boolean;
    notice: string;
  }>
> {
  // 🔴 T-2-01. First statement. This is also the only action in the phase that can cause
  // spend, so it is the one where a missed check would cost money rather than privacy.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = queueRunInputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', NOT_FOUND('version'));
  const { searchVersionId } = parsed.data;

  const period = periodStart(new Date());

  async function runInTransaction() {
    return withOrg(claims, async (tx) => {
      // 1. The version. RLS confines it, so another tenant's id is simply not here.
      const version = rowsOf<{
        search_id: string;
        cluster_ids: string[];
        geo_kind: string;
        geo_payload: unknown;
        display_name: string;
      }>(
        await tx.execute(sql`
          select v.search_id, v.cluster_ids, v.geo_kind, v.geo_payload, s.display_name
            from search_versions v
            join searches s on s.id = v.search_id
           where v.id = ${searchVersionId}`),
      )[0];
      if (!version) return { kind: 'missing' } as const;

      // 2. What it will cost, recomputed from the version's own snapshot of the spec —
      // never from `estimate_snapshot`, which is what somebody was QUOTED, possibly last
      // month, against a free allowance that has since been consumed.
      const index = await readReferenceIndex(tx);
      const specInput = specInputOfVersion(
        version.cluster_ids,
        version.geo_kind,
        version.geo_payload,
        index,
      );
      if (!specInput) return { kind: 'unestimable' } as const;
      const resolved = resolveSpec(specInput, index, version.display_name);
      if (!resolved.ok) return { kind: 'unestimable' } as const;

      const budget = await readCurrentPeriod(tx, 'places');
      const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, budget.id);

      let estimateHi: number;
      try {
        estimateHi = computeEstimate(resolved.spec, {
          seed: getSeedTables(),
          unitsUsedThisPeriod: units,
          capMicroUsd: budget.capMicroUsd,
          spentMicroUsd: budget.spentMicroUsd,
          reservedMicroUsd: budget.reservedMicroUsd,
        }).costMicroUsdHi;
      } catch {
        return { kind: 'unestimable' } as const;
      }

      // 🔴 A ZERO ESTIMATE STILL TAKES A HOLD, OF ONE MICRO-DOLLAR.
      //
      // Inside the monthly free allowance `costMicroUsdHi` is exactly 0, and
      // `app.reserve_budget` raises `22023 non-positive estimate` on a zero — correctly, or
      // a caller could hold the meter open for free (T-2-07). But a free-tier call is still
      // a paid-SKU call that must produce a ledger row (`micro_usd = 0`, `units` set), or
      // the allowance stops being derivable and every early-month estimate goes wrong; and
      // `cost_ledger.reservation_id` is NOT NULL with an FK, so that row cannot exist
      // without a reservation to settle against. One µUSD — a ten-thousandth of a cent — is
      // what keeps a free run inside the meter instead of outside it.
      const holdMicroUsd = estimateHi > 0 ? BigInt(estimateHi) : 1n;

      // 3. The run row, BEFORE the reservation, so the reservation can name it and a refusal
      // has something to record itself on.
      const run = rowsOf<{ id: string }>(
        await tx.execute(sql`
          insert into runs (org_id, search_version_id, status)
          values (app.current_org_id(), ${searchVersionId}, 'queued')
          returning id`),
      )[0];
      if (!run?.id) throw new Error('queueRun: runs insert returned no id');

      // 4. THE METER.
      const meter = rowsOf<{
        reservation_id: string | null;
        pct_after: string | null;
        at_80: boolean;
        at_100: boolean;
      }>(
        await tx.execute(sql`
          select reservation_id, pct_after::text as pct_after, at_80, at_100
            from app.reserve_budget('places', ${period}::date, ${holdMicroUsd.toString()}::bigint,
                                    ${run.id}::uuid, ${ESTIMATE_SKU})`),
      )[0];
      if (!meter) throw new Error('queueRun: app.reserve_budget returned no row');

      const pctAfter = meter.pct_after === null ? 100 : Number(meter.pct_after);

      // 5. 🔴 REFUSED. Zero rows was the refusal, and this is where it becomes a sentence.
      // The run is kept, not deleted: "we refused to start this" is spend history too, and
      // UI-SPEC's status map tells `refused` apart from `failed` for exactly this reason.
      if (meter.reservation_id === null) {
        await tx.execute(sql`
          update runs
             set status = 'refused', stopped_reason = 'budget_cap_reached'
           where id = ${run.id}`);
        return {
          kind: 'refused',
          searchId: version.search_id,
          capMicroUsd: budget.capMicroUsd,
          pctAfter,
        } as const;
      }

      return {
        kind: 'queued',
        runId: run.id,
        reservationId: meter.reservation_id,
        searchId: version.search_id,
        pctAfter,
        at80: meter.at_80,
      } as const;
    });
  }

  let outcome: Awaited<ReturnType<typeof runInTransaction>>;
  try {
    outcome = await runInTransaction();
  } catch {
    return fail('unexpected', UNEXPECTED_ERROR('this run'));
  }

  if (outcome.kind === 'missing') return fail('not_found', NOT_FOUND('preset version'));
  if (outcome.kind === 'unestimable') {
    return fail(
      'validation',
      'Siteless could not price this version, so it will not start a run it cannot cost. ' +
        'Open the preset and pick its geography again.',
    );
  }

  // Both outcomes below committed a row, so both revalidate.
  revalidatePath('/spend');
  revalidatePath(`/presets/${outcome.searchId}`);

  if (outcome.kind === 'refused') {
    return fail('budget_refused', RUN_REFUSED(outcome.capMicroUsd), {
      pctAfter: outcome.pctAfter,
    });
  }

  return ok({
    runId: outcome.runId,
    reservationId: outcome.reservationId,
    pctAfter: outcome.pctAfter,
    at80: outcome.at80,
    // UI-SPEC § Open Question 7: the drawer must say runs execute when the Places verifier
    // ships in Phase 4. Carried in the payload so the confirmation cannot show a success
    // state that implies something is running right now.
    notice: PHASE4_RUN_NOTICE,
  });
}
