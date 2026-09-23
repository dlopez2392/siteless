/**
 * The Places quadtree: which rectangles a sweep searches, when a search is saturated, and when a
 * branch stops.
 *
 * Claude's Discretion (04-CONTEXT) — recommended design 04-RESEARCH Pattern 5.
 * Constants are committed and tuned on the D-04 run; changing one reds a named test
 * (`tests/unit/tiling.test.ts`).
 *
 * 🔴 PURE. No I/O, no database, no fetch, no clock. Geo shapes are PASSED IN (the committed
 * TIGERweb seed `src/seed/data/geo-shapes.json`, or a radius circle), so the workflow's queue
 * and every test can drive this without a network.
 *
 * WHY THE FLOORS ARE THE LOAD-BEARING PART (Pitfall 4). With
 * `includePureServiceAreaBusinesses: true`, a city-wide service-area population can come back in
 * EVERY sub-tile — the quadtree never gets under 60 on its own. Three committed floors end each
 * branch: depth, minimum tile side, and a novelty rule (a saturated child whose ids are mostly its
 * parent's is not finding anything new). A branch ended by a floor is TRUNCATED, and truncation is
 * counted and reported (criterion 3) — never silent. The per-run request ceiling (04-16) is the
 * final wall behind all three.
 *
 * WHY POLYGON PRUNING (Pitfall 7, Matamoros). A unit's root tile is its bbox, and the bbox covers
 * ground the unit does not: Brownsville's reaches Matamoros, McAllen's overlaps Pharr and
 * Edinburg. A child rectangle that does not touch the unit's polygon (or radius circle) is never
 * searched — that is what stops cross-border and cross-city double-billing.
 *
 * 🔴 U+0000 NEVER REACHES THE DATABASE. Unit ids use the `expand-cells` separator U+0000
 * (`'48215\u0000McAllen'`), which Postgres `text` and `jsonb` cannot hold. Every key that is
 * persisted goes through `dbSafe()`; only `unitId` stays raw, because it is the in-memory
 * partition-hash input.
 */
import { EARTH_RADIUS_M, distanceMeters } from '@/lib/resolve/score';

// ─── Types ──────────────────────────────────────────────────────────────────────────────────

export type Rect = { south: number; west: number; north: number; east: number };

/** What a search is pruned against — a reference, serializable into a workflow step. */
export type ShapeRef =
  | { kind: 'polygon'; unitKind: 'city' | 'county'; unitId: string }
  | { kind: 'circle'; lat: number; lng: number; radiusM: number };

/** A resolved shape. Rings are `[ring][point][lng, lat]`, outer rings only. */
export type UnitShape =
  | { kind: 'polygon'; bbox: Rect; rings: number[][][] }
  | { kind: 'circle'; bbox: Rect; lat: number; lng: number; radiusM: number };

export type TileSpec = {
  /** `tileKeyOf(...)` — DB-safe. */
  tileKey: string;
  /** `dbSafe(clusterKey + '\u0000' + unitId)` — DB-safe. */
  cellKey: string;
  clusterKey: string;
  unitKind: 'city' | 'county' | 'radius';
  /** RAW — may carry U+0000. Never persist it as-is. */
  unitId: string;
  placesType: string;
  /** `'r'` at the root, then one digit 0–3 per level: `'r'`, `'r2'`, `'r21'`. */
  quadPath: string;
  depth: number;
  rect: Rect;
  parentTileKey: string | null;
  kind: 'enterprise' | 'ids_only';
  shape: ShapeRef;
};

/** One unit in the committed seed `src/seed/data/geo-shapes.json`. */
export type GeoShapeUnit = {
  unitKind: 'city' | 'county';
  /** city: `countyFips + '\u0000' + name`; county: the FIPS. */
  unitId: string;
  geoid: string;
  name: string;
  bbox: Rect;
  rings: number[][][];
};

/** The committed seed `src/seed/data/geo-shapes.json` (written by `scripts/fetch-geo-shapes.ts`). */
export type GeoShapesFile = {
  source: string;
  fetchedAt: string;
  geometryPrecision: number;
  maxAllowableOffset?: number;
  units: GeoShapeUnit[];
};

export type Next =
  | { action: 'done' }
  | { action: 'subdivide'; children: TileSpec[] }
  | { action: 'truncate'; why: 'max_depth' | 'min_size' | 'novelty' };

// ─── Committed constants ────────────────────────────────────────────────────────────────────

/**
 * Text Search (New) returns at most 60 results across all pages ("although this limit is
 * subject to change" — 04-RESEARCH Pattern 4). A search that returned EXACTLY this many may
 * have been cut off, so it is saturated. Not ≥ 20: a full first page is not saturation.
 */
export const SATURATION_RESULTS = 60;
/** `pageSize` maximum. */
export const PAGE_SIZE = 20;
/** SATURATION_RESULTS / PAGE_SIZE. */
export const MAX_PAGES = 3;

/** Deepest level searched, from the unit root (depth 0). At 5 the absolute ceiling per
 *  (type × unit) is 4^6 − 1 = 4,095 tiles — which is why the run ceiling is the final wall. */
export const MAX_DEPTH = 5;
/** A tile whose CHILDREN would be narrower than this on either side is not split. */
export const MIN_TILE_SIDE_M = 500;
/** A saturated tile whose place-id set is at least this share of its parent's is finding
 *  nothing new (the service-area pattern) and is not split further. */
export const NOVELTY_MAX_OVERLAP = 0.75;

/** Metres per degree of latitude, for tile sizing (not for distances — those are haversine). */
const M_PER_DEG_LAT = 111_320;

// ─── Keys ───────────────────────────────────────────────────────────────────────────────────

/** U+0000 → `/`. Postgres `text` and `jsonb` cannot hold U+0000. */
export function dbSafe(s: string): string {
  return s.replaceAll('\u0000', '/');
}

export function tileKeyOf(
  unitKind: TileSpec['unitKind'],
  unitId: string,
  placesType: string,
  quadPath: string,
): string {
  return `${unitKind}:${dbSafe(unitId)}|${placesType}|${quadPath}`;
}

// ─── Saturation ─────────────────────────────────────────────────────────────────────────────

export function isSaturated(resultsCount: number): boolean {
  return resultsCount === SATURATION_RESULTS;
}

// ─── Geometry ───────────────────────────────────────────────────────────────────────────────

/** 0 SW, 1 SE, 2 NW, 3 NE, split at the midpoints. Shared edges are the SAME float, so the
 *  children partition the parent exactly (boundary places are deduped by place_id per run). */
export function quadrants(r: Rect): [Rect, Rect, Rect, Rect] {
  const midLat = (r.south + r.north) / 2;
  const midLng = (r.west + r.east) / 2;
  return [
    { south: r.south, west: r.west, north: midLat, east: midLng },
    { south: r.south, west: midLng, north: midLat, east: r.east },
    { south: midLat, west: r.west, north: r.north, east: midLng },
    { south: midLat, west: midLng, north: r.north, east: r.east },
  ];
}

export function rectSidesM(r: Rect): { heightM: number; widthM: number } {
  const midLatRad = (((r.south + r.north) / 2) * Math.PI) / 180;
  return {
    heightM: (r.north - r.south) * M_PER_DEG_LAT,
    widthM: (r.east - r.west) * M_PER_DEG_LAT * Math.cos(midLatRad),
  };
}

/** The bounding square of a radius circle, on the same sphere as `distanceMeters`, so the
 *  square always contains the circle (its edge midpoints are exactly `radiusM` away). */
export function circleBbox(lat: number, lng: number, radiusM: number): Rect {
  const angular = radiusM / EARTH_RADIUS_M;
  const dLat = (angular * 180) / Math.PI;
  const latRad = (lat * Math.PI) / 180;
  const s = Math.min(1, Math.sin(angular) / Math.cos(latRad));
  const dLng = (Math.asin(s) * 180) / Math.PI;
  return { south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.south <= b.north && b.south <= a.north && a.west <= b.east && b.west <= a.east;
}

function pointInRect(lng: number, lat: number, r: Rect): boolean {
  return lat >= r.south && lat <= r.north && lng >= r.west && lng <= r.east;
}

/** Ray casting. Holes are not carried (the seed keeps outer rings only). */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Segments p1p2 and q1q2 cross or touch. Touching counts: a tile on the boundary is
 *  searched, never skipped (the conservative direction). */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number],
): boolean {
  const d1 = orient(q1[0], q1[1], q2[0], q2[1], p1[0], p1[1]);
  const d2 = orient(q1[0], q1[1], q2[0], q2[1], p2[0], p2[1]);
  const d3 = orient(p1[0], p1[1], p2[0], p2[1], q1[0], q1[1]);
  const d4 = orient(p1[0], p1[1], p2[0], p2[1], q2[0], q2[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (a: [number, number], b: [number, number], c: [number, number]) =>
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1]);
  return (
    (d1 === 0 && onSeg(q1, q2, p1)) ||
    (d2 === 0 && onSeg(q1, q2, p2)) ||
    (d3 === 0 && onSeg(p1, p2, q1)) ||
    (d4 === 0 && onSeg(p1, p2, q2))
  );
}

/**
 * Polygon: any ring vertex inside `r`, OR any corner of `r` inside a ring (ray casting, holes
 * ignored), OR any ring edge crossing an edge of `r`.
 * Circle: the nearest point of `r` to the centre is within the radius (haversine, the repo's
 * `distanceMeters`).
 */
export function rectIntersectsShape(r: Rect, s: UnitShape): boolean {
  if (!rectsOverlap(r, s.bbox)) return false;
  if (s.kind === 'circle') {
    const lat = Math.min(r.north, Math.max(r.south, s.lat));
    const lng = Math.min(r.east, Math.max(r.west, s.lng));
    return distanceMeters(s.lat, s.lng, lat, lng) <= s.radiusM;
  }
  const corners: [number, number][] = [
    [r.west, r.south],
    [r.east, r.south],
    [r.east, r.north],
    [r.west, r.north],
  ];
  for (const ring of s.rings) {
    for (const p of ring) {
      if (pointInRect(p[0] as number, p[1] as number, r)) return true;
    }
    for (const [lng, lat] of corners) {
      if (pointInRing(lng, lat, ring)) return true;
    }
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i] as [number, number];
      const b = ring[i + 1] as [number, number];
      for (let k = 0; k < 4; k += 1) {
        if (segmentsIntersect(a, b, corners[k]!, corners[(k + 1) % 4]!)) return true;
      }
    }
  }
  return false;
}

export function shapeFor(ref: ShapeRef, file: GeoShapesFile): UnitShape {
  if (ref.kind === 'circle') {
    return {
      kind: 'circle',
      bbox: circleBbox(ref.lat, ref.lng, ref.radiusM),
      lat: ref.lat,
      lng: ref.lng,
      radiusM: ref.radiusM,
    };
  }
  const unit = file.units.find((u) => u.unitKind === ref.unitKind && u.unitId === ref.unitId);
  if (!unit || unit.rings.length === 0) {
    // dbSafe: an error message can land in a log or a failure event; keep U+0000 out of it.
    throw new Error(`tiling: no geo shape for ${ref.unitKind} ${dbSafe(ref.unitId)}`);
  }
  return { kind: 'polygon', bbox: unit.bbox, rings: unit.rings };
}

// ─── The tree ───────────────────────────────────────────────────────────────────────────────

export function rootSpec(a: {
  clusterKey: string;
  unitKind: TileSpec['unitKind'];
  unitId: string;
  placesType: string;
  kind: TileSpec['kind'];
  shape: ShapeRef;
  bbox: Rect;
}): TileSpec {
  return {
    tileKey: tileKeyOf(a.unitKind, a.unitId, a.placesType, 'r'),
    cellKey: dbSafe(a.clusterKey + '\u0000' + a.unitId),
    clusterKey: a.clusterKey,
    unitKind: a.unitKind,
    unitId: a.unitId,
    placesType: a.placesType,
    quadPath: 'r',
    depth: 0,
    rect: a.bbox,
    parentTileKey: null,
    kind: a.kind,
    shape: a.shape,
  };
}

/**
 * Order: not saturated → done; at MAX_DEPTH → truncate; children under MIN_TILE_SIDE_M →
 * truncate; overlap with the parent ≥ NOVELTY_MAX_OVERLAP → truncate; else subdivide into the
 * quadrants that touch the unit's shape. If every quadrant is pruned the result is `done`: the
 * saturated tile's area outside the unit is not ours to search.
 */
export function decideSubdivision(
  spec: TileSpec,
  obs: { resultsCount: number; overlapWithParent: number | null },
  shape: UnitShape,
): Next {
  if (!isSaturated(obs.resultsCount)) return { action: 'done' };
  if (spec.depth >= MAX_DEPTH) return { action: 'truncate', why: 'max_depth' };
  const { heightM, widthM } = rectSidesM(spec.rect);
  if (Math.min(heightM, widthM) / 2 < MIN_TILE_SIDE_M) {
    return { action: 'truncate', why: 'min_size' };
  }
  if (obs.overlapWithParent !== null && obs.overlapWithParent >= NOVELTY_MAX_OVERLAP) {
    return { action: 'truncate', why: 'novelty' };
  }
  const children: TileSpec[] = [];
  quadrants(spec.rect).forEach((rect, digit) => {
    if (!rectIntersectsShape(rect, shape)) return;
    const quadPath = spec.quadPath + String(digit);
    children.push({
      ...spec,
      tileKey: tileKeyOf(spec.unitKind, spec.unitId, spec.placesType, quadPath),
      quadPath,
      depth: spec.depth + 1,
      rect,
      parentTileKey: spec.tileKey,
    });
  });
  return children.length === 0 ? { action: 'done' } : { action: 'subdivide', children };
}
