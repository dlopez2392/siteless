/**
 * T-3-14 — CI hygiene. No test and no src/ module may reach a data host outside the modules
 * built to do it. CI replays recorded payloads through msw. A test that names a live host is
 * one missing handler away from calling it, and on a Places-shaped API that would spend budget.
 *
 * Hosts: the Texas Comptroller Socrata host, Overture's bucket, any S3 endpoint, and the
 * Census geocoder. They are written below as constructed strings so this file is not its own
 * violation, and it also excludes itself by path.
 *
 * Allow-list, exactly (D-01, T-3-05):
 *   - scripts/**: the desk scripts are the only network callers. This walk does not cover
 *     scripts/ at all.
 *   - src/lib/socrata/client.ts, src/lib/geocode/census.ts, src/lib/geocode/census-batch.ts:
 *     each carries its host as ONE module-level constant.
 *   - tests/unit/msw/**: the replay handlers and their recorded fixtures.
 *   - src/seed/data/*.json, but ONLY on a `"source":` line. Those three committed seed files
 *     cite the dataset they were measured from. That is provenance text, not a request. Any
 *     OTHER line in those files naming a host is still an offence, so a URL that code could
 *     read and fetch cannot hide there.
 *
 * Scanned: code (.ts .tsx .js .mjs .cjs) and data (.json) under src/ and tests/.
 *
 * Violations are reported as `path:line`, not as a bare boolean.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { walk } from './_walk';

const HOSTS: readonly string[] = [
  'data.' + 'texas.gov',
  'overture' + 'maps',
  's3' + '.',
  'geocoding.geo.' + 'census.gov',
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json']);

const SELF = 'tests/unit/no-network.test.ts';

const ALLOWED_FILES = new Set([
  'src/lib/socrata/client.ts',
  'src/lib/geocode/census.ts',
  'src/lib/geocode/census-batch.ts',
]);

const ALLOWED_PREFIXES = ['tests/unit/msw/'];

/** Provenance lines in committed seed data: the host may appear only as a `"source"` value. */
const PROVENANCE_DIR = 'src/seed/data/';
const PROVENANCE_LINE = /^\s*"source"\s*:/;

const toPosix = (p: string) => p.split(nodePath.sep).join('/');

function offencesIn(file: string): string[] {
  const out: string[] = [];
  const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const hit = HOSTS.find((h) => line.includes(h));
    if (hit === undefined) return;
    if (file.startsWith(PROVENANCE_DIR) && PROVENANCE_LINE.test(line)) return;
    out.push(`${file}:${i + 1} [${hit}] ${line.trim()}`);
  });
  return out;
}

describe('CI hygiene', () => {
  it('CI never reaches the network', () => {
    // The shared walker skips the generated workflow tree (04-RESEARCH Pitfall 6).
    const scanned = [
      ...walk('src', { exts: EXTENSIONS }),
      ...walk('tests', { exts: EXTENSIONS }),
    ].map(toPosix);

    // Two-sided: the walk found real files in both trees...
    expect(scanned.length).toBeGreaterThan(40);
    expect(scanned).toContain('src/lib/geocode/census.ts');
    expect(scanned).toContain('tests/unit/msw/server.ts');
    // ...none of them generated workflow output (paths are posix here, so the probe is too)...
    expect(scanned.some((f) => f.includes('.well-known/workflow'))).toBe(false);
    // ...and the matcher works. The allow-listed Census client DOES name its host, so a
    // broken HOSTS list or a matcher that never fires goes red here instead of green.
    expect(offencesIn('src/lib/geocode/census.ts').length).toBeGreaterThan(0);

    const offences: string[] = [];
    for (const file of scanned) {
      if (file === SELF) continue;
      if (ALLOWED_FILES.has(file)) continue;
      if (ALLOWED_PREFIXES.some((p) => file.startsWith(p))) continue;
      offences.push(...offencesIn(file));
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });
});
