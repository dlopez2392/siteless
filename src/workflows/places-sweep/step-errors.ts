/**
 * What a places-sweep step does with an error it did not write (B-WR-07, B-CR-02).
 *
 * 🔴 DRIZZLE WRAPS EVERY QUERY ERROR. drizzle-orm 0.45 (`pg-core/session.js`) throws
 * `new DrizzleQueryError(query, params, e)` for every failed `tx.execute`: no `code` of its own,
 * `name` left at `Error`, the driver's error (postgres.js `PostgresError`, which carries the
 * SQLSTATE `code`) on `.cause`, and a MESSAGE that quotes the query and its params. Some params
 * are derived from a Places response, so the message is never read, never echoed. The SQLSTATE
 * is found by walking `.cause`.
 *
 * 🔴 A DETERMINISTIC FAULT IS FATAL. A step's database write happens AFTER its Places page was
 * bought. A refusal that will refuse the same way on a retry — a data exception (class 22), an
 * integrity violation (23), a syntax/privilege error (42), or `toPageRecord` refusing its own
 * record — must not be retried: every retry would settle the attempt as charged and buy the page
 * again, for nothing (B-CR-02 case 2). Transient classes (40 serialization/deadlock, 08
 * connection, 53 resources, 57 operator intervention) stay retryable.
 *
 * Pure: no I/O, no workflow runtime. steps.ts turns these answers into `FatalError` / a plain
 * (retryable) Error.
 */
import { PageRecordRefusal } from '@/lib/places/page-record';

/** A SQLSTATE: five characters of digits and upper-case letters. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** SQLSTATE classes that fail the same way on a retry. */
const DETERMINISTIC_CLASSES = new Set(['22', '23', '42']);

/** How far down `.cause` to look — drizzle nests one level; the bound stops a cycle. */
const MAX_CAUSE_DEPTH = 4;

/** The SQLSTATE of `e` or of anything on its `.cause` chain; `null` when there is none. */
export function sqlstateOf(e: unknown): string | null {
  let cur: unknown = e;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof cur !== 'object' || cur === null) return null;
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** An error the step did not write, reduced to what is safe to persist: a SQLSTATE or a name.
 *  The message is never read (it can quote a Places-derived query parameter). */
export function stepError(e: unknown): Error {
  const code = sqlstateOf(e) ?? (e instanceof Error ? e.name : 'unknown');
  return new Error(`step_error:${code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}`);
}

/** True when retrying the step cannot help: a deterministic database refusal, or a page record
 *  `toPageRecord` refused. */
export function isDeterministicFault(e: unknown): boolean {
  // By name as well as by class: a bundler that duplicated the module would split the class.
  if (e instanceof PageRecordRefusal || (e instanceof Error && e.name === 'PageRecordRefusal')) {
    return true;
  }
  const code = sqlstateOf(e);
  return code !== null && DETERMINISTIC_CLASSES.has(code.slice(0, 2));
}
