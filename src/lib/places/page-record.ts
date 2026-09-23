/**
 * Phase 4 plan 15. THE step→writer contract: what one Places page leaves behind, in the exact
 * jsonb shape `app.record_places_page(p_search, p_record)` reads (drizzle/0029).
 *
 * 🔴 T-4-05 / T-3-11 / M36. Everything this module emits reaches the database, and the only
 * Google-derived values allowed there are the place id, two coordinates (30-day TTL, D-10/D-12),
 * the website boolean, its host class (D-09 — the URL was discarded at call time) and the
 * service-area flag. Match `features` are the matcher's NUMBERS: every key is allow-listed and
 * every value type-checked, and anything else THROWS naming the key. A silent drop would leave
 * `pa_features_numeric` (the table CHECK) as the only wall and make a regression here invisible;
 * a throw fails the step loudly, before any write.
 *
 * Every object is REBUILT key by key rather than spread, so a field added upstream (a matcher
 * that starts carrying `displayName`, say) can never ride along into the record unnoticed.
 *
 * PURE: no server import, no I/O. The DB tests build every record through `toPageRecord`
 * (producer→consumer contract), never through hand-typed JSON.
 */
import { HOST_CLASSES, type HostClass } from '@/lib/places/host-class';
import type { MatchDecision } from '@/lib/places/match';

export const FEATURE_KEYS = [
  'name',
  'phone',
  'address',
  'distance',
  'cluster',
  'nameSim',
  'distanceM',
  'signals',
  'rule',
  'city',
  'sab',
  'listingPhone',
  'listingLocation',
] as const;

export type PageRecordPlace = {
  placeId: string;
  outOfArea: boolean;
  pureSab: boolean;
  hadWebsiteUri: boolean;
  hostClass: HostClass;
  lat: number | null;
  lng: number | null;
  matches: MatchDecision['matches'];
};

export type PageRecord = {
  page: 1 | 2 | 3;
  sku: 'ts_enterprise' | 'ts_essentials';
  resultsSoFar: number;
  places: PageRecordPlace[];
};

export type PageRecordItem = {
  decision: MatchDecision;
  pureSab: boolean;
  hadWebsiteUri: boolean;
  hostClass: HostClass;
  lat: number | null;
  lng: number | null;
};

type Match = MatchDecision['matches'][number];
type FeatureKey = (typeof FEATURE_KEYS)[number];

const SCORE_KEYS = new Set<string>(['name', 'phone', 'address', 'distance', 'cluster', 'nameSim']);
const FLAG_KEYS = new Set<string>(['city', 'sab', 'listingPhone', 'listingLocation']);
const SIGNALS = new Set<string>(['name', 'phone', 'address', 'distance']);
const RULES = new Set<string>([
  'phone_locality_name',
  'phone_locality_review',
  'over_25km',
  'sab_phone_city',
]);
const ALLOWED = new Set<string>(FEATURE_KEYS);

function refuse(key: string): never {
  throw new Error(`toPageRecord: feature ${key} is not a permitted value`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** One `features` object, validated and copied. The key is named in every refusal; the
 *  offending VALUE never is — it may be exactly the Places text being refused. */
function checkFeatures(raw: unknown): Match['features'] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('toPageRecord: features must be an object');
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) {
      throw new Error(`toPageRecord: feature ${key} is not allow-listed`);
    }
    const k = key as FeatureKey;
    if (SCORE_KEYS.has(k)) {
      if (!isFiniteNumber(value)) refuse(k);
    } else if (k === 'distanceM') {
      if (value !== null && !isFiniteNumber(value)) refuse(k);
    } else if (k === 'signals') {
      if (!Array.isArray(value) || !value.every((s) => typeof s === 'string' && SIGNALS.has(s))) {
        refuse(k);
      }
    } else if (k === 'rule') {
      if (typeof value !== 'string' || !RULES.has(value)) refuse(k);
    } else if (FLAG_KEYS.has(k)) {
      if (value !== 0 && value !== 1) refuse(k);
    }
    out[k] = Array.isArray(value) ? [...(value as string[])] : value;
  }
  return out as Match['features'];
}

function checkMatch(m: Match): Match {
  if (!Number.isInteger(m.score) || m.score < 0 || m.score > 100) {
    throw new Error('toPageRecord: match score must be an integer 0..100');
  }
  if (m.status !== 'attached' && m.status !== 'tentative') {
    throw new Error('toPageRecord: match status must be attached or tentative');
  }
  if (m.reason !== 'score' && m.reason !== 'tie') {
    throw new Error('toPageRecord: match reason must be score or tie');
  }
  return {
    businessId: m.businessId,
    score: m.score,
    status: m.status,
    reason: m.reason,
    tieBusinessId: m.tieBusinessId ?? null,
    features: checkFeatures(m.features),
  };
}

export function toPageRecord(i: {
  page: 1 | 2 | 3;
  sku: PageRecord['sku'];
  resultsSoFar: number;
  items: PageRecordItem[];
}): PageRecord {
  if (i.page !== 1 && i.page !== 2 && i.page !== 3) {
    throw new Error('toPageRecord: page must be 1, 2 or 3');
  }
  if (i.sku !== 'ts_enterprise' && i.sku !== 'ts_essentials') {
    throw new Error('toPageRecord: sku must be ts_enterprise or ts_essentials');
  }
  if (!Number.isInteger(i.resultsSoFar) || i.resultsSoFar < 0) {
    throw new Error('toPageRecord: resultsSoFar must be a non-negative integer');
  }

  const places = i.items.map((it): PageRecordPlace => {
    const outOfArea = it.decision.outcome === 'outside';
    if (!(HOST_CLASSES as readonly string[]).includes(it.hostClass)) {
      throw new Error('toPageRecord: hostClass is not a known class');
    }
    // po_host_class_agrees (drizzle/0026): refused here too, before a page half-writes.
    if ((it.hadWebsiteUri === true) !== (it.hostClass !== 'none')) {
      throw new Error('toPageRecord: hadWebsiteUri disagrees with hostClass');
    }
    const located = isFiniteNumber(it.lat) && isFiniteNumber(it.lng);
    return {
      placeId: it.decision.placeId,
      outOfArea,
      pureSab: it.pureSab === true,
      hadWebsiteUri: it.hadWebsiteUri === true,
      hostClass: it.hostClass,
      lat: located ? it.lat : null,
      lng: located ? it.lng : null,
      // An outside listing is never attached (D-06): its matches are not carried at all.
      matches: outOfArea ? [] : it.decision.matches.map(checkMatch),
    };
  });

  return { page: i.page, sku: i.sku, resultsSoFar: i.resultsSoFar, places };
}
