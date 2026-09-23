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
 *
 * Amended in 04-12 (never deleted), D-03 / T-4-01: Phase 4 has ONE sanctioned reader of the
 * Places key — `src/lib/places/client.ts`, server-only — and it is the only file that may
 * spell the key variable, the API-key header or the Places host. The allowance is PER
 * PATTERN, not per file: the client still may not spell `GOOGLE_API_KEY`, a `NEXT_PUBLIC_`
 * Google name or the Maps host. And it is two-sided: the allow-listed file is proven to be
 * scanned AND to trip the patterns it is excused from, so the allowance cannot outlive the
 * code it excuses. Gate mutation M51 (read the key in a second module) reds this test naming
 * that module.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { walk } from './_walk';

const ROOT = 'src';
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.json']);

/** D-03: the one sanctioned reader of the Places key (plan 04-12). */
const PLACES_CLIENT = nodePath.join('src', 'lib', 'places', 'client.ts');

/** Each pattern names the shape of a credential reference, not one literal variable: a new
 *  `GOOGLE_PLACES_KEY` must trip this without anybody remembering to add it. `allowedIn` is
 *  the exact set of files excused from THAT pattern — absent means no file is. */
const FORBIDDEN: Array<{ label: string; re: RegExp; allowedIn?: ReadonlySet<string> }> = [
  {
    label: 'GOOGLE_*KEY environment variable',
    re: /GOOGLE_[A-Z_]*KEY/,
    allowedIn: new Set([PLACES_CLIENT]),
  },
  { label: 'GOOGLE_API_KEY', re: /GOOGLE_API_KEY/ },
  { label: 'NEXT_PUBLIC_GOOGLE (reaches the browser bundle)', re: /NEXT_PUBLIC_GOOGLE/ },
  { label: 'X-Goog-Api-Key header', re: /X-Goog-Api-Key/i, allowedIn: new Set([PLACES_CLIENT]) },
  { label: 'maps.googleapis.com', re: /maps\.googleapis\.com/i },
  {
    // Labelled, not spelled: no-network.test.ts forbids the literal host outside the msw
    // harness, and the escaped regex below does not contain it.
    label: 'Places API host',
    re: /places\.googleapis\.com/i,
    allowedIn: new Set([PLACES_CLIENT]),
  },
];

/** Every `path:line [label] text` in `file` that matches a FORBIDDEN pattern, allowances
 *  ignored — the caller decides what is excused. */
function hitsIn(file: string): Array<{ label: string; allowedIn?: ReadonlySet<string>; at: string }> {
  const hits: Array<{ label: string; allowedIn?: ReadonlySet<string>; at: string }> = [];
  const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { label, re, allowedIn } of FORBIDDEN) {
      // Name the file AND the line. A guard that reports only "failed" costs an hour.
      if (re.test(line)) hits.push({ label, allowedIn, at: `${file}:${i + 1} [${label}] ${line.trim()}` });
    }
  });
  return hits;
}

describe('no Google credential in the source tree', () => {
  it('no google credential is read anywhere in src', () => {
    // The shared walker skips the generated workflow tree (04-RESEARCH Pitfall 6): it
    // bundles the Places client and would report the one sanctioned reader twice.
    const scanned = walk(ROOT, { exts: EXTENSIONS });

    // The two-sided half. A broken path glob, a wrong cwd, or an extension set that no
    // longer matches the repo would all otherwise pass by scanning an empty list.
    expect(scanned.length).toBeGreaterThan(15);
    expect(scanned).toContain(nodePath.join('src', 'env.ts'));
    expect(scanned).toContain(nodePath.join('src', 'lib', 'time.ts'));
    // ...and the exclusion is real, not merely declared.
    expect(scanned.some((f) => f.includes(nodePath.join('.well-known', 'workflow')))).toBe(false);

    // The allowance is exercised, not dead: the one sanctioned reader IS scanned, DOES read
    // the key, and trips every pattern it is excused from. Delete the client, or move its key
    // read elsewhere, and this goes red rather than leaving an allowance that excuses nothing.
    expect(scanned).toContain(PLACES_CLIENT);
    expect(nodeFs.readFileSync(PLACES_CLIENT, 'utf8')).toContain('GOOGLE_PLACES_API_KEY');
    const clientLabels = new Set(hitsIn(PLACES_CLIENT).map((h) => h.label));
    for (const { label, allowedIn } of FORBIDDEN) {
      if (allowedIn?.has(PLACES_CLIENT)) expect(clientLabels, label).toContain(label);
    }

    const offences = scanned
      .flatMap((file) => hitsIn(file).filter((h) => !h.allowedIn?.has(file)))
      .map((h) => h.at);

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('src/env.ts declares no Google variable and only the PLACES_MODE switch', () => {
    // env.ts is where a server-side key would be declared, so it gets its own named
    // assertion: the walk above would catch a KEY-shaped name, but `GOOGLE_PROJECT_ID` or
    // a bare `PLACES_*` would slip through it and still mean the app had started to depend
    // on a credential that does not exist.
    //
    // Amended in 04-02 (never deleted): D-02 declares the Places kill switch here, and D-03
    // keeps the key OUT of this file — src/lib/places/client.ts is its one sanctioned reader.
    const source = nodeFs.readFileSync(nodePath.join('src', 'env.ts'), 'utf8');

    // Positive controls: prove we read the real module and not an empty string, and that the
    // switch the strip below removes is actually there to remove.
    expect(source).toContain('CLERK_SECRET_KEY');
    expect(source).toContain('PLACES_MODE');

    expect(source).not.toContain('GOOGLE');
    // D-02 puts exactly one Places-shaped name here: the kill switch. Strip it, then nothing
    // Places-shaped may remain — a PLACES_KEY or PLACES_API_* would still trip this.
    expect(source.replaceAll('PLACES_MODE', '')).not.toContain('PLACES');
  });
});
