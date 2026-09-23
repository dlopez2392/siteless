/**
 * DEDUP-04 / D-12 — the parity guard. Mutation M24's target.
 *
 * The Postgres accent-folding function is STABLE, not IMMUTABLE (measured: 42P17 on both a
 * generated column and an expression index), so the normalized columns are plain columns
 * written by src/lib/normalize/ and SQL NEVER normalizes. The two implementations genuinely
 * disagree on ø æ ß œ Ł đ ı until a ligature table closes the gap, and a blocker and a scorer
 * that disagree about a key produce candidate pairs that vanish when re-scored. So a call to
 * the SQL function anywhere in a blocking or scoring path is a correctness bug, not a style
 * choice, and this walk is what keeps it out.
 *
 * Allow-list, exactly:
 *   1. drizzle/0021_extensions.sql: the `create extension` migration.
 *   2. The single /businesses free-text search predicate (src/server/queries/businesses.ts),
 *      added by plan 03-15 IN THE SAME COMMIT as the predicate. It folds what a person typed
 *      against what a source spelled; neither side is a match key, so it is not a blocking or
 *      scoring path. The allow-list is exactly these two named paths, never a directory.
 *
 * Hygiene: this file names the forbidden call only through a constructed string, so it never
 * matches itself. It lives under tests/, which the walk does not cover. Comment lines
 * (`--`, `//`, `/*`, ` *`, `#`) are filtered before matching, so a header sentence about the
 * function does not trip the guard. That is the same arrangement src/lib/ui/run-tone.ts
 * documents.
 *
 * Two-sided, like no-google-credential.test.ts: the walk must find the files it is meant to
 * scan. A scan that proves only absence is green when a wrong glob makes it scan nothing.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

/** The forbidden call, constructed so this file is not its own violation. Case-insensitive
 *  (SQL is), tolerant of whitespace before the paren, and it also matches `public.` + name. */
const FORBIDDEN = new RegExp('unacc' + 'ent\\s*\\(', 'i');

const ALLOWED = new Set(['drizzle/0021_extensions.sql', 'src/server/queries/businesses.ts']);

// A comment line in TS or SQL: the plan's grep -v filter, as a regex. (A line comment, not a
// block comment, because the character class below contains the block-comment terminator.)
const COMMENT_LINE = /^\s*[-*/#]/;

function walk(dir: string, exts: ReadonlySet<string>, found: string[] = []): string[] {
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, found);
    else if (exts.has(nodePath.extname(entry.name))) found.push(full);
  }
  return found;
}

const toPosix = (p: string) => p.split(nodePath.sep).join('/');

describe('the normalizer is the only normalizer', () => {
  it('SQL never normalizes', () => {
    const src = walk('src', new Set(['.ts', '.tsx']));
    // drizzle/*.sql only: the top-level migrations, not drizzle/meta snapshots.
    const sql = nodeFs
      .readdirSync('drizzle')
      .filter((f) => f.endsWith('.sql'))
      .map((f) => nodePath.join('drizzle', f));
    const scanned = [...src, ...sql].map(toPosix);

    // The two-sided half.
    expect(src.length).toBeGreaterThan(15);
    expect(sql.length).toBeGreaterThan(20);
    expect(scanned).toContain('src/lib/normalize/name.ts');
    expect(scanned).toContain('drizzle/0021_extensions.sql');

    const offences: string[] = [];
    for (const file of scanned) {
      if (ALLOWED.has(file)) continue;
      const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (FORBIDDEN.test(line)) offences.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }

    // Name the file AND the line. A guard that reports only "false" costs an hour.
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
