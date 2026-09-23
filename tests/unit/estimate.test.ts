/**
 * The ROADMAP's "committed test, not a spreadsheet".
 *
 * Every dollar figure below is priced over the REAL seeded cell list — the 17 cities and
 * 254 counties in `src/seed/data/*.json`, through the same `priceRequests` and the same
 * `PRICE_BOOK` the spend ledger uses. Nothing is mocked and nothing is illustrative.
 *
 * 🔴 EXACT VALUES, NEVER `toBeCloseTo`. A tolerance here hides precisely the defect these
 * tests exist to catch: a fan-out change, a price-book edit, or a dropped free allowance
 * all move the number by a few percent, which is inside any tolerance anyone would pick
 * and outside what danlo would accept from a product whose whole claim is the number.
 *
 * 🔴 TWO-SIDED, per tests/unit/no-internal-leak.test.ts. Where a test proves a correction
 * was applied it also proves what the uncorrected answer would have been, because a test
 * that only asserts "not the wrong number" passes on a calculation that is broken a
 * different way.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatUsd } from '@/lib/budget/money';
import { priceRequests } from '@/lib/budget/price-book';
import {
  ASSUMPTIONS_CAVEAT,
  FAN_OUT,
  PAGES_HI,
  PAGES_LO,
  RADIUS_REFERENCE_MILES,
  RUN_CEILING_MULTIPLIER,
} from '@/lib/estimate/assumptions';
import {
  builtInSpec,
  estimatePreset,
  RGV_BASELINE_PRESET_KEY,
  TEXAS_PRESET_KEY,
  texasMultiplier,
  type EstimateContext,
} from '@/lib/estimate/estimate';
import {
  cellKey,
  expandCells,
  type PresetSpec,
  type SeedTables,
} from '@/lib/estimate/expand-cells';
import citiesJson from '@/seed/data/cities.json';
import clustersJson from '@/seed/data/clusters.json';
import countiesJson from '@/seed/data/counties.json';
import geoPresetsJson from '@/seed/data/geo-presets.json';
import outletCountsJson from '@/seed/data/outlet-counts.json';
import type {
  CitiesFile,
  ClustersFile,
  CountiesFile,
  GeoPresetsFile,
  OutletCountsFile,
} from '@/seed/types';
import {
  cellCount,
  RADIUS_SPEC,
  RGV_BASELINE_SPEC,
  RGV_COUNTIES_SPEC,
  SINGLE_CLUSTER_CITY_SPEC,
  TEXAS_SPEC,
} from './fixtures/preset';

const cities: CitiesFile = citiesJson;
const clusters: ClustersFile = clustersJson;
const counties: CountiesFile = countiesJson;
const outletCounts: OutletCountsFile = outletCountsJson;
const geoPresets: GeoPresetsFile = geoPresetsJson;

const SEED: SeedTables = { cities, clusters, counties, outletCounts, geoPresets };

/** D-18. Types searched per cell, per cluster, read from the seed: 6 + 6 + 7 + 7 = 26. */
const TYPES_PER_CITY = clusters.clusters.reduce((s, c) => s + c.placesTypes.length, 0);

/** The $50 monthly data cap from PROJECT.md, in micro-USD. */
const CAP = 50_000_000;

function ctx(overrides: Partial<EstimateContext> = {}): EstimateContext {
  return {
    seed: SEED,
    unitsUsedThisPeriod: 0,
    capMicroUsd: BigInt(CAP),
    spentMicroUsd: 0n,
    reservedMicroUsd: 0n,
    ...overrides,
  };
}

/** The month's first 1,000 Text Search Enterprise requests are free; this exhausts them,
 *  which is the only state in which a gross dollar figure is the right answer. */
const FREE_EXHAUSTED = { unitsUsedThisPeriod: 1000 };

describe('the estimator, priced over the real seeded cell list', () => {
  it('cost model: the RGV baseline priced over the real seeded cell list', () => {
    const e = estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED));

    // 4 clusters x 17 cities. `cellCount` re-derives it from the spec independently of
    // `expandCells`, so a defect in either one is visible rather than self-consistent.
    expect(e.cells).toBe(68);
    expect(e.cells).toBe(cellCount(RGV_BASELINE_SPEC));

    // D-18: requests are per (cell x Places type), not per cell. 17 cities x 26 types.
    expect(TYPES_PER_CITY).toBe(26);
    expect(e.typeSearches).toBe(442);
    expect(e.typeSearches).toBe(17 * TYPES_PER_CITY);

    // 442 x PAGES_LO; 442 x PAGES_HI x FAN_OUT = 442 x 9.
    expect(e.requestsLo).toBe(442);
    expect(e.requestsHi).toBe(3978);

    expect(e.costMicroUsdLo).toBe(15_470_000);
    expect(e.costMicroUsdHi).toBe(139_230_000);

    // D-18: a full RGV sweep is refused at admission; a partition or one city x one cluster
    // fits. danlo accepted this: the per-cell model under-counted requests ~6.5x, and the
    // honest number is the one the cap has to hold against.
    expect(e.costMicroUsdHi).toBeGreaterThan(CAP);

    // The drawer shows the constants the figure was actually built from, not a second copy.
    expect(e.assumptions).toEqual({
      fanOut: FAN_OUT,
      pagesLo: PAGES_LO,
      pagesHi: PAGES_HI,
      radiusReferenceMiles: RADIUS_REFERENCE_MILES,
    });
  });

  it('cost model: the RGV county baseline', () => {
    const e = estimatePreset(RGV_COUNTIES_SPEC, ctx(FREE_EXHAUSTED));

    expect(e.cells).toBe(16);
    expect(e.typeSearches).toBe(104);
    // 4 counties x 26 types x 9.
    expect(e.requestsHi).toBe(936);
    expect(e.costMicroUsdHi).toBe(32_760_000);

    // The measured RGV grand total, read straight from the seed with no apportionment:
    // 1452 + 5572 + 977 + 15977. A county cell is the one cell kind that is a measurement.
    expect(e.expectedResults).toBe(23_978);
  });

  it('cost model: Texas exceeds the cap and says so', () => {
    const e = estimatePreset(TEXAS_SPEC, ctx({ unitsUsedThisPeriod: 0 }));

    expect(e.cells).toBe(1016);
    // 254 counties x 26 types x 9.
    expect(e.requestsHi).toBe(59_436);

    // The free 1,000 still applies at the top of the range; 58,436 requests remain billable.
    expect(e.freeRemaining).toBe(1000);
    expect(e.costMicroUsdHi).toBe(2_045_260_000);
    expect(e.costMicroUsdHi).toBeGreaterThan(CAP);

    // 🔴 552,275 and NOT 552,278. The Comptroller dataset carries a 255th sentinel
    // `outlet_county_code` of '000' that belongs to no Texas county; plan 02-02 measured
    // both ways and committed the sentinel-excluded figures, because a statewide total
    // that cannot be reproduced by summing the 254 seeded counties is unusable by the
    // `texas_254_counties` preset. See src/seed/data/outlet-counts.json § statewideScope.
    expect(e.expectedResults).toBe(552_275);

    // And that total IS the sum of the four statewide rows — the apportionment across the
    // 250 counties with no measured breakdown adds back up exactly, by construction.
    const statewideSum = outletCounts.outletCounts
      .filter((r) => r.scope === 'state')
      .reduce((s, r) => s + r.outlets, 0);
    expect(e.expectedResults).toBe(statewideSum);
  });

  it('free allowance: 68 requests', () => {
    // Half one: priced directly. BOTH sides, because a test that only proves "not $2.38"
    // is equally green on a calculation that returns zero for everything.
    expect(priceRequests('ts_enterprise', 68, 1000).microUsd).toBe(0);
    expect(formatUsd(priceRequests('ts_enterprise', 68, 1000).microUsd)).toBe('$0.00');
    expect(priceRequests('ts_enterprise', 68, 0).microUsd).toBe(2_380_000);

    // Half two: through the estimator, which is where the allowance can actually get
    // dropped. Early in the month the first 1,000 of the RGV baseline's 3,978 requests are
    // free: (3978 - 1000) x 35,000.
    const early = estimatePreset(RGV_BASELINE_SPEC, ctx({ unitsUsedThisPeriod: 0 }));
    expect(early.requestsHi).toBe(3978);
    expect(early.freeRemaining).toBe(1000);
    expect(early.costMicroUsdHi).toBe(104_230_000);

    // Same preset, same month, allowance spent: the gross figure.
    const late = estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED));
    expect(late.freeRemaining).toBe(0);
    expect(late.costMicroUsdHi).toBe(139_230_000);
  });

  it('cost model: McAllen × home services fits the free allowance', () => {
    // D-04's slice shape: one city x one cluster = one cell, six Places types.
    const spec: PresetSpec = {
      name: 'McAllen, home services',
      clusterKeys: ['home_services'],
      geo: { kind: 'cities', cities: [{ name: 'McAllen', countyFips: '48215' }] },
    };
    const early = estimatePreset(spec, ctx({ unitsUsedThisPeriod: 0 }));

    expect(early.cells).toBe(1);
    expect(early.typeSearches).toBe(6);
    expect(early.requestsHi).toBe(54);
    expect(early.costMicroUsdHi).toBe(0);
    expect(formatUsd(early.costMicroUsdHi)).toBe('$0.00');

    // D-15: the run ceiling is a REQUEST count, 2 x estimate-high. In dollars it would be
    // 2 x $0.00, which stops a free run on its first page.
    expect(RUN_CEILING_MULTIPLIER).toBe(2);
    expect(Math.ceil(RUN_CEILING_MULTIPLIER * early.requestsHi)).toBe(108);

    // Two-sided: the same slice with the allowance spent is 54 x 35,000.
    expect(estimatePreset(spec, ctx(FREE_EXHAUSTED)).costMicroUsdHi).toBe(1_890_000);
  });

  it('the estimate can price a subset of cells', () => {
    const subset = estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED), {
      onlyCells: (c) => c.clusterKey === 'home_services',
    });
    // 17 home-services cells x 6 types x 9.
    expect(subset.cells).toBe(17);
    expect(subset.typeSearches).toBe(102);
    expect(subset.requestsHi).toBe(918);

    // The subset's expected businesses are the home-services share, not the whole preset.
    const whole = estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED));
    expect(subset.expectedResults).toBeLessThan(whole.expectedResults);

    // No filter prices everything: the option is additive, not a changed default.
    expect(estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED), {}).requestsHi).toBe(3978);
  });

  it('cellKey joins cluster and unit with U+0000', () => {
    expect(cellKey('home_services', '48215\u0000McAllen')).toBe(
      'home_services\u000048215\u0000McAllen',
    );
    // And it names the cells expandCells actually produces.
    const [cell] = expandCells(SINGLE_CLUSTER_CITY_SPEC, SEED);
    if (!cell) throw new Error('SINGLE_CLUSTER_CITY_SPEC expanded to no cells');
    expect(cellKey(cell.clusterKey, cell.unitId)).toBe('home_services\u0000' + cell.unitId);
  });

  it('texas multiplier is computed, not a constant', () => {
    const m = texasMultiplier(ctx());

    // Exactly the ratio of the two request counts, not a rounded stand-in for it.
    expect(m).toBe(59436 / 3978);
    expect(Number(m.toFixed(1))).toBe(14.9);

    // Derived from the seeded built-ins, so promoting a city moves it automatically.
    const texas = estimatePreset(builtInSpec(TEXAS_PRESET_KEY, SEED), ctx());
    const baseline = estimatePreset(builtInSpec(RGV_BASELINE_PRESET_KEY, SEED), ctx());
    expect(m).toBe(texas.requestsHi / baseline.requestsHi);

    // 🔴 UI-SPEC's Texas badge carries an illustrative multiplier in its copy table. It is
    // not what the seeded cell lists produce, and it must not be anywhere in the pricing
    // path — a hard-coded multiple stops moving the moment the geography does.
    const dir = nodePath.join('src', 'lib', 'estimate');
    const files = nodeFs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    // Two-sided: a scan that found nothing proves nothing.
    expect(files.length).toBeGreaterThanOrEqual(3);
    const offences: string[] = [];
    for (const file of files) {
      nodeFs
        .readFileSync(nodePath.join(dir, file), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/\b38\b/.test(line)) offences.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('estimate: a city cell apportions from its county', () => {
    // D-09. McAllen holds 5,985 of Hidalgo County's 21,062 all-NAICS outlets, so it takes
    // that share of Hidalgo's 969 home-services outlets: round(969 * 5985 / 21062) = 275.
    const mcallen: PresetSpec = {
      name: 'McAllen, home services',
      clusterKeys: ['home_services'],
      geo: { kind: 'cities', cities: [{ name: 'McAllen', countyFips: '48215' }] },
    };
    const cityCells = expandCells(mcallen, SEED);
    expect(cityCells).toHaveLength(1);
    expect(cityCells[0]?.unitKind).toBe('city');
    expect(cityCells[0]?.expectedOutlets).toBe(275);

    // Positive control: the county itself is a measurement, not an apportionment, and
    // reads straight out of the seed. Without this the 275 could be any arithmetic at all.
    const county: PresetSpec = {
      name: 'Hidalgo County, home services',
      clusterKeys: ['home_services'],
      geo: { kind: 'counties', counties: ['48215'] },
    };
    const countyCells = expandCells(county, SEED);
    expect(countyCells).toHaveLength(1);
    expect(countyCells[0]?.unitKind).toBe('county');
    expect(countyCells[0]?.expectedOutlets).toBe(969);
  });

  it('estimate: a radius cell scales by the square of the radius ratio', () => {
    // Area, not distance. 10 miles against the 25-mile reference is 0.16 of a county:
    // round(969 * 0.16) = 155.
    const tenMiles = expandCells(RADIUS_SPEC, SEED);
    expect(tenMiles).toHaveLength(1);
    expect(tenMiles[0]?.unitKind).toBe('radius');
    expect(tenMiles[0]?.expectedOutlets).toBe(155);

    // A radius is ONE geography unit however wide, so the cell count never moves with it.
    expect(estimatePreset(RADIUS_SPEC, ctx()).cells).toBe(1);

    const at = (radiusMiles: number): number => {
      const geo = RADIUS_SPEC.geo;
      // Narrowing, not a cast: if the shared fixture ever stops being a radius this test
      // fails loudly instead of silently measuring something else.
      if (geo.kind !== 'radius') throw new Error('RADIUS_SPEC.geo is no longer a radius');
      const spec: PresetSpec = { ...RADIUS_SPEC, geo: { ...geo, radiusMiles } };
      return expandCells(spec, SEED)[0]?.expectedOutlets ?? -1;
    };

    // At the reference radius a radius preset is a whole county.
    expect(at(RADIUS_REFERENCE_MILES)).toBe(969);
    // And past it the ratio caps at 1.0 — a radius cannot hold more of a county than the
    // county holds. Without the cap this would be 969 * 4.
    expect(at(2 * RADIUS_REFERENCE_MILES)).toBe(969);
  });

  it('estimate: percent of remaining budget never divides by zero', () => {
    const spentOut = estimatePreset(
      RGV_BASELINE_SPEC,
      ctx({ ...FREE_EXHAUSTED, spentMicroUsd: BigInt(CAP), reservedMicroUsd: 0n }),
    );

    expect(spentOut.remainingMicroUsd).toBe(0n);
    expect(spentOut.costMicroUsdHi).toBeGreaterThan(0);
    expect(spentOut.pctOfRemainingHi).toBe(100);
    expect(Number.isFinite(spentOut.pctOfRemainingHi)).toBe(true);
    expect(Number.isNaN(spentOut.pctOfRemainingHi)).toBe(false);
    expect(Number.isNaN(spentOut.pctOfRemainingLo)).toBe(false);

    // The other side of the same guard: a free estimate against a spent-out cap consumes
    // none of what is left, so it is 0 and not 100. A blanket "return 100 when remaining
    // is zero" would pass the assertion above and fail this one. (The RGV counties, 936
    // requests: since D-18 the 3,978-request city baseline no longer fits the free 1,000.)
    const freeAtSpentOutCap = estimatePreset(
      RGV_COUNTIES_SPEC,
      ctx({ unitsUsedThisPeriod: 0, spentMicroUsd: BigInt(CAP) }),
    );
    expect(freeAtSpentOutCap.costMicroUsdHi).toBe(0);
    expect(freeAtSpentOutCap.pctOfRemainingHi).toBe(0);

    // A normal estimate still produces a real percentage.
    const normal = estimatePreset(RGV_BASELINE_SPEC, ctx(FREE_EXHAUSTED));
    expect(normal.pctOfRemainingHi).toBeCloseTo((100 * 139_230_000) / CAP, 10);
  });

  it('estimate: an unseeded cluster-geography pair throws rather than estimating zero', () => {
    // A county that is in no seed file at all.
    expect(() =>
      expandCells(
        {
          name: 'nowhere',
          clusterKeys: ['home_services'],
          geo: { kind: 'counties', counties: ['48999'] },
        },
        SEED,
      ),
    ).toThrow(/no seeded county for FIPS "48999"/);

    // A city spelled a way the seed does not carry.
    expect(() =>
      expandCells(
        {
          name: 'not a seeded city',
          clusterKeys: ['home_services'],
          geo: { kind: 'cities', cities: [{ name: 'Mcallen', countyFips: '48215' }] },
        },
        SEED,
      ),
    ).toThrow(/no seeded city "Mcallen"/);

    // A cluster with neither a county row nor a statewide row to apportion from. Built by
    // removing every home_services row from a copy of the seed, which is the shape a
    // half-refreshed outlet-counts.json would have.
    const gapped: SeedTables = {
      ...SEED,
      outletCounts: {
        ...outletCounts,
        outletCounts: outletCounts.outletCounts.filter((r) => r.clusterKey !== 'home_services'),
      },
    };
    expect(() =>
      expandCells(
        {
          name: 'gapped cluster',
          clusterKeys: ['home_services'],
          geo: { kind: 'counties', counties: ['48215'] },
        },
        gapped,
      ),
    ).toThrow(/no seeded outlet count for cluster "home_services"/);

    // Positive control: the same shapes against the real seed do not throw. Without this,
    // an `expandCells` that threw unconditionally would pass every assertion above.
    expect(() => expandCells(SINGLE_CLUSTER_CITY_SPEC, SEED)).not.toThrow();
    expect(() => expandCells(RGV_COUNTIES_SPEC, SEED)).not.toThrow();
  });

  it('assumptions: the caveat names the under-count the numbers cannot show', () => {
    // The permit-holder-vs-Places gap danlo has to hold in his head when he reads
    // "expected businesses". It is printed verbatim in the assumptions drawer.
    expect(ASSUMPTIONS_CAVEAT).toContain('15,977');
    expect(ASSUMPTIONS_CAVEAT).toContain('977');
    expect(ASSUMPTIONS_CAVEAT).toContain('permit-holder count');
  });
});
