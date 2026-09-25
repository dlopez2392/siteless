---
phase: 04-places-transient-verifier
slice: A (database + server) — plus the SQL halves of B-CR-03 and B-WR-03
fixed_at: 2026-09-24
review_path: .planning/phases/04-places-transient-verifier/04-REVIEW-partA.md (+ 04-REVIEW-partB.md B-CR-03, B-WR-03)
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
needs_decision: 1
status: all_fixed
base: ee4bfba
migration: drizzle/0030_places_review_fixes.sql (custom, re-runnable)
journal_before: 30
journal_after: 31
---

# Phase 4: Code Review Fix Report (slice A)

**Fixed at:** 2026-09-24
**Base:** `ee4bfba` (docs(04): code review)
**Source review:** `04-REVIEW-partA.md` (A-WR-01 … A-WR-13) and the SQL halves of
`04-REVIEW-partB.md` B-CR-03 and B-WR-03.
**Iteration:** 1

**Summary:**

- Findings in scope: 15 (A-WR-01 … A-WR-13, B-CR-03 SQL half, B-WR-03 SQL half = A-WR-02)
- Fixed: 15, in 13 commits (A-WR-02 carries B-WR-03; A-WR-11 carries B-CR-03)
- Skipped: 0
- Needs decision: 1 — **D-01 must be re-acknowledged** (A-WR-05 changed the legal list; see
  below)

Every fix followed test-first: each named test was run and seen **red by name** before the
fix, then green after. Where the first red could not tell a partial fix from a full one, a
further mutation was applied, run red by name, and reverted (noted per finding). Refusals are
proven through `actAs` (the `authenticated` role with Clerk claims), one refusal per rolled-back
transaction, with the SQLSTATE and message pinned. The one exception is the A-WR-08 race test,
which has to commit. It uses `tests/db/_concurrency.ts` (its dedicated org, the `2099-01-01`
period and cleanup in `finally`), and its two connections are tenants
(`set role authenticated` with claims).

**Migration.** Every SQL change is in ONE new custom migration,
`drizzle/0030_places_review_fixes.sql`, made with `scripts/db.ts custom`. The 0030 snapshot
equals 0029's, and `db.ts generate` reports "No schema changes". The file is **re-runnable by
design**: it uses only `create or replace`, `drop … if exists` followed by a create, and
revoke/grant statements. Each section was applied by hand to the local test database while it
was written, then the migration was applied the normal way:
`npx tsx scripts/db.ts migrate --target=test`. **Journal 30 → 31** (`__drizzle_migrations`:
30 rows before, 31 after, last `created_at` 1790254191529). Production was not touched:
`db:migrate:prod` was not run, and the local database was never reset.

Every definer this migration re-issues follows the same rules:

- `set search_path = public, pg_temp`. `settle_reservation` gains `pg_temp` here; 0019 had
  `public` only.
- The org comes from `app.current_org_id()`, and every caller-supplied uuid is re-read under
  that org.
- `if not found` is checked after every `select … into`.
- EXECUTE is revoked from `public, anon, service_role` **by name** and re-granted to
  `authenticated`. The audit trigger function is revoked from every role, `authenticated`
  included.

A catalog test, "every definer 0030 re-issues is executable by authenticated only, search_path
pinned", pins all of this. It was shown red under two mutations, then reverted: a
`service_role` grant on `settle_reservation`, and `mark_run_search` with `search_path = public`.
This also closes **A-IN-03** for `plan_run_searches` and `mark_run_search`.

## Fixed Issues

### A-WR-13: The purge test asserted over every org in the shared database

**Files modified:** `tests/db/places-definers.test.ts`
**Commit:** `3cebe31`
**Applied fix:** The test now seeds a bystander org with an expired coordinate inside its
rolled-back transaction. The old "every other org purged 0" loop went red on that org: expected
0, received 1. The loop is gone. The test now asserts `a`, `b` and the bystander by id, plus the
one-row-per-org count.

### A-WR-06: `places_features_ok` still admitted `nameSim` / `distanceM`

**Files modified:** `drizzle/0030_places_review_fixes.sql` §1 (+ journal, 0030 snapshot),
`tests/db/places-writer.test.ts`, `docs/legal/places-persistence.md`,
`src/db/schema/place-attachments.ts`
**Commit:** `237f772`
**Applied fix:**

- The allow-list is now exactly the 11 `FEATURE_KEYS`. I checked the list against
  `src/lib/places/page-record.ts`.
- Points keys (`name`, `phone`, `address`, `distance`, `cluster`) must be integers. They may be
  negative: `CLUSTER_DIFFERENT = -10`.
- `pa_features_numeric` is dropped and re-added, so every existing row is checked again.
- The legal doc's "TypeScript-only" note is replaced with a statement that the table now
  enforces the line.

Named tests, each red first: "features carrying nameSim is 23514", "features carrying distanceM
is 23514", "a non-integer point value is 23514". All three go through the writer as the user.

### A-WR-07: `record_places_page` accepted an Essentials page on an Enterprise search

**Files modified:** `drizzle/0030…` §2, `tests/db/places-writer.test.ts`
**Commit:** `b594b0e`
**Applied fix:** `record_places_page` is re-issued from the 0029 body. Any SKU other than
`ts_enterprise` is now refused with 22023 "an enterprise search records ts_enterprise pages
only". Named test, red first: "record_places_page refuses an essentials page on an enterprise
search".

### A-WR-01: The attachment upsert downgraded an auto-attached listing

**Files modified:** `drizzle/0030…` §2, `tests/db/places-writer.test.ts`
**Commit:** `8cb40e0`
**Status:** fixed: requires human verification (this is a semantics choice)
**Applied fix:**

- When the stored row is `attached` and the new match is not, the stored `status`, `reason`,
  `score`, `features` and `tie_business_id` are kept, and only `last_seen_run_id` moves.
- In every other case the new match is written as one unit. So a tentative row followed by
  another tentative row still means the latest write wins, and the five columns never disagree
  with each other.
- Rejected and confirmed rows stay sticky (M40).

The review proposed `greatest(score)` per column. I did not use it, because it can leave a
tentative/score row at 97, which breaks the ≥95 ⇔ attached banding.

Named tests: "the same place seen by two cluster searches ends attached (attached first)" was
red first; the "(tentative first)" variant is the control. Both also assert that the signal row
exists and that no attached→tentative event was written.

### A-WR-03: Tie pairs were never resolved as a pair

**Files modified:** `drizzle/0030…` §2 and §3, `tests/db/places-writer.test.ts`
**Commit:** `8a50d12`
**Status:** fixed: requires human verification (this is a decision-flow choice)
**Applied fix:** `decide_place_attachment` is re-issued. It locks the row (`for update`). When
it confirms a **tentative tie**, it finds the other side: the row for the same `place_id` and
the business `tie_business_id` names, re-read under the org and locked. What happens next
depends on that other side:

- **Tentative, or auto-attached (reason `score` or `tie`):** it is rejected in the same call
  (`rejected/rejected`, same `decided_by`). The auto-attached case is part 2 of the finding: a
  later run rewrote the other side to attached/score.
- **A human already confirmed it:** the confirm is refused with 55000 "already decided". The
  tie was decided the other way.
- **Already rejected, or missing:** it is left alone.

The function's return value is unchanged: it returns the one decided row. `reject` and `detach`
are also unchanged. In `record_places_page`:

- a tie must be tentative, 22023 "a tie is always tentative";
- a tie must carry `tieBusinessId`, and only a tie may: 22023 "a tie names its other business,
  and only a tie does".

Named tests, all five red first:

- "a tie cannot be recorded as attached"
- "a tie must name its other business, and only a tie may"
- "confirming one side of a tie rejects the other side"
- "confirming a tie rejects an other side a later run auto-attached"
- "confirming a tie whose other side a human confirmed is refused"

### A-WR-02 / B-WR-03 (SQL half): A saturated change check marked members `gone`

**Files modified:** `drizzle/0030…` §4, `tests/db/places-writer.test.ts`
**Commit:** `14a11e4`
**Applied fix:** `record_change_check` is re-issued. It now **refuses** gone ids when the
verdict is `saturated`, with 22023 "a saturated listing cannot prove a member gone". It does not
silently drop them. This follows the 0019 rule, "checked rather than quietly ignored". Named
test, red first: "a saturated change check cannot mark a member gone". Positive control: "a
saturated change check records added ids and marks nothing gone". **This ships together with
fixer B's `diffTile` change (see follow-up 1).**

### A-WR-04: A merge stranded the loser's attached listings

**Files modified:** `drizzle/0030…` §5, `tests/db/places-schema.test.ts`
**Commit:** `71f71d7`
**Status:** fixed: requires human verification (the verdict input changes for merged businesses)
**Applied fix:** `business_place_signal` is recreated (`create or replace view`) with the same
columns and still `security_invoker`. It joins `businesses` and groups by
`coalesce(b.merged_into_id, b.id)`. The merge definers keep `merged_into_id` pointing at a live
root (0024 L29–30), so one hop is enough. An unmerge restores the old grouping with no data
moved. Named test, red first: "a merged business's attached listing counts toward its
survivor's signal". **`readGoogleCheck`'s listings and history are fixer C's (see follow-up 6).**

### A-WR-05: The `events` audit copied `place_id`, `score` and `features` forever, and the D-01 list omitted it

**Files modified:** `drizzle/0030…` §6, `tests/db/places-writer.test.ts`,
`tests/db/event-trigger.test.ts`, `docs/legal/places-persistence.md`,
`src/db/schema/place-attachments.ts`
**Commit:** `9ca26c8`
**Applied fix:**

- **New audit function.** `app.log_place_attachment_event()` is a definer with
  `search_path = public, pg_temp`, and EXECUTE is revoked from every role by name. It writes one
  `events` row per status change. Its `before`/`after` payload is an allow-list:
  - ids: `id`, `org_id`, `business_id`, `place_id`, `last_seen_run_id`;
  - state: `status`, `reason`, `tie_business_id`;
  - who decided: `decided_by`, `decided_at`.

  It never copies `score` or `features`. The actor resolution is the same as `app.log_event`.

- **Same trigger.** `place_attachments_event_upd` is dropped and recreated with the same name and
  the same `WHEN old.status is distinct from new.status`. `events` stays append-only.
- **Legal doc.** `events` is now listed honestly as a place_id sink with **indefinite** retention:
  - §1 intro;
  - the §1.9 summary row;
  - a new §1.10 describing the sink;
  - §3 (it is not transient);
  - a new bullet in §6 Q5.

  A "Changes AFTER the decision" block at the top states that the D-01 row cites the doc **as of
  `5a74bba`**.

- **Tests.** Named test, red first: "a listing event carries ids and status only, never score or
  features". It pins the exact key set. The trigger enumeration in `event-trigger.test.ts` now
  names both audit functions. That test went red on the swap and I updated it: still 7 tables
  and 8 triggers.

### A-WR-11 / B-CR-03 (SQL half): `plan_run_searches` never refreshed geometry

**Files modified:** `drizzle/0030…` §7, `tests/db/places-definers.test.ts`
**Commit:** `a202e2f`
**Status:** fixed: requires human verification (I chose to refresh, not refuse)
**Applied fix:** On conflict, the tile upsert now writes the incoming `south/west/north/east`,
`depth`, `quad_path`, `unit_kind`, `unit_id` and `places_type`. Membership is kept as history,
so the first check after a move reports the churn once and flags the tile changed. I did not
take the review's alternative (refuse with 22023 on a mismatch): it leaves an operator no path
except hand-deleting tiles. The key half of B-CR-03 is fixer B's: the centre goes into the
radius unit id. Named test, red first: "plan_run_searches refreshes a tile's stored rectangle".

### A-WR-10 / B-WR-04 (SQL half): `mark_run_search` never retired descendant tiles

**Files modified:** `drizzle/0030…` §8, `tests/db/places-definers.test.ts`
**Commit:** `7c258be`
**Status:** fixed: requires human verification
**Applied fix:** When an **enterprise** search closes `done` with `subdivided = false`, every
stored descendant of its tile is set `is_leaf = false` in the same call. A descendant here means
the same org, `unit_kind`, `unit_id` and `places_type`, with a `quad_path` that strictly extends
this one. Change checks (`ids_only`) retire nothing. Named tests:

- "a search that closes unsubdivided retires its tile's stale descendants" — red first. It is
  scoped against a tile of another type and against another org.
- "a search that closes subdivided leaves its descendants alone" — covers the in-run order and a
  replayed parent close.

Stale leaves already stored are **not** retired retroactively; that happens on their root's
next close (see follow-up 5).

### A-WR-08: `settle_reservation` read the hold without a lock

**Files modified:** `drizzle/0030…` §9, `tests/db/budget-concurrency.test.ts`,
`tests/db/places-definers.test.ts`
**Commit:** `b292703`
**Applied fix:** `settle_reservation` is re-issued from the 0019 body. The tenancy, sku and
provider read stays unlocked, so a foreign caller can never lock another org's row. After those
checks, it re-reads `settled_at` and `released_at` **`for update of r`** on the row where
`r.org_id = v_org`. `search_path` gains `pg_temp`.

Named test: "a settle racing a release of the same hold counts the hold once". It commits, over
two tenant connections:

1. The release holds the row lock in an open transaction.
2. The settle starts, and the test waits until `pg_stat_activity` shows it waiting on a `Lock`.
3. Only then does the release commit.

It was red before the fix with the exact symptom: `spent 0`, expected `25`. The review also
suggested a longer TTL for page holds; that is `meter.ts` (follow-up 4).

### A-WR-09: The stale-run reclaim left `cost_micro_usd` unset and in-flight charges unledgered

**Files modified:** `src/server/actions/queue-run.ts`, `tests/db/queue-run.test.ts`
**Commit:** `5fd9585`
**Status:** fixed: requires human verification (the settle is pessimistic: charged)
**Applied fix:** The abandoned `UPDATE … returning id` now feeds `closeAbandonedRun(tx, runId)`.
For each search that still has an in-flight cursor, it:

1. settles an unsettled reservation **as charged**, under the attempt's own request id. The
   price is computed in the reservation's own period against the free allowance
   (`readUnitsUsedThisPeriod` → `freeRemaining` → `priceRequests`), which is `settleInFlight`'s
   rule;
2. clears the cursor through `mark_run_search`.

Each search is handled inside a savepoint. A refusal leaves that cursor in place and does not
block every later admission of the org. The function then stamps `runs.cost_micro_usd` from
the ledger.

Named test: "an abandoned run is costed from the ledger and its in-flight attempt is charged".
It was red first (cost 0). It went red again under a mutation that skipped the settle: the
ledger row was missing.

### A-WR-12: The recorder's crash path cleared the in-flight cursor without settling it

**Files modified:** `scripts/lib/record-pages.ts`, `tests/db/places-recorder.test.ts`
**Commit:** `e6729c6`
**Applied fix:** `closeRecordingRun` now calls `settleInFlight({ clerkOrgId, runId },
searchId)` first, and its own `mark_run_search` payload names `status` only. If the settle
throws, the function throws before the cursor is touched, and A-WR-09's reclaim settles it
later. Named test, red first (the ledger was empty): "a crashed recording settles its in-flight
attempt before it closes".

## Needs decision

- **D-01 re-acknowledgement.** PROJECT.md's D-01 row covers
  `docs/legal/places-persistence.md` **as of `5a74bba`**. A-WR-05 changes that list:
  - `events` now appears as an **indefinite, undeletable `place_id` sink** (§1.10, §1.9, §6 Q5);
  - the audit no longer copies `score` or `features`;
  - the `features` CHECK is narrower (A-WR-06).

  None of this widens what is stored. It corrects the list and narrows the audit. But the call
  was made against a list that omitted a sink, so danlo needs to re-acknowledge the revised
  document (the orchestrator will ask). Until he does, the D-01 row should not be read as
  covering this revision.

## Cross-slice follow-ups (not mine to change; exact change needed)

1. **Fixer B — `src/lib/places/change-detect.ts` `diffTile`: REQUIRED to ship with 0030.**
   - When the listing is saturated (`seen.length >= IDS_ONLY_SATURATION`), return `gone: []`,
     with or without a baseline.
   - Without this change, `record_change_check` answers 22023 for every saturated check whose
     stored members fall past the cap.
   - B-CR-02 / B-WR-07's mapping of SQLSTATE class 22 to `FatalError` decides whether that error
     is retried or fatal.
2. **Fixer B — `src/lib/estimate/expand-cells.ts`:** the radius unit id carries the rounded
   centre (B-CR-03 key half). 0030 only refreshes geometry, so until the key changes, two
   colliding presets make the rectangle flap between them.
3. **Fixer B — `src/lib/places/page-record.ts`:**
   - The header says the DB CHECK "still ADMITS both keys — a numbers-only wall, unchanged to
     avoid a migration". The `FEATURE_KEYS` doc says it is "A subset of what
     app.places_features_ok admits (13)". Both are false since 0030: the CHECK admits exactly
     these 11 keys, with integer points.
   - `PageRecord['sku']` and `toPageRecord` can narrow to `'ts_enterprise'`, because the writer
     now refuses `ts_essentials` (A-WR-07).
4. **Fixer B — `src/lib/places/meter.ts`:**
   - A-WR-08's second suggestion: pass a `p_ttl` longer than any single step's lifetime to
     `app.reserve_budget` for page holds.
   - Optional: export an in-transaction `settleInFlightInTx(tx, runId, searchId)`. queue-run's
     `closeAbandonedRun` could then call it instead of repeating the pricing rule, which is now
     written twice. That module is the only place allowed to mint `ReservedCall`, so queue-run
     settles through SQL directly.
5. **Fixer B — `src/workflows/places-sweep/steps.ts` `storedLeaves`:** as B-WR-04 suggests, drop
   any leaf whose ancestor is itself a leaf. This protects against stale trees already stored,
   which 0030 retires only on their root's next close.
6. **Fixer C — `src/server/queries/businesses.ts` `readGoogleCheck`:**
   - The signal row now resolves through the view (A-WR-04), but `listings` and `history` are
     still keyed on the raw `business_id`.
   - Change both to `a.business_id in (select id from businesses where id = $1 or merged_into_id
= $1)`, and the same for `po.business_id`. The survivor's Google check should list the
     loser's listing that its signal now counts.
7. **Fixer C — review queue copy:** a confirmed tie now rejects its other side, so that side
   leaves `/review`. Nothing in `readTopListing` needs to change for correctness, but any copy
   that promises "the other listing stays for review" would be wrong.
8. **Orchestrator — `.planning/PROJECT.md` D-01 row:** see "Needs decision".

## Gates (branch `worktree-agent-a0d1e1bdd60f86642` @ `e6729c6`, re-read after the gates)

- `npx tsc --noEmit` — exit 0
- `npx eslint . --ignore-pattern ".claude/**"` — exit 0, no output
- Full DB lane (`vitest.db.config.ts --pool=forks`) — **42 files / 397 tests passed**, exit 0.
  That is 375 at baseline plus 22 new.
- Unit lane (`vitest run tests/unit`) — **83 files / 628 tests passed**, exit 0. This includes
  `pg17-compat` over 0030.
- Baseline before any fix (`ee4bfba`): DB lane 42 files / 375 tests passed.
- The workflow lane is not in this slice's gate list and was not run. Fixer B owns it.

The local DB is shared with fixer B, who does not migrate. From my first apply onward, the local
database held my 0030 functions, so any of fixer B's DB-lane runs that overlapped saw the new
`record_change_check` / `record_places_page` walls. Any red on their side that names one of those
22023 messages is this migration, not their change.

## Production apply notes for 0030 (NOT applied — no `db:migrate:prod` was run)

**Pre-flight reads (read-only, in a `begin read only` transaction, BEFORE apply):**

1. `select count(*) from drizzle.__drizzle_migrations` → expect **30**, with the last
   `created_at = 1790195198325` (0029). Match on the tag or name, not on the version.
2. `select count(*) from place_attachments` → expect **0**. If it is not 0, run
   `select count(*) from place_attachments where features ?| array['nameSim','distanceM'] or
exists (select 1 from jsonb_each(features) e where e.key in
('name','phone','address','distance','cluster') and (jsonb_typeof(e.value) <> 'number' or
(e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)))`. It **must be 0**: the
   re-added `pa_features_numeric` validates every row, and one bad row aborts the whole
   migration.
3. `select count(*) from events where entity_type = 'place_attachments'` → expect **0**. Existing
   rows are NOT rewritten; any that exist hold `score` and `features` permanently, and that must
   be reported to danlo alongside D-01.
4. `select count(*) from place_attachments a join businesses b on b.id = a.business_id where
a.status = 'attached' and b.merged_into_id is not null` → informational. These rows move to
   their survivor in `business_place_signal` on apply.
5. `select count(*) from place_tiles` → informational. Stale descendant leaves are not
   retro-fixed; they are retired on their root's next enterprise close.
6. `select count(*) from cost_reservations where settled_at is null and released_at is null` →
   informational. Replacing `settle_reservation` is safe with open holds; no row changes.

**What 0030 changes on existing rows:** **no data row is inserted, updated or deleted.**

- `pa_features_numeric` is dropped and re-added. That re-validates every `place_attachments`
  row and briefly takes an ACCESS EXCLUSIVE lock on that table.
- These functions are replaced:
  - `app.places_features_ok`
  - `app.record_places_page`
  - `app.decide_place_attachment`
  - `app.record_change_check`
  - `app.plan_run_searches`
  - `app.mark_run_search`
  - `app.settle_reservation`
- `app.log_place_attachment_event` is added.
- The trigger `place_attachments_event_upd` is dropped and recreated on the new function.
- The view `business_place_signal` is replaced, with the same columns. Its results change only
  for merged businesses.
- `service_role` loses EXECUTE on the seven definers above and on `places_features_ok`. The app
  holds no `service_role` credential (legal doc §1.3), so nothing calls them that way. Check
  anyway that no Supabase-side job does.
- Existing `events` rows and existing tile leaves are left as they are.

Apply the migration through the normal path, and only after the pre-flight reads. The file is
re-runnable, so a partial manual apply does not block the normal one.

---

_Fixed: 2026-09-24_
_Fixer: Claude (gsd-code-fixer), slice A_
_Iteration: 1_
