'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { env } from '@/env';
import { requireOrg } from '@/lib/auth/require-org';
import { periodStart } from '@/lib/budget/period';
import {
  ESTIMATE_SKU,
  RUN_ABANDONED_AFTER_MINUTES,
  RUN_CEILING_MULTIPLIER,
  RUN_NEVER_STARTED_AFTER_MINUTES,
} from '@/lib/estimate/assumptions';
import { estimatePreset as computeEstimate } from '@/lib/estimate/estimate';
import { cellKey } from '@/lib/estimate/expand-cells';
import { settleInFlightInTx } from '@/lib/places/meter';
import {
  cellsForRun,
  missingGeometry,
  planRootSearches,
  type RunKind,
} from '@/lib/places/plan-run';
import { storedLeaves } from '@/lib/places/stored-leaves';
import { MAX_PAGES, type GeoShapesFile, type TileSpec } from '@/lib/places/tiling';
import {
  NOT_FOUND,
  RUN_ALREADY_IN_PROGRESS,
  RUN_MODE_REFUSED,
  RUN_NO_GEOMETRY,
  RUN_REFUSED,
  RUN_START_FAILED,
  UNEXPECTED_ERROR,
} from '@/lib/ui/copy';
import {
  readCurrentPeriod,
  readUnitsUsedThisPeriod,
  rowsOf,
  type Tx,
} from '@/server/queries/budget';
import {
  getSeedTables,
  readReferenceIndex,
  resolveSpec,
  specInputOfVersion,
  type ReferenceIndex,
} from '@/server/queries/presets';
import { placesSweep } from '@/workflows/places-sweep/workflow';
import { fail, ok, type ActionResult } from './_result';

/**
 * BUDG-02 + D-14. "Run this preset" — admit a run and start the places-sweep workflow on it.
 *
 * The order is the safety argument, and every step before `start()` can refuse:
 *
 *   1. D-02. `PLACES_MODE` is checked BEFORE any transaction. `off` refuses every run and
 *      `ids_only` every run but the free change check, so a refused mode writes no row and
 *      takes no hold. This is the action-side twin of the disabled buttons (UI-SPEC Rule 33):
 *      the button is an affordance, this is the boundary.
 *   2. Stale runs are reclaimed first — a `queued` run older than
 *      RUN_NEVER_STARTED_AFTER_MINUTES is `failed / never_started`, a `running` one silent for
 *      RUN_ABANDONED_AFTER_MINUTES is `failed / abandoned` — so a crashed run cannot hold the
 *      org's one active slot forever. An abandoned run's in-flight attempts are settled as
 *      charged and its cost is stamped from the ledger (`closeAbandonedRun`, A-WR-09).
 *   3. D-16 / D-18. Admission is sized by the SAME planner the workflow runs: `cellsForRun`
 *      picks the run's cells (a partition prices only this week's), `missingGeometry` refuses a
 *      unit with no outline here rather than inside `beginRun`, and the type-aware estimate is
 *      priced over exactly those cells.
 *   4. D-15 / T-4-12. `ceiling_requests = ceil(RUN_CEILING_MULTIPLIER × requestsHi)` is written
 *      at insert and is never updatable by a tenant (drizzle/0027 § 6). A change check's is
 *      `ceil(RUN_CEILING_MULTIPLIER × storedLeaves × MAX_PAGES)` instead (B-WR-05).
 *   5. One active run per org. The insert is `on conflict … do nothing` against
 *      `runs_one_active_per_org`, so a concurrent second admission gets the SAME `busy` answer
 *      as a sequential one, instead of a `23505` escaping as `unexpected`.
 *   6. THE METER. The hold is the admission hold that `beginRun` (04-22) RELEASES — never
 *      settles — once the workflow is running; each page then reserves for itself (04-16).
 *
 * 🔴 A DENIAL IS ZERO ROWS, NOT AN EXCEPTION. `app.reserve_budget` returns a row whose
 * `reservation_id` is NULL when the conditional UPDATE granted nothing. There is nothing to
 * catch; treating the refusal as an error is how a sentence becomes a 500.
 *
 * 🔴 `start()` RUNS ONLY AFTER THE TRANSACTION COMMITS (04-RESEARCH Pattern 1). Started from
 * inside it, the workflow's `beginRun` could read before the row exists (a fatal
 * `places_request_rejected`), or run a row whose transaction then rolled back. And if `start()`
 * itself fails, the hold is released and the run is closed `failed / never_started` — so the
 * drawer's "nothing was reserved and nothing was charged" is literally true.
 *
 * 🔴 T-4-06. The workflow's tenant is `clerkOrgId` = the Clerk `o.id` from the server-verified
 * `requireOrg()` — never the client's input — and the version was read under RLS before the
 * run row existed.
 */
const queueRunInputSchema = z.strictObject({
  searchVersionId: z.uuid(),
  kind: z.enum(['full_sweep', 'partition', 'change_check']).default('full_sweep'),
});

/** The most unit names a no-geometry sentence lists before "and N more". The Texas preset
 *  has 250 units without an outline, and a 250-name sentence is not a sentence. */
const NO_GEOMETRY_LISTED = 3;

/** `missingGeometry` names a county by kind + FIPS (`county 48001`), which is a machine key
 *  (UI-SPEC Rule 35); the drawer shows its name. Cities already arrive by name. */
function unitNamesForPeople(names: string[], index: ReferenceIndex): string[] {
  const readable = names.map((n) => {
    const m = /^county (\d{5})$/.exec(n);
    if (!m) return n;
    const id = index.countyIdByFips.get(m[1] ?? '');
    const county = id ? index.countyById.get(id) : undefined;
    return county ? `${county.name} County` : 'a county';
  });
  if (readable.length <= NO_GEOMETRY_LISTED + 1) return readable;
  return [...readable.slice(0, NO_GEOMETRY_LISTED), `${readable.length - NO_GEOMETRY_LISTED} more`];
}

/**
 * A-WR-09. What the abandoned reclaim owes the ledger, inside the admission transaction.
 *
 * `closeRun` (src/workflows/places-sweep/steps.ts) is the only writer of `runs.cost_micro_usd`
 * and matches only `status = 'running'`, so a run reclaimed here would keep cost 0 forever and
 * the preset page would read "$0.00" for a run that spent money. And a search whose step died
 * mid-page still carries its in-flight cursor: the request may have left and been billed, and
 * if nothing settles it the hold expires and is released with NO ledger row.
 *
 * So, per abandoned run:
 *   1. every search still carrying a cursor goes through the meter's `settleInFlightInTx`
 *      (src/lib/places/meter.ts, F3): a reservation not yet settled is settled AS CHARGED under
 *      the attempt's own request id, priced by the meter's one rule (actual price, free
 *      allowance counted in the reservation's own period), and the cursor is cleared. This
 *      module restates none of that. A replay writes nothing (the request id is unique). Each
 *      settle runs in a savepoint: a refusal there must not wedge every future admission of
 *      this org behind the same dead run, so a failed settle leaves that cursor in place (the
 *      durable record) and the reclaim goes on;
 *   2. the run's cost is stamped from the ledger, as closeRun would have.
 *
 * The caller has just re-read the run under this org (its `update … returning id` runs
 * under RLS), which is settleInFlightInTx's precondition.
 */
async function closeAbandonedRun(tx: Tx, runId: string): Promise<void> {
  const cursors = rowsOf<{ search_id: string }>(
    await tx.execute(sql`
      select s.id as search_id
        from run_searches s
       where s.run_id = ${runId}::uuid
         and (s.inflight_reservation_id is not null or s.inflight_request_id is not null)`),
  );
  for (const c of cursors) {
    try {
      await tx.transaction(async (sp) => {
        await settleInFlightInTx(sp as unknown as Tx, runId, c.search_id);
      });
    } catch {
      // Deliberately swallowed — see (1) above. The cursor stays as the record.
    }
  }
  await tx.execute(sql`
    update runs r
       set cost_micro_usd = (select coalesce(sum(l.micro_usd), 0)
                               from cost_ledger l where l.run_id = r.id)
     where r.id = ${runId}::uuid`);
}

/** The 0.8 MB TIGERweb outlines, loaded only when a run is admitted (the step does the same). */
async function loadShapes(): Promise<GeoShapesFile> {
  return (await import('@/seed/data/geo-shapes.json')).default as GeoShapesFile;
}

export async function queueRun(input: unknown): Promise<
  ActionResult<{
    runId: string;
    reservationId: string;
    pctAfter: number;
    at80: boolean;
  }>
> {
  // 🔴 T-2-01. First statement. This is the one action that can cause spend, so it is the one
  // where a missed check would cost money rather than privacy.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = queueRunInputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', NOT_FOUND('version'));
  const { searchVersionId, kind } = parsed.data;

  // 1. D-02, before any transaction: no row, no hold, no start.
  const mode = env.PLACES_MODE;
  if (mode === 'off' || (mode === 'ids_only' && kind !== 'change_check')) {
    return fail('mode_refused', RUN_MODE_REFUSED(mode));
  }

  const shapes = await loadShapes();
  const period = periodStart(new Date());
  const runKind: RunKind = kind;

  async function runInTransaction() {
    return withOrg(claims, async (tx) => {
      // 2. Reclaim stale runs. `finished_at` is stamped so the report shows when it ended.
      await tx.execute(sql`
        update runs
           set status = 'failed', stopped_reason = 'never_started', finished_at = now()
         where status = 'queued'
           and created_at < now() - make_interval(mins => ${RUN_NEVER_STARTED_AFTER_MINUTES})`);
      // `created_at` as the last resort: a running row with neither stamp would otherwise
      // never be abandoned, and would hold the slot for good.
      const abandoned = rowsOf<{ id: string }>(
        await tx.execute(sql`
          update runs
             set status = 'failed', stopped_reason = 'abandoned', finished_at = now()
           where status = 'running'
             and coalesce(heartbeat_at, started_at, created_at)
                 < now() - make_interval(mins => ${RUN_ABANDONED_AFTER_MINUTES})
          returning id`),
      );
      for (const run of abandoned) await closeAbandonedRun(tx, run.id);

      // 3. The version. RLS confines it, so another tenant's id is simply not here.
      const version = rowsOf<{
        search_id: string;
        cluster_ids: string[];
        geo_kind: string;
        geo_payload: unknown;
        display_name: string;
        now_ms: string;
      }>(
        await tx.execute(sql`
          select v.search_id, v.cluster_ids, v.geo_kind, v.geo_payload, s.display_name,
                 (extract(epoch from now()) * 1000)::bigint::text as now_ms
            from search_versions v
            join searches s on s.id = v.search_id
           where v.id = ${searchVersionId}`),
      )[0];
      if (!version) return { kind: 'missing' } as const;

      // What it will cost, recomputed from the version's own snapshot of the spec — never from
      // `estimate_snapshot`, which is what somebody was QUOTED, possibly last month.
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

      // The transaction's own `now()` — the value `runs.created_at` defaults to, and the instant
      // `beginRun` plans a partition from — so admission and execution pick the SAME week.
      const now = new Date(Number(version.now_ms));
      const seed = getSeedTables();
      let cells: ReturnType<typeof cellsForRun>;
      let missing: string[];
      try {
        cells = cellsForRun(resolved.spec, seed, runKind, now);
        missing = missingGeometry(cells.cells, resolved.spec, shapes);
      } catch {
        return { kind: 'unestimable' } as const;
      }
      if (missing.length > 0) {
        return { kind: 'no_geometry', names: unitNamesForPeople(missing, index) } as const;
      }

      const budget = await readCurrentPeriod(tx, 'places');
      const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, budget.id);
      const keys = new Set(cells.cells.map((c) => cellKey(c.clusterKey, c.unitId)));

      let estimate: ReturnType<typeof computeEstimate>;
      try {
        estimate = computeEstimate(
          resolved.spec,
          {
            seed,
            unitsUsedThisPeriod: units,
            capMicroUsd: budget.capMicroUsd,
            spentMicroUsd: budget.spentMicroUsd,
            reservedMicroUsd: budget.reservedMicroUsd,
          },
          { onlyCells: (c) => keys.has(cellKey(c.clusterKey, c.unitId)) },
        );
      } catch {
        return { kind: 'unestimable' } as const;
      }

      // A change check lists ids with the free Essentials search: it costs nothing and holds
      // one micro-dollar on that SKU. Every other kind is Enterprise and holds the top of its
      // estimate.
      const isCheck = runKind === 'change_check';
      const sku = isCheck ? 'ts_essentials' : ESTIMATE_SKU;
      const costLo = isCheck ? 0 : estimate.costMicroUsdLo;
      const costHi = isCheck ? 0 : estimate.costMicroUsdHi;

      // B-WR-05. A change check executes the leaves the last sweep STORED (beginRun replaces
      // each root with `storedLeaves(tx, roots)`), never subdivides, and lists at most MAX_PAGES
      // pages per leaf — so its request ceiling is sized from that same list, read here in the
      // admission transaction under the same org. The Enterprise estimate prices roots and
      // subdivision, which is not what a check sends. Every other kind keeps D-15's rule.
      let ceiling: number;
      if (isCheck) {
        let roots: TileSpec[];
        try {
          roots = planRootSearches({ spec: resolved.spec, seed, shapes, kind: runKind, now });
        } catch {
          return { kind: 'unestimable' } as const;
        }
        const leaves = await storedLeaves(tx, roots);
        ceiling = Math.ceil(RUN_CEILING_MULTIPLIER * leaves.length * MAX_PAGES);
      } else {
        ceiling = Math.ceil(RUN_CEILING_MULTIPLIER * estimate.requestsHi);
      }

      // 🔴 A ZERO ESTIMATE STILL TAKES A HOLD, OF ONE MICRO-DOLLAR. `app.reserve_budget` raises
      // `22023 non-positive estimate` on a zero — correctly, or a caller could hold the meter
      // open for free (T-2-07) — and a run that holds nothing is a run outside the meter.
      const holdMicroUsd = costHi > 0 ? BigInt(costHi) : 1n;

      // 4 + 5. The run row, BEFORE the reservation, so the reservation can name it and a
      // refusal has something to record itself on. A conflict on the one-active-run index is
      // zero rows, the same way a refused reservation is.
      const run = rowsOf<{ id: string }>(
        await tx.execute(sql`
          insert into runs (org_id, search_version_id, status, kind, partition_index,
                            estimate_requests_lo, estimate_requests_hi,
                            estimate_micro_usd_lo, estimate_micro_usd_hi,
                            ceiling_requests, requested_by)
          values (app.current_org_id(), ${searchVersionId}, 'queued', ${runKind},
                  ${cells.partitionIndex}, ${estimate.requestsLo}, ${estimate.requestsHi},
                  ${String(costLo)}::bigint, ${String(costHi)}::bigint,
                  ${ceiling}, ${userId})
          on conflict (org_id) where status in ('queued', 'running') do nothing
          returning id`),
      )[0];
      if (!run?.id) {
        const running = rowsOf<{ id: string }>(
          await tx.execute(sql`
            select id from runs where status in ('queued', 'running')
             order by created_at limit 1`),
        )[0];
        return { kind: 'busy', runningRunId: running?.id ?? null } as const;
      }

      // 6. THE METER.
      const meter = rowsOf<{
        reservation_id: string | null;
        pct_after: string | null;
        at_80: boolean;
        at_100: boolean;
      }>(
        await tx.execute(sql`
          select reservation_id, pct_after::text as pct_after, at_80, at_100
            from app.reserve_budget('places', ${period}::date, ${holdMicroUsd.toString()}::bigint,
                                    ${run.id}::uuid, ${sku})`),
      )[0];
      if (!meter) throw new Error('queueRun: app.reserve_budget returned no row');

      const pctAfter = meter.pct_after === null ? 100 : Number(meter.pct_after);

      // 🔴 REFUSED. Zero rows was the refusal, and this is where it becomes a sentence. The run
      // is kept, not deleted: "we refused to start this" is spend history too.
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
  if (outcome.kind === 'no_geometry') {
    return fail('validation', RUN_NO_GEOMETRY(outcome.names));
  }
  if (outcome.kind === 'busy') {
    return fail(
      'conflict',
      RUN_ALREADY_IN_PROGRESS,
      outcome.runningRunId
        ? { reason: 'busy', runningRunId: outcome.runningRunId }
        : { reason: 'busy' },
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

  // THE TRANSACTION HAS COMMITTED. Only now may the workflow see the run.
  const { runId, reservationId } = outcome;
  let workflowRunId: string;
  try {
    const wf = await start(placesSweep, [{ runId, clerkOrgId: orgId }]);
    workflowRunId = wf.runId;
  } catch {
    // Nothing was sent: release the hold (never settle it — a settle writes a ledger row) and
    // close the run as never started, both only while it is still queued. If this cleanup
    // fails too, the hold expires on its own and the next admission reclaims the run.
    try {
      await withOrg(claims, async (tx) => {
        await tx.execute(sql`select app.release_reservation(${reservationId}::uuid)`);
        await tx.execute(sql`
          update runs
             set status = 'failed', stopped_reason = 'never_started', finished_at = now()
           where id = ${runId} and status = 'queued'`);
      });
    } catch {
      // Deliberately swallowed — see above; the answer to the user is the same.
    }
    return fail('unexpected', RUN_START_FAILED);
  }

  // The link from the run to its workflow, for the report and for operators. Best effort: the
  // workflow is already running and owns the run from here, so a failure to stamp it must not
  // turn a started run into a reported failure.
  try {
    await withOrg(claims, (tx) =>
      tx.execute(sql`update runs set workflow_run_id = ${workflowRunId} where id = ${runId}`),
    );
  } catch {
    // See above.
  }

  return ok({
    runId,
    reservationId,
    pctAfter: outcome.pctAfter,
    at80: outcome.at80,
  });
}
