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
import {
  RUN_ABANDONED_AFTER_MINUTES,
  RUN_NEVER_STARTED_AFTER_MINUTES,
} from '@/lib/estimate/assumptions';
import type { HostClass } from '@/lib/places/host-class';
import { formatCount } from '@/lib/time';
import type { StoppedReason } from './run-tone';

/**
 * UI-SPEC § Copy Table → Shell, extended by 03-UI-SPEC § 0 to six destinations.
 *
 * The six split into ONE partition used at both breakpoints: Leads (Presets · Review ·
 * Businesses) are the three phone tabs and the first desk group; Operations (Sources ·
 * Spend · Settings) live behind the phone's fourth `More` tab and in the second desk group.
 */
export const NAV = {
  presets: 'Presets',
  review: 'Review',
  businesses: 'Businesses',
  sources: 'Sources',
  spend: 'Spend',
  settings: 'Settings',
  more: 'More',
} as const;

/** 03-UI-SPEC § 0 → the desk sidebar's two group eyebrows (Label 14/600 muted, not links). */
export const NAV_GROUP = { leads: 'Leads', operations: 'Operations' } as const;

/** 03-UI-SPEC § 0 → the phone More sheet's title. */
export const MORE_SHEET_TITLE = 'More';

/** The shared Sheet's close button: its accessible name (03-22 fix; the ✕ is the only glyph). */
export const SHEET_CLOSE_LABEL = 'Close';

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

/**
 * 🔴 THIS SENTENCE SAID "Applies to Places, Firecrawl and Anthropic together" AND THE
 * DATABASE HAS NEVER WORKED THAT WAY (WR-02).
 *
 * `budget_periods` is keyed `(org_id, provider, period_start)` — migration 0014's
 * `budget_periods_org_provider_period_uniq` — and `app.reserve_budget`'s conditional UPDATE
 * matches ONE such row. That single statement is the entire concurrency control, proven
 * under a 40-way burst, and it is atomic precisely because it touches one row: a ceiling
 * spanning three rows could not be enforced by it at all. So what is enforced is a cap PER
 * PROVIDER, and the copy was describing a product that does not exist.
 *
 * The number is not wrong today — Places is the only provider that reserves anything in
 * Phase 2, so the enforced ceiling on real spend is exactly the number on screen. It is the
 * PROMISE that was wrong, and the first Firecrawl reservation in Phase 5 would have been
 * metered against a lazily-created row nobody set and no screen displays.
 *
 * D-13 ("one cap, no separate ad-hoc allowance") is not abandoned here: honouring it as one
 * org-wide ceiling means moving the meter off a per-provider row, which changes the burst
 * proof, `readSpendByProvider`, the banner, the gauge and the spend header together. That is
 * an architecture decision with an owner (danlo) and a natural moment (Phase 5, when a second
 * provider first spends), recorded in deferred-items.md. What is fixed NOW is the product
 * telling the truth about what it enforces, which is the half that costs nothing to get right.
 */
export const BUDGET_CAP_HELP =
  'Applies to Places, the only provider Siteless spends on today. Firecrawl and Anthropic ' +
  'are metered separately and get their own cap when verification ships in Phase 5. Resets ' +
  'at 12:00 AM on the 1st, America/Chicago. Vercel hosting is billed separately and never ' +
  'counts against this.';

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

/* ======================================================================================
 * PHASE 3 — 03-UI-SPEC § Copy Table, § States → Empty, § States → Error.
 *
 * This plan (03-04) owns this file for the whole phase. The four screen plans READ it and
 * never edit it, which is what lets them run in parallel — so every string those screens
 * render is already here, verbatim, including the ones no screen has been built for yet.
 *
 * 🔴 NOTHING BELOW FORMATS A DATE, A NUMBER OR A PHONE. A parameter that renders a number
 * takes it TWICE where grammar depends on it: the raw `number` (to pick "1 pair" over
 * "1 pairs") and the caller's already-formatted `shown` string (to print "1,284" rather
 * than "1284"). The caller formats through the pinned locale from `src/lib/time.ts`, the
 * way `summary-card.tsx` already does. Dates arrive pre-formatted through `formatLocal`.
 *
 * 🔴 Curly quotes (“ ”) and the `·` separator ARE the copy. Straight apostrophes are too,
 * where the spec has them ("didn't", "Foursquare's") — reproduced exactly as written.
 *
 * Commands the spec sets in code formatting (`tsx scripts/ingest-comptroller.ts`) are plain
 * text inside the sentences below; the markdown backticks were typesetting, not copy. The
 * commands also stand alone as `INGEST_COMMAND` so a "Copy the command" action copies
 * exactly the string the sentence names.
 * ==================================================================================== */

/** The desk scripts the empty and error copy names. One spelling, shared by the sentence
 *  and by the clipboard action beside it. */
export const INGEST_COMMAND = {
  comptroller: 'tsx scripts/ingest-comptroller.ts',
  overture: 'tsx scripts/ingest-overture.ts <release>',
} as const;

/* --- /review (03-UI-SPEC § 1) ------------------------------------------------------- */

export const REVIEW_TITLE = 'Review queue';

/** "{n} pairs left to review" / "1 pair left to review". `shown` is `n` pre-formatted. */
export function REVIEW_REMAINING(n: number, shown: string = String(n)) {
  return n === 1 ? '1 pair left to review' : `${shown} pairs left to review`;
}

export const REVIEW_ORDERING_NOTE = 'Highest score first';

/** The accessible group label on the chip band. `score` is the integer pair score. */
export function REVIEW_CHIP_GROUP_LABEL(score: number) {
  return `Why these two scored ${score}`;
}

/** Label 14/400 muted, right-aligned in the header row — never without its chips. */
export function REVIEW_SCORE_LINE(score: number) {
  return `Score ${score} of 100`;
}

/**
 * The signal chips (03-UI-SPEC § Copy Table → Chips). Static text, not controls. The words
 * carry the meaning ("different", "no") — the outline variant is redundancy.
 *
 * The two that carry a figure take it pre-formatted: `REVIEW_CHIP_NAME('0.81')`,
 * `REVIEW_CHIP_APART('140 m')` / `REVIEW_CHIP_APART('3.1 km')`.
 */
export const REVIEW_CHIP = {
  phoneExact: 'phone exact',
  sameZip: 'same ZIP',
  sameCluster: 'same cluster',
  differentCluster: 'different cluster',
  noPhoneEitherSide: 'no phone on either side',
  noLocationOneSide: 'no location on one side',
} as const;

export function REVIEW_CHIP_NAME(similarity: string) {
  return `name ${similarity}`;
}

export function REVIEW_CHIP_APART(distance: string) {
  return `${distance} apart`;
}

/** Screen-reader names for the two sides — "Left"/"Right" on desk, where they sit side by
 *  side; "First record"/"Second record" on phone, where they stack. */
export const REVIEW_SIDE_LABEL = {
  desk: { a: 'Left', b: 'Right' },
  phone: { a: 'First record', b: 'Second record' },
} as const;

export const REVIEW_ACTION_SAME = 'Same business';
export const REVIEW_ACTION_DIFFERENT = 'Different';
export const REVIEW_ACTION_SKIP = 'Skip';
export const REVIEW_BUSY = 'Recording…';
export const REVIEW_SKIP_HELPER = 'Skip leaves this pair pending and moves on.';
export const REVIEW_DIFFERENT_HELPER =
  'Different records these two as separate for good — they will never auto-merge.';

/** Rendered where a side's source does not carry a field. Never a blank, never a bare dash. */
export const REVIEW_MISSING_FIELD = 'Not on this record';

/** The `Closed` badge. `date` is pre-formatted through `formatLocal`. */
export function FLAG_CLOSED(date: string) {
  return `Closed ${date}`;
}

/** The chain flag (D-11: a flag, never a merge). `shown` is `n` pre-formatted. */
export function FLAG_CHAIN(n: number, shown: string = String(n)) {
  return `Chain · ${shown} in Texas`;
}

/** The chain flag when the count is this org's own RGV spine, not the Comptroller's statewide
 *  frequency — "in Texas" beside a local figure would overstate it. `shown` is `n` pre-formatted. */
export function FLAG_CHAIN_LOCAL(n: number, shown: string = String(n)) {
  return `Chain · ${shown} in the RGV`;
}

/**
 * THE one chain-flag sentence, for every screen (C-WR-02). It picks the wording from
 * `statewide`; nothing downstream edits its output (a `.replace(' in Texas', '')` on
 * `FLAG_CHAIN` silently brought the overclaim back whenever the wording changed).
 * `shown` is REQUIRED: the count is grouped by the caller through the pinned locale
 * (`formatCount` in `src/lib/time.ts`), never printed raw.
 */
export function FLAG_CHAIN_LABEL(chain: { members: number; statewide: boolean }, shown: string) {
  return chain.statewide ? FLAG_CHAIN(chain.members, shown) : FLAG_CHAIN_LOCAL(chain.members, shown);
}

/* --- /sources (03-UI-SPEC § 2) ------------------------------------------------------ */

export const SOURCES_TITLE = 'Sources';
export const SOURCES_SUBTITLE =
  'Every ingest run, what it changed, and which version of the source it read.';

export const SOURCES_COLUMN = {
  source: 'Source',
  version: 'Version ingested',
  lastRun: 'Last run',
  added: 'Added',
  changed: 'Changed',
  unchanged: 'Unchanged',
  gone: 'Gone',
} as const;

/** The four ledger rows — static structure, rendered before any run exists (Rule 27). */
export const SOURCE_NAME = {
  tx_comptroller: 'Comptroller permits',
  tx_comptroller_closures: 'Comptroller closures',
  overture: 'Overture places',
  census_geocoder: 'Census geocoder',
} as const;

export const SOURCES_NEVER_RUN = 'Never run';

/** The three run-status badge words. `stopped` reads "Stopped early", never "Stopped". */
export const SOURCES_RUN_STATUS = {
  complete: 'Complete',
  stopped: 'Stopped early',
  failed: 'Failed',
} as const;

export const SOURCES_GONE_EXPLAINER =
  'Gone means a row stopped appearing in the source. Siteless marks it and keeps it — ' +
  'Overture drops and re-adds ids between releases, so nothing is ever deleted on an ' +
  'absence alone.';

export const SOURCES_CONFIDENCE_TOGGLE = 'Show the confidence distribution';
export const SOURCES_CONFIDENCE_TOGGLE_HIDE = 'Hide the confidence distribution';

/** `cutoff` is the committed constant, pre-formatted (e.g. "0.70"). */
export function SOURCES_CUTOFF_LINE(cutoff: string) {
  return (
    `Funnel cutoff: ${cutoff} — rows below this stay in the spine and never enter the ` +
    `lead funnel.`
  );
}

export const ATTRIBUTION_HEADING = 'Where this data comes from';

/**
 * 🔴 LICENCE TEXT. CDLA-Permissive 2.0 requires the Overture attribution to travel with the
 * data; this sentence is the in-app half of that obligation. Phase 8 (COMP-03) writes the
 * export half — not here.
 */
export const ATTRIBUTION_BODY =
  'Places data © Overture Maps Foundation, released under CDLA-Permissive 2.0. Overture ' +
  "places carry data from Foursquare's open location data set and other open providers; " +
  'each record keeps its provider attribution. Texas sales-tax permit and closure data is ' +
  'published by the Texas Comptroller of Public Accounts and is in the public domain. ' +
  'Addresses are geocoded by the US Census Bureau Geocoder, a free federal service. None ' +
  'of this is Google data — Google Places is a transient verifier and never becomes part ' +
  'of the durable record.';

export const ATTRIBUTION_FOOTNOTE =
  'This attribution travels with any export. The CSV wording ships with the export in ' +
  'Phase 8.';

/* --- /businesses (03-UI-SPEC § 3) --------------------------------------------------- */

export const BUSINESSES_TITLE = 'Businesses';
export const BUSINESSES_SEARCH_PLACEHOLDER = 'Search by name or lead key';

/**
 * "{n} businesses · showing the first {m}" / "1 business".
 *
 * The "showing the first" clause appears only when fewer than all `n` rows are on screen —
 * a list of 30 that reads "showing the first 30" is describing a cut that did not happen.
 * `nShown`/`mShown` are the caller's pre-formatted figures.
 */
export function BUSINESSES_COUNT_LINE(
  n: number,
  m: number,
  nShown: string = String(n),
  mShown: string = String(m),
) {
  if (n === 1) return '1 business';
  if (m < n) return `${nShown} businesses · showing the first ${mShown}`;
  return `${nShown} businesses`;
}

export const BUSINESSES_FILTER_LABEL = { cluster: 'Cluster', status: 'Status' } as const;

export const BUSINESSES_FILTER_OPTION = {
  anyCluster: 'Any cluster',
  noClusterMapped: 'No cluster mapped',
  anyStatus: 'Any status',
  active: 'Active',
  closed: 'Closed',
  mergedAway: 'Merged away',
} as const;

export const BUSINESSES_COLUMN = {
  name: 'Name',
  city: 'City',
  cluster: 'Cluster',
  sources: 'Sources',
  status: 'Status',
} as const;

export const BUSINESSES_SHOW_MORE = 'Show 50 more';
export const BUSINESSES_SHOW_MORE_BUSY = 'Loading…';

/** The cluster cell for a D-02 unmapped row — visible, muted, never blank. */
export const NO_CLUSTER_MAPPED = 'No cluster mapped';

/** Status badge words on `/businesses` and the detail header. */
export const BUSINESS_STATUS = {
  active: 'Active',
  merged_away: 'Merged away',
} as const;

/* --- /businesses/[id] (03-UI-SPEC § 4) ---------------------------------------------- */

export const LEAD_KEY_LABEL = 'Lead key';
export const COPY_LEAD_KEY = 'Copy lead key';

/** The success toast after copying. `key` is the external lead key, e.g. SL-7F3K2. */
export function LEAD_KEY_COPIED(key: string) {
  return `Lead key ${key} copied`;
}

export const BUSINESS_SECTION = {
  fields: 'Fields and sources',
  sourceRecords: 'Source records',
  mergeHistory: 'Merge history',
} as const;

/** D-18's rows, in order. The Phase 7 triage card inherits this order. */
export const BUSINESS_FIELD_LABEL = {
  displayName: 'Display name',
  legalName: 'Legal name (state filing)',
  phone: 'Phone',
  address: 'Address',
  cityZip: 'City · ZIP',
  location: 'Location',
  category: 'Category / cluster',
  overtureConfidence: 'Overture confidence',
  permitDates: 'Permit dates',
  closedOn: 'Closed on',
} as const;

/** A field no durable source supplied — CONVENTIONS § Retention made honest on screen. */
export const FIELD_NOT_STORED = 'Not stored';
export const FIELD_NO_DURABLE_SOURCE = 'No durable source';

export const LEGAL_NAME_NOTE = 'The string on the state filing. Outreach uses the display name.';

/** Label 14/400 muted plain text, keyed by `source_records.source`. Never a badge (Rule 22). */
export const SOURCE_TAG = {
  tx_comptroller: 'Comptroller',
  tx_comptroller_closures: 'Comptroller closures',
  overture: 'Overture',
  census_geocoder: 'Census geocoder',
} as const;

/** A `gone` source record (D-05), said in words rather than left as a silent stale date. */
export function STALE_SOURCE_RECORD(version: string) {
  return `Last seen in the ${version} release — not in the latest run`;
}

export function MERGE_ROW(loser: string, winner: string) {
  return `${loser} merged into ${winner}`;
}

/**
 * One side of a merge, named by what tells two records apart: its lead key and its source tag
 * (03-22). After survivorship the winner often carries the loser's display name, so a
 * name-only row read “X merged into X”. `source` is a pre-rendered `SOURCE_TAG` value, or null
 * when the record has no primary source — then the key stands alone.
 */
export function MERGE_SIDE(key: string, source: string | null) {
  return source ? `${key} · ${source}` : key;
}

/** The merge row's second line, when the two display names differ. */
export function MERGE_ROW_NAMES(loser: string, winner: string) {
  return `“${loser}” into “${winner}”`;
}

/** The merge row's second line, when survivorship left both records with one name. */
export function MERGE_ROW_SAME_NAME(name: string) {
  return `Both records are named “${name}”`;
}

export function MERGE_REASON_AUTO(score: number) {
  return `Auto-merged at ${score}`;
}

export function MERGE_REASON_REVIEW(actor: string) {
  return `Reviewed by ${actor}`;
}

/** Named, never icon-only: on a screen of near-identical rows the consequential choice is
 *  the unambiguous one. `loserSide` is `MERGE_SIDE(key, source)` — a name can repeat, a key
 *  cannot (03-22). */
export function UNMERGE_ACTION(loserSide: string) {
  return `Unmerge ${loserSide}`;
}

/** `date` is pre-formatted through `formatLocal`. */
export function MERGE_UNDONE(actor: string, date: string) {
  return `Unmerged by ${actor} on ${date}`;
}

/* --- The unmerge confirmation (D-20 — the one destructive action in this phase) ----- */

/** Both sides as `MERGE_SIDE(key, source)`; the body below still names them in words. */
export function UNMERGE_TITLE(loserSide: string, winnerSide: string) {
  return `Unmerge ${loserSide} from ${winnerSide}?`;
}

/**
 * Names all four consequences — loser back to active, each key to its own record, the
 * loser's fields restored from its own sources, the pair marked distinct — plus the audit.
 */
export function UNMERGE_BODY(loser: string, winner: string, loserKey: string, winnerKey: string) {
  return (
    `Both records go back to standing on their own. “${loser}” becomes active again with ` +
    `its own lead key ${loserKey} and the fields its own sources supplied; “${winner}” ` +
    `keeps ${winnerKey} and loses whatever came from “${loser}”. Siteless then records ` +
    `this pair as different, so nothing will merge them again automatically — you can ` +
    `still merge them by hand from the review queue if a later ingest changes your mind. ` +
    `This is recorded with your name and the time, like every other change in Siteless.`
  );
}

export const UNMERGE_CONFIRM = 'Unmerge these two records';
/** Never "Cancel" (Voice rules → no generic labels). */
export const UNMERGE_DISMISS = 'Keep them merged';
export const UNMERGE_BUSY = 'Unmerging…';

/* --- Success toasts (03-UI-SPEC § Copy Table → Toasts). Success only — a refusal is a
 *     persistent Alert, because a dismissed toast is indistinguishable from none. ------ */

export function TOAST_MERGED(loser: string, winner: string) {
  return `Merged — “${loser}” now resolves to “${winner}”`;
}

export const TOAST_DISTINCT = 'Recorded as different';

export function TOAST_UNMERGED(loser: string, loserKey: string) {
  return `Unmerged — “${loser}” (${loserKey}) is active again`;
}

/** The fourth toast is `LEAD_KEY_COPIED(key)` above — one spelling, not two. */

/* --- Empty states (03-UI-SPEC § States → Empty). Heading · body · action. ----------- */

export const REVIEW_CLEAR_HEADING = 'Queue clear';
export const REVIEW_CLEAR_BODY =
  'Every pair in the 80–95 band has a decision. New pairs appear here after the next ' +
  'ingest, when Comptroller and Overture describe the same business closely enough to ' +
  'need a person. Auto-merges at 95 and above, and anything under 80, never reach this ' +
  'queue.';
export const REVIEW_CLEAR_ACTION = 'See the source runs';

export const REVIEW_EMPTY_HEADING = 'Nothing to review yet';
export const REVIEW_EMPTY_BODY =
  'No ingest has run, so there are no candidate pairs to score. Run ' +
  `${INGEST_COMMAND.comptroller} and then ${INGEST_COMMAND.overture} at the desk; the ` +
  '80–95 band lands here as soon as scoring finishes.';
export const REVIEW_EMPTY_ACTION = 'Open sources';

export const SOURCES_EMPTY_HEADING = 'No ingest has run yet';
export const SOURCES_EMPTY_BODY =
  `The four sources below are wired and waiting. Run ${INGEST_COMMAND.comptroller} at the ` +
  'desk to load active sales-tax permits for Cameron, Hidalgo, Starr and Willacy, then ' +
  `${INGEST_COMMAND.overture} for Overture places. Each run writes its counts here.`;
export const SOURCES_EMPTY_ACTION = "See what's in the spine";

export const BUSINESSES_EMPTY_HEADING = 'The spine is empty';
export const BUSINESSES_EMPTY_BODY =
  'Businesses appear here after the first ingest — about 35,000 Comptroller outlets and ' +
  '57,000 Texas-side Overture places across the four RGV counties. Run the ingests at the ' +
  'desk and this list fills itself.';
export const BUSINESSES_EMPTY_ACTION = 'Open sources';

/** The user's own query is quoted back, verbatim, because it is the thing that matched
 *  nothing. */
export function BUSINESSES_NO_MATCH_HEADING(query: string) {
  return `No business matches “${query}”`;
}
export const BUSINESSES_NO_MATCH_BODY =
  'Siteless searches the display name, the legal name and the lead key. Names are stored ' +
  'exactly as their source spelled them, accents and all — try fewer words, or search the ' +
  'lead key if you have it.';
export const BUSINESSES_NO_MATCH_ACTION = 'Clear search';

/** A complete, correct state — deliberately no action. */
export const MERGES_EMPTY_HEADING = 'One source, no merges';
export const MERGES_EMPTY_BODY =
  'This record came from a single source record, so there is nothing to unmerge. If a ' +
  'second source turns up the same business, the merge appears here with both parents and ' +
  'an unmerge action.';

/* --- Errors (03-UI-SPEC § States → Error). Every one says what was and was not written,
 *     and ends with a way out. ----------------------------------------------------------- */

/** Shared action words across the error states. */
export const ERROR_ACTION = {
  tryAgain: 'Try again',
  reloadQueue: 'Reload the queue',
  openSources: 'Open sources',
  openBusinesses: 'Open businesses',
  clearFilters: 'Clear filters',
  copyCommand: 'Copy the command',
  /** An unmerge refusal a retry can never fix (already undone, a later merge first): close
   *  the dialog and re-read the page, so the stale Unmerge button goes away (C-WR-05). */
  reloadHistory: 'Reload the merge history',
} as const;

export const REVIEW_DECISION_FAILED =
  "That decision didn't reach the server. Nothing was recorded and this pair is still " +
  "pending, so you haven't lost your place in the queue. Try again, or reload if it keeps " +
  'happening.';

/** 55000 from the definer: another reviewer (or the resolve pass) decided this pair first. */
export const REVIEW_ALREADY_DECIDED =
  'Someone already decided this pair while it was open here. Their decision stands and ' +
  'nothing of yours was recorded. Reload the queue for the next pair.';

/** 55000 from the definer: the pair is marked distinct, so it cannot be merged from the queue. */
export const REVIEW_MARKED_DISTINCT =
  "This pair is already marked as two different businesses, so it can't be merged from the " +
  'queue. Nothing was recorded. Reload the queue for the next pair.';

export const REVIEW_LOAD_FAILED =
  "We couldn't load the review queue. Nothing is wrong with your decisions — every one " +
  'already recorded is safe. Try again, or check the sources ledger to see whether the ' +
  'last ingest finished.';

export const UNMERGE_FAILED =
  "The unmerge didn't complete. The two records are still merged exactly as they were — " +
  'nothing was half-undone, and both lead keys still point where they did a moment ago. ' +
  'Try again, or check the sources ledger if an ingest is running.';

/** 55000 from the definer: a later merge into this business must be undone first (LIFO). */
export const UNMERGE_LATER_MERGE_FIRST =
  'Another merge into this business happened after this one. Undo that later merge first, ' +
  'then this one. Nothing was changed.';

/** 55000 from the definer: the merge is already undone — the records are separate. */
export const UNMERGE_ALREADY_UNDONE =
  'This merge was already undone, so the two records are separate again. Nothing was ' +
  'changed. Reload to see the current merge history.';

export const SOURCES_LOAD_FAILED =
  "We couldn't read the run history. The ingests themselves are desk scripts and are " +
  'unaffected by this — any run in flight is still writing. Try again.';

/**
 * A `failed` ingest run, rendered inside that source's row as a destructive Alert.
 * `rows` is pre-formatted; `error` is the run's recorded error text; `script` is one of
 * `INGEST_COMMAND`.
 */
export function INGEST_RUN_FAILED(source: string, rows: string, error: string, script: string) {
  return (
    `The last ${source} run failed after ${rows} rows: ${error}. Nothing partial was left ` +
    `behind — the run is idempotent by external id, so re-running it picks up exactly ` +
    `where the data is. Re-run ${script} at the desk.`
  );
}

/** A `stopped` ingest run, as a warning Alert. `rows` is pre-formatted. */
export function INGEST_RUN_STOPPED(source: string, rows: string) {
  return (
    `The last ${source} run stopped early after ${rows} rows. The rows it did write are ` +
    `complete and consistent; re-running is safe and only touches what changed.`
  );
}

export const BUSINESS_SEARCH_FAILED =
  "The search didn't come back. Your query is still in the box — nothing was lost. Try " +
  'again, or clear the filters and search the name on its own.';

export const BUSINESS_NOT_FOUND =
  'No business with that id. It may have been merged into another record — merges keep ' +
  'every parent, so the lead key still resolves to whichever record survived. Search for ' +
  'it by name or by lead key.';

export const BUSINESS_BAD_ID =
  "That isn't a business id. Siteless uses an internal id in this address and a lead key " +
  'like SL-7F3K2 on the page — the lead key is for reading aloud, not for the address ' +
  'bar. Search for the business instead.';

/**
 * 03-UI-SPEC § Error → "Unexpected server error", for the spine screens. Not
 * `UNEXPECTED_ERROR` above: that one is Phase 2's and says "Nothing was charged", which is
 * true of a preset and says nothing about what a merge screen needs to hear.
 */
export function SPINE_UNEXPECTED_ERROR(thing: string) {
  return (
    `Something broke on our side loading ${thing}. No business record was changed and no ` +
    `merge was written. Try again — if it keeps happening, the sources ledger shows ` +
    `whether the last ingest finished.`
  );
}

/** The `{thing}` the route error boundaries name in `UNEXPECTED_ERROR` /
 *  `SPINE_UNEXPECTED_ERROR` (C-CR-01). One spelling each, here rather than in the boundary. */
export const ERROR_THING = {
  page: 'this page',
  business: 'this business',
} as const;

// ─── Phase 4 (04-UI-SPEC § Copy Table) ───────────────────────────────────────────────────
/* ======================================================================================
 * PHASE 4 — 04-UI-SPEC § Copy Table, § States → Empty, § States → Error, and Amendment 1
 * (the copy gaps settled at planning). Plan 04-07 owns this section for the whole phase; the
 * screen plans import from it and never edit it, so they can run in parallel.
 *
 * 🔴 WHAT IS FORMATTED HERE AND WHAT IS NOT. Unlike the Phase 3 section above, a count is
 * passed as a NUMBER and grouped here through `formatCount` (the pinned locale, `src/lib/
 * time.ts`), and money is passed as µUSD and formatted here through `formatUsd` — so a caller
 * cannot hand in "1284" or "$2.3". Instants and durations still arrive PRE-FORMATTED
 * (`formatLocal` at the call site), because each one needs its own options (a time-only
 * "2:14:05 PM" vs "Sep 23, 2:14 PM") and this module never picks a zone or a style. Nothing
 * in this section calls `Intl`.
 *
 * 🔴 RULE 30: NO PARAMETER HERE IS GOOGLE TEXT. Every `name` is the SPINE's display name,
 * every `city` the spine's; Google's name, address, phone and URL are never stored and so can
 * never be interpolated. A host class arrives as its enum, never as the URL it came from.
 *
 * 🔴 Curly quotes (“ ”) around a business name ARE the copy; straight apostrophes are too,
 * where the spec has them ("can't", "Google's"). Reproduced exactly as written.
 * ==================================================================================== */

type MicroUsd = bigint | number;

/** "1 tile" / "3 tiles" / "1,284 tiles" — a count with its noun, grouped in the pinned locale. */
function counted(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/* --- Attribution (D-11, PLACE-06; Executor Rules 28–29) ---------------------------------- */

/** Google's required attribution text. Exact, case-sensitive, never translated, never a badge.
 *  `GoogleMapsTag` is its only renderer. */
export const GOOGLE_MAPS_TAG = 'Google Maps';

/** The date beside the tag — a SEPARATE muted span, so the tag's colour and font never reach
 *  it. `date` is pre-formatted through `formatLocal`. */
export function GOOGLE_MAPS_TAG_DATE(date: string) {
  return ` · ${date}`;
}

/** The visually hidden suffix on every external Google Maps link's accessible name. */
export const GOOGLE_MAPS_LINK_SR_SUFFIX = '(opens Google Maps)';

/** Both "Open this listing on Google Maps" buttons (review card and business detail). */
export const OPEN_LISTING_ON_GOOGLE_MAPS = 'Open this listing on Google Maps';

/* --- Actions shared across the Phase 4 screens ------------------------------------------ */

export const PLACES_ACTION = {
  openSpend: 'Open spend view',
  openPresets: 'Open presets',
  reloadPreset: 'Reload this preset',
  reloadBusiness: 'Reload this business',
  reloadQueue: 'Reload the queue',
  tryAgain: 'Try again',
  showDuplicates: 'Show duplicates',
  showGoogle: 'Show Google listings',
} as const;

/** "Open {preset name}" — the way out of a failed, never-started or abandoned run. */
export function RUN_OPEN_PRESET(presetName: string) {
  return `Open ${presetName}`;
}

/* --- Stopped reasons (Executor Rule 35) --------------------------------------------------
 *
 * The SHORT sentence for a stored `runs.stopped_reason`: the preset's recent-runs row, the
 * `/spend` By-run sub-line, and (first clause) the run report's live announcement. The long
 * alerts are further down. `tests/unit/ui-maps.test.ts` asserts every key has a sentence and
 * no sentence contains an underscore — a machine key never reaches the screen. */

export const STOPPED_REASON: Record<StoppedReason, string> = {
  budget_cap_reached: 'Stopped at the monthly cap — nothing past it was charged.',
  // "twice": RUN_CEILING_MULTIPLIER is 2, pinned beside this sentence in ui-maps.test.ts.
  exceeded_estimate: 'Stopped at twice the estimate.',
  google_daily_quota: "Stopped at Google's daily limit — the rest can run after it resets.",
  places_request_rejected: 'Google rejected a request, so the run stopped.',
  places_unavailable: "Google Places didn't answer, so the run stopped.",
  places_key_missing: 'No Google Places key is set for this deployment.',
  never_started: 'Never started — its budget hold was released.',
  abandoned: 'Stopped reporting progress and was marked abandoned.',
};

/** The first clause of a `STOPPED_REASON` sentence, for "Run stopped early — {clause}". */
function firstClause(sentence: string): string {
  return (sentence.split(/ — |, /)[0] ?? sentence).replace(/\.$/, '');
}

/* --- Run report — `/runs/[id]` (§ Screen 1) --------------------------------------------- */

export const RUN_REPORT_TITLE = 'Run report';

export function RUN_REPORT_SUBTITLE(presetName: string, version: number) {
  return `${presetName} · version ${version}`;
}

/** `document.title`. */
export function RUN_REPORT_DOCUMENT_TITLE(presetName: string) {
  return `Run report — ${presetName}`;
}

/** Breadcrumb tail. `startedAt` is pre-formatted ("Sep 23, 2:14 PM"). */
export function RUN_REPORT_BREADCRUMB(startedAt: string) {
  return `Run ${startedAt}`;
}

/** The phone back link is the preset's own name. */
export function RUN_REPORT_BACK_LINK(presetName: string) {
  return presetName;
}

export function RUN_REPORT_STARTED(startedAt: string) {
  return `started ${startedAt}`;
}

/** The header card's one-line summary, by status (§ States → Running / terminal). */
export const RUN_SUMMARY_QUEUED = 'Waiting to start';

export function RUN_SUMMARY_RUNNING(searched: number, total: number) {
  return `${formatCount(searched)} of ${counted(total, 'tile', 'tiles')} searched so far`;
}

/** `duration` is pre-formatted ("17m 04s"). */
export function RUN_SUMMARY_COMPLETE(total: number, duration: string) {
  return `Complete — ${counted(total, 'tile', 'tiles')} searched in ${duration}`;
}

export function RUN_SUMMARY_PARTIAL(searched: number, total: number) {
  return `Stopped early — ${formatCount(searched)} of ${counted(total, 'tile', 'tiles')} searched`;
}

export const RUN_SUMMARY_REFUSED = 'Refused before any request';

export function RUN_SUMMARY_FAILED(calls: number) {
  return `Failed after ${counted(calls, 'request', 'requests')}`;
}

/**
 * The estimate line under the cost (Amendment 1, D-18). The ceiling is ENFORCED ON REQUESTS —
 * inside the monthly free allowance a run's dollar ceiling is $0.00, and "stops at $0.00" on
 * its own would read as "stops immediately" — so both the dollar and the request ceiling are
 * shown. Money in µUSD; `ceilingRequests` is the `runs.ceiling_requests` stored at insert.
 */
export function RUN_ESTIMATE_LINE(
  lo: MicroUsd,
  hi: MicroUsd,
  ceilingUsd: MicroUsd,
  ceilingRequests: number,
) {
  return (
    `Estimated ${formatUsd(lo)}–${formatUsd(hi)} · this run stops at ${formatUsd(ceilingUsd)} · ` +
    `${counted(ceilingRequests, 'request', 'requests')}`
  );
}

/** Muted, not warning: nothing has stopped. */
export function RUN_ABOVE_ESTIMATE(amount: MicroUsd, ceiling: MicroUsd) {
  return (
    `Above the estimate's top by ${formatUsd(amount)} — still under this run's ` +
    `${formatUsd(ceiling)} stop.`
  );
}

export const RUN_CHANGE_CHECK_COST_NOTE =
  'Change checks use the free IDs-only search — every request is still written to the ledger.';

/** `time` is pre-formatted, time only ("2:14:05 PM"). */
export function RUN_REPORT_LIVE_LINE(time: string) {
  return `Updated ${time} · updating every 5 seconds`;
}

/** `finishedAt` and `duration` are pre-formatted ("Sep 23, 2:31 PM", "17m 04s"). */
export function RUN_REPORT_FINISHED_LINE(finishedAt: string, duration: string) {
  return `Finished ${finishedAt} · took ${duration}`;
}

export const RUN_REPORT_REFRESH_NOW = 'Refresh now';
export const RUN_REPORT_REFRESHING = 'Refreshing…';

/** Inline, replacing the "Updated …" line. Both times pre-formatted. */
export function RUN_REPORT_REFRESH_FAILED(time: string, lastTime: string) {
  return (
    `Couldn't refresh at ${time}. Showing the numbers from ${lastTime}; the next try is in ` +
    `5 seconds.`
  );
}

/* --- Run report → stop / refusal / failure alerts --------------------------------------- */

/** `partial` · `budget_cap_reached` (warning). `resetDate` pre-formatted. */
export function RUN_STOP_CAP(
  cap: MicroUsd,
  cost: MicroUsd,
  searched: number,
  notSearched: number,
  resetDate: string,
) {
  return (
    `Stopped at your ${formatUsd(cap)} monthly cap after ${formatUsd(cost)}. Siteless refused ` +
    `the next request before it left, so nothing past the cap was charged. The ` +
    `${counted(searched, 'tile', 'tiles')} already searched are complete; the ` +
    `${formatCount(notSearched)} not searched yet can run after the cap resets on ${resetDate}, ` +
    `or after you raise it.`
  );
}

/** `partial` · `exceeded_estimate` (warning). `ceiling` is 2 × `hi` (RUN_CEILING_MULTIPLIER). */
export function RUN_STOP_ESTIMATE(
  lo: MicroUsd,
  hi: MicroUsd,
  ceiling: MicroUsd,
  subdividing: number,
) {
  return (
    `Stopped at twice the estimate. This run was estimated at ${formatUsd(lo)}–${formatUsd(hi)}, ` +
    `and Siteless stops any run at 2× the top of its estimate — ${formatUsd(ceiling)} — so a ` +
    `tiling surprise can't eat the month. ${counted(subdividing, 'tile was', 'tiles were')} ` +
    `still subdividing when it stopped; they're listed below. Everything collected before the ` +
    `stop is complete.`
  );
}

/**
 * `partial` · `google_daily_quota` (warning; Amendment 1, D-19). Google refused a request with
 * 429 RESOURCE_EXHAUSTED at the per-API daily quota (the second wall), so the run ended cleanly
 * as `partial` — the quota is a planned limit, not a pipeline failure. Action: "Open spend view".
 */
export function RUN_STOP_DAILY_QUOTA(quota: number, searched: number, notSearched: number) {
  return (
    `Stopped at Google's daily limit of ${counted(quota, 'request', 'requests')}. Google refused ` +
    `the next request, so nothing past the limit was charged. The ` +
    `${counted(searched, 'tile', 'tiles')} already searched are complete; the ` +
    `${formatCount(notSearched)} not searched yet can run tomorrow — Google's daily quota ` +
    `resets at midnight Pacific time.`
  );
}

export const RUN_STOP_ACTION = {
  raiseCap: 'Raise the monthly cap',
  askAdmin: 'Ask an admin to raise the cap',
  openSpend: PLACES_ACTION.openSpend,
  showSubdividing: 'Show the tiles still subdividing',
  hideSubdividing: 'Hide the tiles still subdividing',
} as const;

/** The Tiles card's collapsible on an `exceeded_estimate` run (§ Screen 1). */
export function RUN_SUBDIVIDING_TITLE(count: number) {
  return `Tiles still subdividing when the run stopped (${formatCount(count)})`;
}

/**
 * The `{error}` clause inside `RUN_FAILED` for the three Places fail reasons (Amendment 1).
 * Never a thrown message: the reducer's `failReasonOf` collapses every error to one of these
 * keys precisely so no Places response fragment can reach a screen.
 */
export const RUN_FAILED_ERROR: Record<
  'places_request_rejected' | 'places_unavailable' | 'places_key_missing',
  string
> = {
  places_request_rejected: 'Google rejected a request as malformed (HTTP 400)',
  places_unavailable: "Google Places didn't answer after retrying",
  places_key_missing: 'no Google Places API key is set for this deployment, so nothing was sent',
};

/** `failed` (destructive). `error` is a `RUN_FAILED_ERROR` clause. Action: `RUN_OPEN_PRESET`. */
export function RUN_FAILED(calls: number, error: string, cost: MicroUsd) {
  return (
    `The run failed after ${counted(calls, 'request', 'requests')}: ${error}. Every request ` +
    `that left was reserved and ledgered first, so ${formatUsd(cost)} above is exactly what it ` +
    `cost. Start the run again from its preset; the tiles it reached are listed below.`
  );
}

/**
 * `failed` · `never_started` (destructive; Amendment 1). Action: `RUN_OPEN_PRESET(name)`. The
 * minutes are the sweeper's own constant, never a second literal.
 */
export const RUN_NEVER_STARTED =
  `This run never started. The workflow didn't pick it up within ` +
  `${RUN_NEVER_STARTED_AFTER_MINUTES} minutes, so Siteless released its budget hold — nothing ` +
  `was charged. Start it again from its preset.`;

/** `failed` · `abandoned` (destructive; Amendment 1). Action: `RUN_OPEN_PRESET(name)`. */
export function RUN_ABANDONED(cost: MicroUsd) {
  return (
    `This run stopped reporting progress for ${RUN_ABANDONED_AFTER_MINUTES} minutes, so ` +
    `Siteless marked it abandoned. Every request that left was reserved and ledgered first, so ` +
    `${formatUsd(cost)} above is exactly what it cost. Start the run again from its preset; ` +
    `the tiles it reached are listed below.`
  );
}

/** `queued` for more than 2 minutes (muted — nothing is known to be wrong yet). */
export function RUN_QUEUED_LONG(minutes: number) {
  return (
    `Still waiting to start after ${counted(minutes, 'minute', 'minutes')}. The workflow may not ` +
    `have picked this run up — its budget hold is released automatically if it never starts, ` +
    `so nothing is charged while it waits. Check the Workflow runs for this deployment in ` +
    `Vercel.`
  );
}

/* --- Run report → truncation warning (criterion 3) --------------------------------------- */

export function RUN_TRUNCATION_HEADING(n: number) {
  return `${counted(n, 'tile', 'tiles')} still hit Google's 60-result limit at the smallest tile size.`;
}

export const RUN_TRUNCATION_BODY =
  'Google returns at most 60 places per search, and these tiles returned 60 even after ' +
  "Siteless split them as far as it's allowed to. Places beyond the 60th in them are missing " +
  'from this run. Every other tile is complete. Fixing it is a desk change — a narrower ' +
  'Places type for these cells, or a smaller minimum tile in the tiling constants.';

export function RUN_TRUNCATION_SHOW(n: number) {
  return `Show the ${counted(n, 'truncated tile', 'truncated tiles')}`;
}

export const RUN_TRUNCATION_HIDE = 'Hide the truncated tiles';
export const RUN_TRUNCATION_COPY = 'Copy the tile list';

/** One truncated tile. `placesType` is OUR configured type key, not a Google-returned type. */
export function RUN_TILE_ROW(geography: string, placesType: string, tileId: string) {
  return `${geography} · ${placesType} · tile ${tileId}`;
}

/* --- Run report → cards ------------------------------------------------------------------ */

export const RUN_REPORT_CARD = {
  requests: 'Requests',
  tiles: 'Tiles',
  outcomes: 'Outcomes',
  changes: 'Changes',
} as const;

export const RUN_REQUESTS_COLUMN = {
  sku: 'SKU',
  requests: 'Requests',
  freeThisMonth: 'Free this month',
  cost: 'Cost',
} as const;

export const RUN_SKU_NAME = {
  ts_enterprise: 'Text Search Enterprise',
  ts_essentials: 'Text Search Essentials (IDs only)',
  refused: 'Refused by the meter',
  total: 'Total',
} as const;

export const RUN_REQUESTS_FOOTNOTE =
  'One ledger row per request, including the free ones — the monthly free allowance can only ' +
  'be counted if every call is written down. Each results page is a separate request.';

export const RUN_TILES_COUNT = {
  searched: 'Searched',
  saturated: 'Saturated',
  subdivided: 'Subdivided',
  truncated: 'Still truncated',
} as const;

export const RUN_TILES_EXPLAINER =
  "Saturated means a search returned Google's full 60. Siteless splits a saturated tile into " +
  "four and searches again; still truncated means it hit 60 at the smallest size it's allowed " +
  'to split to.';

export const RUN_MATCHING_COUNT = {
  found: 'Found on Google',
  attached: 'Attached',
  tentative: 'Tentative',
  unmatched: 'Matched nothing',
} as const;

export function RUN_REVIEW_LINK(n: number) {
  return `Review ${formatCount(n)} in the queue`;
}

export const RUN_CLUSTER_COLUMN = {
  cluster: 'Cluster',
  found: RUN_MATCHING_COUNT.found,
  attached: RUN_MATCHING_COUNT.attached,
  tentative: RUN_MATCHING_COUNT.tentative,
  unmatched: RUN_MATCHING_COUNT.unmatched,
} as const;

export const RUN_CLUSTER_FOOTNOTE =
  'Matched nothing means no business in the spine scored 80 or above against the listing. ' +
  "Siteless keeps only the listing's id — this column is how the Comptroller and Overture " +
  'coverage gap gets measured, per cluster.';

export const RUN_WEBSITE_TITLE = 'Website on Google';

export const RUN_WEBSITE_ROW = {
  listed: 'Listed a website',
  none: 'No website listed',
} as const;

/**
 * The run report's short host-class labels (the five non-`none` classes, indented under
 * "Listed a website"; `none` is `RUN_WEBSITE_ROW.none`). Words, never colours (D-09).
 * `src/lib/ui/places-format.ts` owns the ORDER; this owns the words.
 */
export const HOST_CLASS_SHORT_LABEL: Record<Exclude<HostClass, 'none'>, string> = {
  other: 'Own website (not yet checked)',
  social: 'Social page',
  directory: 'Directory page',
  platform_subdomain: 'Site-builder subdomain',
  business_site_dead: 'Dead Google site (business.site)',
};

/** Business detail → the signal sentence, one per host class (all six). */
export const HOST_CLASS_SENTENCE: Record<HostClass, string> = {
  none: 'No website listed',
  business_site_dead: 'Website listed — a dead Google site (business.site)',
  social: 'Website listed — a social page, not a website',
  directory: 'Website listed — a directory page, not a website',
  platform_subdomain: 'Website listed — a site-builder subdomain',
  other: 'Website listed — own domain, not checked yet',
};

export const RUN_CHANGE_COUNT = {
  checked: 'Tiles checked',
  unchanged: 'Unchanged',
  new: 'With new places',
  gone: 'With places gone',
} as const;

export function RUN_CHANGE_IDS_LINE(added: number, gone: number) {
  return `New place ids ${formatCount(added)} · Gone place ids ${formatCount(gone)}`;
}

export function RUN_CHANGE_CANDIDATES(changed: number) {
  return `The ${counted(changed, 'changed tile is a candidate', 'changed tiles are candidates')} for the next paid sweep.`;
}

export const RUN_REPORT_FOOTNOTE =
  "Siteless keeps a Google listing's id, a derived website signal, and its coordinates for at " +
  'most 30 days. Nothing else from Google is stored.';

/* --- Run report → the polite live region (transitions only) ------------------------------ */

export const RUN_ANNOUNCE_STARTED = 'Run started';

export function RUN_ANNOUNCE_COMPLETE(cost: MicroUsd) {
  return `Run complete — ${formatUsd(cost)}`;
}

/** "Run stopped early — {reason sentence's first clause}". */
export function RUN_ANNOUNCE_STOPPED(reason: StoppedReason) {
  return `Run stopped early — ${firstClause(STOPPED_REASON[reason])}`;
}

export const RUN_ANNOUNCE_REFUSED = 'Run refused';
export const RUN_ANNOUNCE_FAILED = 'Run failed';

export function RUN_ANNOUNCE_TRUNCATED(n: number) {
  return `${counted(n, 'tile', 'tiles')} truncated`;
}

/* --- Run report → empty and error states -------------------------------------------------- */

export const RUN_RESULTS_PENDING_HEADING = 'No Google places yet';
export const RUN_RESULTS_PENDING_BODY =
  'Results appear here as each tile finishes. The first ones usually land within a minute of ' +
  'the run starting.';

export const RUN_ZERO_PLACES_HEADING = 'Google returned no places for this run';
export const RUN_ZERO_PLACES_BODY =
  'Every tile was searched and none returned a listing of these Places types. That usually ' +
  "means a type in this preset's clusters doesn't match how Google categorises these " +
  "businesses — check the cluster's Places types at the desk.";

export const RUN_REPORT_LOAD_FAILED =
  "We couldn't load this run's report. The run itself is unaffected — if it's running, it " +
  'keeps running and keeps writing to the ledger. Try again, or open the spend view to see ' +
  'what it has cost so far.';

export const RUN_REPORT_NOT_FOUND =
  "No run with that id in this organization. Every run is listed on its preset's page and on " +
  'the spend view.';

export const RUN_REPORT_BAD_ID =
  "That isn't a run id. Open a run from its preset or from the spend view — the address is " +
  'filled in for you.';

/* --- Preset detail — three ways to run (§ Screen 2) -------------------------------------- */

export const RUN_FULL_SWEEP = 'Run full sweep';
export const RUN_PARTITION = "Run this week's partition";
export const RUN_CHECK_CHANGES = 'Check for changes (free)';

export const PRESET_CARD = {
  otherWays: 'Other ways to run',
  recentRuns: 'Recent runs',
} as const;

export const PRESET_PARTITION_DESCRIPTION =
  'Only the cells assigned to this week. Every cell has a fixed week, so four weekly ' +
  'partitions cover the whole preset.';

export const PRESET_CHECK_DESCRIPTION =
  "Lists Google's place ids tile by tile with the free search and flags tiles whose listings " +
  'changed since the last run. It finds no websites — changed tiles are what the next paid ' +
  'sweep should cover.';

/** "~$1.90–$2.90 · ~83 requests · every cell". */
export function PRESET_COST_FULL(lo: MicroUsd, hi: MicroUsd, requests: number) {
  return `~${formatUsd(lo)}–${formatUsd(hi)} · ~${counted(requests, 'request', 'requests')} · every cell`;
}

export function PRESET_COST_PARTITION(
  lo: MicroUsd,
  hi: MicroUsd,
  requests: number,
  cells: number,
  totalCells: number,
  week: number,
) {
  return (
    `~${formatUsd(lo)}–${formatUsd(hi)} · ~${counted(requests, 'request', 'requests')} · ` +
    `${formatCount(cells)} of ${formatCount(totalCells)} cells (week ${week})`
  );
}

export function PRESET_COST_CHECK(requests: number) {
  return `$0.00 · IDs only, no website data · ~${counted(requests, 'request', 'requests')}`;
}

export const PRESET_OFF_STICKY_NOTE = 'Places is switched off — see the note at the top.';

/** The Places-mode notice (muted Alert). `PLACES_MODE` is named on purpose (Open Question 8). */
export const PLACES_MODE_NOTICE_OFF_TITLE = 'Google Places is switched off for this deployment.';
export const PLACES_MODE_NOTICE_OFF_BODY =
  "Nothing on this page can run until it's on. Siteless ships with Places off until the Maps " +
  'Platform terms question is answered and recorded in PROJECT.md → Key Decisions. To turn it ' +
  "on, set PLACES_MODE to ids_only or enterprise in the Vercel project's environment variables " +
  'and redeploy. There is deliberately no switch inside the app.';

export const PLACES_MODE_NOTICE_IDS_ONLY_TITLE = 'Google Places is in IDs-only mode.';
export const PLACES_MODE_NOTICE_IDS_ONLY_BODY =
  "Change checks run, and they're free. Full sweeps and partitions need website data, which " +
  'only the paid Enterprise search returns — set PLACES_MODE to enterprise in Vercel and ' +
  'redeploy to enable them.';

export const PRESET_LAST_RUN_LINK = 'Open the run report';
export const PRESET_RECENT_RUNS_FOOTER = 'See all runs on the spend view';

/** One recent-run row; the status badge renders beside it. All four parts pre-rendered: the
 *  time through `formatLocal`, the kind through `RUN_KIND_LABEL`. */
export function PRESET_RECENT_RUN_ROW(
  started: string,
  kind: string,
  version: number,
  cost: MicroUsd,
) {
  return `${started} · ${kind} · version ${version} · ${formatUsd(cost)}`;
}

export const PRESET_RECENT_RUNS_EMPTY_HEADING = 'No runs yet';
export const PRESET_RECENT_RUNS_EMPTY_BODY =
  'Runs of every version of this preset appear here with their cost and status. Start one ' +
  'with Run full sweep, or check for changes first — that one is free.';
/** The `off`-mode body: the second sentence changes, because nothing can start. */
export const PRESET_RECENT_RUNS_EMPTY_BODY_OFF =
  'Runs of every version of this preset appear here with their cost and status. Google ' +
  'Places is switched off, so nothing can start — the note at the top says how to turn it on.';

/* --- Run drawer (§ Screen 2) -------------------------------------------------------------- */

export function RUN_DRAWER_TITLE_FULL(name: string, version: number) {
  return `Run ${name} · version ${version} · full sweep`;
}

export function RUN_DRAWER_TITLE_PARTITION(name: string, version: number, week: number) {
  return `Run ${name} · version ${version} · week ${week} partition`;
}

export function RUN_DRAWER_TITLE_CHECK(name: string) {
  return `Check ${name} for changes`;
}

export const RUN_DRAWER_CELLS_LABEL = 'Cells';

/** `range` is the week's pre-formatted date range ("Sep 21–27"). */
export function RUN_DRAWER_CELLS(cells: number, totalCells: number, week: number, range: string) {
  return `${formatCount(cells)} of ${formatCount(totalCells)} (week ${week}, ${range})`;
}

export const RUN_DRAWER_COST_LABEL = 'Cost';
export const RUN_DRAWER_CHECK_COST = '$0.00 — IDs-only searches are free';
export const RUN_DRAWER_CHECK_NOTE =
  'Nothing is reserved; each request is still written to the ledger.';

export const RUN_DRAWER_CONFIRM_FULL = 'Reserve budget & start the sweep';

export function RUN_DRAWER_CONFIRM_PARTITION(week: number) {
  return `Reserve budget & run week ${week}`;
}

export const RUN_DRAWER_CONFIRM_CHECK = 'Start the free change check';
export const RUN_DRAWER_STARTING = 'Starting…';
/** Inherited dismiss word — never "Cancel". */
export const RUN_DRAWER_DISMISS = 'Not now';

/** The value of `PLACES_MODE` (src/env.ts). Restated as a literal union so this module never
 *  imports `env` — reading the environment at import time would make copy server-only. */
export type PlacesModeName = 'off' | 'ids_only' | 'enterprise';

const PLACES_MODE_SWITCHED: Record<PlacesModeName, string> = {
  off: 'switched off',
  ids_only: 'switched to IDs-only mode',
  enterprise: 'switched to Enterprise mode',
};

/**
 * Refused by mode — a race: the mode changed between render and click. The mode renders as
 * words, never as its env value ("switched to ids_only" would be a machine key on screen).
 * Action: `PLACES_ACTION.reloadPreset`.
 */
export function RUN_MODE_REFUSED(mode: PlacesModeName) {
  return (
    `Google Places was ${PLACES_MODE_SWITCHED[mode]} after this page loaded, so this run ` +
    `can't start. Nothing was reserved and nothing was charged. Reload the preset to see which ` +
    `runs are available.`
  );
}

export const RUN_START_FAILED =
  "The run didn't start. Nothing was reserved and nothing was charged. Try again — if it keeps " +
  'failing, the spend view shows whether a run was created.';

/** Amendment 1: a second active run for the org (one at a time — two sweeps must not race for
 *  one budget). Action: `RUN_OPEN_RUNNING` → `/runs/{runningRunId}`. */
export const RUN_ALREADY_IN_PROGRESS =
  'Another run is already in progress for this organization. Siteless runs one at a time so ' +
  "two sweeps can't race for the same budget. Nothing was reserved and nothing was charged.";

export const RUN_OPEN_RUNNING = 'Open the running run';

/**
 * Amendment 1: a geography unit with no tileable outline (a Texas-wide county, say). `units`
 * are the unit display names; several are joined "A, B and C" and the pronoun follows.
 */
export function RUN_NO_GEOMETRY(units: string | readonly string[]) {
  const list = typeof units === 'string' ? [units] : [...units];
  const names =
    list.length <= 1
      ? (list[0] ?? '')
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const pronoun = list.length > 1 ? 'them' : 'it';
  return (
    `Siteless has no map outline for ${names}, so it can't tile ${pronoun} for Google Places. ` +
    `The 17 seeded RGV cities, the four RGV counties and radius searches can run. Nothing was ` +
    `reserved and nothing was charged.`
  );
}

/* --- /review — Google listings (§ Screen 3) ----------------------------------------------- */

export const REVIEW_FILTER = {
  all: 'All',
  duplicates: 'Duplicates',
  google: 'Google',
} as const;

/** The "Google" toggle's accessible name. */
export const REVIEW_FILTER_GOOGLE_NAME = 'Google listings';

/** "{n} left to review · {d} duplicate pairs, {g} Google listings". */
export function REVIEW_REMAINING_ALL(n: number, pairs: number, listings: number) {
  return (
    `${formatCount(n)} left to review · ${counted(pairs, 'duplicate pair', 'duplicate pairs')}, ` +
    `${counted(listings, 'Google listing', 'Google listings')}`
  );
}

export function REVIEW_REMAINING_GOOGLE(n: number) {
  return `${counted(n, 'Google listing', 'Google listings')} left to review`;
}

export const REVIEW_GOOGLE_CARD_TITLE = 'Google Maps listing';
export const REVIEW_GOOGLE_CARD_BODY =
  "Siteless keeps only this listing's id, so Google's name, address and phone aren't shown " +
  'here. Open it on Google Maps to compare.';
export const REVIEW_GOOGLE_OPEN_MAPS = OPEN_LISTING_ON_GOOGLE_MAPS;
export const REVIEW_GOOGLE_COMPARED = 'How it compared';

/** The four Google-kind chips. The inherited ones are `REVIEW_CHIP` above. */
export const PLACES_CHIP = {
  cityMatch: 'city match',
  sab: 'service-area business',
  noListingPhone: 'no phone on the listing',
  noListingLocation: 'no location on the listing',
} as const;

export function REVIEW_GOOGLE_REASON_SCORE(score: number) {
  return (
    `Tentative — scored ${score}. Siteless attaches a Google listing on its own only at 95 and ` +
    `above.`
  );
}

/** `other` is the OTHER spine business's display name (rendered as a link by the caller). */
export function REVIEW_GOOGLE_REASON_TIE(score: number, other: string, otherScore: number) {
  return (
    `Tentative — this listing scored ${score} against two businesses: this one and “${other}” ` +
    `(${otherScore}). Siteless never picks between them on its own.`
  );
}

export const REVIEW_ACTION_NOT_THIS = 'Not this business';

export const REVIEW_GOOGLE_HELPER_NOT_THIS =
  'Not this business asks before it records anything — a rejected listing never attaches to ' +
  'this business again.';
export const REVIEW_GOOGLE_HELPER_SKIP = 'Skip leaves this listing pending and moves on.';

export const REVIEW_GOOGLE_EMPTY_HEADING = 'No Google listings to review';
export function REVIEW_GOOGLE_EMPTY_BODY(pairs: number) {
  return (
    `Every tentative Google listing has a decision. ` +
    `${counted(pairs, 'duplicate pair is', 'duplicate pairs are')} still waiting.`
  );
}

export const REVIEW_DUPLICATES_EMPTY_HEADING = 'No duplicate pairs to review';
export function REVIEW_DUPLICATES_EMPTY_BODY(listings: number) {
  return (
    `Every duplicate pair has a decision. ` +
    `${counted(listings, 'Google listing is', 'Google listings are')} still waiting.`
  );
}

/** The "Queue clear" body once both kinds exist. `REVIEW_CLEAR_BODY` (Phase 3) is left in
 *  place for the screen plan that switches over (04-24). */
export const REVIEW_CLEAR_BODY_WITH_GOOGLE =
  'Every duplicate pair and every Google listing in the 80–95 band has a decision. New items ' +
  'appear after the next ingest or the next Places run. Anything at 95 and above merges or ' +
  'attaches on its own, and anything under 80 never reaches this queue.';

export const REVIEW_GOOGLE_DECISION_FAILED =
  "That decision didn't reach the server. Nothing was recorded and this listing is still " +
  "pending, so you haven't lost your place in the queue. Try again, or reload if it keeps " +
  'happening.';

export const REVIEW_GOOGLE_ALREADY_DECIDED =
  'Someone already decided this listing while it was open here. Their decision stands. Reload ' +
  "the queue to see what's next.";

/* --- Reject dialog (the irreversible "Not this business", Rule 42) ------------------------ */

export function REJECT_TITLE(name: string) {
  return `Never attach this Google listing to “${name}”?`;
}

export function REJECT_BODY(name: string) {
  return (
    `Siteless will record that this Google Maps listing is not “${name}” and will never attach ` +
    `it to this business again — not on this run and not on any later one. The listing keeps ` +
    `only its id and counts as “matched nothing” in run reports. Nothing about “${name}” ` +
    `itself changes. There's no undo for this in the app, so if you're unsure, keep it pending ` +
    `and open the listing on Google Maps first. This is recorded with your name and the time.`
  );
}

export const REJECT_CONFIRM = 'Never attach this listing';
export const REJECT_BUSY = 'Recording…';
/** Never "Cancel". */
export const REJECT_DISMISS = 'Keep it pending';

export const REJECT_FAILED =
  "That didn't record. The listing is still pending — nothing was marked, and it can still be " +
  'attached. Try again, or keep it pending and come back to it.';

/* --- Business detail — "Google Maps check" (§ Screen 5) ----------------------------------- */

export const BUSINESS_GOOGLE_TITLE = 'Google Maps check';
export const BUSINESS_GOOGLE_SIGNAL_LABEL = 'Website on Google';
export const BUSINESS_GOOGLE_ONLY_TENTATIVE = 'No confirmed listing yet — one is pending review.';

export function BUSINESS_GOOGLE_LISTING(i: number) {
  return `Listing ${i}`;
}

export function BUSINESS_GOOGLE_LISTING_ATTACHED(i: number, score: number) {
  return `Listing ${i} · attached at ${score}`;
}

export const BUSINESS_GOOGLE_TENTATIVE_BADGE = 'Tentative';

export function BUSINESS_GOOGLE_TENTATIVE_ROW(score: number) {
  return `Pending review — scored ${score}. It isn't used for anything until someone confirms it.`;
}

export const BUSINESS_GOOGLE_REVIEW_LINK = 'Review it in the queue';

export function BUSINESS_GOOGLE_LISTING_NOT_THIS(i: number) {
  return `Listing ${i} · not this business`;
}

/** `date` pre-formatted. */
export function BUSINESS_GOOGLE_REJECTED_BY(actor: string, date: string) {
  return `Rejected by ${actor} on ${date} — never attached again`;
}

export function BUSINESS_GOOGLE_DETACHED_BY(actor: string, date: string) {
  return `Detached by ${actor} on ${date} — never attached again`;
}

export const BUSINESS_GOOGLE_OPEN_MAPS = OPEN_LISTING_ON_GOOGLE_MAPS;
export const BUSINESS_GOOGLE_DETACH = 'Detach this listing';

export function BUSINESS_GOOGLE_HISTORY_SHOW(n: number) {
  return `Show ${counted(n, 'earlier check', 'earlier checks')}`;
}

export const BUSINESS_GOOGLE_HISTORY_HIDE = 'Hide earlier checks';

/** The history row's run link text — "run Sep 23". The row is date · signal sentence · this. */
export function BUSINESS_GOOGLE_HISTORY_RUN(date: string) {
  return `run ${date}`;
}

export const BUSINESS_GOOGLE_EMPTY_HEADING = 'Not checked on Google yet';

/** `city` and `cluster` are the spine's own city and cluster label. */
export function BUSINESS_GOOGLE_EMPTY_BODY(city: string, cluster: string) {
  return (
    `No Google Maps listing is attached to this business. It's checked the next time a run ` +
    `covers ${city} for ${cluster}. Until then Siteless has no Google signal for it — and ` +
    `doesn't assume one.`
  );
}

/**
 * 04-25 copy gap (for danlo's copy review): the empty body above names "{city} for {cluster}",
 * which is false for a business with no city or no cluster mapped — no run can cover it.
 */
export function BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED(missing: 'city' | 'cluster') {
  const what = missing === 'city' ? 'no city on record' : 'no cluster mapped';
  return (
    `No Google Maps listing is attached to this business. Runs search a city for a cluster, and ` +
    `this business has ${what}, so no run covers it yet. Until then Siteless has no Google ` +
    `signal for it — and doesn't assume one.`
  );
}

/**
 * 04-25 copy gap: the muted mark after a history row whose listing is not (or no longer) a
 * signal. DETACH_BODY promises "Its past checks stay in the history, marked detached", and a
 * pending listing's check is never shown as a sentence (D-05).
 */
export const BUSINESS_GOOGLE_HISTORY_MARK = {
  tentative: 'pending review',
  rejected: 'not this business',
  detached: 'detached',
} as const;

export const BUSINESS_GOOGLE_EMPTY_ACTION = PLACES_ACTION.openPresets;

export const BUSINESS_GOOGLE_LOAD_FAILED =
  "We couldn't load this business's Google check. Nothing about the business or its listings " +
  'changed. Try again.';

/* --- Detach dialog ---------------------------------------------------------------------- */

export function DETACH_TITLE(name: string) {
  return `Detach this Google listing from “${name}”?`;
}

export function DETACH_BODY(name: string) {
  return (
    `Siteless stops using this listing's website signal for “${name}” and never attaches it to ` +
    `this business again. Its past checks stay in the history, marked detached. If “${name}” ` +
    `has no other attached listing, it goes back to “Not checked on Google yet” until a run ` +
    `finds another one. This is recorded with your name and the time.`
  );
}

export const DETACH_CONFIRM = 'Detach this listing';
export const DETACH_BUSY = 'Detaching…';
/** Never "Cancel". */
export const DETACH_DISMISS = 'Keep it attached';

export const DETACH_FAILED =
  "The detach didn't complete. The listing is still attached exactly as it was, and its " +
  'signal still counts for this business. Try again, or reload the business.';

/**
 * 04-25 copy gap (for danlo's copy review): `detachListing` answers `conflict` /
 * `already_decided` when the listing is no longer attached — someone detached it (or it was
 * never confirmed) while this page was open. DETACH_FAILED's "still attached exactly as it
 * was" would be false there, so the dialog shows this and offers only the reload.
 */
export const DETACH_ALREADY_DECIDED =
  "This listing isn't attached any more — someone else changed it while this page was open. " +
  'Their decision stands and nothing of yours was recorded. Reload the business to see where ' +
  'it stands.';

/* --- /sources — the transient card (§ Screen 4) ------------------------------------------ */

export const SOURCES_TRANSIENT_TITLE = 'Google Places (transient)';
export const SOURCES_TRANSIENT_SUBTITLE =
  "A verifier, not a source. Siteless keeps a listing's id, a derived website signal, and the " +
  "listing's coordinates for at most 30 days — a daily purge removes them.";

export const SOURCES_TRANSIENT_LABEL = {
  placeIds: 'Place ids held',
  coordinates: 'Coordinates held',
  oldest: 'Oldest coordinates',
  lastPurge: 'Last purge',
  purged: 'Rows purged',
} as const;

export function SOURCES_TRANSIENT_OLDEST(days: number) {
  return `${counted(days, 'day', 'days')} old · limit 30`;
}

export const SOURCES_TRANSIENT_NONE_HELD = 'None held';
export const SOURCES_TRANSIENT_NEVER_RUN = 'Never run';

/** `date` pre-formatted; `hours` and `count` are numbers. */
export function SOURCES_TRANSIENT_PURGE_OVERDUE(date: string, hours: number, count: number) {
  return (
    `The daily purge last ran ${date} — ${counted(hours, 'hour', 'hours')} ago. ` +
    `${counted(count, 'coordinate is', 'coordinates are')} past 30 days. The database already ` +
    `refuses to read them, so nothing shows them, but they're still on disk until the purge ` +
    `runs. Check the Vercel cron log for the purge job, or run it by hand at the desk.`
  );
}

/** 04-17 copy gap: the overdue alert when the org has NEVER been purged, so there is no
 *  "last ran {date}" to name. `hours` = age of the oldest held coordinate. Same voice and
 *  way out as SOURCES_TRANSIENT_PURGE_OVERDUE. */
export function SOURCES_TRANSIENT_PURGE_NEVER_RAN(hours: number, count: number) {
  return (
    `The daily purge has never run, and the oldest coordinates Siteless holds are ` +
    `${counted(hours, 'hour', 'hours')} old. ` +
    `${counted(count, 'coordinate is', 'coordinates are')} past 30 days. The database already ` +
    `refuses to read them, so nothing shows them, but they stay on disk until the purge runs. ` +
    `Check the Vercel cron log for the purge job, or run it by hand at the desk.`
  );
}

export const SOURCES_TRANSIENT_PURGE_COPY = 'Copy the purge command';

export const SOURCES_TRANSIENT_EMPTY_HEADING = 'No Google Places call yet';
export const SOURCES_TRANSIENT_EMPTY_BODY =
  'Nothing from Google is held. Once a run searches Places, this shows the place ids and ' +
  'coordinates Siteless keeps, and the daily purge that removes coordinates after 30 days.';
export const SOURCES_TRANSIENT_EMPTY_ACTION = PLACES_ACTION.openPresets;

export const SOURCES_TRANSIENT_LOAD_FAILED =
  "We couldn't read what Siteless holds from Google Places. Nothing was purged or changed by " +
  'this — the daily purge runs on its own schedule. Try again.';

/* --- Settings → Budget — the second-wall card (§ Screen 6; Rule 41) ----------------------
 *
 * The "not set yet" state's plain strings, lifted from `second-wall-card.tsx` as they stand;
 * its two derivation paragraphs carry inline <strong> runs and stay with the component's own
 * markup plan (04-31). The "set" state is the checkpoint's static copy — the app cannot read
 * GCP and never claims to. */

export const SECOND_WALL_TITLE = 'Google Cloud daily quota — not set yet';
export const SECOND_WALL_NEEDS_BADGE = 'Needs danlo';
export const SECOND_WALL_CONSOLE_LINK = 'Open the Google Cloud quotas console';

export const SECOND_WALL_SET_TITLE = 'Google Cloud daily quota — set';
export const SECOND_WALL_SET_BADGE = 'Set';

/** `date` is the day danlo set it, pre-formatted. */
export function SECOND_WALL_SET_BODY(date: string) {
  return (
    `Places API (New) → Requests per day = 100, set on ${date}. This is the second wall: even ` +
    `if Siteless's own meter failed, Google stops Places requests after 100 a day — about $3.50 ` +
    `of paid requests. The meter above is still the wall that matters.`
  );
}

/* --- Toasts (success only — a refusal is a persistent Alert) ----------------------------- */

export function TOAST_ATTACHED(name: string) {
  return `Attached to “${name}”`;
}

export function TOAST_REJECTED(name: string) {
  return `Listing won't be attached to “${name}” again`;
}

export function TOAST_DETACHED(name: string) {
  return `Listing detached from “${name}”`;
}

export const TOAST_TILE_LIST_COPIED = 'Tile list copied';
export const TOAST_PURGE_COMMAND_COPIED = 'Purge command copied';
