---
phase: 04-places-transient-verifier
plan: 27
subsystem: preset-detail-ui
tags: [d-02, d-16, d-18, place-04, rule-33, rule-34, rule-38, rule-40, rule-41, run-actions, recent-runs]

requires:
  - phase: 04-places-transient-verifier
    provides: "04-26 RunDrawer kind 'full' | 'partition' | 'check' + RunPartition; 04-13 cellsForRun; 04-04 estimatePreset onlyCells; 04-03 isoWeekOf; 04-14 RunStatusBadge; 04-07 PRESET_* / PLACES_MODE_NOTICE_* / STOPPED_REASON / RUN_KIND_LABEL copy"
provides:
  - "src/components/preset-detail/run-actions.tsx: RunActions({ slot: 'primary' | 'card', mode, noticeId, costs, partition, drawer }) — client"
  - "src/components/preset-detail/places-mode-notice.tsx: PlacesModeNotice({ mode, id }) — server-safe"
  - "src/components/preset-detail/other-runs.tsx: OtherRuns({ rows }) — the 'Other ways to run' card"
  - "src/components/preset-detail/recent-runs.tsx: RecentRuns({ runs, mode }), RECENT_RUNS_LIMIT, RecentRun — server-safe"
  - "src/components/preset-detail/run-costs.ts: presetRunCosts(spec, ctx, now, tz?) → { lines, partition, ranges }"
  - "src/components/preset-detail/run-plan.ts: MODE_ALLOWS, planRunActions(mode), RUN_KIND_OF_ACTION — shared by page and RunActions"
  - "SummaryCard: lastRun.id + 'Open the run report' link, runCost line"
affects: [04-28, 04-31, 04-33]

tech-stack:
  added: []
  patterns:
    - "One component, two slots: RunActions renders the primary slot and the card from the same plan, so each testid exists exactly once"
    - "A mode table read by both a server page and a client component lives in its own server-safe module (never exported from the client module)"
    - "Disabled = aria-disabled + no-op click + aria-describedby on the reason, never the HTML attribute"

key-files:
  created:
    - src/components/preset-detail/run-actions.tsx
    - src/components/preset-detail/places-mode-notice.tsx
    - src/components/preset-detail/other-runs.tsx
    - src/components/preset-detail/recent-runs.tsx
    - src/components/preset-detail/run-costs.ts
    - src/components/preset-detail/run-plan.ts
    - tests/unit/preset-actions.test.tsx
    - tests/unit/preset-run-costs.test.ts
  modified:
    - src/app/(app)/presets/[id]/page.tsx
    - src/components/preset-detail/summary-card.tsx
    - src/lib/ui/copy.ts
    - tests/e2e/preset-detail.spec.ts

key-decisions:
  - "A partition that covers zero cells this ISO week is aria-disabled with an explanatory sentence (PRESET_PARTITION_EMPTY). The UI-SPEC does not cover this case. queueRun would otherwise admit it, hold 1 µUSD and complete having searched nothing"
  - "The summary card's cost line follows the PRIMARY action (the change check in ids_only, the full sweep otherwise), so all three costs are on screen in every mode"
  - "Card row titles name the run kind (RUN_KIND_LABEL); the buttons carry the verbs, so no row says the same thing twice"
  - "The partition and check drawers get their own RunVersionOption, so the partition drawer quotes the partition's range and not the full sweep's"
  - "Recent runs show the STOPPED_REASON sentence for partial runs only, the same rule /spend uses"

requirements-completed: [PLACE-04]

duration: ~30min
completed: 2026-09-23
---

# Phase 4 Plan 27: The preset page's three ways to run Summary

**The preset page now offers "Run full sweep", "Run this week's partition" and "Check for changes (free)". Each action shows its cost line, and each opens the 04-26 drawer with its own kind. The page reads `PLACES_MODE` on the server. In `off` mode the Places-mode notice explains the switch, the three actions are `aria-disabled` but focusable and described by the notice, and nothing on the page is accent. In `ids_only` the free check takes the primary slot. A "Recent runs" card lists the five newest runs across versions. Each row links to its report, and the summary's last-run line links to it too. The last e2e click that could start a run is gone.**

## Performance

- **Duration:** about 30 min (23:03Z to 23:32Z)
- **Tasks:** 2 planned, 4 commits (both tasks TDD: RED, then GREEN)
- **Files:** 8 created, 4 modified

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | `83f70c3` | test(04-27): add failing dom tests for the preset run actions and places-mode notice |
| 1 GREEN | `2c3cd26` | feat(04-27): run actions, places-mode notice and other-runs card with the accent by mode |
| 2 RED | `f56e6b8` | test(04-27): add failing tests for recent runs, the report link and the three cost lines |
| 2 GREEN | `ccdd31f` | feat(04-27): wire the three ways to run, recent runs and the report link into the preset page |

## What the page renders now

The page order is breadcrumb, title row with the primary action, Places-mode notice, summary card, (phone) Edit preset, "Other ways to run", "Recent runs", then version history.

| `PLACES_MODE` | Primary slot (title row, or the phone's sticky bar) | "Other ways to run" card | Accent | Notice |
|---|---|---|---|---|
| `enterprise` | `run-preset` "Run full sweep", enabled | `run-partition`, `run-check-changes` (outline) | `run-preset` | none |
| `ids_only` | `run-check-changes`, enabled | `run-preset`, `run-partition` (both `aria-disabled`) | `run-check-changes` | `data-mode="ids_only"`, `circle-dashed` |
| `off` | `run-preset`, `aria-disabled`, plus the phone line "Places is switched off — see the note at the top." | `run-partition`, `run-check-changes` (both `aria-disabled`) | none | `data-mode="off"`, `power-off` |

**Cost lines.** `presetRunCosts` computes them on the server with the same functions `queueRun` admits with.
- Full sweep: `estimatePreset(spec, ctx)`.
- Partition: `cellsForRun(spec, seed, 'partition', now)`, then `estimatePreset(…, { onlyCells: cellKey ∈ set })`, then `isoWeekOf(now)`.
- Check: `PRESET_COST_CHECK(full.requestsHi)`.

The week is APP_TZ's. If the preset can't be expanded into cells, every line reads "Not priced" and `partition` is `null`.

**D-18, the RGV baseline.** The full sweep is shown as it is. Its cost line quotes the real top of the range (above the $50 cap), and the estimate line's share reads over 100% of the remaining budget. The action is **not** disabled. Confirming it gives the drawer's inherited `run-refused` alert, which is budget copy with a way out. The partition's line shows the ~¼ that fits. The test pins `full.costMicroUsdHi > $50`.

## Verification

### Gates (branch `worktree-agent-af1df676dade46e6f`, HEAD `ccdd31f`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src tests scripts` | exit 0 |
| Unit lane `npx vitest run tests/unit` | **81 files, 620 tests passed** (605 before, plus 15 new) |
| `npx next build` | exit 0. Build line, verbatim: **`workflows build complete (8 steps, 1 workflow, time 63ms)`** |
| `npx playwright test tests/e2e/preset-detail.spec.ts --list` | 3 tests + setup listed. **Not run**: this spec is local-only, and real-screen checks belong to 04-33 |
| Recent-runs SQL | Ran read-only against local `siteless_test` with `node --env-file`. It returned 0 rows and columns `id,kind,status,stopped_reason,cost,version,at_ms,started_ms` |
| Prettier on new or changed lines | clean. The remaining warnings are in lines this plan did not touch: `copy.ts:428`, and in `page.tsx` the function signature and in `preset-detail.spec.ts` the fixture/teardown SQL (both 04-26 era). `version-history.tsx` is untouched |

**PASS list (names read from `--reporter=verbose`):**
- `tests/unit/preset-actions.test.tsx`, run actions (dom):
  - `the accent goes to the first enabled run action`
  - `exactly one element per run testid in every mode`
  - `disabled run actions are aria-disabled and focusable`
  - `an enabled run action opens its own drawer kind`
  - `the check action reads as free through words, not colour`
  - `the partition action names this iso week and its date range`
  - `a partition with no cells this week is disabled and says why`
  - `the places mode notice renders per mode`
- `tests/unit/preset-actions.test.tsx`, recent runs (dom):
  - `recent runs list the five newest with kind, cost and status`
  - `recent runs empty state names the off mode`
  - `the summary links the last run's report`
  - `a never-run preset has no report link`
- `tests/unit/preset-run-costs.test.ts` (node):
  - `the partition cost line prices only this week's cells`
  - `the partition is the RGV's week, not the server's`
  - `a preset that cannot be expanded reads not priced everywhere`

### Mutation checks

For each mutation: I applied it, ran the named test with `-t`, read the red test by name, and reverted. After the set, a grep confirmed no mutation text remained, and the suite was back to 15/15.

| # | Mutation | Red (exact name) |
|---|---|---|
| 1 | `ids_only` enables the full sweep | `the accent goes to the first enabled run action`: the accent is on `run-preset`, expected `run-check-changes` |
| 2 | `disabled={!enabled}` added to the button | `disabled run actions are aria-disabled and focusable`: `run-preset` has `disabled` |
| 3 | the card also renders the primary action | `exactly one element per run testid in every mode`: `enterprise: run-preset` |
| 4 | a partition with zero cells stays enabled | `a partition with no cells this week is disabled and says why` |
| 5 | an inert primary keeps `variant="default"` | `the accent goes to the first enabled run action`: `off: no accent`, got 1 |
| 6 | the notice falls back to `role="alert"` | `the places mode notice renders per mode` |
| 7 | the partition is priced over every cell | `the partition cost line prices only this week's cells`: `expected 3978 to be 1341` |
| 8 | `isoWeekOf(now)` without the zone | `the partition is the RGV's week, not the server's`: `expected 40 to be 41` |
| 9 | recent runs not sorted | `recent runs list the five newest with kind, cost and status` |
| 10 | stopped sentence shown for every status | `recent runs list the five newest with kind, cost and status` (the refused row shows it) |
| 11 | the empty body chosen by the wrong mode | `recent runs empty state names the off mode` |
| 12 | the summary link goes to `/spend` | `the summary links the last run's report` |

### Acceptance greps

- `grep -n " disabled={\| disabled " run-actions.tsx` returns nothing (exit 1). I reworded three comments that tripped it.
- `grep -rn "NEXT_PUBLIC_" src/components/preset-detail/` returns nothing.
- `grep -n "env.PLACES_MODE" "src/app/(app)/presets/[id]/page.tsx"` matches L242.
- `grep -rn "run-confirm" tests/e2e` returns nothing. **No e2e spec clicks a run confirm any more (T-4-09).**
- `grep -n "gap-3" "src/app/(app)/presets/[id]/page.tsx"` returns nothing. The title row is now `gap-4` (Rule 41).

## Test ids for 04-28 and 04-33

- Preset detail:
  - `run-preset`, `run-partition`, `run-check-changes`. Each carries `data-enabled` and, when inert, `aria-disabled="true"` and `aria-describedby`.
  - `run-primary-slot`, the sticky/title-row wrapper.
  - `run-off-sticky-note`, phone only (`sm:hidden`).
  - `places-mode-notice`, with `data-mode` and `id="places-mode-notice"`.
  - `preset-other-runs` and `preset-other-run-{full|partition|check}`.
  - `run-cost-{full|partition|check}`, in the card rows only.
  - `run-partition-week` and `run-partition-empty`.
  - `summary-run-cost` and `summary-last-run-link`.
  - `preset-recent-runs`, `preset-run-row-{runId}` (an `<a>`, `min-h-11`), `preset-run-status-{runId}`, `preset-recent-runs-empty` and `preset-recent-runs-spend`.
- The drawer is unchanged from 04-26. It carries `data-run-kind` on `run-drawer`.
- **Accent probe:** use `button[data-variant="default"]`, never `[data-slot="button"]`. A Radix `asChild` trigger spreads `data-slot="dialog-trigger"` over the Button's own `data-slot`, which is what broke my first accent test.
- **04-33 screenshots** should cover all three modes. Only `off` renders locally by default. `ids_only` and `enterprise` need `PLACES_MODE` set for the local server only. **Never click a confirm.**

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Correctness] The partition and check drawers get their own version option**
- **Found during:** Task 2
- **Issue:** the drawer reads "Estimated cost" and "Requests" from the `RunVersionOption` it is given. If the page had passed the history options to every drawer, the partition drawer would have quoted the whole preset's range.
- **Fix:** `drawer.versions` is a `Record<'full'|'partition'|'check', RunVersionOption[]>`. The partition drawer gets the partition's range, and the check drawer gets the full request count.
- **Commit:** `ccdd31f`

**2. [Rule 2 - Drift] The mode table lives in `run-plan.ts`**
- **Issue:** the page (a server component) and `RunActions` (a client component) both need `planRunActions`. The page needs it because the summary's cost line follows the primary action. Data exported from the client module would reach the server as a client reference, so it would be `undefined` at runtime with every gate green. Two copies of the table would drift.
- **Fix:** a new server-safe module, `src/components/preset-detail/run-plan.ts`, holds `MODE_ALLOWS`, `planRunActions` and `RUN_KIND_OF_ACTION`. Both sides import it.

**3. [Rule 2 - Testability] Cost lines are computed in `run-costs.ts`, not inline in the page**
- The plan put the three `estimatePreset` calls in `page.tsx`, where no unit test could reach them. `presetRunCosts` is a pure function with 3 node tests and 2 mutations (7 and 8), which pin "the partition prices only this week's cells" and "the week is the RGV's".

**4. [Plan wording] The summary shows the PRIMARY action's cost line, not always the full sweep's**
- UI-SPEC says the full sweep's line joins the summary card "so all three costs are visible". In `ids_only` the full sweep already has a card row, and the check (the primary) would have had no visible cost line anywhere. The line is labelled with the kind: "Full sweep · …" or "Change check · $0.00 · …".

**5. [Plan wording] Query column is `v.version`, not `v.version_number`**
- `search_versions.version` is the real column. I checked it against the schema and ran the query against the local DB.

**6. [Plan wording] Recent-row time is `coalesce(started_at, created_at)`; "Last run" keeps `coalesce(finished_at, started_at, created_at)`**
- Both come from one query (`started_ms` and `at_ms`), so the summary line is unchanged from Phase 2.

**7. [Rule 3] Accent test selector**
- The first GREEN run failed `the accent goes to the first enabled run action` because the Radix trigger's `data-slot` overrode the Button's. The selector is now `button[data-variant="default"]`. This fixed the test; the component was correct.

**8. [Copy] New strings, all in `copy.ts`**
- `PRESET_COST_NOT_PRICED` ("Not priced", inherited wording)
- `PRESET_PARTITION_WEEK(week, range)`
- `PRESET_PARTITION_EMPTY(totalCells, week)`
- `PRESET_SUMMARY_RUN_COST(kind, line)`
- `PRESET_RECENT_RUN_META(started, kind, version)`. `PRESET_RECENT_RUN_ROW` now composes it and its output is unchanged.

### Decision for danlo: the zero-cell partition

**The UI-SPEC doesn't cover this case, so I disabled the action and it says why.**

When this ISO week's partition holds 0 of the preset's cells, `run-partition` is `aria-disabled`. The row keeps its cost line ("… 0 of 1 cells (week 40)") and adds this sentence, which also describes the button:

> "This preset's only cell is assigned to another week, so week 40's partition has nothing to search and nothing to charge. Run the full sweep instead, or run the partition in a week one of its cells comes up."

(Plural form: "All {n} of this preset's cells are assigned to other weeks, …".)

This is common for small presets. A 1-city × 1-cluster preset has one cell, so 3 weeks in 4 have an empty partition. The accent never moves, because the partition is never the primary while the full sweep is enabled. Override path: remove the `partition.cells > 0` clause in `run-actions.tsx` `enabledOf`, and mutation 4's test will need to change.

## Flags for downstream plans and danlo

- **Version-history run buttons ignore the mode.** The per-version "Run" buttons in `version-history.tsx` (outline, pickable drawer, `kind="full"`) stay clickable in `off` / `ids_only`. They end in `run-mode-refused`, whose copy says the mode was switched "after this page loaded". That is inaccurate when it was off all along. This is outside this plan's files. The fix is a small one: pass `placesMode` through `HistoryContext` and render those triggers `aria-disabled` with the same notice id. Suggested owner: 04-28/04-31 or a quick follow-up.
- **"Key Decisions" link.** UI-SPEC accent item 6 lists "the Places-mode notice's 'Key Decisions' reference link". PROJECT.md isn't served by the app and there's no repo URL to link to, so the notice renders it as text. If danlo wants a link, name the target.
- **The `/spend` footer link lands on the By-provider tab.** `/spend`'s tabs have no URL state (`defaultValue="by-provider"`), so "See all runs on the spend view" can't open By-run directly.
- **The notice renders even without a current version.** The off-mode empty state for recent runs says "the note at the top", so the note is always there.

## Merge notes

- **No migration and no DB writes.** The only DB contact was one read-only `select` against local `siteless_test`.
- **Shared files other plans touch:**
  - `src/lib/ui/copy.ts`: additions only, in the "Preset detail" block, plus `PRESET_RECENT_RUN_ROW` now composes `PRESET_RECENT_RUN_META`.
  - `summary-card.tsx`: `LastRun` gained a required `id`, and `SummaryCard` gained a required `runCost` prop. The only caller is `presets/[id]/page.tsx`.
  - `tests/e2e/preset-detail.spec.ts`: the last test was replaced and one header sentence reworded.
- **Not touched:** STATE.md, ROADMAP.md, production and the deployed URL. Nothing was pushed. **No Google request was made.** No Playwright run happened, only `--list`.

## Known Stubs

None. Every cost line, partition figure and recent run comes from the server. "Not priced" appears only when the estimator throws, which is the inherited behaviour.

## Threat Flags

None beyond the plan's threat model:
- **T-4-01:** `env.PLACES_MODE` is read in the server page and passed on as a string. `NEXT_PUBLIC_` doesn't appear in `preset-detail/`, and no client module imports `src/env.ts`.
- **T-4-02:** inert actions are an affordance only. `queueRun`'s own refusal is unchanged (04-26 mutations 1 and 2).
- **T-4-09:** the grep for `run-confirm` over `tests/e2e` returns nothing.

## TDD Gate Compliance

- Task 1: RED `83f70c3` (the modules were missing, so the file failed to import), then GREEN `2c3cd26` (8/8).
- Task 2: RED `f56e6b8` (`recent-runs` and `run-costs` were missing), then GREEN `ccdd31f` (15/15 across both files).
- No refactor commit was needed.

## Self-Check: PASSED

- FOUND: run-actions.tsx, places-mode-notice.tsx, other-runs.tsx, recent-runs.tsx, run-costs.ts and run-plan.ts under `src/components/preset-detail/`; `tests/unit/preset-actions.test.tsx`; `tests/unit/preset-run-costs.test.ts`
- FOUND commits: 83f70c3, 2c3cd26, f56e6b8, ccdd31f
