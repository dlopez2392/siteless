---
phase: 03-free-data-spine-entity-resolution
plan: 15
subsystem: spine read/write tier (queries + server actions)
tags: [queries, server-actions, rls, provenance, entity-resolution, drizzle, adapter]
requires:
  - 03-05 (spine tables, grants: merge_candidates / business_merges / business_aliases / ingest_runs SELECT-only)
  - 03-10 (chain_key = normalized name; statewide frequency on the Comptroller run's stats)
  - 03-11 (merge.ts mergePair / recordCandidateDecision / unmergeBusinesses; the three definers)
provides:
  - src/server/queries/review-queue.ts (readReviewQueue, listReviewQueue, readReviewRemaining)
  - src/server/queries/sources.ts (readSources, listSources)
  - src/server/queries/businesses.ts (readBusinessList, listBusinesses, readBusinessDetail, getBusinessDetail, readClusterOptions)
  - src/server/actions/record-review-decision.ts (recordReviewDecision)
  - src/server/actions/unmerge-business.ts (unmergeBusiness)
  - src/db/drizzle-executor.ts (drizzleExecutor, positionalToSql: EtlExecutor over a drizzle tx)
affects: [03-16 review screen, 03-17 sources screen, 03-18 businesses list, 03-19 business detail]
tech-stack:
  added: []
  patterns:
    - "read*(tx) + list*/get*(claims) split, one withOrg per request"
    - "positional $n → drizzle sql.param chunks; arrays as one array-literal param"
    - "tx-taking action core in a _-prefixed server-only module, never exported from 'use server'"
    - "DB tests on the runtime driver: rolled-back postgres.js/drizzle tx + actAs"
key-files:
  created:
    - src/server/queries/review-queue.ts
    - src/server/queries/sources.ts
    - src/server/queries/businesses.ts
    - src/server/actions/record-review-decision.ts
    - src/server/actions/unmerge-business.ts
    - src/server/actions/_merge-decisions.ts
    - src/db/drizzle-executor.ts
    - tests/unit/drizzle-executor.test.ts
    - tests/db/_drizzle-tx.ts
    - tests/db/run-report.test.ts
    - tests/db/provenance-render.test.ts
    - tests/db/review-actions.test.ts
  modified:
    - tests/unit/sql-never-normalizes.test.ts
    - tests/unit/server-actions-guard.test.ts
decisions:
  - "The drizzle→EtlExecutor adapter binds every $n with sql.param (one placeholder per value), sends a JS array as ONE Postgres array-literal string, and refuses Date / plain objects / dollar-quoting / E-strings by name"
  - "The chain flag crosses the query boundary as { members, statewide } — chain_key itself (= the normalized name) is never selected"
  - "D-18 fields carry provenance 'cited' | 'derived' | 'none' with value and sourceRecordId independent, so 'Not stored' and 'No durable source' are separately renderable"
  - "readSources reads only stats->'confidence_bands' (Overture row), never the whole stats"
  - "Refusal copy uses the existing REVIEW_DECISION_FAILED / UNMERGE_FAILED / NOT_FOUND; the reason travels in detail.reason (copy gap recorded, copy.ts not edited)"
metrics:
  duration: ~40 min
  completed: 2026-09-23
  tasks: 3
  files: 14
---

# Phase 3 Plan 15: Spine query modules and review/unmerge actions Summary

The four Phase 3 screens now have their whole data tier: three org-scoped, single-transaction query modules (review queue, sources ledger, businesses list + detail with per-field provenance) and two server actions (review decision, unmerge). The actions write only through the 03-11 definers, and a new drizzle→`EtlExecutor` adapter carries the writes. The adapter is proven on the runtime driver against the real database.

## What was built

**Task 1: query modules** (`d72b86e`)
- `review-queue.ts`: the top pending pair (`decision='pending' and score >= 80`, `order by skipped_at nulls first, score desc, id`) plus the remaining count over the same predicate. Each side carries `displayName` (verbatim), street / city / postal / phone / basic category. The cluster is resolved to `industry_clusters.display_name`, with the org's own row winning over the built-in. The side also carries the creating source, `closedAt`, and a chain flag `{ members, statewide }`. `features` passes through verbatim. `readReviewRemaining(tx)` is exported for the action.
- `sources.ts`: a `values` list of the four sources, left-joined laterally to the latest `ingest_runs` row. The result is exactly four rows before and after any run. Instants arrive as epoch-ms text and go through the shared `instantOf`.
- `businesses.ts`:
  - `readBusinessList` covers search, cluster (any / none / key), status (active / closed / merged_away), 50-row pages, a total, and cluster options. The page is fetched first, and its sources come from one join, because `source_records.business_id` has no index.
  - It holds the one allow-listed `unaccent(... ilike ...)` predicate. The query is bound, and `%`, `_` and `\` are escaped.
  - `readBusinessDetail` returns the business, its D-18 fields with provenance, its source records (with a `stale` flag for gone rows), its merge history newest first, and its aliases, all in the caller's single transaction.
  - A non-uuid, unknown or foreign id returns `null`.
- `sql-never-normalizes.test.ts`: `src/server/queries/businesses.ts` is the second and final allow-list entry, added in the same commit. I checked the guard fails without the entry and passes with it.

**Task 2: server actions** (`d2d74f6`)
- `recordReviewDecision` / `unmergeBusiness`: `requireOrg()` first, then `orgClaims()`, then `z.strictObject` + `safeParse`. Each attempt is one `withOrg`.
  - The candidate or merge row is re-read under RLS. A foreign or unknown id returns `not_found`, never `forbidden`.
  - An already-decided pair or already-undone merge returns `conflict`.
  - `40001` is retried up to 3 attempts.
  - Definer refusals are mapped through `pgFailure()`: `42501` → `not_found`; `55000` → `conflict`, with the definer's message told apart in `detail.reason`; `23505` on `business_aliases_key_uniq` → `conflict`, matched with `isUniqueViolationOn`.
- `_merge-decisions.ts`: the transaction-taking core (`decideCandidate`, `undoMerge`). It lives in a `_`-prefixed server-only module so it is never published as a POST endpoint. `undoMerge` reuses `unmergeBusinesses`, which already runs `survive()` over the loser's own parents, so nothing is re-derived.
- `src/db/drizzle-executor.ts`: see "How the adapter is proven" below.
- `server-actions-guard.test.ts` changes:
  - The floor is now a named `MIN_ACTIONS = 8`.
  - The two new files are named explicitly.
  - A new test, `every server action calls requireOrg as its first statement`, parses each exported action body and requires its first code line to be `[const {…} = ]await requireOrg();`. It passes for all 8 actions. I watched it fail when a `safeParse` was inserted above the auth call.

**Task 3: DB tests** (`2c44bc2`, fix `e191b58`)
- `run-report.test.ts`: `run report`, `run report survives a failed run`, `two zones`.
- `provenance-render.test.ts`: `provenance render`, `provenance never leaks the internal columns`, `a foreign business id answers the same as an unknown one`.
- `review-actions.test.ts` (8 tests), added beyond the plan per the 03-11 handoff: the adapter against the real DB, the decision core as a Clerk user, and both actions end to end.
- `_drizzle-tx.ts` is a rolled-back drizzle transaction built exactly like `src/db/client.ts` (postgres.js, `prepare:false`, `max:1`, same schema), but as the owner so fixtures can seed. `actAs(asPg(tx), claims)` then makes it a Clerk user under RLS and the column grants. Nothing commits.

## How the drizzle→EtlExecutor adapter is proven

1. **Unit** (`tests/unit/drizzle-executor.test.ts`, 8 tests):
   - `PgDialect.sqlToQuery` pins the exact statement text and params: one placeholder per `$n`, an array as a single literal (`{"a,b","q\"uote\\",NULL,"NULL"}`), and repeated `$1` bound twice.
   - `$n` inside literals, quoted identifiers and comments is left untouched.
   - Anything `pg` would refuse is refused (a missing param, an unread param). So are Date, object, NaN, nested array, dollar-quote and E-string.
2. **Real database, runtime driver** (`review-actions.test.ts`):
   - `uuid[]` with 1 and 2 elements, and `text[]` with a comma, a quote, a backslash, a real NULL and the string `'NULL'`, all round-trip.
   - One statement with 8 mixed params works: int, text with `'`, boolean, jsonb, a bigint past 2^53, null and float8.
   - A `Date` is refused by name.
   - **The control:** the bare drizzle template `sql\`${[u1,u2]}::uuid[]\`` returns `42846`, and `sql\`${[u1]}::uuid[]\`` returns `22P02`. These are the phase-2 SQLSTATEs, reproduced.
3. **Every fixture statement in the three new DB files runs through the adapter** (`asPg(tx)`): seeding orgs, ingest upserts, merge fixtures, `actAs`. `mergePair`, `recordCandidateDecision` and `unmergeBusinesses` then run through it for real against `app.record_merge`, `app.record_candidate_decision` and `app.undo_merge` as a Clerk user.
4. **Mutation:** I replaced `sql.param(encodeParam(...))` with the bare template. The two adapter tests went red with the exact `22P02 malformed array literal` and an opaque driver error in place of the named Date refusal. Reverted.

## Watched red (mutation → the one test that went red; each reverted, diff confirmed empty)

| Mutation | Red |
|---|---|
| `sources.ts` `left join lateral` → `join lateral` | `run report` (`expected [] to have a length of 4`), `run report survives a failed run` |
| `sources.ts` run order `desc` → `asc` | `run report` (`'older'`), `run report survives a failed run` (`'complete' to be 'failed'`) |
| `sources.ts` epoch taken from `started_at at time zone 'America/Chicago'` | all three incl. `two zones` (`1790029800000 to be 1790047800000`) |
| `businesses.ts` `cited()` keyed on `value === null` instead of the source id | `provenance render` (`'cited' to be 'none'`) |
| `businesses.ts` detail gains `internalNotes: undefined` | `provenance never leaks the internal columns` (`detail carries the key internalNotes`) |
| `businesses.ts` missing row throws instead of `null` | `a foreign business id answers the same as an unknown one` |
| adapter binds through the bare template | both `drizzle executor` DB tests |
| `unmerge-business.ts` reads `.code` off the caught error instead of `pgFailure` | `unmerge maps the definer refusals…` (`code: 'unexpected'`) |
| `record-review-decision.ts` missing → `forbidden` | `a foreign candidate id answers not_found…` |
| `sql-never-normalizes` allow-list without `businesses.ts` | `SQL never normalizes` (names businesses.ts:120/121) |
| a statement before `await requireOrg()` in `unmergeBusiness` | `every server action calls requireOrg as its first statement` |

## Gates (final tree `e191b58`, branch `worktree-agent-a542560218161969f`)

- `tsc --noEmit`: exit 0. `pnpm lint`: exit 0. `pnpm build`: exit 0.
- `pnpm test:unit`: **34 files, 234 tests, all pass.**
- `pnpm test:db`: **26 files, 179 tests, all pass** (25.5 s).
  - `tests/db/with-org.test.ts` runs after `review-actions.test.ts` and stays green, which shows the scoped `vi.doMock` did not leak.
  - `budget-concurrency.test.ts` was green this run.
- Tests were filtered with `npx vitest run <file> -t … --reporter=verbose`, reading the test names, never via `pnpm … -- -t`.

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 3 - Blocking] Added `src/db/drizzle-executor.ts`.** `merge.ts` needs an `EtlExecutor`, and none existed for a drizzle transaction (03-11 handoff). The adapter is not in `files_modified`. Commit `d2d74f6`.
2. **[Rule 2 - Correctness] Added `src/server/actions/_merge-decisions.ts`.** Exporting a transaction-taking helper from a `'use server'` module would publish it as an unauthenticated POST endpoint. The mapping functions (`pgFailure` / `isUniqueViolationOn`) stay in the action files, unexported. Commit `d2d74f6`.
3. **[Rule 2 - Correctness] Added `tests/db/review-actions.test.ts` + `tests/db/_drizzle-tx.ts` + `tests/unit/drizzle-executor.test.ts`.** These cover the handoff requirement to test the adapter with an array param and a multi-param query against the real DB, and to test the action tier through `actAs`, not serviceDb. Commit `2c44bc2`.
4. **[Rule 2 - Security] The chain flag is `{ members, statewide }`, not `chainKey` + count.** `chain_key` *is* `name_norm` (chain.ts; 03-10 handoff: "must never render"). The plan's `CandidatePairView` listed `chainKey`, so this is a shape change. `statewide` records whether "in Texas" is honest: it is true only when the count came from the statewide frequency, and otherwise the count is local.
5. **[Rule 2 - Performance / handoff] `readSources` does not return `stats`.** It returns only `confidenceBands`, read from `stats -> 'confidence_bands'` on the Overture row. The plan said to return `stats`, and the 03-12 handoff says never select the ~400 KB whole. Also added `datasetId`, `finishedAt` and `totalSeen` (needed by `INGEST_RUN_FAILED(rows)`).
6. **[Rule 2] Extra read-model additions for the screens:**
   - `readBusinessList` returns `clusters` (filter options) with `total`, so the page makes one call.
   - The cluster filter is a discriminated `ClusterFilter` (`any` / `none` / `key`) rather than a nullable `clusterKey`, so "No cluster mapped" cannot collide with a key.
   - The detail adds `status`, `mergedInto`, `operatingStatus`, and a `stale` flag per source record for `STALE_SOURCE_RECORD`.
7. **[Rule 1 - Bug] Fixture error text named the Overture bucket host.** `tests/unit/no-network.test.ts` flagged it. The text was changed. Commit `e191b58`.
8. **Server-actions-guard count:** the plan says "now covering nine actions". The directory has **eight** (six from 02-09 plus these two). The floor is set to 8 and the two new files are named. I also added the stricter first-statement test (see Task 2).
9. **Acceptance nit:** `head -20 record-review-decision.ts` shows `'use server'` and the `requireOrg` import, but the `await requireOrg()` statement is at line ~67, below the header doc and the unexported mapping function. The property is now enforced mechanically by `every server action calls requireOrg as its first statement`. `grep -rn "Intl\." src/server/queries/` matches only the pre-existing `preset-cards.ts` (a comment) and `preset-editor.ts`, none of this plan's files.

### Copy gaps (recorded, `src/lib/ui/copy.ts` NOT edited: 03-04 owns it)

- **Review "somebody decided this pair first"** has no string. The action returns `conflict` + `REVIEW_DECISION_FAILED` + `detail.reason: 'already_decided' | 'marked_distinct' | 'concurrent_merge'`. That sentence says "this pair is still pending", which is false in the already-decided case. The 03-16 screen should branch on `code === 'conflict'` (reload the queue) until a dedicated string exists.
- **Unmerge "already undone"** returns `conflict` + `UNMERGE_FAILED` + `detail.reason: 'already_undone'`. That sentence says "still merged exactly as they were", which is false here and accurate for `later_merge_first`, `lead_key_in_use` and `concurrent_merge`. A dedicated "undo the later merge first" sentence would also help 03-19.

## Deferred / follow-ups (kept here, not in deferred-items.md, to avoid a merge conflict with sibling 03-14)

- **No index on `source_records.business_id`.** The list (one join per page) and the detail each seq-scan `source_records` once, about 100k rows at production size. That is acceptable for v1, and a `(org_id, business_id)` index is a one-line migration for a later plan. This plan adds no migrations.
- **Race window in the review decision.** `authenticated` cannot `select … for update` a candidate (SELECT-only), and `app.record_merge` deliberately allows a `review` merge of a `distinct` pair. So if two reviewers act within milliseconds, a "Different" can be followed by a "Same business" on the same pair. The pre-read narrows the window but cannot close it. A `decision = 'pending'` guard for `reason='review'` inside `record_merge` would close it; that belongs to the owner of `0024`.
- **Unqualified `unaccent(` on production.** Locally `unaccent` lives in `public`. On Supabase, if the extension pre-existed in the `extensions` schema, the unqualified call relies on the role's `search_path` including `extensions` (Supabase's default does). Worth one `EXPLAIN` of the search on production before 03-18 ships.

## Known Stubs

None. Every exported read returns live rows. The screens that render them are 03-16 to 03-19.

## Threat Flags

None beyond the plan's register. T-3-10 and T-3-09: `requireOrg()` first (now enforced per body), re-read under RLS, `not_found` never `forbidden`. T-3-08: writes only via definers; tests assert `merged_by` / `decided_by` / `undone_by` = the Clerk subject. T-3-11: internal columns never selected; key-set test over detail, list and queue. T-3-05: search over bound, LIKE-escaped params; the allow-list is a named path.

## TDD Gate Compliance

The plan is `type: execute`, not TDD. The tests were written after the implementation, and each was watched failing against a targeted mutation (table above) rather than against a missing implementation.

## Self-Check: PASSED

- FOUND: src/server/queries/{review-queue,sources,businesses}.ts, src/server/actions/{record-review-decision,unmerge-business,_merge-decisions}.ts, src/db/drizzle-executor.ts, tests/unit/drizzle-executor.test.ts, tests/db/{_drizzle-tx,run-report,provenance-render,review-actions}.test.ts / .ts
- FOUND commits: d72b86e, d2d74f6, 2c44bc2, e191b58
- No file deletions in `9217536..HEAD`; STATE.md / ROADMAP.md untouched.
