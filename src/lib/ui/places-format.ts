import type { HostClass } from '@/lib/places/host-class';
import {
  ADDRESS_FULL,
  ADDRESS_NUM_POSTAL,
  ADDRESS_POSTAL_ONLY,
  DISTANCE_TIERS,
} from '@/lib/resolve/score';
import {
  HOST_CLASS_SENTENCE,
  HOST_CLASS_SHORT_LABEL,
  PLACES_CHIP,
  PLACES_CHIP_WITHIN,
  REVIEW_CHIP,
  RUN_TILE_UNIT_COUNTY,
  RUN_TILE_UNIT_RADIUS,
  RUN_TILE_UNIT_UNKNOWN,
  RUN_WEBSITE_ROW,
} from './copy';

/**
 * Places-derived values, one formatter each (04-UI-SPEC § Screens 1, 3 and 5; Executor Rule 5):
 * the website signal sentence, the host-class label, the Google-listing chip band and the
 * Google Maps link.
 *
 * Every file that imports this module must also import GoogleMapsTag (Rule 28; enforced by
 * 04-28's repo walk). Everything formatted here is a Places-derived value, and Google's policy
 * requires the "Google Maps" attribution in the same container as any of them.
 *
 * 🔴 NO CLIENT DIRECTIVE, NO SERVER-ONLY IMPORT, NO I/O, NO `Intl`. Pure functions, importable
 * from a server component and a client island alike. (A client module's exports would be
 * client REFERENCES inside the server components that render these — `undefined` at runtime
 * with every gate green. `tests/unit/ui-maps.test.ts` walks this directory for the token, so
 * this comment does not spell it.)
 *
 * 🔴 RULE 30 / T-4-05: NOTHING HERE ACCEPTS GOOGLE TEXT. The inputs are an enum (the host
 * class), numbers (the matcher's feature vector) and the SPINE's own fields (the place id,
 * which is the one Google value kept indefinitely, and our name and city). Google's name,
 * address, phone and `websiteUri` are never stored, so there is no parameter to pass them in.
 */

/* --- Host classes (D-09: words, never colours) ------------------------------------------- */

/**
 * The run report's fixed row order for the five non-`none` classes, indented under "Listed a
 * website". Fixed, never sorted by count, so a row stays in the same place from run to run.
 */
export const HOST_CLASS_ORDER = [
  'other',
  'social',
  'directory',
  'platform_subdomain',
  'business_site_dead',
] as const satisfies readonly Exclude<HostClass, 'none'>[];

/** Business detail → "Website on Google" → the sentence for this class. */
export function signalSentence(hostClass: HostClass): string {
  return HOST_CLASS_SENTENCE[hostClass];
}

/** The run report's short label. `none` is the "No website listed" row itself. */
export function hostClassLabel(hostClass: HostClass): string {
  return hostClass === 'none' ? RUN_WEBSITE_ROW.none : HOST_CLASS_SHORT_LABEL[hostClass];
}

/* --- The Google-listing chip band (§ Screen 3 → "How it compared") ----------------------- */

export type PlacesChip = {
  /** Stable React key, one per fact. Never rendered. */
  key:
    | 'phone'
    | 'name'
    | 'distance'
    | 'zip'
    | 'cluster'
    | 'city'
    | 'sab'
    | 'no_listing_phone'
    | 'no_listing_location';
  label: string;
  /** True for an agreement chip (`secondary`), false for disagreement/absence (`outline`). */
  agrees: boolean;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A 0|1 flag the matcher wrote. Anything that is not exactly the number 0 or 1 is unknown. */
function flag(value: unknown): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

/**
 * The chips for one tentative Google listing, from `place_attachments.features` — what
 * `toPageRecord` persists of the matcher's `PlaceFeatures` (`src/lib/places/match.ts`): the
 * resolver's integer points, `signals` and `rule`, plus `city`, `sab`, `listingPhone` and
 * `listingLocation` as 0|1. Never `nameSim` or `distanceM` (memory-only since 2026-09-23).
 *
 * `features` arrives as `unknown` stored jsonb, so every field is read defensively: a malformed
 * value drops its chip and the function never throws. A fact with no chip wording in the spec (a
 * `city: 0` non-match, two different phones) renders no chip rather than an invented sentence.
 *
 * The `zip` chip (C-WR-01) reads the persisted ADDRESS POINTS, never an address: the matcher
 * compared Google's address in memory and `toPageRecord` stored only the integer it scored.
 */
export function placesChips(features: unknown): PlacesChip[] {
  if (typeof features !== 'object' || features === null || Array.isArray(features)) return [];
  const f = features as Record<string, unknown>;
  const chips: PlacesChip[] = [];

  // Phone: an exact, blockable match scored its points; a listing with no phone says so.
  const phonePoints = num(f.phone);
  if (phonePoints !== null && phonePoints > 0) {
    chips.push({ key: 'phone', label: REVIEW_CHIP.phoneExact, agrees: true });
  }
  if (flag(f.listingPhone) === 0) {
    chips.push({ key: 'no_listing_phone', label: PLACES_CHIP.noListingPhone, agrees: false });
  }

  // Name: from the integer points and the `name` signal. The similarity figure itself is
  // memory-only since 2026-09-23 (src/lib/places/page-record.ts), so the chip names the band:
  // the signal (similarity ≥ 0.85), some points (above the 0.40 floor), or none.
  const namePoints = num(f.name);
  if (namePoints !== null) {
    const signals = Array.isArray(f.signals) ? (f.signals as unknown[]) : [];
    const label = signals.includes('name')
      ? PLACES_CHIP.nameMatch
      : namePoints > 0
        ? PLACES_CHIP.nameSimilar
        : PLACES_CHIP.nameDifferent;
    chips.push({ key: 'name', label, agrees: namePoints > 0 });
  }

  // Address (C-WR-01): the scorer's integer points, which ARE persisted — the listing's address
  // itself is not. 30 is the full match (and the address signal), 15 number + ZIP, 5 ZIP only;
  // zero, or anything else, is no chip. Nothing Google-authored is read: only the points.
  const addressPoints = num(f.address);
  if (addressPoints !== null && addressPoints >= ADDRESS_FULL) {
    chips.push({ key: 'zip', label: PLACES_CHIP.sameAddress, agrees: true });
  } else if (addressPoints === ADDRESS_NUM_POSTAL) {
    chips.push({ key: 'zip', label: PLACES_CHIP.sameNumberZip, agrees: true });
  } else if (addressPoints === ADDRESS_POSTAL_ONLY) {
    chips.push({ key: 'zip', label: REVIEW_CHIP.sameZip, agrees: true });
  }

  // Distance: the scorer's tier, as "within <tier>" — metres apart are memory-only too. Zero
  // points is either beyond the last tier or a location too coarse to score, and the stored
  // points cannot say which, so it gets no chip; a listing with no pin says so instead.
  // One fact, one chip — the inherited "no location on one side" never doubles it.
  const distancePoints = num(f.distance);
  const tier = DISTANCE_TIERS.find((t) => t.points === distancePoints);
  if (distancePoints !== null && distancePoints > 0 && tier !== undefined) {
    chips.push({ key: 'distance', label: PLACES_CHIP_WITHIN(tier.maxM), agrees: true });
  } else if (flag(f.listingLocation) === 0) {
    chips.push({ key: 'no_listing_location', label: PLACES_CHIP.noListingLocation, agrees: false });
  }

  // City: a service-area listing matched on the queried city (scoreSab).
  if (flag(f.city) === 1) {
    chips.push({ key: 'city', label: PLACES_CHIP.cityMatch, agrees: true });
  }

  // Cluster: +5 same, −10 different, 0 when either side is unmapped (no chip).
  const clusterPoints = num(f.cluster);
  if (clusterPoints !== null && clusterPoints > 0) {
    chips.push({ key: 'cluster', label: REVIEW_CHIP.sameCluster, agrees: true });
  } else if (clusterPoints !== null && clusterPoints < 0) {
    chips.push({ key: 'cluster', label: REVIEW_CHIP.differentCluster, agrees: false });
  }

  // Service-area business: a fact about the listing, not an agreement.
  if (flag(f.sab) === 1) {
    chips.push({ key: 'sab', label: PLACES_CHIP.sab, agrees: false });
  }

  return chips;
}

/* --- Tile rows (C-WR-04: a place name and a readable type, never a key) ------------------ */

/**
 * OUR configured Places type key as words: `roofing_contractor` → "roofing contractor". The key
 * is the one we configured per cluster (src/lib/places/place-types.ts), not a Google-returned
 * type, so this is formatting our own vocabulary.
 */
export function placesTypeLabel(placesType: string): string {
  return placesType.replaceAll('_', ' ').trim();
}

/**
 * The place a stored tile key names, and its quad path, from
 * `{unitKind}:{unitId}|{placesType}|{quadPath}` (`tileKeyOf` in src/lib/places/tiling.ts) with
 * the unit id DB-safe (`/` for the cell separator):
 *   city   `48215/McAllen`  → "McAllen"
 *   county `48215`          → "Hidalgo County"   (from `countyNames`, fips → name)
 *   radius `48215/10mi`     → "10-mile radius in Hidalgo County"
 * A key of any other shape is `RUN_TILE_UNIT_UNKNOWN` — never the key itself (Rule 35).
 */
export function describeTileKey(
  tileKey: string,
  countyNames: ReadonlyMap<string, string>,
): { unitName: string; quadPath: string } {
  const parts = tileKey.split('|');
  const quadPath = parts.length >= 3 ? (parts[parts.length - 1] ?? '') : '';
  const unit = parts.length >= 3 ? (parts[0] ?? '') : '';
  const colon = unit.indexOf(':');
  const kind = colon > 0 ? unit.slice(0, colon) : '';
  const id = colon > 0 ? unit.slice(colon + 1) : '';
  const slash = id.indexOf('/');
  const fips = slash >= 0 ? id.slice(0, slash) : id;
  const rest = slash >= 0 ? id.slice(slash + 1) : '';

  let unitName: string | null = null;
  if (kind === 'city' && rest !== '') unitName = rest;
  else if (kind === 'county' && id !== '') {
    const name = countyNames.get(id);
    unitName = name ? RUN_TILE_UNIT_COUNTY(name) : null;
  } else if (kind === 'radius') {
    const miles = /^(\d+(?:\.\d+)?)mi$/.exec(rest)?.[1];
    unitName = miles ? RUN_TILE_UNIT_RADIUS(miles, countyNames.get(fips) ?? null) : null;
  }
  return { unitName: unitName ?? RUN_TILE_UNIT_UNKNOWN, quadPath };
}

/* --- The link out to Google Maps (Open Question 5; Executor Rule 31) -------------------- */

const MAPS_SEARCH = 'https://www.google.com/maps/search/';

/**
 * Google's Maps URLs API: a link OUT to Google's own map on Google's own surface — never a map
 * in Siteless. Built from the stored `place_id` plus the spine's display name and city (T-4-11:
 * fixed origin, every component `encodeURIComponent`-ed, so no input can add a parameter or a
 * fragment). With no spine city the query is the name alone.
 */
export function mapsUrlFor(placeId: string, name: string, city: string | null): string {
  const query = city ? `${name}, ${city}` : name;
  return (
    `${MAPS_SEARCH}?api=1&query=${encodeURIComponent(query)}` +
    `&query_place_id=${encodeURIComponent(placeId)}`
  );
}
