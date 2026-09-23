---
phase: 04-places-transient-verifier
plan: 23
subsystem: ui
tags: [run-report, places, attribution, truncation, rsc, nextjs]
requires:
  - phase: 04-07
    provides: Phase 4 copy (RUN_*, STOPPED_REASON, RUN_FAILED_ERROR, HOST_CLASS_SHORT_LABEL), run-tone STOPPED_REASONS / RUN_KIND_LABEL
  - phase: 04-08
    provides: GoogleMapsTag (the only attribution mark)
  - phase: 04-14
    provides: RunStatusBadge, RunAutoRefresh (5 s refresh island + polite live region)
  - phase: 04-20
    provides: getRunReport(claims, runId) / RunReport
provides:
  - /runs/[id] route (page, loading, error, not-found)
  - RunReportView + RunReportUnavailable (src/components/runs/run-report-view.tsx)
  - RunHeader, runInstantLabel, runDurationLabel, ceilingMicroUsdOf (run-header.tsx)
  - RunAlerts, tileRowText, GOOGLE_DAILY_QUOTA_REQUESTS (run-alerts.tsx)
  - RequestsCard, TilesCard (+ CountGrid, RunCardTitle, RUN_CARD_CLASS), OutcomesCard, ChangesCard
  - tests/unit/run-report.test.tsx (23 named dom tests)
affects: [04-27, 04-28, 04-33]
tech-stack:
  added: []
  patterns:
    - "Places-derived card = the [data-places-content] container with exactly one GoogleMapsTag at its foot; our own ledger card carries none"
    - "Desk table + phone rows as two trees with DISTINCT testids (run-sku-row-* / run-sku-card-*, run-cluster-row-* / run-cluster-card-*); count grids are one tree that re-flows"
    - "Card padding via the primitive's --card-spacing variable (sm:[--card-spacing:--spacing(6)]) — the `cn` package does not merge classes, so a p-* would race the primitive's own"
    - "Collapsible Show/Hide label switched by CSS on Radix data-state — no client state in a server component"
    - "generateMetadata + page share one read through React cache()"
key-files:
  created:
    - src/app/(app)/runs/[id]/page.tsx
    - src/app/(app)/runs/[id]/loading.tsx
    - src/app/(app)/runs/[id]/error.tsx
    - src/app/(app)/runs/[id]/not-found.tsx
    - src/components/runs/run-report-view.tsx
    - src/components/runs/run-header.tsx
    - src/components/runs/run-alerts.tsx
    - src/components/runs/requests-card.tsx
    - src/components/runs/tiles-card.tsx
    - src/components/runs/outcomes-card.tsx
    - src/components/runs/changes-card.tsx
    - tests/unit/run-report.test.tsx
  modified: []
key-decisions:
  - "Task order 2 → 3 → 1: page.tsx imports RunReportView, so committing the route first would have left a non-compiling commit"
  - "The Google daily quota (100/day, D-19) is a UI constant GOOGLE_DAILY_QUOTA_REQUESTS in run-alerts.tsx — nothing in src/ held the number and RUN_STOP_DAILY_QUOTA needs it"
  - "Stop alerts drop the Alert primitive's role=alert: RunAutoRefresh's one polite region announces the transition; only the truncation warning keeps role=status (spec)"
  - "exceeded_estimate: the stop alert's 'Show the tiles still subdividing' is an in-page link to the Tiles card's list, which opens by default on such runs (no shared client state)"
  - "A terminal run whose key has no long-form alert for its status falls back to its short STOPPED_REASON sentence; failed with a null reason shows no stop alert (no copy exists and inventing one is Rule 5)"
requirements-completed: [PLACE-03, PLACE-06]
duration: ~45min
completed: 2026-09-23
---

# Phase 4 Plan 23: The run report screen Summary

**`/runs/[id]` renders 04-20's single `RunReport` read as a live ledger. It shows the status and summary line, a Display-size cost against the estimate and both ceilings (dollar and request), a stop alert per reason, a truncation warning in every status, requests by SKU, tiles, outcomes by cluster with the website split, and a Changes card for change checks. Each Places-derived card carries exactly one Google Maps tag.**

## Performance

- **Duration:** ~45 min (first commit 16:48, last 17:08 CDT, plus setup and gates)
- **Completed:** 2026-09-23
- **Tasks:** 3/3
- **Files:** 12 created, 0 modified

## Accomplishments

- **Header card** (`run-report-header`)
  - `RunStatusBadge` with the muted kind label and "started …".
  - The status summary line for each of the six statuses.
  - The run cost in Display 28/600, foreground, never accent.
  - `RUN_ESTIMATE_LINE` with `RUN_CEILING_MULTIPLIER × hi` plus `runs.ceiling_requests` (D-18).
  - The muted above-estimate line, shown only when the top of the estimate < cost < the ceiling.
  - The change-check cost note.
  - `RunAutoRefresh` **mounted in every status**, with the "Finished … · took 17m 04s" line rendered beside it (04-14 handoff).
- **Alerts:**
  - Refused, cap stop, estimate stop, Google daily quota, never-started, abandoned, and the three Places failures, each rendered through the copy map.
  - Cap actions for admins and members: "Raise the monthly cap" or "Ask an admin to raise the cap".
  - A muted `clock` alert for a run queued more than 2 minutes.
  - The criterion-3 truncation warning: `role="status"` and `data-count`, a collapsible tile list ("city:4845384 · roofing_contractor · tile r012"), and "Copy the tile list", one tile per line.
  - A tile with a null `why` is listed, not dropped.
- **Cards:**
  - Requests: both SKUs at zero, "Refused by the meter" only when > 0, and a Total row that includes it. No tag.
  - Tiles: a four-count grid. Still-truncated takes warning styling plus an icon when > 0. On `exceeded_estimate` runs it adds the list of tiles still subdividing.
  - Outcomes:
    - the Matching grid, with "Review {n} in the queue" linking to `/review?kind=google`;
    - every cluster, zero rows included, as a desk table and phone cards;
    - "Website on Google" in the fixed `HOST_CLASS_ORDER`, all rows one colour;
    - inline "No Google places yet" while the run is live, and an `Empty` "Google returned no places" with "Open {preset}" once it has finished.
  - Changes (for change checks): replaces Outcomes.
  - A refused run renders only its header and alert.
- **Route:**
  - The page:
    - is `force-dynamic` and runs `isUuid` first; a bad id renders its own body inline;
    - makes one `getRunReport` read, shared with `generateMetadata` via `cache()`;
    - answers `notFound()` for both unknown and foreign ids (T-4-06);
    - reuses the `org:admin` affordance;
    - shows a desk breadcrumb "Presets / {preset} / Run {Sep 23, 2:14 PM}" and a 44px phone back link.
  - `loading`: skeletons only, never a spinner.
  - `error`: "Try again" (`retry`) and "Open spend view".
  - `not-found`: the spec copy.

## Task Commits

1. **Task 2 RED:** `b968ca4` test(04-23): add failing tests for the run report header and alerts
2. **Task 2 GREEN:** `e694775` feat(04-23): run report view, header and alerts
3. **Task 3 RED:** `4f2d90a` test(04-23): add failing tests for the run report cards
4. **Task 3 GREEN:** `31217d8` feat(04-23): requests, tiles, outcomes and changes cards
5. **Task 1:** `dd46516` feat(04-23): the /runs/[id] route — page, loading, error, not-found

## Tests (named, read by name in the verbose reporter)

`tests/unit/run-report.test.tsx` has 23 tests, all green. Every plan-named test is present:
- `the run report shows the truncation warning in every status including complete`
- `the run report never renders a raw stopped reason` (all eight keys, each with its writer's status)
- `the run report renders the refused state alone`
- `the ceiling line shows the dollar and request ceilings` (exact string `Estimated $1.90–$2.90 · this run stops at $5.80 · 108 requests`)
- `the header shows the above-estimate line only between the top of the estimate and the ceiling` (boundaries hi, hi+1…2hi−1, 2hi)
- `the header's live parts appear only while the run is live`. It pins the Chicago "Finished Sep 23, 2:31 PM" against the suite's UTC zone, so the same instant renders 7:31 PM in UTC and 2:31 PM in Chicago.
- `the cost is display-sized and foreground`
- `the requests card renders both SKUs even at zero`
- `the tiles card warns on still truncated`
- `the outcomes card links tentative listings to the Google review filter`
- `the outcomes card lists every cluster including zero rows`
- `the website block keeps its fixed order and one colour`
- `a change check shows changes instead of matching`
- `places-derived cards carry the Google Maps tag`
- `the outcomes card says no places yet while live`
- `the outcomes card says Google returned none when finished empty`

Plus: the member cap way-out, kind label, queued-long, the truncation list and copy, stop-before-truncation order, the subdividing anchor, and **every testid on one element only** (desk/phone twins).

## Mutation checks (each applied, red on the named test, reverted, `git status` clean)

| # | Mutation | Red on |
|---|---|---|
| M1 | hide truncation when `complete` | the run report shows the truncation warning in every status including complete |
| M2 | failed alert prints the raw key instead of `RUN_FAILED_ERROR[reason]` | the run report never renders a raw stopped reason |
| M3 | dollar ceiling = hi (not 2×hi) | the ceiling line shows the dollar and request ceilings (+ above-estimate) |
| M4 | above-estimate `>=` hi | the header shows the above-estimate line only between … |
| M5 | unmount `RunAutoRefresh` on terminal | the header's live parts appear only while the run is live |
| M6 | cost `text-primary` | the cost is display-sized and foreground |
| N1 | delete the tag from Outcomes | places-derived cards carry the Google Maps tag |
| N2 | add a tag to Requests | places-derived cards carry the Google Maps tag |
| N3 | refused row always rendered | the requests card renders both SKUs even at zero |
| N4 | host classes sorted by count | the website block keeps its fixed order and one colour |
| N5 | drop zero clusters | the outcomes card lists every cluster including zero rows |
| N6 | still-truncated never warns | the tiles card warns on still truncated |
| N7 | refused run renders Requests | the run report renders the refused state alone |
| N8 | phone SKU blocks reuse `run-sku-row-*` | every testid … one element only (+ requests card) |
| N9 | Changes card never chosen | a change check shows changes instead of matching (+ tag test) |
| N10 | live/finished empty states swapped | both empty-state tests |
| T1 | page drops `isUuid(` | ids: every [id] route guards its id before it queries (names `runs\[id]\page.tsx`) |

## Gates (run from the worktree, on `dd46516`)

- `npx vitest run tests/unit`: **71 files, 550 tests passed**
- `npx tsc --noEmit`: exit 0
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0
- `npx next build`: exit 0, `ƒ /runs/[id]` in the route table
- Acceptance greps:
  - `gap-3` / `text-xs` in `src/components/runs/`: none.
  - `GoogleMapsTag` in the tiles, outcomes and changes cards: 3, 3 and 2 matches.
  - `GoogleMapsTag` in `requests-card.tsx`: none.
  - `isUuid` and `export const dynamic = 'force-dynamic'` in `page.tsx`: present.
- `prettier --check --end-of-line auto`: clean on every file created here.

## Decisions Made

See `key-decisions` in the frontmatter. Two carry consequences for later plans:
- **`GOOGLE_DAILY_QUOTA_REQUESTS = 100`** in `run-alerts.tsx`. If the quota is raised after D-04, change this constant and `docs/runbooks/google-quota.md` together. Better still, a later plan can move it next to the second-wall copy.
- **The stop alerts are not live regions.** Only the truncation warning (`role="status"`) and `run-live-status` are.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] Task order 2 → 3 → 1**
- **Issue:** `page.tsx` imports `RunReportView`. Task 1 first would have committed a route that could not compile.
- **Fix:** Executed the view/header/alerts (TDD), then the cards (TDD), then the routes. Every commit type-checks.

**2. [Rule 1 - Test correctness] The raw-key assertion excludes the word "abandoned"**
- **Issue:** `abandoned` is both a key and an English word in its own sentence ("marked it abandoned").
- **Fix:** The test asserts no underscore key appears, plus no `snake_case` token at all, which still catches `never_started` and the other seven. M2 proves the test bites.

**3. [Rule 2] `RunAutoRefresh` receives `costMicroUsd` and `stoppedReason`**
- **Why:** 04-14 made both props required. The plan's three-prop list predates that change.

**4. [Interpretation] The website block's DOM order follows the UI-SPEC layout: listed → five host classes → none**
- **Why:** The plan's test sketch listed `listed, none, then host classes`. The spec's block, which is the design contract, puts "No website listed" after the indented five.

**5. [Rule 2] Stop-alert role**
- **Issue:** The `Alert` primitive defaults to `role="alert"`, which would announce each stop a second time alongside the live region.
- **Fix:** Removed from the stop alerts, per § Accessibility.

**6. [Interpretation] `exceeded_estimate` "Show the tiles still subdividing"**
- **Change:** It is an in-page anchor (`#run-tiles-subdividing`) to the Tiles card's list, which opens by default on such runs.
- **Why:** A true cross-card toggle needs a shared client-state island that the spec does not call for. There is no "Hide" twin.

**7. [Rule 3] `error.tsx` composes its own alert**
- **Why:** `RouteError` only offers "Open sources" as its second action. Widening the shared component would touch a file outside this plan.

**8. [Scope] Prettier EOL churn reverted**
- **Issue:** `prettier --write --end-of-line lf` touched 04-14's `run-auto-refresh.tsx` and `run-status-badge.tsx` (EOL only).
- **Fix:** Both restored with `git checkout --`. No foreign file is in any commit.

**Total deviations:** 8 (none architectural). No scope creep: every file is in the plan's `files_modified`.

## Issues Encountered

- `cn` here is the `cn` npm package, not tailwind-merge. A `p-*` or `size-*` passed next to a primitive's own class does not replace it. Padding therefore moves through `--card-spacing`, and the `Empty` icon circle uses the repo's existing `size-12 rounded-full` convention.
- Radix `CollapsibleContent` does not render when closed, so the tile-list test clicks the toggle first. That is also the behaviour: the list is collapsed by default.

## Handoffs

- **04-28 (attribution registry + e2e):**
  - The run report's `PLACES_SIGNAL_SURFACES` are `TilesCard`, `OutcomesCard` and `ChangesCard`. Each card root carries `data-places-content` and holds exactly one `google-maps-attribution`.
  - `outcomes-card.tsx` is the one file here that imports `places-format.ts`, and it imports `GoogleMapsTag`.
  - Testids for e2e:
    - page and header: `run-report`, `run-report-header`, `run-status-badge`, `run-kind`, `run-status-line`, `run-cost`, `run-estimate-line`, `run-above-estimate`, `run-change-check-note`, `run-finished-line`, `run-updated-at`, `run-refresh-now`, `run-live-status`;
    - stop alert: `run-stop-alert[data-reason]` with `run-stop-{raise-cap|ask-admin|open-spend|open-preset|show-subdividing}`, plus `run-queued-long`;
    - truncation: `run-truncation-{warning|toggle|copy|list|tile}`;
    - requests: `run-requests` and `run-sku-row-{ts_enterprise|ts_essentials|refused|total}` (desk) / `run-sku-card-*` (phone);
    - tiles: `run-tiles`, `run-tiles-{searched|saturated|subdivided|truncated}`, `run-tiles-subdividing(-toggle|-tile)`;
    - outcomes: `run-outcomes`, `run-outcome-{found|attached|tentative|unmatched}`, `run-review-link`, `run-cluster-row-{key}` (desk) / `run-cluster-card-{key}` (phone), `run-website-{listed|none}`, `run-host-class-{class}`, `run-outcomes-{pending|empty|open-preset}`;
    - changes: `run-changes`, `run-changes-{checked|unchanged|new|gone|ids}`;
    - route states: `run-report-{loading|error|error-retry|error-open-spend|not-found|bad-id|back}`, `run-breadcrumb-{presets|preset}`.
  - Desk and phone twins both exist in the DOM. Scope selectors to the visible tree or pick the layout's testid.
- **04-33 (screenshots):**
  - Seed a `running` run and a `partial` one, the latter with `stillTruncated > 0` and an `exceeded_estimate` reason, to exercise every block.
  - Refused and change-check are the other two layouts.
- **04-27 (recent runs / preset links):** link rows to `/runs/{id}`. The phone back link and breadcrumb return to `/presets/{presetId}`.
- **Merge:** only new files, plus nothing shared. No conflict expected. `copy.ts` was not touched.

## Known Stubs

None. Every value is wired from `RunReport`. The daily-quota number is a documented constant, not a stub.

## Threat Flags

None. There is no new endpoint and no new auth path. The route reads through the existing `getRunReport` (RLS plus an org predicate).
- **T-4-06:** mitigated by the uuid guard, `notFound()` for both unknown and foreign ids, and the ids walk (T1).
- **T-4-13:** mitigated by one tag per Places container (N1/N2).
- **T-4-05:** mitigated by the copy-mapped reasons, tested over all eight keys (M2).

## Self-Check: PASSED

- Files exist (verified with `ls`): all 12 in `key-files.created`.
- Commits exist on `worktree-agent-abfdf01a427361ca7`: `b968ca4`, `e694775`, `4f2d90a`, `31217d8`, `dd46516`.
