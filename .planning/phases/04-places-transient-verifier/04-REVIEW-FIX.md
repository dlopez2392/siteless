---
phase: 04-places-transient-verifier
fixed_at: 2026-09-24
review_path: .planning/phases/04-places-transient-verifier/04-REVIEW.md
parts:
  - 04-REVIEW-FIX-partA.md  # database + server, iteration 1
  - 04-REVIEW-FIX-partB.md  # Places core + placesSweep workflow, iteration 1
  - 04-REVIEW-FIX-partC.md  # UI, iteration 1
  - this file, "Round 2"    # the cross-slice follow-ups, on the merged branch
iteration: 2
branch: gsd/phase-04-places-transient-verifier
base: 9ebf4e5  # all three fix branches merged
findings_in_scope: 43   # 7 Critical + 36 Warning; the 23 Info were out of fix scope
fixed: 40
partial: 3
deferred: 0             # none of the 43 is wholly deferred; the 3 partials' remainders are
needs_decision: 7       # open decisions for danlo, listed below
skipped: 0
status: partial
migrations: [0030_places_review_fixes (slice A), 0031_places_transient_oldest_expired (round 2)]
local_journal: 32       # local test DB only; production untouched
---

# Phase 4: Code Review Fix Report (consolidated)

**Source review:** `04-REVIEW.md`, which indexes `04-REVIEW-part{A,B,C}.md`: 7 Critical, 36
Warning and 23 Info findings.

**What was fixed, and where:**
- Iteration 1 was three parallel slice fixers. Each has its own detailed report,
  `04-REVIEW-FIX-part{A,B,C}.md`.
- Round 2 is this file. It finished the cross-slice follow-ups the slices left for each other,
  on the merged branch `gsd/phase-04-places-transient-verifier`, starting at `9ebf4e5`.
- Nothing was pushed. Production was not touched, and no Google request was made.

## Tally (Critical + Warning, 43 in scope)

| Result | Count | Findings |
|---|---|---|
| fixed | 40 | everything below not listed as partial |
| partial (the rest needs a decision) | 3 | B-CR-02, B-WR-02, C-WR-03 |
| deferred (wholly) | 0 | — |
| skipped | 0 | — |
| open decisions for danlo | 7 | see "Needs decision" |

**"fixed: requires human verification".** These are semantics choices the fixer made. They pass
their tests, but danlo should confirm the chosen behaviour:
- A-WR-01: an auto-attached listing keeps its stored verdict.
- A-WR-03: a confirmed tie rejects its other side.
- A-WR-04: the signal groups by merge root.
- A-WR-09: the reclaim settles pessimistically, as charged.
- A-WR-10: an unsubdivided close retires the tile's descendants.
- A-WR-11: the tile upsert refreshes geometry rather than refusing.

## Per finding

### Critical (7)

| ID | Result | Commits | Note |
|---|---|---|---|
| B-CR-01 | fixed | `1422104` | US results without `, USA` stay in the area. Round 2 F5 (`6026297`) aligns the e2e seed. |
| B-CR-02 | **partial** | `9444a26`, `2ac9a88` | In-step page retry, deterministic faults fatal, done searches never re-bought. **Residual:** a crash after some recorded pages re-buys them. F1 persists the page token; it is **deferred and needs a D-01 check** (see deferred-items.md). |
| B-CR-03 | fixed | `ad2dfbf` + A `a202e2f` | The radius centre is in the unit id (TS). 0030 refreshes geometry (SQL). |
| C-CR-01 | fixed | `be8aa3f` | A rejected `queueRun` keeps the drawer open with `RUN_START_UNKNOWN`. |
| C-CR-02 | fixed | `dcd0761` | The version "Run" buttons honour `PLACES_MODE`. |
| C-CR-03 | fixed | `a5f90da` | "Every tile was searched" shows only on a complete run. |
| C-CR-04 | fixed | `61eb9a4` | Past-month cap alerts read the run's own period. |

### Warning (36)

| ID | Result | Commits | Note |
|---|---|---|---|
| A-WR-01 | fixed (confirmed by danlo 2026-09-25) | `8cb40e0` | |
| A-WR-02 | fixed | `14a11e4` + B `45bd720` | SQL refuses; `diffTile` sends `gone: []` when saturated |
| A-WR-03 | fixed (confirmed by danlo 2026-09-25) | `8a50d12` | Round 2 adds the specific tie-refusal message (`d5282fc`, below) |
| A-WR-04 | fixed (confirmed by danlo 2026-09-25) | `71f71d7` + C `3603354` | |
| A-WR-05 | fixed | `9ca26c8` | **D-01 re-acknowledgement needed** (legal list changed). Round 2 F4 (`0348e42`) pins the trigger by function. |
| A-WR-06 | fixed | `237f772` | |
| A-WR-07 | fixed | `b594b0e` + B `8649197` | Round 2 `a0b05e9` repairs the test the two halves collided on |
| A-WR-08 | fixed | `b292703` + B `b67494a` | |
| A-WR-09 | fixed (confirmed by danlo 2026-09-25) | `5fd9585` + round 2 `e7d8e6b` | Round 2 F3: the pricing rule now lives only in the meter |
| A-WR-10 | fixed (confirmed by danlo 2026-09-25) | `7c258be` + B `a191529` | |
| A-WR-11 | fixed (confirmed by danlo 2026-09-25) | `a202e2f` | |
| A-WR-12 | fixed | `e6729c6` | |
| A-WR-13 | fixed | `3cebe31` | |
| B-WR-01 | fixed | `ae6c1a2` | |
| B-WR-02 | **partial** | `8da5d37` | Parent overlap is read from this run only. **The dense-core rule needs a decision** (tune at D-04). |
| B-WR-03 | fixed | `45bd720` | |
| B-WR-04 | fixed | `a191529`, `e342bb1` | |
| B-WR-05 | fixed | enabler `e342bb1` + round 2 `076d725` | Round 2 F2 |
| B-WR-06 | fixed | `e222c0e` | Round 2 F6 (`dd291dd`) fixes the operator copy it made stale |
| B-WR-07 | fixed | `2ac9a88` | |
| B-WR-08 | fixed | `ff6d69a` | |
| B-WR-09 | fixed | `753700a` | |
| B-WR-10 | fixed | `8f30e73` | |
| C-WR-01 | fixed | `d088918` | The >2 km warning is a separate decision (C-IN-01) |
| C-WR-02 | fixed | `7d85b46` | |
| C-WR-03 | **partial** | `9af3296` | Dead `try/catch` removed. **Keep-last-good needs a structural decision.** |
| C-WR-04 | fixed | `80500fb` | |
| C-WR-05 | fixed (copy) | `6f58606` | The honest copy shipped. **Exempting the hold from the cap is a decision.** |
| C-WR-06 | fixed | `fc17284` | |
| C-WR-07 | fixed | `d76ecd5` | |
| C-WR-08 | fixed | `62ca1f5` | |
| C-WR-09 | fixed | `1072381` | |
| C-WR-10 | fixed | `757787e` + round 2 `96c20f4`, `0f56295` | Iteration 1 left it partial; round 2 changed the rule itself (0031) |
| C-WR-11 | fixed | `427f351` | |
| C-WR-12 | fixed | `39c120a` | |
| C-WR-13 | fixed | `1814900` | |

### Info (23): out of fix scope, touched only where a fix reached them

- **A-IN-03, 3 of 4 closed.** `service_role` EXECUTE:
  - removed from `plan_run_searches` and `mark_run_search` (0030) and `places_transient_stats`
    (0031);
  - `release_reservation` still has it. Deferred; one revoke.
- **B-IN-01, deferred.** The accented-city SAB miss needs a folded-city column.
- **B-IN-07, a decision.** It is the same decision as C-WR-05's other option.
- **C-IN-01, needs danlo.** The chip wording, and the >2 km warning.
- The other 19 Info findings were not in scope and are unchanged. Each is still described in its
  part file.

## Round 2: the cross-slice follow-ups (this session, on the merged branch)

Each item was test-first:
- a new test was seen red **by name** before the fix, or
- a mutation was applied, seen red by name, and reverted.

Refusals were proven through `actAs` or a mocked `withOrg` that sets the Clerk claims and
`set local role authenticated`.

### F4: audit triggers pinned by name. Commit `0348e42`.

**Why the count changed.** 0030 (A-WR-05) dropped `place_attachments_event_upd` and re-created
it on the new `app.log_place_attachment_event`. Fixer B's copy of the test filtered on
`log_event` only, so it saw 7 rows. The trigger had changed function; it had not gone. Fixer
A's `AUDIT_FUNCTIONS` list, merged later, already brought the count back to 8.

**The gap left.** Neither the count nor the table set could see the reverse: re-creating the
trigger on `app.log_event` would copy score/features into `events` forever.

**The fix.** The test now asserts the exact `table/trigger/function` set of all 8 triggers.

**Tests:**
- Renamed test: "every state-bearing table has its audit trigger, pinned by table, trigger and
  function".
- Mutation (inside the transaction: the trigger re-created on `app.log_event`): **red**. The
  pre-fix test stayed **green** under the same mutation.

### F2 (B-WR-05): a change check's ceiling comes from its stored leaves. Commit `076d725`.

`queueRun` now does this for a `change_check`:
1. Plans the roots with the workflow's `planRootSearches`.
2. Reads `storedLeaves(tx, roots)` in the admission transaction.
3. Writes `ceiling_requests = ceil(RUN_CEILING_MULTIPLIER × leaves × MAX_PAGES)`.

Other run kinds keep `ceil(2 × requestsHi)`.

**Test:** db "a change check's ceiling is sized from the stored leaves it will list". It was red
first: expected 36, received 108. With the plumber root stored split into 4 leaves, it expects
54 (9 leaves), a number only the stored-leaves read produces.

### F3 (A-WR-09): the reclaim settles through the meter. Commit `e7d8e6b`.

`closeAbandonedRun` now calls `settleInFlightInTx` (`src/lib/places/meter.ts`) for each search
with an in-flight cursor, in a savepoint, then stamps `cost_micro_usd` from the ledger. The
restated rule (`readUnitsUsedThisPeriod` → `freeRemaining` → `priceRequests` plus its own
`settle_reservation` call) is gone, and `queue-run.ts` no longer imports the price book.

**Tests:**
- unit "no module but the meter settles a Places charge": an equality over `src/` call sites.
  Red by name on the pre-fix `queue-run.ts`.
- db "an abandoned in-flight attempt past the free allowance is charged the page price" (new).
  The A-WR-09 setup moved into `seedAbandonedInflight`.
- Mutations in the meter's `settleAttempt`, each reverted. Before F3, neither mutation could
  reach the reclaim:
  - allowance ignored → "an abandoned run is costed from the ledger and its in-flight attempt is
    charged" **red**;
  - always free → the new past-allowance test **red**.

### C-WR-10: the purge-rule trio. Commit `96c20f4`, plus copy grammar in `0f56295`.

**SQL: `drizzle/0031_places_transient_oldest_expired.sql`.** A custom migration, re-runnable.
- It chose a new 0031 rather than folding into 0030.
- `app.places_transient_stats()` gains `oldest_expired_ms`: the epoch-ms text of `min(expires_at)`
  over expired rows, or null when none are expired.
- The function is **dropped and re-created**, because a new OUT column cannot be added with
  `create or replace`. `set search_path = public, pg_temp`.
- EXECUTE is revoked from `public, anon, service_role` by name and granted to `authenticated`.
- The 0031 snapshot equals 0030's, and `db.ts generate` reports "No schema changes".
- Applied to the **local test DB only**. Journal 31 → **32**; the last `created_at` is
  1790259821742.

**TypeScript.**
- `TransientStats.oldestExpiredMs` is new.
- `purgeOverdue` is true when any of these holds:
  - a row has been expired for more than 36 h;
  - the last purge is more than 36 h old;
  - the purge never ran and a coordinate exists: one held for more than 36 h, or any expired one
    (it was observed 30 days ago).
- Rows that expired since an on-time purge are normal and no longer warn.

**Mapping.** `readTransientStats` maps `oldest_expired_ms`.

**Card.**
- The on-time-purge cause is now `stuck`: an on-time purge left a row that expired more than
  36 h ago. It uses `SOURCES_TRANSIENT_PURGE_STUCK`.
- The old `SOURCES_TRANSIENT_PURGE_AWAITING` ("the next daily purge removes them") is gone.
  That state no longer warns at all.

**Legal doc.** `docs/legal/places-persistence.md` gains one sentence: the stats return this one
instant, which is Siteless's own retention clock, not Google content.

**Tests, each red by name first:**
- db:
  - "transient stats count only what the org holds"
  - "transient stats never report an expired coordinate as held"
  - "places_transient_stats is executable by authenticated only, search_path pinned" (before
    0031, `service_role` could execute it)
  - "transient stats are read in the sources page's one transaction"
- unit:
  - "purge overdue when a row has been expired for more than 36 hours"
  - "not overdue when rows expired since an on-time purge"
  - "the overdue sentence follows its cause and never contradicts itself (C-WR-10)"
  - "the stuck sentence reads in the singular for one coordinate"
- Mutation on the live test DB, swapping `min` for `max(expires_at)`: the expired-coordinate
  test went **red**. The function was restored by re-applying 0031, and I confirmed from
  `pg_get_functiondef` that `min(pc.expires_at)` is back.

### The tie refusal names the other business. Commit `d5282fc`.

`decideListing` runs a confirm inside a savepoint. On 55000, in the same transaction and under
RLS, it reads whether this listing is still a pending **tie** whose other side (same place,
`tie_business_id`) is attached/confirmed. If it is, the outcome is `tie_taken` with that
business's spine `display_name`, and the action returns:
- `conflict`
- `REVIEW_GOOGLE_TIE_TAKEN(other)`
- `{ reason: 'tie_confirmed_elsewhere' }`

Any other 55000 still returns `already_decided`. The bar already renders a conflict's own
message with only "Reload the queue".

**Tests:**
- db "confirming a tie the other business already holds says which business has it". It was red
  first: the generic message came back. It also asserts that nothing moved.
- The unit test "confirming a tie side whose other side a human already confirmed offers only a
  reload (0030)" now pins the tie sentence.
- Mutation: `tie_confirmed_elsewhere` treated as retryable → **red**.

### F6: a rejected Places request names its likely causes. Commit `dd291dd`.

`RUN_FAILED_ERROR.places_request_rejected` was "Google rejected a request as malformed (HTTP
400)". It now names what an operator can fix. No reason key changed.

**Test:** unit "a rejected request names its likely causes", red first.

### F5: the e2e seed address. Commit `6026297`.

`tests/e2e/runs.spec.ts:158` is now `'McAllen, TX 78501'`. Checked with typecheck and
`playwright test --list` only (5 tests listed). Nothing ran against any target.

### F1: persist the page token. NOT implemented.

The item is recorded in `deferred-items.md` (`e2d2b45`) as needing a D-01 check: an opaque
Google page cursor is Google content. The in-step retry is noted as the current mitigation. The
same commit records the open decisions below.

### Merge collision found by the gate. Commit `a0b05e9`.

At the merged head, the full DB lane was red, 1 of 404. The failing test was fixer A's "record_places_page refuses an
essentials page on an enterprise search". It built its record through `toPageRecord`, which
fixer B's `8649197` made refuse any non-Enterprise sku, so the test died in TypeScript
before it reached SQL.

The test now builds a valid `page()` and overrides `sku` past `toPageRecord`, the file's
documented pattern. It once again pins 22023 "an enterprise search records ts_enterprise
pages only".

## Needs decision (danlo)

1. **D-01 re-acknowledgement.** From A-WR-05, and it now includes round 2.
   - `docs/legal/places-persistence.md` changed after the D-01 row (which cites it as of
     `5a74bba`):
     - `events` is listed as an indefinite `place_id` sink;
     - the audit no longer copies score/features;
     - the features CHECK is narrower;
     - **round 2** adds the `oldest_expired_ms` sentence.
   - None of these widens what is stored.
2. **F1: may an opaque Google page cursor be stored for the life of a run?** This is D-01, and
   it closes B-CR-02's residual.
3. **B-WR-02: the novelty rule for dense cores.** Options (a) SAB-only overlap, (b) location
   outside the child, or (c) sibling comparison. Tune at D-04.
4. **C-WR-03: keep-last-good on a failed live refresh.** Either (a) a client boundary plus a
   child server read, or (b) a route-handler probe per tick.
5. **C-WR-05 / B-IN-07: the free check's 1 µUSD hold.** Should `reserve_budget` exempt it from
   the cap comparison?
6. **C-IN-01 / C-WR-01: the chip wording, and the >2 km warning.** The warning would need a new
   persisted `beyondLastTier` flag, which changes the D-01 list.
7. **"Requires human verification" semantics.** The six choices listed above: A-WR-01, 03, 04,
   09, 10 and 11.

Deferred, with no decision needed until a later phase: the accented-city SAB miss (a folded-city
column) and the last `service_role` revoke (`release_reservation`). Both are in
`deferred-items.md`.

## Copy added or changed in round 2 (all in `src/lib/ui/copy.ts`), for danlo's review

- **`SOURCES_TRANSIENT_PURGE_STUCK(date, hours, count, expiredHours)`**, new. It replaces
  `SOURCES_TRANSIENT_PURGE_AWAITING`, which is removed.
  - Several coordinates: "{n} coordinates are past 30 days and still on disk. The oldest expired
    {E} hours ago, but the daily purge last ran {date} ({h} hours ago) and didn't remove it. The
    database already refuses to read them. Run the purge by hand at the desk, and check the
    Vercel cron log for the purge job."
  - One coordinate: "1 coordinate is past 30 days and still on disk. It expired {E} hours ago, …
    The database already refuses to read it. …"
- **`REVIEW_GOOGLE_TIE_TAKEN(other)`**, new: "This listing was already confirmed for "{other}",
  so it can't also be this business's. Reload the queue to see what's next."
- **`RUN_FAILED_ERROR.places_request_rejected`**, changed.
  - It was: "Google rejected a request as malformed (HTTP 400)".
  - It is now: "Google refused a request — usually the API key is wrong or restricted, the
    Places API (New) isn't enabled on the key's Google Cloud project, or billing is off for that
    project".
  - It renders inside `RUN_FAILED` as "The run failed after 1 request: Google refused a request
    — … for that project. Every request that left was reserved and ledgered first, …".
  - The short `STOPPED_REASON.places_request_rejected` ("Google rejected a request, so the run
    stopped.") is unchanged.

## Production apply notes (NOT applied: no `db:migrate:prod` was run)

**0030: fixer A's notes still hold** (04-REVIEW-FIX-partA.md, "Production apply notes for 0030").
Re-checked against the merged tree:
- The file is unchanged since fixer A's commit.
- Pre-flight reads 1–6 still apply as written. Read 1 expects **30** rows ending `0029`.
- Its function list, the constraint re-validation and the "no data row changes" claim are
  unaffected by round 2.

One addition: 0030 and 0031 would now apply **together**. drizzle's migrator runs all pending
migrations in one transaction (`drizzle-orm/pg-core/dialect.js` `migrate` →
`session.transaction`), so the journal goes **30 → 32** in one step, or not at all.

**0031, pre-flight (read-only, before the apply):**
1. `select count(*), max(created_at) from drizzle.__drizzle_migrations`. Expect 30 (0029), or
   31 if 0030 was applied separately. Match on the tag, not the version.
2. `select count(*) from pg_depend d where d.refobjid = 'app.places_transient_stats()'::regprocedure and d.deptype = 'n'`.
   **Expect 0.** Nothing may depend on the function, because it is dropped. It is 0 locally.
3. `select has_function_privilege('service_role', 'app.places_transient_stats()', 'EXECUTE')`.
   Informational: expected true today. After the apply it is false. The app holds no
   `service_role` credential (legal doc §1.3). Confirm that no Supabase-side job calls it.

**What 0031 changes:**
- **No data row is touched.**
- One function is dropped and re-created with the same body plus one aggregate column. Its
  grants are re-issued, and `service_role` is newly revoked.

**Order:** apply 0031 **before** deploying this code.
- New code selects `oldest_expired_ms`. Against the old function, `/sources`' transient card
  would show its own load-failure state (the read is in a savepoint), and the ledger would
  still render.
- Old code selects its six columns by name, so it keeps working after the apply.

## Final gate (branch `gsd/phase-04-places-transient-verifier`)

See the orchestrator return for the final-HEAD gate. The same gate ran at `a0b05e9`, before the
copy-grammar commit and this report:
- `tsc --noEmit`: exit 0
- `eslint . --ignore-pattern ".claude/**"`: exit 0, no output
- unit lane: 84 files, 670 tests
- DB lane (`--pool=forks`): 42 files, 404 tests. It was 1 red before `a0b05e9`.
- workflow lane: 3 files, 22 tests
- `next build`: exit 0, "workflows build complete (9 steps, 1 workflow)"
- unit lane after the build: 84 files, 670 tests

---

_Consolidated: 2026-09-24_
_Fixer: Claude (gsd-code-fixer), round 2_
_Iteration: 2_
