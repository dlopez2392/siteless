/**
 * PLACE-04 / D-16 / D-18 on the preset page: the three cost lines, computed on the server by the
 * same planner `queueRun` admits with.
 *
 *   - the partition line prices ONLY this ISO week's cells (`cellsForRun(…, 'partition', now)`
 *     → `estimatePreset(…, { onlyCells })`), never the whole preset;
 *   - the week is the RGV's week: one instant, two zones, two different partitions. The suite
 *     runs in UTC (vitest.config.ts line 1); America/Chicago appears only as half a pair;
 *   - the change check is $0.00 over every cell.
 *
 * Everything runs over the REAL committed seed, never a hand-typed geography.
 */
import { describe, expect, it } from 'vitest';

import { presetRunCosts } from '@/components/preset-detail/run-costs';
import {
  builtInSpec,
  estimatePreset,
  RGV_BASELINE_PRESET_KEY,
  type EstimateContext,
} from '@/lib/estimate/estimate';
import { cellKey, type PresetSpec, type SeedTables } from '@/lib/estimate/expand-cells';
import { isoWeekOf } from '@/lib/places/partition';
import { cellsForRun } from '@/lib/places/plan-run';
import { APP_TZ } from '@/lib/time';
import {
  PRESET_COST_CHECK,
  PRESET_COST_FULL,
  PRESET_COST_NOT_PRICED,
  PRESET_COST_PARTITION,
} from '@/lib/ui/copy';
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

const cities: CitiesFile = citiesJson;
const clusters: ClustersFile = clustersJson;
const counties: CountiesFile = countiesJson;
const outletCounts: OutletCountsFile = outletCountsJson;
const geoPresets: GeoPresetsFile = geoPresetsJson;
const SEED: SeedTables = { cities, clusters, counties, outletCounts, geoPresets };

const RGV = builtInSpec(RGV_BASELINE_PRESET_KEY, SEED);

/** Early in the month: the free allowance is untouched and the $50 cap is whole. */
const CTX: EstimateContext = {
  seed: SEED,
  unitsUsedThisPeriod: 0,
  capMicroUsd: 50_000_000n,
  spentMicroUsd: 0n,
  reservedMicroUsd: 0n,
};

/** Monday noon in the RGV (CDT, UTC−5). */
const NOW = new Date('2026-09-28T17:00:00Z');
/** Sunday 23:30 in the RGV — already Monday 04:30 of the NEXT week in UTC. */
const SUNDAY_2330_CHICAGO = new Date('2026-10-05T04:30:00Z');

describe('preset run costs', () => {
  it("the partition cost line prices only this week's cells", () => {
    const costs = presetRunCosts(RGV, CTX, NOW);

    const planned = cellsForRun(RGV, SEED, 'partition', NOW);
    const keys = new Set(planned.cells.map((c) => cellKey(c.clusterKey, c.unitId)));
    const want = estimatePreset(RGV, CTX, {
      onlyCells: (c) => keys.has(cellKey(c.clusterKey, c.unitId)),
    });
    const full = estimatePreset(RGV, CTX);
    const week = isoWeekOf(NOW, APP_TZ);

    expect(costs.partition).toEqual({
      index: planned.partitionIndex,
      isoWeek: week.isoWeek,
      mondayIso: week.mondayIso,
      sundayIso: week.sundayIso,
      cells: planned.cells.length,
      totalCells: 68,
    });
    // A strict subset: a partition priced as the whole preset is the defect this pins.
    expect(planned.cells.length).toBeGreaterThan(0);
    expect(planned.cells.length).toBeLessThan(68);
    expect(costs.ranges.partition?.requestsHi).toBe(want.requestsHi);
    expect(costs.ranges.partition!.requestsHi).toBeLessThan(full.requestsHi);

    expect(costs.lines.partition).toBe(
      PRESET_COST_PARTITION(
        want.costMicroUsdLo,
        want.costMicroUsdHi,
        want.requestsHi,
        planned.cells.length,
        68,
        week.isoWeek,
      ),
    );
    expect(costs.lines.full).toBe(
      PRESET_COST_FULL(full.costMicroUsdLo, full.costMicroUsdHi, full.requestsHi),
    );
    // D-18: the full RGV sweep is honestly more than the whole $50 cap, and the line says so
    // in dollars rather than hiding it.
    expect(full.costMicroUsdHi).toBeGreaterThan(50_000_000);
    // The change check covers every cell, at $0.00.
    expect(costs.lines.check).toBe(PRESET_COST_CHECK(full.requestsHi));
  });

  it("the partition is the RGV's week, not the server's", () => {
    const chicago = presetRunCosts(RGV, CTX, SUNDAY_2330_CHICAGO);
    const utc = presetRunCosts(RGV, CTX, SUNDAY_2330_CHICAGO, 'UTC');

    // Sunday night in the RGV is still week 40 (Sep 28 – Oct 4); in UTC it is already week 41.
    expect(chicago.partition?.isoWeek).toBe(40);
    expect(chicago.partition?.mondayIso).toBe('2026-09-28');
    expect(utc.partition?.isoWeek).toBe(41);
    expect(chicago.partition?.index).not.toBe(utc.partition?.index);
  });

  it('a preset that cannot be expanded reads not priced everywhere', () => {
    const broken: PresetSpec = {
      name: 'Nowhere',
      clusterKeys: ['home_services'],
      geo: { kind: 'cities', cities: [{ name: 'Atlantis', countyFips: '48999' }] },
    };
    const costs = presetRunCosts(broken, CTX, NOW);
    expect(costs.lines).toEqual({
      full: PRESET_COST_NOT_PRICED,
      partition: PRESET_COST_NOT_PRICED,
      check: PRESET_COST_NOT_PRICED,
    });
    expect(costs.partition).toBeNull();
    expect(costs.ranges).toEqual({ full: null, partition: null });

    expect(presetRunCosts(null, CTX, NOW).partition).toBeNull();
  });
});
