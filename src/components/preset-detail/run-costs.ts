import type { RunPartition } from '@/components/preset-detail/run-drawer';
import { estimatePreset, type EstimateContext, type EstimateRange } from '@/lib/estimate/estimate';
import { cellKey, type PresetSpec } from '@/lib/estimate/expand-cells';
import { isoWeekOf } from '@/lib/places/partition';
import { cellsForRun } from '@/lib/places/plan-run';
import {
  PRESET_COST_CHECK,
  PRESET_COST_FULL,
  PRESET_COST_NOT_PRICED,
  PRESET_COST_PARTITION,
} from '@/lib/ui/copy';

/**
 * The preset page's three cost lines (04-UI-SPEC § Screen 2), priced on the server by the SAME
 * planner `queueRun` admits with — so the line on the button and the hold the drawer takes come
 * from one function over one set of cells.
 *
 *   - Full sweep: `estimatePreset(spec, ctx)` over every cell.
 *   - Partition: `cellsForRun(spec, seed, 'partition', now)` picks this ISO week's cells, and
 *     `estimatePreset(…, { onlyCells })` prices ONLY those (PLACE-04). Cells carry no id, so
 *     membership is by `cellKey`, never by object identity.
 *   - Change check: every cell, IDs-only, $0.00 — its request count is the full sweep's top.
 *
 * 🔴 THE WEEK IS THE RGV's. `timeZone` is forwarded untouched to `cellsForRun` and `isoWeekOf`,
 * both of which default to APP_TZ; it is a parameter only so a test can hold one instant in two
 * zones. The page passes nothing.
 *
 * Server-safe (no client-boundary directive). The `RunPartition` import is a type and is erased.
 */
export type PresetRunCosts = {
  lines: { full: string; partition: string; check: string };
  /** `null` when the preset cannot be expanded into cells. */
  partition: RunPartition | null;
  ranges: { full: EstimateRange | null; partition: EstimateRange | null };
};

const NOT_PRICED: PresetRunCosts = {
  lines: {
    full: PRESET_COST_NOT_PRICED,
    partition: PRESET_COST_NOT_PRICED,
    check: PRESET_COST_NOT_PRICED,
  },
  partition: null,
  ranges: { full: null, partition: null },
};

export function presetRunCosts(
  spec: PresetSpec | null,
  ctx: EstimateContext,
  now: Date,
  timeZone?: string,
): PresetRunCosts {
  if (!spec) return NOT_PRICED;
  try {
    const full = estimatePreset(spec, ctx);
    const planned = cellsForRun(spec, ctx.seed, 'partition', now, timeZone);
    const keys = new Set(planned.cells.map((c) => cellKey(c.clusterKey, c.unitId)));
    const part = estimatePreset(spec, ctx, {
      onlyCells: (c) => keys.has(cellKey(c.clusterKey, c.unitId)),
    });
    const week = isoWeekOf(now, timeZone);
    return {
      lines: {
        full: PRESET_COST_FULL(full.costMicroUsdLo, full.costMicroUsdHi, full.requestsHi),
        partition: PRESET_COST_PARTITION(
          part.costMicroUsdLo,
          part.costMicroUsdHi,
          part.requestsHi,
          planned.cells.length,
          planned.totalCells,
          week.isoWeek,
        ),
        check: PRESET_COST_CHECK(full.requestsHi),
      },
      partition: {
        index: planned.partitionIndex ?? 0,
        isoWeek: week.isoWeek,
        mondayIso: week.mondayIso,
        sundayIso: week.sundayIso,
        cells: planned.cells.length,
        totalCells: planned.totalCells,
      },
      ranges: { full, partition: part },
    };
  } catch {
    // The estimator and the cell expander throw when a (cluster, geography) pair has no seeded
    // outlet count. A preset that cannot be priced is still one you can read and edit.
    return NOT_PRICED;
  }
}
