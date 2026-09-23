/**
 * D-16. Admission (queue-run) and execution (beginRun) call the same function, so the price
 * danlo confirms and the searches the workflow runs are the same list.
 *
 * A run is one of three scopes over a preset version's cells:
 *   - `full_sweep`   — every cell, one Enterprise root search per (cell × Places type).
 *   - `partition`    — only the cells whose FNV-1a partition is this week's index in the app's
 *                      zone (PLACE-04); four consecutive weeks cover every cell exactly once.
 *   - `change_check` — every cell, as `ids_only` roots (Text Search Essentials). The step
 *                      (04-22) swaps in the known leaves from `place_tiles`; this module only
 *                      plans the roots.
 *
 * Every root is the unit's whole bbox at `quadPath 'r'` — a tile the quadtree can subdivide
 * (PLACE-03, `src/lib/places/tiling.ts`).
 *
 * 🔴 PURE. No database, no fetch, no clock: `now`, the seed tables and the geo shapes are all
 * passed in, so the admission estimate and the executed plan are the same arithmetic.
 *
 * 🔴 T-4-02. A unit with no committed outline is NAMED AND REFUSED, never tiled from a guess:
 * without a polygon there is nothing to prune children against, and a bbox-only sweep of a
 * county would bill for its neighbours. The Texas preset is 254 counties and the seed has
 * outlines for four of them.
 *
 * 🔴 T-4-10. The Places type list comes from the committed seed (`clusters.json`, via
 * `placesTypesFor`), never from the `industry_terms` table — a database seeded before 04-04
 * still holds a stale `general_contractor` places_type row there (the seed upsert never
 * deletes), and `general_contractor` is Table B, which Google refuses in a request. Every type
 * is filtered through `isTableAType` as defence in depth. Keys are DB-safe via `rootSpec`
 * (`dbSafe`: U+0000 → `/`); only `unitId` stays raw, because it is the partition-hash input.
 */
import {
  cellKey,
  expandCells,
  placesTypesFor,
  type Cell,
  type PresetSpec,
  type SeedTables,
} from '@/lib/estimate/expand-cells';
import { currentPartition, partitionOf } from '@/lib/places/partition';
import { isTableAType } from '@/lib/places/place-types';
import {
  rootSpec,
  shapeFor,
  type GeoShapesFile,
  type ShapeRef,
  type TileSpec,
} from '@/lib/places/tiling';

export type RunKind = 'full_sweep' | 'partition' | 'change_check';

/** Statute mile in metres (exact, by definition). */
const METERS_PER_MILE = 1609.344;

/**
 * The cells a run of `kind` covers at `now`.
 *
 * `timeZone` is forwarded to `currentPartition` untouched, so omitting it takes that module's
 * APP_TZ default — this file never names a zone of its own. It exists as a parameter only so
 * the discriminating pair in tests/unit/plan-run.test.ts is expressible.
 */
export function cellsForRun(
  spec: PresetSpec,
  seed: SeedTables,
  kind: RunKind,
  now: Date,
  timeZone?: string,
): { cells: Cell[]; partitionIndex: number | null; totalCells: number } {
  const all = expandCells(spec, seed);
  if (kind !== 'partition') {
    return { cells: all, partitionIndex: null, totalCells: all.length };
  }
  const partitionIndex = currentPartition(now, timeZone);
  // The partition is a hash of the cell KEY (the raw expand-cells key, U+0000 and all), never
  // its position in the list — adding a city cannot move an existing cell to another week.
  const cells = all.filter((c) => partitionOf(cellKey(c.clusterKey, c.unitId)) === partitionIndex);
  return { cells, partitionIndex, totalCells: all.length };
}

/** City / county → a reference to its committed polygon; radius → the preset's own circle. */
export function unitShapeRef(cell: Cell, spec: PresetSpec): ShapeRef {
  if (cell.unitKind === 'radius') {
    if (spec.geo.kind !== 'radius') {
      throw new Error(
        `unitShapeRef: a radius cell needs a radius preset, got geo kind "${spec.geo.kind}"`,
      );
    }
    return {
      kind: 'circle',
      lat: spec.geo.lat,
      lng: spec.geo.lng,
      radiusM: spec.geo.radiusMiles * METERS_PER_MILE,
    };
  }
  return { kind: 'polygon', unitKind: cell.unitKind, unitId: cell.unitId };
}

/** A unit as a human reads it: a city by its name, a county by its FIPS. */
function unitName(cell: Cell): string {
  if (cell.unitKind === 'city') {
    // unitId is `countyFips + U+0000 + name`; the name is what an operator recognises.
    const sep = cell.unitId.indexOf('\u0000');
    return sep >= 0 ? cell.unitId.slice(sep + 1) : cell.unitId;
  }
  return `${cell.unitKind} ${cell.unitId}`;
}

/**
 * The units among `cells` with no usable committed geometry — no shape in the seed, or a shape
 * with no rings (which `shapeFor` would refuse anyway). Each unit named once, in cell order,
 * however many clusters it carries. A radius is its own geometry and is never missing.
 */
export function missingGeometry(cells: Cell[], spec: PresetSpec, shapes: GeoShapesFile): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const ref = unitShapeRef(cell, spec);
    if (ref.kind === 'circle') continue;
    const unitKey = `${ref.unitKind}:${ref.unitId}`;
    if (seen.has(unitKey)) continue;
    seen.add(unitKey);
    const unit = shapes.units.find((u) => u.unitKind === ref.unitKind && u.unitId === ref.unitId);
    if (!unit || unit.rings.length === 0) names.push(unitName(cell));
  }
  return names;
}

/**
 * The root searches a run executes: one per (cell × Table A Places type), rooted at the unit's
 * bbox (polygon) or the circle's bounding square (radius). `ids_only` for a change check,
 * `enterprise` otherwise. Throws naming every unit that has no geometry.
 */
export function planRootSearches(a: {
  spec: PresetSpec;
  seed: SeedTables;
  shapes: GeoShapesFile;
  kind: RunKind;
  now: Date;
  timeZone?: string;
}): TileSpec[] {
  const { cells } = cellsForRun(a.spec, a.seed, a.kind, a.now, a.timeZone);

  const missing = missingGeometry(cells, a.spec, a.shapes);
  if (missing.length > 0) {
    throw new Error('planRootSearches: no geometry for ' + missing.join(', '));
  }

  const searchKind: TileSpec['kind'] = a.kind === 'change_check' ? 'ids_only' : 'enterprise';
  const roots: TileSpec[] = [];
  for (const cell of cells) {
    const shape = unitShapeRef(cell, a.spec);
    const { bbox } = shapeFor(shape, a.shapes);
    for (const placesType of placesTypesFor(cell.clusterKey, a.seed)) {
      if (!isTableAType(placesType)) continue;
      roots.push(
        rootSpec({
          clusterKey: cell.clusterKey,
          unitKind: cell.unitKind,
          unitId: cell.unitId,
          placesType,
          kind: searchKind,
          shape,
          bbox,
        }),
      );
    }
  }
  return roots;
}
