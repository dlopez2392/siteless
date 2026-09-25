---
phase: 04-places-transient-verifier
plan: 25
subsystem: ui
tags: [business-detail, places, attribution, google-maps, detach, PLACE-06, PLACE-02, rule-28, rule-32, rule-42]
requires:
  - phase: 04-07
    provides: "copy.ts BUSINESS_GOOGLE_* / DETACH_* / TOAST_DETACHED / GOOGLE_MAPS_TAG_DATE / GOOGLE_MAPS_LINK_SR_SUFFIX; places-format signalSentence + mapsUrlFor"
  - phase: 04-08
    provides: "GoogleMapsTag (the one attribution renderer)"
  - phase: 04-21
    provides: "BusinessDetail.google: GoogleCheckView (epoch ms); detachListing(input) -> ActionResult<{businessId, businessName}>"
provides:
  - "GoogleCheck (src/components/business-detail/google-check.tsx), server component, + exported type GoogleCheckBusiness"
  - "GoogleCheckHistory (client island, collapsed history toggle)"
  - "DetachDialog (src/components/business-detail/detach-dialog.tsx), client, Rule 42 confirmation"
  - "copy: DETACH_ALREADY_DECIDED, BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED, BUSINESS_GOOGLE_HISTORY_MARK"
  - "tests/unit/fixtures/google-check.ts (GoogleCheckView fixtures, reusable by 04-28's attribution registry)"
  - "'places coordinates are never rendered' guard in tests/unit/no-internal-leak.test.ts"
affects: [04-28, 04-33, phase-07-triage-card]
tech-stack:
  added: []
  patterns:
    - "Server component with client islands that receive server-rendered rows as children (history toggle) or a trigger as children (dialog)"
    - "One [data-places-content] container per Places-derived row, exactly one GoogleMapsTag each; rows with no Places value carry neither"
    - "Refusal mapping in the dialog branches on code + detail.reason, not on the action's message"
key-files:
  created:
    - src/components/business-detail/google-check.tsx
    - src/components/business-detail/google-check-history.tsx
    - src/components/business-detail/detach-dialog.tsx
    - tests/unit/google-check.test.tsx
    - tests/unit/detach-dialog.test.tsx
    - tests/unit/fixtures/google-check.ts
  modified:
    - src/app/(app)/businesses/[id]/page.tsx
    - src/lib/ui/copy.ts
    - tests/unit/no-internal-leak.test.ts
key-decisions:
  - "Detach conflict (already_decided) shows the new DETACH_ALREADY_DECIDED sentence with only 'Reload this business'. It never shows DETACH_FAILED's false 'still attached exactly as it was'. not_found and validation show the action's own sentence with only the reload. unexpected and a thrown request keep DETACH_FAILED with Try again + Reload"
  - "A tentative listing's website sentence is hidden in its row AND in the history (marked 'pending review' there). Detached and rejected listings' past checks keep their sentence plus a muted mark ('detached' / 'not this business'), because DETACH_BODY promises 'marked detached'"
  - "The tentative row carries a tag because its score is Places-derived (Rule 28 lists 'a score'). Rejected and detached rows show no score and no tag"
  - "The empty state never names a run that cannot happen: if the business has no cluster or no city, BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED is used instead"
  - "data-status on a listing row is the DISPLAYED kind: attached | tentative | rejected | detached. detached = status rejected + reason detached"
  - "History toggle count = every observation ('Show 4 earlier checks' for 4). Dates are formatLocal, Chicago, en-US: 'Sep 22' for the tag and the run link, 'Sep 22, 2026' for history rows and decisions"
requirements-completed: [PLACE-06, PLACE-02]
duration: ~50min
completed: 2026-09-23
---

# Phase 4 Plan 25: Business detail — Google Maps check Summary

**The business detail now has a "Google Maps check" card. It shows the attached-only website signal as a host-class sentence, with a "Google Maps · {Chicago date}" attribution. Each listing appears by status (attached, tentative, rejected or detached), and the check history is collapsed and newest first. A Rule 42 detach dialog never calls the action before confirm, and never claims that a listing someone else already detached is "still attached".**

## Performance

- **Duration:** about 50 min
- **Tasks:** 2 of 2, 5 commits: RED for T1, RED for T2, GREEN for T2, GREEN for T1, then style
- **Files:** 6 created, 3 modified

## Task Commits

| # | Commit | What |
|---|---|---|
| T1 RED | `014278e` | test(04-25): failing tests for the Google Maps check card, plus the fixtures |
| T2 RED | `94d791b` | test(04-25): failing tests for the detach confirmation and the coordinates guard |
| T2 GREEN | `653ead7` | feat(04-25): DetachDialog, plus the three copy-gap strings in copy.ts |
| T1 GREEN | `42cbb48` | feat(04-25): GoogleCheck, GoogleCheckHistory, page wiring |
| style | `98713f9` | style(04-25): prettier on the new files |

T2 GREEN landed before T1 GREEN because `GoogleCheck` renders `DetachDialog`. Each task still has its RED commit before its GREEN commit.

## What was built

- **`google-check.tsx`** is a server component. The card is `business-google`, titled "Google Maps check".
  - **Row 1** (`business-google-signal`, `data-host-class`, `data-places-content`) uses the `FieldRow` three-column grid: "Website on Google", then `signalSentence`, then `GoogleMapsTag` followed by a separate muted `tabular-nums` date span (`business-google-signal-date`).
    - With no signal but a pending listing, row 1 reads "No confirmed listing yet — one is pending review." It has no tag, no container and no `data-host-class`.
    - With no listing at all, the card shows `business-google-empty` ("Not checked on Google yet", the city and cluster, and an "Open presets" link to `/presets`).
  - **Listing rows** (`business-google-listing-{attachmentId}`, `data-status`) follow the read's order.
    - **Attached:** "Listing i · attached at s", the listing's own sentence, tag + date, "Open this listing on Google Maps" and "Detach this listing".
      - The Maps link uses `mapsUrlFor(placeId, displayName, city)`, `target=_blank` and `rel="noopener noreferrer"`. Its accessible name has the sr-only suffix "(opens Google Maps)".
      - Both buttons are `h-11` outline. Detach is the destructive outline.
    - **Tentative:** the `Tentative` badge (`FLAG_BADGE_SIZING`), "Pending review — scored s…", "Review it in the queue" linking to `/review?kind=google`, and the tag. There is never a sentence.
    - **Rejected / detached:** "Listing i · not this business", then "Rejected by / Detached by {actor} on {date} — never attached again". There is no score, no tag and no action.
  - **One attached listing and nothing else:** row 1 carries that listing's actions, and no listing row renders.
  - **History** renders only when there is more than one observation. `GoogleCheckHistory` is closed by default (`business-google-history-toggle`). Each row (`business-google-history-row-{observationId}`, `data-places-content`) shows the date, the sentence or mark, a "run Sep 22" link to `/runs/{runId}`, and the tag.
- **`detach-dialog.tsx`** copies `unmerge-dialog.tsx`'s structure: desk `Dialog` or phone `Drawer`, a destructive `Alert` body (`business-google-detach-consequences`), a filled destructive confirm "Detach this listing" that shows "Detaching…" while busy, and an outline dismiss "Keep it attached". Both are 48px on phone.
  - It uses `onClick` inside `useTransition`, with no `<form>`. It stays modal while pending.
  - On success only, it shows the `TOAST_DETACHED` toast, closes, and calls `router.refresh()`.
- **`page.tsx`** renders `<GoogleCheck>` between "Fields and sources" and "Source records".
  - Listing `decidedBy` Clerk ids join the merge actors in the one `actorNames` call. An unresolved id prints as itself.
  - City and cluster come from the spine fields.
  - It is still one `withOrg`.

## Gates (final tree, `worktree-agent-a68e7b234332c7f75` @ `98713f9`, printed after the gate)

- `npx vitest run tests/unit`: **72 files, 548 tests passed.** This plan adds 2 files and 21 tests (10 + 10 + 1).
- `npx tsc --noEmit`: exit 0.
- `npx eslint src tests scripts`: exit 0.
- `npx next build`: exit 0. It lists `/businesses/[id]` as ƒ. Build output was discarded, and the generated `src/app/.well-known/workflow` is gitignored.
- `prettier --check --end-of-line auto` is clean on every new file and on `no-internal-leak.test.ts`. `page.tsx` was already not prettier-clean at base (`e7b458c`, its function signature line). My region in it is clean, so I did not reformat the file.
- Acceptance greps: `GoogleMapsTag` appears 4× in google-check.tsx. `<form` in detach-dialog.tsx returns nothing (exit 1).
- The db lane was not run: this plan adds no SQL, schema or query.

### Named tests (read by name from verbose output)

**`tests/unit/google-check.test.tsx`, 10 tests (the plan's 7, plus 3):**
- `the google check shows the business signal with the Google Maps tag and date` (two zones: "Sep 22" and never "Sep 23")
- `the listings render attached, then tentative, then rejected and detached` (+)
- `an attached listing shows its own signal, a tag, the Google Maps link and detach` (+)
- `a tentative listing shows no website sentence`
- `rejected and detached listings show who and when and carry no tag`
- `one attached listing renders once`
- `the empty google check says not checked yet`
- `the empty google check never names a run that cannot happen for an unmapped business` (+)
- `only tentative listings read as no confirmed listing yet`
- `the check history is collapsed and newest first`

**`tests/unit/detach-dialog.test.tsx`, 10 tests (the plan's 3, plus 7):**
- `the detach trigger calls no server action until confirm`
- `keep it attached dismisses without detaching`
- `the detach dialog keeps the listing attached on failure`
- `the detach dialog reloads the business from a failure`
- `the detach dialog never claims a listing someone else detached is still attached`
- `the detach dialog shows a not-found refusal as its own sentence with only the reload`
- `a detach whose request never reaches the server keeps the dialog open with the detach-failed sentence`
- `a successful detach toasts the business name, closes and refreshes`
- `while detaching the confirm reads Detaching… and the dialog stays open and modal`
- `on a phone the detach confirmation is a drawer with the same contract`

**`tests/unit/no-internal-leak.test.ts`, 1 new test:** `places coordinates are never rendered`. It walks `src/components` and `src/app` with the shared `_walk`, matching the whole identifier `place_coordinates` / `placeCoordinates` / `place-coordinates`, and deep-walks the keys of every `GoogleCheckView` fixture. It is two-sided: it checks for more than 50 files, pins google-check.tsx and page.tsx, and pins nested fixture key paths.

### Mutation checks (14; each applied by a scratch runner, the named tests read red, the file restored byte-for-byte, `git status` / `git diff` empty afterwards)

| # | Mutation | Red (exact names) |
|---|---|---|
| M1 | tentative row loses its tag | a tentative listing shows no website sentence · only tentative listings read as no confirmed listing yet |
| M2 | tentative row shows its website sentence | a tentative listing shows no website sentence · only tentative listings read as no confirmed listing yet |
| M3 | dates formatted in the process zone | the google check shows the business signal… · an attached listing shows its own signal… · the check history is collapsed and newest first |
| M4 | one attached listing no longer merges | one attached listing renders once |
| M5 | history open by default | the check history is collapsed and newest first |
| M6 | history oldest first | the check history is collapsed and newest first |
| M7 | rejected row carries a tag | rejected and detached listings show who and when and carry no tag |
| M8 | unmapped empty state names a run | the empty google check never names a run that cannot happen… |
| M9 | opening the dialog calls detachListing | the detach trigger calls no server action until confirm (+6 dependents) |
| M10 | already_decided shows DETACH_FAILED, retryable | the detach dialog never claims a listing someone else detached is still attached |
| M11 | dismiss calls confirm | keep it attached dismisses without detaching · …not-found refusal… |
| M12 | a refusal closes the dialog | the detach dialog keeps the listing attached on failure (+4) |
| M13 | coordinate table named in google-check.tsx | places coordinates are never rendered |
| M14 | a fixture grows a `lat` key | places coordinates are never rendered |

## Deviations from Plan

### The detach-conflict handling (the 04-21 handoff; for danlo's copy review)

- **[Rule 1 - Bug] DETACH_FAILED was false on a conflict.** `detachListing` answers `conflict` with `detail.reason = 'already_decided'` and uses DETACH_FAILED as the message. That sentence says the listing is "still attached exactly as it was", which is false once someone else has detached it.
  - The dialog now branches on `code` + `detail.reason` and shows the **new** `DETACH_ALREADY_DECIDED`: *"This listing isn't attached any more — someone else changed it while this page was open. Their decision stands and nothing of yours was recorded. Reload the business to see where it stands."*
  - It offers only "Reload this business", which closes the dialog and calls `router.refresh()`. Closing the dialog any other way after a non-retryable refusal also refreshes.
  - `not_found` / `validation` show the action's own `NOT_FOUND('listing')` with the same reload-only treatment.
  - Tests: `the detach dialog never claims…` (M10) and `…not-found refusal…`.
  - Commit: `653ead7`.

### Copy added (copy.ts; each marked "04-25 copy gap" in its doc comment for danlo's review)

1. `DETACH_ALREADY_DECIDED`, above.
2. **`BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED('city' | 'cluster')` [Rule 1].** The spec's empty body, "…checked the next time a run covers {city} for {cluster}", is false for a business with no cluster mapped (no run can cover it). It also printed "null". The new text reads: *"No Google Maps listing is attached to this business. Runs search a city for a cluster, and this business has no cluster mapped / no city on record, so no run covers it yet. Until then Siteless has no Google signal for it — and doesn't assume one."*
3. **`BUSINESS_GOOGLE_HISTORY_MARK` = { tentative: 'pending review', rejected: 'not this business', detached: 'detached' } [Rule 2].**
   - DETACH_BODY promises that a detached listing's "past checks stay in the history, marked detached", and nothing marked them.
   - 04-21's history includes a tentative listing's observations. Printing their sentence would present an unconfirmed signal as a fact (D-05), so those rows show "pending review" instead of a sentence.

### Other

- **[Rule 3] Extra file `google-check-history.tsx`.** The Collapsible and its Show/Hide label need client state. `google-check.tsx` stays a server component, so the toggle is a data-free client island that receives the server-rendered rows as `children`. It exports only the component.
- **[Rule 3] Extra file `tests/unit/fixtures/google-check.ts`.** The google-check test renders from these fixtures, and the no-internal-leak guard walks them (the plan's "fixture has no lat/lng keys"). The file lives here so the node lane can import it.
- **The detach-dialog test renders `DetachDialog` directly** with a `business-google-detach-{id}` trigger, rather than through `GoogleCheck`. The GoogleCheck test separately pins that the trigger exists on attached rows, and on row 1 in the merged case.
- **Coordinate-name match is whole-identifier.** The plan says "no file under src/app mentions place_coordinates". A plain substring check fails today on `src/app/api/cron/purge-places/route.ts:53` (`app.purge_expired_place_coordinates`), a route handler that deletes the rows and renders nothing. `\b` excludes that call and still catches the table and schema-module names (M13).
- **The run link's date is the observation's date.** `GoogleCheckView.history` has no run start time; the observation happens during its run.
- **Maps query name.** `business.displayName` falls back to the lead key when the spine has no display name, which is the page's existing header fallback. The Maps link then queries "SL-XXXX, {city}". The `query_place_id` still identifies the listing. It is a customer-safe key, not an internal annotation.

**Total:** 2 × Rule 1, 1 × Rule 2, 2 × Rule 3, plus the notes above. No architectural change.

## Test ids 04-28 / 04-33 will target

- **Card and rows:** `business-google`, `business-google-signal` (`data-host-class`, `[data-places-content]` when a signal exists), `business-google-signal-date`, `business-google-listing-{attachmentId}` (`data-status` = attached | tentative | rejected | detached).
- **Actions:** `business-google-open-maps-{attachmentId}`, `business-google-detach-{attachmentId}`.
- **History:** `business-google-history-toggle`, `business-google-history-row-{observationId}`.
- **Empty state:** `business-google-empty`.
- **Dialog:** `business-google-detach-dialog`, `business-google-detach-consequences`, `business-google-detach-confirm`, `business-google-detach-dismiss`, `business-google-detach-error`, `business-google-detach-retry`, `business-google-detach-reload`.
- **Tag:** `google-maps-attribution`.
- **04-28's `PLACES_SIGNAL_SURFACES` registry:** render `<GoogleCheck google={MIXED} business={GOOGLE_BUSINESS} actors={GOOGLE_ACTORS} />` from `tests/unit/fixtures/google-check.ts`. The signal row, both attached rows, the tentative row and (after clicking the toggle) every history row are `[data-places-content]` containers with exactly one tag. The test must `vi.mock` `@/server/actions/detach-listing` and `@/server/actions/queue-run` (see google-check.test.tsx).
- **04-28's repo walk:** google-check.tsx imports both `places-format` and `GoogleMapsTag`. google-check-history.tsx and detach-dialog.tsx import neither.
- **04-33:** the business detail's Google card in both themes. Seed a business with an attached listing so the tag, the date and the two 44px buttons render; seed a tentative-only business for the badge.

## Merge notes

- **`src/lib/ui/copy.ts`:** three insertions, all in the "Business detail — Google Maps check" / "Detach dialog" block. The first two sit just above `BUSINESS_GOOGLE_EMPTY_ACTION`; the third sits after `DETACH_FAILED`. A parallel plan appending in the same block may conflict textually. Keep both sides.
- **`page.tsx`:** one import, a widened `clerkUserIds(merges, google)`, a `googleBusiness` / `googleActors` block, and one JSX element after `<FieldsAndSources>`. 04-24 does not touch this file.
- **`no-internal-leak.test.ts`:** two imports (`nodePath`, the fixtures, `walk`) and one appended `describe`. The existing three tests are unchanged.
- No migration, no production command, no push, no Playwright, no dev server.

## Known Stubs

None that block the goal. Two spec states are not built as separate UI, and both are out of this plan's file list:
- **"Business detail, Google card" loading skeleton (§ States → Loading):** the route's existing `loading.tsx` covers the whole page.
- **"Google card failed to load" (§ States → Error):** the Google read runs inside the page's single `withOrg`, so a failure reaches the route's `error.tsx` rather than the card.
- `BUSINESS_GOOGLE_LOAD_FAILED` stays unused. A later plan can wire both if the read is ever split out.

## Threat Flags

None. The only new surface is the one in the plan's register:
- **T-4-06:** confirm-only detach; the action re-checks the org.
- **T-4-11:** `mapsUrlFor`, `noopener noreferrer`.
- **T-4-13:** one tag per Places container.
- **T-4-04:** no coordinate read, plus the named repo walk.

## TDD Gate Compliance

- T1: RED `014278e` (the suite failed to resolve `@/components/business-detail/google-check`), then GREEN `42cbb48`.
- T2: RED `94d791b` (detach-dialog was unresolved; the coordinates guard was red on its positive control, which pins google-check.tsx), then GREEN `653ead7`.

## Self-Check: PASSED

- FOUND: src/components/business-detail/google-check.tsx, google-check-history.tsx, detach-dialog.tsx, tests/unit/google-check.test.tsx, tests/unit/detach-dialog.test.tsx, tests/unit/fixtures/google-check.ts
- FOUND commits: 014278e, 94d791b, 653ead7, 42cbb48, 98713f9
