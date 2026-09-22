/**
 * BUDG-01 / T-2-08. The published price table, and the fact that a ledger row's price is
 * a function of the mask that was actually sent.
 *
 * Mutations, one named test each:
 *   - PRICE_BOOK.ts_enterprise.microUsdPerRequest 35000 -> 35
 *       → 'price book: one Text Search Enterprise request is 35000 micro-USD' AND
 *         'price book atmosphere: the ledger price follows the mask'. Two, because the
 *         price table and the mask→price path are different claims.
 *   - M11 half 2: append 'places.reviews' to PLACES_TEXT_SEARCH_FIELD_MASK
 *       → 'price book atmosphere: the ledger price follows the mask' alone here; half 1
 *         is 'fieldMaskTier atmosphere' in field-mask-tier.test.ts and they share no
 *         assertion.
 *
 * Exact integers throughout. A toBeCloseTo here would hide the ±14.3 % whole-cent error
 * the µUSD design exists to avoid — 1,428 paid requests are $49.98, $57.12 rounded up per
 * row, $42.84 rounded down.
 */
import { describe, expect, it } from 'vitest';
import { freeRemaining, priceRequests, PRICE_BOOK } from '@/lib/budget/price-book';
import { fieldMaskTier, PLACES_TEXT_SEARCH_FIELD_MASK } from '@/lib/budget/field-mask-tier';
import { formatUsd, microToCents } from '@/lib/budget/money';

describe('the SKU price table (BUDG-01)', () => {
  it('price book: one Text Search Enterprise request is 35000 micro-USD', () => {
    // The row itself, by SKU id, so a re-ordered or re-keyed table is red rather than
    // quietly priced from the neighbouring tier.
    expect(PRICE_BOOK.ts_enterprise.googleSkuId).toBe('E967-44BC-B44D');
    expect(PRICE_BOOK.ts_enterprise.microUsdPerRequest).toBe(35000);
    expect(PRICE_BOOK.ts_enterprise.freePerMonth).toBe(1000);

    expect(priceRequests('ts_enterprise', 1, 0)).toEqual({ billable: 1, microUsd: 35000 });

    // A $50 cap's worth of paid requests, to the exact micro-dollar — and what a human
    // is shown for it. Exact equality on both: a whole-cent ledger would render $57.12
    // rounding up or $42.84 rounding down, and both are a plausible-looking $4x–$5x.
    expect(priceRequests('ts_enterprise', 1428, 0).microUsd).toBe(49_980_000);
    expect(microToCents(priceRequests('ts_enterprise', 1428, 0).microUsd)).toBe(4998);
    expect(formatUsd(priceRequests('ts_enterprise', 1428, 0).microUsd)).toBe('$49.98');
  });

  it('price book free allowance: 68 requests', () => {
    // The UI-SPEC's illustration — 68 Enterprise requests — priced at three points in the
    // month. All three, because a test that only proves "not $2.40" passes on a broken
    // calculation too.
    expect(priceRequests('ts_enterprise', 68, 1000)).toEqual({ billable: 0, microUsd: 0 });
    expect(priceRequests('ts_enterprise', 68, 0)).toEqual({ billable: 68, microUsd: 2_380_000 });
    expect(priceRequests('ts_enterprise', 68, 40)).toEqual({ billable: 28, microUsd: 980_000 });
  });

  it('price book atmosphere: the ledger price follows the mask', () => {
    // M11 half 2. The price is derived from the mask, never from a per-call constant —
    // a constant and the invoice diverge silently.
    expect(priceRequests(fieldMaskTier(PLACES_TEXT_SEARCH_FIELD_MASK), 1000, 0).microUsd).toBe(
      35_000_000,
    );
    expect(
      priceRequests(fieldMaskTier([...PLACES_TEXT_SEARCH_FIELD_MASK, 'places.reviews']), 1000, 0)
        .microUsd,
    ).toBe(40_000_000);
  });

  it('price book: freeRemaining for an unlimited SKU is infinite', () => {
    // Text Search Essentials (IDs-Only) is free without a cap: freePerMonth is null, and
    // null must mean unlimited rather than zero.
    expect(freeRemaining('ts_essentials', 0)).toBe(Number.POSITIVE_INFINITY);
    expect(freeRemaining('ts_essentials', 10_000_000)).toBe(Number.POSITIVE_INFINITY);
    expect(priceRequests('ts_essentials', 5000, freeRemaining('ts_essentials', 0))).toEqual({
      billable: 0,
      microUsd: 0,
    });

    // And a capped SKU really does count down.
    expect(freeRemaining('ts_enterprise', 400)).toBe(600);
    expect(freeRemaining('ts_enterprise', 4000)).toBe(0);
  });
});
