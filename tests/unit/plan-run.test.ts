/**
 * D-16 / PLACE-04 / PLACE-03. One pure function turns a preset version + run kind + instant
 * into the root searches a run executes. Admission (queue-run, 04-26) prices it and execution
 * (beginRun, 04-22) plans from it, so these tests pin the scope both sides will agree on.
 *
 * Everything here runs over the REAL committed seed (`src/seed/data/*.json`) — the 17 cities,
 * 254 counties, 26 Places types and 21 geo shapes — never a hand-typed geography.
 *
 * 🔴 The suite runs TZ=UTC (vitest.config.ts line 1) because this dev machine IS Chicago.
 * America/Chicago appears below only ever as HALF a pair: one instant, two zones, opposite
 * verdicts.
 *
 * Mutations, one named test each (see 04-13-SUMMARY.md):
 *   - the partition filter dropped (every cell kept)      → 'a partition keeps only this week's cells'
 *   - the zone not forwarded / pinned to 'UTC'            → 'a partition is the same all week'
 *   - change_check planned as enterprise                  → 'a change check plans ids-only roots'
 *   - radius converted with 1000 m per mile               → 'a radius unit is tiled from the preset's circle'
 *   - missingGeometry returns []                          → 'a unit without geometry is named, not guessed'
 *   - the raw U+0000 cellKey on the planned spec          → 'planned keys are Postgres-safe'
 *   - the isTableAType filter dropped                     → 'every planned type is a Table A type'
 */
import { describe, expect, it } from 'vitest';

import { builtInSpec, RGV_BASELINE_PRESET_KEY, TEXAS_PRESET_KEY } from '@/lib/estimate/estimate';
import {
  cellKey,
  placesTypesFor,
  type PresetSpec,
  type SeedTables,
} from '@/lib/estimate/expand-cells';
import { currentPartition, partitionOf } from '@/lib/places/partition';
import { isTableAType } from '@/lib/places/place-types';
import {
  cellsForRun,
  missingGeometry,
  planRootSearches,
  unitShapeRef,
} from '@/lib/places/plan-run';
import { circleBbox, dbSafe, type GeoShapesFile } from '@/lib/places/tiling';
import { APP_TZ } from '@/lib/time';
import citiesJson from '@/seed/data/cities.json';
import clustersJson from '@/seed/data/clusters.json';
import countiesJson from '@/seed/data/counties.json';
import geoPresetsJson from '@/seed/data/geo-presets.json';
import geoShapesJson from '@/seed/data/geo-shapes.json';
import outletCountsJson from '@/seed/data/outlet-counts.json';
import type {
  CitiesFile,
  ClustersFile,
  CountiesFile,
  GeoPresetsFile,
  OutletCountsFile,
} from '@/seed/types';

const cities: CitiesFile = citiesJson;
const clusters: ClustersFile = clustersJson;
const counties: CountiesFile = countiesJson;
const outletCounts: OutletCountsFile = outletCountsJson;
const geoPresets: GeoPresetsFile = geoPresetsJson;
const SHAPES = geoShapesJson as GeoShapesFile;

const SEED: SeedTables = { cities, clusters, counties, outletCounts, geoPresets };

const RGV = builtInSpec(RGV_BASELINE_PRESET_KEY, SEED);
const TEXAS = builtInSpec(TEXAS_PRESET_KEY, SEED);

const MCALLEN_HOME: PresetSpec = {
  name: 'McAllen home services',
  clusterKeys: ['home_services'],
  geo: { kind: 'cities', cities: [{ name: 'McAllen', countyFips: '48215' }] },
};

const MCALLEN_UNIT_ID = '48215\u0000McAllen';

const HOME_TYPES = [
  'plumber',
  'electrician',
  'roofing_contractor',
  'painter',
  'locksmith',
  'moving_company',
];

/** Four consecutive Mondays, noon in the RGV (CDT, UTC−5). */
const MONDAYS_NOON_CHICAGO = [
  new Date('2026-09-28T17:00:00Z'),
  new Date('2026-10-05T17:00:00Z'),
  new Date('2026-10-12T17:00:00Z'),
  new Date('2026-10-19T17:00:00Z'),
];

/** Monday 00:30 and Sunday 23:30 in the RGV, the same Chicago week. In UTC the second is
 *  already Monday 04:30 of the NEXT week — that is what makes the pair discriminate. */
const MONDAY_0030_CHICAGO = new Date('2026-09-28T05:30:00Z');
const SUNDAY_2330_CHICAGO = new Date('2026-10-05T04:30:00Z');

const NOW = MONDAYS_NOON_CHICAGO[0]!;

const keysOf = (cs: { clusterKey: string; unitId: string }[]) =>
  cs.map((c) => cellKey(c.clusterKey, c.unitId));

describe('plan-run', () => {
  it('a full sweep plans one root per cell and Places type', () => {
    const roots = planRootSearches({
      spec: MCALLEN_HOME,
      seed: SEED,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    const mcallen = SHAPES.units.find((u) => u.unitKind === 'city' && u.unitId === MCALLEN_UNIT_ID);
    expect(mcallen).toBeDefined();

    expect(roots).toHaveLength(6);
    expect(roots.map((r) => r.tileKey)).toEqual(HOME_TYPES.map((t) => `city:48215/McAllen|${t}|r`));
    expect(roots.map((r) => r.placesType)).toEqual(HOME_TYPES);
    for (const r of roots) {
      expect(r.kind).toBe('enterprise');
      expect(r.rect).toEqual(mcallen!.bbox);
      expect(r.quadPath).toBe('r');
      expect(r.depth).toBe(0);
      expect(r.parentTileKey).toBeNull();
      expect(r.cellKey).toBe('home_services/48215/McAllen');
      expect(r.clusterKey).toBe('home_services');
      expect(r.unitKind).toBe('city');
      expect(r.unitId).toBe(MCALLEN_UNIT_ID);
      expect(r.shape).toEqual({ kind: 'polygon', unitKind: 'city', unitId: MCALLEN_UNIT_ID });
    }

    // Whole preset: 68 cells, 442 type searches (D-18) — one root each.
    const all = planRootSearches({
      spec: RGV,
      seed: SEED,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    const typeSearches = RGV.clusterKeys.reduce(
      (s, k) =>
        s +
        placesTypesFor(k, SEED).length * (RGV.geo.kind === 'cities' ? RGV.geo.cities.length : 0),
      0,
    );
    expect(typeSearches).toBe(442);
    expect(all).toHaveLength(442);
    expect(new Set(all.map((r) => r.tileKey)).size).toBe(442);

    const { cells, partitionIndex, totalCells } = cellsForRun(RGV, SEED, 'full_sweep', NOW);
    expect(cells).toHaveLength(68);
    expect(totalCells).toBe(68);
    expect(partitionIndex).toBeNull();
  });

  it('a change check plans ids-only roots', () => {
    const sweep = planRootSearches({
      spec: MCALLEN_HOME,
      seed: SEED,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    const check = planRootSearches({
      spec: MCALLEN_HOME,
      seed: SEED,
      shapes: SHAPES,
      kind: 'change_check',
      now: NOW,
    });
    expect(check).toHaveLength(6);
    expect(check.every((r) => r.kind === 'ids_only')).toBe(true);
    // Same scope as the sweep — only the SKU differs.
    expect(check.map((r) => r.tileKey)).toEqual(sweep.map((r) => r.tileKey));
    expect(check.map((r) => r.rect)).toEqual(sweep.map((r) => r.rect));

    const { cells, partitionIndex, totalCells } = cellsForRun(RGV, SEED, 'change_check', NOW);
    expect(cells).toHaveLength(68);
    expect(totalCells).toBe(68);
    expect(partitionIndex).toBeNull();
  });

  it("a partition keeps only this week's cells", () => {
    const weeks = MONDAYS_NOON_CHICAGO.map((now) => cellsForRun(RGV, SEED, 'partition', now));

    // Four consecutive weeks visit four distinct partitions.
    expect(new Set(weeks.map((w) => w.partitionIndex))).toEqual(new Set([0, 1, 2, 3]));

    for (const [i, w] of weeks.entries()) {
      expect(w.totalCells).toBe(68);
      expect(w.partitionIndex).toBe(currentPartition(MONDAYS_NOON_CHICAGO[i]!, APP_TZ));
      // Every kept cell hashes to this week's partition.
      for (const k of keysOf(w.cells)) expect(partitionOf(k)).toBe(w.partitionIndex);
      expect(w.cells.length).toBeLessThan(68);
    }

    const sets = weeks.map((w) => new Set(keysOf(w.cells)));
    for (let a = 0; a < sets.length; a += 1) {
      for (let b = a + 1; b < sets.length; b += 1) {
        const overlap = [...sets[a]!].filter((k) => sets[b]!.has(k));
        expect(overlap).toEqual([]);
      }
    }
    const union = new Set(sets.flatMap((s) => [...s]));
    expect(union.size).toBe(68);
    expect(union).toEqual(new Set(keysOf(cellsForRun(RGV, SEED, 'full_sweep', NOW).cells)));

    // The planned roots follow the kept cells, and a partition run is an Enterprise sweep.
    const roots = planRootSearches({
      spec: RGV,
      seed: SEED,
      shapes: SHAPES,
      kind: 'partition',
      now: MONDAYS_NOON_CHICAGO[0]!,
    });
    const keptDbKeys = new Set(keysOf(weeks[0]!.cells).map(dbSafe));
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((r) => keptDbKeys.has(r.cellKey))).toBe(true);
    expect(roots.every((r) => r.kind === 'enterprise')).toBe(true);
    expect(new Set(roots.map((r) => r.cellKey))).toEqual(keptDbKeys);
  });

  it('a partition is the same all week', () => {
    const monday = cellsForRun(RGV, SEED, 'partition', MONDAY_0030_CHICAGO);
    const sunday = cellsForRun(RGV, SEED, 'partition', SUNDAY_2330_CHICAGO);
    expect(monday.partitionIndex).toBe(sunday.partitionIndex);
    expect(keysOf(monday.cells)).toEqual(keysOf(sunday.cells));

    // The default IS the app zone: an explicit APP_TZ gives the same answer.
    const explicit = cellsForRun(RGV, SEED, 'partition', SUNDAY_2330_CHICAGO, APP_TZ);
    expect(explicit.partitionIndex).toBe(sunday.partitionIndex);

    // The other half of the pair: the same two instants read in UTC are two different weeks.
    const mondayUtc = cellsForRun(RGV, SEED, 'partition', MONDAY_0030_CHICAGO, 'UTC');
    const sundayUtc = cellsForRun(RGV, SEED, 'partition', SUNDAY_2330_CHICAGO, 'UTC');
    expect(mondayUtc.partitionIndex).not.toBe(sundayUtc.partitionIndex);
    const mondayUtcKeys = new Set(keysOf(mondayUtc.cells));
    expect(keysOf(sundayUtc.cells).filter((k) => mondayUtcKeys.has(k))).toEqual([]);
  });

  it("a radius unit is tiled from the preset's circle", () => {
    const spec: PresetSpec = {
      name: '5 miles from 26.2034, -98.2300',
      clusterKeys: ['home_services'],
      geo: { kind: 'radius', lat: 26.2034, lng: -98.23, countyFips: '48215', radiusMiles: 5 },
    };
    const radiusM = 5 * 1609.344;
    const roots = planRootSearches({
      spec,
      seed: SEED,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    expect(roots).toHaveLength(6);
    expect(roots.map((r) => r.tileKey)).toEqual(HOME_TYPES.map((t) => `radius:48215/5mi|${t}|r`));
    for (const r of roots) {
      expect(r.unitKind).toBe('radius');
      expect(r.shape).toEqual({ kind: 'circle', lat: 26.2034, lng: -98.23, radiusM });
      expect(r.rect).toEqual(circleBbox(26.2034, -98.23, radiusM));
      const halfHeightDeg = (r.rect.north - r.rect.south) / 2;
      expect(Math.abs(halfHeightDeg - 8047 / 111_320)).toBeLessThan(1e-4);
    }

    const [cell] = cellsForRun(spec, SEED, 'full_sweep', NOW).cells;
    expect(unitShapeRef(cell!, spec)).toEqual({
      kind: 'circle',
      lat: 26.2034,
      lng: -98.23,
      radiusM,
    });
    // A radius is its own geometry — it is never "missing".
    expect(missingGeometry(cellsForRun(spec, SEED, 'full_sweep', NOW).cells, spec, SHAPES)).toEqual(
      [],
    );
  });

  it('a unit without geometry is named, not guessed', () => {
    const cells = cellsForRun(TEXAS, SEED, 'full_sweep', NOW).cells;
    expect(cells).toHaveLength(1016);
    const missing = missingGeometry(cells, TEXAS, SHAPES);

    const firstNonRgv = counties.counties.find((c) => !c.isRgv);
    expect(firstNonRgv).toBeDefined();
    expect(missing).toContain(`county ${firstNonRgv!.fips}`);
    // Named once per unit, never once per cluster; the four RGV counties have outlines.
    expect(missing).toHaveLength(250);
    for (const rgv of counties.counties.filter((c) => c.isRgv)) {
      expect(missing).not.toContain(`county ${rgv.fips}`);
    }

    expect(() =>
      planRootSearches({ spec: TEXAS, seed: SEED, shapes: SHAPES, kind: 'full_sweep', now: NOW }),
    ).toThrow(`planRootSearches: no geometry for county ${firstNonRgv!.fips}`);

    // A city is named by its name, and a shape with no rings is as missing as no shape.
    const hollow: GeoShapesFile = {
      ...SHAPES,
      units: SHAPES.units.map((u) => (u.unitId === MCALLEN_UNIT_ID ? { ...u, rings: [] } : u)),
    };
    const mcCells = cellsForRun(MCALLEN_HOME, SEED, 'full_sweep', NOW).cells;
    expect(missingGeometry(mcCells, MCALLEN_HOME, hollow)).toEqual(['McAllen']);
    expect(missingGeometry(mcCells, MCALLEN_HOME, SHAPES)).toEqual([]);
    expect(() =>
      planRootSearches({
        spec: MCALLEN_HOME,
        seed: SEED,
        shapes: hollow,
        kind: 'full_sweep',
        now: NOW,
      }),
    ).toThrow('planRootSearches: no geometry for McAllen');
  });

  it('planned keys are Postgres-safe', () => {
    const counties4: PresetSpec = {
      name: 'RGV counties',
      clusterKeys: RGV.clusterKeys,
      geo: {
        kind: 'counties',
        counties: counties.counties.filter((c) => c.isRgv).map((c) => c.fips),
      },
    };
    const radius: PresetSpec = {
      name: 'radius',
      clusterKeys: ['food_hospitality'],
      geo: { kind: 'radius', lat: 26.2034, lng: -98.23, countyFips: '48215', radiusMiles: 5 },
    };
    const roots = [RGV, counties4, radius].flatMap((spec) =>
      (['full_sweep', 'change_check'] as const).flatMap((kind) =>
        planRootSearches({ spec, seed: SEED, shapes: SHAPES, kind, now: NOW }),
      ),
    );
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) {
      expect(r.tileKey).not.toContain('\u0000');
      expect(r.cellKey).not.toContain('\u0000');
      expect(r.cellKey).toBe(dbSafe(cellKey(r.clusterKey, r.unitId)));
    }
    // Two-sided: the raw ids really do carry U+0000, so the check above is not vacuous.
    expect(roots.some((r) => r.unitId.includes('\u0000'))).toBe(true);
  });

  it('every planned type is a Table A type', () => {
    // A seed that carries a Table B type — the stale `general_contractor` row an old database
    // may still hold. The planner must drop it, not send it to Google.
    const tainted: SeedTables = {
      ...SEED,
      clusters: {
        ...clusters,
        clusters: clusters.clusters.map((c) =>
          c.key === 'home_services'
            ? { ...c, placesTypes: [...c.placesTypes, 'general_contractor'] }
            : c,
        ),
      },
    };
    // Two-sided: the tainted seed really does offer it.
    expect(placesTypesFor('home_services', tainted)).toContain('general_contractor');
    expect(isTableAType('general_contractor')).toBe(false);

    const roots = planRootSearches({
      spec: MCALLEN_HOME,
      seed: tainted,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    expect(roots.map((r) => r.placesType)).toEqual(HOME_TYPES);

    const all = planRootSearches({
      spec: RGV,
      seed: SEED,
      shapes: SHAPES,
      kind: 'full_sweep',
      now: NOW,
    });
    expect(all.every((r) => isTableAType(r.placesType))).toBe(true);
    expect(new Set(all.map((r) => r.placesType)).size).toBe(26);
  });
});
