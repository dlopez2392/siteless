/**
 * D-05 / D-07 / D-08. PURE. Google's name, address and phone exist only inside this call's
 * arguments and are normalized to keys; nothing here returns them. `features` is persisted by
 * 04-15's writer and may hold numbers only (T-3-11).
 *
 * A Places result becomes a `Side` and is scored against each candidate business with Phase 3's
 * `score()`, UNCHANGED: the same weights, the same thresholds, the same structural caps. The
 * thresholds are imported from score.ts and never restated here.
 *
 * 🔴 CHAIN KEYS ARE PASSED AS NULL ON BOTH SIDES (research A4, D-08). R2 exists to stop two
 * chain BRANCHES merging (D-11). Applied to a Places→business attachment it would make every
 * chain listing tentative — a special case D-08 says not to create. Chains follow the same
 * rules as everyone else here.
 *
 * 🔴 SERVICE-AREA LISTINGS (D-07) take a separate scorer, not a null-coalesce. Any
 * `pureServiceAreaBusiness: true` result takes it, even with a `location` (research A8): a service
 * area's pin is not a storefront, so the location is dropped in `toPlaceForMatch`. The only path
 * to the attach threshold is an exact blockable phone + the queried city + the phone-locality
 * name bar; everything else is the located scorer without a location, capped at the review
 * ceiling.
 *
 * 🔴 NO SERVER IMPORT, NO DATABASE. `nameSim` comes from the candidate query's `similarity()`
 * (src/lib/places/candidates.ts), never a TypeScript trigram — the scorer's contract.
 */
import { addressKey, foldDiacritics, nameNorm, phoneE164 } from '@/lib/normalize';
import { isOutOfAreaAddress } from '@/lib/places/area';
import {
  AUTO_MERGE_SCORE,
  PHONE_LOCALITY_NAME_SIM,
  REVIEW_CEILING,
  REVIEW_SCORE,
  score,
  type Features,
  type Side,
} from '@/lib/resolve/score';

/** Structural — the zod PlaceSchema (04-12) satisfies it without an import. */
export type PlacesResultLike = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  pureServiceAreaBusiness?: boolean;
};

/** A Places result reduced to normalized KEYS. The raw display text is not a field. */
export type PlaceForMatch = {
  placeId: string;
  nameNorm: string | null;
  phone: { e164: string | null; blockable: boolean };
  address: {
    streetNum: string | null;
    streetNorm: string | null;
    unit: string | null;
    postal: string | null;
  };
  lat: number | null;
  lng: number | null;
  pureSab: boolean;
  outOfArea: boolean;
  clusterKey: string;
  /** Folded + lower-cased city name for a city unit; null for county and radius units. */
  queriedCity: string | null;
};

/** The feature keys 04-07's `placesChips` reads: city / sab / listingPhone / listingLocation (0|1). */
export type PlaceFeatures = Features & {
  city?: 0 | 1;
  sab?: 0 | 1;
  listingPhone?: 0 | 1;
  listingLocation?: 0 | 1;
};

export type BusinessCandidate = Side & { city: string | null };

export type ScoredCandidate = { businessId: string; score: number; features: PlaceFeatures };

export type MatchDecision = {
  placeId: string;
  outcome: 'attached' | 'tentative' | 'unmatched' | 'outside';
  matches: Array<{
    businessId: string;
    score: number;
    status: 'attached' | 'tentative';
    reason: 'score' | 'tie';
    tieBusinessId: string | null;
    features: PlaceFeatures;
  }>;
};

/** City comparison key: diacritics folded, lower-cased, whitespace collapsed. Never SQL. */
function foldCity(raw: string): string {
  return foldDiacritics(raw).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The ZIP that follows the state code in a US `formattedAddress`. */
const TX_ZIP = /\bTX (\d{5})(?:-\d{4})?\b/;

export function toPlaceForMatch(
  p: PlacesResultLike,
  ctx: { clusterKey: string; queriedCity: string | null },
): PlaceForMatch {
  const formatted = p.formattedAddress?.trim() ?? '';
  const segments = formatted === '' ? [] : formatted.split(',').map((s) => s.trim());
  const street = segments[0] ?? null;
  const zip = TX_ZIP.exec(formatted)?.[1] ?? null;
  const key = addressKey(street, zip);
  const pureSab = p.pureServiceAreaBusiness === true;
  const queried = ctx.queriedCity === null ? null : foldCity(ctx.queriedCity);

  return {
    placeId: p.id,
    nameNorm: nameNorm(p.displayName?.text),
    phone: phoneE164(p.nationalPhoneNumber),
    address: {
      streetNum: key.streetNum,
      streetNorm: key.streetNorm,
      unit: key.unit,
      postal: key.postal,
    },
    // A service area's pin is not a storefront: it never promotes a pair.
    lat: pureSab ? null : (p.location?.latitude ?? null),
    lng: pureSab ? null : (p.location?.longitude ?? null),
    pureSab,
    // B-CR-01: positive — a foreign country tail. `regionCode: 'US'` makes Google omit the
    // country from every US address, so "no `, USA`" is the normal domestic shape.
    outOfArea: isOutOfAreaAddress(formatted),
    clusterKey: ctx.clusterKey,
    queriedCity: queried === '' ? null : queried,
  };
}

export function placeSide(p: PlaceForMatch): Side {
  const located = p.lat !== null && p.lng !== null;
  return {
    id: p.placeId,
    source: 'google_places',
    nameNorm: p.nameNorm,
    phoneE164: p.phone.e164,
    phoneBlockable: p.phone.blockable,
    streetNum: p.address.streetNum,
    streetNorm: p.address.streetNorm,
    unit: p.address.unit,
    postal: p.address.postal,
    lat: p.lat,
    lng: p.lng,
    // A Places pin is a rooftop-grade location, trusted like Overture's.
    locationMatchType: located ? 'overture' : null,
    clusterKey: p.clusterKey,
    chainKey: null,
  };
}

function listingFlags(p: PlaceForMatch): Pick<PlaceFeatures, 'listingPhone' | 'listingLocation'> {
  return { listingPhone: p.phone.e164 ? 1 : 0, listingLocation: p.lat !== null ? 1 : 0 };
}

/** The business as a scorer `Side`, `chainKey` nulled (A4). `score()` never reads `city`. */
function businessSide(b: BusinessCandidate): Side {
  return { ...b, chainKey: null };
}

export function scoreLocated(
  p: PlaceForMatch,
  b: BusinessCandidate,
  nameSim: number,
): ScoredCandidate {
  const r = score({ a: placeSide(p), b: businessSide(b), nameSim });
  return { businessId: b.id, score: r.score, features: { ...r.features, ...listingFlags(p) } };
}

export function scoreSab(p: PlaceForMatch, b: BusinessCandidate, nameSim: number): ScoredCandidate {
  const phoneMatch =
    p.phone.e164 !== null && p.phone.blockable && b.phoneBlockable && p.phone.e164 === b.phoneE164;
  const cityMatch = p.queriedCity !== null && b.city !== null && foldCity(b.city) === p.queriedCity;

  const fallback = scoreLocated({ ...p, lat: null, lng: null }, b, nameSim);
  const features: PlaceFeatures = { ...fallback.features, sab: 1, city: cityMatch ? 1 : 0 };

  if (phoneMatch && cityMatch && nameSim >= PHONE_LOCALITY_NAME_SIM) {
    return {
      businessId: b.id,
      score: AUTO_MERGE_SCORE,
      features: { ...features, rule: 'sab_phone_city' },
    };
  }
  return { businessId: b.id, score: Math.min(fallback.score, REVIEW_CEILING), features };
}

export function decide(p: PlaceForMatch, scored: ScoredCandidate[]): MatchDecision {
  if (p.outOfArea) return { placeId: p.placeId, outcome: 'outside', matches: [] };

  const ranked = [...scored].sort(
    (x, y) =>
      y.score - x.score || (x.businessId < y.businessId ? -1 : x.businessId > y.businessId ? 1 : 0),
  );
  const [first, second] = ranked;

  // D-08: one place_id at the attach threshold against two businesses is a collision. Neither
  // is attached — not even the higher score — and each row names the other.
  if (first && second && second.score >= AUTO_MERGE_SCORE) {
    return {
      placeId: p.placeId,
      outcome: 'tentative',
      matches: [
        {
          businessId: first.businessId,
          score: first.score,
          status: 'tentative',
          reason: 'tie',
          tieBusinessId: second.businessId,
          features: first.features,
        },
        {
          businessId: second.businessId,
          score: second.score,
          status: 'tentative',
          reason: 'tie',
          tieBusinessId: first.businessId,
          features: second.features,
        },
      ],
    };
  }

  if (first && first.score >= AUTO_MERGE_SCORE) {
    return {
      placeId: p.placeId,
      outcome: 'attached',
      matches: [
        {
          businessId: first.businessId,
          score: first.score,
          status: 'attached',
          reason: 'score',
          tieBusinessId: null,
          features: first.features,
        },
      ],
    };
  }

  if (first && first.score >= REVIEW_SCORE) {
    return {
      placeId: p.placeId,
      outcome: 'tentative',
      matches: [
        {
          businessId: first.businessId,
          score: first.score,
          status: 'tentative',
          reason: 'score',
          tieBusinessId: null,
          features: first.features,
        },
      ],
    };
  }

  return { placeId: p.placeId, outcome: 'unmatched', matches: [] };
}
