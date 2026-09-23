/**
 * The positional-SQL → drizzle adapter (src/db/drizzle-executor.ts), statement text and
 * parameter list only. What the real driver does with them is tests/db/review-actions.test.ts
 * ('drizzle executor ...'), against the database — a statement this file approves can still be
 * one Postgres refuses, and only the DB test can see that.
 *
 * 🔴 THE TRAP THIS FILE PINS: a JS array in a drizzle `sql` template becomes N placeholders.
 * The adapter must bind an array as ONE parameter, or `$1::uuid[]` reaches Postgres as
 * `($1,$2)::uuid[]` — 42846 at two elements, 22P02 at one (plan 02-12).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { drizzleExecutor, encodeParam, positionalToSql } from '@/db/drizzle-executor';

const dialect = new PgDialect();
const render = (text: string, params: unknown[] = []) =>
  dialect.sqlToQuery(positionalToSql(text, params));

describe('drizzle executor', () => {
  it('binds every $n as exactly one parameter, in order, with the text untouched', () => {
    const q = render('select app.record_merge($1::uuid, $2::uuid, $3::int, $4::jsonb) as id', [
      'a',
      'b',
      95,
      '{"name":45}',
    ]);
    expect(q.sql).toBe('select app.record_merge($1::uuid, $2::uuid, $3::int, $4::jsonb) as id');
    expect(q.params).toEqual(['a', 'b', 95, '{"name":45}']);
  });

  it('binds an array as ONE array-literal parameter, never N placeholders', () => {
    const one = render('select $1::uuid[] as ids', [['11111111-1111-4111-8111-111111111111']]);
    expect(one.sql).toBe('select $1::uuid[] as ids');
    expect(one.params).toEqual(['{"11111111-1111-4111-8111-111111111111"}']);

    const two = render('select $1::text[] as t, $2 as n', [['a,b', 'q"uote\\', null, 'NULL'], 7]);
    expect(two.sql).toBe('select $1::text[] as t, $2 as n');
    expect(two.params).toEqual(['{"a,b","q\\"uote\\\\",NULL,"NULL"}', 7]);
  });

  it('reuses a placeholder number as a repeated bind of the same value', () => {
    const q = render('select $1::uuid = $1::uuid and $2 = $2', ['x', 3]);
    expect(q.sql).toBe('select $1::uuid = $2::uuid and $3 = $4');
    expect(q.params).toEqual(['x', 'x', 3, 3]);
  });

  it('leaves $n inside literals, quoted identifiers and comments alone', () => {
    const q = render(
      `select '$1 it''s' as "col$2", $1 -- not $2 here\n /* nor $2 */ , $2`,
      ['a', 'b'],
    );
    expect(q.sql).toBe(`select '$1 it''s' as "col$2", $1 -- not $2 here\n /* nor $2 */ , $2`);
    expect(q.params).toEqual(['a', 'b']);
  });

  it('refuses what pg would refuse: a missing parameter and an unread one', () => {
    expect(() => positionalToSql('select $2', ['a'])).toThrow(/\$2 has no parameter/);
    expect(() => positionalToSql('select $1', ['a', 'b'])).toThrow(/\$2 is supplied/);
  });

  it('refuses a Date, a plain object, a non-finite number and a nested array by name', () => {
    expect(() => encodeParam(new Date(0), 3)).toThrow(/\$3 is a Date.*toISOString/);
    expect(() => encodeParam({ a: 1 }, 1)).toThrow(/JSON\.stringify/);
    expect(() => encodeParam(Number.NaN, 1)).toThrow(/non-finite/);
    expect(() => encodeParam([['a']], 1)).toThrow(/nested array/);
    expect(() => encodeParam([new Date(0)], 2)).toThrow(/\$2 contains a Date/);
    expect(encodeParam(12n, 1)).toBe('12');
    expect(encodeParam(undefined, 1)).toBeNull();
  });

  it('refuses dollar-quoted bodies and E-strings rather than half-parsing them', () => {
    expect(() => positionalToSql('select $$ $1 $$', [])).toThrow(/dollar-quoted/);
    expect(() => positionalToSql('select $tag$ x $tag$', [])).toThrow(/dollar-quoted/);
    expect(() => positionalToSql("select E'\\'' || $1", ['a'])).toThrow(/E'/);
  });

  it('returns the driver rows as a plain array, from a row list or a { rows } result', async () => {
    const list = Object.assign([{ a: 1 }], { count: 1 });
    const fromList = await drizzleExecutor({ execute: async () => list }).query('select 1');
    expect(fromList.rows).toEqual([{ a: 1 }]);
    const fromRows = await drizzleExecutor({ execute: async () => ({ rows: [{ b: 2 }] }) }).query(
      'select 1',
    );
    expect(fromRows.rows).toEqual([{ b: 2 }]);
  });
});
