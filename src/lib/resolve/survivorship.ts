/**
 * D-14 survivorship: which parent source record supplies each surviving field of a merged
 * business, and the provenance id that field cites.
 *
 * 🔴 ONE FUNCTION, TWO CALL SITES, NEVER TWO IMPLEMENTATIONS. `src/lib/resolve/merge.ts` calls
 * `survive()` when it merges (the winner's new fields, over every parent of both clusters)
 * AND when it unmerges (the loser's fields, re-derived from its own parents). If those were
 * two functions they would drift, and an unmerge would restore a loser the merge never saw.
 *
 * 🔴 PURE. No database import, no clock, no I/O, no user input: the review UI decides
 * same/different ONLY, never per-field winners (D-14), so there is deliberately no override
 * argument. The caller reads the parents and hands them in.
 *
 * 🔴 LOSING VALUES ARE NOT DISCARDED. They stay on the parent source records, which are never
 * deleted and never re-pointed (`source_records.business_id` does not move on a merge). That
 * is exactly why an unmerge can reconstruct the loser without a snapshot.
 *
 * 🔴 GOOGLE NEVER SUPPLIES A DURABLE FIELD (T-3-06). The `*_source_id` provenance pairs carry
 * composite FKs to `source_records (id, retention_class)` with a twin GENERATED as 'durable',
 * so citing an ephemeral record — every `google_places` record is ephemeral — is refused with
 * 23503. `survive()` therefore never returns a `sourceId` for a parent whose `sourceKey` is
 * `google_places` (or any key outside the four below): such a parent is dropped before any
 * rule runs. There are none in Phase 3; the rule is stated here so Phase 4 inherits it rather
 * than discovering it as a 23503 in the middle of a merge.
 *
 * The rules, exactly (03-RESEARCH § D-14 survivorship):
 *
 * | Field | Rule | Provenance pair |
 * |---|---|---|
 * | legal_name | Comptroller outlet_name | legal_name_source_id |
 * | display_name | Overture names.primary; Comptroller outlet_name ONLY when no Overture parent | display_name_source_id |
 * | phone_e164 | Overture preferred; otherwise whichever parent has one | phone_source_id |
 * | street / postal / city | Overture; the (Census-geocoded) Comptroller address as fallback | address_source_id |
 * | lat / lng | Overture; then Census Exact; then Census Non_Exact LAST | location_source_id |
 * | closed_at | tx_comptroller_closures ONLY | closed_at_source_id |
 * | basic_category, cluster_key, confidence, operating_status | derived, not sourced | none |
 *
 * DETERMINISM. Parents are put into one canonical order before any rule runs: higher
 * `confidence` first (nulls last), then the lexically smaller `id`. So the same parent set
 * yields the same fields whatever order the database returned it in, and a merge followed by
 * an unmerge followed by the same merge produces byte-identical fields.
 */

export type SurvivorSourceKey =
  | 'tx_comptroller'
  | 'tx_comptroller_closures'
  | 'overture'
  | 'census_geocoder';

/** The four durable Phase 3 source keys. Anything else is dropped (see the header). */
const SURVIVOR_SOURCE_KEYS: ReadonlySet<string> = new Set<SurvivorSourceKey>([
  'tx_comptroller',
  'tx_comptroller_closures',
  'overture',
  'census_geocoder',
]);

export type LocationMatchType = 'overture' | 'census_exact' | 'census_non_exact';

/** One parent source record, as the fields D-14 reads from it. */
export type SourceRecordView = {
  id: string;
  sourceKey: SurvivorSourceKey;
  legalName: string | null;
  displayName: string | null;
  phoneE164: string | null;
  phoneBlockable: boolean;
  street: string | null;
  streetNum: string | null;
  streetNorm: string | null;
  unit: string | null;
  postal: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  locationMatchType: LocationMatchType | null;
  basicCategory: string | null;
  clusterKey: string | null;
  confidence: number | null;
  operatingStatus: string | null;
  /** ISO instant. Read ONLY from a `tx_comptroller_closures` parent. */
  closedAt: string | null;
};

/** A sourced value and the source record it came from. Both null when no parent has it. */
export type Sourced<T> = { value: T | null; sourceId: string | null };

export type SurvivingFields = {
  legalName: Sourced<string>;
  displayName: Sourced<string>;
  phone: { e164: string | null; blockable: boolean; sourceId: string | null };
  address: {
    street: string | null;
    streetNum: string | null;
    streetNorm: string | null;
    unit: string | null;
    postal: string | null;
    city: string | null;
    sourceId: string | null;
  };
  location: {
    lat: number | null;
    lng: number | null;
    matchType: LocationMatchType | null;
    sourceId: string | null;
  };
  closedAt: Sourced<string>;
  /**
   * Derived, not sourced — no provenance pair. A key is PRESENT only when some parent carries
   * a value, so a merge never overwrites a derived column with a null no parent asserted.
   */
  derived: {
    basicCategory?: string;
    clusterKey?: string;
    confidence?: number;
    operatingStatus?: string;
  };
};

function canonicalOrder(parents: readonly SourceRecordView[]): SourceRecordView[] {
  return parents
    .filter((p) => SURVIVOR_SOURCE_KEYS.has(p.sourceKey))
    .slice()
    .sort((a, b) => {
      const ca = a.confidence ?? Number.NEGATIVE_INFINITY;
      const cb = b.confidence ?? Number.NEGATIVE_INFINITY;
      if (ca !== cb) return cb - ca;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function first(
  parents: readonly SourceRecordView[],
  pred: (p: SourceRecordView) => boolean,
): SourceRecordView | undefined {
  return parents.find(pred);
}

function sourced<T>(p: SourceRecordView | undefined, value: (p: SourceRecordView) => T | null): Sourced<T> {
  return p ? { value: value(p), sourceId: p.id } : { value: null, sourceId: null };
}

const hasAddress = (p: SourceRecordView) => p.street !== null || p.postal !== null;
const hasLocation = (p: SourceRecordView) => p.lat !== null && p.lng !== null;

export function survive(parents: SourceRecordView[]): SurvivingFields {
  const ps = canonicalOrder(parents);
  const is = (key: SurvivorSourceKey) => (p: SourceRecordView) => p.sourceKey === key;

  // legal_name: the Comptroller DBA, and only the Comptroller.
  const legal = first(ps, (p) => is('tx_comptroller')(p) && p.legalName !== null);

  // display_name: Overture; the Comptroller outlet_name ONLY when no Overture parent exists.
  const overtureName = first(ps, (p) => is('overture')(p) && p.displayName !== null);
  const hasOverture = ps.some(is('overture'));
  const comptrollerName = hasOverture
    ? undefined
    : first(ps, (p) => is('tx_comptroller')(p) && (p.displayName ?? p.legalName) !== null);

  // phone: Overture preferred; otherwise whichever parent has one.
  const phone =
    first(ps, (p) => is('overture')(p) && p.phoneE164 !== null) ??
    first(ps, (p) => p.phoneE164 !== null);

  // address: Overture; the Comptroller address as fallback.
  const address =
    first(ps, (p) => is('overture')(p) && hasAddress(p)) ??
    first(ps, (p) => is('tx_comptroller')(p) && hasAddress(p));

  // lat/lng: Overture, then Census Exact, then Census Non_Exact LAST.
  const location =
    first(ps, (p) => is('overture')(p) && hasLocation(p)) ??
    first(ps, (p) => is('census_geocoder')(p) && p.locationMatchType === 'census_exact' && hasLocation(p)) ??
    first(ps, (p) => is('census_geocoder')(p) && p.locationMatchType === 'census_non_exact' && hasLocation(p));

  // closed_at: tx_comptroller_closures ONLY (D-03). An Overture 'permanently_closed' lives in
  // operating_status and never reaches here.
  const closure = first(ps, (p) => is('tx_comptroller_closures')(p) && p.closedAt !== null);

  // Derived columns: Overture first, then any parent carrying a value.
  const derivedFrom = <K extends 'basicCategory' | 'clusterKey' | 'confidence' | 'operatingStatus'>(
    key: K,
  ): SourceRecordView[K] | undefined => {
    const p =
      first(ps, (x) => is('overture')(x) && x[key] !== null) ?? first(ps, (x) => x[key] !== null);
    return p ? p[key] : undefined;
  };
  const derived: SurvivingFields['derived'] = {};
  const basicCategory = derivedFrom('basicCategory');
  if (basicCategory != null) derived.basicCategory = basicCategory;
  const clusterKey = derivedFrom('clusterKey');
  if (clusterKey != null) derived.clusterKey = clusterKey;
  const confidence = derivedFrom('confidence');
  if (confidence != null) derived.confidence = confidence;
  const operatingStatus = derivedFrom('operatingStatus');
  if (operatingStatus != null) derived.operatingStatus = operatingStatus;

  return {
    legalName: sourced(legal, (p) => p.legalName),
    displayName: overtureName
      ? sourced(overtureName, (p) => p.displayName)
      : sourced(comptrollerName, (p) => p.displayName ?? p.legalName),
    phone: phone
      ? { e164: phone.phoneE164, blockable: phone.phoneBlockable, sourceId: phone.id }
      : { e164: null, blockable: false, sourceId: null },
    address: address
      ? {
          street: address.street,
          streetNum: address.streetNum,
          streetNorm: address.streetNorm,
          unit: address.unit,
          postal: address.postal,
          city: address.city,
          sourceId: address.id,
        }
      : { street: null, streetNum: null, streetNorm: null, unit: null, postal: null, city: null, sourceId: null },
    location: location
      ? { lat: location.lat, lng: location.lng, matchType: location.locationMatchType, sourceId: location.id }
      : { lat: null, lng: null, matchType: null, sourceId: null },
    closedAt: sourced(closure, (p) => p.closedAt),
    derived,
  };
}
