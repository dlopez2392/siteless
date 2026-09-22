/**
 * The strings UI-SPEC's Copy Table fixes, as exported constants so a screen cannot
 * paraphrase one.
 *
 * 🔴 NO CLIENT-BOUNDARY DIRECTIVE HERE EITHER, and this comment does not spell it out —
 * see `./run-tone.ts` for why, and for what a client module's exports turn into inside a
 * server component. Short version: `undefined` at runtime, with every gate green. Two
 * recorded BIS occurrences, both 500s.
 *
 * WHY CONSTANTS AND NOT JUST TYPING THE STRING IN THE COMPONENT. UI-SPEC § Voice is
 * specific about what this product sounds like when it refuses to spend money — "Your
 * $50.00 monthly cap is spent" beats "Budget exceeded" — and that voice survives exactly
 * as long as the words live in one place. A paraphrase in a component is invisible to
 * review and permanent.
 *
 * 🔴 MONEY GOES THROUGH `formatUsd`, NEVER STRING CONCATENATION. The banner functions take
 * micro-USD and format it here, so a caller cannot hand in a half-formatted number or a
 * locale-dependent one. `formatUsd` pins the locale (an unpinned one is a recorded BIS SSR
 * hydration mismatch for es-* browsers) and always renders two decimals.
 *
 * 🔴 `America/Chicago` APPEARS BELOW AS PROSE, NOT AS A ZONE CONSTANT. It is inside two
 * sentences a human reads; nothing in this file passes it to `Intl`. Every formatting call
 * site resolves its zone from `src/lib/time.ts`, which remains the only file in `src/`
 * that names a zone for a machine.
 */
import { formatUsd } from '@/lib/budget/money';

/** UI-SPEC § Copy Table → Shell. */
export const NAV = { presets: 'Presets', spend: 'Spend', settings: 'Settings' } as const;

export const SKIP_LINK = 'Skip to main content';

/** UI-SPEC § Empty states → Preset list. The body explains what a preset IS, because the
 *  empty state is the first screen a new tenant sees and "No presets" teaches nothing. */
export const PRESETS_EMPTY_HEADING = 'No search presets yet';
export const PRESETS_EMPTY_BODY =
  'A preset is one or more industry clusters crossed with a geography — the 17 RGV ' +
  'cities, a county, or a radius around an address. Siteless costs it before it runs, so ' +
  'you always know what a search will spend.';
export const PRESETS_EMPTY_CTA = 'Create your first preset';

/**
 * The persistent 80 % banner. Not dismissible and not a toast (D-12): it is a standing
 * condition, and a toast that has been dismissed is indistinguishable from one that never
 * fired.
 *
 * 🔴 "Nothing is blocked yet" is the load-bearing clause. At 80 % the product still works,
 * and a warning that reads like a refusal teaches people to ignore the real one.
 */
export function BUDGET_80_BANNER(usedMicroUsd: bigint | number, capMicroUsd: bigint | number) {
  return (
    `You've used ${formatUsd(usedMicroUsd)} of your ${formatUsd(capMicroUsd)} cap — 80%. ` +
    `At 100% Siteless refuses new runs. Nothing is blocked yet.`
  );
}

/**
 * The 100 % banner. `resetDate` is pre-formatted by the caller through `src/lib/time.ts` —
 * this module never formats a date, because doing so would mean naming a zone here.
 *
 * 🔴 "so nothing more will be charged" is the sentence danlo actually needs. The cap being
 * spent is not the bad news; the bad news would be not knowing whether spending stopped.
 */
export function BUDGET_100_BANNER(capMicroUsd: bigint | number, resetDate: string) {
  return (
    `Your ${formatUsd(capMicroUsd)} monthly cap is spent. Siteless is refusing new runs, ` +
    `so nothing more will be charged. Raise the cap in Budget settings, or wait for the ` +
    `reset on ${resetDate} at 12:00 AM America/Chicago.`
  );
}

/** Rendered inside the run drawer as a destructive Alert — NOT a toast, because it has to
 *  persist and carry a solution (UI-SPEC § States → Refused reservation). */
export function RUN_REFUSED(capMicroUsd: bigint | number) {
  return (
    `This run was refused. Your ${formatUsd(capMicroUsd)} cap is spent, so Siteless ` +
    `didn't call anything and nothing was charged.`
  );
}

/** Phase 2 saves presets, versions and estimates; it does not run anything. Saying so on
 *  the screen is the difference between "not built yet" and "broken". */
export const PHASE4_RUN_NOTICE =
  'Runs start when the Places verifier ships in Phase 4. Your preset, its versions and ' +
  'its estimate are saved and ready.';

/**
 * 🔴 `address` is the string the USER typed, not `matchedAddress` — there is no match to
 * quote back. Everywhere else in the geocode flow the address shown is the one the service
 * returned, because a bad ZIP is silently corrected upstream; this is the one exception,
 * and it exists so the user can see the input that failed.
 */
export function GEOCODE_NO_MATCH(address: string) {
  return (
    `We couldn't find “${address}”. The US Census Geocoder matches street addresses, not ` +
    `business names or PO boxes. Try a street address with a city and ZIP, or define this ` +
    `preset by county instead.`
  );
}

export const GEOCODE_UNREACHABLE =
  "The US Census Geocoder didn't answer. It's a free federal service and it does go " +
  'down — nothing was charged and nothing was lost. Retry, or define this preset by city ' +
  'or county instead.';

/**
 * Shown before saving an edit. Versions are immutable and runs point at one, which is the
 * thing a user has to understand before they press save.
 *
 * Refuses `n < 2`: version 1 has no predecessor, so "keep pointing at version 0" would be
 * a sentence about a row that does not exist. The new-preset screen has its own copy.
 */
export function VERSION_NOTICE(n: number) {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(
      `VERSION_NOTICE: needs a version of 2 or more, got ${n}. Version 1 has no ` +
        `predecessor to point at - use the new-preset copy instead.`,
    );
  }
  return `Saving creates version ${n}. Runs that already finished keep pointing at version ${n - 1}.`;
}

/** UI-SPEC § Spend → Footer note. The Vercel clause is there because it is the question
 *  danlo asks every time he sees the number. */
export const SPEND_FOOTER =
  'One ledger row per paid call. Vercel hosting (~$20/mo) is infrastructure and is ' +
  'deliberately not counted here.';

export const BUDGET_CAP_HELP =
  'Applies to Places, Firecrawl and Anthropic together. Resets at 12:00 AM on the 1st, ' +
  'America/Chicago. Vercel hosting is billed separately and never counts against this.';

export const BUDGET_AUDIT_NOTE =
  'Changing the cap is recorded with your name and the time, like every other change in ' +
  'Siteless.';
