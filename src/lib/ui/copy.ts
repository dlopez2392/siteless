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

export function MERGE_REASON_AUTO(score: number) {
  return `Auto-merged at ${score}`;
}

export function MERGE_REASON_REVIEW(actor: string) {
  return `Reviewed by ${actor}`;
}

/** Named, never icon-only: on a screen of near-identical rows the consequential choice is
 *  the unambiguous one. */
export function UNMERGE_ACTION(loser: string) {
  return `Unmerge ${loser}`;
}

/** `date` is pre-formatted through `formatLocal`. */
export function MERGE_UNDONE(actor: string, date: string) {
  return `Unmerged by ${actor} on ${date}`;
}

/* --- The unmerge confirmation (D-20 — the one destructive action in this phase) ----- */

export function UNMERGE_TITLE(loser: string, winner: string) {
  return `Unmerge “${loser}” from “${winner}”?`;
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

export function TOAST_UNMERGED(loser: string) {
  return `Unmerged — “${loser}” is active again`;
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
} as const;

export const REVIEW_DECISION_FAILED =
  "That decision didn't reach the server. Nothing was recorded and this pair is still " +
  "pending, so you haven't lost your place in the queue. Try again, or reload if it keeps " +
  'happening.';

export const REVIEW_LOAD_FAILED =
  "We couldn't load the review queue. Nothing is wrong with your decisions — every one " +
  'already recorded is safe. Try again, or check the sources ledger to see whether the ' +
  'last ingest finished.';

export const UNMERGE_FAILED =
  "The unmerge didn't complete. The two records are still merged exactly as they were — " +
  'nothing was half-undone, and both lead keys still point where they did a moment ago. ' +
  'Try again, or check the sources ledger if an ingest is running.';

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
