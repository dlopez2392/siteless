/**
 * T-4-05 — tests/unit/_walk.ts, the shared walker behind the three repo-grep guards.
 *
 * Built in a throwaway temp tree rather than against `src/`, because the generated workflow
 * tree does not exist until `next build` writes it — a test against the real repo would pass
 * vacuously today.
 *
 * Mutations:
 *   - GENERATED_EXCLUDES = [] → 'the shared walker skips src/app/.well-known/workflow' goes red.
 *   - drop the extension check → 'the shared walker honours its extension set' goes red.
 *   - loosen the match to a bare substring → 'the shared walker does not skip a look-alike
 *     sibling' goes red.
 */
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walk } from './_walk';

let root: string;

function touch(rel: string, body = 'x'): void {
  const full = nodePath.join(root, ...rel.split('/'));
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, body);
}

/** Relative, posix — so the expectations read the same on Windows and in CI. */
const rel = (files: string[]) =>
  files.map((f) => nodePath.relative(root, f).split(nodePath.sep).join('/')).sort();

beforeAll(() => {
  root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'siteless-walk-'));
  touch('a.ts');
  touch('app/.well-known/workflow/v1/step/route.js');
  touch('app/.well-known/workflow/v1/flow/route.ts');
  touch('notes.md');
  // Look-alikes that must still be walked: an exclusion is a hole, so it stays narrow.
  touch('app/.well-known/workflow-notes/keep.ts');
  touch('myapp/.well-known/workflow/keep.js');
});

afterAll(() => {
  nodeFs.rmSync(root, { recursive: true, force: true });
});

describe('tests/unit/_walk.ts', () => {
  it('the shared walker skips src/app/.well-known/workflow', () => {
    const exts = new Set(['.ts', '.js']);
    const found = rel(walk(root, { exts }));

    expect(found).toContain('a.ts');
    // Anchored: `myapp/.well-known/workflow/keep.js` is a look-alike that must survive.
    expect(found.some((f) => f.startsWith('app/.well-known/workflow/'))).toBe(false);

    // Two-sided: the same tree walked with the exclusion disabled DOES contain the
    // generated routes, so the green above is the exclusion and not a broken fixture.
    const unexcluded = rel(walk(root, { exts, exclude: [] }));
    expect(unexcluded).toContain('app/.well-known/workflow/v1/step/route.js');
  });

  it('the shared walker honours its extension set', () => {
    const found = rel(walk(root, { exts: new Set(['.ts', '.js']) }));
    expect(found).not.toContain('notes.md');
    expect(found).toContain('a.ts');

    // Omitting the set means "every file" — the field-mask-tier guard relies on that.
    expect(rel(walk(root))).toContain('notes.md');
  });

  it('the shared walker does not skip a look-alike sibling', () => {
    const found = rel(walk(root, { exts: new Set(['.ts', '.js']) }));
    expect(found).toContain('app/.well-known/workflow-notes/keep.ts');
    expect(found).toContain('myapp/.well-known/workflow/keep.js');
  });
});
