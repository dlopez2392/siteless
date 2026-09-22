/**
 * T-2-07. The cap input is untrusted text that becomes the ceiling on all spend, and the
 * spend figures are the product's whole claim to being trustworthy.
 *
 * Mutations, one named test each:
 *   - microToCents divides by MICRO_PER_USD instead of MICRO_PER_CENT
 *       → 'money: micro-USD renders without losing a half cent'
 *   - parseUsdToMicro's decimal group loosened from (\d{1,2}) to (\d+)
 *       → 'money: parseUsdToMicro accepts what the cap input allows and refuses the rest'
 *         ('50.005' stops throwing), with the accept half as the positive control
 *   - formatUsd's `new Intl.NumberFormat(APP_LOCALE, …)` -> `(undefined, …)`
 *       → 'money: formatUsd pins the locale'. A string comparison cannot kill this one:
 *         an unpinned locale renders identically on this machine and differently on
 *         Vercel, so the constructor is spied and the pin asserted.
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_LOCALE } from '@/lib/time';
import { formatPct, formatUsd, microToCents, parseUsdToMicro } from '@/lib/budget/money';

describe('money in micro-USD', () => {
  it('money: micro-USD renders without losing a half cent', () => {
    // A $50 cap's worth of Text Search Enterprise requests, to the micro-dollar.
    expect(formatUsd(49_980_000n)).toBe('$49.98');
    expect(microToCents(49_980_000)).toBe(4998);

    // One request: 3.50 ¢. The half cent is the entire reason this module is not integer
    // cents — exact equality, because toBeCloseTo would pass on 3 and on 4.
    expect(microToCents(35_000)).toBe(3.5);

    expect(formatUsd(0n)).toBe('$0.00');
    expect(formatUsd(47_600_000n)).toBe('$47.60'); // never "$47.6", never "$48"

    // A whole-cent value survives a format → parse round trip exactly.
    expect(parseUsdToMicro(formatUsd(49_980_000n))).toBe(49_980_000n);

    // And a half-cent value does NOT — $0.035 displays as "$0.04" and reads back as
    // 40,000 µUSD. That asymmetry is deliberate and pinned: the display rounds, the
    // ledger never does, and a rendered string is never a ledger value.
    expect(formatUsd(35_000n)).toBe('$0.04');
    expect(parseUsdToMicro(formatUsd(35_000n))).not.toBe(35_000n);
    expect(parseUsdToMicro(formatUsd(35_000n))).toBe(40_000n);
  });

  it('money: parseUsdToMicro accepts what the cap input allows and refuses the rest', () => {
    // What the budget-settings input really receives from a human.
    expect(parseUsdToMicro('50')).toBe(50000000n);
    expect(parseUsdToMicro('50.0')).toBe(50000000n);
    expect(parseUsdToMicro('50.00')).toBe(50000000n);
    expect(parseUsdToMicro('$50.00')).toBe(50000000n);
    expect(parseUsdToMicro('1,250.00')).toBe(1250000000n);
    // No float intermediate: Number('0.07') * 1e6 is 70000.00000000001.
    expect(parseUsdToMicro('0.07')).toBe(70000n);

    // Each refusal names the offending input, so the cap screen can echo it back.
    expect(() => parseUsdToMicro('')).toThrow(/parseUsdToMicro/);
    expect(() => parseUsdToMicro('abc')).toThrow(/abc/);
    expect(() => parseUsdToMicro('-1')).toThrow(/-1/);
    expect(() => parseUsdToMicro('50.005')).toThrow(/50\.005/);
    expect(() => parseUsdToMicro('1,25')).toThrow(/1,25/);
    expect(() => parseUsdToMicro('2000000')).toThrow(/2000000/);

    // Positive control beside the refusals: a function that threw on everything would
    // satisfy all six of them. The accepts above are that control, and so is the
    // boundary — exactly $1,000,000 is allowed, one cent more is not.
    expect(parseUsdToMicro('1000000.00')).toBe(1_000_000_000_000n);
    expect(() => parseUsdToMicro('1000000.01')).toThrow(/1000000\.01/);
  });

  it('money: formatUsd pins the locale', async () => {
    // A module-level formatter cache — which this module does not have today, but a
    // future memoization would add — means a warm import would see ZERO constructions
    // and every assertion in the loop below would pass vacuously. Force a cold load.
    vi.resetModules();
    const spy = vi.spyOn(Intl, 'NumberFormat');
    const fresh = await import('@/lib/budget/money');

    const usd = fresh.formatUsd(4_760_000n);
    const pct = fresh.formatPct(0.048);

    // BEFORE the loop: zero calls would make everything inside it vacuous.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      // The assertion a rendered-string comparison cannot make. An unpinned locale
      // renders identically on this machine and differently on Vercel.
      expect(call[0]).toBe(APP_LOCALE);
      expect(call[0]).not.toBe(undefined);
    }
    spy.mockRestore();

    // Painted values too, so the test still discriminates if the spy were removed.
    expect(usd).toBe('$4.76');
    expect(pct).toBe('4.8%');
    // formatPct shows exactly one decimal, in both directions.
    expect(formatPct(0.5)).toBe('50.0%');
  });
});
