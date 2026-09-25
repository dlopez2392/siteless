---
phase: 04-places-transient-verifier
plan: 03
subsystem: places
tags: [places, pure, host-class, partition, change-detection, tdd, timezone]
requires:
  - src/lib/time.ts (APP_TZ, localDate)
provides:
  - src/lib/places/host-class.ts (hostClass, HOST_CLASSES, HostClass)
  - src/lib/places/partition.ts (PARTITION_COUNT, fnv1a32, partitionOf, weeksSinceEpoch, currentPartition, isoWeekOf)
  - src/lib/places/change-detect.ts (diffTile, ChangeVerdict, IDS_ONLY_SATURATION)
affects:
  - 04-13 run planner (partitionOf, currentPartition)
  - 04-15 / 04-18 page writer (hostClass)
  - 04-19 change check (diffTile)
  - 04-07 places-format (HostClass labels)
tech-stack:
  added: []
  patterns:
    - zone-defaulted pure function (APP_TZ default param, date-only arithmetic on Date.UTC day numbers)
    - suffix match on a dot boundary for host classification
key-files:
  created:
    - src/lib/places/host-class.ts
    - src/lib/places/partition.ts
    - src/lib/places/change-detect.ts
    - tests/unit/host-class.test.ts
    - tests/unit/partition.test.ts
    - tests/unit/change-detect.test.ts
  modified: []
decisions:
  - "diffTile: saturated (listing length >= 60) takes precedence over baseline too — a never-checked leaf returning 60 still needs subdivision"
  - "partitionOf takes exactly one parameter so seventeen.map(partitionOf) is safe, and the M47 test maps it directly so an index-reading implementation is observable"
  - "weeksSinceEpoch uses pure epoch-day arithmetic (Monday 1970-01-05 = epoch day 4), no day-of-week accessor at all"
metrics:
  duration: ~35m
  completed: 2026-09-23
  tasks: 3
  files: 6
---

# Phase 4 Plan 03: host-class, partition, change-detect Summary

This plan adds three pure modules with no I/O. The first is the D-09 host classifier, which turns a `websiteUri` into one of six enum values using a dot-boundary suffix match. The second is the D-16 cell partition: `fnv1a32(cellKey) % 4`, rotating each week at local Monday midnight through `APP_TZ`. The third is the D-16 IDs-only change diff, which yields one of six verdicts with sorted, de-duplicated `added`/`gone`.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | host-class.ts (RED → GREEN) | `8f8c771` test, `18fb9de` feat |
| 2 | partition.ts (RED → GREEN), two-zone test | `7c4457c` test, `211fa9b` feat |
| 3 | change-detect.ts (RED → GREEN) | `2169fa2` test, `364d3cb` feat |
| — | typecheck + prettier fix-up (Tasks 1/2) | `20e8ac0` fix |

## Verification

- `npx vitest run tests/unit/{host-class,partition,change-detect}.test.ts`: 36/36 passed. Test names were read from verbose output:
  - `host class: business.site is a dead Google site` (M35), plus 22 more `host class: …`
  - `a cell keeps its partition when cells are added` (M47), `partitions rotate weekly`, `one instant in two zones gives opposite partitions`, `iso week is for display and crosses year ends`, `partition: fnv1a32 is 32-bit FNV-1a`, `partition: there are four partitions`
  - `change detection: baseline | unchanged | new | gone | both | saturated`, plus `change detection: the inputs are not mutated`
- `npx tsc --noEmit`: exit 0 on the final tree.
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0.
- Full unit lane `npx vitest run tests/unit`: 375/376 on the first run. The one failure was `stale-estimate.test.tsx > the in-order control still paints the newer answer`, which took 1253ms under contention. Re-run alone, all 5 tests in that file passed (155ms). That file is not touched by this plan, so this counts as contention noise.
- Acceptance greps:
  - `'business.site', 'g.page'` is present in host-class.ts.
  - host-class.ts has no `server-only` and no `use client`.
  - partition.ts has no `America/Chicago` and no `getDay(`/`getDate(`/`getHours(`.
  - `export const IDS_ONLY_SATURATION = 60` is present.

### Mutations (each applied → red on the named test → `git checkout --` → `git status` clean)

| Mutation | Red test |
|---|---|
| **M35**: `business.site` removed from the dead list | `host class: business.site is a dead Google site` (only this test) |
| dot boundary loosened to `host.endsWith(d)` | `host class: a lookalike host is not the platform it ends with` |
| unparseable `catch` returns `'none'` | `host class: a present but unparseable value is never none` |
| **M47**: `partitionOf(cellKey, index?)` returning `(index ?? hash) % 4` | `a cell keeps its partition when cells are added` (re-checked after the `20e8ac0` test edit, still red) |
| `currentPartition` default `APP_TZ` → `'UTC'` | `one instant in two zones gives opposite partitions` (only this test) |
| epoch Monday day 4 → 0 (Thursday) | `partitions rotate weekly` (+ two-zone, iso-week) |
| saturation `>=` → `>` | `change detection: saturated` |
| baseline `added` not de-duplicated | `change detection: baseline` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `noUncheckedIndexedAccess` broke typecheck on the M47 shuffle**
- **Found during:** final gates. Vitest does not typecheck, so the Task 2 tests were green while `tsc` was red.
- **Issue:** `twelveMore[i]` / `five[i]` are `string | undefined`, so `seventeen.map(partitionOf)` failed TS2345.
- **Fix:** the list is now built through a throwing `pick()` helper and typed `string[]`. It is still mapped with `partitionOf` directly, and M47 was re-verified red afterwards.
- **Files modified:** tests/unit/partition.test.ts
- **Commit:** `20e8ac0`

**2. [Rule 3] Prettier reflow of host-class.ts (the directory row was over 100 columns)**
- **Commit:** `20e8ac0`. There was no logic change; the `'business.site', 'g.page'` grep still matches.

### Interpretation choices (the plan was ambiguous)

- **Saturated vs baseline precedence.** The plan says `seen.length === 60 → saturated regardless of the diff` but does not rank it against `!hasBaseline`. I chose `saturated` to win, with `added` = all seen and `gone` = []. The reason: a never-checked leaf that returns 60 still needs a paid re-sweep and subdivision, and 04-19 reads `verdict === 'saturated'` to mark the search saturated. A test pins this (`change detection: saturated`). If 04-19 needs `baseline` in that case, the change is one line.
- **`>=` instead of `===` 60.** Text Search cannot return more than 60 results, so the two behave identically on real input; `>=` also fails safe. The length is taken on the raw `seen` array, as the plan specifies.
- I added tests beyond the named ones: the enum order, the enum-only return (T-4-05), inputs not mutated, fnv1a32 range, epoch-week pins, and a mid-year ISO week in both zones.

### Environment notes for the merger

- `core.autocrlf=true` makes `git checkout --` rewrite files with CRLF, and `npx prettier --check` then flags every file, pre-existing ones like `src/lib/budget/period.ts` included. Use `--end-of-line auto` to see real style issues. With that flag, all six files in this plan pass.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the one the plan's threat model already covers (T-4-05, T-4-10, T-4-02): `hostClass` returns the enum only, uses `new URL()` in a try/catch with a dot-boundary match, and partitions are hashed from the key.

## TDD Gate Compliance

All three tasks went RED → GREEN. Each RED commit (`test(04-03)`) failed on module-not-found before its `feat(04-03)` commit. No REFACTOR commit was needed.

## Self-Check: PASSED

- All 6 created files exist in the worktree.
- Commits 8f8c771, 18fb9de, 7c4457c, 211fa9b, 2169fa2, 364d3cb and 20e8ac0 are present in `git log 85e11d1..HEAD`.
