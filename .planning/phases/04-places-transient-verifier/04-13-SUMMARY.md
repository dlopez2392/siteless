---
phase: 04-places-transient-verifier
plan: 13
subsystem: places
tags: [places, pure, run-planning, partition, quadtree, tdd, timezone]
requires:
  - src/lib/estimate/expand-cells.ts (expandCells, cellKey, placesTypesFor, Cell, PresetSpec, SeedTables) — 04-04
  - src/lib/places/partition.ts (partitionOf, currentPartition) — 04-03
  - src/lib/places/tiling.ts (rootSpec, shapeFor, ShapeRef, TileSpec, GeoShapesFile) — 04-05
  - src/lib/places/place-types.ts (isTableAType) — 04-04
provides:
  - src/lib/places/plan-run.ts (RunKind, cellsForRun, unitShapeRef, missingGeometry, planRootSearches)
affects:
  - 04-22 beginRun (planRootSearches)
  - 04-26 queue-run admission (cellsForRun, missingGeometry)
  - 04-27 partition estimate (cellsForRun(spec, seed, 'partition', now) + partitionIndex)
tech-stack:
  added: []
  patterns:
    - one pure scope function shared by admission and execution (the estimate and the run cannot disagree)
    - zone forwarded untouched to the zone-defaulted callee (this file names no zone)
key-files:
  created:
    - src/lib/places/plan-run.ts
    - tests/unit/plan-run.test.ts
  modified: []
decisions:
  - "The partition hashes the RAW expand-cells key (clusterKey + U+0000 + unitId), per 04-RESEARCH L420 and partition.ts's contract; only the TileSpec.cellKey that leaves this module is dbSafe'd (via rootSpec)"
  - "missingGeometry names a city by its name ('McAllen') and a county as 'county <fips>'; each unit named once however many clusters it carries (Texas → 250 names, not 1000); a shape with zero rings counts as missing"
  - "timeZone is optional and passed straight through to currentPartition, so omitting it takes APP_TZ from partition.ts; plan-run.ts never spells a zone"
  - "Radius circle uses 1609.344 m per statute mile; rect = circleBbox (haversine sphere, same as tiling's pruning)"
metrics:
  duration: ~25m
  completed: 2026-09-23
  tasks: 1
  files: 2
---

# Phase 4 Plan 13: Run planning Summary

This plan adds `planRootSearches`, a pure function that takes a preset version, a run kind and an instant and returns the root searches the run executes. Admission (queue-run) and execution (beginRun) both call it, so the price danlo confirms covers exactly the searches the workflow runs. The three D-16 scopes are:

- **full sweep:** every cell, planned as Enterprise.
- **this week's partition:** the cells whose FNV-1a partition matches the Chicago week index.
- **change check:** every cell, planned as `ids_only`.

Each scope is one root per (cell × Table A Places type), rooted at the unit's polygon bbox or at the radius circle's bounding square.

## Exported signatures (04-22 and 04-26 call these)

```ts
export type RunKind = 'full_sweep' | 'partition' | 'change_check';
export function cellsForRun(spec: PresetSpec, seed: SeedTables, kind: RunKind, now: Date, timeZone?: string):
  { cells: Cell[]; partitionIndex: number | null; totalCells: number };
export function unitShapeRef(cell: Cell, spec: PresetSpec): ShapeRef;
export function missingGeometry(cells: Cell[], spec: PresetSpec, shapes: GeoShapesFile): string[];
export function planRootSearches(a: {
  spec: PresetSpec; seed: SeedTables; shapes: GeoShapesFile; kind: RunKind; now: Date; timeZone?: string;
}): TileSpec[];
```

`planRootSearches` throws `Error('planRootSearches: no geometry for ' + names.join(', '))` if any unit lacks geometry. Each returned `TileSpec` has these properties:

- `quadPath: 'r'`, `depth: 0`, `parentTileKey: null`
- `tileKey = {unitKind}:{dbSafe(unitId)}|{type}|r`
- `cellKey = dbSafe(clusterKey + '\u0000' + unitId)`, for example `home_services/48215/McAllen`
- `unitId` stays **raw**, so it can still contain U+0000. 04-22 must `dbSafe` it before `app.plan_run_searches`, as its plan already says.
- `shape` is a polygon ref `{kind:'polygon', unitKind, unitId}` or a circle `{kind:'circle', lat, lng, radiusM}`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 RED | failing tests for run planning | `b6ca232` | tests/unit/plan-run.test.ts |
| 1 GREEN | implement run planning | `3a1257c` | src/lib/places/plan-run.ts |

No refactor commit was needed.

## Verification

- `npx vitest run tests/unit/plan-run.test.ts --reporter=verbose`: all 8 named tests passed, and I read each name in the output:
  - a full sweep plans one root per cell and Places type
  - a change check plans ids-only roots
  - a partition keeps only this week's cells
  - a partition is the same all week
  - a radius unit is tiled from the preset's circle
  - a unit without geometry is named, not guessed
  - planned keys are Postgres-safe
  - every planned type is a Table A type
- Full unit lane `npx vitest run tests/unit`: 60 files, 441 tests, all passed, exit 0.
- `npx tsc --noEmit`: exit 0. `npx eslint . --ignore-pattern ".claude/**"`: exit 0. `prettier --check --end-of-line auto` passes on both files.
- Acceptance greps:
  - `industry_terms` in plan-run.ts matches only a header comment (line 25).
  - `from '@/db|fetch\(` has no matches.
  - plan-run.ts adds no zone literal.

### Mutation checks

Each mutation below was applied to `plan-run.ts`, the whole test file was run, the failing test names were read, and the file was restored with `git checkout -- src/lib/places/plan-run.ts`. `git status` was clean after each one.

| # | Mutation | Red test(s) |
|---|----------|-------------|
| M1 | partition filter keeps every cell (`=== partitionIndex` → `>= 0`) | **a partition keeps only this week's cells** |
| M2 | zone pinned: `currentPartition(now, timeZone ?? 'UTC')` | **a partition is the same all week** (only that one) |
| M3 | change check planned as `enterprise` | **a change check plans ids-only roots** (only that one) |
| M4 | `METERS_PER_MILE = 1000` | **a radius unit is tiled from the preset's circle** (only that one) |
| M5 | missingGeometry never reports (`unit === null`) | **a unit without geometry is named, not guessed** (only that one) |
| M6 | raw U+0000 `cellKey` on the planned spec | **planned keys are Postgres-safe** + full sweep + partition |
| M7 | Table A filter disabled | **every planned type is a Table A type** (only that one) |
| M8 | empty-rings clause dropped (`!unit` only) | **a unit without geometry is named, not guessed** (only that one) |

The timezone test uses a discriminating pair: Monday 00:30 and Sunday 23:30 in Chicago are the same week under the default zone, and two different weeks with disjoint cell sets under `'UTC'`. The suite runs in TZ=UTC, so Chicago only ever appears as one half of that pair.

## Deviations from Plan

**1. [Process] The mutation checks ran the whole test file instead of using `-t` filters.** The plan's verify line uses `$PNPM test:unit -t "..."`. The executor brief says that form does not filter, so every check ran `npx vitest run tests/unit/plan-run.test.ts --reporter=verbose` and I read each test name. This is stronger than the plan asked for: each mutation shows which tests it turns red, not just the targeted one.

**2. [Interface note, no code change]** The plan's `<interfaces>` block says `cellKey(clusterKey, unitId)` is joined with U+0000. That is true of the raw expand-cells key, and that raw key is what the partition hashes. The `TileSpec.cellKey` this module returns is the `dbSafe` form built by `rootSpec`, with `/` in place of U+0000. The "planned keys are Postgres-safe" test pins both: `r.cellKey === dbSafe(cellKey(r.clusterKey, r.unitId))`, and at least one `unitId` really does contain U+0000, so the check is not vacuous.

Otherwise the plan was executed as written.

## Merge notes

- Only two new files were added. No existing file changed, so this should not conflict with other wave-2 plans.
- **04-22:** pass `kind: r.kind` from the run row. `planRootSearches` throws on missing geometry, so reject the Texas preset at admission (04-26 `missingGeometry` → `no_geometry`) before execution ever reaches it.
- **04-26 / 04-27:** `cellsForRun` returns expand-cells `Cell`s. For `estimatePreset(spec, ctx, { onlyCells })`, filter by `cellKey(c.clusterKey, c.unitId)` membership, or by `partitionOf(cellKey(...)) === partitionIndex`. `Cell` has no identity key of its own, so compare keys, not object identity.
- The type count per cell uses `placesTypesFor` filtered by `isTableAType`. The 04-04 estimate counts the unfiltered list, which matches for the committed seed (all 26 are Table A, pinned by place-types.test.ts). If a non-Table-A type ever entered clusters.json, the estimate would over-price, never under-price.

## Known Stubs

None.

## Threat Flags

None. The module is pure and adds no endpoint, I/O or schema. T-4-02 and T-4-10 are handled as the threat register requires, with M5, M7 and M8 testing them.

## TDD Gate Compliance

The RED commit `b6ca232` (`test(04-13)`, which failed with the module missing) comes before the GREEN commit `3a1257c` (`feat(04-13)`). No refactor was needed.

## Self-Check: PASSED

- FOUND: src/lib/places/plan-run.ts
- FOUND: tests/unit/plan-run.test.ts
- FOUND: b6ca232
- FOUND: 3a1257c
