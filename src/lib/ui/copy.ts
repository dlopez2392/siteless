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

/* ======================================================================================
 * UI-SPEC § States → Error, as the server actions in src/server/actions/ signal them.
 *
 * These are the sentences a TYPED REFUSAL carries. An action returns
 * `{ ok:false, code, message }` and the message is one of these — so the words a user
 * reads when the product says no are fixed here, in the same file as the words it uses
 * when it says yes, rather than paraphrased at six call sites.
 * ==================================================================================== */

/** UI-SPEC § Error → "Preset name missing". */
export const PRESET_NAME_MISSING =
  'A preset needs a name so you can tell versions apart later. Try “Hidalgo — home services”.';

/** UI-SPEC § Error → "No cluster selected". */
export const NO_CLUSTER_SELECTED =
  'Pick at least one industry cluster. Clusters are what Siteless searches for — a ' +
  'geography on its own has nothing to look for.';

/** UI-SPEC § Error → "No geography selected". */
export const NO_GEOGRAPHY_SELECTED =
  'Pick a geography. Choose cities, a county, or a radius around an address.';

/**
 * UI-SPEC § Error → "Estimate can't be computed".
 *
 * `cluster` and `geography` name what was missing, because "we couldn't estimate this"
 * with no subject sends the user round the picker changing things at random. The estimator
 * throws with the missing key in its message; the action passes it through here.
 */
export function ESTIMATE_UNAVAILABLE(cluster: string, geography: string) {
  return (
    `We couldn't estimate this preset. Outlet counts for ${cluster} in ${geography} aren't ` +
    `seeded, so any dollar figure would be a guess. Pick another geography, or save the ` +
    `preset anyway — saving costs nothing and you can estimate later.`
  );
}

/**
 * UI-SPEC § Error → "Save conflict (version moved)".
 *
 * 🔴 "Nothing you typed here has been saved" is the load-bearing clause. The insert was
 * refused by `search_versions_search_version_uniq`, so the user's edit is still in the form
 * and still theirs to copy out — and a conflict message that does not say so reads like
 * data loss.
 */
export function SAVE_CONFLICT(currentVersion: number) {
  return (
    `This preset changed while you were editing — it's on version ${currentVersion} now. ` +
    `Reload to edit the current version. Nothing you typed here has been saved.`
  );
}

/**
 * UI-SPEC § Error → "Cap below current spend".
 *
 * 🔴 `floorMicroUsd` IS `spent + reserved`, NOT `spent + $1`. UI-SPEC's copy says "at least
 * {spent + $1}" and that number is wrong whenever a reservation is open — `bp_not_over`
 * refuses at `spent + reserved`, so a user told "$13.00" and refused at $13.00 would
 * conclude the product is broken. The floor is passed in from the numbers the query
 * actually returned; the sentence keeps UI-SPEC's shape.
 */
export function CAP_BELOW_SPEND(
  attemptedMicroUsd: bigint | number,
  spentMicroUsd: bigint | number,
  floorMicroUsd: bigint | number,
  resetDate: string,
) {
  return (
    `A ${formatUsd(attemptedMicroUsd)} cap is below the ${formatUsd(spentMicroUsd)} you've ` +
    `already spent this month. Set a cap of at least ${formatUsd(floorMicroUsd)}, or wait ` +
    `for the reset on ${resetDate}.`
  );
}

/** UI-SPEC § Error → "Non-admin on Budget settings". D-10's affordance half. */
export function BUDGET_ADMIN_ONLY(orgLabel: string) {
  return (
    `Budget settings are admin-only. Your role in ${orgLabel} is Member, so you can see ` +
    `spend but not change the cap. Ask an admin to change it, or open the spend view — ` +
    `that's readable by everyone.`
  );
}

/** UI-SPEC § Error → "Unexpected server error". The only refusal with no tailored sentence,
 *  and the only one that means a bug rather than a decision. */
export function UNEXPECTED_ERROR(thing: string) {
  return (
    `Something broke on our side loading ${thing}. Nothing was charged. Try again — if it ` +
    `keeps happening, the run history on the spend view will show whether anything actually ran.`
  );
}

/**
 * Not in UI-SPEC's table, which has no row for a resource that is not there. Written in the
 * same voice, and deliberately vague about WHY: every read is confined by RLS, so a
 * different tenant's id and a deleted id are the same answer here, and saying which one it
 * was would confirm to a wrong-tenant caller that the row exists (T-2-10).
 */
export function NOT_FOUND(thing: string) {
  return (
    `We couldn't find that ${thing}. It may have been removed, or the link may belong to a ` +
    `different organisation.`
  );
}

/**
 * Not in UI-SPEC's table either — it covers the geocoder's no-match and unreachable rows but
 * not its third outcome: an address that resolved perfectly well and is not in Texas.
 *
 * The TYPED address is quoted, not the matched one, and that is forced rather than chosen:
 * `src/lib/geocode/census.ts` returns a bare reason on every failure and keeps nothing else,
 * deliberately, so a rejected out-of-state match's details are never ours to hold.
 */
export function GEOCODE_NOT_TEXAS(address: string) {
  return (
    `“${address}” isn't in Texas. Siteless covers Texas only, so there are no outlet counts ` +
    `to estimate from — the seeded businesses come from the Texas Comptroller. Try a Texas ` +
    `street address, or define this preset by county instead.`
  );
}

/** UI-SPEC § Copy Table → Duplicate dialog default name (D-17). */
export function COPY_OF(name: string) {
  return `Copy of ${name}`;
}
