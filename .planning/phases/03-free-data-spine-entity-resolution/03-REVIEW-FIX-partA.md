---
phase: 03-free-data-spine-entity-resolution
slice: A (fixer A of three)
fixed_at: 2026-09-23T12:31:56Z
review_path: .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partA.md
also_from: .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partB.md (B-WR-01, B-WR-04, B-WR-05 chain half)
iteration: 1
base: e9bbed58867201911ba07733b3d58583069c9e11
head: 0bd73e6
findings_in_scope: 16
fixed: 16
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report, slice A

**Fixed at:** 2026-09-23T12:31:56Z
**Source review:** `03-REVIEW-partA.md` (all Critical and Warning), plus B-WR-01, B-WR-04 and the chain-detection half of B-WR-05 from `03-REVIEW-partB.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 16 (3 Critical, 10 Warning from slice A; 3 Warning from slice B)
- Fixed: 16, with one commit per finding
- Skipped: 0

**How each fix was proven.** Every behavioural fix got a named test first, and I watched it fail by name for the reason the review gave. Then I applied the fix and did at least one mutation: revert the fix, confirm the named test goes red, restore. For source files, `git diff` was checked to confirm the restore. SQL function mutations were restored from the migration text with CRLF stripped, and the restore was confirmed by `pg_get_functiondef` md5 (record_merge `e54ca15b…`, apply_survivorship_if_changed `b71ca877…`, both identical before and after). Grant mutations were restored by re-running the migration statement and confirmed with `has_table_privilege`.

**Final gates on the head (`0bd73e6`):** `typecheck` clean. `lint` clean apart from the uncommitted scratch dir, which is now deleted. Unit tests 43 files / 306 tests green. DB tests 30 files / 222 tests green. `next build` green.

**Migration.** All DDL is in one new file, `drizzle/0025_review_fixes_spine.sql`. The journal stays linear: idx 25, `when` 1790163060762 > 0024's. Every statement can be re-run. It was applied locally with `pnpm db:migrate` (`__drizzle_migrations` id 29). **It has NOT been applied to production.** That is a later, human-gated `pnpm db:migrate:prod`. Run the post-flight checks at the end of this report after that step.

---

## Fixed Issues

### A-CR-01: A reviewer's "Same business" silently overwrites a "Different"

**Files modified:** `drizzle/0025_review_fixes_spine.sql` (+ journal, snapshot), `tests/db/merge-unmerge.test.ts`
**Commit:** 8f12de1
**Applied fix:**
- `app.record_merge` now reads the candidate `FOR UPDATE`, which is the lock `record_candidate_decision`'s UPDATE takes.
- It refuses `distinct` for both reasons (`55000 'pair was marked distinct'`) and refuses any other non-pending decision (`55000 'candidate already decided'`).
- The closing UPDATE is pending-only, with a FOUND check.
- Follow-up: `undo_merge` locks the candidate row(s) before the businesses (the same order as `record_merge`, so no 40P01). It also reads its `business_merges` row `FOR UPDATE`, which covers A-IN-07.
- There is no "reopen" path. A deliberate re-merge of a distinct pair would be a new, explicit, attributed decision, not a loophole in `record_merge`.

**Tests:**
- 'a reviewer "Same business" after a "Different" is refused, never a silent overwrite'. Red before the fix: the merge succeeded.
- 'a candidate already merged is refused by name, not re-merged'. Red before the fix: 23505.
- Mutation: restoring `and p_reason = 'auto'` turned the first test red, and only that test.

### A-CR-02: A changed source record overwrites merged businesses with single-source values

**Files modified:** `src/lib/ingest/upsert.ts`, `src/lib/resolve/rederive.ts` (new), `src/lib/resolve/merge.ts`, `scripts/ingest-comptroller.ts`, `drizzle/0025_review_fixes_spine.sql`, `tests/db/reingest-merged.test.ts` (new)
**Commit:** 939d155
**Status:** fixed: requires human verification (logic)
**Applied fix:**
- When a changed record's business is in a merge cluster (merged away, or something is merged into it), the record's own non-survivorship columns go on the business it created. Those are `name_norm`, `comptroller_key` and `primary_source`, write-gated.
- The cluster root, `coalesce(merged_into_id, id)` scoped by org, is then re-derived from every member's parents through the same `survive()` as merge (`readRootParents` + `survivorshipJson(..., { complete: true })`).
- The re-derived values are written through a new owner-only `app.apply_survivorship_if_changed`. It compares the typed row (`is distinct from`) and writes only on a real difference, so DATA-04's zero-events-on-rerun still holds.
- The Census pass (`WRITE_LOCATION`) re-derives the root for a clustered business instead of writing the point.
- `rederiveRoot` throws if the transaction's org claim is missing, rather than silently reading nothing.

**Tests:**
- 'a changed Comptroller payload on a merge winner keeps the Overture display_name': the winner is not reverted, and legal_name does take the new filing.
- 'a changed Overture payload of a merge loser updates the winner': the loser's change reaches the winner through survivorship, and the dead loser row is untouched.
- 'a changed Census answer on a merge winner keeps the Overture location'.
- 'an unchanged re-ingest of a merged pair writes no businesses event'.
- 're-deriving an unchanged cluster writes nothing'.
- The first three were red before the fix, each for the reason the review gave.
- Mutations: disabling the upsert branch turned tests 1 and 2 red. Disabling the Census branch turned test 3 red. Removing the DB write gate turned 're-deriving…' red.

### A-CR-03: `cluster_key` is never derived by survivorship

**Files modified:** `src/lib/resolve/derivation.ts` (new), `src/lib/resolve/merge.ts`, `scripts/ingest-comptroller.ts`, `scripts/ingest-overture.ts`, `tests/unit/payload-contract.test.ts`, `tests/db/_ingest-fixtures.ts`, `tests/db/_merge-fixtures.ts`, `tests/db/ingest-idempotency.test.ts`, `tests/db/merge-unmerge.test.ts`
**Commit:** f60e441
**Applied fix:**
- New `src/lib/resolve/derivation.ts` holds the inputs that are not in the payload: the seeded NAICS ranges, the org-aware `overture_category_map`, and the `cities.name_variants` fold.
- It has one derivation function per source. `comptrollerDerived` calls the permits transform's own NAICS lookup. `overtureClusterKey` handles Overture.
- `permitToIngest`, the Overture ingest and `sourceRecordView(row, ctx)` all call these functions, so ingest and survivorship derive cluster and city the same way.
- The test fixtures now derive exactly as the ingests do.

**Tests:**
- Payload-contract parity now pins cluster_key for both sources, the Comptroller street/unit/postal/city (folded) and the legal and display names. Each has a positive control, so a view that nulled the field would fail.
- DB test: 'a merge keeps the Overture-mapped cluster when the Comptroller winner has none'.
- Mutation: dropping the cluster from the view turned both contract tests and the DB test red.

### A-WR-01: `authenticated` holds DML on `businesses` / `source_records`

**Files modified:** `drizzle/0025_review_fixes_spine.sql`, `tests/db/grants-audit.test.ts`, `tests/db/rls-isolation.test.ts`, `tests/db/retention.test.ts`, `tests/db/event-trigger.test.ts`, `tests/db/texas-side.test.ts`
**Commit:** d8c2c5a
**Applied fix:**
- `revoke insert, update, delete on businesses, source_records from authenticated`.
- A grep confirmed that no code under `src/` writes either table: no raw SQL, and no drizzle `.insert/.update/.delete`.
- The Phase 1 RLS write-half proofs moved to `searches`, an org-scoped table the Clerk role really writes. The SELECT half stays on businesses.
- The retention CHECK/FK proofs and the event-trigger proofs now run on the connection that actually writes: the owner, with claims installed for the trigger's actor.

**Tests:**
- 'a Clerk user cannot write merged_into_id on its own business' and 'a Clerk user cannot insert a source record'. Both pin `42501 permission denied for table …` as a user whose org claim RLS would have let through.
- Mutation: re-granting DML turned both the behavioural test and the catalog test red.

### A-WR-02: Definers' `search_path` omits `pg_temp`

**Files modified:** `drizzle/0025_review_fixes_spine.sql`, `tests/db/grants-audit.test.ts`
**Commit:** 4da86a1
**Applied fix:**
- One DO-block sweep sets `search_path = public, pg_temp` on every SECURITY DEFINER in `app`/`public` whose config was exactly `search_path=public`. That covers all 13 older definers.
- The sweep also covers the two invoker helpers that only definers call.
- It names, rather than rewrites, any function with a different config.
- The rewritten and new functions declare `pg_temp` directly.

**Tests:**
- 'every SECURITY DEFINER function searches pg_temp last' (catalog). It was red before the fix and named 13 functions.
- Mutation: resetting `emit_event` to `search_path = public` turned it red.

### A-WR-03: Stale candidates stay in the review queue

**Files modified:** `scripts/resolve.ts`, `src/server/queries/review-queue.ts`, `tests/db/resolve-pass.test.ts`, `tests/db/review-actions.test.ts`
**Commit:** efeb8b0
**Status:** fixed: requires human verification (a product rule: a pending pair across two clusters that a `distinct` decision already spans, at any score, is now itself marked `distinct`)
**Applied fix:**
- New resolve stage 6 (`stageTidy`). It is one set-based statement over every pending pair: pairs whose roots coincide are marked `merged`, and pairs whose root clusters are already joined by a `distinct` decision are marked `distinct`. Both are attributed `etl:resolve`.
- `readReviewQueue` / `readReviewRemaining` render each side as its live root and skip a pair whose roots coincide. This covers the gap between passes.

**Tests:**
- 'a pending pair inside one cluster is marked merged, and one across a distinct ruling distinct'. An honest open pair stays pending.
- 'the queue shows live roots and skips a pair that is already one business'.
- Both were red before the fix.
- Mutations: disabling either tidy update turned the resolve test red. Reverting the root rendering, and separately dropping the same-root predicate, each turned the queue test red.

### A-WR-04: `closed_at` has two writers with different tie rules

**Files modified:** `src/lib/resolve/survivorship.ts`, `tests/unit/survivorship.test.ts`
**Commit:** abb788f
**Applied fix:**
- `survive()` picks the closure with the latest date, with ties going to the smaller id. That is exactly `CLOSURE_UPDATE_SQL`'s `order by closed_at desc, sr.id`.
- The decision is written down in the code: a closure that later vanishes from the feed keeps closing the business (it is a historical record, and D-05 says nothing is retired on absence).

**Tests:**
- 'survivorship: closed_at takes the LATEST closure date, as the closures pass does'. It was red before the fix.
- Mutation: reverting to smallest-id turned it red.

### A-WR-05: Unmerge restores the winner from a snapshot

**Files modified:** `drizzle/0025_review_fixes_spine.sql`, `src/lib/resolve/merge.ts`, `tests/db/merge-unmerge.test.ts`
**Commit:** fc4959e
**Applied fix:**
- `unmergeBusinesses` re-derives the winner with `survive()` over its remaining cluster (every member minus the loser's subtree), in complete mode.
- It passes the result as a new third argument, `app.undo_merge(uuid, jsonb, jsonb default null)`. A NULL third argument (a raw two-argument call) still restores the snapshot, and the snapshot is kept for audit.
- The two-argument function is dropped, because an overload would make two-argument calls ambiguous. Its grants are re-issued: `authenticated` yes, `public`/`anon` no.

**Tests:**
- 'unmerge keeps a closure the winner gained after the merge' (the review's exact scenario). It was red before the fix: closed_at came back null.
- The existing 'unmerge restores' test still passes, so the re-derived winner equals the pre-merge winner exactly.
- Mutation: passing NULL for the winner fields turned the new test red.

### A-WR-06: The payload-hash gate blocks re-derivation (plus the normalizer-propagation mechanism)

**Files modified:** `scripts/rederive.ts` (new), `src/lib/resolve/merge.ts` (`readParentsForRoots`), `src/lib/ingest/etl-actor.ts` (`'rederive'` actor), `package.json` (`pnpm rederive`), `docs/runbooks/ingest.md` (§7), `tests/db/rederive.test.ts` (new), `tests/db/_ingest-fixtures.ts`
**Commit:** c3e4ac8
**Applied fix:** `pnpm rederive --org=<clerk_org_id> [--target=test|prod] [--dry-run]`.
- In batches of 500, each its own transaction with `etl:rederive` and the org claim, it recomputes from the stored payloads:
  - `name_norm` from each business's creating record, merged-away rows included. Unmerge never re-derives a loser's name_norm.
  - Every cluster root's survivorship columns, through `survive()` in complete mode and `apply_survivorship_if_changed`.
- Both halves are write-gated, so an up-to-date spine writes zero rows.
- `--dry-run` rolls every batch back, so its counts are measured, not estimated.
- The run report is one `rederive` event carrying `DERIVATION_VERSION`, the counts and up to 20 sample roots.
- `DERIVATION_VERSION` lives in `derivation.ts`. Bump it when a rule changes. Runbook §7 gives the order: migrate, `rederive --dry-run`, `rederive`, then `resolve`.

**Tests:**
- 'an up-to-date spine: the pass writes no businesses row and no businesses event'.
- 'a changed derivation reaches stored rows: name_norm, cluster_key and city come back, only there'.
- 'a clustered business is re-derived through survivorship, not from its own record'.
- 'a census point for an address the permit no longer has is not restored'.
- 'a dry run measures the same writes and leaves every row and event as it was'.
- The org gate.
- Mutations: complete→false, and skipping the name_norm half, each turned 'a changed derivation…' red (the second also turned the dry-run test red). Disabling the stale-census rule turned the census test red.

**I did NOT run it against the full local spine, as instructed.** The orchestrator should run it after merging fixer B.

### A-WR-07: A Census No_Match after an address change leaves the old coordinates

**Files modified:** `scripts/ingest-comptroller.ts`, `src/lib/resolve/derivation.ts`, `src/lib/resolve/merge.ts`, `tests/db/geocode-rerun.test.ts`
**Commit:** a60e82c
**Status:** fixed: requires human verification (logic)
**Applied fix:**
- A No_Match or Tie whose stored census `payload.input` differs from the address just submitted now clears the location that record supplied. On a single business it clears only while the business still cites the record. On a cluster it re-derives the root instead.
- This is counted in the new stat `stats.location_cleared`.
- ChunkFailed never clears anything.
- `readParents` drops a census parent whose input is not the permit's current address, so no later re-derivation puts the stale point back.
- The stored input shape is built by one helper, `censusInput`.

**Tests:**
- 'a No_Match after the address moved clears the stale location; a transient one does not'. It covers the moved case, a stayed No_Match and a ChunkFailed. It was red before the fix.
- Mutation: disabling the clearing turned it red.
- The readParents half is covered by the rederive census test above.

### A-WR-08: `finishRun` updates `ingest_runs` without an org predicate

**Files modified:** `src/lib/ingest/run-report.ts`, `tests/db/ingest-idempotency.test.ts`
**Commit:** f3ab330
**Applied fix:** `where id = $1 and org_id = app.current_org_id()`.
**Tests:**
- "finishRun refuses another org's run id and leaves that run untouched". It was red before the fix: it completed the foreign run.
- Mutation: removing the predicate turned it red.

### A-WR-09: The `/businesses` list's sources column omits absorbed sources

**Files modified:** `src/server/queries/businesses.ts`, `tests/db/provenance-render.test.ts`
**Commit:** a869382
**Applied fix:**
- A materialized `members` CTE (the row plus `merged_into_id = row`, served by `businesses_merged_idx`) now feeds both halves of `srcs`.
- Measured on the real local spine (91,872 businesses) as the Clerk role under RLS: 50 rows in 174 ms. The review measured 167 ms before the change.

**Tests:**
- 'the list shows the sources a merged winner absorbed'. It also asserts the list and the detail view agree. It was red before the fix.
- Mutation: members restricted to the row itself turned it red.

### A-WR-10: Stage 5 aborts the whole resolve pass on any refusal other than 40001

**Files modified:** `scripts/resolve.ts`, `tests/db/resolve-pass.test.ts`
**Commit:** a2503ec
**Applied fix:**
- 55000 now counts as `not_pending`, and the loop continues.
- 40P01 is retried like 40001.
- A stage that throws still emits the partial run report, with `failed: {stage, error}`, and then rethrows.
- Stage 5 takes a `mergeOne` seam, because the refusals cannot be staged on one connection.

**Tests:** three named tests (55000, 40P01, partial report), each red before the fix and each killed by its own mutation.

### B-WR-01: The suite/unit is not compared by the scorer

**Files modified:** `src/lib/resolve/score.ts`, `scripts/resolve.ts`, `tests/unit/score.test.ts`, `tests/db/resolve-pass.test.ts`
**Commit:** 9770a89
**Applied fix:**
- `unitIdentity()` is used for comparison only. It drops designator words and punctuation: STE 5 = SUITE 5 = #5, STE 100-A = Suite 100A, but BLDG A STE 5 ≠ BLDG B STE 5.
- When both sides carry a unit and the units differ, the address scores number + postal (15) and is not a signal.
- A unit on one side only is not a conflict.
- `Side.unit` is optional, so the committed pair fixtures read as "unknown".
- `resolve.ts` passes each side's `unit` to the scorer.
- `normalize/address.ts` (fixer B) is untouched.

**Tests:**
- Unit test: 'two suites at one street number never produce the address signal', plus a same-unit/one-sided control.
- DB test: 'the pass scores different suites below 95 and merges nothing'.
- Mutations: dropping the comparison turned the unit test red. Not passing `unit` through `resolve.ts` turned the DB test red.

### B-WR-04: The Overture phone pick hides a blockable local number

**Files modified:** `src/lib/overture/transform.ts`, `src/lib/resolve/merge.ts`, `tests/unit/payload-contract.test.ts`
**Commit:** de619e8
**Applied fix:**
- There is one `pickPhone()`: the first blockable number, else the first dialable one.
- The ingest transform calls it, and so does survivorship's `firstPhone`, so the two pick the same number by construction.

**Tests:**
- 'a toll-free first phone never hides a blockable local number, on either side' covers both sides plus the toll-free-only fallback. It was red before the fix.
- Mutation: reverting `pickPhone` turned it red.
- The existing payload-contract tests stay green.

### B-WR-05 (chain-detection half): Trade-word stripping flags unrelated independents as chains

**Files modified:** `src/lib/resolve/chain.ts`, `tests/unit/chain-key.test.ts` (new), `tests/db/chain-closures.test.ts`
**Commit:** 0bd73e6
**Status:** fixed: requires human verification (logic; the badge count for a trade-word key is RGV-local, see below)
**Applied fix:**
- The chain key is now `name_norm` with the trade words the raw name was reduced by put back in front. "Taqueria Garcia" becomes `taqueria garcia`.
- The raw name is whichever of display/legal name normalizes to `name_norm`. It is computed in TypeScript, because SQL never normalizes, and passed as one jsonb of overrides.
- A name reduced by a trade word is never matched against the statewide frequency, which is keyed by the reduced name.
- `CHAIN_TRADE_WORDS` restates name.ts's private `TRADE`. A unit test pins that `nameNorm` strips every word in the list.
- `name.ts` and `statewide-names.ts` (fixer B) are untouched.

**Tests:**
- 'surname-plus-trade names are not one chain; three of the same trade name are'. It was red before the fix: 'garcia' was flagged even with a statewide `garcia: 57`.
- Mutations: dropping the overrides, and matching reduced names against statewide, each turned it red.

---

## Notes for the orchestrator

1. **Migration 0025 on production is a separate, human-gated step.** Run `pnpm db:migrate:prod` only with danlo's go-ahead. The local test database has it (migration id 29). Post-flight checks, read-only, against production after the migrate:

   ```sql
   select
     to_regprocedure('app.undo_merge(uuid,jsonb)') is null                                    as old_undo_gone,      -- expect true
     to_regprocedure('app.undo_merge(uuid,jsonb,jsonb)') is not null                          as new_undo_present,   -- true
     to_regprocedure('app.apply_survivorship_if_changed(uuid,uuid,jsonb,text)') is not null   as gate_present,       -- true
     has_function_privilege('authenticated', 'app.undo_merge(uuid,jsonb,jsonb)', 'EXECUTE')  as undo_auth_exec,     -- true
     has_function_privilege('anon', 'app.undo_merge(uuid,jsonb,jsonb)', 'EXECUTE')           as undo_anon_exec,     -- false
     has_function_privilege('authenticated', 'app.apply_survivorship_if_changed(uuid,uuid,jsonb,text)', 'EXECUTE') as gate_auth_exec, -- false
     has_table_privilege('authenticated', 'public.businesses', 'SELECT')                      as biz_select,         -- true
     has_table_privilege('authenticated', 'public.businesses', 'INSERT')
       or has_table_privilege('authenticated', 'public.businesses', 'UPDATE')
       or has_table_privilege('authenticated', 'public.businesses', 'DELETE')                 as biz_dml,            -- false
     has_table_privilege('authenticated', 'public.source_records', 'INSERT')
       or has_table_privilege('authenticated', 'public.source_records', 'UPDATE')
       or has_table_privilege('authenticated', 'public.source_records', 'DELETE')             as sr_dml,             -- false
     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public') and p.prosecdef
         and not (coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp']))::int  as definers_without_pg_temp, -- 0
     position('for update' in pg_get_functiondef('app.record_merge(uuid,uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure)) > 0 as record_merge_locks; -- true
   ```
   On the local database this returns exactly the expected column values. The migration's A-WR-02 sweep raises a NOTICE for any definer whose config is not exactly `search_path=public`. Read the migrate output for `A-WR-02:` lines.

2. **Normalizer propagation, after merging fixer B:** migrate, then `pnpm rederive --org=<org> --dry-run`, read `name_norm_written` / `survivorship_written` / `sample_changed`, then `pnpm rederive --org=<org>`, then `pnpm resolve --org=<org> --dry-run` and `pnpm resolve`. See `docs/runbooks/ingest.md` §7. Bump `DERIVATION_VERSION` in `src/lib/resolve/derivation.ts` if B's changes land after this merge and you want the report to show the change.

3. **Fixer B coordination:**
   - B-WR-05's statewide half is still B's. `statewide-names.ts` folds by `nameNorm`, so a plain "Garcia" still meets every "X Garcia" in Texas. If B moves the statewide fold to a trade-preserving key, `chain.ts`'s `plain` guard can widen.
   - `CHAIN_TRADE_WORDS` must stay equal to name.ts's `TRADE`. `tests/unit/chain-key.test.ts` catches a word the normalizer stops stripping, but not a word the normalizer adds.

4. **Not done, deliberately:**
   - The review's optional "reopen" decision (A-CR-01): not built.
   - 40P01 in the two server actions' retry lists: the lock-order fix removes the deadlock instead. The desk tier retries 40P01 (A-WR-10).
   - Info findings are out of scope (fix_scope critical_warning). A-IN-07 was fixed anyway, as part of A-CR-01's `undo_merge` rewrite.

5. **Deviation from the fixer playbook:** no extra git worktree and no recovery sentinel were created. This agent already ran in an isolated harness worktree (`worktree-agent-a16eddb76e145faa0`), reset to `e9bbed5` as instructed. The 16 commits sit on that branch and nothing was pushed.

---

_Fixed: 2026-09-23T12:31:56Z_
_Fixer: Claude (gsd-code-fixer), slice A_
_Iteration: 1_
