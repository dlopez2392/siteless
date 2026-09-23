---
phase: 03-free-data-spine-entity-resolution
plan: 11
subsystem: entity-resolution
tags: [merge, unmerge, survivorship, security-definer, rls, cross-org, etl-tier, dedup]
requires:
  - phase: 03-01
    provides: "pg_trgm / unaccent, app.distance_m"
  - phase: 03-02
    provides: "the synthetic three-way triple (tests/unit/fixtures/merge-triple.json)"
  - phase: 03-05
    provides: "business_merges, business_aliases, merge_candidates (SELECT-only for authenticated), the three new provenance pairs, business_merges_loser_uniq, business_aliases_key_uniq"
  - phase: 03-09
    provides: "setEtlActor + resolveEtlOrg (the desk tier's org claim), EtlExecutor, the shipped ingest write path the fixtures seed through"
provides:
  - "src/lib/resolve/survivorship.ts: survive(parents), the one D-14 function, with SourceRecordView / SurvivingFields"
  - "src/lib/resolve/merge.ts: mergePair, unmergeBusinesses, recordCandidateDecision, sourceRecordView, survivorshipJson"
  - "drizzle/0024_merge_functions.sql: app.record_merge, app.undo_merge, app.record_candidate_decision (SECURITY DEFINER), plus owner-only helpers app.survivorship_snapshot / app.apply_survivorship"
  - "tests/db/_merge-fixtures.ts: seedMergePair, seedTriple, seedComptrollerSide, seedOvertureSide, seedCandidate, CLAIMS_A/B, SURVIVORSHIP_COLUMNS"
affects: [03-14, 03-15, 03-20, 03-21]
tech-stack:
  added: []
  patterns:
    - "Definer takes caller ids, re-reads each under org_id = v_org with a named 42501 guard; the snapshot it restores from is read inside the definer, never passed in"
    - "One fixed survivorship column list in SQL (snapshot + apply), independently re-typed in the tests"
    - "Live-DB mutation harness: mutated create-or-replace from the migration's own statement text, full suite, restore from the file, md5(pg_get_functiondef) compared"
key-files:
  created:
    - src/lib/resolve/survivorship.ts
    - src/lib/resolve/merge.ts
    - drizzle/0024_merge_functions.sql
    - drizzle/meta/0024_snapshot.json
    - tests/unit/survivorship.test.ts
    - tests/db/_merge-fixtures.ts
    - tests/db/merge-unmerge.test.ts
    - tests/db/alias-consistency.test.ts
  modified:
    - drizzle/meta/_journal.json
key-decisions:
  - "record_merge takes no p_winner_fields_before: the definer reads the winner's snapshot itself under the row lock. A caller-supplied snapshot could be forged or stale, and unmerge writes it back"
  - "mergePair takes the candidate's two ids (leftId/rightId) and picks the winner itself (older created_at, then smaller id, of the two cluster roots). It passes the RAW oriented ids to the definer, so the definer's coalesce re-point is load-bearing and M25 is observable"
  - "Clusters are flattened on merge (anything merged into the loser is re-pointed to the winner, with its aliases); unmerge is last-in-first-out and un-flattens through the live merge chain"
  - "record_merge returns NULL and marks the candidate 'merged' when both sides already resolve to one business (the third edge of a triangle)"
  - "record_merge refuses reason='auto' on a candidate marked 'distinct' (55000): D-20 enforced at the DB, not only by the resolve pass"
  - "execute is revoked from anon on the three definers and from every non-owner role on the two helpers: 0000_bootstrap's default privileges grant EXECUTE on each new app.* function to anon/authenticated/service_role, so `revoke ... from public` alone left both roles holding it (measured)"
requirements-completed: [DEDUP-02, DEDUP-03]
duration: ~50min
completed: 2026-09-22
---

# Phase 3 Plan 11: Survivorship, Merge and Unmerge Summary

**Merges are now rows, never deletes. `survive()` is the single D-14 function, and both merge and unmerge call it. Three `SECURITY DEFINER` functions are the only write path to `business_merges`, `business_aliases` and `merge_candidates`. Each one re-reads every caller-supplied id under `org_id = v_org` and refuses a foreign id by name with `42501`. Both caller tiers are proven on the live local DB: a Clerk user through `actAs`, and the desk resolve pass through the owner connection with `resolveEtlOrg`.**

## Performance

- **Duration:** about 50 min
- **Tasks:** 3/3
- **Files:** 8 created, 1 modified

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 RED | `f892e18` | `tests/unit/survivorship.test.ts`, failing: module not found |
| 1 GREEN | `4de7c5f` | `src/lib/resolve/survivorship.ts` |
| 2 | `bfda6ea` | `drizzle/0024_merge_functions.sql` + journal + snapshot, and `src/lib/resolve/merge.ts` |
| 3 | `0bcf30c` | `tests/db/_merge-fixtures.ts`, `merge-unmerge.test.ts`, `alias-consistency.test.ts` |

## Verification (every command run, output read)

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint .` | exit 0 |
| `vitest run tests/unit` | **29 files, 201 tests passed**, including the 8 `survivorship:` tests, each name read |
| `db:migrate` (test target) | 0024 applied; `__drizzle_migrations` id 28 has `created_at = 1790129393596`, and the journal is linear 0023 → 0024 |
| `db:generate` | "No schema changes, nothing to migrate" |
| full `test:db` (verbose) | **21 files, 155 tests passed**. My 17 are all present by name |
| `next build` | exit 0 |
| `pg_proc` | `record_merge`, `undo_merge` and `record_candidate_decision` all have `prosecdef = t` and `proconfig = {search_path=public}`. Both helpers are `prosecdef = f` with `search_path=public` |
| `proacl` | definers: `{postgres, authenticated, service_role}` (anon and PUBLIC hold nothing). Helpers: `{postgres}` only |
| `org_id = v_org` (non-comment lines of 0024) | 29 (acceptance ≥ 10) |
| `not in this org` (non-comment lines of 0024) | 9 (acceptance ≥ 5) |
| `org_id = v_org` in the APPLIED `pg_get_functiondef(undo_merge)` | 14 (acceptance ≥ 4) |
| `emit_event` / `coalesce(merged_into_id, id)` in 0024 | 3 / 5 |
| Shared DB after all runs | `orgs` = 2, no `org_A`/`org_B`, and 0 rows in each of `business_merges`, `business_aliases` and `merge_candidates` |

### Named DB tests (17)

`merge-unmerge.test.ts`:

- `every parent survives`
- `unmerge restores`
- `never auto-re-merges`
- `three-way cluster`
- `merge is audited`
- `key survives merge`
- `merged_by cannot be forged`
- `positive control: org A unmerges its own merge`
- `undo_merge refuses a cross-org merge id`
- `record_merge refuses a cross-org loser id`
- `record_merge refuses a cross-org candidate id`
- `positive control: org A records distinct on its own candidate`
- `record_candidate_decision refuses a cross-org candidate id`
- `skip leaves the candidate pending and stamps skipped_at`
- `record_merge succeeds from an owner connection with no claims`
- `undo_merge and record_candidate_decision succeed from an owner connection with no claims`

`alias-consistency.test.ts`:

- `alias consistency` (three measurements, each with a live-alias-count positive control)

### Tiers proven

- **App tier (a Clerk user):** `actAs(c, CLAIMS_A)` with `sub: user_reviewer_A`. It goes through the shipped `merge.ts` under RLS, and `merged_by`, `decided_by` and `undone_by` are all `user_reviewer_A`.
- **Desk tier (the resolve pass):** the owner connection with no `actAs`, and `setEtlActor(x,'resolve')` plus `resolveEtlOrg(x,'org_A')`. Before the call, the test asserts that no claims are set and that `current_user` is not `authenticated`. `record_merge`, `undo_merge` and `record_candidate_decision` all succeed, attributed `etl:resolve`. The three-way cluster also runs on this tier.

### Watched red (live-DB mutations via `create or replace` from the migration's own statement text; each restored from the file and verified by `md5(pg_get_functiondef)` against the pre-mutation capture)

| Mutation | Red, by name (everything else green) | md5 restored |
|---|---|---|
| **Task 1 RED:** no module | `survivorship.test.ts`: `Cannot find package '@/lib/resolve/survivorship'` | n/a |
| survivorship: closure-only filter removed | `survivorship: closed_at comes only from a tx_comptroller_closures parent` | file `cmp` identical |
| survivorship: google filter removed | `survivorship: a google_places parent never supplies a source id (T-3-06)` | identical |
| survivorship: Census Exact tier broken | `survivorship: lat/lng prefer Overture, then Census Exact, then Census Non_Exact last` | identical |
| **M21:** unmerge skips `decision='distinct'` | `never auto-re-merges` only (`expected { decision: 'merged' } to deeply equal { decision: 'distinct' }`). `unmerge restores` stayed green | `81cbfbff…` = before |
| **M25:** `coalesce(merged_into_id, id)` removed from the winner and loser reads | `three-way cluster` only (`record_merge: candidate does not name this pair`) | `c91f499c…` = before |
| M25 plus the pair check disabled | `three-way cluster` only (`a concurrent merge moved this pair; retry`) | = before |
| M25 plus the pair check and the root re-check disabled | `three-way cluster` only (`duplicate key … business_merges_loser_uniq`) | = before |
| **T-3-10:** `and org_id = v_org` removed from undo_merge's `business_merges` read | `undo_merge refuses a cross-org merge id` only | `81cbfbff…` = before |
| **T-3-16:** removed from record_merge's candidate read | `record_merge refuses a cross-org candidate id` only | `c91f499c…` = before |
| T-3-16: removed from record_merge's loser read | `record_merge refuses a cross-org loser id` only | = before |
| removed from record_candidate_decision's read | `record_candidate_decision refuses a cross-org candidate id` only | `637dfec1…` = before |
| alias `released_at` stamp removed from undo_merge | `key survives merge` and `alias consistency` (`expected 2 to be 1`) | = before |
| record_merge emits no merge event | `merge is audited` only (`expected [] to have a length of 1`) | = before |
| **T-3-15:** `resolveEtlOrg` returns before installing the claim (sets only `app.actor_id`) | the three desk-tier tests (below). All 14 `actAs`-tier tests stayed green | file md5 `0d304211…` = backup; `git diff --stat` empty |

**The T-3-15 red, verbatim:**

```
 × tests/db/merge-unmerge.test.ts > merge and unmerge (DEDUP-02) > three-way cluster 186ms
   → record_merge: no current org
 × tests/db/merge-unmerge.test.ts > the desk tier (T-3-15): owner connection, no Clerk claims > record_merge succeeds from an owner connection with no claims 101ms
   → record_merge: no current org
 × tests/db/merge-unmerge.test.ts > the desk tier (T-3-15): owner connection, no Clerk claims > undo_merge and record_candidate_decision succeed from an owner connection with no claims 115ms
   → record_merge: no current org
Serialized Error: { ..., code: '42501', ..., where: 'PL/pgSQL function app.record_merge(uuid,uuid,uuid,text,integer,jsonb,jsonb) line 17 at RAISE', ... }
      Tests  3 failed | 14 passed (17)
```

**What the org-predicate deletions showed.** Every cross-org test reds when its predicate is deleted. Each also hits a second org-scoped read downstream before any cross-tenant write can happen:

- the T-3-10 deletion was stopped by the org-scoped loser read, which raised `55000 undo the later merge first`;
- the T-3-16 deletions were stopped by the org-scoped pair check, which raised `22023`.

The tests pin the first guard's exact message, so they still go red, and that is the behaviour the plan requires.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Security] `revoke ... from public` did not revoke anything that mattered.** Found during Task 2, on the first apply.
- **Issue:** `0000_bootstrap` sets `alter default privileges in schema app grant execute on functions to authenticated, anon, service_role`. After the first apply, `has_function_privilege('anon', …)` was still true for all five functions, and the two internal helpers were callable by `authenticated`.
- **Fix:** revoke from each role by name. The definers now revoke from `public, anon`. The helpers revoke from `public, anon, authenticated, service_role`.
- **Re-apply:** I dropped my five functions and my own `__drizzle_migrations` row (id 27), then re-ran `db:migrate` (new row id 28), so the applied state equals the committed file. `proacl` was read back afterwards.
- **Commit:** `bfda6ea`

**2. [Rule 2 - Security] `p_winner_fields_before` was removed from `app.record_merge`'s signature.**
- **Issue:** unmerge writes `winner_fields_before` back into the winner. A caller-supplied snapshot is therefore a write path to arbitrary winner fields, and it can also be stale.
- **Fix:** the definer reads the snapshot itself with `app.survivorship_snapshot`, after `for update` on both roots.
- **New signature:** `app.record_merge(p_winner_id, p_loser_id, p_candidate_id, p_reason, p_score, p_features, p_winner_fields_after)`
- **Commit:** `bfda6ea`

**3. [Rule 2 - Security] Cited source records are checked for tenancy.**
- **Issue:** the composite provenance FKs check durability, not org, so a `*_source_id` in the fields jsonb could cite another tenant's source record.
- **Fix:** `app.apply_survivorship` refuses that with `42501 '<caller>: cited source record not in this org'`, and refuses unknown keys with `22023`.
- **Consequence for an acceptance grep:** `grep -n source_records drizzle/0024…` matches one non-comment line: this read-only tenancy check. **Nothing in 0024 writes `source_records`.**

**4. [Rule 1 - Correctness] Pairwise merging needs flattening and LIFO unmerge.**
- **Issue:** with a deterministic oldest-wins rule, edge order can make a root that already has losers lose to an older business. That forms a chain, which M25's own invariant forbids.
- **On merge:** anything merged into the loser, and its live aliases, is re-pointed to the winner.
- **On unmerge:** it refuses with `55000 undo_merge: undo the later merge first` unless the merge is the latest live one into its winner and the loser still hangs directly off it. It then un-flattens through a recursive walk of the live merge chain.
- **Why LIFO:** `winner_fields_before` is only exact while nothing later has merged into the winner, so a non-LIFO undo would silently drop a later merge's fields.
- **Ordering:** `merged_at = clock_timestamp()`, so two merges in one transaction are ordered.

**5. [Rule 2 - Correctness] Other guards the plan did not list.**
- `record_merge` returns NULL and marks the candidate `merged` when both sides already resolve to one business.
- It refuses a candidate that does not name the (re-pointed) pair (`22023`).
- It re-checks both sides are still roots after the row lock (`40001`, retry).
- It refuses `reason='auto'` on a `distinct` candidate (`55000`), which is D-20 enforced at the DB.
- `record_candidate_decision` refuses an already-decided candidate (`55000`) instead of silently doing nothing.

**6. [Plan inconsistency] `mergePair`'s input is `{ candidateId, leftId, rightId, reason, score, features }`, not `{ winnerId, loserId, … }`.**
- The plan requires the winner to be picked deterministically inside `merge.ts`, and both callers only know the candidate's pair.
- `mergePair` returns `{ mergeId, winnerId, loserId }`, where `mergeId` is null in the one-cluster case.
- It passes the raw ids, oriented, rather than the roots, so the definer's re-point is the one that counts (see M25).

**7. [Plan inconsistency] Two verify commands do not work as written.**
- **"Restore with `$PNPM db:migrate`":** drizzle skips a migration already recorded in `__drizzle_migrations`, so after a live `create or replace` that command is a no-op that reports success. The harness instead restored each function by executing its original statement from `0024`, then compared `md5(pg_get_functiondef)` to the pre-mutation capture. All six matched (table above).
- **`$PNPM test:unit -- -t "survivorship"` / `$PNPM test:db -- -t "every parent survives"`:** these do not filter (the environment notes say this is proven 6×). I ran each file by path with `--reporter=verbose` and read every test name.

**8. [Scope] `tests/db/_merge-fixtures.ts` is a new file.** It is not in `files_modified`. The seeders live here rather than in `_ingest-fixtures.ts` because 03-12 and 03-13 extend that file in the same wave.

### Expectation that could not hold as literally phrased

- **M25 "reds `three-way cluster` only":** it does, at every depth. But the cause is the definer's three backstops (pair check → root re-check → `business_merges_loser_uniq`), not the test's chain query. The chain assertion is shadowed by those layers on this fixture.
- **"No `merged_into_id` pointing at a merged row"** is also asserted org-wide in the test, and it holds.

## Handoffs

- **03-14 (resolve pass):**
  - Call `setEtlActor(x,'resolve')` and `resolveEtlOrg(x, org)` in every transaction, then `mergePair(x, { candidateId, leftId, rightId, reason:'auto', score, features })` in descending score. A `mergeId` of null is normal on the third edge of a triangle.
  - Candidate generation must never flip a `distinct` row back to `pending`. The definer refuses `auto` on `distinct` regardless (55000). That refusal aborts the transaction, so generation should skip those pairs rather than rely on it.
- **03-15 (review server action):**
  - `merge.ts` takes the pg-style `EtlExecutor`. From `withOrg`'s drizzle transaction you need a small `{ query(text, params) }` adapter (positional `$n` → drizzle `sql` chunks). None exists yet.
  - Catch errors through `pgFailure()`, because the SQLSTATE is on `err.cause`.
  - 42501 means a foreign or stale id. `55000` covers two cases, each with its own message: undo the later merge first / pair already decided / already undone. `40001` means retry.
- **03-12 / 03-13 (payload shapes `sourceRecordView` reads):**
  - A Census record needs `lat`, `lng` and `matchType` ('Exact'|'Non_Exact'), and needs `external_id` = the Comptroller key or `business_id` set.
  - A closure record: `out_of_business_date` (parsed with `closureRowToSourceRecord`).
  - Overture: `name_primary`/`name`, `phones.items[0]`/`phone`, `freeform`/`street`, `postcode`, `locality`, `lat`, `lng`, `basic_category`, `confidence`, `operating_status`.
  - If 03-13 stores a different spelling, `survive()` will see a null field and the merge will null it on the winner. `unmerge restores` would catch that only for fixture-shaped payloads.
- **03-21 (prod apply):** 0024 needs 0022/0023 first. It changes no tables and adds no data.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The definers are the surface T-3-08, T-3-10, T-3-15 and T-3-16 describe, and each is mitigated in SQL and proven by a named test above. The two helpers are owner-only (`proacl = {postgres=X}`).

## Self-Check: PASSED

- FOUND: src/lib/resolve/survivorship.ts, src/lib/resolve/merge.ts, drizzle/0024_merge_functions.sql, drizzle/meta/0024_snapshot.json, tests/unit/survivorship.test.ts, tests/db/_merge-fixtures.ts, tests/db/merge-unmerge.test.ts, tests/db/alias-consistency.test.ts
- FOUND commits: f892e18, 4de7c5f, bfda6ea, 0bcf30c
- STATE.md / ROADMAP.md untouched
