import type { HostClass } from '@/lib/places/host-class';
import {
  HOST_CLASS_SENTENCE,
  HOST_CLASS_SHORT_LABEL,
  PLACES_CHIP,
  REVIEW_CHIP,
  REVIEW_CHIP_APART,
  REVIEW_CHIP_NAME,
  RUN_WEBSITE_ROW,
} from './copy';
import { formatDistance } from './review-format';

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
 * The chips for one tentative Google listing, from `place_attachments.features` — the matcher's
 * `PlaceFeatures` (`src/lib/places/match.ts`): the resolver's numeric vector plus `city`, `sab`,
 * `listingPhone` and `listingLocation` as 0|1.
 *
 * `features` arrives as `unknown` stored jsonb, so every field is read defensively: a malformed
 * value drops its chip and the function never throws. A fact with no chip wording in the spec (a
 * `city: 0` non-match, two different phones) renders no chip rather than an invented sentence.
 *
 * There is no `zip` chip for a listing: the resolver's own "same ZIP" chip compares two stored
 * records' postcodes, and the listing's address is never stored. The key stays in the union so
 * the band shares one key space with `ReviewChip`.
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

  // Name: the database's trigram similarity, two decimals.
  const nameSim = num(f.nameSim);
  if (nameSim !== null) {
    const namePoints = num(f.name) ?? 0;
    chips.push({
      key: 'name',
      label: REVIEW_CHIP_NAME(nameSim.toFixed(2)),
      agrees: namePoints > 0,
    });
  }

  // Distance: metres apart when the listing has a pin; otherwise the listing-specific absence.
  // One fact, one chip — the inherited "no location on one side" never doubles it.
  const distanceM = num(f.distanceM);
  if (distanceM !== null) {
    const distancePoints = num(f.distance) ?? 0;
    chips.push({
      key: 'distance',
      label: REVIEW_CHIP_APART(formatDistance(distanceM)),
      agrees: distancePoints > 0,
    });
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
