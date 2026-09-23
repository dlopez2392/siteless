/**
 * D-09 / DEDUP-01: THE pair scorer. The weights, the two thresholds and the structural rules
 * live in this one committed module, pinned by `tests/unit/fixtures/merge-pairs.json` through
 * `tests/unit/score.test.ts`. Re-tuning is a constant edit here that a red test confronts —
 * never a silent drift. The test asserts EXACT integers, never ranges, for that reason.
 *
 * 🔴 PURE. No server-side import guard, no database import, no clock, no I/O anywhere in this module's
 * graph. The caller (the blocker in 03-10, the merge pass in 03-11) reads the two records and
 * the database-computed `similarity()`, and hands them in. A unit test drives this with JSON.
 *
 * 🔴 THE GUARANTEE IS STRUCTURAL, NOT ARITHMETIC. "≥ 95 requires two independent signals plus
 * the geo gate" is enforced by separate `Math.min(s, 94)` statements, each individually
 * deletable and each pinned by exactly one named test (mutations M13, M14, M15). The weight
 * table happens to agree — the best single-signal pair reaches 75 (name-only), 85
 * (phone-only) or 70 (address-only) — but that is the braces; the caps are the belt, and the
 * belt is what the tests pin.
 *
 * 🔴 R3 cannot fire on a Comptroller↔Overture pair at all, because `jrea-zgmq` carries no
 * phone column. It exists for Overture↔Overture pairs and for the Places-derived phones
 * Phase 4 adds. Nobody should go hunting for a Comptroller phone match: it cannot exist.
 *
 * 🔴 RULE ORDER — every LIFT runs before every CAP. R3 raises a score to 95 and R4 raises it
 * to 80; R2, R5 and R6 cap it at 94. The caps commute with one another but not with the
 * lifts, so a cap placed ahead of a lift is undone by it. That is why R2 (the chain cap) is
 * applied AFTER R3/R4 rather than in its numeric position: in numeric order a chain-flagged
 * pair sharing a phone and a ZIP would be capped to 94 by R2 and then lifted straight back
 * to 95 by R3 — auto-merging a chain, which D-11 forbids outright. The labels R1–R6 are kept
 * so the research, the plan and the mutation table still name the same clause.
 *
 * 🔴 T-3-11: `features` carries integers, `nameSim` and `distanceM` only. `nameNorm` is never
 * copied into it — `merge_candidates.features` is rendered in the review queue's chip band,
 * and the normalized name renders nowhere, ever (D-12).
 */

export type LocationMatchType = 'overture' | 'census_exact' | 'census_non_exact';

export type Side = {
  id: string;
  source: 'tx_comptroller' | 'overture';
  nameNorm: string | null;
  phoneE164: string | null;
  phoneBlockable: boolean;
  streetNum: string | null;
  streetNorm: string | null;
  postal: string | null;
  lat: number | null;
  lng: number | null;
  /** 'overture' | 'census_exact' | 'census_non_exact' | null — Non_Exact never promotes. */
  locationMatchType: LocationMatchType | null;
  clusterKey: string | null;
  chainKey: string | null;
};

/** `nameSim` is supplied by the DATABASE (`similarity(a.name_norm, b.name_norm)`), not
 *  recomputed here — pg_trgm's trigram set is not reproducible in TypeScript, and a scorer
 *  that disagreed with the blocker about a key would produce candidates that vanish when
 *  re-scored. The fixture pins it as a literal. */
export type CandidatePair = { a: Side; b: Side; nameSim: number };

export type Band = 'merge' | 'review' | 'ignore' | 'distinct';
export type SignalName = 'name' | 'phone' | 'address' | 'distance';
export type Features = {
  name: number;
  phone: number;
  address: number;
  distance: number;
  cluster: number;
  nameSim: number;
  distanceM: number | null;
  signals: SignalName[];
  rule?: 'phone_locality_name' | 'phone_locality_review' | 'over_25km';
};
export type ScoreResult = { score: number; band: Band; signals: SignalName[]; features: Features };

// ─── The two thresholds (D-09) ──────────────────────────────────────────────────────────────

export const AUTO_MERGE_SCORE = 95;
export const REVIEW_SCORE = 80;
/** The review band's ceiling. Every structural cap below spells this as the literal `94` so
 *  a grep finds each cap statement; this constant exists so a test can pin that the ceiling
 *  is exactly one below the merge threshold. */
export const REVIEW_CEILING = AUTO_MERGE_SCORE - 1;

/** pg_trgm blocking threshold. Measured: 0.45 -> 33,333 pairs, 0.60 -> 14,485.
 *  // TUNED BY THE DESK RUN */
export const BLOCK_SIMILARITY_THRESHOLD = 0.45;
/** D-04 funnel cutoff. Measured distribution: 61.9 % of Overture TX rows are >= 0.9; this
 *  excludes 8.3 %. Rows below it stay in the spine and never enter the lead funnel.
 *  // TUNED BY THE DESK RUN */
export const OVERTURE_CONFIDENCE_CUTOFF = 0.5;

// ─── The weight table (03-RESEARCH § The weight table) ──────────────────────────────────────

/** name: round(45 × clamp((sim − 0.40) / 0.60, 0, 1)). */
export const NAME_MAX = 45;
export const NAME_SIM_FLOOR = 0.4;
export const NAME_SIM_SPAN = 0.6;
/** The name counts as an independent signal at this similarity and above. */
export const NAME_SIGNAL_SIM = 0.85;

/** Both phones present, equal, and BOTH blockable (never toll-free, never 555). */
export const PHONE_POINTS = 30;

export const ADDRESS_FULL = 30; // street_num + street_norm + postal all equal — a signal
export const ADDRESS_NUM_POSTAL = 15; // street_num + postal
export const ADDRESS_POSTAL_ONLY = 5; // postal only

/** Distance tiers, in metres. Only the first tier (≤ 100 m) is a signal. */
export const DISTANCE_SIGNAL_POINTS = 15;
export const DISTANCE_TIERS: ReadonlyArray<{ maxM: number; points: number }> = [
  { maxM: 100, points: DISTANCE_SIGNAL_POINTS },
  { maxM: 500, points: 10 },
  { maxM: 2_000, points: 4 },
];

export const CLUSTER_SAME = 5;
export const CLUSTER_UNMAPPED = 0;
export const CLUSTER_DIFFERENT = -10;

/** D-07: an exact phone + same ZIP auto-merges only at or above this name similarity. */
export const PHONE_LOCALITY_NAME_SIM = 0.6;

/** D-09 / D-10: the geo gate — both locations known, promotable, and within this distance. */
export const GEO_GATE_M = 500;

/** 🔴 The SAME earth radius as `app.distance_m()` (03-01's migration), so the database and
 *  this module agree on the metre. Changing one without the other moves every tier edge. */
export const EARTH_RADIUS_M = 6371000.0;

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const radians = (deg: number) => (deg * Math.PI) / 180;

/** Haversine, term for term the body of `app.distance_m()`:
 *  `6371000.0 * 2 * asin(sqrt(sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)))`. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const h =
    Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(h));
}

function locationKnown(s: Side): s is Side & { lat: number; lng: number } {
  return s.lat !== null && s.lng !== null;
}

/** A Census `Non_Exact` match is a location, but not one trusted to promote a pair. */
function locationPromotable(s: Side): boolean {
  return locationKnown(s) && s.locationMatchType !== 'census_non_exact';
}

function present(v: string | null): v is string {
  return v !== null && v !== '';
}

function sameValue(x: string | null, y: string | null): boolean {
  return present(x) && present(y) && x === y;
}

// ─── Features ───────────────────────────────────────────────────────────────────────────────

function nameFeature(nameSim: number): number {
  return Math.round(NAME_MAX * clamp((nameSim - NAME_SIM_FLOOR) / NAME_SIM_SPAN, 0, 1));
}

function phoneFeature(a: Side, b: Side): number {
  return sameValue(a.phoneE164, b.phoneE164) && a.phoneBlockable && b.phoneBlockable
    ? PHONE_POINTS
    : 0;
}

function addressFeature(a: Side, b: Side): number {
  const num = sameValue(a.streetNum, b.streetNum);
  const street = sameValue(a.streetNorm, b.streetNorm);
  const postal = sameValue(a.postal, b.postal);
  if (num && street && postal) return ADDRESS_FULL;
  if (num && postal) return ADDRESS_NUM_POSTAL;
  if (postal) return ADDRESS_POSTAL_ONLY;
  return 0;
}

/** Distance points need BOTH locations promotable: a Census Non_Exact side scores 0 here. */
function distanceFeature(a: Side, b: Side, distanceM: number | null): number {
  if (distanceM === null || !locationPromotable(a) || !locationPromotable(b)) return 0;
  for (const tier of DISTANCE_TIERS) {
    if (distanceM <= tier.maxM) return tier.points;
  }
  return 0;
}

function clusterFeature(a: Side, b: Side): number {
  if (!present(a.clusterKey) || !present(b.clusterKey)) return CLUSTER_UNMAPPED;
  return a.clusterKey === b.clusterKey ? CLUSTER_SAME : CLUSTER_DIFFERENT;
}

type FeatureScores = Pick<Features, 'name' | 'phone' | 'address' | 'distance' | 'nameSim'>;

/** The independent signals, in a fixed order (name, phone, address, distance). The cluster
 *  feature is never a signal. The distance signal is the ≤ 100 m tier, which already requires
 *  both locations promotable. */
export function signalNames(f: FeatureScores): SignalName[] {
  const out: SignalName[] = [];
  if (f.nameSim >= NAME_SIGNAL_SIM) out.push('name');
  if (f.phone === PHONE_POINTS) out.push('phone');
  if (f.address === ADDRESS_FULL) out.push('address');
  if (f.distance === DISTANCE_SIGNAL_POINTS) out.push('distance');
  return out;
}

export function countSignals(f: FeatureScores): number {
  return signalNames(f).length;
}

/** D-09 / D-10: both locations known, both promotable, and within 500 m. A pair with one
 *  location unknown — or one only Non_Exact-geocoded — cannot satisfy it. */
export function geoGate(a: Side, b: Side, distanceM: number | null): boolean {
  return (
    distanceM !== null && distanceM <= GEO_GATE_M && locationPromotable(a) && locationPromotable(b)
  );
}

/** >= 95 merge · 80–94 review · < 80 ignore. `distinct` is only ever produced by R1. */
export function band(s: number): Exclude<Band, 'distinct'> {
  if (s >= AUTO_MERGE_SCORE) return 'merge';
  if (s >= REVIEW_SCORE) return 'review';
  return 'ignore';
}

// ─── The scorer ─────────────────────────────────────────────────────────────────────────────

export function score(pair: CandidatePair): ScoreResult {
  const { a, b, nameSim } = pair;
  const distanceM =
    locationKnown(a) && locationKnown(b) ? distanceMeters(a.lat, a.lng, b.lat, b.lng) : null;

  const f: Features = {
    name: nameFeature(nameSim),
    phone: phoneFeature(a, b),
    address: addressFeature(a, b),
    distance: distanceFeature(a, b, distanceM),
    cluster: clusterFeature(a, b),
    nameSim,
    distanceM,
    signals: [],
  };
  f.signals = signalNames(f);

  // R1 (D-10, M13) — both locations known and more than 25 km apart is `distinct` by
  // construction. Short-circuits: nothing below can revive it. The literal is spelled here,
  // in the clause, so the one grep that finds the rule finds its number too.
  if (distanceM !== null && distanceM > 25_000) {
    return { score: 0, band: 'distinct', signals: f.signals, features: { ...f, rule: 'over_25km' } };
  }

  let s = clamp(f.name + f.phone + f.address + f.distance + f.cluster, 0, 100);
  let signals = f.signals.length;
  const phoneLocality = f.phone === PHONE_POINTS && sameValue(a.postal, b.postal);

  // R3 (D-07) — exact phone + same ZIP + a name above the lower bar: the trusted identifier.
  // The signal COUNT is lifted to two; the named list stays what was actually observed.
  if (phoneLocality && nameSim >= PHONE_LOCALITY_NAME_SIM) {
    signals = Math.max(signals, 2);
    s = Math.max(s, 95);
    f.rule = 'phone_locality_name';
  }

  // R4 (D-07) — exact phone + same ZIP + a dissimilar name: RGV phone reuse. Review, never merge.
  if (phoneLocality && nameSim < PHONE_LOCALITY_NAME_SIM) {
    s = clamp(s, 80, 94);
    f.rule = 'phone_locality_review';
  }

  // R2 (D-11) — a chain flag on either side never auto-merges. Placed after the lifts; see header.
  if (present(a.chainKey) || present(b.chainKey)) s = Math.min(s, 94);

  // R5 (D-09, M14) — fewer than two independent signals can never reach 95.
  if (signals < 2) s = Math.min(s, 94);

  // R6 (D-09 / D-10, M15) — without the geo gate the pair cannot leave the review band.
  if (!geoGate(a, b, distanceM)) s = Math.min(s, 94);

  return { score: s, band: band(s), signals: f.signals, features: f };
}
