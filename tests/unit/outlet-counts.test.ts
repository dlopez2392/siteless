/**
 * The seed data is the Phase 2 / Phase 3 shared contract, so it is pinned by assertions on
 * the RIGHT values rather than on the absence of wrong ones — the discipline
 * tests/unit/no-internal-leak.test.ts sets. A test that only proves "nothing is obviously
 * broken" is green against an empty file.
 *
 * Every assignment below (`const x: SomeFile = someJson`) is also the COMPILE-TIME half of
 * the check: `src/seed/types.ts` describes the structure, so a misspelled field or a number
 * written as a string fails `tsc` before this file ever runs. See the long comment in
 * types.ts for why the discriminating fields are `string` there and are narrowed here.
 */
import { describe, expect, it } from 'vitest';
import citiesJson from '@/seed/data/cities.json';
import clustersJson from '@/seed/data/clusters.json';
import countiesJson from '@/seed/data/counties.json';
import geoPresetsJson from '@/seed/data/geo-presets.json';
import outletCountsJson from '@/seed/data/outlet-counts.json';
import {
  CLUSTER_KEYS,
  RGV_COUNTY_FIPS,
  type CitiesFile,
  type ClustersFile,
  type CountiesFile,
  type GeoPresetsFile,
  type OutletCountsFile,
} from '@/seed/types';

const cities: CitiesFile = citiesJson;
const clusters: ClustersFile = clustersJson;
const counties: CountiesFile = countiesJson;
const geoPresets: GeoPresetsFile = geoPresetsJson;
const outletCounts: OutletCountsFile = outletCountsJson;

/** The measured county matrix, restated here so the test states its expectation
 *  independently of the file it is checking. Cameron / Hidalgo / Starr / Willacy. */
const COUNTY_MATRIX: Record<string, [number, number, number, number]> = {
  home_services: [442, 969, 32, 9],
  food_hospitality: [1958, 3329, 224, 61],
  personal_care_health: [303, 628, 43, 3],
  auto_retail: [5861, 9355, 606, 155],
};

/**
 * Statewide, counting `outlet_county_code between '001' and '254'` only.
 *
 * 02-RESEARCH.md records 120749 / 362071 (total 552278). Those figures were measured
 * WITHOUT the sentinel filter RESEARCH itself mandates: the Comptroller dataset carries a
 * 255th `outlet_county_code` value '000' that belongs to no Texas county and has no FIPS.
 * Re-measured live on 2026-09-22, the delta is exactly 1 food_hospitality row and 2
 * auto_retail rows. A statewide figure that cannot be reproduced by summing the 254 seeded
 * counties is unusable by the `texas_254_counties` preset, so the sentinel is excluded.
 */
const STATE_TOTALS: Record<string, number> = {
  home_services: 45612,
  food_hospitality: 120748,
  personal_care_health: 23846,
  auto_retail: 362069,
};

const RGV_COLUMN_TOTALS: Record<string, number> = {
  home_services: 1452,
  food_hospitality: 5572,
  personal_care_health: 977,
  auto_retail: 15977,
};

function countyOutlets(clusterKey: string, fips: string): number {
  const row = outletCounts.outletCounts.find(
    (r) => r.scope === 'county' && r.clusterKey === clusterKey && r.countyFips === fips,
  );
  if (!row) throw new Error(`no county row for ${clusterKey} / ${fips}`);
  return row.outlets;
}

function stateOutlets(clusterKey: string): number {
  const row = outletCounts.outletCounts.find(
    (r) => r.scope === 'state' && r.clusterKey === clusterKey,
  );
  if (!row) throw new Error(`no state row for ${clusterKey}`);
  return row.outlets;
}

describe('seed data', () => {
  it('outlet counts match the measured RGV matrix', () => {
    // Four clusters, each with four county rows and one state row: 20 rows, no more.
    // A sixth row for a cluster would double-count into every total below.
    expect(outletCounts.outletCounts).toHaveLength(20);
    expect(outletCounts.outletCounts.filter((r) => r.scope === 'county')).toHaveLength(16);
    expect(outletCounts.outletCounts.filter((r) => r.scope === 'state')).toHaveLength(4);

    // `null` and not absent, so "we did not measure it" and "it has no county" stay distinct.
    for (const row of outletCounts.outletCounts) {
      expect(['county', 'state']).toContain(row.scope);
      expect(CLUSTER_KEYS).toContain(row.clusterKey as (typeof CLUSTER_KEYS)[number]);
      if (row.scope === 'state') expect(row.countyFips).toBeNull();
      else expect(RGV_COUNTY_FIPS).toContain(row.countyFips as (typeof RGV_COUNTY_FIPS)[number]);
    }

    let rgvGrand = 0;
    let stateGrand = 0;

    for (const clusterKey of CLUSTER_KEYS) {
      const expected = COUNTY_MATRIX[clusterKey];
      if (!expected) throw new Error(`no expectation for ${clusterKey}`);

      const actual = RGV_COUNTY_FIPS.map((fips) => countyOutlets(clusterKey, fips));
      expect(actual, clusterKey).toEqual(expected);

      // The column total is DERIVED, never stored — a stored total is a second source of
      // truth that can disagree with its own parts. Assert the derivation, not a field.
      const column = actual.reduce((a, b) => a + b, 0);
      expect(column, `${clusterKey} RGV column`).toBe(RGV_COLUMN_TOTALS[clusterKey]);

      expect(stateOutlets(clusterKey), `${clusterKey} statewide`).toBe(STATE_TOTALS[clusterKey]);

      // Every county is a subset of the state, which catches a county figure accidentally
      // measured against the wrong predicate far more cheaply than re-querying Socrata.
      expect(column, `${clusterKey} RGV <= TX`).toBeLessThan(stateOutlets(clusterKey));

      rgvGrand += column;
      stateGrand += stateOutlets(clusterKey);
    }

    expect(rgvGrand).toBe(23978);
    expect(stateGrand).toBe(552275);

    // The four clusters, atomic (D-03), with the exact measured NAICS predicates. `hi` is
    // EXCLUSIVE — off-by-one here silently re-scopes an entire cluster.
    expect(clusters.clusters.map((c) => c.key)).toEqual([...CLUSTER_KEYS]);
    expect(clusters.clusters.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4]);
    const ranges = Object.fromEntries(clusters.clusters.map((c) => [c.key, c.naicsRanges]));
    expect(ranges['home_services']).toEqual([{ lo: 230000, hi: 240000 }]);
    expect(ranges['food_hospitality']).toEqual([{ lo: 721000, hi: 723000 }]);
    expect(ranges['personal_care_health']).toEqual([
      { lo: 812100, hi: 812200 },
      { lo: 621000, hi: 622000 },
    ]);
    expect(ranges['auto_retail']).toEqual([
      { lo: 811100, hi: 811200 },
      { lo: 440000, hi: 460000 },
    ]);
    for (const c of clusters.clusters) {
      expect(c.displayName.length, c.key).toBeGreaterThan(0);
      expect(c.placesTypes.length, c.key).toBeGreaterThan(0);
      // Phase 4 revises placesTypes; the note is what stops a reviewer treating a wrong
      // entry as a Phase 2 defect, so it has to actually be there.
      expect(c.placesTypesNote, c.key).toContain('Phase 4 validates every type');
    }
  });

  it('254 counties seeded with both numbering systems', () => {
    expect(counties.counties).toHaveLength(254);

    for (const c of counties.counties) {
      // Pitfall 7, asserted over every row rather than spot-checked: the geocoder returns
      // 215 for Hidalgo and the Comptroller says 108, and a seed that confuses them makes
      // every radius estimate silently return zero expected businesses.
      expect(c.countyFips, c.name).toBe(2 * c.comptrollerCode - 1);
      // The GEOID is the 5-character STRING, not a number: '48061' must keep its zero.
      expect(c.fips, c.name).toBe('48' + String(c.countyFips).padStart(3, '0'));
      expect(c.fips, c.name).toHaveLength(5);
    }

    const byFips = new Map(counties.counties.map((c) => [c.fips, c]));
    expect(byFips.size, 'fips are unique').toBe(254);

    const expectRgv = (fips: string, name: string, comptroller: number, outlets: number) => {
      const row = byFips.get(fips);
      expect(row, fips).toBeDefined();
      expect(row?.name).toBe(name);
      expect(row?.comptrollerCode).toBe(comptroller);
      expect(row?.isRgv).toBe(true);
      expect(row?.outletCount).toBe(outlets);
    };
    expectRgv('48061', 'Cameron', 31, 12313);
    expectRgv('48215', 'Hidalgo', 108, 21062);
    expectRgv('48427', 'Starr', 214, 1226);
    expectRgv('48489', 'Willacy', 245, 327);

    expect(counties.counties.filter((c) => c.isRgv)).toHaveLength(4);
    expect(
      counties.counties.filter((c) => c.isRgv).reduce((s, c) => s + c.outletCount, 0),
      'RGV all-NAICS outlet universe',
    ).toBe(34928);

    // Non-RGV rows carry 0, not a stale figure: a non-zero outletCount outside the RGV
    // would be read by the estimator as a measured county and priced.
    for (const c of counties.counties) {
      if (!c.isRgv) expect(c.outletCount, c.name).toBe(0);
    }

    // The endpoints of the bijection, which is where a re-sorted list would break first.
    expect(byFips.get('48001')?.name).toBe('Anderson');
    expect(byFips.get('48001')?.comptrollerCode).toBe(1);
    expect(byFips.get('48507')?.name).toBe('Zavala');
    expect(byFips.get('48507')?.comptrollerCode).toBe(254);
    // The Mc* block FIPS-orders before Ma*, which is exactly what a name sort gets wrong.
    expect(byFips.get('48297')?.name).toBe('Live Oak');
    expect(counties.counties.map((c) => c.comptrollerCode)).toEqual(
      Array.from({ length: 254 }, (_, i) => i + 1),
    );

    // The built-in geographies read FROM this list (D-04), so they cannot drift from it.
    const presets = new Map(geoPresets.geoPresets.map((p) => [p.key, p]));
    const texas = presets.get('texas_254_counties');
    expect(texas?.displayName).toBe('Texas (254 counties)');
    expect(texas?.kind).toBe('counties');
    expect(texas?.counties).toEqual(counties.counties.map((c) => c.fips));
    const rgvCounties = presets.get('rgv_4_counties');
    expect(rgvCounties?.counties).toEqual([...RGV_COUNTY_FIPS]);
    const rgvCities = presets.get('rgv_17_cities');
    expect(rgvCities?.kind).toBe('cities');
    expect(rgvCities?.cities).toEqual(
      cities.cities.map((c) => ({ name: c.name, countyFips: c.countyFips })),
    );
  });

  it('the RGV 17-city list and its coverage', () => {
    expect(cities.cities).toHaveLength(17);

    const p = cities.provenance;
    expect(p.thresholdOutlets).toBe(400);
    expect(p.rgvTotalOutlets).toBe(34928);
    expect(p.selectedOutletsBeforeFolding).toBe(31693);
    expect(p.coveragePctBeforeFolding).toBe(90.7);

    // The folded sum is computed from the rows, then compared with what the file CLAIMS —
    // so provenance drifting away from its own data is red, in both directions.
    const folded = cities.cities.reduce((s, c) => s + c.outletCount, 0);
    expect(folded).toBe(31760);
    expect(p.seededOutletsAfterFolding).toBe(31760);
    expect(p.coveragePctAfterFolding).toBe(
      Math.round((31760 / 34928) * 100 * 10) / 10,
    );
    expect(p.coveragePctAfterFolding).toBe(90.9);
    expect(p.coveragePctBeforeFolding).toBe(Math.round((31693 / 34928) * 100 * 10) / 10);

    // Every seeded city clears the threshold and every candidate is below it: the rule the
    // provenance states is the rule the data actually follows.
    for (const c of cities.cities) expect(c.outletCount, c.name).toBeGreaterThanOrEqual(400);
    for (const c of p.nextCandidates) expect(c.outlets, c.name).toBeLessThan(400);

    expect(p.nextCandidates).toHaveLength(5);
    const raymondville = p.nextCandidates.find((c) => c.name === 'Raymondville');
    expect(raymondville, 'Willacy has no city above the line; Raymondville is the only').toBeDefined();
    expect(raymondville?.outlets).toBe(221);
    expect(raymondville?.countyFips).toBe('48489');

    // Rio Grande City: the source spells it three ways and the true total is the fold.
    // 776 (the largest single spelling) is the number a naive seed would carry.
    const rgc = cities.cities.find((c) => c.name === 'Rio Grande City');
    expect(rgc).toBeDefined();
    expect(rgc?.outletCount).toBe(843);
    expect(rgc?.countyFips).toBe('48427');
    expect(rgc?.nameVariants).toEqual(['RIO GRANDE CITY', 'RIO GRANDE CY', 'RIO GRANDE']);
    expect(rgc?.nameVariants).toHaveLength(3);

    // nameVariants is never empty and is always the UPPER-CASE source spelling, so the
    // loader folds on one field and never falls back to `name`.
    for (const c of cities.cities) {
      expect(c.nameVariants.length, c.name).toBeGreaterThan(0);
      for (const v of c.nameVariants) expect(v, c.name).toBe(v.toUpperCase());
      if (c.name !== 'Rio Grande City') {
        expect(c.nameVariants, c.name).toEqual([c.name.toUpperCase()]);
      }
    }

    // Descending by outlets, and every city resolves to a seeded RGV county.
    const outlets = cities.cities.map((c) => c.outletCount);
    expect(
      [...outlets].sort((a, b) => b - a),
      'seeded in descending outlet order except the folded Rio Grande City row',
    ).toEqual([6678, 5985, 3092, 3034, 2626, 1942, 1551, 948, 843, 821, 791, 763, 748, 566, 490, 465, 417]);
    for (const c of cities.cities) {
      expect(RGV_COUNTY_FIPS, c.name).toContain(c.countyFips as (typeof RGV_COUNTY_FIPS)[number]);
    }
    expect(new Set(cities.cities.map((c) => c.name)).size, 'city names unique').toBe(17);
    expect(cities.cities.map((c) => c.name)).toContain('Brownsville');
    expect(cities.cities.map((c) => c.name)).toContain('South Padre Island');
  });
});
