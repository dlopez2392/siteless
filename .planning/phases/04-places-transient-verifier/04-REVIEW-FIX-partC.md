---
phase: 04-places-transient-verifier
slice: C (UI)
fixed_at: 2026-09-24T00:00:00Z
review_path: .planning/phases/04-places-transient-verifier/04-REVIEW-partC.md
iteration: 1
base: ee4bfba
findings_in_scope: 17
fixed: 15
partial: 2
skipped: 0
needs_decision: 3
status: partial
---

# Phase 4: Code Review Fix Report, Slice C (UI)

**Source review:** `04-REVIEW-partC.md` (C-CR-01..04, C-WR-01..13)
**Iteration:** 1. Branch `worktree-agent-a334e3808e9122ff1`, based on `ee4bfba`. Nothing pushed.
Nothing touched production, and no e2e ran against any target.

**Summary**
- 17 findings in scope. 15 are fixed. 2 are partial (C-WR-03 and C-WR-10); for each, the part inside this slice is done and the rest is recorded below.
- 3 relayed follow-ups from slice A's migration 0030 are also done.
- Every fix was watched failing first. Either a new test went red by name before the fix, or a mutation went red by name and was then reverted.

## Per finding

| ID | Result | Commit | What changed |
|---|---|---|---|
| C-CR-01 | fixed | `be8aa3f` | The run drawer now catches a rejected `queueRun`. It shows a blocking warning, `RUN_START_UNKNOWN`, that makes no "nothing was charged" claim. The confirm button is replaced, so a second click can't start a second run. Two ways out: "Check recent runs" (closes the drawer, refreshes, jumps to `#preset-recent-runs`, a new id on the Recent runs card) and "Open spend view". It is still an `onClick` inside `useTransition`, with no form. Test: "a run request that never reaches the server keeps the drawer open". |
| C-CR-02 | fixed | `dcd0761` | `HistoryContext` now carries `placesMode` (the page reads `env.PLACES_MODE` on the server and passes the string) and `noticeId`. In `off` and `ids_only`, every "Run version N" button (desk row and phone card) renders without `RunDrawer`: `aria-disabled`, focusable, `aria-describedby` pointing at the notice, and opening nothing. Unit tests cover off, ids_only and enterprise. The off-mode e2e now asserts that every visible `version-row-*-run` / `version-card-*-run` is inert (written, typechecked and listed only). |
| C-CR-03 | fixed | `a5f90da` | "Every tile was searched" now shows only for a `complete` run. Failed and stopped runs with zero places show `run-outcomes-none-reached` ("…the alert at the top of this report says why"). The test covers 7 terminal status/reason pairs, including `places_key_missing`. |
| C-CR-04 | fixed | `61eb9a4` | `readRunReport` now reads the Places period of the run's own month: the `created_at` month in APP_TZ, which is the period `queueRun` reserved against. It returns `capPeriodStart` and `capPeriodIsCurrent`. Once that month is over, the cap-stop and refused alerts switch to past-tense copy (`RUN_STOP_CAP_PAST`, `RUN_REFUSED_PAST`): that month's cap, "has since reset", and "Open preset" as the way out. The DB test pins 2026-10-01T04:30Z, which is September in Chicago and October in UTC; the test lane runs in UTC, and the test asserts that. The 05:30Z instant is the other half of the pair. A UTC-month mutation went red by name. |
| C-WR-01 | fixed | `d088918` | The chips now read the stored integer address points (`ADDRESS_FULL` / `ADDRESS_NUM_POSTAL` / `ADDRESS_POSTAL_ONLY` from `score.ts`). The agreement chip keyed `zip` reads "same address", "same street number and ZIP" or "same ZIP". No new persisted value and no Google text. The >2 km flag is a decision for you (see below). |
| C-WR-02 | fixed | `7d85b46` | The truncation warning and the exceeded-estimate stop alert are now `[data-places-content]` containers with one `GoogleMapsTag` each. The review header's score line is a new `ReviewScore`: on a Google item it is its own tagged container; on a duplicate pair it has no tag. All three are registered in `PLACES_SIGNAL_SURFACES`. The duplicate-pair score and the cap stop alert are in `NOT_PLACES_SURFACES`. |
| C-WR-03 | **partial** | `9af3296` | Removed the dead `try/catch` around `router.refresh()` (it returns void and never throws, so no mutation could reach the catch). The header now states that a refresh whose server render throws replaces the segment with `runs/[id]/error.tsx`. Keeping the last good numbers needs a structural change; see cross-slice follow-ups. |
| C-WR-04 | fixed | `80500fb` | `readRunReport` resolves each listed tile to `unitName` (city from the key, county from `counties`, "N-mile radius in X County", or "Unnamed area" as the fallback), `typeLabel` ("roofing contractor") and `quadPath`. Rows and the copy payload read "McAllen · roofing contractor · tile r012". The raw key appears only as `data-tile-key`. There is a DB test for county naming; the county-lookup and raw-key mutations both went red. |
| C-WR-05 | fixed | `6f58606` | `RUN_DRAWER_CHECK_NOTE` now tells the truth: there is a one-millionth-of-a-dollar placeholder, and a spent cap refuses the check. A refused check shows `RUN_REFUSED_CHECK_NOTE`. The alternative, exempting zero-cost holds in SQL, is left to slice A (see follow-ups). |
| C-WR-06 | fixed | `fc17284` | `runKindLabelOf(kind, atMs)`: a past partition run reads "Weekly partition · week 36" (the ISO week in APP_TZ). It is used by the run header, the preset's recent runs and /spend By-run. `RUN_KIND_LABEL` is unchanged, so the action row and `ui-maps.test.ts`'s verbatim check still say "This week's partition". |
| C-WR-07 | fixed | `d76ecd5` | `validation` and `not_found` now land in a blocking `invalid` outcome with an "Edit preset" link (a new `editHref` prop, passed from the page through RunActions and the version rows). "Try again" is kept for `unexpected` only. |
| C-WR-08 | fixed | `62ca1f5` | A refused clipboard write now shows `toast.error`: `COPY_FAILED(command)` by default, or `RUN_TRUNCATION_COPY_FAILED` for the collapsed tile list. The purge alert prints `PURGE_PLACES_COMMAND` in a `<code>`. A silent-catch mutation went red on both tests. |
| C-WR-09 | fixed | `1072381` | `SECOND_WALL_DERIVATION`, `_LIMIT` and `_SET_BODY` are now functions of `SecondWallInputs`. The card passes `GOOGLE_QUOTA_REQUESTS_PER_DAY` and the `ts_enterprise` price and free allowance from `PRICE_BOOK`. "more than / less than the cap" is computed. A test moves the quota to 150 and checks that the card and the stopped-run alert both say 150. A literal-quota mutation went red. |
| C-WR-10 | **partial** | `757787e` | The alert's sentence now matches its cause (`data-cause`). `stale` means the last purge is more than 36 h old. `awaiting` means the purge ran on time and rows expired afterwards; it now reads "…passed 30 days since the daily purge last ran… the next daily purge removes them". `never` is unchanged. The "0 coordinates are past 30 days" clause is dropped at zero. The rule itself still fires on any expired row; changing it needs slices A and B (see follow-ups). |
| C-WR-11 | fixed | `427f351` | `spend.spec.ts`: `openByRun()` waits for exactly one visible By-run container before counting. The skip now comes from the painted empty state, and a painted run list with zero links fails. Written, typechecked and listed only. |
| C-WR-12 | fixed | `39c120a` | The truncation warning is now `role="note"`, not `status`. The test pins the role and the absence of `aria-live`. |
| C-WR-13 | fixed | `1814900` | History rows for a **rejected** listing no longer show the website sentence. The "not this business" mark, the run link and the tag stay. |

### Relayed follow-ups from slice A's 0030 (orchestrator message)

| # | Result | Commit | What changed |
|---|---|---|---|
| 1 | fixed | `3603354` | `readGoogleCheck` listings and history now read the merged family: `b.id = $1 or b.merged_into_id = $1`. That matches 0030's `business_place_signal`, which uses `coalesce(merged_into_id, id)`, as read from the shared DB with a read-only `pg_get_viewdef`. The DB test is in `tests/db/places-run-report.test.ts`, the only DB file this slice owns. It shows garza's own listing before the merge and both listings, both observations and the matching signal after ortiz merges into garza. `listing-actions.test.ts` is still green. |
| 2 | fixed | `bd831e5` | The tie reason now says, before the tap: "Confirming it for this business also records it as not "X", for good." ("Same business" is still unconfirmed, per Rule 23.) After a tie confirm, the success toast is `TOAST_ATTACHED_TIE`. The page passes `tieOtherName` to the Google bar. The remaining count is re-read from the server, so it is already true. |
| 3 | fixed (UI) / follow-up (action) | `4d2a235` | 55000 on a tie confirm maps (in `_listing-decisions.ts`) to `conflict` / `already_decided`. The bar shows `REVIEW_GOOGLE_ALREADY_DECIDED` with only "Reload the queue": no toast, no advance, no retry. This is pinned by a test, and a "conflict is retryable" mutation went red. A more specific sentence would need a new mapping in slice A's file (see follow-ups). |

## Gates (worktree HEAD, after the last fix commit)

- `npx tsc --noEmit`: exit 0
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0
- Unit lane, `npx vitest run tests/unit`: **83 files, 646 tests passed**
- DB, `tests/db/places-run-report.test.ts` + `tests/db/listing-actions.test.ts`: **2 files, 23 tests passed** (the shared local DB is at 0030)
- e2e: `playwright test --list` for `preset-detail.spec.ts` and `spend.spec.ts` only. Nothing was run.
- `npx next build`: exit 0, run once at the end. The log shows "workflows build complete (8 steps, 1 workflow)", and all 21 routes compiled.

## Needs decision (danlo)

1. **The >2 km distance warning (C-WR-01 / C-IN-01).** A listing 5 km away shows no distance chip, because zero points covers both "beyond 2 km" and "location not promotable". If that warning matters, the matcher would need to persist a derived 0|1 `beyondLastTier` flag. That is new stored data, so it is your call and was not implemented.
2. **C-WR-05's other option.** Exempt zero-cost `ts_essentials` holds from the cap comparison in `app.reserve_budget`, so a free check is never refused at the cap. That is slice A's SQL. The copy fix stands either way.
3. **C-WR-03's structural fix.** Choose between:
   - (a) a client boundary around a child server component that does the read and keeps the last good children; or
   - (b) a route-handler probe before each `router.refresh()`, which doubles the reads per tick (T-4-02).

   Both change the page's structure (`notFound()`, metadata), so it is left for a decision rather than guessed.

## Copy for danlo's review (all in `src/lib/ui/copy.ts`)

- `RUN_START_UNKNOWN`: "We couldn't confirm whether the run started — the request didn't come back. Check Recent runs on this page before trying again: if the run was created, it is listed there."
- `RUN_START_UNKNOWN_ACTION`: "Check recent runs" / "Open spend view"
- `RUN_INVALID_ACTION`: "Edit preset"
- `RUN_OUTCOMES_NONE_REACHED_HEADING`: "No Google places came back from this run"
- `RUN_OUTCOMES_NONE_REACHED_BODY`: "This run ended before every tile was searched, and no listing came back before it stopped — the alert at the top of this report says why. It doesn't mean the Places types are wrong."
- `RUN_STOP_CAP_PAST(cap, cost, searched, notSearched, month)`: "Stopped at the {cap} monthly cap for {month} after {cost}. … {month}'s budget has since reset, so the {n} not searched can run now — start the run again from its preset."
- `RUN_REFUSED_PAST(cap, month)`: "This run was refused. The {cap} cap for {month} was spent, so Siteless didn't call anything and nothing was charged. That month's budget has since reset."
- `PLACES_CHIP.sameAddress` "same address"; `PLACES_CHIP.sameNumberZip` "same street number and ZIP"
- `RUN_TILE_UNIT_COUNTY` "{name} County"; `RUN_TILE_UNIT_RADIUS` "{n}-mile radius in {county} County"; `RUN_TILE_UNIT_UNKNOWN` "Unnamed area"
- `RUN_DRAWER_CHECK_NOTE` (reworded): "Siteless holds a placeholder of one millionth of a dollar so the check goes through the budget meter like every run — if the monthly cap is already spent, the check is refused too. Each request is still written to the ledger."
- `RUN_REFUSED_CHECK_NOTE`: "Change checks cost nothing, but each one holds a one-millionth-of-a-dollar placeholder on the meter, so a spent cap refuses them too."
- `RUN_KIND_PARTITION_PAST` "Weekly partition"; `RUN_KIND_PARTITION_WEEK(n)` "Weekly partition · week {n}"
- `COPY_FAILED(command)`: "Couldn't copy — run: {command}"; `RUN_TRUNCATION_COPY_FAILED`: "Couldn't copy the tile list — open "Show the truncated tiles" to read it."
- Second-wall copy is now derived. At the shipped values it reads as before, except the honesty line says "$70.00/month" (was "$70/month") and "more than" is computed.
- `SOURCES_TRANSIENT_PURGE_AWAITING(date, hours, count)`: "{n} coordinates have passed 30 days since the daily purge last ran ({date}, {h} hours ago). The database already refuses to read them, and the next daily purge removes them from disk. If this is still here tomorrow, check the Vercel cron log for the purge job, or run it by hand at the desk." The OVERDUE and NEVER_RAN sentences now drop their "{n} past 30 days" clause at zero.
- `REVIEW_GOOGLE_REASON_TIE`, new last sentence: "Confirming it for this business also records it as not "{other}", for good."
- `TOAST_ATTACHED_TIE(name, other)`: "Attached to "{name}" — recorded as not "{other}""

## Cross-slice follow-ups (not made here; exact change)

1. **C-WR-10 rule (slices A + B + C).**
   - A: make `app.places_transient_stats()` also return `oldest_expired_ms`, the epoch-ms text of `min(expires_at)` over rows with `expires_at <= now()`, or null.
   - B: add `oldestExpiredMs: number | null` to `TransientStats` (`src/lib/places/purge-status.ts`). Change `purgeOverdue`'s first clause from `s.expiredAwaitingPurge > 0` to `s.oldestExpiredMs !== null && nowMs - s.oldestExpiredMs > OVERDUE_MS`. Update the "purge overdue when expired rows await purge" case in `tests/unit/transient-card.test.tsx` (slice C will take that test edit).
   - C (me, after A and B land): map `oldest_expired_ms` in `readTransientStats` (`src/server/queries/sources.ts`).
2. **C-WR-05 alternative (slice A).** In `app.reserve_budget`, exempt `ts_essentials` holds of 1 µUSD from the cap comparison. This needs a decision first; see above.
3. **C-WR-03 structural fix (slice C, after the decision above).** Either wrap the report body in a client error boundary that keeps the last good children, or add a probe route handler under `src/app/(app)/runs/[id]/`.
4. **0030 item 3 (slice A, `src/server/actions/_listing-decisions.ts`).** Optional precision. When `decide_place_attachment` refuses 55000 because the OTHER tie side is already confirmed, return `fail('conflict', REVIEW_GOOGLE_TIE_TAKEN(otherName), { reason: 'tie_confirmed_elsewhere' })` instead of the generic `already_decided`. The UI already treats any non-`concurrent_merge` conflict as reload-only, so no UI change is needed. The copy would be something like "This listing was already confirmed for "{other}", so it can't also be this business's. Reload the queue." Slice C would add it to `copy.ts` on request.
5. **Fixture note (slice B, `tests/unit/fixtures/google-check.ts`).** C-WR-13's test builds its rejected-observation history inline rather than editing the shared fixture. Adding a rejected-listing observation to `MIXED.history` would make that case part of the shared fixture.

## Noise / notes

- Slice A migrated the shared local DB to 0030 while this slice ran. `tests/db/places-run-report.test.ts` and `tests/db/listing-actions.test.ts` are green against it. `record_places_page` now accepts Enterprise pages only; this file's `writePage` already sends `ts_enterprise`.
- `prettier --check` reports most `src/` files, including ones this slice never touched (`changes-card.tsx`, `requests-card.tsx`), which points to CRLF working-copy line endings (`core.autocrlf`) rather than formatting. It is not a gate here. The committed blobs are LF.

---

_Fixed: 2026-09-24_
_Fixer: Claude (gsd-code-fixer), slice C_
_Iteration: 1_
