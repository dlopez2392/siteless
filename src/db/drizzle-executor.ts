import { sql, type SQL, type SQLChunk } from 'drizzle-orm';
import type { EtlExecutor } from '@/lib/ingest/etl-actor';

/**
 * The pg-style `{ query(text, params) }` executor (`EtlExecutor`) over a drizzle transaction.
 *
 * WHY THIS EXISTS. `src/lib/resolve/merge.ts` is shared by the desk resolve pass (an owner `pg`
 * connection) and the review server actions (a Clerk user inside `withOrg`). It speaks
 * positional `$n` SQL, because that is what the desk tier speaks. The app tier holds a drizzle
 * transaction, whose only raw entry point is `tx.execute(sql)`. This file is the one bridge:
 * `$n` placeholders → drizzle `sql` chunks, every value a bound parameter, nothing
 * interpolated into statement text.
 *
 * 🔴 EVERY VALUE IS BOUND AS EXACTLY ONE PARAMETER. `sql.param(v)`, never `sql\`${v}\``: the
 * template form EXPANDS a JS array into N placeholders, so `$1::uuid[]` would reach Postgres as
 * `($1,$2)::uuid[]` — a ROW cast to an array, `42846` at two elements and `22P02` at one. That
 * exact defect shipped green under typecheck, lint and build in phase 2 (plan 02-12, found only
 * by pressing the button).
 *
 * 🔴 AN ARRAY IS SENT AS ONE ARRAY-LITERAL STRING, and the SQL casts it (`$1::uuid[]`). The
 * runtime driver (postgres.js through drizzle, `prepare: false`) infers an array's type from
 * its first element and would send a string array as an array of `unknown`; the literal is the
 * form whose meaning does not depend on that inference. Every element is double-quoted with
 * `\` and `"` escaped, so a comma, a brace, a quote or the four letters NULL inside a string
 * cannot change the element count or turn a value into SQL NULL. A JS `null` element is the
 * unquoted `NULL`.
 *
 * 🔴 A `Date` IS REFUSED, LOUDLY. drizzle's postgres-js driver installs a pass-through
 * serializer for every date/time oid, so a bound `Date` reaches postgres.js's wire writer as an
 * object and throws `ERR_INVALID_ARG_TYPE ... Received an instance of Date` from deep inside a
 * "Failed query" wrapper (plan 02-13, deviation 1). Refusing here names the parameter and the
 * fix — bind `d.toISOString()` with an explicit `::timestamptz` — instead of letting it surface
 * as an opaque driver error. Plain objects are refused for the same reason (bind
 * `JSON.stringify(o)` with `::jsonb`: the json serializers are pass-through too).
 *
 * PARITY WITH `pg`. A `pg` client refuses a statement whose parameter count disagrees with its
 * placeholders ("bind message supplies 3 parameters, but prepared statement requires 2"). This
 * adapter refuses the same two mistakes — a `$n` past the end, and a parameter no placeholder
 * reads — so a statement that works through the desk executor cannot silently mean something
 * else through this one.
 *
 * WHAT THE SCANNER KNOWS ABOUT SQL. `$n` is only a placeholder OUTSIDE a single-quoted literal
 * ('' escapes), a double-quoted identifier, a `--` line comment and a block comment. Dollar-
 * quoted bodies and `E'...'` escape strings are refused rather than half-parsed — nothing that
 * runs through here uses either, and a scanner that guesses is how a `$1` inside a string
 * becomes a bound value.
 *
 * NO `server-only` HERE. The adapter carries no secret and constructs no client; it is
 * imported by server actions and by the tests that prove it against the real database.
 */

/** The narrowest drizzle surface the adapter needs. A postgres-js transaction satisfies it. */
export interface DrizzleExecuteTarget {
  execute(query: SQL): PromiseLike<unknown>;
}

const IDENT_CHAR = /[A-Za-z0-9_]/;

function arrayElement(value: unknown, n: number): string {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) {
    throw new TypeError(`drizzleExecutor: $${n} is a nested array; bind one dimension only`);
  }
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`drizzleExecutor: $${n} contains a non-finite number (${value})`);
    }
    text = String(value);
  } else if (typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else {
    throw new TypeError(
      `drizzleExecutor: $${n} contains a ${value instanceof Date ? 'Date' : typeof value}; ` +
        'array elements must be strings, numbers, booleans, bigints or null',
    );
  }
  return '"' + text.replace(/[\\"]/g, (c) => '\\' + c) + '"';
}

/** One JS value → the single value bound for one placeholder. Exported for the unit test. */
export function encodeParam(value: unknown, n: number): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`drizzleExecutor: $${n} is a non-finite number (${value})`);
    }
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return '{' + value.map((v) => arrayElement(v, n)).join(',') + '}';
  if (value instanceof Date) {
    throw new TypeError(
      `drizzleExecutor: $${n} is a Date. The runtime driver cannot bind one through ` +
        'tx.execute; bind d.toISOString() and cast it ::timestamptz.',
    );
  }
  throw new TypeError(
    `drizzleExecutor: $${n} is a ${typeof value}; bind JSON.stringify(value) and cast it ::jsonb`,
  );
}

/** Index just past the closing `quote`, honouring the doubled-quote escape. */
function skipQuoted(text: string, start: number, quote: "'" | '"'): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  throw new SyntaxError(`drizzleExecutor: unterminated ${quote === "'" ? 'string literal' : 'quoted identifier'}`);
}

/**
 * Positional SQL → one drizzle `SQL`. Pure: no database, so the unit suite pins the exact
 * statement text and parameter list it produces.
 */
export function positionalToSql(text: string, params: readonly unknown[] = []): SQL {
  const chunks: SQLChunk[] = [];
  const used = new Set<number>();
  let last = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    const prev = i > 0 ? text[i - 1]! : '';

    if ((ch === 'E' || ch === 'e') && next === "'" && !IDENT_CHAR.test(prev)) {
      throw new SyntaxError("drizzleExecutor: E'...' escape strings are not supported");
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(text, i, ch);
      continue;
    }
    if (ch === '-' && next === '-') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError('drizzleExecutor: unterminated block comment');
      i = end + 2;
      continue;
    }
    if (ch === '$') {
      const placeholder = /^\$(\d+)/.exec(text.slice(i));
      if (placeholder && !IDENT_CHAR.test(prev)) {
        const n = Number(placeholder[1]);
        if (n < 1 || n > params.length) {
          throw new RangeError(
            `drizzleExecutor: $${n} has no parameter (${params.length} supplied)`,
          );
        }
        chunks.push(sql.raw(text.slice(last, i)));
        chunks.push(sql.param(encodeParam(params[n - 1], n)));
        used.add(n);
        i += placeholder[0].length;
        last = i;
        continue;
      }
      if (/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(text.slice(i)) && !IDENT_CHAR.test(prev)) {
        throw new SyntaxError('drizzleExecutor: dollar-quoted strings are not supported');
      }
    }
    i += 1;
  }
  chunks.push(sql.raw(text.slice(last)));

  for (let n = 1; n <= params.length; n += 1) {
    if (!used.has(n)) {
      throw new RangeError(
        `drizzleExecutor: parameter $${n} is supplied but no placeholder reads it`,
      );
    }
  }
  return sql.join(chunks);
}

/** The rows of whatever `execute` returned: postgres.js's RowList IS an array. */
function rowsOfResult<R>(result: unknown): R[] {
  if (Array.isArray(result)) return [...(result as R[])];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return [...((result as { rows: R[] }).rows)];
  }
  throw new TypeError('drizzleExecutor: execute() returned neither a row list nor { rows }');
}

export function drizzleExecutor(tx: DrizzleExecuteTarget): EtlExecutor {
  return {
    async query<R = Record<string, unknown>>(text: string, params?: unknown[]) {
      const result = await tx.execute(positionalToSql(text, params ?? []));
      return { rows: rowsOfResult<R>(result) };
    },
  };
}
