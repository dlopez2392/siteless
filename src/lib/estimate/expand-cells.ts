/**
 * A preset becomes a list of CELLS. One cell is one (industry cluster × one geography
 * unit) pair, and a cell is the estimator's atom: requests scale off how many there are
 * times the Places types each cell's cluster searches (D-18, `placesTypesFor`), expected
 * businesses off what each one contains.
 *
 * 🔴 PURE. No I/O, no database, no fetch, no clock. The caller hands in the seed tables
 * and gets arithmetic back. That is what lets D-08's live-as-you-type estimate exist at
 * all — recomputing on every keystroke is only safe because nothing here can spend or
 * block — and it is what lets the cost model be a committed test rather than a spreadsheet.
 *
 * WHY A CELL CARRIES TWO EXPECTED COUNTS.
 * `expectedOutlets` is rounded, because a cell renders as a whole number of businesses.
 * `expectedOutletsExact` is not, because the preset total is the sum over cells and
 * rounding 1,016 of them first introduces drift that cannot be reconciled against the
 * seeded statewide figure. Sum exact, round once. The Texas preset is the case that
 * proves it: its total must come out at the seeded statewide count exactly, and it does.
 */
import { RADIUS_REFERENCE_MILES } from './assumptions';
import type {
  CitiesFile,
  CitySeed,
  ClusterKey,
  ClustersFile,
  CountiesFile,
  CountySeed,
  GeoPresetsFile,
  OutletCountsFile,
} from '@/seed/types';

/** A city named the way `cities.json` names it, plus the county that disambiguates it.
 *  Both halves are required: Hidalgo is a city IN Hidalgo County, and there is more than
 *  one Texas town whose name repeats across counties. */
export type CityRef = { name: string; countyFips: string };

export type GeoSpec =
  | { kind: 'cities'; cities: CityRef[] }
  | { kind: 'counties'; counties: string[] }
  | { kind: 'radius'; lat: number; lng: number; countyFips: string; radiusMiles: number };

export type PresetSpec = {
  name: string;
  clusterKeys: ClusterKey[];
  geo: GeoSpec;
};

export type UnitKind = 'city' | 'county' | 'radius';

export type Cell = {
  clusterKey: ClusterKey;
  unitKind: UnitKind;
  /** Stable within a spec, for React keys and for naming a cell in an error. */
  unitId: string;
  /** Rounded — what a cell displays. */
  expectedOutlets: number;
  /** Unrounded — what the preset total is summed from. See the header note. */
  expectedOutletsExact: number;
};

/** Everything `expandCells` reads. Passed in rather than imported so this module stays
 *  pure and so a test can hand it a deliberately-broken seed. */
export type SeedTables = {
  cities: CitiesFile;
  /** D-18: the estimate counts each cluster's Places types, so the cluster table is an
   *  estimator input now, not only a seed for the database. */
  clusters: ClustersFile;
  counties: CountiesFile;
  outletCounts: OutletCountsFile;
  geoPresets: GeoPresetsFile;
};

/** U+0000 cannot occur in a FIPS code, a county name or a cluster key, so it is the one
 *  separator that cannot collide with data. A `-` would. */
export const CELL_KEY_SEP = '\u0000';
const SEP = CELL_KEY_SEP;

/**
 * The one name for a cell outside this module: cluster key + U+0000 + the cell's `unitId`.
 * The partition planner and the run planner key cells by this, so it is exported rather
 * than re-joined at each call site with a separator that could drift.
 */
export function cellKey(clusterKey: string, unitId: string): string {
  return clusterKey + CELL_KEY_SEP + unitId;
}

/**
 * The Places types a cluster searches, read from clusters.json. Throws naming the key when
 * the cluster is not seeded: a silent empty list would price that cluster at zero requests,
 * which reads as "free" — the one wrong answer the estimate must never give.
 */
export function placesTypesFor(clusterKey: string, seed: SeedTables): readonly string[] {
  const cluster = seed.clusters.clusters.find((c) => c.key === clusterKey);
  if (!cluster) {
    throw new Error(
      `placesTypesFor: no seeded cluster "${clusterKey}" in src/seed/data/clusters.json, so ` +
        `its Places type searches cannot be counted.`,
    );
  }
  return cluster.placesTypes;
}

const countyClusterKey = (fips: string, cluster: string) => fips + SEP + cluster;
const cityKey = (countyFips: string, name: string) => countyFips + SEP + name;

type SeedIndex = {
  countyByFips: Map<string, CountySeed>;
  cityByKey: Map<string, CitySeed>;
  /** Individually measured (county, cluster) outlet counts. Only the four RGV counties. */
  measured: Map<string, number>;
  /**
   * Per cluster: the statewide outlets NOT attributable to an individually measured
   * county, divided evenly across the counties that have no measured row. Fractional on
   * purpose — see the header note about summing exact and rounding once.
   *
   * 🔴 THIS IS AN APPORTIONMENT, NOT A MEASUREMENT. The Comptroller data was measured per
   * cluster for the four RGV counties and once statewide; the other 250 counties were
   * never broken out, and inventing a per-county figure for them would be a number nobody
   * could reproduce. What this DOES guarantee is the property the Texas preset needs: the
   * sum over all 254 counties equals the seeded statewide figure exactly, because the
   * measured part and the residual part add back up by construction. A single non-RGV
   * county's cell is an average and the assumptions drawer says so.
   */
  apportionedShare: Map<string, number>;
};

function indexSeed(seed: SeedTables): SeedIndex {
  const countyByFips = new Map<string, CountySeed>();
  for (const c of seed.counties.counties) countyByFips.set(c.fips, c);

  const cityByKey = new Map<string, CitySeed>();
  for (const c of seed.cities.cities) cityByKey.set(cityKey(c.countyFips, c.name), c);

  const measured = new Map<string, number>();
  const measuredSumByCluster = new Map<string, number>();
  const measuredCountByCluster = new Map<string, number>();
  const stateByCluster = new Map<string, number>();

  for (const row of seed.outletCounts.outletCounts) {
    if (row.scope === 'county' && row.countyFips !== null) {
      measured.set(countyClusterKey(row.countyFips, row.clusterKey), row.outlets);
      measuredSumByCluster.set(
        row.clusterKey,
        (measuredSumByCluster.get(row.clusterKey) ?? 0) + row.outlets,
      );
      measuredCountByCluster.set(
        row.clusterKey,
        (measuredCountByCluster.get(row.clusterKey) ?? 0) + 1,
      );
    } else if (row.scope === 'state') {
      stateByCluster.set(row.clusterKey, row.outlets);
    }
  }

  const totalCounties = seed.counties.counties.length;
  const apportionedShare = new Map<string, number>();
  for (const [cluster, statewide] of stateByCluster) {
    const residual = statewide - (measuredSumByCluster.get(cluster) ?? 0);
    const unmeasured = totalCounties - (measuredCountByCluster.get(cluster) ?? 0);
    if (residual < 0) {
      // The seed disagrees with itself: the measured counties already hold more outlets
      // than the statewide row admits exist. Silently clamping would make the Texas total
      // reproducible-looking and wrong; name the cluster instead.
      throw new Error(
        `expandCells: seed is inconsistent for cluster "${cluster}" - the measured county ` +
          `rows sum to more than the statewide row (${measuredSumByCluster.get(cluster) ?? 0} > ` +
          `${statewide}). Re-run scripts/refresh-outlet-counts.ts; do not hand-edit one side.`,
      );
    }
    apportionedShare.set(cluster, unmeasured > 0 ? residual / unmeasured : 0);
  }

  return { countyByFips, cityByKey, measured, apportionedShare };
}

/**
 * Outlets expected in one county for one cluster, unrounded.
 *
 * Throws rather than returning zero when nothing is seeded. A silent zero renders as
 * "~0 businesses" beside "$0.00", which reads as "this preset is free" — UI-SPEC's
 * "Estimate can't be computed" error state exists for exactly this and cannot fire if the
 * estimator swallows the gap.
 */
function countyClusterExact(fips: string, cluster: ClusterKey, idx: SeedIndex): number {
  if (!idx.countyByFips.has(fips)) {
    throw new Error(
      `expandCells: no seeded county for FIPS "${fips}". The estimate cannot be computed ` +
        `for a geography that is not in src/seed/data/counties.json.`,
    );
  }

  const exact = idx.measured.get(countyClusterKey(fips, cluster));
  if (exact !== undefined) return exact;

  const share = idx.apportionedShare.get(cluster);
  if (share === undefined) {
    throw new Error(
      `expandCells: no seeded outlet count for cluster "${cluster}" in county "${fips}", ` +
        `and no statewide row for that cluster to apportion from. Check ` +
        `src/seed/data/outlet-counts.json.`,
    );
  }
  return share;
}

function cellFor(
  clusterKey: ClusterKey,
  unitKind: UnitKind,
  unitId: string,
  expectedOutletsExact: number,
): Cell {
  return {
    clusterKey,
    unitKind,
    unitId,
    expectedOutlets: Math.round(expectedOutletsExact),
    expectedOutletsExact,
  };
}

/**
 * `|clusters| × |geography units|` cells. A radius is ONE unit however wide it is, which
 * is why a 50-mile radius costs exactly what a 5-mile radius costs and only the expected
 * business count moves.
 */
export function expandCells(spec: PresetSpec, seed: SeedTables): Cell[] {
  const idx = indexSeed(seed);
  const cells: Cell[] = [];

  for (const clusterKey of spec.clusterKeys) {
    if (spec.geo.kind === 'counties') {
      for (const fips of spec.geo.counties) {
        cells.push(cellFor(clusterKey, 'county', fips, countyClusterExact(fips, clusterKey, idx)));
      }
      continue;
    }

    if (spec.geo.kind === 'cities') {
      for (const ref of spec.geo.cities) {
        // D-09: a city has no measured per-cluster count of its own, so it takes its
        // county's cluster count in proportion to its share of the county's all-NAICS
        // outlets. McAllen is 5,985 of Hidalgo's 21,062.
        const city = idx.cityByKey.get(cityKey(ref.countyFips, ref.name));
        if (!city) {
          throw new Error(
            `expandCells: no seeded city "${ref.name}" in county "${ref.countyFips}". ` +
              `Check src/seed/data/cities.json - the name must match the seeded spelling.`,
          );
        }
        const countyOutlets = countyClusterExact(ref.countyFips, clusterKey, idx);
        const county = idx.countyByFips.get(ref.countyFips);
        if (!county || county.outletCount <= 0) {
          throw new Error(
            `expandCells: county "${ref.countyFips}" has no all-NAICS outlet total, so city ` +
              `"${ref.name}" cannot be apportioned from it. counties.json populates ` +
              `outletCount on the RGV counties only.`,
          );
        }
        cells.push(
          cellFor(
            clusterKey,
            'city',
            cityKey(ref.countyFips, ref.name),
            (countyOutlets * city.outletCount) / county.outletCount,
          ),
        );
      }
      continue;
    }

    // radius
    const { countyFips, radiusMiles } = spec.geo;
    if (!(radiusMiles > 0)) {
      throw new Error(`expandCells: radiusMiles must be greater than zero, got ${radiusMiles}`);
    }
    // Area, not distance: halving the radius quarters the footprint. Capped at 1.0 because
    // the apportionment base is a whole county and a radius cannot contain more of a county
    // than the county holds.
    const ratio = Math.min(1, (radiusMiles / RADIUS_REFERENCE_MILES) ** 2);
    cells.push(
      cellFor(
        clusterKey,
        'radius',
        `${countyFips}${SEP}${radiusMiles}mi`,
        countyClusterExact(countyFips, clusterKey, idx) * ratio,
      ),
    );
  }

  return cells;
}
