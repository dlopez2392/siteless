# Phase 4 gate mutations M26–M53, as run

Plan 04-33 Task 1, 2026-09-25. Branch `gsd/phase-04-places-transient-verifier`, HEAD `e6acd7b`
throughout (printed after every lane run). The main tree was used, not a worktree. Nothing
touched production. No Google request was made: every Places request in every lane went to
msw.

**Method.** Mutations ran one at a time, never two together. Each source mutation was applied
to the committed file by an exact-one-match replacer. It refuses when the anchor matches 0 or
2+ times, and it normalizes the anchor to the file's line endings. The replacer saved a byte
copy of the original first. The revert copied that byte copy back, and then
`git diff --stat` printed nothing.

DB mutations were applied to the **live local database** (`siteless_test`, which holds danlo's
91,872-row RGV spine and the D-04 run `6a30dc3b…`), never to a migration file:

- **Functions and the view:** each mutation was `create or replace`, built from a
  **`pg_get_functiondef` / `pg_get_viewdef` saved before any mutation** with one literal
  replacement. The revert executed that saved definition. Its md5 was then compared with the
  md5 saved alongside it.
- **Why the migration `.sql` was not used:** the checkout is CRLF, so restoring from it would
  give a spuriously different md5 (Phase 3, F5). The saved definitions are LF: 0 CRs in all
  five.
- **Grants:** reverted by the matching `revoke`, then proven by reading the ACL.

After each mutation the **whole lane** holding the named test ran with `--reporter=verbose`
(`$PNPM test:unit`, `$PNPM test:db` or `$PNPM test:workflow`, no `-t` filter). Every failing
test was then read by NAME from the log, so "only that one" is judged against the whole lane,
not a filter. A source mutation ran the lane that holds its named test. A module shared across
lanes (`meter.ts`, `search-tile.ts`, `match.ts`) may also red tests in the lanes that were not
run. Those are not listed here.

**Baseline before any mutation:** unit **671/671** (84 files), db **405/405** (43), workflow
**22/22** (3). No flakes.

**Catalog capture before any mutation** (`capture-before.json`, compared at the end):
- `md5(pg_get_functiondef)`, length, `proacl` and comment for `app.purge_expired_place_coordinates`
  (`dbdedd586bb4064ad6b55091fd51f764`, 938 chars), `app.record_places_page`
  (`c235ead2bcbfc0932aa78119395451fe`, 12,740), `app.release_reservation`
  (`0378dfc692e68c3d45bc0062b06586cf`, 1,406) and `app.settle_reservation`
  (`8cc64539cfdd0973752f6db1fdf5b5f8`, 5,727);
- `has_function_privilege` for anon / authenticated / siteless_cron / service_role / postgres
  on all four;
- the view `business_place_signal`: `md5(pg_get_viewdef)` `aa8b96b16293e7a1c4df1bfc4cdd2552`,
  its `reloptions` (`security_invoker=true`), ACL, comment and column list;
- `information_schema.role_table_grants` for the places and cost tables,
  `column_privileges` and `has_any_column_privilege` on `place_coordinates`, and `relacl`;
- row counts: businesses 91,872, runs 3, place_attachments 123, place_observations 123,
  place_coordinates 114, cost_ledger 36, cost_reservations 37.

**After the last revert:** the same capture, **`diff` empty (byte-identical, OIDs included)**.
`git diff --stat` and `git status --porcelain` were both empty. The three lanes, re-run: unit
671/671, db 405/405, workflow 22/22.

## The log

Columns: **#** · **mutation** · **file / object** · **command** · **red test NAME (or SURVIVED +
analysis)** · **revert proof**. The named test is **bold** where it is the research table's
"must turn red". "Over-red" means other tests also went red; the finding that explains each
one is referenced.

| # | Mutation | File / object | Command | Red test NAME (or SURVIVED + analysis) | Revert proof |
|---|---|---|---|---|---|
| M26 | builder drops `includePureServiceAreaBusinesses` (the body line deleted) | `src/lib/places/request.ts:101` | `$PNPM test:unit` | 9/671: **`every places request carries includePureServiceAreaBusinesses`** (`expected undefined to be true`), plus 8 `places-client` tests, all answered by msw's 501 refusal `includePureServiceAreaBusinesses is not true (PLACE-05)` (F1) | byte copy restored; `git diff --stat` empty |
| M27 | `places.pureServiceAreaBusiness` removed from `PRO` | `src/lib/budget/field-mask-tier.ts:35` | `$PNPM test:unit` | 29/671: **`fieldMaskTier maps every known field to its tier`** (`ALL_PLACES_FIELDS` 13 vs 12). The other 28 are one cause: `fieldMaskTier: unknown field "places.pureServiceAreaBusiness"`, the refusal of an unknown field, which fires wherever the shipped mask is tiered (4 field-mask-tier, 15 places-client, 8 places-request, the price-book atmosphere test). Over-red by design, as 04-12 recorded | restored; diff empty |
| M28 | `reservePage` skips the mode-gate return (`if (m !== true) return …` → `void m`) | `src/lib/places/meter.ts:141` | `$PNPM test:db` | 2/405: **`off mode refuses before any reservation`** and `a missing key refuses before any reservation`. Both got `{kind:'reserved'}`: one return carries both refusals | restored; diff empty |
| M29 | `modeAllows`: the `ids_only` sku refusal deleted | `meter.ts:65` | `$PNPM test:unit` | 2/671: **`ids_only refuses an Enterprise mask`** (`expected true to be 'mode_forbids_sku'`), plus `a refused mode never reaches the database` (the same gate, one layer up, through `reservePage`: `the database was reached`) | restored; diff empty |
| M30 | saturation `resultsCount === 60` → `> 60` | `src/lib/places/tiling.ts:142` | `$PNPM test:unit` | 6/671: **`a 60-result tile is saturated and subdivided`** (`expected false to be true`), plus 5 tiling tests that build their saturated input as `resultsCount: 60` without `pagesServed`: both pruning tests, novelty, max depth, min size, all `{action:'done'}` (F2) | restored; diff empty |
| M31 | min-size saturation not flagged truncated (`truncate/min_size` → `done`) | `tiling.ts:327` | `$PNPM test:unit` | 1/671: **`truncated at minimum size`**, only | restored; diff empty |
| M32 | call before reserve: the page's ONE `searchText` moved ahead of `reservePage` (placeholder `ReservedCall` with the right sku; the post-reserve call uses that early result) | `src/lib/places/search-tile.ts:484` | `$PNPM test:db` | 2/405: **`no places request leaves without a reservation`** (`expected null not to be null` at `:297`: the msw hook saw no cursor at request time) and `a refused reservation ends the tile and sends nothing` (`expected 1 to be +0`). The doubled variant (an extra early call, the real one kept) reds 8, and the named test dies earlier on its request count (6 vs 3) (F3) | restored; diff empty (both forms) |
| M33 | a refused reservation (`stop`) returned as a retryable fail | `search-tile.ts:491` | `$PNPM test:workflow` | 2/22: **`a refused reservation ends the run partial`** (`{status:'failed'}` vs `{partial, budget_cap_reached}`), plus `the run stops at its request ceiling`: `exceeded_estimate` leaves through the same `stop` return | restored; diff empty |
| M34 | ceiling UPDATE without `and calls_count < ceiling_requests` | `meter.ts:180` | `$PNPM test:db` | 2/405: **`a run stops at 2x its estimate-high`** (got `reserved`, expected `stop`), plus `places-recorder` `the run ceiling refuses what the recorder cap would allow` (the D-04 recorder reserves through the same `reservePage`) | restored; diff empty |
| M35 | `business.site` removed from the dead list | `src/lib/places/host-class.ts:31` | `$PNPM test:unit` | 2/671: **`host class: business.site is a dead Google site`** (`expected 'other' to be 'business_site_dead'`), plus `the anonymizer keeps structure and drops every Google string` (the recorded fixture's host-class set loses `business_site_dead`) | restored; diff empty |
| M36 | the writer copies `displayName.text` into every match's `features` as `label` (carried through `Derived`) | `search-tile.ts:528, :211` | `$PNPM test:db` | 5/405: **`no Places text reaches the database`**, `the match page attaches, ties, tentatives and counts`, `a service-area listing is observed with its flag`, `the step result satisfies the reducer's contract`, and `places-recorded-replay`. Every one is `PageRecordRefusal: toPageRecord: feature label is not allow-listed`: the refusal fires before the database. The fixture names appear 0 times in the log. **M36-scan** (the display name put into the page transaction's actor GUC, past `toPageRecord`) reds exactly `no Places text reaches the database` + `places-recorded-replay`, both `{table:'cost_reservations', hits:[…]}`. That proves the scan itself (F4) | restored; diff empty (both forms) |
| M37 | `grant select on public.place_coordinates to authenticated` | live DB | `$PNPM test:db` | 2/405: **`authenticated cannot read place coordinates`** (the promise resolved `SELECT` instead of rejecting), plus grants-audit `the eight places tables hold exactly their 0027 grants` | `revoke`. `relacl` = `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` (= capture). `has_table_privilege` and `has_any_column_privilege` for authenticated/select are both false. 0 column grants |
| M38 | purge predicate inverted: `pc.expires_at <= now()` → `> now()` | `app.purge_expired_place_coordinates` | `$PNPM test:db` | 1/405: **`the purge removes expired coordinates and keeps the observation`** (`expected +0 to be 1`), only | saved def executed. md5 `dbdedd586bb4064ad6b55091fd51f764` (938 chars) **EQUAL**. proacl and comment intact. place_coordinates still 114, place_purge_runs 0: nothing committed |
| M39 | `grant execute on app.purge_expired_place_coordinates(text) to authenticated` | live DB | `$PNPM test:db` | 2/405: **`the purge refuses a tenant session`** (resolved instead of rejecting), plus `only siteless_cron may execute the purge` | `revoke`. proacl = `{postgres=X/postgres,siteless_cron=X/postgres}` (= capture). authenticated cannot execute; siteless_cron can |
| M40 | upsert overwrites `rejected`: `where status <> 'rejected' and reason <> 'confirmed'` → `where reason <> 'confirmed'` | `app.record_places_page` | `$PNPM test:db` | 1/405: **`a rejected pair never re-attaches`**, only. `a confirmed attachment is not re-scored by a later run` stays green, so this precise form separates the two halves that 04-15's `where true` killed together | saved def executed. md5 `c235ead2bcbfc0932aa78119395451fe` (12,740 chars) **EQUAL**. proacl and comment intact |
| M41 | a tie resolved to the higher score (the tie branch now requires `first.score === second.score`) | `src/lib/places/match.ts:202` | `$PNPM test:unit` | 1/671: **`a place tying two businesses at 95 goes to review`** (`expected 'attached' to be 'tentative'`), only | restored; diff empty |
| M42 | the SAB branch lifts to 95 without a phone (`phoneMatch &&` dropped) | `match.ts:185` | `$PNPM test:unit` | 2/671: **`service-area listing without an exact phone caps at 94`** (`expected 95 to be 51`), plus `places-chips-contract` `the matcher's features render as chips` (an attached `sab_phone_city` with `phone: 0`: the same invariant, pinned where the chips render) | restored; diff empty |
| M43 | the signal view includes tentative (`WHERE a.status = 'attached'` → `= ANY('attached','tentative')`) | view `business_place_signal` | `$PNPM test:db` | 3/405: **`a tentative attachment is excluded from the signal`**, `a tentative match is observed but not a signal` (places-writer) and `the google check reads the business signal and every listing` (listing-actions). One view, read at three layers | `create or replace` from the saved viewdef, `with (security_invoker = true)`. md5 `aa8b96b16293e7a1c4df1bfc4cdd2552` (859 chars) **EQUAL**. reloptions, relacl and comment = capture |
| M44 | the tag deleted from the Google card: the signal row's `<SourceTag … dateTestId="business-google-signal-date" />` | `src/components/business-detail/google-check.tsx:340` | `$PNPM test:unit` | 3/671: **`google maps attribution renders wherever a places signal renders`** (`business detail · Google check signal row: business-google-signal holds 0 Google Maps tags`), plus google-check `the google check shows the business signal with the Google Maps tag and date` and `one attached listing renders once` (that row's tag/date count) | restored; diff empty |
| M45 | `searchTile` returns `displayName` in its summary (`label` = the first place's `displayName.text` on the `searched` result) | `search-tile.ts:585` | `$PNPM test:workflow` | 2/22: **`no step returns Places content`** (`expected [ 'Ortiz Plumbing', …(2) ] to deeply equal []`), plus tile-replay `a finished search tile re-executed buys nothing and returns the same result`. The replay rebuilds the result from the DB, so it has no `label`: a leak also breaks replay equality | restored; diff empty |
| M46 | the step skips the run-org check (`readRunStatus`: an invisible run is read as `'running'`) | `meter.ts:120` | `$PNPM test:db` | 1/405: **`a workflow step cannot write another org's run`**. It got a raw `Failed query` from `app.reserve_budget` instead of `WorkerOrgMismatch`: the definer is a second wall, and the test pins the typed fail-closed error, as 04-16 recorded | restored; diff empty |
| M47 | the partition hash uses the list index (`partitionOf(cellKey, index?)` → `(index ?? hash) % 4`) | `src/lib/places/partition.ts:52` | `$PNPM test:unit` | 1/671: **`a cell keeps its partition when cells are added`** (`expected 3 to be 1`), only | restored; diff empty |
| M48 | `general_contractor` restored in home_services | `src/seed/data/clusters.json` | `$PNPM test:unit` | 9/671: **`every placesTypes entry is a Table A type`** (`expected [ 'home_services: general_contractor' ] to deeply equal []`), plus 7 `estimate` cost-model pins (4,131 vs 3,978 requests) and plan-run `a full sweep plans one root per cell and Places type` (459 vs 442). Exact-count pins over the seeded type list | restored; diff empty |
| M49 | the page-2 body drops `strictTypeFiltering` | `request.ts:112` (`buildNextPage`) | `$PNPM test:unit` | 3/671: **`a page request repeats the first request's body`**, plus 2 multi-page places-client tests: msw refuses page 2 with a 501, giving `expected a next page` (F1) | restored; diff empty |
| M50 | the `CRON_SECRET` comparison removed (the length + `timingSafeEqual` check) | `src/app/api/cron/purge-places/route.ts:46` | `$PNPM test:unit` | 3/671: `the purge route refuses a wrong secret` (200 vs 401), `… refuses a secret of a different length without throwing`, `… refuses a missing header`. **The research's named test `the purge route refuses without the cron secret` STAYED GREEN**: it pins the separate unset-secret 503 branch. **M50b**, which removes that branch, reds exactly the named test and only it (`expected 401 to be 503`). A mis-pairing, not a dead guard (F5) | restored; diff empty (both forms) |
| M51 | the key is read in a second module (`const k = process.env.GOOGLE_PLACES_API_KEY;` appended) | `request.ts:114` | `$PNPM test:unit` | 1/671: **`no google credential is read anywhere in src`** (`src\lib\places\request.ts:114 [GOOGLE_*KEY environment variable]`), only | restored; diff empty |
| M52 | the daily-quota 429 becomes retryable (`daily_quota` → `fail(places_unavailable, true)`) | `search-tile.ts:336` | `$PNPM test:workflow` | 1/22: **`google daily quota stops the run`** (`{status:'failed'}` vs `{partial, google_daily_quota}`), only | restored; diff empty |
| M53 | the admission hold settled instead of released (the release body → `perform app.settle_reservation(hold, …, 0, 1, derived sku, derived provider)`) | `app.release_reservation` | `$PNPM test:db` | 11/405: **`release_reservation frees the hold and writes no ledger row`** (`{released:false, settled:true}`), plus 10 callers of the one release path: budget-concurrency settle-vs-release race (2 ledger rows vs 1), places-meter error-response release, places-search-tile 400 / daily quota / per-minute, places-check-tile ×3, the places-recorder refused page, and queueRun's start-failure release (F6) | saved def executed. md5 `0378dfc692e68c3d45bc0062b06586cf` (1,406 chars) **EQUAL**. proacl and comment intact. cost_ledger 36 / cost_reservations 37 = capture |

**No mutation survived.** Every guard M26–M53 names is killed by at least one test, and every
kill was read by name. The research's named test went red for 27 of the 28 as written. The
exception is **M50**: the mutation is killed, but by three sibling tests, and its named test
belongs to a neighbouring guard. That guard is itself killed by M50b.

## Findings

**F1: msw is a second wall for request shape (M26, M49).** `tests/unit/msw/places.ts` answers a
request that breaks a builder invariant with a 501, never a page (B-WR-10, added after 04-12).
So the builder mutations also red the client tests that send real builder output. 04-12
recorded M26 and M49 as "only". That was true before the harness gained the check, and it is
over-red by design now. The builder tests are still the ones that name the invariant.

**F2: M30's over-red is fixture shape, not a shared guard.** Five tiling tests express "a
saturated tile" as `resultsCount: 60` with no `pagesServed`, so they depend on the `=== 60`
arm. The B-WR-01 page-3 arm (`pagesServed >= MAX_PAGES`) is independently pinned by
`resultsCount: 57, pagesServed: 3` at `tiling.test.ts:139` (`a capped search that comes back short
on its last page is saturated`), which stayed green, as did `a 59-result tile is not saturated`.

**F3: the literal "call before reserve" is caught by the request count before the cursor
check (M32).** Adding an early call doubles the requests, and the named test's first assertion
(`toHaveLength(3)`) dies before its per-request cursor loop runs. The faithful form moves the
single call ahead of the reservation. That kills the named test at the cursor assertion itself
(`expected null not to be null`, `:297`). So the at-request-time reservation check is
load-bearing on its own, and the count is a second, independent guard.

**F4: M36 as written proves `toPageRecord`'s refusal, not the database scan.** This is the
same as 04-18. `features` is allow-listed by key and value before any SQL, so a text feature
never reaches the writer. That is also the `pa_features_numeric` CHECK's job one layer down
(04-15). M36-scan moves text past `toPageRecord` into a GUC, and the eleven-table scan then
catches it in `cost_reservations.updated_by`, alongside the D-04 replay's own copy of the scan.
Each wall dies alone under its own mutation.

**F5: M50's research pairing names the wrong branch.** `the purge route refuses without the
cron secret` pins `CRON_SECRET` **unset → 503 `not_configured`**. M50 removes the **bearer
comparison**, which three other tests pin (wrong secret, different length, missing header), and
all three died. Both guards are load-bearing:
- without the comparison, anyone can purge;
- without the unset branch, `want` becomes the literal `Bearer undefined`, so an unconfigured
  deployment would accept a request carrying exactly that header.

Nothing to strengthen. The row now records both mutations.

**F6: M53's width is the blast radius of one release function.** Every path that frees a hold
calls `app.release_reservation`:
- admission;
- a 4xx/5xx page;
- the change check;
- the recorder;
- `queueRun`'s start failure.

Settling instead of releasing leaves a ledger row on each of them, and each test that asserts
"released, no ledger row" dies. It is one guard with eleven observers, not eleven guards.
Under M53, `release_reservation is idempotent` and `… will not release a settled reservation`
stayed green by design: both return 0 through the early settled/released guard, which the
mutation leaves in place (as 04-11 recorded).

**Over-reds that are the same property at another layer** (no split warranted): M29 (the mode
gate through `reservePage`), M33 (the ceiling stop shares the `stop` return), M34 (the D-04
recorder shares `reservePage`), M35 (the anonymizer's host-class set), M42 (the chips
contract), M43 (the view read by the writer test and the google-check query), M44 (the
google-check row count), M45 (replay equality) and M48 (exact-count cost pins).

## Proposals (not done here; this plan measures and does not change tests)

1. **04-RESEARCH § Gate mutations, M50:** name both tests. As written, M50 kills `refuses a
   wrong secret` / `different length` / `missing header`. M50b (the unset branch) kills
   `refuses without the cron secret`.
2. **M32 and M36 in any future gate table:** use the faithful forms recorded above (a single
   call moved ahead of the reservation; M36-scan for the database scan). The literal forms die
   on an earlier guard and leave the named assertion unexercised.
