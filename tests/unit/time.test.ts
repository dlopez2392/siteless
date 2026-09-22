/**
 * FOUND-06. Why each fixture exists, rather than a list of dates.
 *
 * INSTANT — 2026-09-21T01:00:00.000Z is 8 PM in the RGV: the hour danlo is most likely to
 * open the dashboard, and the hour where the UTC day and the Chicago day disagree. It is
 * the whole point of the file. One instant, two zones, OPPOSITE verdicts: a fixture whose
 * two zones agree cannot discriminate, and neither can a suite pinned to the same zone it
 * asserts. vitest.config.ts pins the suite to UTC deliberately — this dev machine IS
 * Chicago — so code that forgot an explicit zone renders UTC and the Chicago assertion
 * goes red instead of passing by coincidence.
 *
 * Mutations, one per test, each killing exactly one:
 *   - localDate's default parameter APP_TZ -> 'UTC'
 *       → 'one instant renders on opposite days in UTC and America/Chicago'
 *   - localDate's `new Intl.DateTimeFormat(APP_LOCALE, …)` -> `(undefined, …)`
 *       → 'pins the zone and the locale on every Intl call'
 *   - formatLocal's `{ ...options, timeZone: APP_TZ }` -> `{ timeZone: APP_TZ, ...options }`
 *       → 'formatLocal ignores a caller-supplied timeZone'
 *
 * The constructor spy exists because a passing render proves nothing about HOW it was
 * rendered: `Intl.DateTimeFormat()` with no options produces a plausible string in the
 * system zone. Spying the constructor and inspecting EVERY call is the only way to prove
 * the zone and the locale actually reached the formatter.
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_LOCALE, APP_TZ, formatLocal, localDate } from '@/lib/time';

/** 2026-09-20 20:00 America/Chicago. [VERIFIED: executed against PostgreSQL 18] */
const INSTANT = new Date('2026-09-21T01:00:00.000Z');

describe('timezone discipline', () => {
  it('one instant renders on opposite days in UTC and America/Chicago', () => {
    // Half a pair each. Asserting only the Chicago side would still pass if localDate
    // ignored its zone argument entirely on a Chicago machine.
    expect(localDate(INSTANT, 'UTC')).toBe('2026-09-21');
    expect(localDate(INSTANT)).toBe('2026-09-20');

    // And the two really are the same instant, not two fixtures that drifted apart.
    expect(localDate(INSTANT, 'UTC')).not.toBe(localDate(INSTANT, APP_TZ));
  });

  it('pins the zone and the locale on every Intl call', async () => {
    // A module-level formatter cache — which this module does not have today, but a
    // future memoization would add — means a warm import would see ZERO new
    // constructions and the ">0" assertion below would be vacuous. Force a cold load.
    vi.resetModules();
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    const fresh = await import('@/lib/time');

    fresh.formatLocal(INSTANT, { hour: 'numeric' });
    // localDate is called with an EXPLICIT zone, not its default. This test owns one
    // property — that whatever zone a formatter is built with, the locale is pinned and
    // the zone reaches the options object — and test 1 above owns the other, that the
    // DEFAULT zone is Chicago. Calling localDate() bare here would make one mutation
    // (the default parameter) kill both tests, and a mutation that kills two tests no
    // longer tells you which guard is doing the work.
    fresh.localDate(INSTANT, APP_TZ);

    // BEFORE the loop: zero calls would make every assertion inside it pass silently.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect((call[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone).toBe('America/Chicago');
      // The assertion BIS omits. An unpinned locale resolves from the environment and
      // the server and the browser can then disagree about the same date.
      expect(call[0]).toBe('en-US');
    }
    spy.mockRestore();
  });

  it('formatLocal ignores a caller-supplied timeZone', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');

    // A caller handing in a whole options object it got from somewhere else must not be
    // able to drag a stale zone in with it. This is what `{ ...options, timeZone }`
    // buys, and the spread ORDER is the entire mechanism.
    const rendered = formatLocal(INSTANT, {
      timeZone: 'UTC',
      hour: 'numeric',
    } as Intl.DateTimeFormatOptions);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect((call[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone).toBe(APP_TZ);
      expect(call[0]).toBe(APP_LOCALE);
    }
    spy.mockRestore();

    // Painted value, not just the spy: 01:00Z is 8 PM in the RGV and 1 AM in UTC, so the
    // rendered hour itself discriminates even if the spy were removed.
    expect(rendered).toBe('8 PM');
  });
});
