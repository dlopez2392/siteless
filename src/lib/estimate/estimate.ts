/**
 * SRCH-04: what a preset will cost and what it will find, before a cent is spent.
 *
 * 🔴 PURE. No I/O, no database import, no clock, no fetch. The caller (plan 02-09's server
 * action) reads the seed tables and the budget context and hands them in. Keeping the
 * arithmetic out of the data access is what makes D-08's recompute-as-you-type safe: an
 * estimate can never reserve, spend, or touch a row.
 *
 * 🔴 T-2-08: the estimate prices through the SAME `priceRequests` / `PRICE_BOOK` the ledger
 * uses, with the same free allowance. A second price table would drift from the first and
 * the product would quote one number and bill another.
 */
import { freeRemaining, priceRequests, type Sku } from '@/lib/budget/price-book';
import { CLUSTER_KEYS, type ClusterKey } from '@/seed/types';
import {
  ESTIMATE_SKU,
  FAN_OUT,
  PAGES_HI,
  PAGES_LO,
  RADIUS_REFERENCE_MILES,
} from './assumptions';
import { expandCells, type PresetSpec, type SeedTables } from './expand-cells';

export type EstimateContext = {
  seed: SeedTables;
  /** Paid-SKU units already consumed this budget period, free-tier ones included. This is
   *  what makes the free allowance derivable; see price-book.ts § freeRemaining. */
  unitsUsedThisPeriod: number;
  capMicroUsd: bigint;
  spentMicroUsd: bigint;
  reservedMicroUsd: bigint;
};

/** Surfaced verbatim in the assumptions drawer beside the estimate that used them, so the
 *  drawer cannot show one fan-out while the number was built from another. */
export type EstimateAssumptions = {
  fanOut: number;
  pagesLo: number;
  pagesHi: number;
  radiusReferenceMiles: number;
};

export type EstimateRange = {
  cells: number;
  requestsLo: number;
  requestsHi: number;
  costMicroUsdLo: number;
  costMicroUsdHi: number;
  expectedResults: number;
  freeRemaining: number;
  remainingMicroUsd: bigint;
  pctOfRemainingLo: number;
  pctOfRemainingHi: number;
  sku: Sku;
  assumptions: EstimateAssumptions;
};

/**
 * Percent of the remaining budget a cost would consume.
 *
 * 🔴 Never divides by zero and never returns NaN or Infinity. At a spent-out cap the
 * honest answer to "what share of what is left does this take" is "all of it" — 100 — and
 * a free run at a spent-out cap is 0, not 100. UI-SPEC renders this straight into a
 * sentence; `NaN%` on the estimate line is how a user stops believing the whole screen.
 */
function pctOfRemaining(costMicroUsd: number, remainingMicroUsd: bigint): number {
  if (remainingMicroUsd > 0n) {
    return (100 * costMicroUsd) / Number(remainingMicroUsd);
  }
  return costMicroUsd > 0 ? 100 : 0;
}

export function estimatePreset(spec: PresetSpec, ctx: EstimateContext): EstimateRange {
  const cells = expandCells(spec, ctx.seed);
  const cellCount = cells.length;

  // `ceil`, not `round`: a fractional request is a request. Rounding 68 × 3 × 3.0 down
  // anywhere in this path under-quotes the cost, which is the one direction that matters.
  const requestsLo = Math.ceil(cellCount * PAGES_LO * FAN_OUT);
  const requestsHi = Math.ceil(cellCount * PAGES_HI * FAN_OUT);

  // 🔴 THE FREE ALLOWANCE IS APPLIED. The RGV baseline is 612 requests at the top of its
  // range; while the month's first 1,000 Text Search Enterprise requests are still free
  // that preset costs $0.00, not $21.42. Quoting the gross figure is wrong in the
  // direction that makes danlo distrust the number, and the number is the product.
  const free = freeRemaining(ESTIMATE_SKU, ctx.unitsUsedThisPeriod);
  const costMicroUsdLo = priceRequests(ESTIMATE_SKU, requestsLo, free).microUsd;
  const costMicroUsdHi = priceRequests(ESTIMATE_SKU, requestsHi, free).microUsd;

  // Sum exact, round once — see expand-cells.ts § why a cell carries two counts.
  const expectedResults = Math.round(cells.reduce((sum, c) => sum + c.expectedOutletsExact, 0));

  const remainingMicroUsd = ctx.capMicroUsd - ctx.spentMicroUsd - ctx.reservedMicroUsd;

  return {
    cells: cellCount,
    requestsLo,
    requestsHi,
    costMicroUsdLo,
    costMicroUsdHi,
    expectedResults,
    freeRemaining: free,
    remainingMicroUsd,
    pctOfRemainingLo: pctOfRemaining(costMicroUsdLo, remainingMicroUsd),
    pctOfRemainingHi: pctOfRemaining(costMicroUsdHi, remainingMicroUsd),
    sku: ESTIMATE_SKU,
    assumptions: {
      fanOut: FAN_OUT,
      pagesLo: PAGES_LO,
      pagesHi: PAGES_HI,
      radiusReferenceMiles: RADIUS_REFERENCE_MILES,
    },
  };
}

/** The seeded built-in geographies (D-04, D-05). Keys, not display names — a display name
 *  is copy and copy changes. */
export const RGV_BASELINE_PRESET_KEY = 'rgv_17_cities';
export const RGV_COUNTIES_PRESET_KEY = 'rgv_4_counties';
export const TEXAS_PRESET_KEY = 'texas_254_counties';

/**
 * A built-in geography as a full-coverage `PresetSpec` — every cluster crossed with every
 * unit. This is the shape the Texas multiplier compares, and it is derived from the seed
 * rather than restated, so promoting a city or adding a cluster moves the multiplier
 * automatically instead of leaving a stale constant behind.
 */
export function builtInSpec(key: string, seed: SeedTables): PresetSpec {
  const preset = seed.geoPresets.geoPresets.find((p) => p.key === key);
  if (!preset) {
    throw new Error(
      `builtInSpec: no seeded geo preset "${key}" in src/seed/data/geo-presets.json`,
    );
  }
  const clusterKeys: ClusterKey[] = [...CLUSTER_KEYS];

  if (preset.kind === 'cities') {
    return {
      name: preset.displayName,
      clusterKeys,
      geo: { kind: 'cities', cities: preset.cities.map((c) => ({ ...c })) },
    };
  }
  if (preset.kind === 'counties') {
    return {
      name: preset.displayName,
      clusterKeys,
      geo: { kind: 'counties', counties: [...preset.counties] },
    };
  }
  throw new Error(
    `builtInSpec: geo preset "${key}" has kind "${preset.kind}", which is not a built-in ` +
      `geography kind. A radius is produced by geocoding an address and cannot be seeded.`,
  );
}

/**
 * How much more a Texas sweep costs than the RGV baseline.
 *
 * 🔴 COMPUTED, NEVER A CONSTANT (Executor Rule 16). UI-SPEC's Texas badge carries an
 * illustrative multiplier in its copy table; the seeded cell lists do not produce it. The
 * real ratio falls out of 1,016 cells against 68 — and it moves the moment the city list
 * or the cluster list does, which is exactly why it must not be typed into a string.
 */
export function texasMultiplier(ctx: EstimateContext): number {
  const texas = estimatePreset(builtInSpec(TEXAS_PRESET_KEY, ctx.seed), ctx);
  const baseline = estimatePreset(builtInSpec(RGV_BASELINE_PRESET_KEY, ctx.seed), ctx);
  if (baseline.requestsHi <= 0) {
    throw new Error(
      'texasMultiplier: the RGV baseline priced at zero requests, so a multiple of it is ' +
        'undefined. src/seed/data/geo-presets.json seeded no cities.',
    );
  }
  return texas.requestsHi / baseline.requestsHi;
}
