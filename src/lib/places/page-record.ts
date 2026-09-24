/**
 * Phase 4 plan 15. THE step→writer contract: what one Places page leaves behind, in the exact
 * jsonb shape `app.record_places_page(p_search, p_record)` reads (drizzle/0029).
 *
 * 🔴 T-4-05 / T-3-11 / M36. Everything this module emits reaches the database, and the only
 * Google-derived values allowed there are the place id, two coordinates (30-day TTL, D-10/D-12),
 * the website boolean, its host class (D-09 — the URL was discarded at call time) and the
 * service-area flag. Match `features` are the matcher's INTEGER POINTS, its fixed enums and its
 * 0|1 flags: every key is allow-listed and every value type-checked, and anything else THROWS
 * naming the key. A silent drop would leave `pa_features_numeric` (the table CHECK) as the only
 * wall and make a regression here invisible; a throw fails the step loudly, before any write.
 *
 * 🔴 MEMORY-ONLY (2026-09-23, before D-01): `nameSim` (trigram similarity to Google's name) and
 * `distanceM` (metres to Google's location) are the scorer's CONTINUOUS inputs, computed straight
 * from Google content. They score the match in memory and are DROPPED here — the one deliberate
 * drop in this module, of exactly two named keys. What persists is the coarse integer points the
 * scorer derived from them (`name` 0–45, `distance` 0/4/10/15) and the `signals` enum. The DB
 * CHECK (app.places_features_ok, 0029) still ADMITS both keys — a numbers-only wall, unchanged
 * to avoid a migration — so this function is the wall that keeps them out, pinned by
 * tests/unit/page-record.test.ts "persisted place features carry no nameSim or distanceM".
 *
 * Every object is REBUILT key by key rather than spread, so a field added upstream (a matcher
 * that starts carrying `displayName`, say) can never ride along into the record unnoticed.
 *
 * PURE: no server import, no I/O. The DB tests build every record through `toPageRecord`
 * (producer→consumer contract), never through hand-typed JSON.
 */
import { HOST_CLASSES, type HostClass } from '@/lib/places/host-class';
import type { MatchDecision } from '@/lib/places/match';

/** The feature keys that PERSIST (11). A subset of what app.places_features_ok admits (13). */
export const FEATURE_KEYS = [
  'name',
  'phone',
  'address',
  'distance',
  'cluster',
  'signals',
  'rule',
  'city',
  'sab',
  'listingPhone',
  'listingLocation',
] as const;

/** The scorer's continuous, Google-derived inputs: read in memory, never persisted. */
export const MEMORY_ONLY_FEATURE_KEYS = ['nameSim', 'distanceM'] as const;

type Match = MatchDecision['matches'][number];
type FeatureKey = (typeof FEATURE_KEYS)[number];

/** What `place_attachments.features` holds. */
export type PersistedPlaceFeatures = Omit<
  Match['features'],
  (typeof MEMORY_ONLY_FEATURE_KEYS)[number]
>;

export type PersistedMatch = Omit<Match, 'features'> & { features: PersistedPlaceFeatures };

export type PageRecordPlace = {
  placeId: string;
  outOfArea: boolean;
  pureSab: boolean;
  hadWebsiteUri: boolean;
  hostClass: HostClass;
  lat: number | null;
  lng: number | null;
  matches: PersistedMatch[];
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

/** Integer points — a continuous value under one of these keys is refused, not rounded. */
const SCORE_KEYS = new Set<string>(['name', 'phone', 'address', 'distance', 'cluster']);
const MEMORY_ONLY = new Set<string>(MEMORY_ONLY_FEATURE_KEYS);
const FLAG_KEYS = new Set<string>(['city', 'sab', 'listingPhone', 'listingLocation']);
const SIGNALS = new Set<string>(['name', 'phone', 'address', 'distance']);
const RULES = new Set<string>([
  'phone_locality_name',
  'phone_locality_review',
  'over_25km',
  'sab_phone_city',
]);
const ALLOWED = new Set<string>(FEATURE_KEYS);

/**
 * Every refusal below. A named class so the step wrapper (src/workflows/places-sweep/
 * step-errors.ts) can tell it apart: a record this module refuses is refused the same way on a
 * retry — after the page was already bought — so it is FATAL, never retried (B-CR-02).
 */
export class PageRecordRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageRecordRefusal';
  }
}

function refuse(key: string): never {
  throw new PageRecordRefusal(`toPageRecord: feature ${key} is not a permitted value`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** One `features` object, validated and copied. The key is named in every refusal; the
 *  offending VALUE never is — it may be exactly the Places text being refused. */
function checkFeatures(raw: unknown): PersistedPlaceFeatures {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PageRecordRefusal('toPageRecord: features must be an object');
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Scored with in memory; never written (see the header).
    if (MEMORY_ONLY.has(key)) continue;
    if (!ALLOWED.has(key)) {
      throw new PageRecordRefusal(`toPageRecord: feature ${key} is not allow-listed`);
    }
    const k = key as FeatureKey;
    if (SCORE_KEYS.has(k)) {
      if (!isFiniteNumber(value) || !Number.isInteger(value)) refuse(k);
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
  return out as PersistedPlaceFeatures;
}

function checkMatch(m: Match): PersistedMatch {
  if (!Number.isInteger(m.score) || m.score < 0 || m.score > 100) {
    throw new PageRecordRefusal('toPageRecord: match score must be an integer 0..100');
  }
  if (m.status !== 'attached' && m.status !== 'tentative') {
    throw new PageRecordRefusal('toPageRecord: match status must be attached or tentative');
  }
  if (m.reason !== 'score' && m.reason !== 'tie') {
    throw new PageRecordRefusal('toPageRecord: match reason must be score or tie');
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
    throw new PageRecordRefusal('toPageRecord: page must be 1, 2 or 3');
  }
  if (i.sku !== 'ts_enterprise' && i.sku !== 'ts_essentials') {
    throw new PageRecordRefusal('toPageRecord: sku must be ts_enterprise or ts_essentials');
  }
  if (!Number.isInteger(i.resultsSoFar) || i.resultsSoFar < 0) {
    throw new PageRecordRefusal('toPageRecord: resultsSoFar must be a non-negative integer');
  }

  const places = i.items.map((it): PageRecordPlace => {
    const outOfArea = it.decision.outcome === 'outside';
    if (!(HOST_CLASSES as readonly string[]).includes(it.hostClass)) {
      throw new PageRecordRefusal('toPageRecord: hostClass is not a known class');
    }
    // po_host_class_agrees (drizzle/0026): refused here too, before a page half-writes.
    if ((it.hadWebsiteUri === true) !== (it.hostClass !== 'none')) {
      throw new PageRecordRefusal('toPageRecord: hadWebsiteUri disagrees with hostClass');
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
