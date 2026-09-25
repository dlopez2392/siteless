---
phase: 04-places-transient-verifier
slice: C (UI — run report, review Google kind, business Google check, preset run actions/drawer, sources transient card, spend, nav, copy/format/run-tone, and their unit + e2e tests)
reviewed: 2026-09-24T00:00:00Z
depth: standard (server-action/query → component contracts followed)
files_reviewed: 75
files_reviewed_list:
  - .env.example
  - .gitignore
  - .prettierignore
  - src/app/(app)/businesses/[id]/page.tsx
  - src/app/(app)/presets/[id]/page.tsx
  - src/app/(app)/presets/page.tsx
  - src/app/(app)/review/page.tsx
  - src/app/(app)/runs/[id]/error.tsx
  - src/app/(app)/runs/[id]/loading.tsx
  - src/app/(app)/runs/[id]/not-found.tsx
  - src/app/(app)/runs/[id]/page.tsx
  - src/app/(app)/sources/page.tsx
  - src/app/globals.css
  - src/components/app-shell/app-sidebar.tsx
  - src/components/app-shell/mobile-tab-bar.tsx
  - src/components/app-shell/more-sheet.tsx
  - src/components/budget/second-wall-card.tsx
  - src/components/business-detail/detach-dialog.tsx
  - src/components/business-detail/google-check-history.tsx
  - src/components/business-detail/google-check.tsx
  - src/components/places/google-maps-tag.tsx
  - src/components/preset-detail/other-runs.tsx
  - src/components/preset-detail/places-mode-notice.tsx
  - src/components/preset-detail/recent-runs.tsx
  - src/components/preset-detail/run-actions.tsx
  - src/components/preset-detail/run-costs.ts
  - src/components/preset-detail/run-drawer.tsx
  - src/components/preset-detail/run-plan.ts
  - src/components/preset-detail/summary-card.tsx
  - src/components/preset-detail/version-history.tsx
  - src/components/review/candidate-pair.tsx
  - src/components/review/google-listing-card.tsx
  - src/components/review/reject-dialog.tsx
  - src/components/review/review-actions.tsx
  - src/components/review/review-empty.tsx
  - src/components/review/review-filter.tsx
  - src/components/review/signal-chips.tsx
  - src/components/runs/changes-card.tsx
  - src/components/runs/outcomes-card.tsx
  - src/components/runs/requests-card.tsx
  - src/components/runs/run-alerts.tsx
  - src/components/runs/run-auto-refresh.tsx
  - src/components/runs/run-header.tsx
  - src/components/runs/run-report-view.tsx
  - src/components/runs/run-status-badge.tsx
  - src/components/runs/tiles-card.tsx
  - src/components/sources/copy-command-button.tsx
  - src/components/sources/transient-card.tsx
  - src/components/spend/by-run.tsx
  - src/lib/resolve/score.ts
  - src/lib/time.ts
  - src/lib/ui/copy.ts
  - src/lib/ui/places-format.ts
  - src/lib/ui/review-kind.ts
  - src/lib/ui/run-tone.ts
  - tests/e2e/budget-banner.spec.ts
  - tests/e2e/preset-detail.spec.ts
  - tests/e2e/runs.spec.ts
  - tests/e2e/sources.spec.ts
  - tests/e2e/spend.spec.ts
  - tests/unit/detach-dialog.test.tsx
  - tests/unit/google-check.test.tsx
  - tests/unit/google-maps-attribution.test.tsx
  - tests/unit/google-maps-tag.test.tsx
  - tests/unit/preset-actions.test.tsx
  - tests/unit/reject-dialog.test.tsx
  - tests/unit/review-actions.test.tsx
  - tests/unit/review-google.test.tsx
  - tests/unit/run-auto-refresh.test.tsx
  - tests/unit/run-chrome.test.tsx
  - tests/unit/run-drawer.test.tsx
  - tests/unit/run-report.test.tsx
  - tests/unit/second-wall-card.test.tsx
  - tests/unit/stale-estimate.test.tsx
  - tests/unit/transient-card.test.tsx
findings:
  critical: 4
  warning: 13
  info: 9
  total: 26
status: issues_found
---

# Phase 4: Code Review Report, Slice C (UI)

**Reviewed:** 2026-09-24
**Depth:** standard. Every server action and query that feeds a component was traced (`queueRun`, `recordListingDecision`, `detachListing`, `readRunReport`, `readGoogleCheck`, `getSpendByRun`, `place_attachments.features` via `toPageRecord`).
**Files reviewed:** 75
**Status:** issues_found

## Summary

The structural guards hold up. I found no server component importing plain data from a client module. Every client import is either a component or type-only: `run-plan.ts`, `run-costs.ts`, `review-kind.ts`, `places-format.ts`, `run-tone.ts` and `second-wall.ts` all carry no directive, and `run-costs.ts` imports `RunPartition` as a type only. There is no `<form action>`: every mutation runs through `onClick` + `useTransition`. The detach and reject dialogs map every `ActionResult` code to a true sentence. `formatLocal` / `formatWeekRange` pin the zone and the locale, and every calendar date is anchored at noon UTC. The one arbitrary-property form, `[--card-spacing:--spacing(6)]`, is a property assignment and not the banned `[--x]` shorthand. No e2e spec clicks `run-confirm`.

The defects cluster in four places:

1. **The run drawer, the one money-starting control, is the only action caller with no `try/catch`.** A rejected `queueRun` promise takes the whole preset page into `(app)/error.tsx` (CR-01).
2. **The known 04-27 item is confirmed and worse than flagged.** `PLACES_MODE=off` is the live production state, so every preset page in production offers a clickable "Run version N". Clicking it ends in a false sentence, and "Reload this preset" loops back to the same page (CR-02).
3. **The run report tells historical runs things that are only true of now.** It prints "Every tile was searched" on failed and partial runs (CR-03). It quotes the current month's cap and reset date in stop and refusal alerts (CR-04). It labels every partition run "This week's partition" (WR-06).
4. **Attribution (Rule 28) has gaps.** The truncation warning and the review header's score render Places-derived numbers outside a tagged container, and no registry covers them.

On the chip wording: the band logic is correct, including the distance = 0 "no chip" case. But the chips silently drop the persisted `address` points, which can carry up to 30 points and the address signal (WR-01). The divergence from UI-SPEC line 535 needs danlo's approval (IN-01).

## Critical Issues

### C-CR-01: The run drawer has no `try/catch` around `queueRun`, so a failed request crashes the preset page

**File:** `src/components/preset-detail/run-drawer.tsx:191-227`
**Issue:** `confirm` does `const result = await queueRun(...)` inside `startTransition` with no `try/catch`. In React 19, a rejected promise inside an async transition goes to the nearest error boundary.

- **When it rejects:** lost signal on a phone, a 5xx, or a deploy that retired the action id ("Failed to find Server Action").
- **What the user sees:** `/presets/[id]` has no `error.tsx`, so `(app)/error.tsx` replaces the page with the generic "unexpected error". The drawer, the summary and the recent runs are gone.
- **Why it matters here:** this is the only control that starts spend. The request can also die AFTER the server committed the run and called `start()`, so the reader is left not knowing whether a sweep is running.
- **Precedent:** this is exactly the C-CR-01 class Phase 3 fixed. `review-actions.tsx:183-194`, `reject-dialog.tsx:119-127` and `detach-dialog.tsx:129-137` all catch; the drawer was written after that fix and missed it.
- **Test gap:** `tests/unit/run-drawer.test.tsx` has no rejected-promise case.

**Fix:**
```tsx
let result: Awaited<ReturnType<typeof queueRun>>;
try {
  result = await queueRun({ searchVersionId: selectedId, kind: ACTION_KIND[kind] });
} catch {
  // The request never answered. The run MAY exist (the response can be lost after commit),
  // so don't claim "nothing was reserved": send the reader to where runs are listed.
  setOutcome({ kind: 'error', message: RUN_START_UNKNOWN }); // new copy: "We couldn't confirm the run started — check Recent runs or the spend view before trying again."
  return;
}
```
Add a named test, "a run request that never reaches the server keeps the drawer open", and watch it fail with the catch removed.

### C-CR-02: The version-history "Run version N" buttons ignore `PLACES_MODE` (the known 04-27 item, confirmed)

**Files:**
- `src/components/preset-detail/version-history.tsx:129-161`, `:64-68` (`HistoryContext` has no mode)
- `src/app/(app)/presets/[id]/page.tsx:318-324`
- `src/lib/ui/copy.ts:1506-1512`

**Issue:** `RowActions` always wraps `Run version {n}` in an enabled `RunDrawer kind="full"`. Both the desk row and the phone card do this, so every version gets two triggers. `HistoryContext` carries no mode, so the page cannot disable them.

What happens in `off` (the production default today, 04-30) and in `ids_only`:
1. The drawer opens with "Budget left this month" and a "Reserve budget & start the sweep" confirm. The Places-mode notice at the top of the same page says "Nothing on this page can run".
2. Confirm returns `mode_refused`, which renders `RUN_MODE_REFUSED(mode)`: "Google Places was switched off after this page loaded". That is false: it was off when the page loaded.
3. The only way out, "Reload this preset", re-renders the same clickable button, and the same false sentence comes back.

Rule 33 requires `aria-disabled` + a no-op + `aria-describedby` → the notice for every mode-disabled run action. The e2e off-mode test (`tests/e2e/preset-detail.spec.ts:341-385`) checks only the three new testids, which is why this passed.

I'm rating this Critical rather than Warning because it is the default production configuration on the product's primary screen, and it tells the user something false about the system's state, with a reload loop.

**Fix:**
- Add `placesMode: PlacesModeName` and `noticeId: string` to `HistoryContext`, and pass them from the page.
- In `RowActions`, when `!MODE_ALLOWS[context.placesMode].full`, render the button without `RunDrawer`, with `aria-disabled="true"`, `aria-describedby={context.noticeId}`, `onClick={e => e.preventDefault()}` and `DISABLED_CLASS`. Reuse `ActionButton`'s pattern: move it to `run-plan.ts`'s sibling, or export a tiny server-safe helper.
- Extend the off-mode e2e to assert `version-row-*-run` and `version-card-*-run` are `aria-disabled`.

### C-CR-03: A failed or stopped-early run with zero places says "Every tile was searched"

**Files:**
- `src/components/runs/outcomes-card.tsx:251-291`
- `src/lib/ui/copy.ts:1314-1318`

**Issue:** `empty && live` shows the pending state. Every other empty case, meaning any non-live status, shows `RUN_ZERO_PLACES_BODY`: "Every tile was searched and none returned a listing of these Places types … check the cluster's Places types at the desk."

That sentence renders under every one of these, contradicting the stop alert above it on the same page:
- `failed` · `places_key_missing`: "no Google Places API key is set … nothing was sent". This is the likeliest first production failure.
- `failed` · `never_started`
- `failed` · `abandoned` before any results
- `partial` · `budget_cap_reached` / `google_daily_quota` hit on the first tile

The sentence is false about the data, and it sends danlo to fix Places types when the real fault is a missing key or the cap. Only `complete` with `found === 0` makes it true. The unit test (`run-report.test.tsx:699`) renders only the default `complete` status.

**Fix:**
```tsx
const finishedClean = run.status === 'complete';
{empty && live ? <Pending/> : empty && finishedClean ? <ZeroPlaces/> : empty ? (
  <p data-testid="run-outcomes-none-reached" className="text-base text-muted-foreground">
    {RUN_OUTCOMES_NONE_REACHED /* "This run stopped before any listing came back — the alert above says why." */}
  </p>
) : <>…</>}
```
Add a test per terminal status.

### C-CR-04: Historical stop and refusal alerts quote the CURRENT month's cap and reset date

**Files:**
- `src/components/runs/run-alerts.tsx:213`, `:229-235`
- source: `src/server/queries/run-report.ts:267`, `:475-476` (`readCurrentPeriod`)

**Issue:** `run.capMicroUsd` / `run.capResetMs` come from `readCurrentPeriod(tx, 'places')`, not from the run's own period, and the alerts render them as facts about that run:
- `RUN_STOP_CAP`: "Stopped at your {cap} monthly cap after {cost} … the {m} not searched yet can run after the cap resets on {date}"
- `RUN_REFUSED`: "Your {cap} cap is spent, so Siteless didn't call anything"

**Concrete case:**
1. A partition stops at the $50 cap on Sep 29.
2. On Oct 2, danlo opens it from "Recent runs".
3. It says the remaining tiles "can run after the cap resets on Nov 1". False: October's budget is fresh and they can run now.
4. If the cap was raised to $75 in between, it says "Stopped at your $75 monthly cap after $50.02". That contradicts itself.

A refused run from last month reads "Your $50 cap is spent" while this month's meter is at $0. These are false statements about money on a screen reachable from every recent-runs row and every `/spend` link. Cap-stops cluster at month end, so the month rollover is the common case, not an edge case.

**Fix:**
- Read the cap for the period the run belongs to: `budget_periods` joined on `date_trunc('month', r.created_at at time zone APP_TZ)` / `periodStart(run.createdMs)`.
- Compute `capResetMs` from that period.
- When the run's period is not the current one, render the past-tense variant, e.g. "Stopped at the {cap} monthly cap then in force … the budget has since reset — the {m} tiles not searched can run now", and drop the reset date.
- `RUN_REFUSED` needs the same past-tense form: "Refused: the {cap} cap for {month} was spent."

## Warnings

### C-WR-01: The Google-listing chips drop the persisted `address` points, including the address signal and the spec'd "same ZIP" chip

**File:** `src/lib/ui/places-format.ts:208-211`, `:212-271`
**Issue:**
- `page-record.ts` `FEATURE_KEYS` persists `address`: 30 for a full match, which is also the `address` signal, 15 for number + ZIP, and 5 for ZIP only. The matcher computes it from Google's address in memory via `addressKey` in `match.ts`.
- `placesChips` never reads `f.address`. Its comment's reason ("the listing's address is never stored") is wrong: the address itself isn't stored, but the points are.
- Result: a listing that scored 85 = name 34 + address 30 + distance 15 + cluster 5 shows "name similar · within 100 m · same cluster". The second-largest component of the score, and one of the two independent signals, is invisible to the person judging it.
- UI-SPEC L535 lists "same ZIP" among the Google-kind chips.

**Fix:**
```ts
const addressPoints = num(f.address);
if (addressPoints !== null && addressPoints >= ADDRESS_FULL) chips.push({ key: 'zip', label: PLACES_CHIP.sameAddress, agrees: true });
else if (addressPoints === ADDRESS_NUM_POSTAL) chips.push({ key: 'zip', label: PLACES_CHIP.sameNumberZip, agrees: true });
else if (addressPoints === ADDRESS_POSTAL_ONLY) chips.push({ key: 'zip', label: REVIEW_CHIP.sameZip, agrees: true });
```
Import the constants from `score.ts`, as `DISTANCE_TIERS` already is, and add rows to the chips contract test.

### C-WR-02: Places-derived numbers render outside a tagged container (Rule 28 / PLACE-06)

**Files:**
- `src/components/runs/run-alerts.tsx:337-395` (`TruncationWarning`)
- `src/app/(app)/review/page.tsx:90-98` (`review-score`)

**Issue:** Rule 28 defines "a tile saturation count" and "a score … against a listing" as Places-derived. Two surfaces show one outside a container with a tag:
- **Truncation warning:** "{n} tiles still hit Google's 60-result limit" plus the list of truncated tiles, in an `Alert` with no `GoogleMapsTag`. The same count in the Tiles card is tagged. The exceeded-estimate alert's "{k} tiles were still subdividing" has the same gap.
- **Review header:** on a Google item, `review-score` ("Score 87 of 100") sits in the header row, outside `review-google-listing`, which holds the only tag.

`PLACES_SIGNAL_SURFACES` in `google-maps-attribution.test.tsx:243` doesn't include either, so the guard can't see them. The spec's own layout ("score line stays in the header row") conflicts with its Rule 28, which is a question for the 04-29 legal checkpoint.

**Fix:**
- Add a `GoogleMapsTag` at the foot of `TruncationWarning` and of the exceeded-estimate alert, each marked `data-places-content`.
- For Google items, render the score line inside the listing card, or add a tag beside it.
- Register all three surfaces in `PLACES_SIGNAL_SURFACES`.

### C-WR-03: A live refresh that fails on the server replaces the whole report with `error.tsx`

**File:** `src/components/runs/run-auto-refresh.tsx:172-185`
**Issue:** The spec requires a failed refresh to keep "the previous numbers". Two problems:
- `router.refresh()` returns `void` and never throws, so the `try/catch` around it is dead code.
- When the RSC re-render throws (a DB blip on the `max: 1` pool while the workflow is writing), Next renders `runs/[id]/error.tsx` in place of the segment. The report, the island and its timers all unmount. Polling stops, and the reader lands on "We couldn't load this run's report" in the middle of a run.

Only the timeout path of the refresh contract actually works.

**Fix:** Put a client error boundary around the report body that keeps the last good children and shows `RUN_REPORT_REFRESH_FAILED`. Alternatively, do the live read through a lightweight route handler and trigger `router.refresh()` only once that read succeeds. At minimum, delete the dead `try/catch` and say so in the component's header comment.

### C-WR-04: Truncated and subdividing tile rows print raw machine keys

**File:** `src/components/runs/run-alerts.tsx:328-334` (used by `tiles-card.tsx:162`)
**Issue:**
- `tileRowText` renders `parts[0]` of `tileKeyOf` (`{unitKind}:{unitId}`) as the geography, plus the raw configured type. The result looks like "city:4845384 · car_repair · tile r0213".
- The spec's `{geography}` is a place name.
- These rows are also what "Copy the tile list" puts on the clipboard for the desk.

**Fix:** Have `readRunReport` return the resolved unit name (it already has the reference index for cluster names) and a humanized type label, then render `RUN_TILE_ROW(unitName, typeLabel, quadPath)`. Keep the raw key in a `data-tile-key` attribute for the copy payload if the desk needs it.

### C-WR-05: The check drawer says "Nothing is reserved", but `queueRun` holds 1 µUSD, so a free check can be refused at the cap

**Files:**
- `src/lib/ui/copy.ts:1476-1478`
- `src/components/preset-detail/run-drawer.tsx:237-241`
- source: `src/server/actions/queue-run.ts:223-232`

**Issue:** For `change_check`, `queueRun` calls `app.reserve_budget` with `holdMicroUsd = 1n`. Once the month's cap is fully committed, that reservation fails. The reader has just been told "$0.00 — IDs-only searches are free" and "Nothing is reserved". They press "Start the free change check" and get `run-refused`: "This run was refused. Your $50 cap is spent". In `ids_only`, that means the only action the page offers is blocked by a budget the copy said it doesn't touch.

**Fix:** Pick one:
- Reword to "A placeholder of $0.000001 is held so the check is metered; each request is still written to the ledger", and give the refused alert a check-specific sentence.
- Or exempt `ts_essentials` zero-cost holds from the cap comparison in `app.reserve_budget`. That is a slice-A decision.

### C-WR-06: Every historical partition run is labelled "This week's partition"

**File:** `src/lib/ui/run-tone.ts:206-210` (rendered in `run-header.tsx`, `recent-runs.tsx`, `by-run.tsx`)
**Issue:** `RUN_KIND_LABEL.partition` is a deictic phrase. A partition run from three weeks ago reads "This week's partition · started Sep 2" on its report, in Recent runs and on `/spend`. The spec's Copy Table has the same wording, so this is a spec defect that got implemented as written.

**Fix:** Label it "Weekly partition" and append the week where it is known: `runs.partition_index` / `isoWeekOf(started)` → "Partition · week 36". Keep "This week's partition" only for the preset page's action row.

### C-WR-07: Drawer refusals that can't succeed on retry still offer "Try again" and "Open spend view"

**File:** `src/components/preset-detail/run-drawer.tsx:225`, `:393-418`
**Issue:** Every code other than `budget_refused`, `mode_refused` and `conflict/busy` falls into the `error` outcome, which offers "Try again" and "Open spend view". That includes:
- `validation` (unestimable version; `RUN_NO_GEOMETRY`)
- `not_found`

Retrying resends the same request and gets the same refusal. `RUN_NO_GEOMETRY`'s own spec'd way out is "edit the preset's geography", and the unestimable sentence says "Open the preset and pick its geography again". Neither button does either. The confirm button also stays visible under a non-blocking error.

**Fix:** Add an outcome `{ kind: 'invalid' }` for `validation` / `not_found`. It should be blocking, and its action should be an "Edit preset" link to `/presets/{id}/edit` (pass `editHref` in the drawer props). Keep "Try again" for `unexpected` only.

### C-WR-08: "Copy the purge command" and "Copy the tile list" fail silently

**Files:**
- `src/components/sources/copy-command-button.tsx:45-53`
- `src/components/sources/transient-card.tsx:232`
- `src/components/runs/run-alerts.tsx:370-375`

**Issue:** A refused clipboard write (insecure context, denied permission, some in-app browsers) is swallowed. The comment justifies this with "the command is printed verbatim in the sentence right above this button". That holds for the ledger's ingest command. It does not hold for:
- `PURGE_PLACES_COMMAND`, which appears nowhere in `SOURCES_TRANSIENT_PURGE_OVERDUE`
- the tile list, which is hidden until the collapsible is opened

The reader taps, gets no toast and no error, and has nothing to copy by hand.

**Fix:** On `catch`, show a toast or inline line with the text itself: `toast.error(\`Couldn't copy — run: ${command}\`)`. Alternatively, render the command in a `<code>` element under the purge alert.

### C-WR-09: The second-wall card hard-codes "100" and "$3.50" instead of reading `GOOGLE_QUOTA_REQUESTS_PER_DAY`

**Files:**
- `src/components/budget/second-wall-card.tsx:5`, `:105`
- `src/lib/ui/copy.ts:1882-1920`
- `src/lib/budget/second-wall.ts:14-17`

**Issue:** `second-wall.ts` says the run-stop alert and the second-wall card "both read THIS value, so the number a stopped run names and the number the settings card names cannot drift apart". The card imports only `GOOGLE_QUOTA_SET_ON`. `SECOND_WALL_SET_BODY`, `SECOND_WALL_DERIVATION` and `SECOND_WALL_LIMIT` spell 100, 3,000, $70 and $3.50 as literals. Changing the constant moves the run alert and leaves the card stating the old quota.

**Fix:** Make the three copy entries functions of `(quotaPerDay)` and derive the money through `formatUsd` from the SKU price constant. Then add a test that changes the constant and asserts both surfaces move together.

### C-WR-10: "Purge overdue" fires during normal operation and contradicts itself

**Files:**
- `src/components/sources/transient-card.tsx:202`, `:245`
- rule: `src/lib/places/purge-status.ts:46-47`

**Issue:** `purgeOverdue` returns true whenever `expiredAwaitingPurge > 0`. Coordinates expire continuously (each has its own `expires_at`) while the purge runs once a day. So with a perfectly healthy cron, every batch of expiring rows raises the warning for up to 24 h, and the warning says "Check the Vercel cron log".

The sentence also contradicts itself. When overdue fires because of expired rows, it reads "The daily purge last ran Sep 23, 3:00 AM — 3 hours ago." When it fires because of age, it reads "0 coordinates are past 30 days. The database already refuses to read them…". This follows the spec's wording, but it trains danlo to ignore a warning whose point is to be acted on.

**Fix:**
- Only count as overdue expired rows whose `expires_at` is older than `PURGE_OVERDUE_HOURS`. The query would return `oldestExpiredMs`.
- Choose the sentence by cause: an old last purge versus rows waiting past the slack.
- Omit the "past 30 days" clause when the count is 0.

### C-WR-11: `spend.spec.ts` counts By-run rows and links before the tab has painted

**File:** `tests/e2e/spend.spec.ts:58-78`, `:99-116`
**Issue:** Both tests click `spend-tab-by-run` and immediately call `.count()`. Radix Tabs mounts inactive content on activation, so the count can be taken before the content exists:
- The first test can see 0 rows and 0 empty states and go red. That is a flake.
- `every listed run links to its report` then hits `test.skip(count === 0, 'no runs exist…')`. It skips green on a deployment that has runs, so the test never checks anything.

`budget-banner.spec.ts:77-91` documents this exact trap and waits on an anchor. This file doesn't.

**Fix:** Before counting, wait for exactly one of the three containers: `await expect(page.locator('[data-testid="spend-by-run-empty"]:visible, [data-testid="spend-by-run-table"]:visible, [data-testid="spend-by-run-cards"]:visible')).toHaveCount(1);` Then count `:visible` links.

### C-WR-12: The truncation `Alert` is a live region whose heading changes every refresh

**File:** `src/components/runs/run-alerts.tsx:341-352`
**Issue:** `role="status"` implies `aria-live="polite"` and `aria-atomic="true"`. During a live run, `stillTruncated` climbs, so "3 tiles still hit…" becomes "4 tiles still hit…" and the whole alert is re-announced every time the count changes. Opening the collapsible adds list items, which is announced again. The announcement also duplicates `run-live-status`'s "N tiles truncated".

The spec's own rule says "The counts that change every 5 seconds are not in a live region". Its instruction to give this alert `role="status"` conflicts with that rule.

**Fix:** Give the Alert `role="note"` or no role. `RunAutoRefresh` already announces the first truncation.

### C-WR-13: The Google check history shows a rejected listing's website sentence on this business

**File:** `src/components/business-detail/google-check.tsx:247-264`
**Issue:** History rows hide the sentence only for `tentative` listings (D-05: an unconfirmed signal is never shown as fact). A `rejected` listing, which a human confirmed is NOT this business, still renders "Website listed — own domain, not checked yet · not this business" in this business's history. That puts another business's website signal on a lead card that Phase 7 inherits, which is a stronger case than the tentative one D-05 already excludes.

**Fix:** Also suppress the sentence for `kind === 'rejected'`. Keep the "not this business" mark and the run link.

## Info

### C-IN-01: The chip wording diverges from UI-SPEC L535. Needs danlo's approval.

**File:** `src/lib/ui/places-format.ts:226-250`, `src/lib/ui/copy.ts:1577-1598`

**Divergence:** since `dc8e057` (2026-09-23), the Google-listing chips name the scorer's band ("name match" / "name similar" / "different name"; "within 100 m" / "500 m" / "2 km") rather than the spec's "name 0.84" / "140 m apart". 04-29-SUMMARY:49 records it as flagged for danlo.

**Logic checked:**
- The name band is keyed on `signals.includes('name')` (sim ≥ 0.85) and `namePoints > 0` (sim above about 0.407).
- The distance tier is matched by `points`, and distance 0 correctly renders no chip. Zero points covers both "beyond 2 km" and "location not promotable", and the stored data can't tell them apart.
- A listing with no pin says so instead.

**Consequence to decide on:** a listing 5 km away (which could score about 64 + a phone lift into the review band) now shows no distance chip at all. The old "5,000 m apart" disagreement chip used to warn the reviewer. If that warning matters, persist a derived 0|1 `beyondLastTier` flag. It is integer-only, the same class as `listingLocation`.

### C-IN-02: A running run's badge puts a second accent badge on the preset page

**File:** `src/components/preset-detail/recent-runs.tsx:85`, `src/components/runs/run-status-badge.tsx:38`
**Issue:** `summary-card.tsx:24-29` deliberately avoids a status badge because `running` is `accent-outline` and "Current" is meant to be the only accent badge (accent item 7). Recent runs, on the same screen, renders `RunStatusBadge` with that accent for a running run. The accent rule is broken on exactly the screen the comment protects.

### C-IN-03: "Show {n} earlier checks" counts the current check too

**File:** `src/components/business-detail/google-check.tsx:379-380`
**Issue:** `count={google.history.length}` includes the latest observation, which row 1 already shows. With two observations the toggle reads "Show 2 earlier checks", but only one is earlier. Use `history.length - 1`, or reword to "Show all {n} checks".

### C-IN-04: Duplicate testids and duplicate duration formatters on `/spend`

**File:** `src/components/spend/by-run.tsx:69-76`, `:159`, `:215`
**Issue:**
- `RunStatusBadge` keeps its default `run-status-badge` testid in both the desk and phone trees on every row. Rule 40's "one element per testid" needs `:visible` to disambiguate, which `budget-banner.spec` does and other callers may not.
- `durationLabel` duplicates `runDurationLabel` but doesn't zero-pad: "17m 4s" on `/spend` versus "17m 04s" on the report. Reuse `runDurationLabel`.

### C-IN-05: Copy grammar and a false promise

**File:** `src/lib/ui/copy.ts:1047-1051`, `:1080`, `:1116-1118`, `:1136-1137`, `:1297`, `:1829-1831`
**Issue:**
- `counted(1, 'tile', 'tiles')` followed by "already searched are complete" produces "1 tile … are". The same happens with "0 coordinates are past 30 days".
- `RUN_ANNOUNCE_STOPPED` produces "Run stopped early — Stopped at the monthly cap".
- `RUN_FAILED` and `RUN_ABANDONED` promise "the tiles it reached are listed below", but nothing lists reached tiles, only counts.

### C-IN-06: The Recent runs empty body names actions that may not exist

**File:** `src/components/preset-detail/recent-runs.tsx:115`
**Issue:** In `ids_only`, the body says "Start one with Run full sweep", but that action is disabled in that mode. With no current version, no run action renders at all, yet the body still points at one. Choose the copy by `planRunActions(mode).primary`.

### C-IN-07: Review actions treat `validation` as retryable

**File:** `src/components/review/review-actions.tsx:85-89`, `src/components/review/reject-dialog.tsx:73-75`
**Issue:** A malformed id returns `fail('validation', NOT_FOUND('listing'))`. It is shown with "Try again" (and, in the reject dialog, replaced by `REJECT_FAILED` "That didn't record…"), and retrying repeats the same refusal. Treat `validation` like `not_found`.

### C-IN-08: Tests don't cover the failure paths behind CR-01 to CR-03

**File:** `tests/unit/run-drawer.test.tsx:132-201`, `tests/e2e/preset-detail.spec.ts:341-385`, `tests/unit/run-report.test.tsx:699`
**Issue:**
- The drawer suite has no `budget_refused`, `validation`, `unexpected` or rejected-promise case.
- The off-mode e2e doesn't assert the version-row run buttons.
- The zero-places test renders only `complete`.

Each gap lines up with a Critical above.

### C-IN-09: The budget-banner "live run" guard only sees runs created this month

**File:** `tests/e2e/budget-banner.spec.ts:80-99`
**Issue:** `aRunIsLive` reads `/spend` → By run, and `getSpendByRun` windows by `created_at` in the current period. A sweep created at 11:58 PM on the last day of the month and still running after midnight is invisible to the guard. The test would then lower the production cap under it. Either query live runs directly (a `run-status-badge` filter across periods) or also check the preset pages' recent runs.

---

_Reviewed: 2026-09-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
