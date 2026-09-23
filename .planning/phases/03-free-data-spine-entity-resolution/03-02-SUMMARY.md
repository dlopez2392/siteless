---
phase: 03-free-data-spine-entity-resolution
plan: 02
status: complete
subsystem: entity-resolution
tags: [scoring, dedupe, external-key, crockford, pure-module, fixture]
requires: []
provides:
  - "src/lib/resolve/score.ts: score(pair, weights?), band, countSignals, signalNames, geoGate, distanceMeters, DEFAULT_WEIGHTS, the thresholds and the two desk-run constants"
  - "src/lib/ids/external-key.ts: newExternalKey(), EXTERNAL_KEY_PATTERN"
  - "tests/unit/fixtures/merge-pairs.json: ten pairs, real where measured, synthetic where flagged, with known_miss flags"
  - "tests/unit/fixtures/merge-triple.json: a synthetic >=95 three-way cluster for 03-11/03-14"
affects: [03-08, 03-10, 03-11, 03-14, 03-20]
tech-stack:
  added: []
  patterns:
    - "structural caps as separate Math.min(s, 94) statements, one mutation each"
    - "lifts (R3, R4) before caps (R2, R5, R6)"
    - "a cap test asserts the raw sum, so the rule demonstrably binds"
    - "injectable weight table so a rule that is redundant today stays provable after a re-tune"
key-files:
  created:
    - src/lib/resolve/score.ts
    - src/lib/ids/external-key.ts
    - tests/unit/external-key.test.ts
    - tests/unit/score.test.ts
    - tests/unit/fixtures/merge-pairs.json
    - tests/unit/fixtures/merge-triple.json
    - tests/unit/fixtures/merge-pairs.README.md
  modified: []
decisions:
  - "danlo chose the HONEST FIXTURE (option 1): weights unchanged; real pairs pin the scores they actually produce; P02/P03/P10 flagged known_miss for 03-20"
  - "R2 (chain cap) runs after R3/R4; otherwise R3's max(s, 95) undoes it and a chain auto-merges (D-11)"
  - "A Census Non_Exact location earns no distance points and does not satisfy the geo gate; R1 still uses the raw distance"
  - "score() takes an injectable Weights table (default = committed values): R5 is arithmetically redundant under the committed weights, so M14 is only killable under a re-tune"
  - "Signals are read from match facts, not from feature points"
metrics:
  duration: "~95 min across two sessions (checkpoint + continuation)"
  completed: 2026-09-22
  tasks_completed: 3
  tasks_total: 3
---

# Phase 3 Plan 02: Pair Scorer, Fixture and External Lead Key Summary

This plan ships the D-09 pair scorer as one pure, fixture-pinned module with six structural rules, each
killed by its own named mutation. The fixture is honest: real RGV pairs pin the scores they actually
produce, and three are flagged as known misses for the 03-20 desk run. The plan also ships the D-19
lead key: `SL-` plus six Crockford base32 characters from `crypto.getRandomValues`.

## Checkpoint and decision

Task 2 stopped at the plan's own STOP condition. With the committed table, the real records for P02,
P03, P05 and P10 can't produce the planned scores. The cause is NAICS codes that fall outside every
cluster (so the cluster feature scores 0, not +5), plus P03's measured name similarity of 0.7727.
**danlo chose option 1, the honest fixture:** the weights stay unchanged, and the real pairs pin
their real scores, with the misses flagged.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | score.ts: the weight table and rules R1–R6 | `7b0b70b` | src/lib/resolve/score.ts |
| 3 | external key (RED) | `f6210cc` | tests/unit/external-key.test.ts |
| 3 | external key (GREEN) | `14c098e` | src/lib/ids/external-key.ts |
| — | checkpoint summary | `d6206ad` | 03-02-SUMMARY.md |
| 1 | refactor: injectable weights, fact-based signals | `af8ed47` | src/lib/resolve/score.ts |
| 2 | honest fixture + score tests + synthetic triple | `ed00721` | score.test.ts, merge-pairs.json, merge-triple.json, merge-pairs.README.md |

## The fixture as committed

| id | kind | score / band | note |
|---|---|---|---|
| P01 ZORBA, INC. / Zorba | real | 95 merge | Overture-side cluster `auto_retail` is an **assumption** for 03-08/03-20 (unmapped → 90) |
| P02 TEXAS OUTDOOR POWER EQUIPTMENT | real | 79 ignore | **known_miss**, intended review: NAICS 811411 is in no cluster |
| P03 La Colmena Meat Martket / Market | real | 78 ignore | **known_miss**, intended review: sim 0.7727. **The real recall gap** |
| P04 FIRESTONE COMPLETE AUTO CARE #44HG | real | 84 review | Overture cluster and chain flag are assumptions (unmapped → 79) |
| P05 EIS / Central Park Car Wash | real | 45 ignore | band as intended; the score is 45, not the research's 35 (NAICS 423610 unmapped) |
| P06 Brownsville ↔ Rio Grande City | synthetic | 0 distinct | 03-01's town coordinates, ~142,330 m |
| P07 phone reuse, dissimilar names | synthetic | 80 review | fictional `+19565550101` |
| P08 one signal at its ceiling | synthetic | 75 ignore | |
| P09 two signals, Comptroller never geocoded | synthetic | 94 review | needs a Comptroller-side phone (the Phase 4 Places shape), fictional `+19565550142` |
| P10 RIO STONE PRODUCTS, INC. | real | 90 review | **known_miss**, intended merge: NAICS 327991 is in no cluster |

Real records were read from live `jrea-zgmq` on 2026-09-22. Similarities come from a pg_trgm
reimplementation that reproduces the research's one measured value (0.848). Clusters come from
`src/seed/data/clusters.json`, the same derivation 03-12 uses. Provenance, assumptions and misses are
recorded per entry and in `tests/unit/fixtures/merge-pairs.README.md`.

## Next plan must know

- **03-20 owns the known misses:** P02 (79 ignore), P03 (78 ignore) and P10 (90 review), plus P05's
  score delta (45, not 35). **La Colmena (P03) is the real recall gap:** a genuine same-address typo
  duplicate lands in `ignore`, so nobody would ever review it. Any re-tune happens at 03-20, as a
  constant edit that turns these tests red.
- **Under the committed weights, a true duplicate whose Comptroller NAICS is outside the four
  clusters can never auto-merge:** its ceiling is 45 + 30 + 15 + 0 = 90.
- **03-11 / 03-14 (M25, the cluster-aware three-way merge) must use the synthetic triple** in
  `tests/unit/fixtures/merge-triple.json` (each edge 95). Rio Stone Products no longer reaches 95.
- **03-08** must confirm the Overture-side cluster assumptions for P01 and P04. If either maps to
  nothing, the pinned 95/84 become 90/79 and the fixture turns red, which is the intended signal.
- **API for 03-10/03-11:** `score(pair, weights = DEFAULT_WEIGHTS)`. `countSignals(pair)` and
  `signalNames(pair)` take the `CandidatePair`. `ScoreResult.band` is `'distinct'` when R1 fires
  (the plan's prose called this `decision`). `features` never carries `nameNorm` (T-3-11).
- `phoneE164` from Overture: R3 can fire only on Overture↔Overture pairs until Phase 4 adds phones
  to Comptroller rows. The fixture shows that a shared blockable phone would lift P03 to 95, so
  03-20 must record Overture phones for the Colmena rows.

## Verification

- `tsc --noEmit` exit 0 · `eslint .` exit 0 ·
  `vitest run tests/unit`: **22 files, 107 tests passed** (84 existing plus 23 new; all 26 score and
  external-key test names read in the verbose output).
- Plan greps: `Math.min(s, 94)` ≥ 3; `25_000` in the R1 clause; `6371000` present;
  `TUNED BY THE DESK RUN` ×2; fixture length 10; `grep -c '"id": "P'` = 10; `toBe(75)` and `toBe(94)`
  present; no greater-than/less-than assertion anywhere in score.test.ts; no `@/db`, `server-only`,
  `drizzle-orm` or `unaccent(` under `src/lib/resolve/` or `src/lib/ids/`.

### Mutations (each over the whole unit suite, failing names read, reverted, `git diff` clean)

| Mutation | Tests that went red |
|---|---|
| M13 delete R1 (25 km) | `never merges across 25 km`, `merge-pairs fixture P06` |
| M14 delete R5 (signals < 2) | `one signal cannot reach 95` only |
| M15 delete R6 (geo gate) | `no geo gate caps at 94`, `merge-pairs fixture P09` |
| delete R2 (chain cap) | `chain flag never merges`, `chain cap survives the phone-locality lift` |
| move R2 before R3 (the plan's order) | `chain cap survives the phone-locality lift` only |
| key draw `b % 32` → `b % 16` | `external key draws the whole alphabet` only |
| key alphabet `J` → `I` | all three external-key tests (an `I` violates all three) |

M13 and M15 also turn their own fixture row red. The rest of the fixture stays green, which matches
03-RESEARCH's "the fixture's other nine pairs stay green".

## Deviations from Plan

**1. [Rule 1 - Bug] R2 runs after R3/R4.** In the plan's order, R3's `max(s, 95)` undoes the chain
cap and a chain could auto-merge (D-11). All lifts now run before all caps, and the labels are kept.
The new test `chain cap survives the phone-locality lift` pins this. (`7b0b70b`)

**2. [Rule 2 - Correctness] Census Non_Exact never promotes.** A Non_Exact side earns no distance
points and does not satisfy the geo gate, per the plan's own "Non_Exact never promotes". The new test
`a Census Non_Exact location never satisfies the geo gate` calls `geoGate()` directly, so M15 stays
confined to its own tests. (`7b0b70b`)

**3. [Rule 1 - Unkillable guard] R5 is redundant under the committed weights, so `score()` takes
an injectable table.** The best single-signal pair sums to exactly 94 (phone 30 + name 34 at sim
0.8499 + address 15 + distance 10 + cluster 5). 03-RESEARCH put phone-only at 85, assuming name ≤ 25.
Deleting R5 therefore changed no outcome, and M14 could never go red. `score(pair, weights =
DEFAULT_WEIGHTS)` keeps every committed value, and `one signal cannot reach 95` proves R5 under a
re-tune (`nameMax: 70` → raw 100 → 94). Signals are now read from match facts rather than from point
equality, so a re-tune can't change what counts as a signal. (`af8ed47`)

**4. Tests beyond the plan's eight names:** `merge-pairs fixture is well-formed`, a per-pair
`it.each` (`merge-pairs fixture P01…P10`, all matching `-t "merge-pairs fixture"`),
`chain cap survives the phone-locality lift`, `a Census Non_Exact location never satisfies the geo gate`,
`distanceMeters agrees with app.distance_m`, `the review ceiling is one below the merge threshold`, and
`synthetic three-way triple merges on every edge`.

**5. Test 6 made meaningful.** P04 at 84 can't prove the chain cap, so `chain flag never merges` also
scores P04 at sim 1.0 (raw 95, two signals, geo gate satisfied) and pins 94.

**6. Extra files:** `merge-triple.json` (the orchestrator asked for a synthetic ≥95 triple; the
plan's array had to stay at ten entries) and `merge-pairs.README.md` (provenance, known misses, 03-20
ownership).

**7. Acceptance-grep wording.** I reworded the header comments so they no longer contain the literal
words `server-only` and `Math.random`, which the plan's "returns nothing" greps would have matched.

## TDD Gate Compliance

- Task 3: RED `f6210cc` → GREEN `14c098e`. Compliant.
- Tasks 1 and 2: the scorer (`7b0b70b`) was committed before its tests (`ed00721`), because the tests
  waited on the fixture decision. They were not watched failing first. Instead, every structural
  clause was mutated afterwards and turned red exactly its named tests (the table above), which is
  the stronger form of the same evidence.

## Known Stubs

None. The P01/P03/P04 cluster assumptions and the fixture coordinates are documented per entry for
03-08/03-20. They are data assumptions, not unwired code.

## Threat Flags

None. T-3-13: `crypto.getRandomValues` over an exactly uniform 32-symbol draw. T-3-11: `features`
carries integers, `nameSim` and `distanceM` only; the fixture test asserts `nameNorm` never appears in it.

## Self-Check: PASSED

- FOUND: every file listed under key-files.created
- FOUND commits: 7b0b70b, f6210cc, 14c098e, d6206ad, af8ed47, ed00721
