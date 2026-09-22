/**
 * The one uuid guard, for route segments that reach a `where id = ...`.
 *
 * 🔴 WHY THIS IS A GUARD AND NOT A NICETY. PostgreSQL answers a malformed uuid with
 * `22P02 invalid input syntax for type uuid`, which surfaces as a 500 on the page. So
 * `/presets/not-a-uuid` is a CRASH where the honest answer is "we couldn't find that
 * preset" — and a mistyped or truncated link is the ordinary way people arrive at one.
 *
 * 🔴 WHY IT LIVES HERE RATHER THAN IN THE PAGE THAT FIRST NEEDED IT. It did live in the
 * page. `/presets/[id]` carried the regex; `/presets/[id]/edit`, written afterwards against
 * the same query module, did not — so one route 404'd and its sibling 500'd on the same bad
 * url (WR-08). A guard that has to be remembered gets copied until it isn't. One module, and
 * `tests/unit/ids.test.ts` walks every `[id]` route to prove each one calls it.
 *
 * 🔴 ANCHORED AT BOTH ENDS, DELIBERATELY. Without `^` and `$` the pattern matches a uuid
 * ANYWHERE in the segment, and what reaches the query is the whole string — which is how a
 * validator becomes decoration. Case-insensitive because Postgres accepts either casing and
 * a guard standing in front of it must not be stricter than the thing it guards.
 *
 * NO `"use client"` IN THIS FILE, EVER. It is imported by server components, and a client
 * directive would turn `isUuid` into a client reference that arrives `undefined` at runtime
 * with typecheck, lint and build all green (UI-SPEC Executor Rule 5, two recorded BIS 500s).
 * It exports a plain function and nothing else for the same reason.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape only — this says nothing about whether the row exists or whether the caller may see
 * it. Both of those are RLS's answer, and the page must still treat "not visible" and "not
 * there" as one outcome (T-2-10).
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
