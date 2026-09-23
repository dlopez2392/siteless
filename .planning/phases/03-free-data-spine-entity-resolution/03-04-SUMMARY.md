---
phase: 03-free-data-spine-entity-resolution
plan: 04
subsystem: ui-shell
tags: [navigation, copy, shadcn-sheet, e2e, touch-targets]
requires: []
provides:
  - "LEADS_NAV / OPERATIONS_NAV (src/components/app-shell/app-sidebar.tsx) — the single definition of the six destinations"
  - "SidebarNavRow — the shared row treatment used by the sidebar and the More sheet"
  - "MoreSheet (src/components/app-shell/more-sheet.tsx), data-testid=more-sheet"
  - "Every 03-UI-SPEC Copy Table / Empty / Error string exported from src/lib/ui/copy.ts"
affects:
  - "03-16 (/review), 03-17 (/sources), 03-18 (/businesses), 03-19 (/businesses/[id]) — read copy.ts, never edit it"
  - "03-21 — re-runs touch-targets against the deployed URL once the new nav ships"
tech-stack:
  added: []
  patterns:
    - "Count-bearing copy functions take the raw number (for grammar) plus a caller-formatted `shown` string — copy.ts never formats"
    - "Surface-gated e2e hooks: open the surface, then assert exactly-one-visible (precondition changes, invariant does not)"
key-files:
  created:
    - src/components/app-shell/more-sheet.tsx
  modified:
    - src/lib/ui/copy.ts
    - src/components/app-shell/app-sidebar.tsx
    - src/components/app-shell/mobile-tab-bar.tsx
    - tests/unit/ui-maps.test.ts
    - tests/e2e/touch-targets.spec.ts
decisions:
  - "More tab is a plain <button> owning the sheet's open state (not a SheetTrigger), so the lit-state rule and the open state live together in the tab bar"
  - "data-active on nav-more mirrors the accent state so e2e can assert it without reading a colour"
  - "Markdown backticks around desk commands in the spec are typesetting, not copy — commands are plain text in the sentences and exported alone as INGEST_COMMAND"
  - "BUSINESSES_COUNT_LINE only appends 'showing the first {m}' when m < n"
  - "Phase 3's unexpected-error copy is SPINE_UNEXPECTED_ERROR, leaving Phase 2's UNEXPECTED_ERROR ('Nothing was charged') untouched"
metrics:
  duration: "~45 min"
  completed: 2026-09-22
  tasks: 2
  files: 6
---

# Phase 3 Plan 04: Navigation split and the Phase 3 copy table, summary

The nav now has six destinations split into two groups: **Leads** (Presets · Review · Businesses) and **Operations** (Sources · Spend · Settings). On desk the sidebar shows both groups under labels, divided by a Separator. On phone there are four tabs, and the fourth, **More**, opens a bottom Sheet holding the three Operations rows under their original testids. `touch-targets.spec.ts` changed in the same commit as the nav, and all of 03-UI-SPEC's copy now lives in `src/lib/ui/copy.ts`.

## Tasks

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Every 03-UI-SPEC Copy Table string in copy.ts | `adc1d1d` | src/lib/ui/copy.ts |
| 2 | Six destinations / two groups / four tabs / More sheet + touch-targets spec (same commit, Rule 21) | `d37c224` | app-sidebar.tsx, mobile-tab-bar.tsx, more-sheet.tsx (new), ui-maps.test.ts, touch-targets.spec.ts |

## What was built

- **copy.ts**: the file went from 26 to 121 `export const|function` lines (+95, against a required +60). It holds NAV (six destinations plus More), NAV_GROUP and MORE_SHEET_TITLE. It also has every `/review`, `/sources`, `/businesses` and `/businesses/[id]` string, the unmerge dialog, the three success toasts plus `LEAD_KEY_COPIED`, all 6 empty states and all 10 error strings. Beyond the plan's list it adds the chip vocabulary (`REVIEW_CHIP`, `REVIEW_CHIP_NAME`, `REVIEW_CHIP_APART`), `SOURCE_NAME`, `SOURCES_RUN_STATUS`, `INGEST_RUN_FAILED/STOPPED`, `ERROR_ACTION`, `UNMERGE_BUSY` and `INGEST_COMMAND`. It has no client directive and makes no `Intl.` call.
- **app-sidebar.tsx**: `LEADS_NAV` and `OPERATIONS_NAV` are defined here, and `NAV_ITEMS` is now their concatenation. The icons are `git-compare`, `store` and `database`; `building-2` still appears only on the org header. `SidebarNav` renders two `role="group"` blocks with Label 14/600 muted headings (`nav-group-leads`, `nav-group-operations`) and the shared `Separator` between them. The row geometry was moved into the exported `SidebarNavRow` without changes.
- **mobile-tab-bar.tsx**: `grid-cols-4`. The three Leads links are followed by a `<button data-testid="nav-more">` with the `ellipsis` icon and the visible label "More", using the same `h-16 min-h-11 min-w-11` classes. `OPERATIONS_NAV.some(isNavActive)` lights the More tab with the accent icon, label and top bar, and also sets `data-active="true"`.
- **more-sheet.tsx**: the shared shadcn `Sheet` with `side="bottom"` and `data-testid="more-sheet"`, titled "More". It holds the three `OPERATIONS_NAV` rows via `SidebarNavRow`, closes when a row is tapped, and pads the bottom with `env(safe-area-inset-bottom)`.
- **ui-maps.test.ts**: a new test, `nav groups hold six destinations`. It checks that there are 3 + 3 items, the six testids in order, that `NAV_ITEMS` equals Leads followed by Operations, that no `building-2` icon is used, and that every item has a non-empty label.
- **touch-targets.spec.ts**: the phone loop now measures `nav-presets`, `nav-review`, `nav-businesses`, `nav-more` and `user-menu`. It then checks `nav-more[data-active=true]` on `/settings/organization`, measures the theme switch in the user menu and closes it with Escape. Next it taps More, checks `more-sheet` is visible, and measures `nav-sources`, `nav-spend` and `nav-settings`. A new desk test at 1280×800 measures all six sidebar rows. `expectTargetAtLeast44` and its `toHaveCount(1)` check are unchanged.

## Verification

- `tsc --noEmit`: exit 0. `eslint .`: exit 0 (after each task).
- Unit tests: **82/82 pass across 20 files**. The named test `nav groups hold six destinations` shows as ✓ in verbose output.
  - Note: `pnpm test:unit -- -t "..."` passes `--` through literally, and the filter was **not applied** (all 82 tests ran). I re-ran with `vitest run tests/unit -t "nav groups hold six destinations" --reporter=verbose`: 1 passed, 81 skipped, and the test name was read in the output.
- **Mutation check**: I changed Businesses' `iconName` to `building-2` and the named test failed (×, exit 1). The change was reverted, and `grep` confirmed 0 remaining occurrences.
- `next build`: green (Turbopack, 13 routes).
- **e2e, run locally as the plan requires** (the deployed E2E_BASE_URL still has the old nav): `next build && next start -p 3104` in this worktree, then `E2E_BASE_URL=http://localhost:3104 playwright test -g "touch targets"`. **3 passed**: setup, the phone test at 390×844, and the desk test at 1280×800.
- **Proof that Rule 21's regression was real**: I ran the old spec from HEAD~ against the new build. It failed with `nav-spend should have exactly one visible match — Expected: 1, Received: 0`. The temporary spec file was then deleted.
- The only other spec using a moved hook is `theme-tokens.spec.ts`, which reads `nav-settings` at the desk viewport. Against the same local build it went **4 passed**, so it needed no change.
- I screenshotted the built app at 390×844 in both themes, including the open More sheet, and at desk. Four tabs sit in the tab bar with More lit on /settings, the sheet rows have Settings lit, and the desk sidebar shows both groups and the separator.
- `git diff --stat src/app/layout.tsx src/app/globals.css components.json` is empty.
- The only server stopped was the one I started (PID 94812, listening on 3104, a port that was free beforehand).

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] `pnpm test:unit -- -t` does not filter**
- **Found during:** Task 2 verify
- **Issue:** the plan's verify command passes `--` to vitest as a literal argument, so `-t` is ignored and the whole suite runs green. That would be green even if the named test did not exist.
- **Fix:** verified with `vitest run tests/unit -t "<name>" --reporter=verbose` and read the test name. The package script was not changed.

**2. [Rule 2 - Correctness] Added the More-tab lit-state assertion and a desk block to the e2e spec**
- The plan's truths require the More tab to be lit on an Operations route and the desk to show all six rows. Neither was checked by any test, so both are now asserted in `touch-targets.spec.ts`.

**3. Acceptance-criterion wording vs pre-existing tree**
- `grep -n "shadcn init" -r src tests` should return nothing, but it matches three **pre-existing** comments in `src/app/globals.css` and `src/app/layout.tsx` that describe the original Phase 2 init. This plan did not touch those files, and their diff is empty. The actual check, that no init was run, holds.
- `data-testid="nav-more"` sits on its own line inside a multi-line `<button ...>` element, so a one-line grep shows the attribute, not the `<button` tag.

### Out-of-scope observations (not fixed)
- The shared `SheetContent` shows its default close button, an icon-only `size="icon-sm"` ghost ✕ that is probably under 44px. The existing tablet off-canvas in `top-bar.tsx` has the same button. Users can also close the sheet by tapping the overlay or pressing Escape, and the touch-targets spec does not measure it. Worth a look in 03-22's visual review.

## Known Stubs

None. The Review, Businesses and Sources links go to routes that plans 03-16 to 03-18 build. Until those merge, the links 404 on this branch, which is expected at wave 1.

## Threat Flags

None. No new data flows into the shell components. The copy module carries no record data, and neither `name_norm` nor `internal_notes` appears in it (T-3-11).

## Self-Check: PASSED

- FOUND: src/components/app-shell/more-sheet.tsx
- FOUND: src/lib/ui/copy.ts, src/components/app-shell/app-sidebar.tsx, src/components/app-shell/mobile-tab-bar.tsx, tests/unit/ui-maps.test.ts, tests/e2e/touch-targets.spec.ts
- FOUND commit adc1d1d, FOUND commit d37c224
