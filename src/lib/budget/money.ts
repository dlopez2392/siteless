/**
 * Money, in micro-USD (µUSD) integers. T-2-07.
 *
 * One Text Search Enterprise request is 35,000 µUSD = 3.50 ¢. Integer cents cannot hold
 * that: 1,428 paid requests are $49.98 exactly, $57.12 if each row rounds up (+14.3 %,
 * and the cap refuses early) or $42.84 if each rounds down (−14.3 %, and the cap
 * over-spends). So the arithmetic is µUSD and only the DISPLAY rounds.
 *
 * 🔴 The rounding in `formatUsd` is a display concern and never feeds back into
 * arithmetic. `formatUsd(35_000n)` is "$0.04" — a true statement about what a human sees
 * and a false one about what was spent. Never parse a rendered string back into a ledger
 * value; `money.test.ts` pins that asymmetry deliberately so nobody "fixes" it later.
 *
 * The locale is imported from src/lib/time.ts rather than spelled again. An unpinned
 * locale resolves from the environment, so the server and the browser can disagree —
 * a recorded BIS SSR hydration mismatch for es-* browsers on a rendered value.
 */
import { APP_LOCALE } from '@/lib/time';

export const MICRO_PER_USD = 1_000_000;
export const MICRO_PER_CENT = 10_000;

/**
 * The ceiling `parseUsdToMicro` accepts: $1,000,000. Twenty thousand times the $50 data
 * budget — high enough never to be a real limit, low enough that a fat-fingered or
 * hostile cap cannot become a number the meter's arithmetic has to survive.
 */
export const MAX_PARSEABLE_MICRO_USD = 1_000_000_000_000n;

/**
 * µUSD → cents, fractional cents preserved: 35,000 µUSD is 3.5 ¢, not 3 and not 4.
 * This is the view the `cost_cents numeric(12,2)` generated column shows; it is NOT a
 * rounding step.
 */
export function microToCents(microUsd: bigint | number): number {
  return Number(microUsd) / MICRO_PER_CENT;
}

/**
 * Always two decimals: "$47.60", never "$47.6", never "$48". The digits are pinned here
 * rather than inherited from locale data, so a locale-data change cannot silently drop
 * the cents off a spend figure.
 *
 * `Number(microUsd)` is exact for every value up to MAX_PARSEABLE_MICRO_USD — twelve
 * digits, well inside a double's 15-digit integer range.
 */
export function formatUsd(microUsd: bigint | number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(microUsd) / MICRO_PER_USD);
}

/**
 * µUSD → the BARE dollars-and-cents string a cap input carries: `"50.00"`, never
 * `"$50.00"`. The budget settings screen puts the `$` in an `InputGroup` addon, so the
 * control's value must not carry one — and `parseUsdToMicro` has to be able to read the
 * string straight back, which rules out thousands separators too.
 *
 * 🔴 IT LIVES HERE RATHER THAN IN THE FORM BECAUSE TWO MODULES NEED IT AND ONE OF THEM IS
 * A CLIENT MODULE. The settings page (server) renders the initial value and the cap form
 * (browser) re-renders it from what `setBudgetCap` actually stored. A second copy of money
 * formatting is the exact defect this file exists to prevent, and a client module cannot
 * export the helper back to a server component — its exports would arrive as client
 * references (UI-SPEC Executor Rule 5).
 *
 * 🔴 DISPLAY ONLY, like `formatUsd`. Sub-cent µUSD is truncated, not rounded: a cap is
 * whole cents by construction (`parseUsdToMicro` composes it from a cents digit string),
 * so the truncation is unreachable for a cap — and truncating rather than rounding means
 * a rendered value can never exceed the value it came from, which is the safe direction
 * for a ceiling. Never parse a rendered string back into a ledger value.
 */
export function formatUsdInput(microUsd: bigint): string {
  const negative = microUsd < 0n;
  const abs = negative ? -microUsd : microUsd;
  const dollars = abs / BigInt(MICRO_PER_USD);
  const cents = (abs % BigInt(MICRO_PER_USD)) / BigInt(MICRO_PER_CENT);
  return `${negative ? '-' : ''}${dollars.toString()}.${cents.toString().padStart(2, '0')}`;
}

/** Exactly one decimal — "4.8%" — matching UI-SPEC § Typography. */
export function formatPct(fraction: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction);
}

/**
 * The budget-settings cap input, server-side. T-2-07: this string is untrusted text that
 * becomes the ceiling on all spend.
 *
 * Accepts `50`, `50.0`, `50.00`, `$50.00`, `1,250.00`. Refuses empty, non-numeric,
 * negative, more than two decimal places, and anything above MAX_PARSEABLE_MICRO_USD.
 *
 * 🔴 No float intermediate. `Number('0.07') * 1e6` is 70000.00000000001; the dollars and
 * the cents are parsed as separate digit strings and composed as a bigint, so the result
 * is exact by construction rather than by luck.
 */
export function parseUsdToMicro(input: string): bigint {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('parseUsdToMicro: empty input');
  }

  // Digit grouping must be well-formed ('1,25' is a typo, not $1.25) and at most two
  // decimals may be given — '50.005' is a half-cent the cap cannot represent, and
  // silently truncating it is how a cap ends up one cent from what was typed.
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`parseUsdToMicro: not a valid USD amount: ${JSON.stringify(input)}`);
  }

  const dollars = (match[1] ?? '').replace(/,/g, '');
  const cents = (match[2] ?? '').padEnd(2, '0');

  const micro = BigInt(dollars) * BigInt(MICRO_PER_USD) + BigInt(cents) * BigInt(MICRO_PER_CENT);
  if (micro > MAX_PARSEABLE_MICRO_USD) {
    throw new Error(`parseUsdToMicro: amount exceeds the maximum: ${JSON.stringify(input)}`);
  }
  return micro;
}
