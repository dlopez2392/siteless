---
phase: 03-free-data-spine-entity-resolution
review_path: .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW.md
fix_scope: critical_warning
iteration: 1
findings_in_scope: 32
fixed: 32
skipped: 0
status: all_fixed
method: three parallel gsd-code-fixer worktrees (A db/server + cross-slice, B pure libs, C UI), merged by the orchestrator
head_after_merge: 475090a
---

# Phase 3 Code Review Fix — consolidated

All 32 CRITICAL + WARNING findings (5 CR, 27 WR) are fixed, one atomic `fix(03): <ID>` commit each,
each watched RED by test name first and mutation-checked. Fixer B's two "skipped" (B-WR-01, B-WR-04)
were ROUTED to fixer A by design (they live in score.ts / transform.ts+merge.ts) and are fixed there;
B-WR-05 was split (name half B, chain half A).

**Orchestrator seam fix after merging** (`475090a`): A's chainKeyOf re-added trade words that B's
nameNorm now keeps ("taqueria taqueria garcia") — 3 reds on the combined tree; chainKeyOf now prepends
only words nameNorm removed; tests re-premised on a multi-word remainder.

**Combined gate on 475090a:** typecheck ✓ · lint ✓ · build ✓ · unit 340/340 · db 222/222 (local DB at 0025).

**Outstanding (human-gated / follow-up):**
- `drizzle/0025_review_fixes_spine.sql` is applied LOCALLY only. Production needs danlo's go-ahead
  (`db:migrate:prod`); post-flight SQL is in the slice-A section below. `undo_merge` changes signature.
- The normalizer changes (B-CR-01, B-WR-02, B-WR-03, B-WR-05) change derived keys on EXISTING rows:
  run `pnpm rederive --org=… --dry-run` → `rederive` → `resolve --dry-run` → `resolve` on the local
  spine (prod has 0 businesses, nothing to re-derive there).
- Needs human judgement (fixer A): A-CR-02, A-WR-03 (resolve marks a pending pair distinct when its
  clusters were already ruled Different, at any score), A-WR-07, B-WR-05.

# Slice A — db / server / cross-slice (16/16)


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


# Slice B — pure libraries (9 fixed + 2 routed to A)


# Phase 3: Code Review Fix Report, Slice B (fixer B)

**Fixed at:** 2026-09-23
**Source review:** .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partB.md
**Iteration:** 1
**Base:** `e9bbed5`. Branch `worktree-agent-a52e8c5980a75aace`, 9 commits, not pushed.

**Summary:**
- Findings in scope (critical + warning): 11
- Fixed here: 9. B-WR-05 is fixed for its name half only; its chain.ts half went to fixer A.
- Routed to fixer A: 2 (B-WR-01, B-WR-04), plus the chain.ts half of B-WR-05
- Info findings (B-IN-01…06): out of scope (`critical_warning`)

**Gates on the final tree (`bf93e42`):** `vitest run tests/unit` 43 files / 310 tests green (baseline 42 / 298); `pnpm typecheck` 0; `pnpm lint` 0; prettier clean on every touched file.
**Not run:** the `tests/db` lane. The local database is shared with fixers A and C and holds danlo's real spine, and I was told to use it read-only. I checked `tests/db` by grep: no assertion depends on a changed key. Its name lists (`blocking.test.ts`, `resolve-pass.test.ts`) are stored `name_norm` literals, not normalizer output.

**Proof standard:** each finding has a named test. I watched it fail by name before the fix. For the mutation check I reverted the source (`git checkout --` of the fixed file), confirmed the named test went red, restored the file, and confirmed `git diff` was back to the fix only. Every filtered run used `npx vitest run <file> -t "<id>" --reporter=verbose`, and I read the test name from the output.

## 🔴 Stored keys that change (existing rows need fixer A's re-derivation)

I wrote no migrations and no backfills. These normalizer changes alter derived columns on rows already in the spine:

| Column | Finding | Inputs whose key changes | Example old → new |
|---|---|---|---|
| `name_norm` | B-CR-01 | any name with a single-letter `l` or `c` token that is not part of a trailing dotted legal form (initials, `A/C`) | `C & L Plumbing`: `plumbing` → `c l plumbing`; `GARCIA A/C & HEATING`: `garcia a heating` → `garcia a c heating`; `The L Bar`: `bar` → `l bar` |
| `name_norm` | B-CR-01 | a legal word (`co inc llc ltd corp lp llp pllc plc company corporation incorporated`) that is NOT in the trailing run | `Co-Op Feed`: `op feed` → `co op feed`; `Acme Corp of Texas`: `acme texas` → `acme corp texas` |
| `name_norm` | B-CR-01 | a trailing `L.P.` / `L.L.P.` / `P.L.L.C.`, which used to leave a stray letter | `Smith Partners L.P.`: `smith partners p` → `smith partners`; `Smith Law P.L.L.C.`: `smith law p` → `smith law` |
| `name_norm` | B-WR-05 | a trade word (`taqueria carniceria panaderia`) plus exactly ONE identity token (two or more letters, or a number) | `Panadería Méndez`: `mendez` → `panaderia mendez`; `La Taqueria De Guanajuato`: `guanajuato` → `taqueria guanajuato`; `Garcia's Taqueria`: `garcia s` → `garcia s taqueria` |
| `chain_key` | follows `name_norm` | recompute after `name_norm` is re-derived (it IS `name_norm`) | |
| `ingest_runs.stats → statewide_name_frequency` | follows `name_norm` | keyed by `nameNorm(outlet_name)`, so the last good map is keyed by the OLD normalizer until the next Comptroller run rewrites it | |
| `street_norm`, `street_num`, `unit` | B-WR-02 | a unit-designator word (`STE SUITE UNIT APT BLDG RM SPC LOT FL #`) directly after the house number or after a lone directional, or one whose identifier or next token is a street type | `12345 RM 620 N`: `null` / unit `RM 620 N` → `rm 620 n` / no unit; `1201 W UNIT RD`: `w` → `w unit rd` |
| `phone_blockable` | B-WR-03 | a raw phone carrying an extension (`x5`, `ext 12`). `phone_e164` is unchanged. | `956-423-1234 x5`: blockable `true` → `false` |

Unchanged: names with no legal, initial or trade-word edge; a trailing `LLC`/`Inc`/`Co`/`L.L.C.` run (it still strips); `DBA` (it still separates two names, and each name strips its own tail).

Test fixtures: `tests/unit/fixtures/merge-pairs.json`, `merge-triple.json` and `tests/unit/score.test.ts` were **not touched**. I ran a one-off script (deleted afterwards) that recomputed `nameNorm(sourceName)` for every fixture side after each normalizer commit. Every result matched the stored `nameNorm`, so no pair score moved.

## Fixed Issues

### B-CR-01: `nameNorm` strips `l`, `c`, `co` anywhere

**Files modified:** `src/lib/normalize/name.ts`, `tests/unit/normalize.test.ts`
**Commit:** `446fa04`
**Applied fix:** I removed `l` and `c` from `LEGAL`. Legal forms now strip only as a trailing run (`stripTrailingLegal`). Dotted forms match only as whole trailing sequences: `l l c`, `l l p`, `p l l c`, `l p`. A `dba` token splits the name into segments and each segment strips its own tail. A legal form ahead of a trailing phone run is stripped again once the phone is removed.
**Named tests:** `nameNorm B-CR-01: initials are identity, not legal suffixes` (C & L Plumbing ≠ Plumbing, C&C Auto Repair ≠ Auto Repair, L & C ≠ C & C), `nameNorm B-CR-01: co is kept when it is not a trailing legal form` (`Co-Op Feed` → `co op feed`), `nameNorm B-CR-01: a trailing legal run still strips` (Smith Co / Co Inc / Co., Inc. / L.L.C. / L L C / , LLC / L.P. / P.L.L.C. / LLC + phone / … DBA C & L Plumbing).
**Existing 03-06 tests:** all green with unchanged expectations. I edited one comment in the ligature test because it had claimed a lone `l` is a legal token. SQL parity: `sql-never-normalizes.test.ts` is green, and no SQL was touched.
**Mutation:** reverting `name.ts` turned all three named tests red, and restoring it turned them green.
**Known edge:** a name that genuinely ends in the initials `L P` ("Tire Shop L & P") now loses them as a trailing `L.P.`. The only way to tell the two apart is the raw punctuation, which the tokenizer discards.

### B-WR-05 (name half): trade-word strip collapses family businesses into one key

**Files modified:** `src/lib/normalize/name.ts`, `tests/unit/normalize.test.ts`
**Commit:** `55f1858`
**Applied fix:** `dropTradeWords` drops the trade words unless that would leave exactly ONE identity token (a word of two or more letters, or a number). When none would be left, the words are dropped as before and the name gets no key. When two or more are left, they are dropped as before, which keeps D-12's similarity lift (`Taqueria Jalisco Express` still equals `Jalisco Express`). I chose this over "stop stripping trade words entirely" because it changes the fewest keys and keeps D-12 intact for every name that has its own identity. It changes only the surname-plus-trade shape the review measured as dominant. A single token is the right bar because `garcia`, `mendez` or `guero` alone is what collides across unrelated families. A lone letter (the `s` a possessive leaves) does not count, so `Garcia's Taqueria` stays apart from `Garcia's Panaderia`. `hadStoreNumber` is read from the tokens with the trade words removed, so a kept trade word never hides a trailing number.
**Changed expectations (explained):** three rows of the 03-06 table and the defect-1 test. `Panadería Méndez` → `panaderia mendez`, `Carnicería El Güero` → `carniceria guero` and `La Taqueria De Guanajuato` → `taqueria guanajuato` are each one surname plus a trade word, which is exactly the shape B-WR-05 protects. Defect 1 still guards the leading space: the leading `La` still goes, and the test still asserts no leading or trailing space.
**Named test:** `nameNorm B-WR-05: a trade word stays when it is all that tells two family businesses apart`
**Mutation:** reverting `name.ts` to the B-CR-01 state turned the named test red, and restoring it turned it green.
**Routed:** the chain.ts half (a trade-keeping chain key, or not flagging a single-token trade-stripped key) belongs to fixer A.

### B-WR-02: street names that start with a unit designator are parsed as units

**Files modified:** `src/lib/normalize/address.ts`, `tests/unit/normalize.test.ts`
**Commit:** `0e39966`
**Applied fix:** `UNIT_RE` is now `UNIT_CANDIDATE` (global), and `isUnit` rejects a candidate in two cases. The first is when the street before it, minus the house number, is empty or a lone directional. The second is when its identifier, or the token right after it, is a street type (short or long form, derived from `USPS_ABBREVIATIONS`). The first accepted candidate wins, so `12345 RM 620 N STE 5` gives street `rm 620 n` and unit `STE 5`. I did not follow the review's first suggestion to remove `RM` from the designators. The two guards alone fix all five probes, and removing `RM` would have changed the existing pinned `2426 E TYLER AVE RM 3` → unit `RM 3` row in `suite stripped not lost`, where `RM` really is a room behind a real street.
**Named test:** `addressKey B-WR-02: a road that starts with a unit word is a street, not a unit` (the five probes from the review, plus a real suite after an RM road).
**Mutation:** reverting `address.ts` turned the named test red, and restoring it turned it green.
**Heads-up for fixer A (B-WR-01):** fixer A may add a `unitNorm` in its own files. `addressKey`'s return shape is unchanged here.

### B-WR-03: phone extensions dropped, so a shared switchboard is blockable

**Files modified:** `src/lib/normalize/phone.ts`, `tests/unit/normalize.test.ts`
**Commit:** `4394609`
**Applied fix:** `blockable: !TOLL_FREE_NPAS.has(npa) && !p.ext`. `e164` is still returned for dialling.
**Named test:** `phoneE164 B-WR-03: a number with an extension is dialable but not blockable` (`x5`, `ext 12`, `ext. 12`, plus a positive control with no extension).
**Mutation:** reverting `phone.ts` turned the named test red, and restoring it turned it green.

### B-WR-06: `instantOf('')` returns 1970-01-01

**Files modified:** `src/lib/instant.ts`, `tests/unit/instant.test.ts` (**new file**; `instant.ts` had no unit test)
**Commit:** `9fd2902`
**Applied fix:** `instantOf` throws on an empty or whitespace-only string. `requireInstant` inherits the refusal. `'0'` is still the epoch.
**Named test:** `instantOf B-WR-06: an empty string is refused, not the epoch`
**Mutation:** reverting `instant.ts` turned only the named test red (the positive-control test stayed green), and restoring it turned it green.

### B-WR-07: Census coordinate validation accepts a missing half as `0`

**Files modified:** `src/lib/geocode/census-batch.ts`, `tests/unit/census-batch.test.ts`
**Commit:** `4a42b7e`
**Applied fix:** each half of `"lng,lat"` must match `^-?\d+(\.\d+)?$` after trimming. The point must also fall inside a Texas box (lat 25–37, lng −107 to −93). Every row is sent as `TX`, so a point outside Texas is a defect, and the box also catches an axis swap more tightly than ±90/±180.
**Named test:** `census batch B-WR-07: a half-missing coordinate is bad_shape, never a point on the equator`. It builds on the recorded Harlingen `Match` line: `"-97.67,"`, `",26.18"`, `","`, `" , "` and `"-97.67, "` each give `bad_shape`, and so do `0,0` and a southern-hemisphere point. As a positive control, the untouched field still parses to the exact recorded point.
**Mutation:** reverting `census-batch.ts` turned the named test red, and restoring it turned it green.
**Follow-up:** these fixes protect future ingests only. A read-only query for `lat = 0 or lng = 0` on the geocoded rows would show whether any past run stored an equator point.

### B-WR-08: one unparseable response line fails the whole chunk, three times

**Files modified:** `src/lib/geocode/census-batch.ts`, `tests/unit/census-batch.test.ts`
**Commit:** `bf6e0f9`
**Applied fix:** `postChunkOnce` keeps every parsed line that names an expected ID. Unparseable lines are set aside, and their rows are found by elimination (the line count already matches, and the parsed IDs are distinct and expected). Those rows are marked `ChunkFailed/bad_shape` and returned as success, so a deterministic parse failure is not retried. The whole chunk still fails, and is retried, on a count mismatch, a duplicated or unknown ID, or a response in which no line parses at all. `csvField` now drops `"` instead of doubling it, and the header's success definition is updated. The quote-doubling code would have been dead, since IDs cannot carry a quote (`ID_SHAPE`).
**Named test:** `census batch B-WR-08: one unparseable line fails only its own row, and is not retried`. It serves the recorded `shuffled` body with one line cut mid-quote and one line given an unknown status, and checks five things. First, one request is made, not three. Second, exactly those two IDs are `bad_shape`. Third, every other row equals the clean replay. Fourth, a duplicated ID still fails every row. Fifth, a `"` in the street or city never reaches the request CSV.
**Mutation:** reverting `census-batch.ts` turned the named test red, and restoring it turned it green.

### B-WR-09: closure schema requires `loc_name`

**Files modified:** `src/lib/socrata/closures.ts`, `tests/unit/socrata.test.ts`
**Commit:** `380b861`
**Applied fix:** `loc_name: z.string().max(500).optional()`. `ClosureSourceRecord.legalName` is now `string | null`, and null when the name is absent or blank. Neither consumer reads a non-null `legalName`: `scripts/ingest-comptroller.ts` never uses it, and `merge.ts` reads `str(p.loc_name)`, which tolerates `undefined`. `tsc` is green.
**Named test:** `closure row B-WR-09: a blank, missing or long loc_name still marks the outlet closed`. It uses a recorded `3kx8-uryv` row with the name missing, blank or 300 characters long. Each parses and keeps key `32006197027-1` and `closedAt` `2022-12-31T06:00Z`. A missing name gives a `null` legalName, and an empty `loc_number` is still refused.
**Mutation:** reverting `closures.ts` turned the named test red, and restoring it turned it green.
**Effect on the next run:** closure rows the old schema rejected will now be accepted and will set `closed_at` on the next closures run.

### B-WR-10: `PublicBusiness` is type-only and omits `chainKey`

**Files modified:** `src/lib/export/public-business.ts`, `src/lib/export/registry.ts`, `tests/unit/no-internal-leak.test.ts`, `tests/unit/fixtures/business.ts`
**Commit:** `bf93e42`
**Applied fix:** `toPublicBusiness(b)` picks the seven public fields by name, and `PUBLIC_BUSINESS_KEYS` is the runtime whitelist (`satisfies keyof PublicBusiness`). `buildPayload(builder, row)` in the registry is now the one way to run a builder: it hands the builder the projection, never the row. `chainKey: string | null` is added to `BusinessLike` (the Drizzle bridge in `businesses.ts` still holds), to the `Omit<>`, and to the compile-time `InternalKeysOmitted` check. `chainKey` and `chain_key` are added to `INTERNAL_KEY_NAMES`, and a `CHAIN_KEY_CANARY` is added to the fixture. The existing sentinel now runs registered builders through `buildPayload` with the WIDE fixture. It also asserts that the projection equals the hand-written public literal.
**Named test:** `B-WR-10: builders are handed a runtime projection, so even a spreading builder cannot leak`. A careless `({ ...b })` builder is fed a wide row that carries every canary plus an undeclared column. The test asserts that no canary, no internal key name and no undeclared column appears in the output, that `Rio Roofing` does appear, and that the projection's keys are exactly the whitelist.
**Watched fail first:** `TypeError: buildPayload is not a function`, reported under the test's name.
**Mutation:** two checks. Making `toPublicBusiness` return its argument turned both the named test and the sentinel red. Reverting both source files turned both red. Restoring turned everything green.

## Skipped Issues

### B-WR-01: suite/unit removed from the key and never compared

**File:** `src/lib/normalize/address.ts:88-92` (consumed by `src/lib/resolve/score.ts:247-251`)
**Reason:** routed to fixer A. The scorer's unit comparison lives in `src/lib/resolve/score.ts`, which is outside this fixer's allowed files.
**Original issue:** two tenants of one building score a full 30-point address match and an independent `address` signal.

### B-WR-04: Overture phone pick takes the first valid number even when toll-free

**File:** `src/lib/overture/transform.ts:168` (mirrored in `src/lib/resolve/merge.ts:93-96`)
**Reason:** routed to fixer A. Both files are fixer A's, and they must change in lockstep.
**Original issue:** a toll-free number listed first hides a blockable local number from phone blocking.

### B-WR-05 (chain.ts half)

**File:** `src/lib/resolve/chain.ts`, `src/lib/socrata/statewide-names.ts:211-213`
**Reason:** routed to fixer A (chain detection). The name half is fixed above (`55f1858`).

---

_Fixed: 2026-09-23_
_Fixer: Claude (gsd-code-fixer), fixer B_
_Iteration: 1_


# Slice C — UI (8/8)


# Phase 3: Code Review Fix Report, Slice C (UI)

**Fixed at:** 2026-09-23
**Source review:** .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partC.md
**Iteration:** 1
**Branch:** `worktree-agent-a31b4f18c6193cb8a`, reset to `e9bbed5` and then 7 commits, head `659f48c`

**Summary:**
- Findings in scope: 8 (C-CR-01, C-WR-01 … C-WR-07). Info findings were out of scope.
- Fixed: 8, in 7 commits. C-WR-02 and C-WR-03 share one commit because they change the same badge and the same header.
- Skipped: 0

**Protocol for every behavioural fix:**
1. A named test was run and seen failing by its name.
2. The fix was applied, and the test passed.
3. A mutation reverting the fix was applied with the change committed. The named test went red by name.
4. `git checkout -- <file>` restored the file, and `git status` came back clean.

**Final gates on `659f48c`:**
- `tsc --noEmit`: 0.
- `eslint .`: 0.
- `vitest run tests/unit`: 44 files, 320 tests, all passing.
- `next build`: exit 0 on the C-WR-07 tree. That tree matches the committed head.

I did not edit anything owned by fixer A or fixer B. `src/lib/time.ts` was not changed; `formatCount` was only imported.

## Fixed Issues

### C-CR-01: No error boundary anywhere; a rejected action crashes the app

**Commit:** `61fd55e`

**Files:**
- `src/components/review/review-actions.tsx`
- `src/components/business-detail/unmerge-dialog.tsx`
- `src/components/app-shell/route-error.tsx` (new)
- `src/app/(app)/error.tsx` (new)
- `src/app/(app)/review/error.tsx` (new)
- `src/app/(app)/businesses/[id]/error.tsx` (new)
- `src/lib/ui/copy.ts` (adds `ERROR_THING`)
- tests: `tests/unit/review-actions.test.tsx`, `tests/unit/unmerge-dialog.test.tsx`, `tests/unit/segment-error.test.tsx` (new)

**Applied fix:**
- Both transitions now `try/catch` the awaited action.
  - `/review`: a rejected promise sets the existing refusal, `REVIEW_DECISION_FAILED`, and it is retryable. The pair stays on screen and nothing refreshes or toasts. Rule 20 holds, because the queue still advances only on `ok: true`.
  - Unmerge: a rejection shows `UNMERGE_FAILED` in the open dialog. It does not close or refresh.
- Three client `error.tsx` boundaries use Next 16.3's `retry()`, which re-fetches and re-renders the segment. `reset()` does not re-fetch, so it was not used.
  - `(app)`: `UNEXPECTED_ERROR('this page')`.
  - `/review`: keeps the page title, shows `REVIEW_LOAD_FAILED`, and offers "Try again" and "Open sources".
  - `/businesses/[id]`: `SPINE_UNEXPECTED_ERROR('this business')`, with "Try again" and "Open sources".
- All three render inside the `(app)` layout, so the tab bar survives.
- The shared `RouteError` is a client module that exports only a component. Its copy comes from `copy.ts`, so there is no client-reference trap.
- The boundaries never print `error.message`.

**Named tests, each seen failing first:**
- `a decision whose request never reaches the server keeps the pair and shows the refusal`
- `an unmerge whose request never reaches the server keeps the dialog open with the unmerge-failed sentence`
- `the review boundary renders the review-load-failed sentence and retries the segment`
  - Plus three sibling boundary tests in the same file.

**Mutation:** make both catches rethrow, and render the wrong sentence in the review boundary. Exactly those three named tests went red.

### C-WR-01: Clerk lookup had no timeout and could print an email

**Commit:** `44f3a49`

**Files:**
- `src/app/(app)/businesses/[id]/actor-names.ts` (new; extracted from `page.tsx`)
- `src/app/(app)/businesses/[id]/page.tsx`
- `tests/unit/actor-names.test.ts` (new; Clerk is factory-mocked)

**Applied fix:**
- `getUserList` now races a 1500ms deadline (`ACTOR_LOOKUP_TIMEOUT_MS`). A timeout or a throw falls back to the raw id.
- The losing promise's late rejection is swallowed, and the timer is cleared.
- At most 100 ids go into one page. Any beyond that print as raw ids.
- The name is first + last, else the username, else nothing, so the raw id prints. **The email fallback is gone.**
- `copy.ts` has no "a teammate" string, so I kept the existing raw-id fallback and did not invent copy.

**Named tests, seen failing first:**
- `a Clerk lookup that never answers falls back to the raw ids once the budget runs out`
- `a user with no name and no username is never named by their email`
- `the page size stays inside what Clerk accepts`

**Mutation:** remove the race and restore the email fallback. The first two named tests went red.

### C-WR-02 and C-WR-03: One chain-flag formatter, and one flag-badge size

**Commit:** `3f429e8` (both findings)

**Files:**
- `src/lib/ui/copy.ts`
- `src/components/flags/flag-badge.tsx` (new)
- `src/components/flags/closed-badge.tsx`
- `src/components/review/candidate-pair.tsx`
- `src/components/business-detail/detail-header.tsx`
- `src/components/business-list/business-cards.tsx`
- `src/app/(app)/businesses/[id]/page.tsx`
- tests: `tests/unit/closed-badge.test.tsx`, `tests/unit/business-detail.test.tsx` (prop rename only)

**Applied fix:**
- **Chain wording (C-WR-02).**
  - `copy.ts` gains `FLAG_CHAIN_LOCAL` ("Chain · {n} in the RGV") and `FLAG_CHAIN_LABEL(chain, shown)`. `FLAG_CHAIN_LABEL` is the one place the wording is chosen from `statewide`, and `shown` is required.
  - `ChainBadge` renders the label with the count from the pinned-locale `formatCount` (`src/lib/time.ts`).
  - The `.replace(' in Texas', '')` is gone, and so is the inline detail-page literal and its `new Intl.NumberFormat`.
  - `DetailHeader` now takes `chain` (the facts), not a pre-formatted `chainLabel`.
  - Result: the review card and the detail header both read "Chain · 1,284 in the RGV", or "… in Texas" for a statewide count.
- **Badge sizing (C-WR-03).**
  - `FLAG_BADGE_SIZING` (`h-auto px-2 py-1 text-sm font-semibold tabular-nums`) is shared by `ClosedBadge`, `ChainBadge` and `MergedAwayBadge`.
  - It applies on the detail header, the review card and the `/businesses` list.

**Named tests, seen failing first:**
- `the chain flag reads one way on the review card and the detail header (a local count)`
- `the chain flag reads one way on the review card and the detail header (a statewide count)`
- `the chain and merged-away badges share the Closed badge sizing (14/600, not the Badge default 12/500)`

**Mutations, each red by name:**
1. The formatter always says "in Texas": the local-count test went red.
2. The count is printed raw instead of through `formatCount`: both chain tests went red.
3. `MergedAwayBadge` loses the shared sizing: the sizing test went red.

### C-WR-04: Phone /sources list had no listitem children

**Commit:** `d1ae792`

**Files:**
- `src/components/sources/source-ledger.tsx`
- `src/components/sources/sources-skeleton.tsx`
- `tests/unit/sources-ledger.test.tsx`

**Applied fix:** `role="listitem"` goes directly on each source `Item`. The Item is a plain div, not a link. `business-cards.tsx` wraps its Item instead, but only because its Item is a link.

**Named tests, seen failing first:**
- `the phone ledger list owns one listitem per source`
- `the phone skeleton list owns one listitem per source`

**Mutation:** drop the role on the ledger. The ledger test went red.

### C-WR-05: Unmerge offered "Try again" for conflicts that can never succeed

**Commit:** `0011aca`

**Files:**
- `src/components/business-detail/unmerge-dialog.tsx`
- `src/lib/ui/copy.ts` (adds `ERROR_ACTION.reloadHistory` = "Reload the merge history")
- `tests/unit/unmerge-dialog.test.tsx`

**Applied fix:**
- The error state carries `retryable`. "Try again" and "Open sources" appear only for `unexpected` and for `conflict`/`concurrent_merge`, mirroring `isRetryable` in `review-actions.tsx`.
- `already_undone`, `later_merge_first`, `lead_key_in_use` and `not_found` get one action: "Reload the merge history". It closes the dialog and calls `router.refresh()`.
- Closing the dialog any other way after such a refusal (Keep them merged, or Escape) also refreshes. This removes the stale Unmerge button.
- The refresh is deliberately **not** fired at the moment of refusal. Re-reading the page then could unmount the row's dialog before the sentence has been read.
- The existing parameterised refusal test was split into retryable and non-retryable cases. Its mocks now carry the `detail.reason` the real action sends.

**Named tests, seen failing first:**
- `a refused unmerge that can never succeed (later merge first) …`
- `… (already undone) …`
- `dismissing after a refusal that can never succeed still refreshes, so the stale button goes away`

**Mutations, each red on all three:**
1. Every refusal becomes retryable.
2. The refresh on close is removed.

### C-WR-06: Skip and Different helper sentences were never rendered

**Commit:** `2ced4b8`

**Files:**
- `src/components/review/review-actions.tsx`
- `src/app/(app)/review/page.tsx`
- `tests/unit/review-actions.test.tsx`

**Applied fix:**
- `ReviewHelpers` renders `REVIEW_DIFFERENT_HELPER` and `REVIEW_SKIP_HELPER` as Label 14/400 muted text.
- The Different and Skip buttons point at them with `aria-describedby`. The ids are private to the module, so no data is exported from the client module.
- **Where it sits differs from the review's suggestion, on purpose.** It is not inside the fixed thumb bar. Three more lines there would take about 70px of a 390×844 phone permanently.
  - On phone, the page renders it in the scrolling flow just above the bar's spacer.
  - From 640px up, `sm:order-last` puts it beneath the action row.
- **Measured on the built app:**
  - Phone (390×844): the helpers sit at 563–627px, above the thumb bar at 643px.
  - Desk (1280×800): the helpers sit at 546–590px, below the Different button at 478–522px.
  - Painted style is `14px/400 rgb(91, 104, 109)` (`#5B686D`).
  - The accessible description on Different resolves to the helper sentence.
  - This was a temporary Playwright probe and is not committed. No decision button was pressed.

**Named test, seen failing first:** `the Different and Skip helper sentences are shown and describe their buttons`

**Mutation:** remove `aria-describedby`. The named test went red.

### C-WR-07: Success toasts covered the phone thumb bar (unmeasured in the review)

**Commit:** `659f48c`

**Files:**
- `src/lib/ui/chrome.ts` (new, server-safe)
- `src/components/review/thumb-bar.tsx`
- `src/app/layout.tsx`
- tests: `tests/unit/thumb-bar.test.tsx`, `tests/e2e/toast-clearance.spec.ts` (new)

**Measured first, on a local `next build` + `next start -p 3133` against the local DB, 390×844, signed in with `@clerk/testing`:**
- **Before the fix**, a one-line toast sat at **774.5–828px**. That is over the thumb bar (**643–780px**) and over the tab bar (from **779px**). sonner's default is 16px off the bottom edge.
- The e2e test `a toast clears the tab bar and the review thumb bar on a phone` failed by name on this build.

**Applied fix:**
- `ThumbBar` writes its measured height to `--thumb-bar-height` on `<html>`, using the ResizeObserver 03-22 already added. It removes the variable on unmount.
- The root `Toaster` takes `mobileOffset={PHONE_TOAST_OFFSET}`, which is `{ bottom: 'calc(4rem + env(safe-area-inset-bottom) + var(--thumb-bar-height, 0px) + 0.5rem)' }`.
- This puts the stack above the tab bar on every phone screen, and above the thumb bar on `/review`. It follows the bar when a refusal makes the bar taller.

**After the fix, rebuilt and re-measured:** the toast sits at **581.5–635.0px**, and the thumb bar top is **643.0px**. The e2e test passes.

**Named unit test, seen failing first:** `thumb bar publishes its measured height for the phone toast offset, and withdraws it on unmount`

**Mutation:** remove `setProperty`. The named test went red.

**How the e2e spec stays read-only:**
- The toast comes from "Copy lead key", which writes nothing.
- A keyboard client-side navigation carries it to `/review`, with the pointer resting on the toast so sonner pauses its dismiss timer.
- The spec skips with a named reason where there is no pending pair or no business. That includes production, whose spine is empty this phase.

**Known gap:** sonner switches to `mobileOffset` below 600px, but the tab bar shows below 640px. From 600 to 639px, sonner's desktop offset still applies. That band was not measured or changed.

## Local-environment notes

- The local DB was read-only throughout. No Same, Different, Skip or Unmerge was pressed.
- Only my own `next start` PIDs were killed: 105696 and 66924, both on port 3133.
- Temporary measurement specs (`tests/e2e/zz-tmp-*.spec.ts`) and logs were deleted, and the working tree is clean. `.env.local` was copied in and not committed.
- `gsd-sdk` is not on PATH here, so the commits were made with `git commit` in the required `fix(03): <ID> …` format.
- No second worktree was created. The orchestrator-provided worktree was used as the isolation boundary.

---

_Fixed: 2026-09-23_
_Fixer: Claude (gsd-code-fixer), slice C_
_Iteration: 1_

