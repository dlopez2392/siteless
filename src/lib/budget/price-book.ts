/**
 * What a call COSTS. Data, not logic — the logic that picks a row lives in
 * `field-mask-tier.ts`, and the two are separate files on purpose: the price is a
 * published table, the tier is a request-shaping decision.
 *
 * BUDG-01 / T-2-08. The price of a call is derived from the field mask actually sent —
 * `priceRequests(fieldMaskTier(maskSent), …)` — never from a per-call constant. A
 * constant and the invoice diverge silently, and the whole product is a number danlo
 * trusts enough to act on.
 *
 * Money is micro-USD (µUSD) integers. One Text Search Enterprise request is 35,000 µUSD
 * = 3.50 ¢. Rounding each row to a whole cent is ±14.3 % at a $50 cap — $57.12 rounding
 * up (the cap refuses early) or $42.84 rounding down (the cap over-spends). Nothing in
 * this module rounds; `money.ts` rounds for DISPLAY only and never feeds back in.
 *
 * Source: developers.google.com/maps/billing-and-pricing/pricing, fetched 2026-09-22,
 * cross-checked against the field→SKU table at
 * developers.google.com/maps/documentation/places/web-service/data-fields.
 */

/**
 * The four Text Search tiers, in ASCENDING price order. The order is load-bearing:
 * `fieldMaskTier` bills at the HIGHEST tier present in a mask and resolves "highest" by
 * index into this array.
 */
export const TEXT_SEARCH_TIERS = [
  'ts_essentials',
  'ts_pro',
  'ts_enterprise',
  'ts_enterprise_atmosphere',
] as const;

/** What a field mask can resolve to. A strict subset of `Sku`. */
export type TextSearchSku = (typeof TEXT_SEARCH_TIERS)[number];

export type Sku = TextSearchSku | 'pd_essentials' | 'pd_pro' | 'pd_enterprise';

export type Provider = 'places' | 'firecrawl' | 'anthropic';

export interface SkuPrice {
  provider: Provider;
  /** Google's published SKU id, where one is published for the tier. */
  googleSkuId: string | null;
  microUsdPerRequest: number;
  /** `null` means unlimited — Text Search Essentials (IDs-Only) is free without a cap. */
  freePerMonth: number | null;
}

export const PRICE_BOOK: Record<Sku, SkuPrice> = {
  ts_essentials: {
    provider: 'places',
    googleSkuId: '635D-A9DD-C520',
    microUsdPerRequest: 0,
    freePerMonth: null,
  },
  ts_pro: {
    provider: 'places',
    googleSkuId: '4FDA-34B1-A910',
    microUsdPerRequest: 32000,
    freePerMonth: 5000,
  },
  ts_enterprise: {
    provider: 'places',
    googleSkuId: 'E967-44BC-B44D',
    microUsdPerRequest: 35000,
    freePerMonth: 1000,
  },
  ts_enterprise_atmosphere: {
    provider: 'places',
    googleSkuId: '120C-BEC3-B48F',
    microUsdPerRequest: 40000,
    freePerMonth: 1000,
  },
  pd_essentials: {
    provider: 'places',
    googleSkuId: null,
    microUsdPerRequest: 5000,
    freePerMonth: 10000,
  },
  pd_pro: {
    provider: 'places',
    googleSkuId: null,
    microUsdPerRequest: 17000,
    freePerMonth: 5000,
  },
  pd_enterprise: {
    provider: 'places',
    googleSkuId: '2D9A-3DE0-3766',
    microUsdPerRequest: 20000,
    freePerMonth: 1000,
  },
};

export interface PricedRequests {
  /** Requests left after the month's free allowance absorbed what it could. */
  billable: number;
  microUsd: number;
}

/**
 * 🔴 THE FREE ALLOWANCE IS NOT OPTIONAL.
 *
 * A preset priced at 68 Text Search Enterprise requests costs $0.00 on the 2nd of the
 * month and $2.38 once the first 1,000 are gone. Quoting $2.38 early in the month is
 * wrong in the direction that makes danlo distrust the number — which is the product.
 *
 * `freeRemaining` shadows the exported function of the same name inside this body, and
 * deliberately so: it is the SAME quantity, and the intended call is
 * `priceRequests(sku, n, freeRemaining(sku, unitsUsedThisPeriod))`. Pass
 * `Number.POSITIVE_INFINITY` for an unlimited SKU and `billable` collapses to 0.
 */
export function priceRequests(sku: Sku, requests: number, freeRemaining: number): PricedRequests {
  if (!Number.isInteger(requests) || requests < 0) {
    // Refuse rather than coerce. A fractional or negative request count is a caller bug,
    // and a silently-clamped one becomes a ledger row that never matches the invoice.
    throw new Error(`priceRequests: requests must be a non-negative integer, got ${requests}`);
  }
  if (Number.isNaN(freeRemaining)) {
    throw new Error(`priceRequests: freeRemaining must be a number, got ${freeRemaining}`);
  }

  const billable = Math.max(0, requests - Math.max(0, freeRemaining));
  const microUsd = billable * PRICE_BOOK[sku].microUsdPerRequest;

  // PITFALLS 2: the meter's own arithmetic is the last place an overflow should hide.
  // µUSD leaves ~9 billion requests of headroom inside a float's integer range; past it
  // the number is silently approximate and the ledger stops reconciling.
  if (!Number.isSafeInteger(microUsd)) {
    throw new Error(`priceRequests: cost overflows exact integer range for ${sku} × ${requests}`);
  }

  return { billable, microUsd };
}

/**
 * How much of this SKU's monthly free allowance is left.
 *
 * Derivable only because the ledger records EVERY paid-SKU call including the zero-cost
 * ones (`micro_usd = 0`, `units` set). A free-tier Enterprise call is a paid-SKU call
 * that happened to cost nothing; skip those rows and every early-month estimate is wrong.
 */
export function freeRemaining(sku: Sku, unitsUsedThisPeriod: number): number {
  if (!Number.isInteger(unitsUsedThisPeriod) || unitsUsedThisPeriod < 0) {
    throw new Error(
      `freeRemaining: unitsUsedThisPeriod must be a non-negative integer, got ${unitsUsedThisPeriod}`,
    );
  }
  const free = PRICE_BOOK[sku].freePerMonth;
  if (free === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, free - unitsUsedThisPeriod);
}
