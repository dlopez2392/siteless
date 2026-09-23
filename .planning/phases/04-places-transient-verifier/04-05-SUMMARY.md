---
phase: 04-places-transient-verifier
plan: 05
subsystem: places-sweep
tags: [places, tiling, quadtree, workflow, reducer, tigerweb, geo-seed]
requires: []
provides:
  - "src/lib/places/tiling.ts: Rect, TileSpec, ShapeRef, UnitShape, GeoShapesFile, SATURATION_RESULTS, MAX_DEPTH, MIN_TILE_SIDE_M, NOVELTY_MAX_OVERLAP, isSaturated, decideSubdivision, quadrants, rectIntersectsShape, circleBbox, rootSpec, shapeFor, tileKeyOf, dbSafe"
  - "src/workflows/places-sweep/reducer.ts: PlannedSearch, SearchResult (step→workflow contract), StopReason, FailReason, QueueState, initialQueue, nextSearch, applyResult, failReasonOf, finishVerdict"
  - "src/seed/data/geo-shapes.json: 21 TIGERweb units (17 cities + 4 RGV counties)"
affects: [04-18 searchTile, 04-19 checkTile, 04-22 workflow, place_tiles/run_searches keys]
tech-stack:
  added: []
  patterns:
    - "pure geometry with shapes passed in; committed constants pinned by named tests"
    - "sandbox-safe workflow reducer: import type only, every transition returns new state"
    - "dbSafe() (U+0000 → '/') on every DB-bound key; raw unitId kept only in memory"
key-files:
  created:
    - scripts/fetch-geo-shapes.ts
    - src/seed/data/geo-shapes.json
    - src/lib/places/tiling.ts
    - src/workflows/places-sweep/reducer.ts
    - tests/unit/tiling.test.ts
    - tests/unit/sweep-reducer.test.ts
  modified: []
decisions:
  - "TIGERweb layer 25 is queried by BASENAME, not NAME — NAME carries the LSAD suffix ('McAllen city') and NAME='McAllen' returns zero features silently"
  - "Full-precision (4-decimal) rings committed without maxAllowableOffset: the committed, prettier-formatted file is 823,476 bytes (< 1.5 MB); the raw JSON.stringify output is 1.74 MB before `pnpm format`"
  - "isSaturated is exact equality with 60: 61 is NOT saturated (a count above Google's cap means the contract moved, not 'keep splitting')"
  - "min_size floor applies to the CHILD side: a tile is not split when min(height, width)/2 < 500 m"
  - "circleBbox uses the exact spherical formula on EARTH_RADIUS_M (same sphere as distanceMeters), so the bbox always contains the circle"
  - "Segment touching counts as intersecting in polygon pruning (conservative: a boundary tile is searched, never skipped)"
  - "Reducer: a 'checked' (IDs-only) result counts as searched; a 'stopped' search stays pending (reported as unsearched); first stop reason wins; a result whose tileKey differs from the search is refused with an Error carrying our keys only"
  - "failReasonOf accepts only an Error instance whose message is exactly an allow-listed key; strings, objects, stop reasons and padded messages collapse to places_unavailable"
metrics:
  duration: "~25 min"
  completed: 2026-09-23
  tasks: 3
  files: 6
---

# Phase 4 Plan 05: Tiling geometry + sweep queue reducer Summary

Pure Places quadtree (exact-60 saturation, 2×2 split, polygon/radius pruning, three committed
termination floors reported as truncation) plus the workflow's sandbox-safe breadth-first queue
reducer, over a committed Census TIGERweb shape seed for the 17 cities and 4 RGV counties.

## What was built

**Task 1 — geo-shape seed** (`scripts/fetch-geo-shapes.ts`, `src/seed/data/geo-shapes.json`)
- 21 units (17 cities + 4 counties), every one with a bbox and ≥1 outer ring of ≥4 points.
- McAllen: GEOID **4845384**, bbox `{ south: 26.1019, west: -98.3183, north: 26.4667, east: -98.1954 }`
  — matches research (−98.318…−98.195, 26.102…26.467) exactly.
- File size: **823,476 bytes** committed (prettier-formatted); raw script output 1.74 MB before
  `pnpm format`. Under the 1.5 MB threshold, so no `maxAllowableOffset` (the script supports
  `--max-offset=<deg>` for a coarser re-run).
- Re-running the script regenerated the JSON **byte-identical** (reproducible).
- `grep -rn "fetch-geo-shapes" src/` → nothing (desk-only). The `"source"` line names no host the
  `no-network` walker flags.

**Task 2 — `src/lib/places/tiling.ts`** — pure, imports only `distanceMeters`/`EARTH_RADIUS_M`
from `@/lib/resolve/score` (itself import-free). No `@/db`, `node:` or `fetch(`.
`decideSubdivision` order: not saturated → done; depth ≥ 5 → `max_depth`; child side < 500 m →
`min_size`; overlap ≥ 0.75 → `novelty`; else the quadrants touching the shape (all pruned → done).

**Task 3 — `src/workflows/places-sweep/reducer.ts`** — `import type` only; FIFO breadth-first;
`SearchResult` carries tile keys, counts and enums only (T-4-05).

## Verification

- `npx vitest run tests/unit/tiling.test.ts tests/unit/sweep-reducer.test.ts --reporter=verbose` →
  17 passed; PASS list names all nine planned tiling tests plus `shapeFor names a missing polygon`,
  and all five planned reducer tests plus `a result for a different tile is refused`.
- Full unit lane `npx vitest run tests/unit` → **48 files, 357 tests passed** (includes
  `no-network`, `field-mask-tier` walkers over the new files).
- `npx tsc --noEmit` → exit 0. `npx eslint . --ignore-pattern ".claude/**"` → exit 0.
- `test:db` not run: this plan touches no schema, SQL or DB code.
- Acceptance greps: `=== SATURATION_RESULTS` matches line 135; forbidden-import grep empty;
  `grep -n "^import" reducer.ts` shows only `import type { TileSpec }`.

### Mutation checks (each applied alone, run, restored byte-identical)

| Mutation | Red test (read by name) |
|---|---|
| M30a `=== 60` → `>= 60` | `a 60-result tile is saturated and subdivided` |
| M30b saturated at 59 | `a 60-result…` + `a 59-result tile is not saturated` |
| M31 min_size floor removed | `truncated at minimum size` |
| novelty `>=` → `>` / novelty removed | `novelty stops a service-area saturation loop` |
| max depth `>=` → `>` | `truncated at max depth` |
| pruning removed | `a child outside the unit polygon is pruned` + `a radius child outside the circle is pruned` |
| `dbSafe` identity | `tile keys never carry U+0000` + `shapeFor names a missing polygon` |
| corner-in-ring check removed / edge-crossing check removed | `a child outside the unit polygon is pruned` |
| children to the front (depth-first) | `the reducer enqueues children breadth-first` |
| stop ignored by `nextSearch` / last stop wins | `a stop ends the queue` |
| truncate not counted | `a truncated result counts and enqueues nothing` |
| `failReasonOf` echoes the message | `failReasonOf maps only allow-listed keys` |
| stop beats failure | `finishVerdict: failure beats stop beats complete` |
| tileKey mismatch not refused | `a result for a different tile is refused` |
| `initialQueue` aliases the caller's array | first run **survived** → test strengthened → `the reducer enqueues children breadth-first` |
| `applyResult` mutates `pending` in place | `the reducer enqueues children breadth-first` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TIGERweb layer 25 `NAME` does not match the seeded city name**
- **Found during:** Task 1 (live probe before writing the script)
- **Issue:** The plan's `where=STATE='48' AND NAME='<name>'` returns zero features: layer 25's `NAME`
  is "McAllen city"; the bare name is `BASENAME`.
- **Fix:** Query `BASENAME`; documented in the script header as a 🔴 note.
- **Files:** scripts/fetch-geo-shapes.ts · **Commit:** 7471b86

**2. [Rule 1 - Bug] `fetch-geo-shapes.ts` did not typecheck under `noUncheckedIndexedAccess`**
- **Found during:** Task 2 (`npx tsc --noEmit` — `next build` type-checks `scripts/` too)
- **Fix:** `[lng, lat]` Point tuples, destructure-and-guard instead of indexed access. Re-ran the
  script: JSON regenerated byte-identical.
- **Files:** scripts/fetch-geo-shapes.ts · **Commit:** 8b2fa2c

**3. [Rule 2 - Missing test] Surviving mutation in the reducer**
- **Found during:** Task 3 mutation pass — `initialQueue` aliasing the caller's `roots` array left
  the suite green.
- **Fix:** the breadth-first test now pushes onto the caller's array after `initialQueue` and
  asserts the queue is unchanged; the mutation then reds it.
- **Commit:** d2c0183

### Additions beyond the named tests
- `shapeFor names a missing polygon` (the plan's "throws naming the unit" contract, with the name
  DB-safe) and `a result for a different tile is refused` (reducer guard) — each killed a mutation.

### Process notes
- The plan's `cd /c/Users/danlo/prospector && $PNPM test:unit -t …` verify commands were run as
  `npx vitest run <file> --reporter=verbose` in the worktree, per the orchestrator's pnpm-12 `-t`
  warning; test names were read from the PASS/FAIL lists.
- Mutation harness lived in the gitignored `coverage/mutate/` (the session scratchpad was not
  writable from the isolated worktree) and was deleted afterwards; nothing scratch is committed.

## TDD Gate Compliance

- Task 2: RED `72e2555` (test, failed on missing module) → GREEN `93d06fa` (feat).
- Task 3: RED `7539a9b` (test, failed on missing module) → GREEN `d2c0183` (feat).
- No REFACTOR commits needed.

## Known Stubs

None.

## Threat Flags

None. The only new network surface is the desk-only `scripts/fetch-geo-shapes.ts` (public-domain
TIGERweb, never imported by `src/`, never run in CI), which the plan's threat model covers.

## Notes for the merge / downstream plans

- `GeoShapesFile` is declared in `tiling.ts`. Importing `geo-shapes.json` yields `unitKind: string`,
  so consumers need `as GeoShapesFile` (the test does this) or a runtime check.
- `geo-shapes.json` is ~0.8 MB. If 04-18/04-22 import it into a workflow step or route, it lands in
  that bundle; consider loading it in the step (Node) rather than the sandboxed workflow body.
- Tile keys do not include `clusterKey` or `kind` (`{unitKind}:{dbSafe(unitId)}|{type}|{quadPath}`),
  so tiles are shared across presets as research Pattern 8 intends; `cellKey` carries the cluster.

## Self-Check: PASSED

- FOUND: scripts/fetch-geo-shapes.ts, src/seed/data/geo-shapes.json, src/lib/places/tiling.ts,
  src/workflows/places-sweep/reducer.ts, tests/unit/tiling.test.ts, tests/unit/sweep-reducer.test.ts
- FOUND commits: 7471b86, 72e2555, 8b2fa2c, 93d06fa, 7539a9b, d2c0183
