'use server';

import { requireOrg } from '@/lib/auth/require-org';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { estimatePreset as computeEstimate, type EstimateRange } from '@/lib/estimate/estimate';
import type { PresetSpec } from '@/lib/estimate/expand-cells';
import { ESTIMATE_UNAVAILABLE, UNEXPECTED_ERROR } from '@/lib/ui/copy';
import { readCurrentPeriod, readUnitsUsedThisPeriod } from '@/server/queries/budget';
import {
  getSeedTables,
  presetSpecSchema,
  readReferenceIndex,
  resolveSpec,
  type ReferenceIndex,
} from '@/server/queries/presets';
import { fail, ok, type ActionResult } from './_result';

/**
 * SRCH-04 / D-08. What a preset will cost, recomputed server-side on every edit.
 *
 * 🔴 NO PAID CALL, EVER. The figure is pure arithmetic over the committed seed and the live
 * budget row: `src/lib/estimate/` imports no database module and makes no request, and this
 * action adds a read of the meter and nothing else. The blast radius of hammering it is CPU,
 * not dollars (T-2-14), which is what makes an auth check plus a client-side debounce a
 * proportionate control rather than wishful thinking.
 *
 * 🔴 SERVER ACTIONS EXECUTE SEQUENTIALLY AND CANNOT BE CANCELLED. Next queues them and there
 * is no `AbortController`, so a keystroke's answer CAN land after a later keystroke's and
 * repaint a stale dollar figure over a fresh one (02-RESEARCH § The live debounced estimate;
 * Pitfall 5). The monotonic sequence guard that drops an out-of-order answer lives in the
 * client component in plan 02-11 and is NOT optional — nothing on this side can substitute
 * for it, because by the time the answer is computed the request that asked for it is gone.
 */
export async function estimatePreset(input: unknown): Promise<ActionResult<EstimateRange>> {
  // 🔴 T-2-01, and the first statement for that reason. `src/proxy.ts` carries no
  // authorization by design (CVE-2025-29927) and a Server Function is a POST to the page's
  // route, so an action reached directly — with no page ever rendered — is a real
  // unauthenticated entry point until this line runs.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = presetSpecSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      'validation',
      'That selection is not something Siteless can estimate. Reload the page and pick the ' +
        'clusters and geography again.',
    );
  }

  // Gathered inside ONE transaction, and the arithmetic deliberately left OUTSIDE it: the
  // estimator throws on an unseeded cluster-geography pair, and a try/catch wrapped around
  // the database read as well would report a connection failure as "we couldn't estimate
  // this preset" — a sentence that sends the user to change a geography that was fine.
  let gathered: { spec: PresetSpec; index: ReferenceIndex; units: number; period: Awaited<
    ReturnType<typeof readCurrentPeriod>
  > };
  try {
    const result = await withOrg(claims, async (tx) => {
      const index = await readReferenceIndex(tx);
      const resolved = resolveSpec(parsed.data, index, 'Estimate');
      if (!resolved.ok) return { kind: 'unresolvable', message: resolved.message } as const;
      const period = await readCurrentPeriod(tx, 'places');
      const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, period.id);
      return { kind: 'gathered', spec: resolved.spec, index, period, units } as const;
    });
    if (result.kind === 'unresolvable') return fail('validation', result.message);
    gathered = result;
  } catch {
    return fail('unexpected', UNEXPECTED_ERROR('this estimate'));
  }

  try {
    return ok(
      computeEstimate(gathered.spec, {
        seed: getSeedTables(),
        unitsUsedThisPeriod: gathered.units,
        capMicroUsd: gathered.period.capMicroUsd,
        spentMicroUsd: gathered.period.spentMicroUsd,
        reservedMicroUsd: gathered.period.reservedMicroUsd,
      }),
    );
  } catch {
    // UI-SPEC § Error → "Estimate can't be computed". The estimator throws rather than
    // returning zero precisely so this state is reachable: "~0 businesses · $0.00" reads as
    // "this preset is free", which is the one wrong answer that looks like a right one.
    return fail('validation', ESTIMATE_UNAVAILABLE(clusterLabel(gathered), geographyLabel(gathered)));
  }
}

/** The clusters the user actually picked, by display name — "Home Services & Trades", not
 *  `home_services`. CONVENTIONS § Naming: a key is never shown to a person. */
function clusterLabel(gathered: { spec: PresetSpec; index: ReferenceIndex }): string {
  const names = gathered.spec.clusterKeys.map((key) => {
    const id = gathered.index.clusterIdByKey.get(key);
    return (id && gathered.index.clusterById.get(id)?.displayName) || key;
  });
  return names.join(', ');
}

/** The geography, said the way the picker said it. */
function geographyLabel(gathered: { spec: PresetSpec; index: ReferenceIndex }): string {
  const geo = gathered.spec.geo;
  if (geo.kind === 'cities') {
    return geo.cities.map((c) => c.name).join(', ');
  }
  if (geo.kind === 'counties') {
    return geo.counties
      .map((fips) => {
        const id = gathered.index.countyIdByFips.get(fips);
        return (id && gathered.index.countyById.get(id)?.name) || fips;
      })
      .join(', ');
  }
  const id = gathered.index.countyIdByFips.get(geo.countyFips);
  const county = (id && gathered.index.countyById.get(id)?.name) || geo.countyFips;
  return `a ${geo.radiusMiles}-mile radius in ${county}`;
}
