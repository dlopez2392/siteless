---
phase: 04-places-transient-verifier
slice: B — Places core, placesSweep workflow, env, budget/estimate, their tests
fixed_at: 2026-09-24
review_path: .planning/phases/04-places-transient-verifier/04-REVIEW-partB.md
base: ee4bfba
iteration: 1
findings_in_scope: 13
fixed: 11
partial: 1
cross_slice: 1
status: partial
---

# Phase 4 (slice B): Code Review Fix Report

**Source review:** `04-REVIEW-partB.md` (B-CR-01..03, B-WR-01..10)
**Base:** `ee4bfba` · **Worktree branch:** `worktree-agent-a923651ab08500221` (not pushed)

Every fix below went test-first. The test was either written red against the old code, or the
fix was mutated back and the test went red, and each red was checked BY NAME. The commit
messages list those names. No real Google call was made; msw was the only endpoint.

## Summary

| Finding | Status | Commit |
|---|---|---|
| B-CR-01 US results classified `outside` | fixed | `1422104` |
| B-CR-02 retry / replay re-buys pages | fixed (residual: crash after some pages → see follow-up F1) | `9444a26` (+ `2ac9a88`) |
| B-CR-03 radius presets share tile keys | fixed (TS key half; A's 0030 refreshes geometry) | `ad2dfbf` |
| B-WR-01 saturation needs exactly 60 | fixed | `ae6c1a2` |
| B-WR-02 novelty truncates dense cores | **partial — needs-decision** | `8da5d37` |
| B-WR-03 saturated check marks members gone | fixed (TS half; A's 0030 refuses in SQL) | `45bd720` |
| B-WR-04 stale descendant leaves listed | fixed (read side) | `a191529` (+ `e342bb1` move) |
| B-WR-05 change-check ceiling from root estimate | **cross-slice** (queue-run.ts, fixer A) — enabler committed | `e342bb1` |
| B-WR-06 401/403/404 retried; Retry-After unbounded | fixed | `e222c0e` |
| B-WR-07 SQLSTATE hidden by DrizzleQueryError | fixed | `2ac9a88` |
| B-WR-08 beginRun failure leaves run queued + hold | fixed | `ff6d69a` |
| B-WR-09 shared Places type double-plans a tile | fixed | `753700a` |
| B-WR-10 msw handler lenient | fixed | `8f30e73` |

Items relayed from fixer A and done in this slice: `8649197` (A-WR-07, TS half) and
`b67494a` (A-WR-08 / A-WR-09, TS half). See "Fixer A relay" below.

## Fixed

### B-CR-01 — `1422104`
`src/lib/places/area.ts` adds `isOutOfAreaAddress`. A listing is outside only when the address
ends in a foreign country's name (Mexico/México, the Central American neighbours, Canada). The
following are all domestic:
- no country suffix (the normal shape under `regionCode: 'US'`)
- `USA`
- `United States`

Both the matcher and the anonymizer use the rule. The anonymizer keeps the suffix-less shape of
a real recording, and `assertAnonymizedPage` accepts both domestic forms.

The domestic fixtures dropped `, USA`. The Mexican listing stays. The fixtures README says why.

Red by name:
- places-match:
  - "a US listing without the country suffix is in the area and attaches"
  - "a service-area partial address without the country is in the area"
- anonymize-places: "the anonymizer keeps a US listing without the country suffix domestic"
- db: "the match page attaches, ties, tentatives and counts"
- workflow: "no step returns Places content". This test now also asserts that an ADDRESSED
  listing attached. Before that assertion, the SAB-only attachments let the mutation through
  green.

### B-CR-02 — `9444a26` (with B-WR-07 `2ac9a88`)
Case 1: a 5xx, timeout or per-minute 429 on page 2 or 3 is retried **inside the step** while
the page token is still in memory.
- Up to `PAGE_RETRIES = 2` retries.
- Back-off is 1 s, then 2 s.
- A Retry-After of up to 60 s is honoured.
- Every attempt gets its own reservation, request id, ceiling bump and settle or release.

Case 2: class 22/23/42 SQLSTATEs and `PageRecordRefusal` are **fatal** (`step-errors.ts`).

Case 3: `runSearchTile` and `runCheckTile` read their `run_searches` row after `settleInFlight`.
- A `done` search rebuilds its result from the row and calls Google zero times.
- A subdivided search re-plans its children from the same geometry, using the new pure
  `tiling.childrenOf`. `plan_run_searches` returns the same ids.
- A done change check keeps its recorded verdict.

Red by name, with request counts (old → new):
- workflow:
  - "a page that fails mid-tile is retried in the step and no page is bought twice" (6 → 4)
  - "a database refusal after a bought page fails the run without buying it again" (4 → 1)
- tile-replay:
  - "a finished search tile re-executed buys nothing and returns the same result" (6 → 3)
  - "a finished change check re-executed lists nothing and keeps its verdict" (2 → 1)

**Residual:** a process crash AFTER some pages were recorded still restarts at page 1, because
the token is not persisted. See follow-up F1.

### B-CR-03 — `ad2dfbf`
`radiusUnitId(county, lat, lng, miles)` builds `48215\u000026.20340,-98.23000\u00005mi` (the
centre at 5 decimals). A radius with a non-finite centre is refused.

A radius cell's partition week moves as a result, because the week is a hash of the cell key.
This is pre-launch, and prod has no stored radius tiles.

Red by name, in plan-run:
- "two radius presets in one county with the same radius never share a tile key"
- "a radius unit is tiled from the preset's circle"

### B-WR-01 — `ae6c1a2`
`isSaturated(resultsCount, pagesServed)` is true for exactly 60, or when page 3 was reached.
`decideSubdivision` and `diffTile` take `pagesServed`, and search-tile and check-tile count the
pages they served.

Red by name:
- tiling: "a capped search that comes back short on its last page is saturated"
- change-detect: "a check that reached its last page is saturated even short of 60"
- workflow: "a search capped short of 60 on its last page still subdivides"

### B-WR-03 — `45bd720`
`diffTile` returns `gone: []` whenever the listing is saturated. The additions are still
recorded. This is relay item 1: 0030 now REFUSES (22023) a saturated check that carries gone
ids, so without this fix every saturated change check would fail.

Red by name, in change-detect: "a saturated change check never marks a member gone".

### B-WR-04 — `a191529`
`storedLeaves` drops any leaf whose ancestor on the same path is also a stored leaf (relay
item 5). `e342bb1` then moves it to `src/lib/places/stored-leaves.ts` with no change in
behaviour.

Red by name, in workflow: "a change check lists only the shallowest stored leaf on each path".
The old code listed `r`, `r0` and `r1`; the new code lists only `r`.

### B-WR-06 — `e222c0e`
401, 403 and 404 now classify as `rejected`, which surfaces as `places_request_rejected` and is
never retried. `Retry-After` is clamped to 300 s.

Red by name, in places-client:
- "a Retry-After longer than five minutes is clamped"
- "searchText classifies 401, 403 and 404 as rejected, never retried"

### B-WR-07 — `2ac9a88`
`sqlstateOf` walks `.cause`, so it finds the SQLSTATE under drizzle's wrapper. `stepError`
never reads the message, because drizzle's message quotes Places-derived params.

The test is built on a REAL `DrizzleQueryError`. Red by name, in sweep-step-errors: "a
drizzle-wrapped query error reports the database's SQLSTATE", plus 3 siblings.

End to end, the lane's DB-refusal test finds `step_error:22023` in the workflow world files.

### B-WR-08 — `ff6d69a`
A new `abortRun` step runs under the step's own org, so RLS applies. It:
1. Releases, and never settles, every hold of the run that no page attempt points at. Each
   release runs in its own savepoint.
2. Closes the run `failed / never_started` with its one event.

`workflow.ts` now wraps `beginRun` in a try:
- The M46 refusal is rethrown untouched.
- Anything else goes to `abortRun`.

Red by name, in workflow: "a beginRun failure closes the run and frees its admission hold". The
fault is real: an oversized second hold whose release hits 23514. The M46 test stays green.

### B-WR-09 — `753700a`
- `planRootSearches` refuses a repeated tile key and names the type.
- The reducer refuses to queue a search id twice.
- `workflow.ts` builds the queue inside its try.
- A named test holds the committed `clusters.json` disjoint.

Red by name:
- plan-run: "no Places type is searched by two clusters"
- sweep-reducer: "a queue never holds the same search twice"

### B-WR-10 — `8f30e73`
The handler now:
- refuses a request no route claims (501). Tests that mean "empty" route to
  `PLACES_PAGES.empty`; the lane uses `EMPTY_ELSEWHERE`, last.
- validates the whole `request.ts` contract:
  - the SAB flag
  - `strictTypeFiltering`
  - `pageSize` 20
  - `regionCode` US
  - `languageCode` en
  - a Table A `includedType` spelled as the `textQuery`
  - an ordered rectangle
  - no extra body key
  - mask fields limited to the requested set
- accepts page 2 or 3 only as the exact page-1 body its token was issued for, plus that token.
  An unissued token is refused.
- strips `, USA` from served addresses, as Google does under `regionCode: 'US'`.
- logs every refusal reason in `placesRefusals`.

Red by name, in places-msw: "… refuses a request no route claims", "… refuses a body the builder
would never send", "… refuses a later page whose body differs from page 1", "… omits the US
country the way regionCode US does", "… serves the error envelopes".

## Partial / needs-decision

### B-WR-02 — part fixed in `8da5d37`; the rest needs a decision
**Fixed.** `overlapWithParent` used to read the parent tile's whole cross-run membership, which
only grows, so the overlap drifted upward. It now counts only the members the parent saw in THIS
run (`last_seen_at >= coalesce(run.started_at, run.created_at)`).

Red by name, in workflow: "novelty reads only the parent's members from this run".

**Needs a decision (danlo / the D-04 tuning).** Suppose the parent's top 60 sit in one quadrant
of a dense core. That child's own top 60 are then the same ids, so it truncates as `novelty`
while hundreds of listings stay unsearched. Novelty cannot tell this case apart from the
service-area loop by ids alone. There are three options:
- (a) Count novelty over pure-SAB ids only.
- (b) Truncate only when a place's location lies outside the child's rectangle, or it has no
  location.
- (c) Compare siblings (truncate when all four children return the same set). This needs state
  across steps.

Each option trades spend for coverage. The constants are meant to be tuned on the D-04 run, so
this was not changed unilaterally. The existing DB test "a saturated child that repeats its
parent truncates by novelty" is fixer A's file, and it pins today's rule.

## Cross-slice follow-ups (exact changes, not made here)

**F1 — fixer A: persist the page token (closes B-CR-02's residual).**
- Schema: `alter table run_searches add column next_page_token text` (nullable).
- `record_places_page`: set `next_page_token = p_record->>'nextPageToken'`; null clears it.
- `mark_run_search`: clear it when `status = 'done'`.
- `PageRecord` / `toPageRecord` in my slice then carry `nextPageToken`.
- `runSearchTile`: on entry with `status <> 'done' and pages_done > 0 and next_page_token is not
  null`:
  1. Resume at page `pages_done + 1` with `buildNextPage(first, token)`.
  2. Take `total` from `results_count`.
  3. Rebuild the overlap id set from this run's members.
- Before persisting: confirm under D-01 that an opaque page cursor may be stored. It is not
  Places content, but it would join the D-01 enumeration.
- Also confirm on 04-32 how long a token stays valid.

**F2 — fixer A: B-WR-05, in `src/server/actions/queue-run.ts`.**
For `change_check`, do not use `ceil(2 × estimate.requestsHi)`. Instead, inside the admission
transaction:
1. Plan the roots with `planRootSearches({ …, kind: 'change_check' })`.
2. Run `storedLeaves(tx, roots)` (now importable from `@/lib/places/stored-leaves`).
3. Set `ceiling = Math.ceil(RUN_CEILING_MULTIPLIER * leaves.length * MAX_PAGES)`, with
   `MAX_PAGES` from `@/lib/places/tiling`.

The hold stays at 1 µUSD on `ts_essentials`.

**F3 — fixer A: A-WR-09, in `queue-run.ts`'s stale-run reclaim.** Inside the reclaim
transaction, for each `run_searches` row of the reclaimed run with an in-flight cursor, call
`settleInFlightInTx(tx, runId, searchId)` (exported from `@/lib/places/meter`, `b67494a`) before
stamping the run. Then stamp `cost_micro_usd` from the ledger, as A-WR-09 describes.
`settle_reservation` must be callable in that context. Check its grant for the org role that
queueRun uses.

**F4 — fixer A: `tests/db/event-trigger.test.ts`.** With 0030 applied to the shared database,
"every state-bearing table has an app.log_event after-row trigger" sees 7 triggers where it
expects 8, presumably because A-WR-05 swapped `place_attachments` to an allow-listed emit. This
is 0030 schema noise, not this slice. Update the constant and the set in that test.

**F5 — fixer C (optional): `tests/e2e/runs.spec.ts:158`.** The e2e seed uses
`'McAllen, TX 78501, USA'`. It is still domestic under the new rule. Dropping `, USA` would make
it match the realistic `regionCode: 'US'` shape. No behaviour depends on it.

**F6 — fixer C: run-report copy for `places_request_rejected`.** After B-WR-06, a 403 (bad or
restricted key, Places API (New) not enabled, billing disabled) reports as
`places_request_rejected`. The operator copy for that reason should name those causes along
with "Google refused the request". No new reason key was added, so no UI type changes.

## Fixer A relay (orchestrator message), item by item
1. **`diffTile` gone = [] when saturated.** Done, B-WR-03 `45bd720`, with a named test.
2. **Radius centre in the unit id.** Done, B-CR-03 `ad2dfbf`.
3. **page-record comments and the sku narrowing.** Done, `8649197`:
   - The header now says 0030's CHECK admits exactly the 11 keys.
   - `PageRecord.sku` is `'ts_enterprise'`.
   - `toPageRecord` refuses any other sku.
   - `persistPage` no longer maps unknown skus to `ts_enterprise` silently.

   Red by name: "a page record is an Enterprise page or nothing".
4. **Longer TTL on page holds, and an in-tx `settleInFlight`.** Done, `b67494a`:
   - `PAGE_HOLD_TTL = '60 minutes'` is passed to `reserve_budget`.
   - `settleInFlightInTx` is exported.
   - The queue-run half is F3.

   Red by name: tile-replay "a page hold outlives the abandoned-run reclaim".
5. **`storedLeaves` drops a leaf whose ancestor is a leaf.** Done, B-WR-04 `a191529`.

## Gate (worktree HEAD after `e342bb1`, before this report)
| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `eslint . --ignore-pattern ".claude/**"` | clean |
| unit (`vitest run tests/unit`) | 84 files, 649 passed |
| workflow lane | 3 files, 22 passed |
| db lane (full, shared DB with fixer A's 0030 live) | 41/42 files, 374/375 passed. The one failure is F4 (0030 trigger count), not this slice. The db tests that exercise this slice's code are all green: places-search-tile, places-check-tile, places-recorder, places-meter, places-writer, places-run-report, queue-run. |

## What 04-32's first real run must verify
1. **Address shape (B-CR-01).** Under `regionCode: 'US'`, check a real McAllen result's
   `formattedAddress`, expected with no `, USA`. Check that a real Reynosa result ends in
   `Mexico` (English, `languageCode: 'en'`). Check at least one addressed US listing attaches.
   The run report must not read as all-`outside`.
2. **Recording shape.** The first anonymized recording's domestic addresses should come out as
   `NNN Synthetic St, <city>, TX 78500`, with no suffix.
3. **In-step retry (B-CR-02).** If a page 2/3 is retried, it succeeds with the same token and no
   INVALID_ARGUMENT. Token validity across a 1–60 s wait is unverified.
4. **Page counts.** Log per-page counts on a saturated tile. Does page 3 come back short under
   strictTypeFiltering (B-WR-01)? Is each page billed? (Existing MEDIUM claim.)
5. **403 behaviour (B-WR-06).** An unconfigured, restricted or unbilled key should end the run
   `failed / places_request_rejected` after ONE request, not four.
6. **Retry-After.** Record the Retry-After Google actually sends on a per-minute 429.
7. **Page holds.** They carry a 60-minute TTL (`expires_at - created_at`).
8. **Novelty (B-WR-02).** Watch `truncated_why = 'novelty'` counts in dense cores, the input to
   the needs-decision above.

---

_Fixer: Claude (gsd-code-fixer), slice B_
