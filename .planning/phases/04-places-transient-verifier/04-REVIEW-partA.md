---
phase: 04-places-transient-verifier
slice: A (database + server)
reviewed: 2026-09-24T12:34:23Z
depth: standard (+ cross-file data contracts for writers consumed elsewhere)
files_reviewed: 63
files_reviewed_list:
  - .github/workflows/ci.yml
  - drizzle/0026_places_tables.sql
  - drizzle/0027_places_grants_triggers.sql
  - drizzle/0028_places_meter_retention.sql
  - drizzle/0029_places_writers.sql
  - eslint.config.mjs
  - next.config.ts
  - package.json
  - pnpm-workspace.yaml
  - scripts/fetch-geo-shapes.ts
  - scripts/lib/anonymize-places.ts
  - scripts/lib/record-guard.ts
  - scripts/lib/record-pages.ts
  - scripts/purge-places.ts
  - scripts/record-places-fixtures.ts
  - src/app/api/cron/purge-places/route.ts
  - src/db/schema/index.ts
  - src/db/schema/place-attachments.ts
  - src/db/schema/place-coordinates.ts
  - src/db/schema/place-observations.ts
  - src/db/schema/place-purge-runs.ts
  - src/db/schema/place-tile-members.ts
  - src/db/schema/place-tiles.ts
  - src/db/schema/run-place-outcomes.ts
  - src/db/schema/run-searches.ts
  - src/db/schema/runs.ts
  - src/db/with-cron-role.ts
  - src/db/with-worker-org.ts
  - src/proxy.ts
  - src/server/actions/_listing-decisions.ts
  - src/server/actions/_result.ts
  - src/server/actions/detach-listing.ts
  - src/server/actions/queue-run.ts
  - src/server/actions/record-listing-decision.ts
  - src/server/queries/budget.ts
  - src/server/queries/businesses.ts
  - src/server/queries/preset-spec.ts
  - src/server/queries/presets.ts
  - src/server/queries/review-queue.ts
  - src/server/queries/run-report.ts
  - src/server/queries/sources.ts
  - tests/db/_fixtures.ts
  - tests/db/_places-fixtures.ts
  - tests/db/event-trigger.test.ts
  - tests/db/grants-audit.test.ts
  - tests/db/listing-actions.test.ts
  - tests/db/places-check-tile.test.ts
  - tests/db/places-definers.test.ts
  - tests/db/places-meter.test.ts
  - tests/db/places-recorder.test.ts
  - tests/db/places-run-report.test.ts
  - tests/db/places-schema.test.ts
  - tests/db/places-search-tile.test.ts
  - tests/db/places-writer.test.ts
  - tests/db/queue-run.test.ts
  - tests/db/review-actions.test.ts
  - tests/db/review-queue-google.test.ts
  - tests/db/sources-transient.test.ts
  - tests/db/versioned-presets.test.ts
  - vercel.json
  - vitest.config.ts
  - vitest.db.config.ts
  - vitest.workflow.config.ts
findings:
  critical: 0
  warning: 13
  info: 7
  total: 20
status: issues_found
---

# Phase 4 (slice A): Code Review Report

**Reviewed:** 2026-09-24T12:34:23Z
**Depth:** standard, plus cross-file contracts (the writers in 0028/0029 were traced into their consumers `src/lib/places/meter.ts`, `check-tile.ts`, `change-detect.ts`, `match.ts`, `search-tile.ts`, `src/workflows/places-sweep/steps.ts`, and the migrations they build on: 0007, 0018, 0019, 0020)
**Files Reviewed:** 63
**Status:** issues_found

## Summary

The tenancy walls hold up. Every definer in 0028 and 0029 reads the org from the claims. Each one re-reads every caller-supplied uuid under `org_id = v_org`, including the tie partner in `record_places_page`, and follows every `select … into` with an explicit `if not found`. The cross-org purge runs only under `siteless_cron`, and a test pins that role's catalog grants. `place_coordinates` holds no grant for `authenticated` or `anon`. The cron route fails closed when the secret is unset, checks the length before calling `timingSafeEqual`, and builds nothing eagerly. The admission hold is released, never settled, both in `beginRun` and in the `start()`-failure path. Page request ids are unique per attempt. No JS array reaches a drizzle template (`review-queue.ts` passes a CSV and splits it in SQL). Every `timestamptz` comes back as epoch-ms text.

The defects are in the data semantics of the writers:

- **Status flapping.** The attachment upsert lets any later, lower-scoring match downgrade an auto-attached listing, for example the same place found by another cluster's search.
- **False `gone`.** A saturated change check marks members `gone` that were only hidden past the 60-result cap.
- **Tie pairs.** A tie is never resolved as a pair, so both sides can end up attached to one place.
- **Merges.** A merge strands the loser's attached listings, so the survivor's signal ignores them.
- **Legal list.** The D-01 persistence list omits the `events` audit copies of `place_attachments`, and the features CHECK is looser than the legal line it is documented as backing.

Nothing here is a demonstrated security bypass or a likely data-loss event today. The work is gated behind `PLACES_MODE=off`, and a Places call has not yet been made. That is why no finding is rated Critical. Several WARNINGs corrupt stored, append-only or indefinite data once real runs start, so they should be fixed before the D-04 run (04-32), not after.

**Known items the orchestrator asked me to judge:**
- **`record_change_check` writes `pages_done = 1` for a multi-page check: confirmed, INFO.** No production code reads `run_searches.pages_done`. The report is ledger-based, and `changes-card.tsx` deliberately avoids page counts. The stored value is still false (IN-01).
- **`readRunReport` accuracy for change-check runs: requests and cost are correct.** Both are read from the ledger per SKU, and every Essentials page is ledgered at $0, units 1. Two labels are wrong for a change check (IN-02).
- **`settle_reservation` (0019) does not lock the row: WR-08.** Phase 4 adds a caller, `settleInFlight`, that settles reservations exactly when they are near or past their 10-minute TTL. That is the window in which the page-view self-heal (`release_expired_reservations`) can race it.

## Warnings

### A-WR-01: The attachment upsert downgrades an auto-attached listing on any later, lower-scoring match

**File:** `drizzle/0029_places_writers.sql:229-239`

**Issue:** The `on conflict … do update` protects only `rejected` rows and `confirmed` rows. An auto-attached row (`status='attached', reason='score'`) is overwritten by whichever match is written last.

The scorer's `cluster` feature (`src/lib/resolve/score.ts:334-336`) compares the business's cluster with the SEARCH's cluster, which is `PlaceForMatch.clusterKey = ctx.clusterKey` in `match.ts:127`. So the same (business, place) pair scores differently depending on which cluster's type search found it. Suppose a place carries types from two clusters, or two presets with different clusters both sweep it:
1. Search 1 (same cluster) writes `attached`/96.
2. Search 2 (other cluster) writes `tentative`/91 over it.

The status now depends on step order. Each flip writes an `events` row through `place_attachments_event_upd`, puts the listing back in `/review`, and removes it from `business_place_signal`, which reads `attached` only. Suppose the downgraded listing was the one with a website, and the business has a second attached listing without one: the signal flips to `false`. That is a false "no website" lead, the exact failure D-08 says the "any listing" rule leans against.

**Fix:** Never downgrade in the upsert. Keep the best status/score seen, and let only a human move an `attached` row down:
```sql
on conflict (org_id, business_id, place_id) do update
   set status = case when place_attachments.status = 'attached' then 'attached' else excluded.status end,
       reason = case when place_attachments.status = 'attached' then place_attachments.reason else excluded.reason end,
       score  = greatest(place_attachments.score, excluded.score),
       features = case when excluded.score >= place_attachments.score then excluded.features else place_attachments.features end,
       tie_business_id = excluded.tie_business_id,
       last_seen_run_id = excluded.last_seen_run_id
 where place_attachments.status <> 'rejected' and place_attachments.reason <> 'confirmed'
```
Also add a DB test: the same place seen by two cluster searches in one run ends `attached`, whatever the order.

### A-WR-02: A saturated change check marks every member beyond the 60-result cap as `gone`

**File:** `drizzle/0029_places_writers.sql:361-363` (consumer contract: `src/lib/places/change-detect.ts:38-47`, `src/lib/places/check-tile.ts:162-166`)

**Issue:** `diffTile` computes `gone = stored − seen` even when `verdict = 'saturated'`. On a saturated check, `seen` is capped at 60 by Text Search, so a stored member that was merely beyond the cap counts as gone. `record_change_check` applies `p_gone` whatever the verdict, and writes `gone_at = now()` onto members that still exist.

The next check then re-sees some of them as `added`, reports verdict `new`, and inflates `new_ids`/`gone_ids` on the run report. The membership history, which the header calls "what the next diff reads", becomes wrong. Saturation is the normal state of exactly the dense tiles this feature exists for.

**Fix:** In the writer, refuse or ignore gone ids on a saturated listing, and fix `diffTile` to return `gone: []` when saturated:
```sql
if p_verdict = 'saturated' and jsonb_array_length(p_gone) > 0 then
  raise exception 'record_change_check: a saturated listing cannot prove a member gone' using errcode = '22023';
end if;
```

### A-WR-03: Tie pairs are never resolved as a pair, so both businesses can end up attached to one place

**File:** `drizzle/0029_places_writers.sql:392-437` (decide), `:193-200` and `:229-239` (record)

**Issue:** This has three parts:
1. `decide_place_attachment('confirm')` on one side of a tie (`reason='tie'`) moves only that row. The partner row stays `tentative`/`tie`, and it stays in `/review`, where `readTopListing` still renders "ties with <the business just confirmed>". A second reviewer can confirm it, and the same `place_id` is then attached to two businesses. `business_place_signal` then attributes that listing's website to both. D-08 requires a tie to be decided, not duplicated.
2. When a later run matches the place to only one of the pair, the upsert rewrites that row to `score`/no tie. The partner keeps pointing at it as a tie forever.
3. The writer validates `status` and `reason` independently, so `(attached, tie)` is accepted. D-08 says a tie is always tentative, and the database is the stated wall behind the application.

**Fix:** In the `confirm` branch, when the row is a tie, reject the partner in the same statement. Re-check the partner's org on that row, as the header's discipline requires:
```sql
update place_attachments p
   set status = 'rejected', reason = 'rejected', decided_by = v_actor, decided_at = now()
 where p.org_id = v_org and p.place_id = <confirmed place_id>
   and p.business_id = <confirmed tie_business_id> and p.status = 'tentative';
```
In `record_places_page`, add `if v_reason = 'tie' and v_status <> 'tentative' then raise … '22023'`.

### A-WR-04: A merge strands the loser's attached listings, and the survivor's signal ignores them

**File:** `drizzle/0027_places_grants_triggers.sql:139-154`, `src/server/queries/businesses.ts:766-774, 803-814`

**Issue:** `business_place_signal` and `readGoogleCheck` key on the raw `business_id`. `record_places_page` refuses to attach to an already-merged business. Nothing, however, moves or reads through the attachments of a business that is merged AFTER its listing attached. No merge function touches `place_attachments`: grep `drizzle/0024`/`0025`, the merge definers.

After a Phase 3 merge (auto or review), the survivor's Google check and signal omit the loser's attached listing. If that listing had a website, the survivor reads "no website" or "no listing". Phase 6 reads this view as the verdict input, so this is the false-positive direction. 04-21 handled the tentative half by hiding merged businesses from the queue. The attached half has no handling.

**Fix:** Make the signal resolve live roots. Group by `coalesce(b.merged_into_id, b.id)` with a join to `businesses`, and do the same in `readGoogleCheck` (`a.business_id in (select id from businesses where id = $1 or merged_into_id = $1)`). The alternative is to re-point attachments inside `app.record_merge` and restore them on unmerge.

### A-WR-05: The `events` audit table persists `place_id`, score and features indefinitely, and the D-01 enumeration does not list it

**File:** `drizzle/0027_places_grants_triggers.sql:97-99`; `docs/legal/places-persistence.md:320`

**Issue:** `place_attachments_event_upd` runs `app.log_event`, which writes `to_jsonb(old)` and `to_jsonb(new)` of the whole row (0007:29-30) into `events`. That row includes `place_id`, `score`, `features` and `tie_business_id`. `events` is immutable by grant (0007/0011), so these copies can never be purged.

The legal "Summary of Google values at rest" lists `place_id` in four tables and not in `events`. The D-01 checkpoint (04-29) is meant to cover "the real list", and CONTEXT D-01 requires exactly that. The list does not match the code. The same `place_id` also lands in `events` on every status flip, and WR-01 multiplies those flips.

**Fix:** Either add `events` (before/after of `place_attachments`) to §1.9 and §1 of `places-persistence.md` before 04-29 is signed, or narrow the trigger's payload for this table to the status/reason/decided columns. Since `app.log_event` is generic, that means a dedicated trigger function that emits via `app.emit_event` with an allow-listed payload.

### A-WR-06: `places_features_ok` still admits `nameSim` and `distanceM`, looser than the legal line it is documented as backing

**File:** `drizzle/0029_places_writers.sql:43-46`; `docs/legal/places-persistence.md:84, 120-121`; `src/db/schema/place-attachments.ts:17-20`

**Issue:** Since 2026-09-23 the legal line is 11 keys, and the continuous `nameSim` and `distanceM` are memory-only (`page-record.ts:32-47`). The CHECK still accepts both as numbers. The legal doc, line 84, calls the CHECK "the wall behind it". It then concedes at line 120 that the CHECK is not that wall. The schema comment calls the 11-key set "the legal line (D-13)".

On an indefinite column, the only enforcement of the legal line is now TypeScript in `toPageRecord`. A regression there would persist continuous values derived from Google's name and coordinates, and the database would say nothing.

**Fix:** Add a migration that drops `nameSim` and `distanceM` from the allow-list, so that `else false` rejects them. The table was empty at deploy, so there is no backfill risk. Also add a named mutation test (`features carrying nameSim is 23514`).

### A-WR-07: `record_places_page` accepts `sku = 'ts_essentials'` on an Enterprise search, the one combination that writes false "no website" observations

**File:** `drizzle/0029_places_writers.sql:139-142`

**Issue:** The function refuses non-enterprise searches (line 124). It then accepts an Essentials SKU anyway. An Essentials (IDs-only) page carries no `websiteUri`, so every observation written from one would be `had_website_uri=false, host_class='none'`. That is a false "no website" for every place on the page, and it lands in append-only rows the trigger forbids deleting (D-10).

Today `search-tile.ts:316` hard-codes the enterprise mask, so this is a wall that should exist and does not.

**Fix:** `if v_sku is distinct from 'ts_enterprise' then raise exception 'record_places_page: an enterprise search records ts_enterprise pages only' using errcode = '22023'; end if;`

### A-WR-08: `settle_reservation` reads the hold without a lock, and Phase 4 now settles reservations at their TTL edge

**File:** `drizzle/0019_aromatic_bromley.sql:60-65, 89, 109-116`; caller `src/lib/places/meter.ts:272-311` (`settleInFlight`)

**Issue:** `settle_reservation` reads `settled_at`/`released_at` without `for update` and computes `v_hold` from that snapshot. `release_expired_reservations` (0018) runs on every page view through `readCurrentPeriod → ensure_budget_period`. It locks the row (`for update skip locked`), releases it, and decrements `reserved_micro_usd` by `est`.

If the release commits between the settle's SELECT and its UPDATE, the settle decrements `reserved` by `est` a second time. There are two outcomes:
- **Other holds exist:** `reserved` is understated and the meter over-admits by one page price.
- **No other holds exist:** `bp_non_negative` raises. The `exception when check_violation` block swallows it and rolls back the whole balance update, so `spent_micro_usd` also misses a real charge. Only a `budget_overrun` event remains.

Phase 4 makes this reachable. `settleInFlight` settles a crashed attempt's reservation on replay, and replay after a crash plus backoff is exactly when the 10-minute TTL is expiring. The page reservations use the `reserve_budget` default TTL (`meter.ts:150-153` passes none).

**Fix:** Lock at the read in a new migration: `… from cost_reservations r join budget_periods b on … where r.id = p_reservation for update of r;`. Also consider passing a longer `p_ttl` for page holds, so a single step's lifetime can never cross the TTL.

### A-WR-09: The stale-run reclaim leaves abandoned runs with `cost_micro_usd` unset and in-flight charges unledgered

**File:** `src/server/actions/queue-run.ts:145-150`; consumer `src/app/(app)/presets/[id]/page.tsx:221`

**Issue:** The `abandoned` reclaim sets only status, reason and `finished_at`. `closeRun` in `steps.ts:140-152` is the only writer of `runs.cost_micro_usd` (it sums the ledger), and it matches only `status='running'`. A run reclaimed as abandoned therefore keeps `cost_micro_usd = 0` forever. The preset page's recent-runs list reads that column and shows "$0.00" for a run that spent money, while `/runs/[id]` (ledger-based) shows the real figure.

The reclaim also leaves any `run_searches.inflight_*` cursor set. If the workflow never resumes, the hold simply expires and is released with no ledger row: a request that may have been billed is never recorded.

**Fix:** Stamp the cost in the same UPDATE:
```sql
update runs r set status = 'failed', stopped_reason = 'abandoned', finished_at = now(),
       cost_micro_usd = (select coalesce(sum(l.micro_usd),0) from cost_ledger l where l.run_id = r.id)
 where …
```
Also document, or handle, the unsettled in-flight cursor: for example, settle as charged any cursor of a reclaimed run whose reservation is still open.

### A-WR-10: `mark_run_search` never retires descendant tiles, so change checks run over overlapping stale leaves

**File:** `drizzle/0028_places_meter_retention.sql:240-249`; consumer `src/workflows/places-sweep/steps.ts:181-189`

**Issue:** When a search finishes, only ITS tile's `is_leaf` is set (`= not subdivided`). Suppose a root that previously subdivided (children r0 to r3 stored with `is_leaf = true`) is re-swept by a later full sweep and no longer saturates. The root becomes `is_leaf = true`, and the old children stay `is_leaf = true`. `storedLeaves` selects every `is_leaf` tile under the root prefix, so a change check then lists the root and all four children: overlapping rectangles.

Each child is diffed against members recorded by an older sweep. Every overlap is another request against the 100/day GCP quota and the run ceiling, and the children's stale member sets produce spurious `new`/`gone` verdicts.

**Fix:** When a search completes with `subdivided = false`, mark every descendant non-leaf in the same UPDATE:
```sql
update place_tiles d set is_leaf = false
 where d.org_id = v_org and d.id <> v_tile
   and starts_with(d.tile_key, <this tile's key>) ;
```
Alternatively, have `storedLeaves` take the shallowest `is_leaf` tile on each path.

### A-WR-11: The `plan_run_searches` tile upsert never refreshes geometry, so change checks use outdated rectangles

**File:** `drizzle/0028_places_meter_retention.sql:141-148`

**Issue:** `on conflict … do update set updated_at = now()` keeps the FIRST rect ever written for a `tile_key`. The `tile_key` encodes unit, type and quad path, not the bbox. Suppose `scripts/fetch-geo-shapes.ts` is re-run: the documented path when TIGERweb or the city list changes. New sweeps then search the new rectangle. Change checks, however, read the rectangle from `place_tiles` (`steps.ts:182-205`) and search the old one. Every change check then diffs a different area than the one the members were recorded from, and reports false `new`/`gone` churn.

**Fix:** `do update set updated_at = now(), south = excluded.south, west = excluded.west, north = excluded.north, east = excluded.east, depth = excluded.depth, quad_path = excluded.quad_path`. Alternatively, refuse with 22023 when the rect disagrees, so the operator re-baselines on purpose.

### A-WR-12: The recorder's crash path clears the in-flight cursor without settling the attempt

**File:** `scripts/lib/record-pages.ts:277-286`; `scripts/record-places-fixtures.ts:175-179`

**Issue:** If `recordPages` throws after `reservePage` but before `settleOrRelease`, the `finally` calls `closeRecordingRun(…, 'crashed')`. That writes `inflight_reservation_id: null, inflight_request_id: null` straight through `mark_run_search`. Two ways this happens: a DB error inside `settleOrRelease` itself, or an exception in `anonymizePage` after a settled page. Clearing the cursor destroys the only record that a request may have left, without the settle-as-charged the product does first (`settleInFlight`, `meter.ts:272`). The hold then expires and is released with no ledger row, for a request that is billed per real call.

**Fix:** In `closeRecordingRun`, call `settleInFlight({ clerkOrgId, runId }, searchId)` before marking the search `stopped`, or keep `inflight_*` out of the payload. The recorder already imports the meter module.

### A-WR-13: The purge test asserts over every org in the shared database, so it will fail in any database holding committed expired coordinates

**File:** `tests/db/places-definers.test.ts:512-515`

**Issue:** The test asserts `purged_rows === 0` for every org other than the two it seeded. The purge is cross-org and the lane shares one database. Any committed coordinate older than 30 days in any org makes it fail, 30 days after that data was written. The test then fails on a date, not on a code change. Two sources of such data:
- a local D-04 or dev run against the same DB, where the spine is local;
- an interrupted workflow-lane test that skipped `teardownOrg`.

**Fix:** Assert only on `a` and `b`, plus the row count (`r.rows.length === orgCount`), and drop the loop at 513-515. Or first delete, inside the rolled-back transaction, every pre-existing expired coordinate as the owner.

## Info

### A-IN-01: `record_change_check` writes `pages_done = 1` for a multi-page check (the known item, judged INFO)

**File:** `drizzle/0029_places_writers.sql:376`

**Issue:** `pages_done = greatest(s.pages_done, 1)`, while `check-tile.ts:83-138` may list up to 3 pages. No production code reads `pages_done` (grep: only tests), the run report is ledger-based, and `changes-card.tsx:20-22` deliberately avoids page counts. The stored value is still false in an indefinite table.

**Fix:** Pass the page count (`p_pages int`) from `runCheckTile` and write it, or drop the write and document that `pages_done` is Enterprise-only.

### A-IN-02: `readRunReport` mislabels two change-check figures

**File:** `src/server/queries/run-report.ts:280, 313-323`

**Issue:** Requests and cost are correct, since they come from the ledger. Two labels are wrong:
1. `freeThisMonth` counts every Essentials request as "free this month", but Essentials is free with no monthly allowance.
2. `stillSubdividing` lists a stopped change check's `planned`/`searching` searches, and the UI renders them under "Tiles still subdividing when the run stopped". A change check never subdivides. Combined with `queue-run.ts:225-227` (estimate $0 for a change check, while the ceiling comes from Enterprise `requestsHi`), an `exceeded_estimate` change check reads "exceeded the $0.00–$0.00 estimate".

**Fix:** For `kind = 'change_check'`, return `stillSubdividing: []` plus a separate `stillUnchecked` list, and let the UI (slice C) word the stop alert by kind.

### A-IN-03: Four 0028 definers keep `service_role` EXECUTE, contrary to the migration's own header

**File:** `drizzle/0028_places_meter_retention.sql:22-24, 81, 163, 253, 341`

**Issue:** The header says "every role is named (0024 L129–139)". Only the purge revokes `service_role`. `release_reservation`, `plan_run_searches`, `mark_run_search` and `places_transient_stats` revoke `from public, anon` only, so the 0000 default grant to `service_role` stands. The impact is low, because `service_role` bypasses RLS anyway. The inconsistency is still a trap for the next copy-paste.

**Fix:** Add `service_role` to those four revokes in a follow-up migration, and extend the 0029 catalog test (`places-writer.test.ts:957`) to cover them.

### A-IN-04: Change checks do not advance `last_seen_at` for unchanged members, despite the table comment

**File:** `drizzle/0029_places_writers.sql:357-363`; `drizzle/0027_places_grants_triggers.sql:180`

**Issue:** The 0027 comment says members are "touched by every change check (last_seen_at)". Only added or revived ids get `last_seen_at = now()`, and members seen again and unchanged are not touched. Nothing reads the column yet. Any future "stale member" logic built on it would be wrong.

**Fix:** Pass the full seen set, or update `last_seen_at` for `stored ∩ seen`. Otherwise correct the comment.

### A-IN-05: The writers accept pages for terminal runs, and a fixture comment claims otherwise

**File:** `drizzle/0028_places_meter_retention.sql:197-203`, `drizzle/0029_places_writers.sql:115-121, 328-334`; `tests/db/_places-fixtures.ts:74`

**Issue:** `mark_run_search`, `record_places_page` and `record_change_check` never check `runs.status`. Only `plan_run_searches` requires an active run. That is defensible, since a paid page should still be recorded after a kill. The fixture doc says `'running'` is "the state every Phase 4 definer requires", which is false and will mislead the next test author.

**Fix:** Correct the comment, or make the definers' intent explicit in their headers.

### A-IN-06: The recorder's real, billed calls are ledgered only in the local database

**File:** `scripts/record-places-fixtures.ts:130-132`; `scripts/lib/record-guard.ts:169-193`

**Issue:** This is deliberate (D-04: never write to production). The consequence is that the production meter's free-1,000 counter and `/spend` never see the recording's requests, up to 10 per invocation plus 04-31's verification call. The GCP daily quota still counts them.

**Fix:** Note it in the 04-32 runbook, so the first invoice is reconciled against local ledger rows plus production ledger rows.

### A-IN-07: `results_count` is overwritten while `pages_done` uses `greatest`

**File:** `drizzle/0029_places_writers.sql:299-300`

**Issue:** A replayed earlier page would lower `results_count` while `pages_done` stays at the maximum. Replays are sequential today, so this is theoretical.

**Fix:** `results_count = greatest(s.results_count, v_results)`.

---

_Reviewed: 2026-09-24T12:34:23Z_
_Reviewer: Claude (gsd-code-reviewer), slice A_
_Depth: standard + cross-file contracts_
