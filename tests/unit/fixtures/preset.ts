/**
 * The ONE `PresetSpec` fixture. The estimator tests (02-07) and the component tests (02-10)
 * both import from here so the two cannot drift into disagreeing about what "the RGV
 * baseline" means — which is the failure mode where a component renders 68 cells, the
 * estimator prices 64, and both suites are green.
 *
 * 🔴 Every city and county reference below is DERIVED from `src/seed/data/*.json`. Nothing
 * here restates a city name or a FIPS code. A fixture that hard-codes a list is a second
 * source of truth: promote Raymondville by editing `cities.json` and this fixture must
 * follow automatically, or the tests go on pricing the old geography forever.
 * `tests/unit/outlet-counts.test.ts` is what pins the seed files themselves.
 */
import citiesJson from '@/seed/data/cities.json';
import countiesJson from '@/seed/data/counties.json';
import mcallen from '../msw/fixtures/census-mcallen.json';
import {
  CLUSTER_KEYS,
  type CitiesFile,
  type ClusterKey,
  type CountiesFile,
} from '@/seed/types';

const cities: CitiesFile = citiesJson;
const counties: CountiesFile = countiesJson;

/**
 * The spec types are RE-EXPORTED from the estimator, never redeclared here.
 *
 * They were declared inline in this file before `src/lib/estimate/` existed. Two
 * structurally-identical declarations of the same contract is the second-source-of-truth
 * this file's own header warns about: TypeScript is structural, so the two would go on
 * type-checking against each other while drifting in meaning, and the fixture could start
 * describing a preset shape the estimator no longer prices. One declaration, one meaning.
 */
import type { CityRef, GeoSpec, PresetSpec } from '@/lib/estimate/expand-cells';

export type { CityRef, GeoSpec, PresetSpec };

/** cells = clusters x geography units. The estimator's entire unit of work, and the only
 *  arithmetic a caller should ever need to reproduce by hand when reading a test. */
export function cellCount(spec: PresetSpec): number {
  const units =
    spec.geo.kind === 'cities'
      ? spec.geo.cities.length
      : spec.geo.kind === 'counties'
        ? spec.geo.counties.length
        : 1;
  return spec.clusterKeys.length * units;
}

const ALL_CLUSTERS: ClusterKey[] = [...CLUSTER_KEYS];

const ALL_CITY_REFS: CityRef[] = cities.cities.map((c) => ({
  name: c.name,
  countyFips: c.countyFips,
}));

const RGV_COUNTY_REFS: string[] = counties.counties.filter((c) => c.isRgv).map((c) => c.fips);

const ALL_COUNTY_REFS: string[] = counties.counties.map((c) => c.fips);

/** Four clusters x 17 cities = 68 cells. The default shape of the product. */
export const RGV_BASELINE_SPEC: PresetSpec = {
  name: 'RGV baseline',
  clusterKeys: ALL_CLUSTERS,
  geo: { kind: 'cities', cities: ALL_CITY_REFS },
};

/** Four clusters x 4 counties = 16 cells. */
export const RGV_COUNTIES_SPEC: PresetSpec = {
  name: 'RGV counties',
  clusterKeys: ALL_CLUSTERS,
  geo: { kind: 'counties', counties: RGV_COUNTY_REFS },
};

/** Four clusters x 254 counties = 1016 cells. D-04's built-in, treated like any other
 *  geography — the estimate screen shows its cost as a multiple of the RGV preset rather
 *  than special-casing it anywhere in the pricing path. */
export const TEXAS_SPEC: PresetSpec = {
  name: 'Texas (254 counties)',
  clusterKeys: ALL_CLUSTERS,
  geo: { kind: 'counties', counties: ALL_COUNTY_REFS },
};

/**
 * Centred on the recorded McAllen geocode, read out of the msw fixture rather than typed,
 * so the radius spec and the payload the geocoder tests replay can never disagree about
 * where McAllen is.
 *
 * 🔴 `coordinates.x` is LONGITUDE and `coordinates.y` is LATITUDE. The Census Geocoder does
 * not return `(lat, lng)`, and reading them in written order puts the RGV in the Indian
 * Ocean. The `countyFips` is pinned to Hidalgo `48215` — the GEOID the same payload carries
 * — which is Pitfall 7 in fixture form: the Comptroller would call this county 108.
 */
const mcallenMatch = mcallen.result.addressMatches[0];
if (!mcallenMatch) {
  throw new Error(
    'tests/unit/fixtures/preset.ts: census-mcallen.json carries no addressMatch. ' +
      'The fixture was re-recorded against an input that no longer matches; see ' +
      'tests/unit/msw/fixtures/README.md before editing anything here.',
  );
}

export const MCALLEN_LAT = mcallenMatch.coordinates.y;
export const MCALLEN_LNG = mcallenMatch.coordinates.x;
export const MCALLEN_COUNTY_FIPS = mcallenMatch.geographies.Counties[0]?.GEOID ?? '';

export const RADIUS_SPEC: PresetSpec = {
  name: 'McAllen 10 miles',
  clusterKeys: ['home_services'],
  geo: {
    kind: 'radius',
    lat: MCALLEN_LAT,
    lng: MCALLEN_LNG,
    countyFips: MCALLEN_COUNTY_FIPS,
    radiusMiles: 10,
  },
};

/**
 * Exactly one cell. The arithmetic tests need a spec where a wrong total is unmistakable:
 * at 68 cells an off-by-one in the cell count hides inside a plausible dollar figure, and
 * at 1 cell it cannot.
 *
 * The city is whichever one the seed lists first, not a named favourite — nothing here
 * should have to change when the list does.
 */
const firstCity = ALL_CITY_REFS[0];
if (!firstCity) throw new Error('tests/unit/fixtures/preset.ts: cities.json seeded no cities');

export const SINGLE_CLUSTER_CITY_SPEC: PresetSpec = {
  name: 'one cluster, one city',
  clusterKeys: ['home_services'],
  geo: { kind: 'cities', cities: [firstCity] },
};
