/**
 * What the places-sweep workflow and its steps can reach (04-22).
 *
 * A step runs from a bundle outside any Next request: `next/headers`, `next/cache` or Clerk's
 * `auth()` there throws at runtime, and typecheck, lint and build are all green on it. A
 * `'use server'` module a workflow or step imports is the one pattern the Workflow DevKit docs
 * forbid outright. And the workflow body is replayed in a sandbox that must reach no Node I/O at
 * all. None of that is visible to the compiler, so this walks the real import graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');
const STEPS = join(SRC, 'workflows/places-sweep/steps.ts');
const WORKFLOW = join(SRC, 'workflows/places-sweep/workflow.ts');

/** Value imports only: `import type` / `export type` are erased and reach nothing. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const staticRe = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(staticRe)) out.push(m[1]!);
  for (const m of source.matchAll(dynamicRe)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.(ts|tsx|json)$/.test(candidate)) {
      return candidate;
    }
  }
  throw new Error(`places-sweep-imports: cannot resolve ${spec} from ${relative(ROOT, from)}`);
}

/** Every project file reachable from `entry`, and every package specifier they import. */
function graph(entry: string): { files: string[]; packages: Map<string, string> } {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const local = resolveLocal(file, spec);
      if (local) queue.push(local);
      else packages.set(spec, relative(ROOT, file));
    }
  }
  return { files: [...seen], packages };
}

const USE_SERVER = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/;

describe('places-sweep import graph', () => {
  it('a step reaches no Next, no Clerk and no server-action module', () => {
    const { files, packages } = graph(STEPS);
    // The walk really covered the step graph.
    const rel = files.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(rel).toContain('src/server/queries/preset-spec.ts');
    expect(rel).toContain('src/server/queries/presets.ts');
    expect(rel).toContain('src/lib/places/search-tile.ts');
    expect(rel).toContain('src/lib/places/check-tile.ts');

    const forbidden = [...packages.entries()].filter(
      ([spec]) => spec === 'next' || spec.startsWith('next/') || spec.startsWith('@clerk/'),
    );
    expect(forbidden).toEqual([]);

    const serverActions = files
      .filter((f) => !f.endsWith('.json') && USE_SERVER.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(serverActions).toEqual([]);
  });

  it('the workflow body imports only its steps and the pure reducer', () => {
    const source = readFileSync(WORKFLOW, 'utf8');
    expect(specifiersOf(source).sort()).toEqual(['./reducer', './steps']);
    // The reducer it replays reaches nothing at all at runtime.
    expect(
      specifiersOf(readFileSync(join(SRC, 'workflows/places-sweep/reducer.ts'), 'utf8')),
    ).toEqual([]);
    expect(source).not.toMatch(/geo-shapes|from '@\/db|from 'node:|\bfetch\(/);
  });
});
