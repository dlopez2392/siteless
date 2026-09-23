/**
 * 04-UI-SPEC Executor Rule 31 / T-4-13 — no map, ever, in this app.
 *
 * Google Maps Platform Terms §3.2.3(e) and Service Specific Terms §B.14.2: Places content may
 * not be displayed on, or used with, a non-Google map, and Siteless renders no map of its own
 * at all. So no map library, no map `<iframe>`, no static-map image and no tile URL. Linking
 * OUT to Google Maps by URL is permitted (Google's own map on Google's own surface), which is
 * why the patterns below name embed/tile/static shapes rather than `google.com/maps`.
 *
 * This file lives under `tests/`, and the walk only covers `src/`, so it may spell the
 * forbidden tokens freely (the same arrangement as no-google-credential.test.ts).
 *
 * Two-sided: the walker asserts it actually found files, including one it must find. A scan
 * that proves only absence is green when a wrong root or extension set scans nothing.
 *
 * Mutation (Rule 31): add `"leaflet": "1.9.4"` to package.json dependencies → red, naming it.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src';
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.json']);

/** Exact package names, plus one scope that is forbidden wholesale. */
const FORBIDDEN_PACKAGES = new Set([
  'leaflet',
  'react-leaflet',
  'maplibre-gl',
  'mapbox-gl',
  '@vis.gl/react-google-maps',
  'pigeon-maps',
  'ol',
]);
const FORBIDDEN_SCOPES = ['@react-google-maps/'];

const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Maps Embed API (maps/embed)', re: /maps\/embed/i },
  { label: 'static map image (staticmap)', re: /staticmap/i },
  { label: 'OSM tile server (tile.openstreetmap)', re: /tile\.openstreetmap/i },
  { label: 'Mapbox API host (api.mapbox.com)', re: /api\.mapbox\.com/i },
  { label: 'MapLibre (maplibre)', re: /maplibre/i },
];
/** An iframe is only an offence when the same line points it at a map. */
const IFRAME = /<iframe/i;
const MAP = /map/i;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(nodePath.extname(entry.name))) found.push(full);
  }
  return found;
}

describe('no map in the app', () => {
  it('no map library or map embed anywhere in the app', () => {
    const offences: string[] = [];

    // 1. package.json — every dependency field that can put code in the app.
    const pkg = JSON.parse(nodeFs.readFileSync('package.json', 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const fields = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
    // Positive control: prove we parsed the real manifest.
    expect(Object.keys(pkg.dependencies ?? {})).toContain('next');
    for (const field of fields) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (FORBIDDEN_PACKAGES.has(name) || FORBIDDEN_SCOPES.some((s) => name.startsWith(s))) {
          offences.push(`package.json ${field}: ${name}`);
        }
      }
    }

    // 2. src/ — embeds, static maps, tile URLs.
    const scanned = walk(ROOT);
    // The two-sided half: a broken root or extension set would otherwise pass on nothing.
    expect(scanned.length).toBeGreaterThan(50);
    expect(scanned).toContain(nodePath.join('src', 'app', 'globals.css'));

    for (const file of scanned) {
      const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { label, re } of FORBIDDEN_PATTERNS) {
          if (re.test(line)) offences.push(`${file}:${i + 1} [${label}] ${line.trim()}`);
        }
        if (IFRAME.test(line) && MAP.test(line)) {
          offences.push(`${file}:${i + 1} [map <iframe>] ${line.trim()}`);
        }
      });
    }

    // Name the package or the file AND line: a guard that reports only "failed" costs an hour.
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
