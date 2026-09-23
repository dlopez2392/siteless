---
phase: 03-free-data-spine-entity-resolution
plan: 10
subsystem: entity-resolution
tags: [dedupe, pg_trgm, blocking, gin, chain-detection, closures, DEDUP-01]
requires:
  - 03-02 (score.ts — BLOCK_SIMILARITY_THRESHOLD, Features shape)
  - 03-05 / 0022–0023 (merge_candidates, businesses columns, businesses_name_trgm and the blocking indexes)
  - 03-06 (normalizers write name_norm / phone_blockable; sql-never-normalizes gate)
  - 03-09 (etl-actor, run-report, upsert, _ingest-fixtures)
  - 03-12 (applyClosures / CLOSURE_UPDATE_SQL and ingest_runs.stats.statewide_name_frequency — consumed, not built here)
provides:
  - src/lib/resolve/block.ts — phoneBlockSql (B1), addressBlockSql (B2′), trigramLateralSql (B3), distanceGateSql (D-10), MAX_BLOCK_PAIRS, runBlock, runDistanceGate
  - src/lib/resolve/chain.ts — chainDetectionSql / detectChains (D-11 flag, statewide-aware)
  - tests/unit/block-sql.test.ts 'lateral blocker' — the grep gate over generated SQL
  - tests/db/blocking.test.ts, tests/db/chain-closures.test.ts — ten named DB tests
affects:
  - 03-14 (scripts/resolve.ts calls detectChains, runBlock ×3, runDistanceGate)
  - 03-15 (review queue reads chain_key count and features.distanceM / rule)
tech-stack:
  added: []
  patterns:
    - "SQL generated as { setup, text, values } — inspectable by a unit grep gate, executed by one runner inside the caller's transaction"
    - "set local GUC + read-back guard: a transaction-local setting that did not take (no transaction) is refused, not silently ignored"
    - "block size = ungated n(n-1)/2 from a group-by, refused whole before any pair is expanded"
    - "data-modifying CTEs return their own report row (inserted, skipped blocks; names/rows/flagged/cleared)"
    - "write-gated updates (is distinct from) on event-logged tables so a re-run writes zero events"
key-files:
  created:
    - src/lib/resolve/block.ts
    - src/lib/resolve/chain.ts
    - tests/unit/block-sql.test.ts
    - tests/db/blocking.test.ts
    - tests/db/chain-closures.test.ts
  modified: []
decisions:
  - "Block size is the UNGATED pair count n(n-1)/2, computed before expansion; a block over 500 is refused whole and returned as { block_key, size } for stats.skipped_blocks. B1's real worst block (32 rows = 496 pairs) fits; the 78503/2200 mall does not."
  - "block_key spells the shape and its key: 'phone:<e164>', 'addr:<postal>:<street_num>', 'trgm_zip' (B3, block_size null — bounded 5 per row by construction). Never the normalized name (T-3-11)."
  - "The D-10 gate writes features.distanceM (not distance_m) + rule 'over_25km' — the keys score()'s Features type carries, so the review queue reads one shape."
  - "chain detection clears stale flags (merged-away rows, names that fell below three) and is write-gated; chain_key = name_norm and is exactly as internal as name_norm."
  - "Statewide D-11 frequency is read in SQL from the org's latest COMPLETE tx_comptroller run's stats->'statewide_name_frequency' (that key only) — 03-12's contract; no table, no migration. detectChains reports statewide:true|false so the badge can say 'in Texas' only when it is true."
  - "The closure write is 03-12's applyClosures (scripts/ingest-comptroller.ts); this plan's tests import it rather than re-typing it."
metrics:
  duration: "~2h"
  completed: 2026-09-23
  tasks: 3
  files: 5
requirements: [DEDUP-01]
---

# Phase 3 Plan 10: Candidate generation — blocking, 25 km gate, block cap, chain flag Summary

The three measured blocking shapes (B1 exact blockable phone, B2′ `(postal, street_num)` gated at
similarity ≥ 0.3, B3 the GIN `cross join lateral … order by <-> … limit 5` within `postal`), the
D-10 25 km hard rule, a whole-block cap of 500 pairs that reports what it refused, and D-11
chain detection as a flag. Everything is generated as inspectable SQL, and the resolve pass
(03-14) runs it inside its own transactions through `runBlock`, `runDistanceGate` and `detectChains`.

## What was built

| Artifact | What it does |
|---|---|
| `src/lib/resolve/block.ts` | `phoneBlockSql`, `addressBlockSql`, `trigramLateralSql` return `{ shape, setup, text, values }`. `setup` is `set local pg_trgm.similarity_threshold = 0.45` from the committed constant. `runBlock` runs the setup, **reads the GUC back and refuses if it did not take** (which also catches a caller with no transaction, where `set local` does nothing), then returns `{ inserted, skippedBlocks }`. `distanceGateSql` / `runDistanceGate` mark pending pairs over 25 km `distinct`. The header records every measured pair count and each rejected blocking key. |
| `src/lib/resolve/chain.ts` | `chainDetectionSql` / `detectChains`: `chain_key = name_norm` on live names with ≥ 3 live members, **or** a statewide count ≥ 3 from 03-12's run-row map. Stale flags are cleared. It is write-gated. It returns `{ names, rows, flagged, cleared, statewide }` for `stats`. |
| `tests/unit/block-sql.test.ts` | `lateral blocker`: checks the B3 text has `cross join lateral`, `order by o.name_norm <-> c.name_norm`, `limit 5`, and no `/\bon\b[^;]*%/` join predicate (the regex is built from pieces, and the test checks that the regex does catch the forbidden form). Also checks `phone_blockable = true`, `MAX_BLOCK_PAIRS === 500`, the org binding, and the threshold setup on every shape. |
| `tests/db/blocking.test.ts` | Five named tests (see below). |
| `tests/db/chain-closures.test.ts` | Five named tests (see below). |

## Test counts

- **Unit:** 194/194 across 29 files (`npx vitest run tests/unit`). New: `lateral blocker`.
- **DB:** 148/148 across 21 files (`npx vitest run --config vitest.db.config.ts --pool=forks`). This was run with 03-12's two files copied in from the phase branch, which is the tree after the merge. New tests:
  `the lateral blocker uses the trigram index` · `a toll-free phone forms no block` ·
  `a block over the cap is recorded, not truncated` · `never merges across 25 km` ·
  `candidates are org-scoped` · `chain_key >= 3` · `chain detection skips merged-away rows` ·
  `closure exact match` · `closure applies to the merge winner` ·
  `overture permanently_closed does not write closed_at`.
- 🔴 **On this branch by itself**, `tests/db/chain-closures.test.ts` cannot load, and `tsc` reports the same error: `Cannot find module '../../scripts/ingest-comptroller'`. This is expected. That module is 03-12's and it exists on the phase branch. After the merge it resolves, and all ten tests plus `tsc` are green (verified above with the files copied in; the copies were then deleted and never committed).

## Mutation checks (each red, reverted, `git diff --stat` empty afterwards)

| # | Mutation | Red (and only) |
|---|---|---|
| — | B3 rewritten to `join lateral … on … % …`, then separately a `join businesses z on … % …` added | unit `lateral blocker` (both times) |
| M-a | B3's `%` replaced by the unindexable `similarity(...) >= 0.45` | `the lateral blocker uses the trigram index` (the plan shows the operator as a `Filter:`) |
| M-b | `phone_blockable = true` deleted from B1 | `a toll-free phone forms no block` (inserted 2, expected 1) |
| M-c | cap removed from both B1 and B2′ | `a block over the cap…` (529 written, expected 1) |
| M-c2 | cap removed from B1 only | `a block over the cap…` (phone: 528 inserted, expected 0) |
| M-j | `o.org_id = c.org_id` removed from B3 | `candidates are org-scoped` |
| M-k | gate threshold ×10 | `never merges across 25 km` (0 gated, expected 1). Checked 3×; it was the only red |
| M-d | chain `having count(*) >= 2` | `chain_key >= 3` and `chain detection skips merged-away rows`. Both are correct: a two-member name becomes a chain in both fixtures |
| M-e | `merged_into_id is null` removed from the chain count | `chain detection skips merged-away rows` |
| M-f | `r.status = 'complete'` removed from the statewide read | `chain_key >= 3` (the failed run's bakery gets flagged) |
| M-g | closure match on taxpayer only (`split_part`), in 03-12's statement | `closure exact match` (closed 2, expected 1) |
| M-h | closure target `id` instead of `coalesce(merged_into_id, id)` | `closure applies to the merge winner` |
| M-i | `upsertBusinessFromSource` writes `closed_at` for `permanently_closed` | `overture permanently_closed does not write closed_at` |
| M24 | accent-fold wrapped around `name_norm` inside B3 | **only** `SQL never normalizes` (1 failed / 193 passed) |

## Deviations from Plan

### 1. [Rule 1 — Bug in the plan's test design] The plan-shape test needs production density, not "tens of rows"
- **Found during:** Task 3, the first run of `the lateral blocker uses the trigram index`.
- **Issue:** Measured on PostgreSQL 18. The planner picks its index for the lateral probe based on the **table**, not the statement:
  - 14 rows: `Index Scan on businesses_addr_idx` with `%` as a post-index `Filter`.
  - 1,500 rows in one ZIP: `Seq Scan` with `%` as a `Filter`. That took 13.4 s for 1,514 probes.
  - 1,500 rows with `enable_seqscan = off`: `businesses_org_idx` with `%` as a `Filter`. That took 22 s.
  - 20,000 rows / 15 ZIPs: the btree plus a Filter on one run, the GIN on another.
  - 30k, 45k, 60k and 90k rows (1,500 per ZIP): `BitmapAnd(businesses_addr_idx, businesses_name_trgm)` with `Index Cond: (name_norm % c.name_norm)` on every run.

  The plan's fallback ("a seq scan at fixture scale → assert no Filter line carries `%`") does not describe what happens. At fixture scale the Filter plan is the planner being correct.
- **Fix:** The test first runs B3 on 14 named rows and checks that it writes the expected trigram pairs. It then builds a synthetic spine at real density: 30,000 rows over 20 ZIPs, the smallest size with a stable plan. ANALYZE reads all of it, so the stats are deterministic. It then runs **EXPLAIN without ANALYZE**, because executing 30k GIN probes is the ~100 s desk pass. It asserts `Bitmap Index Scan on businesses_name_trgm`, the `Index Cond`, and no `Filter:` line carrying `%`. The test takes about 5 s.
- **Commits:** 7c4fed0, 4c40c88

### 2. [Rule 1 — Flaky test] The GIN pending list made the plan non-deterministic
- **Found during:** mutation checking. Mutations M-j and M-k do not touch B3, yet they also turned the trigram-index test red.
- **Issue:** `businesses_name_trgm` has fastupdate on. The 30k fresh rows sit in its pending list, and the planner prices those pending pages in. The GIN estimate swung from 163 to 1,692 per probe, and on some runs the plan flipped to a Seq Scan (2,068 per probe).
- **Fix:** Call `select gin_clean_pending_list('businesses_name_trgm'::regclass)` before ANALYZE. Autovacuum does the same thing to a settled table. The test then passed 5/5 on its own. M-k was re-run 3×, and M-a and M-j were re-run: each turned only its own test red.
- **Commit:** 4c40c88

### 3. [Contract alignment with 03-12, per the orchestrator's note] Closure write and statewide frequency
- **Issue:** The plan's tests 3–5 exercise a closure write, but this plan's files did not include one. I first shipped `src/lib/ingest/closure-apply.ts`. 03-12 then completed with `applyClosures` / `CLOSURE_UPDATE_SQL` in `scripts/ingest-comptroller.ts`, which reads the same `payload->>'out_of_business_date'` in America/Chicago. The research SQL's `source_records.closed_at` column does not exist. The plan also said `chainDetectionSql` takes "an optional statewide-frequency table name", but no such table exists.
- **Fix:**
  - Deleted my duplicate closure module. The closure tests now import 03-12's `applyClosures` and assert its `{ closed, viaMerge }` result.
  - `chainDetectionSql(orgId)` now reads `stats -> 'statewide_name_frequency'` (that key only) from the org's latest `status='complete'` `tx_comptroller` run. The statement binds everything and needs no migration.
  - The test seeds that exact shape. It also proves that a **failed** run's map and **another org's** map are both ignored.
- **Commit:** 7e8e746

### 4. [Rule 2 — Coverage] The B1 cap had no test
- Removing only B1's cap stayed green, because the plan's test 3 exercises only the address block. I added a 33-place shared-number block to the same test. It is refused as `phone:+19566300000`, size 528, and nothing is written (mutation M-c2). **Commit:** 7e8e746

### 5. [Minor] `features.distanceM`, not `distance_m`
- The gate writes the camelCase key that `score()`'s `Features` type uses. Otherwise the review queue would have to read two shapes for one fact. **Commit:** f7183c6

### 6. [Minor] The unit gate does not re-check the accent-fold call
- The plan's verification requires that M24 turn **exactly one** test red. The unit test first repeated that check. I removed it so the gate lives only in `sql-never-normalizes`. **Commit:** 4c40c88

## Handoffs / findings for later plans

- 🔴 **03-14 (resolve pass): prepare the GIN before B3.** At production size (≈92k rows, ~60 ZIPs) the planner used the GIN in every probe here. At about 20k rows it did not always. With a large unflushed pending list it chose a **Seq Scan**, which at 92k rows is an O(n²) pass measured in hours, not minutes. Stage 2 should run `select gin_clean_pending_list('businesses_name_trgm'::regclass)` and `analyze businesses` right after the ingests commit and before `runBlock(trigramLateralSql)`. It should also consider `EXPLAIN`ing B3 once and aborting if the plan has no `businesses_name_trgm`. The root cause is that pg_trgm's `%` is priced like a cheap operator. A migration raising `similarity_op`'s cost would fix it at the planner level, but it is out of scope here (03-11 owns 0024).
- **03-14:** `runBlock` must run inside a transaction that already ran `setEtlActor` + `resolveEtlOrg`. It returns `skippedBlocks` in the `{ block_key, size }` shape ready for `stats.skipped_blocks`. `detectChains(...).statewide` tells 03-15 whether "in Texas" is honest.
- **03-15:** `chain_key` equals `name_norm` and must never render. The badge renders the member count only. Gate-written features are `{ distanceM, rule: 'over_25km' }`.

## Known Stubs

None.

## Threat Flags

None. Every statement is org-bound (`$1`, plus `o.org_id = c.org_id` in the lateral), every value is a bound parameter, and nothing new touches a network, auth path or schema.

## Self-Check: PASSED

- FOUND: src/lib/resolve/block.ts, src/lib/resolve/chain.ts, tests/unit/block-sql.test.ts, tests/db/blocking.test.ts, tests/db/chain-closures.test.ts
- FOUND commits: f7183c6, 1321067, 7c4fed0, 7e8e746, 4c40c88
- Acceptance greps: `cross join lateral`, `least(`, `greatest(`, `MAX_BLOCK_PAIRS = 500`, `phone_blockable`, `set local pg_trgm.similarity_threshold` all match in block.ts. `unaccent(` does not match. `having count(*) >= 3`, `merged_into_id is null` (CTE + UPDATE) and `synthetic` match in chain.ts. `over_25km` matches in blocking.test.ts and `permanently_closed` in chain-closures.test.ts.
- No STATE.md / ROADMAP.md changes.
