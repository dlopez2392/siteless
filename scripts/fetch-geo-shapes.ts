/**
 * Fetch the geography shapes the Places quadtree tiles over, and WRITE the committed seed
 * `src/seed/data/geo-shapes.json`.
 *
 *   pnpm exec tsx scripts/fetch-geo-shapes.ts [--max-offset=0.0005]
 *
 * Source: Census TIGERweb (public domain) — Census 2020 Incorporated Places
 * (`Places_CouSub_ConCity_SubMCD/MapServer/25`) for the 17 seeded cities, Census 2020
 * Counties (`State_County/MapServer/55`) for the four RGV counties. 04-RESEARCH § Pattern 5
 * and § Don't Hand-Roll: hand-typed boxes are not reproducible; this script is.
 *
 * WHY RINGS AND NOT ONLY A BBOX. The root tile of a unit is its bbox, but a child rectangle
 * that does not intersect the unit's polygon is never searched (`src/lib/places/tiling.ts`,
 * `rectIntersectsShape`). Brownsville's bbox reaches Matamoros; McAllen's overlaps Pharr and
 * Edinburg. Without the ring those tiles would be searched and billed twice.
 *
 * 🔴 NEVER RUN IN CI, NEVER IMPORTED BY `src/`. CI reads the committed JSON; the tiling
 * test (`the committed geo shapes cover every seeded unit`) is the drift alarm.
 *
 * 🔴 LAYER 25's `NAME` IS "McAllen city", NOT "McAllen". The seeded city name matches
 * `BASENAME`. Querying `NAME='McAllen'` returns zero features without an error.
 *
 * Geometry handling: outer rings only (ArcGIS winds outer rings clockwise, holes
 * counter-clockwise — holes are dropped, which can only make pruning more permissive, never
 * lose a tile), coordinates rounded to 4 decimals (~11 m), consecutive duplicate points
 * dropped. Pass `--max-offset=<deg>` to have the server generalize (`maxAllowableOffset`)
 * if the file grows past 1.5 MB.
 *
 * After running, `pnpm format`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CitiesFile } from '../src/seed/types';

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const PLACES_LAYER = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/25/query`;
const COUNTIES_LAYER = `${TIGERWEB}/State_County/MapServer/55/query`;

/** The four RGV counties: Cameron, Hidalgo, Starr, Willacy. */
const RGV_COUNTY_FIPS = ['48061', '48215', '48427', '48489'] as const;

const PRECISION = 4;

type Rect = { south: number; west: number; north: number; east: number };

type GeoUnit = {
  unitKind: 'city' | 'county';
  /** city: `countyFips + '\u0000' + name` (the expand-cells separator); county: the FIPS. */
  unitId: string;
  geoid: string;
  name: string;
  bbox: Rect;
  /** [ring][point][lng, lat] — outer rings only. */
  rings: number[][][];
};

type Feature = {
  attributes: { GEOID: string; NAME: string };
  geometry?: { rings?: number[][][] };
};

const maxOffsetArg = process.argv.find((a) => a.startsWith('--max-offset='));
const maxAllowableOffset = maxOffsetArg ? Number(maxOffsetArg.split('=')[1]) : null;
if (maxAllowableOffset !== null && !(maxAllowableOffset > 0)) {
  throw new Error(`fetch-geo-shapes: --max-offset must be a positive number, got ${maxOffsetArg}`);
}

const dataPath = (name: string) =>
  fileURLToPath(new URL(`../src/seed/data/${name}`, import.meta.url));

let requestCount = 0;

async function query(layer: string, where: string): Promise<Feature[]> {
  const params = new URLSearchParams({
    where,
    outFields: 'GEOID,NAME',
    returnGeometry: 'true',
    geometryPrecision: String(PRECISION),
    outSR: '4326',
    f: 'json',
  });
  if (maxAllowableOffset !== null) params.set('maxAllowableOffset', String(maxAllowableOffset));
  for (let attempt = 1; ; attempt += 1) {
    requestCount += 1;
    const res = await fetch(`${layer}?${params.toString()}`);
    if (res.ok) {
      const body = (await res.json()) as { features?: Feature[]; error?: { message?: string } };
      if (body.error)
        throw new Error(`fetch-geo-shapes: TIGERweb error for ${where}: ${body.error.message}`);
      if (!Array.isArray(body.features))
        throw new Error(`fetch-geo-shapes: no features array for ${where}`);
      return body.features;
    }
    if (attempt >= 3) throw new Error(`fetch-geo-shapes: HTTP ${res.status} for ${where}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

const round = (x: number) => Math.round(x * 10 ** PRECISION) / 10 ** PRECISION;

/** Shoelace sum in (lng, lat): positive = clockwise = an ArcGIS OUTER ring. */
function isClockwise(ring: number[][]): boolean {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum > 0;
}

function cleanRing(ring: number[][]): number[][] {
  const out: number[][] = [];
  for (const [lng, lat] of ring) {
    const p = [round(lng), round(lat)];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

function outerRings(feature: Feature, label: string): number[][][] {
  const rings = feature.geometry?.rings ?? [];
  const kept = rings
    .filter(isClockwise)
    .map(cleanRing)
    .filter((r) => r.length >= 4);
  if (kept.length === 0) throw new Error(`fetch-geo-shapes: ${label} has no usable outer ring`);
  return kept;
}

function bboxOf(rings: number[][][]): Rect {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }
  return { south, west, north, east };
}

const intersects = (a: Rect, b: Rect) =>
  a.south <= b.north && b.south <= a.north && a.west <= b.east && b.west <= a.east;

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  const cities = JSON.parse(readFileSync(dataPath('cities.json'), 'utf8')) as CitiesFile;
  const units: GeoUnit[] = [];

  // Counties first: their bboxes disambiguate a city name that repeats across Texas.
  const countyBbox = new Map<string, Rect>();
  const countyUnits: GeoUnit[] = [];
  for (const fips of RGV_COUNTY_FIPS) {
    const features = await query(COUNTIES_LAYER, `GEOID=${sqlString(fips)}`);
    if (features.length !== 1) {
      throw new Error(`fetch-geo-shapes: county ${fips} matched ${features.length} features`);
    }
    const f = features[0];
    const rings = outerRings(f, `county ${fips}`);
    const bbox = bboxOf(rings);
    countyBbox.set(fips, bbox);
    countyUnits.push({
      unitKind: 'county',
      unitId: fips,
      geoid: f.attributes.GEOID,
      name: f.attributes.NAME,
      bbox,
      rings,
    });
  }

  for (const city of cities.cities) {
    const features = await query(PLACES_LAYER, `STATE='48' AND BASENAME=${sqlString(city.name)}`);
    const county = countyBbox.get(city.countyFips);
    if (!county) {
      throw new Error(
        `fetch-geo-shapes: city ${city.name} names non-RGV county ${city.countyFips}`,
      );
    }
    const candidates = features
      .map((f) => ({ f, rings: outerRings(f, `city ${city.name} (${f.attributes.GEOID})`) }))
      .map((c) => ({ ...c, bbox: bboxOf(c.rings) }))
      .filter((c) => features.length === 1 || intersects(c.bbox, county));
    if (candidates.length !== 1) {
      throw new Error(
        `fetch-geo-shapes: city ${city.name} (county ${city.countyFips}) is ambiguous or missing — ` +
          `${features.length} features, ${candidates.length} inside the county bbox`,
      );
    }
    const [{ f, rings, bbox }] = candidates;
    units.push({
      unitKind: 'city',
      unitId: `${city.countyFips}\u0000${city.name}`,
      geoid: f.attributes.GEOID,
      name: city.name,
      bbox,
      rings,
    });
  }
  units.push(...countyUnits);

  const file = {
    source:
      'Census TIGERweb (public domain): Places_CouSub_ConCity_SubMCD/MapServer/25, State_County/MapServer/55',
    fetchedAt: new Date().toISOString().slice(0, 10),
    geometryPrecision: PRECISION,
    ...(maxAllowableOffset !== null ? { maxAllowableOffset } : {}),
    units,
  };
  const out = JSON.stringify(file, null, 2) + '\n';
  writeFileSync(dataPath('geo-shapes.json'), out, 'utf8');
  console.log(
    `fetch-geo-shapes: wrote ${units.length} units (${(out.length / 1024).toFixed(1)} KiB) from ${requestCount} TIGERweb requests.`,
  );
}

await main();
