/**
 * Pitfall 1's guard: the local database is PostgreSQL 18.6, CI runs `postgres:18`, and
 * PRODUCTION IS 17.6.
 *
 * A PG 18-only statement therefore passes `test:db`, passes CI, and is refused by
 * `db:migrate:prod` — after the migration before it has already been applied. The live trap
 * is `update … returning old.x, new.x`: verified accepted on the local server and absent
 * from 17. `uuidv7()` and virtual generated columns are the same class of mistake.
 *
 * 🔴 SQL COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not a nicety. A migration that
 * carried a header paragraph explaining "never write `returning old.`" would otherwise fail
 * this test for saying so — the self-invalidating grep gate, where the only way back to
 * green is to delete the warning or delete the guard. The companion test below proves the
 * stripper discriminates in BOTH directions; without that pair the stripper itself is
 * untested and could silently be stripping everything.
 *
 * Two-sided, per tests/unit/no-internal-leak.test.ts: the file list is asserted non-empty,
 * so a wrong directory cannot pass by reading nothing.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = 'drizzle';

/** Phase 1 shipped twelve migrations. This floor only ever rises. */
const MIGRATIONS_AT_PHASE_1 = 12;

const PG18_ONLY: Array<{ label: string; re: RegExp }> = [
  { label: 'RETURNING old.* (PostgreSQL 18)', re: /returning\s+old\./i },
  { label: 'RETURNING new.* (PostgreSQL 18)', re: /returning\s+new\./i },
  { label: 'uuidv7() (PostgreSQL 18)', re: /uuidv7\s*\(/i },
  {
    label: 'VIRTUAL generated column (PostgreSQL 18)',
    re: /generated\s+always\s+as\s*\(.*\)\s*virtual/i,
  },
];

/**
 * Drop `/* … *&#47;` blocks, then every line whose first non-space characters are `--`.
 *
 * Blocks first: a `--` inside a block comment would otherwise leave the block's remaining
 * lines looking like live SQL. Exported so the companion test can exercise the real
 * function rather than a copy of it — a re-implemented stripper in the test proves only
 * that the copy works.
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function findViolations(sql: string, file: string): string[] {
  const stripped = stripSqlComments(sql);
  const out: string[] = [];
  stripped.split(/\r?\n/).forEach((line, i) => {
    for (const { label, re } of PG18_ONLY) {
      const m = re.exec(line);
      if (m) out.push(`${file}:${i + 1} [${label}] ${m[0]} — in: ${line.trim()}`);
    }
  });
  return out;
}

describe('production is PostgreSQL 17.6', () => {
  it('pg17: no migration uses PostgreSQL 18-only syntax', () => {
    const files = nodeFs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // The two-sided half: a wrong directory reads nothing and would pass silently.
    expect(files.length).toBeGreaterThanOrEqual(MIGRATIONS_AT_PHASE_1);
    expect(files).toContain('0000_bootstrap.sql');

    const violations: string[] = [];
    for (const f of files) {
      const sql = nodeFs.readFileSync(nodePath.join(MIGRATIONS_DIR, f), 'utf8');
      // Prove we read a real migration rather than an empty file.
      expect(sql.length, f).toBeGreaterThan(0);
      violations.push(...findViolations(sql, nodePath.join(MIGRATIONS_DIR, f)));
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('pg17: the comment-stripping guard is not self-invalidating', () => {
    // A line comment explaining the rule must NOT trip the rule.
    expect(
      findViolations('-- never write: update t set a = 1 returning old.a;\nselect 1;', 'x.sql'),
    ).toEqual([]);

    // Indented, and the whole-block form too.
    expect(findViolations('    -- returning new.a is PG18 only\nselect 1;', 'x.sql')).toEqual([]);
    expect(
      findViolations('/* uuidv7() does not exist in 17\n   nor does returning old.a */\nselect 1;', 'x.sql'),
    ).toEqual([]);

    // …and the SAME tokens in real SQL must still fail, or the stripper is just deleting
    // everything and the test above is green for the wrong reason.
    expect(findViolations('update t set a = 1 returning old.a;', 'x.sql')).toHaveLength(1);
    expect(findViolations('update t set a = 1 returning new.a;', 'x.sql')).toHaveLength(1);
    expect(findViolations('select uuidv7();', 'x.sql')).toHaveLength(1);
    expect(
      findViolations('alter table t add column c text generated always as (a || b) virtual;', 'x.sql'),
    ).toHaveLength(1);

    // The failure message names the file and the matched text.
    const one = findViolations('update t set a = 1 returning old.a;', 'drizzle/9999_x.sql')[0];
    expect(one).toContain('drizzle/9999_x.sql');
    expect(one).toContain('returning old.');

    // Live SQL on the line AFTER a comment is still scanned — the stripper removes lines,
    // it does not stop reading at the first comment.
    expect(
      findViolations('-- a header paragraph\nupdate t set a = 1 returning old.a;', 'x.sql'),
    ).toHaveLength(1);

    // A trailing comment does not disarm the statement it sits on.
    expect(findViolations('select uuidv7(); -- oops', 'x.sql')).toHaveLength(1);

    // And ordinary PG17-safe SQL passes: NULLS NOT DISTINCT (15+) and MAINTAIN (17+) are
    // both fine, and `returning` on its own is not the problem.
    expect(
      findViolations(
        'create unique index i on t (a) nulls not distinct;\nupdate t set a = 1 returning a;',
        'x.sql',
      ),
    ).toEqual([]);
  });
});
