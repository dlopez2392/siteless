/**
 * The budget month (D-11): the calendar month in the app's zone, resetting at LOCAL
 * midnight on the 1st.
 *
 * This module imports APP_TZ from src/lib/time.ts and never spells a zone of its own.
 * That file is the only file in src/ allowed to name one, and the guard is a bare token
 * grep over src/ — so, exactly as src/lib/time.ts does, the comments here deliberately do
 * not spell the zone either. The same goes for the locale.
 *
 * 🔴 Never the zoneless month accessor on a bare `Date` (spelled out nowhere here for the
 * same grep reason). `Intl` formats in the SYSTEM zone while `Date.UTC` anchors UTC
 * midnight, so across the Americas both render the previous day for part of every day.
 * 2026-10-01T04:30:00Z is September in the RGV and October in UTC — one
 * instant, two zones, opposite verdicts, and the ledger row lands in a different month
 * depending on which one the process happened to be in.
 *
 * 🔴 The reset instant is NOT a fixed offset from UTC midnight. October 2026 begins at
 * 05:00Z (CDT, UTC−5) and March 2026 at 06:00Z (CST, UTC−6). An implementation that
 * subtracts a constant six hours is right half the year.
 *
 * `[VERIFIED: the SQL twin of this was executed on PostgreSQL 18.6, 2026-09-22 —
 * 02-RESEARCH.md § Code Examples, "Chicago month boundary"]`
 */
import { TZDate } from '@date-fns/tz';
import { APP_LOCALE, APP_TZ, formatLocal } from '@/lib/time';

/**
 * `formatToParts`, not a formatted string: `en-US`'s own date order is M/D/Y, and
 * re-parsing that back into ISO order works until the day somebody changes the locale.
 * Same approach, and the same reason, as `localDate` in src/lib/time.ts.
 */
function yearMonthIn(instant: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(get('year')), month: Number(get('month')) };
}

function firstOfMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/**
 * The 'YYYY-MM-01' the given instant falls in.
 *
 * `timeZone` defaults to APP_TZ so forgetting it is still correct, and exists as a
 * parameter for exactly one reason: it is what makes the discriminating pair in
 * tests/unit/budget-period.test.ts expressible.
 */
export function periodStart(instant: Date, timeZone: string = APP_TZ): string {
  const { year, month } = yearMonthIn(instant, timeZone);
  return firstOfMonth(year, month);
}

/** The 'YYYY-MM-01' of the month AFTER the one the given instant falls in. */
export function nextPeriodStart(instant: Date, timeZone: string = APP_TZ): string {
  const { year, month } = yearMonthIn(instant, timeZone);
  return month === 12 ? firstOfMonth(year + 1, 1) : firstOfMonth(year, month + 1);
}

/** 'September 2026' — the heading the spend view carries (D-14). */
export function periodLabel(instant: Date): string {
  return formatLocal(instant, { month: 'long', year: 'numeric' });
}

/**
 * The UTC instant at which a period ends: local midnight on the 1st of the NEXT month.
 *
 * `TZDate` resolves the zone's offset AT that wall-clock moment, which is the whole
 * point — the answer moves by an hour between a CST month and a CDT month. A plain
 * `Date` cannot express "midnight in Chicago" at all without doing that resolution by
 * hand, and hand-rolled offset arithmetic is the exact thing this file exists to avoid.
 *
 * Returns a plain `Date` so no caller inherits TZDate's zone-shifted accessors by
 * accident; the value is an instant, and instants have no zone.
 */
export function periodResetInstant(periodStartIso: string): Date {
  const match = /^(\d{4})-(\d{2})-01$/.exec(periodStartIso);
  if (!match) {
    throw new Error(
      `periodResetInstant: expected a 'YYYY-MM-01' period start, got ${JSON.stringify(periodStartIso)}`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`periodResetInstant: month out of range in ${JSON.stringify(periodStartIso)}`);
  }

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  // TZDate's month argument is 0-based, like Date's.
  return new Date(new TZDate(nextYear, nextMonth - 1, 1, 0, 0, 0, APP_TZ).getTime());
}
