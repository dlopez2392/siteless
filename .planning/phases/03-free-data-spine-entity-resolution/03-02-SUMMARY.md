---
phase: 03-free-data-spine-entity-resolution
plan: 02
status: checkpoint
subsystem: entity-resolution
tags: [scoring, dedupe, external-key, crockford, pure-module]
requires: []
provides:
  - "src/lib/resolve/score.ts — the D-09 weight table and R1–R6 (score, band, countSignals, geoGate, distanceMeters)"
  - "src/lib/ids/external-key.ts — newExternalKey(), EXTERNAL_KEY_PATTERN"
affects: [03-10, 03-11, 03-14]
tech-stack:
  added: []
  patterns:
    - "structural caps as separate Math.min(s, 94) statements, one mutation each"
    - "lifts (R3, R4) before caps (R2, R5, R6)"
key-files:
  created:
    - src/lib/resolve/score.ts
    - src/lib/ids/external-key.ts
    - tests/unit/external-key.test.ts
  modified: []
decisions:
  - "R2 (chain cap) runs after R3/R4. In the plan's numeric order R3's max(s, 95) undoes R2's cap, which would auto-merge a chain (D-11 violation)"
  - "A Census Non_Exact side earns no distance points and does not satisfy the geo gate. R1 (25 km) still uses the raw distance"
  - "The R1 literal 25_000 is written inside the clause, with no separate constant, so the one grep that finds the rule also finds its number"
metrics:
  duration: "~55 min"
  completed: 2026-09-22
  tasks_completed: 2
  tasks_total: 3
---

# Phase 3 Plan 02: Pair Scorer and External Lead Key Summary

**Status: CHECKPOINT at Task 2.** The D-09 scorer (`score.ts`) and the D-19 Crockford key generator are
committed and green. Task 2 (the ten-pair fixture) hit the plan's own stop condition: the expectations
for P02, P03, P05 and P10 can't be derived from the real records with the committed weight table.
The plan says to stop and report in that case, not to edit the expectation.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | score.ts: the weight table and the six structural rules | `7b0b70b` | src/lib/resolve/score.ts |
| 3 | external-key.ts (RED) | `f6210cc` | tests/unit/external-key.test.ts |
| 3 | external-key.ts (GREEN) | `14c098e` | src/lib/ids/external-key.ts |
| 2 | merge-pairs fixture + score.test.ts | **BLOCKED** | (none written) |

## What was verified

- `tsc --noEmit` exit 0; `eslint .` exit 0; `vitest run tests/unit`: 21 files, **84 tests passed**
  (81 before this plan plus the 3 new tests).
- Test names read in the verbose output: `external key matches the Crockford shape`,
  `external key never contains I L O or U`, `external key draws the whole alphabet`.
- Mutation `b % 32` → `b % 16`: exactly `external key draws the whole alphabet` went red. Reverted; `git diff` clean.
- Mutation alphabet `J` → `I`: all three went red (an `I` violates all three properties). Reverted; `git diff` clean.
- score.ts acceptance greps: `Math.min(s, 94)` ×4 (R2, R5 and R6, plus one mention in the header);
  `25_000` in the R1 clause; `6371000` present; `TUNED BY THE DESK RUN` ×2; no `@/db`, `server-only`,
  `drizzle-orm` or `unaccent(` anywhere under `src/lib/resolve/` or `src/lib/ids/`.
- `distanceMeters(Brownsville, Rio Grande City)` = 142,330 m with 03-01's coordinates. That is within
  03-01's ±100 m of 142,343. McAllen ↔ Edinburg = 12,795 m.
- 🔴 **Not yet verified: M13, M14 and M15.** Their named tests are part of Task 2, so score.ts's six
  rule statements are **not yet pinned by any test**. The continuation must do these checks.

## The Task 2 blocker: evidence

I checked the real records against the live `jrea-zgmq` dataset (public, read-only, 2026-09-22). Name
similarities come from a pg_trgm reimplementation. It reproduces the research's one measured value,
`SOUTHWEST MEDICAL HOMEPATIENT` at 0.8485, and gives ZORBA and RIO STONE 1.000. Names were normalized
with D-12's `nameNorm` (legal suffixes and `la` removed). Clusters come from `src/seed/data/clusters.json`.
03-12 leaves `cluster_key` NULL when a NAICS code falls outside all four clusters. Every score below
comes from running the committed `score()`.

| Pair | Real fact that matters | Planned | Derived |
|---|---|---|---|
| P01 ZORBA, INC. 516 S MAIN ST 78501 | NAICS 452319 → auto_retail; the Overture side's cluster depends on 03-08's category map | 95 merge | 95 merge if Overture maps it to auto_retail; **90 review** if unmapped |
| P02 TEXAS OUTDOOR POWER EQUIPTMENT, 3611 W FREDDY GONZALEZ DR 78539 | NAICS **811411 is in no cluster** → cluster 0 | 84 review | **79 ignore** |
| P03 La Colmena Meat Martket / Market | sim **0.7727** → name 28 (0.80 → 30 if `la` were kept) | 84 review | **78 ignore** at best. No combination of address, distance and cluster reaches 84. A phone would trigger R3/R4 instead |
| P04 FIRESTONE COMPLETE AUTO CARE #44HG, 118 N 12TH AVE 78541 | NAICS 441310 → auto_retail; sim 0.8485 → 34 | 84 review | 84 review (if the Overture side maps to auto_retail) |
| P05 EIS, 1805 N LOOP 499 STE 150 78550 | NAICS **423610 is in no cluster** → 0, not −10 | 35 ignore | **45 ignore** (same band, different score) |
| P10 RIO STONE PRODUCTS, INC., 2520 BEECH AVE 78501 | NAICS **327991 is in no cluster** → 0 | 95 merge | **90 review** |

This affects later plans. Under the committed table, **a true duplicate outside the four clusters can
never auto-merge**: its ceiling is 45 + 30 + 15 + 0 = 90. P10 is the research's real three-way example
for M25 (the cluster-aware merge in 03-11/03-14), and it does not reach 95. P03 is a real typo
duplicate at the same address, and it lands in `ignore`, so nobody would ever review it.

The research gives no real names for P06–P09; they are rule exercises and would be constructed.
P09 ("two signals, Comptroller side never geocoded") can reach 94 only if the **Comptroller side
carries a phone**. That is Phase 4's Places-derived phone. Without a phone, a pair with no geo gate
tops out at 45 + 30 + 5 = 80. P07 needs a shared phone between two businesses, and using a
real-looking number would attach it to real people. The only safe option is the fictional 555-01xx
range, which the D-12 normalizer rejects, so `phoneBlockable: true` would have to be set by hand.

### Options (a decision for danlo)

1. **(Recommended) An honest fixture.** Keep the real names, addresses, NAICS-derived clusters and
   measured similarities, and pin the scores they actually produce (P02 79, P03 78, P05 45, P10 90).
   Record the Overture-side cluster for P01/P04 as an assumption until 03-08 lands. The table stays
   unchanged, and the desk run faces these misses as red tests. 03-11/03-14 would then need a synthetic
   pair for the M25 three-way scenario.
2. **Re-tune the table** so real out-of-cluster duplicates reach their intended bands (for example,
   stop "either unmapped" from scoring below "same cluster", or re-weight name and address). Every
   expectation moves, and D-09's weights change before the desk run has measured anything.
3. **Keep the planned expectations** and pick Side values that produce them (counterfactual clusters
   for P02/P05/P10, a substitute pair for P03 such as SOUTHWEST MEDICAL HOMEPATIENT at a measured 0.848).
   The numbers hold, but the fixture stops describing the real records.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] R2 ran before R3, so R3 could undo the chain cap**
- **Found during:** Task 1
- **Issue:** The plan's order R1→R6 applies R2's `min(s, 94)` and then R3's `max(s, 95)`. A chain-flagged
  pair with the same phone and ZIP (sim ≥ 0.60, within 500 m) would auto-merge, which D-11 forbids.
- **Fix:** R2 now runs after R3/R4. All lifts come before all caps. The labels R1–R6 are unchanged,
  and the module header explains the order.
- **Test consequence for the continuation:** the plan's test 6 (P04 caps at 94) can't catch this
  mutation, because P04 scores 84 and deleting R2 changes nothing. Test 6 needs a P04 variant that
  would reach ≥ 95 without R2, such as sim 1.0 or the phone-locality lift.
- **Commit:** `7b0b70b`

**2. [Rule 2 - Correctness] A Census Non_Exact location no longer promotes a pair**
- **Found during:** Task 1
- **Issue:** The plan defines `geoGate := distanceM !== null && distanceM <= 500`. Its own Side comment
  says "Non_Exact never promotes", so a Non_Exact geocode could otherwise satisfy the gate that allows 95.
- **Fix:** `geoGate()` (exported) and the distance feature both require neither side to be
  `census_non_exact`. R1 still uses the raw distance. A direct `geoGate()` test keeps M15 at exactly
  one red test.
- **Commit:** `7b0b70b`

**3. Acceptance-grep wording.** The header comments in score.ts and external-key.ts originally named
the words `server-only` and `Math.random`. The plan's "returns nothing" greps would have matched those
comments, so I reworded them. There is no behavior change.

## TDD Gate Compliance

- Task 3: RED `f6210cc` (the module was missing, so the import failed) → GREEN `14c098e`. Compliant.
- Task 1: **no RED commit.** Its tests are Task 2's `score.test.ts`, which is blocked. Behavior was
  checked with a tsx smoke run: P01's shape gives exactly `{95, merge, [name,address,distance]}`.
  M13, M14 and M15 must be watched failing when Task 2 resumes.

## Known Stubs

None. Neither module has placeholder values or unwired data.

## Threat Flags

None. T-3-13 (key draw) is mitigated with `crypto.getRandomValues` over an exactly uniform
32-symbol draw. T-3-11 holds: `features` carries integers, `nameSim` and `distanceM` only, and never `nameNorm`.

## Self-Check: PASSED

- FOUND: src/lib/resolve/score.ts, src/lib/ids/external-key.ts, tests/unit/external-key.test.ts
- FOUND commits: 7b0b70b, f6210cc, 14c098e
