/**
 * PLACE-03 / criterion 3 — the Places quadtree (04-RESEARCH § Pattern 5, Pitfalls 4 and 7).
 *
 * A search is saturated iff it returned EXACTLY 60 results (Text Search caps at 60 across three
 * pages of 20). A saturated tile splits 2×2; a child that does not touch the unit's polygon or
 * radius circle is never searched; and three committed floors — depth, size, novelty — end every
 * branch as TRUNCATED, which is reported rather than silent. The floors are the load-bearing part:
 * a city-wide service-area population re-appears in every child, so without them the tree runs to
 * the bottom (Pitfall 4).
 *
 * Pure geometry, no I/O. The one data test reads the committed TIGERweb seed.
 */
import { describe, expect, it } from 'vitest';
import citiesJson from '@/seed/data/cities.json';
import geoShapesJson from '@/seed/data/geo-shapes.json';
import {
  MAX_DEPTH,
  MAX_PAGES,
  MIN_TILE_SIDE_M,
  NOVELTY_MAX_OVERLAP,
  SATURATION_RESULTS,
  circleBbox,
  dbSafe,
  decideSubdivision,
  isSaturated,
  quadrants,
  rectIntersectsShape,
  rectSidesM,
  rootSpec,
  shapeFor,
  tileKeyOf,
  type GeoShapesFile,
  type Rect,
  type ShapeRef,
  type TileSpec,
  type UnitShape,
} from '@/lib/places/tiling';

const geoShapes = geoShapesJson as GeoShapesFile;

const M_PER_DEG_LAT = 111_320;

/** A square of `sideM` metres centred on (lat, lng), measured the way `rectSidesM` measures. */
function squareAround(lat: number, lng: number, sideM: number): Rect {
  const dLat = sideM / M_PER_DEG_LAT / 2;
  const dLng = sideM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)) / 2;
  return { south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng };
}

/** A polygon whose single ring is exactly the rectangle. */
function polygonOf(r: Rect): UnitShape {
  return {
    kind: 'polygon',
    bbox: r,
    rings: [
      [
        [r.west, r.south],
        [r.west, r.north],
        [r.east, r.north],
        [r.east, r.south],
        [r.west, r.south],
      ],
    ],
  };
}

const MCALLEN_ID = '48215\u0000McAllen';
const POLY_REF: ShapeRef = { kind: 'polygon', unitKind: 'city', unitId: MCALLEN_ID };

function specFor(rect: Rect, depth: number, quadPath = 'r'): TileSpec {
  const root = rootSpec({
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId: MCALLEN_ID,
    placesType: 'plumber',
    kind: 'enterprise',
    shape: POLY_REF,
    bbox: rect,
  });
  return {
    ...root,
    depth,
    quadPath,
    tileKey: tileKeyOf('city', MCALLEN_ID, 'plumber', quadPath),
  };
}

/** ~10 km square over McAllen — comfortably above every size floor. */
const BIG = squareAround(26.2, -98.25, 10_000);

describe('saturation', () => {
  it('a 60-result tile is saturated and subdivided', () => {
    expect(SATURATION_RESULTS).toBe(60);
    expect(isSaturated(60)).toBe(true);
    // Exact equality, not `>=`: Text Search never returns more than 60, and a number above it
    // means the contract moved under us — that must not be read as "saturated, keep splitting".
    expect(isSaturated(61)).toBe(false);

    const spec = specFor(BIG, 0);
    const next = decideSubdivision(
      spec,
      { resultsCount: 60, overlapWithParent: null },
      polygonOf(BIG),
    );
    expect(next.action).toBe('subdivide');
    if (next.action !== 'subdivide') return;
    expect(next.children.map((c) => c.quadPath)).toEqual(['r0', 'r1', 'r2', 'r3']);
    for (const child of next.children) {
      expect(child.depth).toBe(1);
      expect(child.parentTileKey).toBe(spec.tileKey);
      expect(child.tileKey).toBe(tileKeyOf('city', MCALLEN_ID, 'plumber', child.quadPath));
      expect(child.cellKey).toBe(spec.cellKey);
      expect(child.kind).toBe('enterprise');
    }
  });

  it('a 59-result tile is not saturated', () => {
    expect(isSaturated(59)).toBe(false);
    expect(isSaturated(20)).toBe(false);
    expect(isSaturated(0)).toBe(false);
    const next = decideSubdivision(
      specFor(BIG, 0),
      { resultsCount: 59, overlapWithParent: null },
      polygonOf(BIG),
    );
    expect(next).toEqual({ action: 'done' });
  });
});

describe('saturation by the last page (B-WR-01)', () => {
  it('a capped search that comes back short on its last page is saturated', () => {
    // Google caps what it RETRIEVES at 60; strictTypeFiltering (and duplicates) can then drop
    // some, so a capped search can report 57 on page 3 with no further token. Page 3 was only
    // asked for because page 2 carried a token: reaching it IS the cap.
    expect(isSaturated(57, 3)).toBe(true);
    expect(isSaturated(41, MAX_PAGES)).toBe(true);
    const next = decideSubdivision(
      specFor(BIG, 0),
      { resultsCount: 57, pagesServed: 3, overlapWithParent: null },
      polygonOf(BIG),
    );
    expect(next.action).toBe('subdivide');
    // Two pages that ran out on their own are not saturation, however full.
    expect(isSaturated(40, 2)).toBe(false);
    expect(
      decideSubdivision(
        specFor(BIG, 0),
        { resultsCount: 40, pagesServed: 2, overlapWithParent: null },
        polygonOf(BIG),
      ),
    ).toEqual({ action: 'done' });
  });
});

describe('termination floors', () => {
  it('truncated at minimum size', () => {
    expect(MIN_TILE_SIDE_M).toBe(500);
    // ~800 m square: its children would be ~400 m, under the 500 m floor.
    const small = squareAround(26.2, -98.25, 800);
    const next = decideSubdivision(
      specFor(small, 1, 'r0'),
      { resultsCount: 60, overlapWithParent: null },
      polygonOf(small),
    );
    expect(next).toEqual({ action: 'truncate', why: 'min_size' });

    // ~1,200 m: children ~600 m are above the floor, so this one still splits.
    const ok = squareAround(26.2, -98.25, 1_200);
    expect(
      decideSubdivision(
        specFor(ok, 1, 'r0'),
        { resultsCount: 60, overlapWithParent: null },
        polygonOf(ok),
      ).action,
    ).toBe('subdivide');
  });

  it('truncated at max depth', () => {
    expect(MAX_DEPTH).toBe(5);
    const next = decideSubdivision(
      specFor(BIG, 5, 'r00000'),
      { resultsCount: 60, overlapWithParent: null },
      polygonOf(BIG),
    );
    expect(next).toEqual({ action: 'truncate', why: 'max_depth' });
    // One level above the floor still splits.
    expect(
      decideSubdivision(
        specFor(BIG, 4, 'r0000'),
        { resultsCount: 60, overlapWithParent: null },
        polygonOf(BIG),
      ).action,
    ).toBe('subdivide');
  });

  it('novelty stops a service-area saturation loop', () => {
    expect(NOVELTY_MAX_OVERLAP).toBe(0.75);
    const spec = specFor(BIG, 2, 'r00');
    const shape = polygonOf(BIG);
    expect(decideSubdivision(spec, { resultsCount: 60, overlapWithParent: 0.8 }, shape)).toEqual({
      action: 'truncate',
      why: 'novelty',
    });
    expect(decideSubdivision(spec, { resultsCount: 60, overlapWithParent: 0.75 }, shape)).toEqual({
      action: 'truncate',
      why: 'novelty',
    });
    expect(
      decideSubdivision(spec, { resultsCount: 60, overlapWithParent: 0.7 }, shape).action,
    ).toBe('subdivide');
    // A root has no parent to compare with.
    expect(
      decideSubdivision(spec, { resultsCount: 60, overlapWithParent: null }, shape).action,
    ).toBe('subdivide');
  });
});

describe('pruning', () => {
  it('a child outside the unit polygon is pruned', () => {
    // A triangle strictly inside the SW quadrant of BIG (the Matamoros / neighbouring-city case:
    // the unit's bbox covers ground the unit does not).
    const midLat = (BIG.south + BIG.north) / 2;
    const midLng = (BIG.west + BIG.east) / 2;
    const e = 0.001;
    const ring = [
      [BIG.west + e, BIG.south + e],
      [midLng - e, BIG.south + e],
      [BIG.west + e, midLat - e],
      [BIG.west + e, BIG.south + e],
    ];
    const triangle: UnitShape = {
      kind: 'polygon',
      bbox: { south: BIG.south + e, west: BIG.west + e, north: midLat - e, east: midLng - e },
      rings: [ring],
    };
    const next = decideSubdivision(
      specFor(BIG, 0),
      { resultsCount: 60, overlapWithParent: null },
      triangle,
    );
    expect(next.action).toBe('subdivide');
    if (next.action !== 'subdivide') return;
    expect(next.children).toHaveLength(1);
    expect(next.children[0]?.quadPath.endsWith('0')).toBe(true);

    // Every rectangle wholly outside the triangle is refused; one containing it is accepted.
    const [sw, se, nw, ne] = quadrants(BIG);
    expect(rectIntersectsShape(sw, triangle)).toBe(true);
    expect(rectIntersectsShape(se, triangle)).toBe(false);
    expect(rectIntersectsShape(nw, triangle)).toBe(false);
    expect(rectIntersectsShape(ne, triangle)).toBe(false);
    // A rectangle wholly inside the polygon (no vertex inside it, no edge crossing) intersects.
    const inner = squareAround(26.2, -98.25, 100);
    expect(rectIntersectsShape(inner, polygonOf(BIG))).toBe(true);
    // A thin polygon crossing a rectangle with no vertex inside it and no corner inside it.
    const cross: UnitShape = {
      kind: 'polygon',
      bbox: {
        south: inner.south - 1,
        west: inner.west + 1e-5,
        north: inner.north + 1,
        east: inner.west + 2e-5,
      },
      rings: [
        [
          [inner.west + 1e-5, inner.south - 1],
          [inner.west + 2e-5, inner.south - 1],
          [inner.west + 2e-5, inner.north + 1],
          [inner.west + 1e-5, inner.north + 1],
          [inner.west + 1e-5, inner.south - 1],
        ],
      ],
    };
    expect(rectIntersectsShape(inner, cross)).toBe(true);
  });

  it('a radius child outside the circle is pruned', () => {
    const lat = 26.2;
    const lng = -98.25;
    const radiusM = 16_000;
    const ref: ShapeRef = { kind: 'circle', lat, lng, radiusM };
    const shape = shapeFor(ref, geoShapes);
    expect(shape.kind).toBe('circle');
    expect(shape.bbox).toEqual(circleBbox(lat, lng, radiusM));

    // The NE quadrant of the NE quadrant spans 0.5r..r from the centre on both axes. Its own NE
    // child spans 0.75r..r — nearest point ≈ 1.06 r from the centre, outside the circle.
    const ne = quadrants(shape.bbox)[3];
    const neNe = quadrants(ne)[3];
    const spec: TileSpec = {
      ...rootSpec({
        clusterKey: 'home_services',
        unitKind: 'radius',
        unitId: '48215\u000010mi',
        placesType: 'plumber',
        kind: 'enterprise',
        shape: ref,
        bbox: shape.bbox,
      }),
      depth: 2,
      quadPath: 'r33',
      rect: neNe,
    };
    const next = decideSubdivision(spec, { resultsCount: 60, overlapWithParent: null }, shape);
    expect(next.action).toBe('subdivide');
    if (next.action !== 'subdivide') return;
    expect(next.children.map((c) => c.quadPath)).toEqual(['r330', 'r331', 'r332']);

    // The bounding square really bounds the circle: its edge midpoints are ~r from the centre.
    const b = shape.bbox;
    expect(b.north - lat).toBeGreaterThan(0);
    expect(
      rectIntersectsShape(
        { south: b.north - 1e-6, west: lng, north: b.north, east: lng + 1e-6 },
        shape,
      ),
    ).toBe(true);
  });
});

describe('geometry and keys', () => {
  it('quadrants partition the parent exactly', () => {
    const [sw, se, nw, ne] = quadrants(BIG);
    const area = (r: Rect) => (r.north - r.south) * (r.east - r.west);
    expect(area(sw) + area(se) + area(nw) + area(ne)).toBeCloseTo(area(BIG), 12);
    // Outer edges are the parent's.
    expect(sw.south).toBe(BIG.south);
    expect(sw.west).toBe(BIG.west);
    expect(ne.north).toBe(BIG.north);
    expect(ne.east).toBe(BIG.east);
    expect(se.south).toBe(BIG.south);
    expect(se.east).toBe(BIG.east);
    expect(nw.north).toBe(BIG.north);
    expect(nw.west).toBe(BIG.west);
    // Shared edges are the SAME float — no gap a place could fall through, no overlap.
    expect(sw.north).toBe(nw.south);
    expect(se.north).toBe(ne.south);
    expect(sw.east).toBe(se.west);
    expect(nw.east).toBe(ne.west);
    expect(sw.north).toBe(se.north);
    expect(sw.east).toBe(nw.east);

    const sides = rectSidesM(BIG);
    expect(sides.heightM).toBeCloseTo(10_000, 6);
    expect(sides.widthM).toBeCloseTo(10_000, 6);
  });

  it('tile keys never carry U+0000', () => {
    expect(tileKeyOf('city', '48215\u0000McAllen', 'plumber', 'r')).toBe(
      'city:48215/McAllen|plumber|r',
    );
    expect(dbSafe('a\u0000b\u0000c')).toBe('a/b/c');
    const spec = specFor(BIG, 0);
    expect(spec.cellKey).toBe('home_services/48215/McAllen');
    expect(spec.unitId).toBe(MCALLEN_ID); // raw — the in-memory partition hash input
    const next = decideSubdivision(
      spec,
      { resultsCount: 60, overlapWithParent: null },
      polygonOf(BIG),
    );
    const keys = [spec.tileKey, spec.cellKey];
    if (next.action === 'subdivide') {
      for (const c of next.children) keys.push(c.tileKey, c.cellKey, c.parentTileKey ?? '');
    }
    for (const k of keys) expect(k.includes('\u0000')).toBe(false);
  });

  it('shapeFor names a missing polygon', () => {
    expect(() =>
      shapeFor({ kind: 'polygon', unitKind: 'city', unitId: '48215\u0000Atlantis' }, geoShapes),
    ).toThrow(/city 48215\/Atlantis/);
  });
});

describe('the committed seed', () => {
  it('the committed geo shapes cover every seeded unit', () => {
    const wanted: { unitKind: 'city' | 'county'; unitId: string }[] = [
      ...citiesJson.cities.map((c) => ({
        unitKind: 'city' as const,
        unitId: `${c.countyFips}\u0000${c.name}`,
      })),
      ...['48061', '48215', '48427', '48489'].map((fips) => ({
        unitKind: 'county' as const,
        unitId: fips,
      })),
    ];
    expect(wanted).toHaveLength(21);
    expect(geoShapes.units).toHaveLength(21);
    for (const w of wanted) {
      const unit = geoShapes.units.find((u) => u.unitKind === w.unitKind && u.unitId === w.unitId);
      expect(unit, `${w.unitKind} ${dbSafe(w.unitId)}`).toBeDefined();
      if (!unit) continue;
      expect(unit.rings.length).toBeGreaterThan(0);
      for (const ring of unit.rings) expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(unit.bbox.south).toBeLessThan(unit.bbox.north);
      expect(unit.bbox.west).toBeLessThan(unit.bbox.east);
      const shape = shapeFor(
        { kind: 'polygon', unitKind: w.unitKind, unitId: w.unitId },
        geoShapes,
      );
      expect(shape.kind).toBe('polygon');
      // The unit's own root tile intersects its own polygon.
      expect(rectIntersectsShape(unit.bbox, shape)).toBe(true);
    }
    // McAllen, as verified live by 04-RESEARCH (within 0.01°).
    const mcallen = geoShapes.units.find((u) => u.unitId === MCALLEN_ID);
    expect(mcallen?.geoid).toBe('4845384');
    expect(mcallen?.bbox.west).toBeCloseTo(-98.318, 2);
    expect(mcallen?.bbox.east).toBeCloseTo(-98.195, 2);
    expect(mcallen?.bbox.south).toBeCloseTo(26.102, 2);
    expect(mcallen?.bbox.north).toBeCloseTo(26.467, 2);
  });
});
