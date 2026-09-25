/**
 * The one shape every server action returns.
 *
 * 🔴 AN EXPECTED REFUSAL IS A RESULT, NEVER A THROWN EXCEPTION. The cap is spent, the
 * version moved while you were editing, the geocoder found nothing, you are not an admin —
 * every one of those is a sentence UI-SPEC has already written, and every one of them
 * arrives here as `{ ok: false, code, message }`. Only a genuine bug throws, and a thrown
 * action is a 500 the UI has no copy for.
 *
 * WHY THE FILE NAME STARTS WITH AN UNDERSCORE. A module carrying the server directive may
 * only export async functions — a type or a plain helper exported from one is a build
 * error. So the contract lives beside the actions rather than inside one of them, and
 * `tests/unit/server-actions-guard.test.ts` skips `_`-prefixed files for exactly that
 * reason: this file is not an action and must not be required to look like one.
 *
 * `code` is a closed union on purpose. A screen switches on it, and a free-form string
 * would let a new failure mode reach the UI with no branch to render it.
 */

export type ActionErrorCode =
  /** No session, or no ACTIVATED organization on it. Should be unreachable from a rendered
   *  page — `requireOrg()` redirects first — and is here for the direct-POST path. */
  | 'unauthorized'
  /** Authenticated, but not allowed. The admin gate on the cap is the only one in Phase 2. */
  | 'forbidden'
  /** Confined by RLS, so a foreign id is indistinguishable from a deleted one, which is the
   *  intended answer: never confirm to a wrong-tenant caller that a resource exists. */
  | 'not_found'
  /** Somebody else saved first. Carries the current version number in `detail`. */
  | 'conflict'
  /** The meter refused. `app.reserve_budget` returned a null reservation id, and nothing
   *  was called and nothing was charged. */
  | 'budget_refused'
  /** D-02. `PLACES_MODE` forbids this run kind (`off` forbids every run; `ids_only` every
   *  run but the free change check). Refused before any row or reservation exists. */
  | 'mode_refused'
  /** The input did not parse, or named something that is not seeded. */
  | 'validation'
  /** A third party did not answer. In Phase 2 that is the Census geocoder and nothing else. */
  | 'upstream'
  /** A bug. The only code a user should never see a tailored sentence for. */
  | 'unexpected';

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      /** Numbers and strings a screen needs to render its own copy — the current version
       *  for a save conflict, the percentage after a refused reservation. Deliberately not
       *  `unknown`: anything richer than this belongs in `data` on a successful result. */
      detail?: Record<string, string | number>;
    };

/** Narrowing helper so a caller writes `if (isOk(r))` rather than re-deriving the union. */
export function isOk<T>(result: ActionResult<T>): result is { ok: true; data: T } {
  return result.ok;
}

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T>(
  code: ActionErrorCode,
  message: string,
  detail?: Record<string, string | number>,
): ActionResult<T> {
  return detail === undefined ? { ok: false, code, message } : { ok: false, code, message, detail };
}
