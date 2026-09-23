---
phase: 03-free-data-spine-entity-resolution
plan: 20
status: complete
subsystem: ingest + entity-resolution
tags: [desk-run, measurements, runbook, data-04, dedup-01, d-04, d-07, d-11, tuning]
requires:
  - phase: 03-02
    provides: "score.ts and the two TUNED BY THE DESK RUN constants, merge-pairs.json"
  - phase: 03-12
    provides: "scripts/ingest-comptroller.ts"
  - phase: 03-13
    provides: "scripts/ingest-overture.ts"
  - phase: 03-14
    provides: "scripts/resolve.ts"
provides:
  - "docs/runbooks/ingest.md: the cold-start procedure, the step-1a org preflight before the three commands, measured expectations, the re-run check"
  - "docs/measurements/03-desk-run.md: the first full RGV run's real numbers, the re-run proof at ~92k rows, and danlo's four answers"
  - "foldClosureDuplicates: the closure feed folded to one record per key (latest date)"
  - "the Census pass writes a location only for a new or changed census record"
  - "PHONE_LIFT_MIN_NAME_SIM = 0.3: R4 lifts a shared phone + ZIP to review only at name sim >= 0.3"
  - "OVERTURE_CONFIDENCE_CUTOFF = 0.3; BLOCK_SIMILARITY_THRESHOLD = 0.45 confirmed"
  - ".planning/phases/03-free-data-spine-entity-resolution/deferred-items.md"
affects: [03-15, 03-17, 03-21, 03-22]
tech-stack:
  added: []
  patterns:
    - "A desk-run defect is fixed test-first against the shipped pass function (etlTransactions nested), then the real run is repeated to prove it"
    - "A tuned rule constant is a Weights entry read by score(), pinned at its boundary (0.29 / 0.30) by one named test"
key-files:
  created:
    - docs/runbooks/ingest.md
    - docs/measurements/03-desk-run.md
    - tests/db/geocode-rerun.test.ts
    - .planning/phases/03-free-data-spine-entity-resolution/deferred-items.md
  modified:
    - scripts/ingest-comptroller.ts
    - src/lib/resolve/score.ts
    - tests/unit/score.test.ts
    - tests/unit/ingest-comptroller.test.ts
    - tests/unit/fixtures/merge-pairs.json
key-decisions:
  - "danlo 2026-09-23: cutoff 0.3 (was 0.5): junk 3.4%/3.3% at 0.3-0.5 vs 6.8% at 0.5-0.6; drops 2,680 rows (4.7%)"
  - "danlo 2026-09-23: pairs ok; known_miss flags kept; P03's real pair is Comptroller<->Overture at 84 review, so the modelled recall gap is not in the data"
  - "danlo 2026-09-23: threshold 0.45 confirmed, plus the phone rule PHONE_LIFT_MIN_NAME_SIM = 0.3 (an approved scoring-rule change)"
  - "danlo 2026-09-23: D-11 kept for Phase 3; the 'chain needs >= 3 members more than 500 m apart' amendment is deferred"
  - "The closure feed repeats keys: fold to the latest date per key before writing, or a re-run can never be unchanged"
  - "The Census pass is gated on its own source record's outcome, not on 'is distinct from', so it never overrides merge survivorship"
requirements-completed: [DATA-01, DATA-02, DATA-04, DEDUP-01]
metrics:
  duration: "~2h35m wall clock (2026-09-23T03:07Z-04:43Z Task 1 + checkpoint; Task 3 ~30 min)"
  completed: 2026-09-23
  tasks: 3
  files: 9
---

# Phase 3 Plan 20: The desk run — real RGV numbers, the re-run proof, and the tuned constants

**Both ingests and the resolve pass ran against the live sources into the local test database for
danlo's org. The run surfaced two re-run defects that no fixture could have found, and both are
fixed test-first. A third identical run then wrote zero `businesses` events at ~92k rows. danlo
answered the four checkpoint questions. The confidence cutoff moved to 0.3, the blocking
threshold was confirmed at 0.45, and a new phone-lift floor took 4,667 pairs out of the review
queue (12,591 → 7,975).**

## What ran

- **Target:** the local `siteless_test` database, org `org_3Jf2trxDQzIC3yX4sgZki3kE3ky` →
  `e84528f7-224a-454c-8b10-a04c38381577`. danlo's only Clerk dev org, "BIS"; I read that from
  Clerk and wrote nothing. Production was never touched, and 03-21 owns that run.
- **Sources:** Overture `2026-08-19.0`, still the only release in the bucket. Permits
  `rowsUpdatedAt` `2026-09-19T08:05:21Z`, closures `2026-09-21T15:48:35Z`.
- **Step-1a preflight:** printed `e84528f7-…`, non-null and equal to `orgs.id`, before anything
  ran.

### Run 1 numbers

| Source | Rows | Match to research |
|---|---|---|
| Permits | 34,928 | exact |
| Closures | 21,509 | exact |
| Overture Texas side | 56,944 | exact |
| Overture confidence bands | per band | row for row |
| Overture duplicate rate | 9.2 % | exact |
| Overture chains | 17.2 % | exact |

- **Census:** 79.9 % matched, against a researched 70.9 %.
- **Resolve:** 79,484 candidates (research's 29,701 counted cross-source pairs only), 1,077
  auto-merged, and a 12,591-item review queue.

### Wall clock

About 30 minutes from cold, against the plan's ~20. The two slow stages are in
`deferred-items.md`:

- B3 (the trigram block) took 6–12 minutes.
- Merging cost 343 ms per merge, from the org-wide lookup 03-14 predicted.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (fix) | `6e40f77` | closure feed: `foldClosureDuplicates` + 2 unit tests |
| 1 (fix) | `61750d7` | Census re-run no longer overwrites a merge-chosen location + `tests/db/geocode-rerun.test.ts` |
| 1 | `3d135f9` | `docs/runbooks/ingest.md` + `docs/measurements/03-desk-run.md` |
| 2 | — | checkpoint. danlo answered on 2026-09-23 |
| 3 (RED) | `12a66ec` | `phone lift needs name sim 0.30`, watched red on `expected 'phone_locality_review' to be undefined` |
| 3 (GREEN) | `b0c6000` | cutoff 0.3, threshold confirmed, `PHONE_LIFT_MIN_NAME_SIM` gate, P07 re-pinned |
| 3 | `e65f71d` | the answers, the tuned dry run, `deferred-items.md` |

## danlo's answers (2026-09-23) and what they changed

1. **`cutoff 0.3`:** `OVERTURE_CONFIDENCE_CUTOFF` 0.5 → 0.3. The comment now carries the
   evidence and fixes the stale "8.3 %": that was the share below 0.4, and 0.5 actually dropped
   10.8 %.
2. **`pairs ok`:** no real-pair expectation changed, and the `known_miss` flags stay. Recorded:
   P03's real pair is Comptroller ↔ Overture at 84 review, so the modelled recall gap is not in
   the data.
3. **`threshold 0.45` plus the phone rule:**
   - `BLOCK_SIMILARITY_THRESHOLD` is confirmed.
   - New `PHONE_LIFT_MIN_NAME_SIM = 0.3`. It is a `Weights` entry that `score()` reads in R4,
     so R4 lifts a shared phone + ZIP to 80 only at name sim ≥ 0.3. The rule order is unchanged:
     R4 is still a lift that runs before every cap, and the chain-cap tests are unaffected.
4. **`D-11 keep`:** no change. The amendment is in `deferred-items.md`.

**The three markers:** `grep -c "TUNED BY THE DESK RUN" src/lib/resolve/score.ts` → 3. The two
original markers now carry the 2026-09-23 confirmation, and the third marks the new constant.

**Fixture:** only **P07** moved. It is synthetic (sim 0.05): **80 review → 29 ignore**, signals
`[phone]`, geo gate false, no rule. All assertions stay exact, and `grep toBeGreaterThan|toBeLessThan
tests/unit/score.test.ts` returns nothing.

**Mutation:** deleting the floor turns `phone lift needs name sim 0.30` and
`merge-pairs fixture P07` red, 2 of 228, and nothing else. Reverted and confirmed byte-identical
with `cmp`.

**The tuned dry run** (no re-ingest): the review queue went 12,591 → **7,975**. It fell by
4,616, not the predicted ~6,247:

| | Pairs |
|---|---|
| queue before | 12,591 |
| no longer lifted by the floor | − 4,667 |
| new candidates from post-merge re-blocking | + 21 |
| re-scored because a side is now a merge winner | + 30 |
| **queue after** | **7,975** |

The prediction was high because 1,622 of the ~6,247 sit at 80 on their **raw** score: same
phone, same full street address, within 100 m, same cluster. The lift never applied to them, and
they stay in review on their own evidence.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The closure feed repeats keys, so the first run reported `changed 42`**
- **Found during:** Task 1, run 1.
- **Issue:** `3kx8-uryv` has 21,509 RGV rows over 21,467 `tp_number-loc_number` keys (18 keys, 60
  rows, with differing `out_of_business_date`). Written row by row, a repeated key overwrites
  its own payload, in an order Socrata does not guarantee, so a re-run can never be
  `unchanged` (DATA-04).
- **Fix:** `foldClosureDuplicates` keeps the latest date per key, with the payload JSON as the
  tie-break, so the result does not depend on row order. Also added
  `stats.duplicate_keys` / `duplicate_rows_folded`.
- **Proof:** two unit tests, each killed by its own mutation. A settle run afterwards reported
  `13 changed` once (the one-time migration), then `0 changed` on every later run.
- **Files:** `scripts/ingest-comptroller.ts`, `tests/unit/ingest-comptroller.test.ts`.
- **Commit:** `6e40f77`.

**2. [Rule 1 - Bug] The Census re-run overwrote merge survivorship: 908 `businesses` events on an
all-unchanged run**
- **Found during:** Task 1, run 2, which followed the real resolve pass.
- **Issue:** `WRITE_LOCATION` ran for every Match, guarded only by `is distinct from`. It wrote
  the Census point back over 908 merge winners whose survivorship had chosen the Overture point
  (832 cases) or another Census Exact record (76). That broke the re-run claim and overrode the
  committed survivorship order.
- **Fix:** the Census pass writes a location only for a new or changed census source record,
  the same gate `upsertBusinessFromSource` applies.
- **Proof:** `tests/db/geocode-rerun.test.ts` was watched red, and is killed by both mutations
  (gate removed; never write). It includes a positive control: a changed Census answer still
  moves its business.
- **Local repair:** the 908 rows were restored from their own `events.before`, in one
  transaction attributed `etl:03-20-repair`.
- **Commit:** `61750d7`.

**3. [Approved scoring-rule change] `PHONE_LIFT_MIN_NAME_SIM`**
- danlo explicitly approved this rule change, so it is not the plan's "stop and report" case.
- It is test-first (`12a66ec` → `b0c6000`), and only a synthetic pair was re-pinned.

### Other deviations

- **A third ingest run.** The plan asked for "a second identical run". Run 2 exposed defect 2,
  so run 3 is the clean proof: all four sources `added 0 · changed 0`, **0** `businesses`
  events, and **0** `businesses` rows updated.
  - `ingest_runs` holds 15 rows for the org: run 1 (4), the settle run (3), run 2 (4) and
    run 3 (4). The plan expected 8.
- **Scratch files** went under the gitignored `node_modules/.cache/03-20/`. The sandbox refuses
  writes outside the worktree, including the OS temp dir.
- **`psql` is not on PATH**, and the sandbox refused the full-path call. The step-1a SQL ran
  unchanged through Node `pg`, and its output is pasted in the measurements doc.
- **Prettier reflowed `tests/unit/score.test.ts`** in the RED commit (`12a66ec`). The file had
  been hand-wrapped past the print width. The change is cosmetic only, but it makes that
  commit's diff large.
- **Nothing consumes `OVERTURE_CONFIDENCE_CUTOFF` yet.** The funnel that reads it is a later
  plan, so the new value changes no current behaviour.

### The plan's `-- -t` verify lines, replaced

`$PNPM test:db -- -t "…"` and `$PNPM test:unit -- -t "…"` do not filter. Every targeted run
used this form instead, and the test names were read in the output:

- `npx vitest run --config vitest.db.config.ts --pool=forks tests/db/ingest-idempotency.test.ts -t "re-run is idempotent" --reporter=verbose` → `✓ re-run is idempotent`, with 8 other tests skipped.
- `npx vitest run tests/unit/score.test.ts -t "phone lift needs name sim" --reporter=verbose` → watched red, then green.
- `npx vitest run tests/unit/score.test.ts --reporter=verbose` → every `merge-pairs fixture P01…P10` row listed by name.

## Verification (final tree, `b0c6000` code + `e65f71d` docs)

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint .` | 0 |
| `vitest run tests/unit` | **33 files, 228 tests** passed |
| `$PNPM test:db` (full, with the shared DB free) | **25 files, 177 tests** passed |
| `$PNPM build` | 0 |
| `git status --porcelain` | clean; no untracked `.ts` |

## Known Stubs

None. `OVERTURE_CONFIDENCE_CUTOFF` is a committed constant whose consumer, the lead funnel,
arrives in a later plan. That is by design since 03-02, not a stub.

## Threat Flags

None. No new endpoint, auth path or schema.
- T-3-01: every command took `--org`, and the target was `test`.
- T-3-02: every write is attributed, including `etl:03-20-repair`.
- T-3-11: the measurements carry public names, counts and distributions only, never `name_norm`
  or `internal_notes`.
- T-3-15: the preflight ran first and printed the org uuid.

## Self-Check: PASSED

- FOUND: docs/runbooks/ingest.md, docs/measurements/03-desk-run.md, tests/db/geocode-rerun.test.ts,
  .planning/phases/03-free-data-spine-entity-resolution/deferred-items.md
- FOUND commits: 6e40f77, 61750d7, 3d135f9, 12a66ec, b0c6000, e65f71d
- STATE.md / ROADMAP.md untouched; nothing pushed; production never targeted.
