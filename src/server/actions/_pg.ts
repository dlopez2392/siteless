/**
 * Reading a PostgreSQL refusal out of whatever the driver stack wrapped it in.
 *
 * 🔴 THE SQLSTATE IS NOT ON THE ERROR YOU CATCH. drizzle's pg-core session wraps every
 * failure in a `DrizzleQueryError` whose `cause` is the postgres.js error carrying `code`
 * and `constraint_name` `[VERIFIED: drizzle-orm@0.45.2 errors.d.ts + pg-core/session.js;
 * postgres.js 3.4.9 connection.js maps error field 110 to constraint_name]`. Matching on
 * `err.code` alone therefore matches nothing, silently, and every expected refusal in this
 * phase becomes a 500 with no copy — `23505` on a concurrent save, `42501` on a non-admin
 * cap change, `23514` on a cap below what is already committed.
 *
 * 🔴 AND THE CONSTRAINT NAME IS PART OF THE MATCH, NOT DECORATION. `23505` means "some
 * unique constraint", and the only one this phase EXPECTS is
 * `search_versions_search_version_uniq`. A different 23505 — a duplicate built-in, a
 * request id replayed into the ledger — is a bug, and reporting it as "this preset changed
 * while you were editing" would send the user to reload a page that was never stale.
 *
 * This file is `_`-prefixed and exports no action: `tests/unit/server-actions-guard.test.ts`
 * skips it for that reason, and a module carrying the server directive may export nothing
 * but async functions anyway.
 */

export type PgFailure = { code: string; constraint: string | null; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The first error in the `cause` chain that carries a SQLSTATE. Bounded at eight links so a
 * cyclic or pathological chain cannot spin.
 */
export function pgFailure(error: unknown): PgFailure | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && isRecord(current); depth += 1) {
    const code = current.code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      const constraint = current.constraint_name;
      const message = current.message;
      return {
        code,
        constraint: typeof constraint === 'string' ? constraint : null,
        message: typeof message === 'string' ? message : '',
      };
    }
    current = current.cause;
  }
  return null;
}

/** `23505` raised by one NAMED constraint. Both halves, always — see the header. */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  const failure = pgFailure(error);
  return failure?.code === '23505' && failure.constraint === constraint;
}

/** `23514` raised by one NAMED check constraint. */
export function isCheckViolationOn(error: unknown, constraint: string): boolean {
  const failure = pgFailure(error);
  return failure?.code === '23514' && failure.constraint === constraint;
}

/**
 * `42501`. Deliberately NOT narrowed to a constraint: this one arrives from two places with
 * two different messages — `app.set_budget_cap: admin role required` from the definer, and
 * `permission denied for table budget_periods` from the grant layer one step earlier — and
 * both mean the same thing to the person who pressed the button.
 */
export function isInsufficientPrivilege(error: unknown): boolean {
  return pgFailure(error)?.code === '42501';
}
