/**
 * The one source walker every repo-grep guard uses (04-RESEARCH Pitfall 6, T-4-05).
 *
 * Three guards — no-google-credential, no-network, field-mask-tier — each used to carry a
 * private `walk()`. Once `withWorkflow` is wired, `next build` / `next dev` write compiled
 * workflow routes under `src/app/.well-known/workflow/**`. Those bundles inline step code,
 * including the Places client, so a guard that reads them reports the one sanctioned module
 * a second time from generated output — and the tempting "fix" is to widen an allow-list,
 * which is how a guard dies. The exclusion lives here, once, and tests/unit/walk.test.ts
 * proves it.
 *
 * An exclusion is a hole, so it is as narrow as it can be: a WHOLE path-segment match on
 * `app/.well-known/workflow`. A sibling such as `workflow-notes/` or a directory merely
 * ending in `app` (e.g. `myapp/.well-known/workflow`) is still walked.
 *
 * Each caller keeps its own two-sided assertion (it found real files, including a pinned
 * one) — this module does not make an empty walk look like a clean one.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/** `next build` / `next dev` write the compiled workflow routes here (04-RESEARCH Pitfall 6).
 *  They bundle step code — including the Places client — so a walker that reads them reports
 *  the one sanctioned module a second time from generated output. */
export const GENERATED_EXCLUDES: readonly string[] = [
  nodePath.join('app', '.well-known', 'workflow'),
];

/** True when `full` IS an excluded path or lies beneath one, matched on segment boundaries. */
function isExcluded(full: string, exclude: readonly string[]): boolean {
  const bounded = nodePath.sep + full + nodePath.sep;
  return exclude.some((x) => bounded.includes(nodePath.sep + x + nodePath.sep));
}

/**
 * Recursively list files under `dir`, skipping `exclude` (default: GENERATED_EXCLUDES).
 * `exts` restricts by extension (`'.ts'`, with the dot); omit it to return every file.
 * Paths are joined with the platform separator — callers that compare against posix
 * literals convert them.
 */
export function walk(
  dir: string,
  opts: { exts?: ReadonlySet<string>; exclude?: readonly string[] } = {},
  found: string[] = [],
): string[] {
  const exclude = opts.exclude ?? GENERATED_EXCLUDES;
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (isExcluded(full, exclude)) continue;
    if (entry.isDirectory()) walk(full, opts, found);
    else if (opts.exts === undefined || opts.exts.has(nodePath.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}
