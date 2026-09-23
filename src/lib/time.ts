/**
 * The one place a timezone is named.
 *
 * WHAT THIS PREVENTS. BIS's `lib/zone.ts` records the cost of not having this: five
 * screens each grew their own answer for the same question — four clamped silently to
 * UTC, the work queue omitted the date rather than guess, and the account dashboard did
 * BOTH, fifty lines apart. Nobody decided that; each screen was written correctly in
 * isolation and the disagreement only existed between them.
 *
 * So: one exported constant, one exported locale, and every formatter in the app goes
 * through this module. `grep -rn "America/Chicago" src/` must only ever name this file.
 *
 * NEVER the single-argument `Date` locale formatters. They format in the SYSTEM zone and
 * the SYSTEM locale, which on this dev machine is the right answer by coincidence and on
 * Vercel is UTC — the same lead showing two different days depending on who rendered it.
 * The repo grep that enforces that is a bare token search over `src/`, so this comment
 * deliberately does not spell the method name: naming it here would trip the guard.
 */

/** The RGV is America/Chicago. This is the only file in src/ that names a zone. */
export const APP_TZ = 'America/Chicago';

/**
 * Pinned too, and it is not cosmetic: an unpinned locale resolves from the environment,
 * so the server and the browser can disagree. In BIS an `es-*` browser locale against a
 * server that resolved `en-US` produced an SSR hydration mismatch on a rendered date.
 */
export const APP_LOCALE = 'en-US';

/**
 * 'YYYY-MM-DD' in an EXPLICIT zone. Never derive a day bucket from the process zone.
 *
 * `formatToParts` rather than a formatted string, because `en-US`'s own date order is
 * M/D/Y and re-parsing that back into ISO order is exactly the kind of step that works
 * until someone changes the locale.
 *
 * The `timeZone` parameter exists so a caller can ask for a DIFFERENT zone deliberately —
 * which is what makes the discriminating pair in tests/unit/time.test.ts expressible:
 * one instant, two zones, opposite verdicts. It defaults to APP_TZ so forgetting it is
 * still correct.
 */
export function localDate(instant: Date, timeZone: string = APP_TZ): string {
  const parts = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

/**
 * Format an instant for a human, in the app's zone.
 *
 * `timeZone` comes AFTER the spread so a caller cannot accidentally override it — a
 * component passing a whole options object it received from somewhere else cannot drag
 * a stale zone in with it. The spread order is load-bearing and there is a test on it.
 */
export function formatLocal(instant: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { ...options, timeZone: APP_TZ }).format(instant);
}

/**
 * A whole-number count for a human — "35,270" — with the locale pinned.
 *
 * Added for `/sources` (03-17), whose components may not call `Intl` directly (03-UI-SPEC
 * Executor Rule 26). Same reason as the date helpers: an unpinned locale resolves from the
 * environment, and an `es-*` browser renders "35.270" against a server's "35,270" — a
 * hydration mismatch on the very digits the ledger exists to show.
 */
export function formatCount(n: number): string {
  return new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 }).format(n);
}
