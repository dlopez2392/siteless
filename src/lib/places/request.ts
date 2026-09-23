/**
 * PLACE-01 / PLACE-05 / Pitfalls 1 and 8. The ONE place a Places request is shaped.
 *
 * Categorical query only: `includedType` + `strictTypeFiltering`, textQuery = the type with
 * '_' → ' ' (Claude's Discretion, research A7). Returns body + mask; the HEADERS are spelled
 * only in client.ts.
 *
 * 🔴 THE INVARIANT PARAMETERS ARE MODULE CONSTANTS, NOT PARAMETERS. The service-area flag,
 * strict type filtering, the page size, the region and the language cannot be omitted or
 * varied by a call site, because no call site ever supplies them. PLACE-05 in particular holds
 * by construction: every body this module returns carries `includePureServiceAreaBusinesses:
 * true` (gate mutation M26), and the replay handler answers 501 to any request without it.
 *
 * 🔴 PAGES 2 AND 3 ARE PAGE 1'S BODY PLUS A TOKEN, NEVER A REBUILT BODY (M49). Google: "All
 * parameters other than maxResultCount, pageSize, and pageToken must be the same as the
 * previous request. Otherwise, the API returns an INVALID_ARGUMENT error." `buildNextPage`
 * therefore takes the first request itself, not the inputs that made it.
 *
 * Pure: no `server-only`, no I/O, no clock. Built requests are frozen.
 */
import {
  fieldMaskTier,
  PLACES_IDS_ONLY_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  type PlacesField,
} from '@/lib/budget/field-mask-tier';
import type { TextSearchSku } from '@/lib/budget/price-book';
import { isTableAType } from '@/lib/places/place-types';
import type { Rect } from '@/lib/places/tiling';

const INCLUDE_PURE_SERVICE_AREA_BUSINESSES = true;
const STRICT_TYPE_FILTERING = true;
const PAGE_SIZE = 20;
const REGION_CODE = 'US';
const LANGUAGE_CODE = 'en';

type LatLng = { latitude: number; longitude: number };

export type SearchTextBody = {
  textQuery: string;
  includedType: string;
  strictTypeFiltering: true;
  locationRestriction: { rectangle: { low: LatLng; high: LatLng } };
  includePureServiceAreaBusinesses: true;
  pageSize: 20;
  regionCode: 'US';
  languageCode: 'en';
  pageToken?: string;
};

export type PlacesRequest = {
  readonly body: Readonly<SearchTextBody>;
  readonly mask: readonly PlacesField[];
  readonly sku: TextSearchSku;
};

/** What a sweep is allowed to ask for: the Enterprise mask, or the free ids-only change check. */
export type PlacesMaskMode = 'enterprise' | 'ids_only';

function maskFor(mode: PlacesMaskMode): readonly PlacesField[] {
  return mode === 'enterprise' ? PLACES_TEXT_SEARCH_FIELD_MASK : PLACES_IDS_ONLY_FIELD_MASK;
}

/**
 * A rectangle Google would read the way we mean it. An INVERTED longitude range is not an
 * error to Google — it means "crosses the antimeridian", i.e. most of the planet — so a
 * swapped rectangle would be a valid, billed, wrong search. Refused here instead.
 */
function assertRect(r: Rect): void {
  const finite = [r.south, r.west, r.north, r.east].every((n) => Number.isFinite(n));
  if (!finite || r.south >= r.north || r.west >= r.east) {
    throw new Error('buildFirstPage: the rectangle is not south < north and west < east');
  }
}

export function buildFirstPage(a: {
  placesType: string;
  rect: Rect;
  mode: PlacesMaskMode;
}): PlacesRequest {
  // Table B types (e.g. general_contractor) are response-only; Google rejects them in a
  // request. Our own planner produced the type, so this names it — it is not response text.
  if (!isTableAType(a.placesType)) {
    throw new Error(
      `buildFirstPage: ${JSON.stringify(a.placesType)} is not a Table A type (not accepted as includedType)`,
    );
  }
  assertRect(a.rect);

  const mask = Object.freeze([...maskFor(a.mode)]);
  const body: SearchTextBody = {
    textQuery: a.placesType.replaceAll('_', ' '),
    includedType: a.placesType,
    strictTypeFiltering: STRICT_TYPE_FILTERING,
    locationRestriction: {
      rectangle: {
        low: { latitude: a.rect.south, longitude: a.rect.west },
        high: { latitude: a.rect.north, longitude: a.rect.east },
      },
    },
    includePureServiceAreaBusinesses: INCLUDE_PURE_SERVICE_AREA_BUSINESSES,
    pageSize: PAGE_SIZE,
    regionCode: REGION_CODE,
    languageCode: LANGUAGE_CODE,
  };
  return Object.freeze({ body: Object.freeze(body), mask, sku: fieldMaskTier(mask) });
}

/** The next page: `first`'s body, mask and sku, with only the token changed. */
export function buildNextPage(first: PlacesRequest, pageToken: string): PlacesRequest {
  if (pageToken.length === 0) throw new Error('buildNextPage: empty page token');
  return Object.freeze({ ...first, body: Object.freeze({ ...first.body, pageToken }) });
}
