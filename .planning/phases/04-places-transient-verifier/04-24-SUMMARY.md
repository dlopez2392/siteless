---
phase: 04-places-transient-verifier
plan: 24
subsystem: review-ui
tags: [review-queue, google-places, attribution, reject-dialog, rule-42, rule-20, rule-28, rule-30, rule-31]
requires:
  - 04-06 (matcher PlaceFeatures: scoreSab / decide)
  - 04-07 (placesChips, mapsUrlFor, copy REVIEW_GOOGLE_* / REJECT_* / TOAST_*)
  - 04-08 (GoogleMapsTag)
  - 04-21 (listReviewQueue filter + GoogleListingView, recordListingDecision)
provides:
  - "/review renders both item kinds with the All · Duplicates · Google filter (?kind=)"
  - "SpineRecordCard (exported from candidate-pair.tsx), GoogleListingCard, RejectDialog, ReviewFilter"
  - "ReviewActions kind='google' (Same business / Not this business -> dialog / Skip)"
  - "Session skip memory for listings: ?skip= ids, sunk by readReviewQueue(tx, filter, skippedListings)"
  - "src/lib/ui/review-kind.ts: parseReviewKind, parseSkipped, withSkipped, reviewHref, reviewRemainingText, reviewEmptyKind"
affects: [04-25, 04-28, 04-33, phase-07 TRI-03]
tech-stack:
  added: []
  patterns:
    - "URL-carried session state for a decision that persists nothing (?skip=), sunk server-side rather than hidden"
    - "Copy sentence split around the quoted name to inline a link without restating the copy"
    - "Structural chip type in SignalChips so it never imports the Places formatter (Rule 28 stays on the card)"
key-files:
  created:
    - src/components/review/google-listing-card.tsx
    - src/components/review/reject-dialog.tsx
    - src/components/review/review-filter.tsx
    - src/lib/ui/review-kind.ts
    - tests/unit/review-google.test.tsx
    - tests/unit/reject-dialog.test.tsx
    - tests/unit/places-chips-contract.test.ts
  modified:
    - src/components/review/candidate-pair.tsx
    - src/components/review/signal-chips.tsx
    - src/components/review/review-actions.tsx
    - src/components/review/review-empty.tsx
    - src/app/(app)/review/page.tsx
    - src/server/queries/review-queue.ts
    - tests/db/review-queue-google.test.ts
    - tests/unit/review-actions.test.tsx
decisions:
  - "Skip on a Google listing: the skipped attachment ids ride in ?skip= (uuid-validated, newest 50) and readReviewQueue SINKS them below every unskipped item (D-13's pair rule), rather than hiding them — so a filtered queue never shows 'No Google listings to review' while listings are still pending, and skipped ones resurface once the rest is worked"
  - "Skip advances by router.push(skipHref) after the server confirms the listing is still pending; attach/reject advance by router.refresh() after the write"
  - "The filter carries ?skip= across kind switches, so switching kinds never brings back a listing just skipped"
  - "Reject dialog: retryable failures read REJECT_FAILED (per § Error table) with Try again; not_found/conflict read the action's own sentence with Reload the queue"
  - "Queue clear switches to REVIEW_CLEAR_BODY_WITH_GOOGLE for every filter"
metrics:
  duration: "~35 min"
  completed: 2026-09-23
  tasks: 2
  files: 15
---

# Phase 4 Plan 24: Review queue — the Google listing kind Summary

`/review` now shows tentative Google listings next to duplicate pairs in one score-ordered queue, with an All · Duplicates · Google filter in `?kind=`. A Google item shows the spine record through the reused Phase 3 card. Beside it is one bordered Places card: the chips, the reason the listing is tentative (a tie links to the other business), a link out to Google Maps by `place_id`, and exactly one Google Maps tag. "Same business" attaches without a dialog. "Not this business" only opens a destructive confirmation, which stays modal until the write lands. "Skip" moves on by carrying the listing id in `?skip=`, and the queue sinks that listing.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | SpineRecordCard extraction, GoogleListingCard, chips widening, chips contract test | `f92f59b` | candidate-pair.tsx, google-listing-card.tsx, signal-chips.tsx, review-google.test.tsx, places-chips-contract.test.ts |
| 2 | RejectDialog, Google actions, filter, empty states, page | `2a518eb` | reject-dialog.tsx, review-actions.tsx, review-filter.tsx, review-empty.tsx, page.tsx, review-kind.ts, review-queue.ts, reject-dialog.test.tsx |
| 2b | Stronger skip-ordering assertion (a mutation survived the first version) | `d95c753` | tests/db/review-queue-google.test.ts |

## Skip handling (04-21 handoff)

A Google listing's "Skip" persists nothing, because 0029 has no skip column. So a refresh after a skip re-reads the same listing. Here is how 04-24 handles it:

- **The URL remembers the session's skips.** `?skip=<id>,<id>` holds them. `parseSkipped` accepts uuids only, drops duplicates, lower-cases them and keeps the newest 50 (`SKIPPED_MAX`). Nothing else reaches SQL. The ids travel as one text parameter, split in SQL by `string_to_array` (never a JS array in a drizzle template).
- **The queue sinks skipped listings; it does not hide them.** `readTopListing` orders by `skipped, score desc, id`. The kind merge ranks skipped below unskipped for both kinds, then by score, pair-first on ties. `remaining` and `counts` still include skipped listings, because they are still pending. Once every listing has been skipped, the skipped ones come back highest first. This is the same D-13 behaviour a skipped pair already had, and the screen never shows an empty state while listings are pending.
- **The bar.** Skip calls `recordListingDecision({decision:'skip'})`. That writes nothing but re-checks org and pending state. On `ok`, the bar calls `router.push(skipHref)`, never `refresh`. The page builds `skipHref` as `reviewHref(kind, withSkipped(skipped, attachmentId))`.
- **Pinned by:** `skip on a google item moves on to the next listing without recording a decision` (unit) and `a listing skipped this session sinks below every undecided item` (db).
- **Limits.** A fresh visit to `/review` without `?skip=` starts over. That is intended: the skips are session memory, not a decision. Past 50 skips the oldest drop off the URL and resurface in order.

## Verification

- **Unit lane:** `npx vitest run tests/unit`: **73 files, 549 tests, all passed**.
  - New tests, read by name:
    - review-google.test.tsx (10):
      - `the google listing card shows the spine side, chips, reason and one Google Maps tag`
      - `the tie reason names the other business as a link`
      - `the open-on-Google-Maps link is built from the place id and opens safely`
      - `the google listing card renders no Google text`
      - `the review filter reflects the URL`
      - `the remaining count names both kinds`
      - `the google empty state offers the duplicates`
      - `the duplicates empty state offers the Google listings`
      - `queue clear covers both kinds…`
      - `the review URL carries only valid skipped listing ids`
    - reject-dialog.test.tsx (11):
      - `the reject trigger calls no server action until confirm`
      - `the reject dialog stays open until the write lands`
      - `the reject dialog: a request that never reaches the server…`
      - `the reject dialog: a listing someone else decided offers only a reload`
      - `keep it pending dismisses without recording`
      - `same business on a google item records a confirm without a dialog`
      - `same business on a google item that fails…`
      - `skip on a google item moves on to the next listing without recording a decision`
      - `a second tap on a google item…`
      - `the google helper sentences…`
      - `on a phone the reject confirmation is a drawer…`
    - places-chips-contract.test.ts (1): `the matcher's features render as chips`
  - The Phase 3 tests `review-actions.test.tsx` (8) and `review-chips.test.ts` (9) are green.
- **DB lane:** `tests/db/review-queue-google.test.ts`, `listing-actions.test.ts` and `review-actions.test.ts`: **3 files, 30 tests, all passed**. Each ran in `withTxRollback` on the shared local DB; nothing was reset.
- **tsc:** `npx tsc --noEmit` exits 0.
- **Lint:** `npx eslint src tests scripts` exits 0.
- **Build:** `npx next build` exits 0, and `/review` builds as dynamic.
- **Acceptance greps:**
  - no `function Side`;
  - `export function SpineRecordCard` present;
  - no `iframe` / `maps/embed` in google-listing-card.tsx;
  - no `<form` in reject-dialog.tsx;
  - no `gap-3` in touched review files.

### Mutations (each applied, the named test went red, reverted, `git status` clean)

| # | Mutation | Red test |
|---|----------|----------|
| M1 | Drop `<GoogleMapsTag />` from the listing card | `the google listing card shows the spine side, chips, reason and one Google Maps tag` |
| M2 | `rel="noopener"` only | `the open-on-Google-Maps link is built from the place id and opens safely` |
| M3 | Render an extra view field (`googleName`) in the card | `the google listing card renders no Google text` |
| M4 | Rename `listingLocation` → `listingLocated` in match.ts (04-06) | `the matcher's features render as chips` |
| M5 | The dialog's `onOpenChange(true)` calls `recordListingDecision` | `the reject trigger calls no server action until confirm` (+4 others) |
| M6 | `onRecorded()` before the write (advance first) | `the reject dialog stays open until the write lands` (+3 others) |
| M7 | Skip does `router.refresh()` instead of `push(skipHref)` | `skip on a google item moves on to the next listing without recording a decision` |
| M8 | The filter pushes without `?skip=` | `the review filter reflects the URL` |
| M9 | Kind merge back to 04-21's rule (a skipped listing outranks an unskipped pair on score) | `a listing skipped this session sinks below every undecided item` (db). This mutation **survived** the first version of the test and was killed after `d95c753` |
| M10 | Google remaining line uses the pairs sentence | `the remaining count names both kinds` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Skip needed a server-side exclusion, so review-queue.ts was modified (not in files_modified)**
- **Found during:** Task 2 (the 04-21 handoff note).
- **Issue:** Skip persists nothing, so no client-only approach can show the next item. The next item is a server read.
- **Fix:** `readReviewQueue` / `listReviewQueue` take an optional `skippedListings`, and skipped listings sink as described above. A db test was added (`tests/db/review-queue-google.test.ts`). The Google item's key set is unchanged: `skipped` is a query column, not a view field.
- **Commits:** `2a518eb`, `d95c753`.

**2. [Rule 3 - Blocking] New pure module `src/lib/ui/review-kind.ts` (not in files_modified)**
- A Next page file may not export helpers. The URL parsing, the remaining line and the empty-state choice needed one server-safe home, shared by the server page and the client filter and bar. It has no client directive, and its import of `review-queue` is type-only.

**3. [Rule 3 - Blocking] `tests/unit/review-actions.test.tsx` gained two `vi.mock` lines**
- **Issue:** `review-actions.tsx` now imports `recordListingDecision`, and RejectDialog brings in `useIsDesk` from run-drawer.tsx, which imports `queue-run`. The un-mocked `server-only` threw in the dom lane, so the suite loaded 0 tests.
- **Fix:** the file now factory-mocks both modules. None of its tests changed, and all 8 pass.
- Heads-up: any other dom test that imports `review-actions.tsx` needs the same two mocks.

**4. [Rule 1 - Test strength] The first skip-ordering db assertion could not kill M9**
- The listing compared after sinking was an unskipped one. The added assertion skips every listing (`d95c753`).

**5. Test placement.** The filter, remaining and empty-state tests live in `review-google.test.tsx`, beside the card. The Google action-bar tests live in `reject-dialog.test.tsx` with the dialog. The test names match the plan's `-t` targets.

### Notes
- `candidate-pair.tsx` was not prettier-clean at the base. My Task 1 edit ran `prettier --write`, which collapsed one import and wrapped one filter; it changed nothing else. Files that were not prettier-clean at the base and that I only touched lightly (`review-queue.ts`, `review-actions.test.tsx`, the db test) were left unformatted, to keep the diffs small.
- The plan says `$PNPM test:unit -t`. Per the repo's Windows note, I used `npx vitest run <file> -t … --reporter=verbose` and read the test names.

## Threat surface

| Flag | File | Description |
|------|------|-------------|
| threat_flag: url-to-sql | src/app/(app)/review/page.tsx → src/server/queries/review-queue.ts | `?skip=` is user-controlled and reaches a query. Mitigations: `parseSkipped` keeps uuid-shaped values only (a unit test pins an injection string → `[]`); the value is bound as one parameter; RLS scopes the read, and a foreign id matches nothing (a db test pins this). It only reorders; it never widens what is readable. |

T-4-05, T-4-06, T-4-11 and T-4-13 are each mitigated as planned and pinned by the tests named above.

## For later plans

- **04-28 (Rule 28 repo walk / `PLACES_SIGNAL_SURFACES`):**
  - The review surface is `GoogleListingCard`, container `[data-testid="review-google-listing"][data-places-content]`. It has exactly one `google-maps-attribution`.
  - `google-listing-card.tsx` is the only new file importing `places-format`, and it imports `GoogleMapsTag`.
  - `signal-chips.tsx` deliberately does NOT import `places-format`; its chip type is structural.
- **04-33 (both-theme real-screen shots, e2e):**
  - Testids: `review-filter`, `review-filter-{all|duplicates|google}`, `review-google` (`data-kind="google"`), `review-google-side`, `review-google-listing`, `review-google-open-maps`, `review-tentative-reason` (`data-reason`), `review-tentative-tie-link`, `review-action-same|not-this|skip`, `review-reject-dialog`, `review-reject-consequences`, `review-reject-confirm`, `review-reject-dismiss`, `review-reject-error`, `review-reject-retry`, `review-reject-reload`, `review-google-clear`, `review-duplicates-clear`, `review-remaining`.
  - Deep link: `/review?kind=google`.
- **Merge notes:**
  - This touches `src/server/queries/review-queue.ts` (04-21's file; no other wave-5 plan lists it).
  - It adds `src/lib/ui/review-kind.ts`. It does NOT touch `copy.ts`, which 04-26 edits.
  - No migrations.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: google-listing-card.tsx, reject-dialog.tsx, review-filter.tsx, review-kind.ts, review-google.test.tsx, reject-dialog.test.tsx, places-chips-contract.test.ts.
- Commits exist: `f92f59b`, `2a518eb`, `d95c753`.
