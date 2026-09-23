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
 * deletable and each pinned by exactly one named test (mutations M13, M14, M15). Under the
 * committed weights the table also agrees: the best single-signal pair reaches 75 (name
 * only), 94 (phone only, with name 34 at sim 0.8499) or 79 (address only). That makes R5
 * redundant TODAY. It exists for the re-tune, and the injectable `Weights` below lets a test
 * prove it (see `Weights`). (03-RESEARCH put phone-only at 85; that assumed name ≤ 25, but a
 * sim just under the 0.85 signal bar scores 34.)
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
  /**
   * The suite/unit as the record carries it (`businesses.unit`) — stripped from the address KEY
   * (D-12) and compared here instead (B-WR-01). Optional so the committed pair fixtures, which
   * predate it, read as "unknown", never as a conflict.
   */
  unit?: string | null;
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

/** pg_trgm blocking threshold. Research: 0.45 -> 33,333 pairs, 0.60 -> 14,485. CONFIRMED
 *  UNCHANGED by danlo 2026-09-23 on the 03-20 desk run: the real B3 pass produced 51,664
 *  trigram pairs, and raising this to 0.60 would drop 29,760 of them, none of which scores
 *  >= 80 (without a shared phone, sim < 0.6 tops out at 14 + 30 + 15 + 5 = 64). The review
 *  queue is driven by the phone lift (see PHONE_LIFT_MIN_NAME_SIM), not by this threshold.
 *  // TUNED BY THE DESK RUN */
export const BLOCK_SIMILARITY_THRESHOLD = 0.45;
/** D-04 funnel cutoff. Rows below it stay in the spine and never enter the lead funnel.
 *  Set to 0.3 by danlo 2026-09-23 on the 03-20 desk run (was 0.5). Evidence: 20 rows sampled
 *  per 0.1 band, plus a junk proxy (no street, or a postcode missing or outside 785xx) of
 *  3.4 % at 0.3–0.4 and 3.3 % at 0.4–0.5, against 6.8 % at 0.5–0.6. Junk climbs only below
 *  0.2 (25 %, 58 %). 0.3 excludes 2,680 of 56,944 Texas-side rows (4.7 %). The old comment's
 *  "8.3 %" was the share below 0.4; 0.5 actually excluded 6,163 (10.8 %).
 *  // TUNED BY THE DESK RUN */
export const OVERTURE_CONFIDENCE_CUTOFF = 0.3;

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
export const DISTANCE_TIERS: ReadonlyArray<{ maxM: number; points: number }> = Object.freeze([
  Object.freeze({ maxM: 100, points: DISTANCE_SIGNAL_POINTS }),
  Object.freeze({ maxM: 500, points: 10 }),
  Object.freeze({ maxM: 2_000, points: 4 }),
]);

export const CLUSTER_SAME = 5;
export const CLUSTER_UNMAPPED = 0;
export const CLUSTER_DIFFERENT = -10;

/** D-07: an exact phone + same ZIP auto-merges only at or above this name similarity. */
export const PHONE_LOCALITY_NAME_SIM = 0.6;

/** R4's floor: an exact phone + same ZIP is LIFTED to the review band (80) only at or above
 *  this name similarity. Below it the pair keeps its raw score. Confirmed by danlo 2026-09-23
 *  on the 03-20 desk run: 7,099 phone pairs were lifted to exactly 80, and 6,247 of them had
 *  name sim < 0.3, which means two listings sharing one number (an owner, a franchise line, a
 *  switchboard), not one business. Expected effect: the review queue drops from ~12.6k to
 *  ~6.3k. A shared phone with a dissimilar name tops out at raw 80, so no such pair can reach
 *  the review band without the lift, and none could ever merge.
 *  // TUNED BY THE DESK RUN */
export const PHONE_LIFT_MIN_NAME_SIM = 0.3;

/**
 * The weight table as one value, so `score()` can take it as a parameter.
 *
 * 🔴 WHY THIS IS INJECTABLE. Under these weights R5 is ARITHMETICALLY REDUNDANT: the
 * strongest single-signal pair sums to exactly 94 (phone 30 + name 34 at sim < 0.85 +
 * address 15 + distance 10 + cluster 5). So deleting R5 changes no outcome, and no test that
 * only calls `score(pair)` can prove R5 is there (mutation M14 would survive green). R5 exists
 * for the re-tune D-09 expects: raise one weight and a single signal can pass 95. The test
 * `one signal cannot reach 95` passes a re-tuned table to show R5 still holds. Production
 * callers pass nothing and get the committed values. The thresholds (95, 80), the 94 caps,
 * the 25 km rule and the geo gate are STRUCTURAL and deliberately not in this table.
 */
export type Weights = {
  nameMax: number;
  nameSimFloor: number;
  nameSimSpan: number;
  nameSignalSim: number;
  phonePoints: number;
  addressFull: number;
  addressNumPostal: number;
  addressPostalOnly: number;
  /** Ascending by `maxM`. Only the first tier is a signal. */
  distanceTiers: ReadonlyArray<{ maxM: number; points: number }>;
  clusterSame: number;
  clusterUnmapped: number;
  clusterDifferent: number;
  phoneLocalityNameSim: number;
  phoneLiftMinNameSim: number;
};

export const DEFAULT_WEIGHTS: Readonly<Weights> = Object.freeze({
  nameMax: NAME_MAX,
  nameSimFloor: NAME_SIM_FLOOR,
  nameSimSpan: NAME_SIM_SPAN,
  nameSignalSim: NAME_SIGNAL_SIM,
  phonePoints: PHONE_POINTS,
  addressFull: ADDRESS_FULL,
  addressNumPostal: ADDRESS_NUM_POSTAL,
  addressPostalOnly: ADDRESS_POSTAL_ONLY,
  distanceTiers: DISTANCE_TIERS,
  clusterSame: CLUSTER_SAME,
  clusterUnmapped: CLUSTER_UNMAPPED,
  clusterDifferent: CLUSTER_DIFFERENT,
  phoneLocalityNameSim: PHONE_LOCALITY_NAME_SIM,
  phoneLiftMinNameSim: PHONE_LIFT_MIN_NAME_SIM,
});

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

// ─── Match facts ────────────────────────────────────────────────────────────────────────────
//
// Signals are read from these FACTS, never from the points a feature scored. Reading them from
// points (`address === 30`) would silently change meaning the day a re-tune makes two tiers
// equal. The points are the weight table's business; whether a signal fired is not.

/** Both locations known, as the raw haversine distance; null when either is unknown. */
function pairDistance(a: Side, b: Side): number | null {
  return locationKnown(a) && locationKnown(b) ? distanceMeters(a.lat, a.lng, b.lat, b.lng) : null;
}

/** Both phones present, equal, and BOTH blockable. A toll-free or 555 number is never one. */
function phoneMatches(a: Side, b: Side): boolean {
  return sameValue(a.phoneE164, b.phoneE164) && a.phoneBlockable && b.phoneBlockable;
}

/** Unit designator words: "STE 5", "SUITE 5", "#5", "UNIT 5" and "NO. 5" all name unit 5. */
const UNIT_DESIGNATORS: ReadonlySet<string> = new Set([
  'STE',
  'SUITE',
  'UNIT',
  'APT',
  'APARTMENT',
  'NO',
  'NUM',
  'NUMBER',
  'RM',
  'ROOM',
  'SPC',
  'SPACE',
]);

/**
 * A unit's identity for COMPARISON only (never stored, never displayed): upper-cased, the
 * designator words and every non-alphanumeric dropped, what remains joined with no separator.
 * "STE 5", "Suite 5" and "#5" are all "5"; "STE 100-A" and "Suite 100A" are "100A"; "BLDG A
 * STE 5" and "BLDG B STE 5" are "BLDGA5" and "BLDGB5". Null when nothing identifying is left.
 */
export function unitIdentity(unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined) return null;
  const tokens = unit
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !UNIT_DESIGNATORS.has(t));
  const id = tokens.join('');
  return id === '' ? null : id;
}

/**
 * B-WR-01 (review 03): BOTH sides carry a unit and they differ — two tenants of one building.
 * A unit on one side only is not a conflict (one source simply omits it).
 */
function unitsConflict(a: Side, b: Side): boolean {
  const ua = unitIdentity(a.unit);
  const ub = unitIdentity(b.unit);
  return ua !== null && ub !== null && ua !== ub;
}

function addressFull(a: Side, b: Side): boolean {
  return (
    sameValue(a.streetNum, b.streetNum) &&
    sameValue(a.streetNorm, b.streetNorm) &&
    sameValue(a.postal, b.postal) &&
    // 🔴 B-WR-01: the unit is stripped from the key, so it is compared HERE — two suites at one
    // street number are number + postal (15), never a full match and never the address signal.
    !unitsConflict(a, b)
  );
}

/** Distance tiers need BOTH locations promotable: a Census Non_Exact side earns nothing here. */
function promotableDistance(a: Side, b: Side, distanceM: number | null): number | null {
  return distanceM !== null && locationPromotable(a) && locationPromotable(b) ? distanceM : null;
}

// ─── Features ───────────────────────────────────────────────────────────────────────────────

function nameFeature(nameSim: number, w: Weights): number {
  return Math.round(w.nameMax * clamp((nameSim - w.nameSimFloor) / w.nameSimSpan, 0, 1));
}

function addressFeature(a: Side, b: Side, w: Weights): number {
  if (addressFull(a, b)) return w.addressFull;
  const postal = sameValue(a.postal, b.postal);
  if (sameValue(a.streetNum, b.streetNum) && postal) return w.addressNumPostal;
  if (postal) return w.addressPostalOnly;
  return 0;
}

function distanceFeature(promotableM: number | null, w: Weights): number {
  if (promotableM === null) return 0;
  for (const tier of w.distanceTiers) {
    if (promotableM <= tier.maxM) return tier.points;
  }
  return 0;
}

function clusterFeature(a: Side, b: Side, w: Weights): number {
  if (!present(a.clusterKey) || !present(b.clusterKey)) return w.clusterUnmapped;
  return a.clusterKey === b.clusterKey ? w.clusterSame : w.clusterDifferent;
}

/** The independent signals observed on a pair, in a fixed order (name, phone, address,
 *  distance). The cluster feature is never a signal. The distance signal is the first tier
 *  (≤ 100 m) between two promotable locations. */
export function signalNames(pair: CandidatePair, w: Weights = DEFAULT_WEIGHTS): SignalName[] {
  const { a, b, nameSim } = pair;
  const promotableM = promotableDistance(a, b, pairDistance(a, b));
  const firstTier = w.distanceTiers[0];
  const out: SignalName[] = [];
  if (nameSim >= w.nameSignalSim) out.push('name');
  if (phoneMatches(a, b)) out.push('phone');
  if (addressFull(a, b)) out.push('address');
  if (promotableM !== null && firstTier !== undefined && promotableM <= firstTier.maxM) {
    out.push('distance');
  }
  return out;
}

/** The OBSERVED signal count. R3 may lift the count `score()` uses; this never does. */
export function countSignals(pair: CandidatePair, w: Weights = DEFAULT_WEIGHTS): number {
  return signalNames(pair, w).length;
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

export function score(pair: CandidatePair, w: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const { a, b, nameSim } = pair;
  const distanceM = pairDistance(a, b);
  const phoneMatch = phoneMatches(a, b);

  const f: Features = {
    name: nameFeature(nameSim, w),
    phone: phoneMatch ? w.phonePoints : 0,
    address: addressFeature(a, b, w),
    distance: distanceFeature(promotableDistance(a, b, distanceM), w),
    cluster: clusterFeature(a, b, w),
    nameSim,
    distanceM,
    signals: signalNames(pair, w),
  };

  // R1 (D-10, M13) — both locations known and more than 25 km apart is `distinct` by
  // construction. Short-circuits: nothing below can revive it. The literal is spelled here,
  // in the clause, so the one grep that finds the rule finds its number too.
  if (distanceM !== null && distanceM > 25_000) {
    return {
      score: 0,
      band: 'distinct',
      signals: f.signals,
      features: { ...f, rule: 'over_25km' },
    };
  }

  let s = clamp(f.name + f.phone + f.address + f.distance + f.cluster, 0, 100);
  let signals = f.signals.length;
  const phoneLocality = phoneMatch && sameValue(a.postal, b.postal);

  // R3 (D-07) — exact phone + same ZIP + a name above the lower bar: the trusted identifier.
  // The signal COUNT is lifted to two; the named list stays what was actually observed.
  if (phoneLocality && nameSim >= w.phoneLocalityNameSim) {
    signals = Math.max(signals, 2);
    s = Math.max(s, 95);
    f.rule = 'phone_locality_name';
  }

  // R4 (D-07) — exact phone + same ZIP + a dissimilar name: RGV phone reuse. Review, never merge.
  // Only at or above the lift floor (03-20): below it the name is so unlike that the shared
  // number is an owner or a switchboard, not an identity, and the pair keeps its raw score.
  if (phoneLocality && nameSim >= w.phoneLiftMinNameSim && nameSim < w.phoneLocalityNameSim) {
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
