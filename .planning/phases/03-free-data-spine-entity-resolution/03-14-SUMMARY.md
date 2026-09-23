---
phase: 03-free-data-spine-entity-resolution
plan: 14
subsystem: entity-resolution
tags: [dedupe, resolve-pass, auto-merge, chain, desk-script, etl-tier, DEDUP-01, DEDUP-02]
requires:
  - 03-02 (score.ts: score(), AUTO_MERGE_SCORE, REVIEW_SCORE, BLOCK_SIMILARITY_THRESHOLD)
  - 03-09 (setEtlActor + resolveEtlOrg, EtlExecutor, _ingest-fixtures asEtlExecutor)
  - 03-10 (block.ts B1/B2′/B3 + runBlock + runDistanceGate, chain.ts detectChains)
  - 03-11 (merge.ts mergePair / unmergeBusinesses / recordCandidateDecision, the three definers)
provides:
  - "scripts/resolve.ts: `pnpm resolve --org=<clerk_org_id> [--target=test|prod] [--dry-run]`, the whole pass (stage 0 preflight → chains → block → 25 km gate → score → auto-merge) and its run report"
  - "exported stages (preflight, stageChains, stageBlock, stageDistanceGate, stageScore, stageMerge, mergeCandidate, runResolvePass, resolveTransactions) drivable inside withRollback via `nested` savepoints"
  - "assertTrigramPlan / planUsesTrigramIndex: the EXPLAIN guard against the B3 seq-scan trap"
  - "tests/db/resolve-pass.test.ts: 11 named DB tests of the composition"
affects: [03-15, 03-20, 03-21]
tech-stack:
  added: []
  patterns:
    - "One transaction runner per script; its first two statements are setEtlActor then resolveEtlOrg, and `nested` swaps BEGIN/COMMIT for SAVEPOINT/RELEASE so a test drives the same code"
    - "Batch write-back as ONE jsonb parameter unpacked with jsonb_to_recordset, write-gated with `is distinct from`"
    - "A permissive-claims fixture (actAs, then reset role) set against a no-claims test, so the mutation that removes the org claim reds ONLY the desk-tier tests"
    - "Live definer mutation inside the test's own rolled-back transaction (create or replace is transactional): the shared DB never sees it"
key-files:
  created:
    - scripts/resolve.ts
    - tests/db/resolve-pass.test.ts
  modified: []
key-decisions:
  - "Run report = app.emit_event('businesses', null, 'resolve', stats) + a printed summary. NOT an ingest_runs row: ir_source_key_known admits only the four data sources and /sources renders exactly four rows (D-17). A persisted resolve-run table would be a new table with its own migration; ir_source_key_known is unchanged since 03-05"
  - "Auto-merge order is `score desc, left_id asc, right_id asc`, the business pair, not the candidate's own `id`. Candidate ids are random uuids that a regenerated candidate set reshuffles; the plan's `id asc` made 'the pass is deterministic' red 3 out of 3 runs"
  - "The auto-merge skip checks chain_key on both raw sides AND both cluster roots, and skips a pair when a `distinct` decision already spans its two clusters (D-20 across a re-pointed edge). The script's coalesce(merged_into_id, id) re-point is what makes those two guards cluster-aware; the definer carries its own re-point for the merge itself"
  - "A candidate whose two sides already resolve to one root still goes through mergePair: the definer marks it `merged` and returns a null merge id (T-3-02: the pass never writes a decision directly)"
  - "Stage 2 flushes the GIN pending list and ANALYZEs businesses before blocking, and ANALYZEs merge_candidates before the gate. B3 is EXPLAINed first and refused unless businesses_name_trgm is in the plan, when the org has >= 20,000 probe rows (below that the planner is right to pick a btree, as 03-10 measured)"
  - "Stage 5 retries a candidate on 40001 (up to 3 times) and aborts the pass on any other SQLSTATE. Every other refusal (42501, 55000, 22023) is a bug or a race that the operator should see"
requirements-completed: [DEDUP-01, DEDUP-02]
duration: ~30min
completed: 2026-09-23
---

# Phase 3 Plan 14: The resolve pass (block → score → auto-merge → enqueue) Summary

**`pnpm resolve --org=<clerk_org_id>` runs the whole entity-resolution pass as a desk script.**

Stages:
- **Stage 0** is a preflight that proves `app.current_org_id()` is set before any work.
- **Stage 1** flags chains.
- **Stage 2** runs the three blocking shapes. It cleans up the GIN pending list, runs ANALYZE, and refuses a seq-scan plan. It names every block the cap refused.
- **Stage 3** marks pairs over 25 km `distinct`.
- **Stage 4** scores every pending pair with the committed scorer, with `similarity()` taken from SQL. Scores are written back in batches.
- **Stage 5** auto-merges everything at or above 95, highest score first. It is cluster-aware, chain-aware and distinct-aware.

Pairs scoring 80–94 stay `pending`, and that is the review queue. The run report is one `etl:resolve` event.

## Performance

- **Duration:** about 30 minutes, from base `9217536` (21:37) to the Task 2 commit (22:02) plus gates
- **Tasks:** 2 of 2
- **Files:** 2 created (`scripts/resolve.ts` 820 lines, `tests/db/resolve-pass.test.ts` 543 lines)
- **Measured pass time on the fixture** (test 1: 6 businesses, 3 candidates, 1 merge; `stats.ms`, three runs):
  - Typical: `{"preflight":2,"chains":14,"block":22,"gate":10,"score":6,"merge":23,"total":77}`, and 82 ms on another run.
  - One outlier took 2,136 ms: `block` 1,040 ms and `gate` 1,029 ms. That pattern fits the two `ANALYZE` statements waiting on a concurrent `ANALYZE`/autovacuum lock in the shared test DB. The eight-run determinism test averages about 50 ms per pass.
  - Scale timing is 03-20's desk run, not this suite.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 | `c2038f0` | `scripts/resolve.ts`: the stages, the transaction runner, the plan guard, the run report and `main()` |
| 2 | `21ae5da` | `tests/db/resolve-pass.test.ts`: 11 named tests |

## Verification (every command run, output read)

| Check | Result |
|---|---|
| `pnpm typecheck` (tsc) | exit 0, checked after each task and after the mutations |
| `pnpm lint` | exit 0 |
| `pnpm test:unit` | **33 files, 225 tests passed** |
| `pnpm test:db` | exit 0, **24 files, 176 tests passed**. The verbose re-run lists all 11 `resolve-pass` tests by name, all green. The `budget-concurrency` false red did not appear |
| `pnpm build` | exit 0 |
| `tsx scripts/resolve.ts` (no args) | `ResolveOrgRequiredError`, before any I/O |
| `tsx scripts/resolve.ts --org=org_does_not_exist --dry-run` | `EtlOrgNotFoundError` from the preflight transaction; nothing written |
| Shared DB after all runs | 0 `org_A`/`org_B` orgs, 0 `merge_candidates`, 0 `business_merges`, 0 `resolve` events |
| `app.record_merge` in the shared DB after the definer mutation | `md5(pg_get_functiondef)` = `c91f499c10624ffd53aa40d654e9c1f0`, the value 03-11 recorded; the re-point is present |
| Acceptance greps | `order by mc.score desc, mc.left_id asc, mc.right_id asc` (see Deviation 1); `coalesce(merged_into_id, id)` ×2 in `mergeCandidate`; `chain_key` in the skip; `similarity(a.name_norm, b.name_norm)`; `set local pg_trgm.similarity_threshold`; `skipped_blocks`; `resolveEtlOrg` count 3 = `setEtlActor` count 3, neither at module scope; `app.current_org_id()` is in `preflight` (line 217), before `detectChains` (line 232); `ir_source_key_known` is only in `drizzle/0022`; `seedTwoOrgs` is in the test; `1000`/`10000` is absent from the test; no `actAs` in the no-claims test body |

### The 11 named DB tests

1. `a resolve pass merges at 95 and enqueues at 80`:
   - The 95 pair is `merged`, with one `business_merges` row (`auto`, 95, the older business wins).
   - The 87 pair is `pending` with features `{name 37, phone 0, address 30, distance 15, cluster 5, signals [name,address,distance]}`.
   - The 35 pair is `pending` and below the floor. The queue query returns the 87 only.
   - `stats.bands` = `{merge 1, review 1, ignore 1, distinct 0}`.
2. `a chain-flagged pair is never auto-merged`: two guards, two assertions.
   - (i) A direct chain pair. The raw features sum to 97, and the stored pair reads `score 94, pending`. This is the R2 cap.
   - (ii) A 95 pair whose side B is merged into a chain member. B's own row is not flagged, so only the ROOT carries the chain. It reads `score 95, pending`, with no merge and `skipped_chain 1`. This is the skip.
3. `an unmerged pair is never re-proposed`: pass → merged; `unmergeBusinesses` → `distinct`; pass again → still `distinct`. The one `business_merges` row is undone and no new row appears. This is M21's proof at the composition level.
4. `the pass is deterministic`:
   - Fixture: the triple, with its two outer members already judged `distinct`, so exactly one of the two tied 95 edges may merge.
   - Eight runs, each regenerating the candidates, all give the same `merged_into_id` map, with `merged 1, skipped_distinct 1` every time.
5. `the pass is org-scoped`:
   - Setup: `seedTwoOrgs`, with a 95 pair, a pending candidate and a 3-member chain name in org B.
   - After a pass for org A, B's candidate is untouched (`pending`, 0, `{}`). B has no merged or chain-flagged business and no merge.
   - The scorer read org A's one pair only (`scored 1`).
6. `the pass runs from an owner connection with no claims`:
   - It first asserts that no claim is set and that `current_user` is not `authenticated`.
   - Then it drives stages 1–5 directly, with no `actAs` anywhere.
   - `business_merges` = `[{merged_by: 'etl:resolve', reason: 'auto', winner_id: <older>}]`.
7. `stage 0 preflight resolves the org before any stage`:
   - With no claims, `preflight` returns `orgs.id`.
   - `org_nope` gives `EtlOrgNotFoundError`, and `''` gives `EtlOrgRequiredError`. Nothing is written.
8. `a three-way cluster merges to one winner through the pass`:
   - The synthetic ≥95 triple gives `bands.merge 3` and `merged 2, already_one 1`.
   - Both losers point at the oldest business, and no `merged_into_id` points at a merged row.
   - All three candidates are `merged`.
9. `three identical names read as a chain and wait for review`: the finding below, pinned.
10. `a block over the cap is named in the run report`:
    - Fixture: 33 places sharing one blockable number, which is 528 pairs.
    - `stats.skipped_blocks` = `[{block_key: 'phone:+19566300000', size: 528}]`, and no candidate is written.
    - The event row's `after.skipped_blocks` matches, with `actor_id` `etl:resolve`.
11. `the trigram plan guard refuses a plan without the GIN index`:
    - The matcher is checked both ways, and the small-org exemption returns `unchecked_small`.
    - With `enable_indexscan`/`enable_bitmapscan` off, a real EXPLAIN is refused with `TrigramPlanError`.

## Watched red

Each mutation was applied, the file was run with `--reporter=verbose` and every name read, then the mutation was reverted. Afterwards the md5 of `scripts/resolve.ts` (`a155a2ce…`), `etl-actor.ts` (`0d304211…`) and `score.ts` (`3f2b43f3…`) matched the committed files, and `git diff --stat` was empty.

| Mutation | Red, by name (everything else green) |
|---|---|
| **T-3-15:** `resolveEtlOrg` returns before installing the claim (it sets only `app.actor_id`) | `the pass runs from an owner connection with no claims`, `stage 0 preflight resolves the org before any stage`, `a block over the cap is named in the run report`. **All 8 permissive-claim tests stayed green, including tests 1–5.** |
| **M25, script:** `mergeCandidate` reads `mc.left_id`/`mc.right_id` instead of `coalesce(merged_into_id, id)` | `a chain-flagged pair is never auto-merged` (the via-root pair merged) and `the pass is deterministic` (`merged: 2`: the distinct check lost the cluster) |
| **M25, definer:** `app.record_merge`'s winner/loser `coalesce` removed via `create or replace` **inside the test's own `withRollback` transaction** (never committed) | `a three-way cluster merges to one winner through the pass` **only**: `22023 record_merge: candidate does not name this pair` (line 62) |
| chain skip disabled | `a chain-flagged pair is never auto-merged` only (`{decision:'pending', score: 95}` not matched) |
| R2 cap disabled (in `score.ts`) | `a chain-flagged pair is never auto-merged` (the score is not 94) and `three identical names read as a chain…` (`merge: 3`) |
| merge order `score desc, id asc` (the plan's literal form) | `the pass is deterministic` (`expected 2 to be 1`, two outcomes across 8 runs), red **3 out of 3** runs |
| merge queue `decision <> 'merged'` (admits `distinct`) | `an unmerged pair is never re-proposed` (`considered: 1`). With the per-candidate pending check also removed it is still red by name: the cluster-distinct check catches the pair, and the definer's 55000 sits behind that |
| scorer read loses `mc.org_id = $1` | first green (the org-bound write-back was doing the job). I tightened test 5 with `scored 1` and the exact bands, and then `the pass is org-scoped` went red (`expected 2 to be 1`) |
| cluster-distinct skip disabled | `the pass is deterministic` only |
| plan guard never refuses | `the trigram plan guard refuses a plan without the GIN index` only (`promise resolved "'gin'"`) |

**The T-3-15 red, verbatim** (what the plan asked to quote):

```
 × … > the pass runs from an owner connection with no claims 136ms
   → record_merge: no current org
 × … > stage 0 preflight resolves the org before any stage 70ms
   → resolve: stage 0 preflight failed for --org=org_A: app.current_org_id() is NULL, expected b8b1dfa6-…. Every merge and the run report would raise 42501 (no current org); nothing has been written.
 × … > a block over the cap is named in the run report 97ms
   → resolve: stage 0 preflight failed for --org=org_A: app.current_org_id() is NULL, …
Serialized Error: { …, code: '42501', …, where: 'PL/pgSQL function app.record_merge(uuid,uuid,uuid,text,integer,jsonb,jsonb) line 17 at RAISE', … }
      Tests  3 failed | 8 passed (11)
```

## Deviations from Plan

### 1. [Rule 1 - Bug] The auto-merge tiebreak is the business pair, not the candidate `id`
- **Found during:** Task 2, while designing `the pass is deterministic` so that it could actually fail.
- **Issue:** The plan says `order by score desc, id asc` "makes a re-run deterministic". `merge_candidates.id` is `gen_random_uuid()`, so any regeneration of the candidate set reshuffles equal-score ties. When a `distinct` decision spans a triangle, the order decides which edge merges. Measured: the plan's form reds the determinism test 3 out of 3 runs.
- **Fix:** `order by mc.score desc, mc.left_id asc, mc.right_id asc`. `(org_id, left_id, right_id)` is unique, so the order is total and stable across regenerations.
- **Commit:** `c2038f0`

### 2. [Rule 2 - Correctness] Chain and distinct checks are cluster-aware
- **Issue:** The plan's skips ("`chain_key` on either side", "decision='distinct'") look only at the raw candidate. A pair can reach a chain member through its cluster root, when a side was merged into a flagged business. It can also re-merge two clusters that a reviewer split, through a different edge. The raw check misses both.
- **Fix:** After the re-point, `mergeCandidate`:
  - checks `chain_key` on both raw sides **and** both roots;
  - skips when any `distinct` candidate spans the two clusters, using an indexed lookup on `(org_id, left_id)` over the members of both roots.
- The script's `coalesce(merged_into_id, id)` re-point is load-bearing for exactly these two guards. That is shown by the script-level M25 row above.
- **Commit:** `c2038f0`

### 3. [Rule 2 - Missing critical functionality] The GIN planner-trap guard (03-10 handoff)
- **What:** Stage 2 runs `gin_clean_pending_list('businesses_name_trgm')` and `analyze businesses`. Stage 3 runs `analyze merge_candidates`.
- **The guard:** B3 is EXPLAINed (never executed) and refused with `TrigramPlanError` unless `businesses_name_trgm` is in the plan. This applies when the org has ≥ 20,000 probe rows.
- **Proof:** test 11 forces the seq-scan plan and watches it refused.
- **Commit:** `c2038f0` / `21ae5da`

### 4. [Test design] The M25 scenario uses the synthetic triple with word-permuted names
- The triple's three records share one `name_norm`, so D-11 flags them as a chain and caps every edge at 94. See the finding below.
- pg_trgm builds trigrams per word, so `synthetic riverside stone` / `riverside stone synthetic` / `stone synthetic riverside` have a measured similarity of exactly 1.0 while being three names.
- The identical-name behaviour is pinned in its own test (9) instead of being hidden.

### 5. [Plan inconsistency] Test 6 drives the stages without the preflight, and a separate test covers the preflight
- The plan wants test 6's red to read `42501 record_merge: no current org`, and it also requires a stage-0 preflight that catches exactly that condition first.
- If test 6 drove `runResolvePass`, its red would be the preflight's message. So test 6 drives stages 1–5 directly (as the plan says: "drive the stages"), and test 7 covers the preflight. Both reds are quoted above.
- Test 1's event-actor assertion was moved to the no-claims tier (test 10). Under the permissive fixture, the claim's `sub` would have made test 1 red on attribution and muddied the "tests 1–5 stay green" demonstration.

### 6. [Scope] Five tests beyond the plan's six
- Named: the preflight, the three-way cluster, identical-name chain, block-cap report and plan guard tests.
- Each one proves a must-have or mitigation that otherwise had no named test:
  - the preflight (T-3-15);
  - M25 through the pass;
  - T-3-12 in the run report;
  - the 03-10 trap guard.

### 7. [Verify command] `$PNPM test:db -- -t "…"` does not filter
- Every targeted run used `npx vitest run --config vitest.db.config.ts --pool=forks tests/db/resolve-pass.test.ts --reporter=verbose`, and the test names were read.

## Findings for later plans

- 🔴 **03-20 / D-11: an unresolved three-way duplicate with one normalized name IS a chain.**
  - `detectChains` counts live rows per `name_norm` before anything merges. Three copies of one business (for example one Comptroller outlet plus two Overture rows at similarity 1.000, the Rio Stone shape) are flagged, capped at 94 and sent to review.
  - That is safe: a review item, never a wrong merge. It is also recall that auto-merge will never take.
  - The desk run should measure how many flagged names have all their members at one `(postal, street_num)`. A "≥3 distinct locations" chain rule would fix it, but that is a D-11 change for danlo, not something to tune here. Test 9 pins today's behaviour so the change will be visible.
- **03-20 perf: `mergePair`'s survivorship read scans the org's businesses once per merge.**
  - The cause is `coalesce(merged_into_id, id) = $1` in `merge.ts`'s `readParents` member SQL, which `businesses_merged_idx` cannot serve.
  - At ~92k rows × ~10k merges this is likely the dominant cost of stage 5. Time it in the desk run. The fix is `id in (...) or merged_into_id in (...)`, which both indexes can serve.
- **03-20:** run `--dry-run` first and read `bands` and `skipped_blocks`. The expected shape is ~29,701 candidates. `trigram_plan` must read `gin` at RGV scale; if it refuses, re-run once (the ANALYZE has then settled) before investigating.
- **03-15 (review queue):**
  - A chain-skipped pair can sit `pending` at 95. It reached the chain through a cluster root, and its own rows carry no flag. The queue should order by score and show the chain badge from the ROOT's `chain_key`, not only from the pair's own rows.
  - Candidates whose side is merged away stay `pending` until a pass re-points them.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register.
- **T-3-01:** `--org` is required, and an unknown or empty org throws before any stage.
- **T-3-15:** preflight, plus the runner re-installing the claim per transaction.
- **T-3-12:** the cap is reported, and the plan guard is added.
- **T-3-08 / T-3-02:** every merge and every `merged` decision goes through `app.record_merge`.
- **T-3-09:** every statement is bound to `$1` org, and test 5 asserts the read too.
- The run-report event carries counts, block keys (a phone number or a postal:street-number, as 03-10 defined them) and timings. It carries no names.

## Self-Check: PASSED

- FOUND: scripts/resolve.ts, tests/db/resolve-pass.test.ts
- FOUND commits: c2038f0, 21ae5da
- STATE.md / ROADMAP.md untouched
