/**
 * The shapes every committed file under `src/seed/data/` must satisfy.
 *
 * These exist so a malformed seed file fails `tsc` instead of failing at runtime inside
 * the estimator, where a missing field reads as `undefined` and prices a cell at NaN.
 * `tests/unit/outlet-counts.test.ts` performs the structural check by assigning each
 * resolved JSON module to the matching type below — that assignment IS the compile-time
 * assertion, and it is the reason these types are exported rather than inlined.
 *
 * WHY THE DISCRIMINATING FIELDS ARE `string` AND NOT A NARROW UNION.
 * TypeScript widens every string in a `resolveJsonModule` import to `string`; it does not
 * infer literal types from a `.json` file. A `key: ClusterKey` field here would therefore
 * make EVERY seed file fail `tsc`, and the only way to get green again would be to delete
 * the check — a guard that cannot pass is not a guard. So the *structure* (field names,
 * nesting, number-vs-string, null-vs-absent) is enforced by the compiler, and the *value
 * domain* (which keys exist, which scopes are legal) is enforced by named assertions in
 * `tests/unit/outlet-counts.test.ts`, which can see the literals. Both halves are
 * required; neither alone is sufficient.
 *
 * Seed ROWS ship as JSON read by `tsx scripts/seed.ts`, never as a migration: drizzle-kit
 * hashes migration SQL and CONVENTIONS forbids editing an applied file, while outlet
 * counts are deliberately refreshable (Socrata's `rowsUpdatedAt` moves). The schema ships
 * as a migration; the rows ship as these files (D-05, reference rows with `org_id IS NULL`).
 */

/** The four atomic clusters (D-03). A preset picks one or more; the NAICS ranges and
 *  Places types inside a cluster are seed data, never per-preset toggles. */
export const CLUSTER_KEYS = [
  'home_services',
  'food_hospitality',
  'personal_care_health',
  'auto_retail',
] as const;

export type ClusterKey = (typeof CLUSTER_KEYS)[number];

/** The four RGV county GEOIDs, in Comptroller-code order (31, 108, 214, 245). */
export const RGV_COUNTY_FIPS = ['48061', '48215', '48427', '48489'] as const;

export type RgvCountyFips = (typeof RGV_COUNTY_FIPS)[number];

/**
 * `lo` inclusive, `hi` EXCLUSIVE. Written as a half-open interval because the Comptroller's
 * `outlet_naics_code` is a Socrata *number*: `starts_with(outlet_naics_code, '23')` returns
 * HTTP 400 `query.soql.type-mismatch` (Pitfall 6), so the only expressible predicate is a
 * numeric range and the seed must state it in the same terms the query uses.
 */
export type NaicsRange = { lo: number; hi: number };

export type ClusterSeed = {
  key: string;
  displayName: string;
  sortOrder: number;
  naicsRanges: NaicsRange[];
  placesTypes: string[];
  placesTypesNote: string;
};

export type ClustersFile = {
  source: string;
  measuredAt: string;
  clusters: ClusterSeed[];
};

/**
 * Both numbering systems, always (Pitfall 7).
 *
 * `fips` is the 5-character GEOID string the Census Geocoder returns ('48215'); `countyFips`
 * is its integer county part (215); `comptrollerCode` is the Texas Comptroller's own county
 * number (108) and is what `outlet_county_code` carries in the Socrata dataset. Confusing
 * the two makes every radius estimate silently return zero expected businesses, because the
 * geocoded county never matches a seeded one.
 *
 * `comptrollerCode = (countyFips + 1) / 2` is an exact bijection — Texas's 254 county FIPS
 * codes are the contiguous odd integers 1, 3, 5 … 507. 🔴 Do NOT re-derive it by sorting
 * county names: 15 of 254 break under every collation (El Paso/Ellis, La Salle/Lamar, and
 * the whole `Mc*` block, which FIPS orders before `Ma*`).
 */
export type CountySeed = {
  fips: string;
  countyFips: number;
  comptrollerCode: number;
  name: string;
  isRgv: boolean;
  outletCount: number;
};

export type CountiesFile = {
  source: string;
  fetchedAt: string;
  identity: string;
  counties: CountySeed[];
};

/**
 * `nameVariants` holds the UPPER-CASE spellings as they appear in `outlet_city`, and is the
 * join key the seed loader folds on. It is never empty: a city with one spelling carries
 * that one spelling, so a consumer never has to fall back to `name` and quietly miss a
 * variant. Rio Grande City is the reason the field exists — the source spells it three ways.
 */
export type CitySeed = {
  name: string;
  countyFips: string;
  outletCount: number;
  nameVariants: string[];
};

/** The five cities immediately below the threshold, so danlo can promote one by editing
 *  this file rather than by re-running a query nobody remembers. */
export type CityCandidateSeed = {
  name: string;
  countyFips: string;
  outlets: number;
};

export type CityProvenance = {
  rule: string;
  thresholdOutlets: number;
  selectionBasis: string;
  source: string;
  measuredAt: string;
  rgvTotalOutlets: number;
  selectedOutletsBeforeFolding: number;
  coveragePctBeforeFolding: number;
  seededOutletsAfterFolding: number;
  coveragePctAfterFolding: number;
  nextCandidates: CityCandidateSeed[];
};

export type CitiesFile = {
  provenance: CityProvenance;
  cities: CitySeed[];
};

/**
 * One row per (scope, geography, cluster). `countyFips` is `null` exactly on the `state`
 * rows — absent would be indistinguishable from "we forgot to measure it".
 *
 * The RGV column totals (1452 / 5572 / 977 / 15977) are DERIVED by summing the four county
 * rows and are deliberately not stored: a stored total is a second source of truth that can
 * disagree with its own parts. `tests/unit/outlet-counts.test.ts` computes them.
 */
export type OutletCountSeed = {
  scope: string;
  countyFips: string | null;
  clusterKey: string;
  outlets: number;
};

export type OutletCountsFile = {
  source: string;
  measuredAt: string;
  caveat: string;
  statewideScope: string;
  outletCounts: OutletCountSeed[];
};

export type CityRefSeed = {
  name: string;
  countyFips: string;
};

/**
 * A built-in geography (D-04, D-05). `kind` is `'cities' | 'counties'`; the array the kind
 * does not use is `[]` rather than absent, so a consumer reading the wrong one gets an empty
 * list instead of `undefined.length`.
 *
 * `radius` is a per-preset geography kind, not a built-in — it is produced by geocoding a
 * caller-supplied address, so it cannot be seeded.
 */
export type GeoPresetSeed = {
  key: string;
  displayName: string;
  kind: string;
  sortOrder: number;
  cities: CityRefSeed[];
  counties: string[];
};

export type GeoPresetsFile = {
  source: string;
  geoPresets: GeoPresetSeed[];
};
