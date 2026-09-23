/**
 * The step boundary's search form (04-22, src/workflows/places-sweep/wire.ts): no U+0000 crosses
 * a step, and the raw unit id comes back byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { dbSafe, rootSpec, type GeoShapesFile } from '@/lib/places/tiling';
import geoShapes from '@/seed/data/geo-shapes.json';
import type { PlannedSearch } from '@/workflows/places-sweep/reducer';
import { decodeUnitId, encodeUnitId, fromWire, toWire } from '@/workflows/places-sweep/wire';

const SHAPES = geoShapes as GeoShapesFile;

function planned(unitId: string, shape: PlannedSearch['shape']): PlannedSearch {
  const spec = rootSpec({
    clusterKey: 'home_services',
    unitKind: shape.kind === 'circle' ? 'radius' : shape.unitKind,
    unitId,
    placesType: 'plumber',
    kind: 'enterprise',
    shape,
    bbox: { south: 26.1, west: -98.3, north: 26.3, east: -98.1 },
  });
  return { ...spec, searchId: '00000000-0000-4000-8000-000000000001' };
}

describe('places-sweep wire form', () => {
  it('every seeded unit id crosses a step as its DB-safe form and comes back raw', () => {
    expect(SHAPES.units.length).toBeGreaterThan(0);
    for (const u of SHAPES.units) {
      const wire = encodeUnitId(u.unitId);
      expect(wire).not.toContain('\u0000');
      // The seed has no '%' or '/', so the wire form IS the value place_tiles.unit_id holds.
      expect(wire).toBe(dbSafe(u.unitId));
      expect(decodeUnitId(wire)).toBe(u.unitId);
    }
    // A radius cell: `countyFips + U+0000 + <miles>mi` (expand-cells).
    expect(decodeUnitId(encodeUnitId('48215\u000010mi'))).toBe('48215\u000010mi');
  });

  it('the wire form is reversible where dbSafe is not', () => {
    // dbSafe maps both of these to 'a/b'; the wire form keeps them apart.
    const nul = 'a\u0000b';
    const slash = 'a/b';
    expect(dbSafe(nul)).toBe(dbSafe(slash));
    expect(encodeUnitId(nul)).not.toBe(encodeUnitId(slash));
    for (const raw of [nul, slash, 'a%2Fb', '%', '%25', '/\u0000/', '\u0000\u0000', 'plain', '']) {
      expect(decodeUnitId(encodeUnitId(raw))).toBe(raw);
    }
  });

  it('a planned search leaves a step with no U+0000 and returns intact', () => {
    const raw = '48215\u0000McAllen';
    const search = planned(raw, { kind: 'polygon', unitKind: 'city', unitId: raw });
    expect(JSON.stringify(search)).toContain('\\u0000');

    const wire = toWire(search);
    expect(JSON.stringify(wire)).not.toContain('\\u0000');
    expect(wire.unitId).toBe('48215/McAllen');
    expect(wire.shape).toEqual({ kind: 'polygon', unitKind: 'city', unitId: '48215/McAllen' });
    // Keys that were already DB-safe are untouched.
    expect(wire.tileKey).toBe(search.tileKey);
    expect(wire.cellKey).toBe(search.cellKey);

    expect(fromWire(wire)).toEqual(search);
    // A circle carries no unit id in its shape.
    const radius = planned('48215\u000010mi', {
      kind: 'circle',
      lat: 26.2,
      lng: -98.2,
      radiusM: 16093,
    });
    expect(fromWire(toWire(radius))).toEqual(radius);
  });
});
