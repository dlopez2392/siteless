/**
 * BUDG-03's standing guard, and T-2-15's.
 *
 * The Google Cloud project and the Places API (New) key DO NOT EXIST (PROJECT.md
 * § Dependencies not yet created), and UI-SPEC Executor Rule 14 turns that into a contract
 * rather than a temporary fact: nothing on any screen reads a Google credential, and no
 * test in this repo depends on the key existing. That is what lets all of Phase 2 be built
 * and verified before danlo ever creates the project — and it is a real security property,
 * because a `NEXT_PUBLIC_*` name reaches the browser bundle and a key that is never named
 * cannot leak from one.
 *
 * This file lives under `tests/`, and the walk only covers `src/`, so it may spell the
 * forbidden tokens freely — which is the only reason the patterns can be written out
 * legibly here at all. (`src/lib/time.ts` documents the other half of that arrangement:
 * a file INSIDE a guarded tree must not spell the token the guard hunts for.)
 *
 * Two-sided, per tests/unit/no-internal-leak.test.ts: the walker asserts it actually found
 * files. A scan that proves only absence is green when a wrong path glob makes it scan
 * nothing at all, which is the most common way a guard like this quietly dies.
 *
 * `src/components/ui/**` is deliberately NOT excluded. Generated shadcn primitives land
 * there and are exactly the kind of code nobody re-reads; an exclusion is a hole.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src';
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.json']);

/** Each pattern names the shape of a credential reference, not one literal variable: a new
 *  `GOOGLE_PLACES_KEY` must trip this without anybody remembering to add it. */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: 'GOOGLE_*KEY environment variable', re: /GOOGLE_[A-Z_]*KEY/ },
  { label: 'GOOGLE_API_KEY', re: /GOOGLE_API_KEY/ },
  { label: 'NEXT_PUBLIC_GOOGLE (reaches the browser bundle)', re: /NEXT_PUBLIC_GOOGLE/ },
  { label: 'X-Goog-Api-Key header', re: /X-Goog-Api-Key/i },
  { label: 'maps.googleapis.com', re: /maps\.googleapis\.com/i },
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (EXTENSIONS.has(nodePath.extname(entry.name))) found.push(full);
  }
  return found;
}

describe('no Google credential in the source tree', () => {
  it('no google credential is read anywhere in src', () => {
    const scanned = walk(ROOT);

    // The two-sided half. A broken path glob, a wrong cwd, or an extension set that no
    // longer matches the repo would all otherwise pass by scanning an empty list.
    expect(scanned.length).toBeGreaterThan(15);
    expect(scanned).toContain(nodePath.join('src', 'env.ts'));
    expect(scanned).toContain(nodePath.join('src', 'lib', 'time.ts'));

    const offences: string[] = [];
    for (const file of scanned) {
      const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { label, re } of FORBIDDEN) {
          if (re.test(line)) {
            // Name the file AND the line. A guard that reports only "failed" costs an hour.
            offences.push(`${file}:${i + 1} [${label}] ${line.trim()}`);
          }
        }
      });
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('src/env.ts declares no Google variable', () => {
    // env.ts is where a server-side key would be declared, so it gets its own named
    // assertion: the walk above would catch a KEY-shaped name, but `GOOGLE_PROJECT_ID` or
    // a bare `PLACES_*` would slip through it and still mean the app had started to depend
    // on a credential that does not exist.
    const source = nodeFs.readFileSync(nodePath.join('src', 'env.ts'), 'utf8');

    // Positive control: prove we read the real module and not an empty string.
    expect(source).toContain('CLERK_SECRET_KEY');

    expect(source).not.toContain('GOOGLE');
    expect(source).not.toContain('PLACES');
  });
});
