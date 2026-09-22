/**
 * D-11. The budget month is the calendar month in America/Chicago.
 *
 * 🔴 The suite runs TZ=UTC deliberately (vitest.config.ts line 1) because this dev
 * machine IS Chicago — a fixture zone equal to the dev zone cannot discriminate. So
 * America/Chicago appears here only ever as HALF a pair: one instant, two zones,
 * opposite verdicts.
 *
 * Mutations, one named test each:
 *   - periodStart's default parameter APP_TZ -> 'UTC'
 *       → 'budget period: one instant, two zones, opposite month verdicts'
 *   - periodResetInstant computing a fixed −6 hour offset from UTC midnight
 *       → 'budget period: the reset instant moves with DST' ALONE — it passes the CST
 *         half and fails the CDT half, which is exactly why both halves are asserted.
 *   - periodLabel's options { month: 'long' } -> { month: 'short' }
 *       → 'budget period: the label reads as the spend view shows it'
 *
 * `[VERIFIED: the SQL twin was executed on PostgreSQL 18.6, 2026-09-22 — 02-RESEARCH.md
 * § Code Examples, "Chicago month boundary"]`
 */
import { describe, expect, it } from 'vitest';
import { APP_TZ } from '@/lib/time';
import { nextPeriodStart, periodLabel, periodResetInstant, periodStart } from '@/lib/budget/period';

describe('the Chicago budget month (D-11)', () => {
  it('budget period: one instant, two zones, opposite month verdicts', () => {
    // 2026-10-01 04:30 UTC is 2026-09-30 23:30 in the RGV. The month a ledger row lands
    // in depends entirely on which zone asked.
    const instant = new Date('2026-10-01T04:30:00.000Z');

    expect(periodStart(instant, 'America/Chicago')).toBe('2026-09-01');
    expect(periodStart(instant, 'UTC')).toBe('2026-10-01');
    // The two really are the same instant, not two fixtures that drifted apart.
    expect(periodStart(instant, 'UTC')).not.toBe(periodStart(instant, APP_TZ));
    // And the default parameter is the Chicago half, not the process zone.
    expect(periodStart(instant)).toBe('2026-09-01');

    // nextPeriodStart follows the same zone, including across the year boundary.
    expect(nextPeriodStart(instant, 'America/Chicago')).toBe('2026-10-01');
    expect(nextPeriodStart(instant, 'UTC')).toBe('2026-11-01');
    expect(nextPeriodStart(new Date('2026-12-15T12:00:00.000Z'))).toBe('2027-01-01');
  });

  it('budget period: opposite verdicts at the month edge in CST', () => {
    // One hour apart, different months. March begins in CST (UTC−6), so 06:30Z is
    // 00:30 on the 1st and 05:30Z is still 23:30 on the last day of February.
    expect(periodStart(new Date('2026-03-01T06:30:00.000Z'), 'America/Chicago')).toBe('2026-03-01');
    expect(periodStart(new Date('2026-03-01T05:30:00.000Z'), 'America/Chicago')).toBe('2026-02-01');

    // The other half of the pair: in UTC both instants are already March, so a forgotten
    // zone renders the same answer twice and this test is what notices.
    expect(periodStart(new Date('2026-03-01T05:30:00.000Z'), 'UTC')).toBe('2026-03-01');
  });

  it('budget period: the reset instant moves with DST', () => {
    // October begins in CDT (UTC−5)…
    expect(periodResetInstant('2026-09-01').toISOString()).toBe('2026-10-01T05:00:00.000Z');
    // …and March begins in CST (UTC−6). A fixed offset passes one and fails the other,
    // and a UTC-midnight implementation fails both.
    expect(periodResetInstant('2026-02-01').toISOString()).toBe('2026-03-01T06:00:00.000Z');
    expect(periodResetInstant('2026-09-01').toISOString()).not.toBe('2026-10-01T00:00:00.000Z');

    // Across the year boundary, and it really is the NEXT month's local midnight.
    expect(periodResetInstant('2026-12-01').toISOString()).toBe('2027-01-01T06:00:00.000Z');

    // The reset instant of a period belongs to the period that follows it.
    expect(periodStart(periodResetInstant('2026-09-01'))).toBe('2026-10-01');

    // Refuses anything that is not a period start, rather than guessing a day.
    expect(() => periodResetInstant('2026-09-15')).toThrow(/period start/);
    expect(() => periodResetInstant('not-a-date')).toThrow(/period start/);
  });

  it('budget period: the label reads as the spend view shows it', () => {
    // UI-SPEC's copy is "September 2026 · America/Chicago"; this supplies the first half.
    expect(periodLabel(new Date('2026-09-15T12:00:00.000Z'))).toBe('September 2026');

    // Half a pair again: 04:30Z on 1 October is still September in the RGV, so the
    // heading a Chicago user sees at 11:30 PM disagrees with the UTC calendar.
    expect(periodLabel(new Date('2026-10-01T04:30:00.000Z'))).toBe('September 2026');
  });
});
