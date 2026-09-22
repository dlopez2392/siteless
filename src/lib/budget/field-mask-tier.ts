/**
 * THE FIELD MASK IS THE BUDGET CONTROL (PITFALLS 1, T-2-08, T-2-05).
 *
 * Places API (New) bills at the HIGHEST SKU present in the field mask sent on the
 * X-Goog-FieldMask request header, so the price of a call is a property of the mask and
 * of nothing else. This module is the single place that mapping is expressed, and the
 * repo grep in tests/unit/field-mask-tier.test.ts holds it to that: the header name may
 * be spelled in at most one module under src/, so a second call site cannot grow its own
 * answer the way BIS's five copies of the same date helper did.
 *
 * THIS FUNCTION REFUSES; IT NEVER DEFAULTS. An unknown field throws. Defaulting to
 * Essentials is exactly how a field that costs $40 per 1,000 gets priced at $0 — the
 * ledger and the invoice then disagree, silently, in the direction nobody checks.
 * Same house shape as src/lib/auth/require-org.ts: deny by default.
 *
 * The union type is the compile-time half of the same guard — a wildcard mask cannot be
 * spelled, so it is a type error rather than a runtime surprise on the invoice.
 *
 * Source: developers.google.com/maps/documentation/places/web-service/data-fields
 * (field → SKU tier) and .../usage-and-billing ("billed at the highest SKU applicable
 * to your request"), fetched 2026-09-22.
 */
import { TEXT_SEARCH_TIERS, type TextSearchSku } from '@/lib/budget/price-book';

/** IDs-Only. Free, unlimited. */
const ESSENTIALS = ['places.id', 'places.name', 'nextPageToken'] as const;

const PRO = [
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
] as const;

/** The tier that carries `websiteUri` — the entire reason Siteless pays Google at all. */
const ENTERPRISE = [
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
] as const;

const ATMOSPHERE = ['places.reviews'] as const;

export type PlacesField =
  | (typeof ESSENTIALS)[number]
  | (typeof PRO)[number]
  | (typeof ENTERPRISE)[number]
  | (typeof ATMOSPHERE)[number];

/**
 * Every field this module knows, in tier order. Exported so the unit test can assert its
 * own table covers all of them — a field added here without a named assertion is red
 * rather than quietly untested.
 */
export const ALL_PLACES_FIELDS: readonly PlacesField[] = [
  ...ESSENTIALS,
  ...PRO,
  ...ENTERPRISE,
  ...ATMOSPHERE,
];

/**
 * What Phase 4 sends, and nothing else. Its tier today is `ts_enterprise`.
 *
 * Gate mutation M11 appends `places.reviews` here and expects TWO independent named tests
 * to go red: the tier test, and the ledger-price test in price-book.test.ts.
 */
export const PLACES_TEXT_SEARCH_FIELD_MASK: readonly PlacesField[] = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'nextPageToken',
];

/**
 * A type guard, not a bare `includes`. `Array.prototype.includes` returns a boolean and
 * narrows nothing, so the `satisfies never` below — which is what makes "every field is
 * accounted for" a COMPILE-time property — only works if the checks narrow.
 */
function isIn<T extends string>(list: readonly T[], field: string): field is T {
  return (list as readonly string[]).includes(field);
}

/** Highest wins: billing is at the highest SKU applicable to the request. */
function higher(a: TextSearchSku, b: TextSearchSku): TextSearchSku {
  return TEXT_SEARCH_TIERS.indexOf(a) >= TEXT_SEARCH_TIERS.indexOf(b) ? a : b;
}

export function fieldMaskTier(mask: readonly PlacesField[]): TextSearchSku {
  // An empty mask is not "free", it is a caller that lost its mask. Places rejects it;
  // pricing it as Essentials would hide that behind a $0 ledger row.
  if (mask.length === 0) throw new Error('fieldMaskTier: empty mask');

  let tier: TextSearchSku = 'ts_essentials';
  for (const field of mask) {
    if (isIn(ATMOSPHERE, field)) {
      tier = higher(tier, 'ts_enterprise_atmosphere');
    } else if (isIn(ENTERPRISE, field)) {
      tier = higher(tier, 'ts_enterprise');
    } else if (isIn(PRO, field)) {
      tier = higher(tier, 'ts_pro');
    } else if (!isIn(ESSENTIALS, field)) {
      // REFUSE. `field satisfies never` proves at compile time that the four lists
      // exhaust PlacesField, so this branch is reachable only from an `as never` cast or
      // from untyped data — which is precisely when a runtime refusal is the only guard
      // left. nextPageToken lands in ESSENTIALS above and therefore does NOT raise the
      // tier; it is the one field a reviewer assumes floats free, and it really does.
      throw new Error(`fieldMaskTier: unknown field ${JSON.stringify(field satisfies never)}`);
    }
  }
  return tier;
}
