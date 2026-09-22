---
phase: 02-budget-governor-search-presets
plan: 11
subsystem: ui
tags: [react-19, server-actions, use-transition, debounce, shadcn, radix, playwright, testing-library, estimate, geocoding]

# Dependency graph
requires:
  - phase: 02-07
    provides: 'src/lib/estimate/ (estimatePreset, texasMultiplier, builtInSpec), assumptions.ts constants, the committed seed, src/lib/ui/copy.ts'
  - phase: 02-09
    provides: 'estimatePreset / geocodeAddress / savePresetVersion actions, presetSpecSchema, readReferenceIndex, getPreset, RADIUS_MILE_OPTIONS, the ActionResult union'
  - phase: 02-10
    provides: 'the (app) route group gated by requireOrg(), the budget banner, the /presets placeholder this plan replaces, tests/e2e/auth.setup.ts'
provides:
  - '/presets — the costed preset list with its Empty state, loading skeletons and a thumb-zone CTA'
  - '/presets/new and /presets/[id]/edit — one editor, both entry points, all three geographies'
  - 'src/components/preset-editor/use-live-estimate.ts — the 400ms debounce plus the monotonic sequence guard (Pitfall 5)'
  - 'src/components/preset-editor/estimate-panel.tsx — D-06 five-line block that dims rather than blanks'
  - 'src/server/queries/preset-cards.ts and preset-editor.ts — the two screen-shaped reads'
  - 'tests/unit/stale-estimate.test.tsx — the first component test in this repo, mutation-proven'
  - 'tests/e2e/presets.spec.ts — all three geographies created end to end against a built server'
affects: [02-12, 02-13, 02-14, 02-15, phase-04-places-verifier, phase-07-triage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'One estimate node, two layouts: the SAME element is a fixed phone bar below lg and a sticky 320px rail at lg — never two copies hidden by breakpoint, because one testid resolving to two visible elements is 02-10 deviation 3'
    - '"Busy" is derived from the key on screen versus the key that was answered, never from useTransition pending alone — the debounce window is part of the wait'
    - 'Server pages preformat every number into a string prop; no client component carries a number formatter whose locale could drift from the server''s'
    - 'List rows share ONE testid plus a stable data attribute (data-city-id, data-county-fips): a testid carrying a uuid cannot be written down in a spec'
    - 'Every computed-style or bounding-box read on a transitioning property is POLLED until it settles — three separate probe lies in this plan alone'

key-files:
  created:
    - src/app/(app)/presets/new/page.tsx
    - src/app/(app)/presets/[id]/edit/page.tsx
    - src/components/preset-list/preset-card.tsx
    - src/components/preset-list/presets-empty.tsx
    - src/components/preset-list/create-preset-cta.tsx
    - src/components/preset-editor/preset-form.tsx
    - src/components/preset-editor/cluster-picker.tsx
    - src/components/preset-editor/geography-picker.tsx
    - src/components/preset-editor/radius-geocoder.tsx
    - src/components/preset-editor/estimate-panel.tsx
    - src/components/preset-editor/assumptions-surface.tsx
    - src/components/preset-editor/use-live-estimate.ts
    - src/server/queries/preset-cards.ts
    - src/server/queries/preset-editor.ts
    - tests/unit/stale-estimate.test.tsx
    - tests/e2e/presets.spec.ts
    - .planning/phases/02-budget-governor-search-presets/deferred-items.md
  modified:
    - src/app/(app)/presets/page.tsx
    - src/server/actions/save-preset-version.ts

key-decisions:
  - 'The headline dollar figure is costMicroUsdHi, because queueRun reserves the HIGH end against the meter — leading with the low end would quote a number smaller than the one the cap is tested against'
  - 'The estimate snapshot is attached to a save ONLY when the estimate is settled; a busy figure belongs to an earlier selection and a snapshot records what somebody was quoted'
  - 'Saving returns to /presets rather than /presets/[id]: the detail route is plan 02-12''s and this plan links to it without assuming it'
  - 'No Built-in badge on a preset card — src/db/schema/searches.ts states "there is no such thing as a built-in search", so the badge would be permanently dead code'
  - 'The assumptions trigger is rendered ONCE, inside the estimate panel, rather than also at form position 4: the panel is on screen at both breakpoints, and a second trigger is a second hook for one surface'
  - 'Two new query modules instead of editing 02-09''s presets.ts, because plans 02-12 and 02-13 were executing against that file in sibling worktrees'

patterns-established:
  - 'Preformat counts and money on the server, pass strings: formatUsd/formatLocal stay the only formatters, and no Intl call exists anywhere in src/components/preset-list/'
  - 'A geocoded address is rendered as the SERVICE returned it, never as typed — a bad ZIP is silently corrected upstream'
  - 'Every geocoder failure branch ends in a control that actually moves the ToggleGroup, not a sentence telling the user to'

requirements-completed: [SRCH-01, SRCH-02, SRCH-04]

# Metrics
duration: 60min
completed: 2026-09-22
---

# Phase 02 Plan 11: The Preset List and the Live Estimate Summary

**Two screens where the estimate is the product: a costed preset list, and an editor whose dollar figure recomputes 400 ms after the last change, dims to 60 % rather than blanking while it does, and cannot be repainted by a stale answer — with the guard proven by the repo's first component test, watched red. Executing it against a real database found two defects that `typecheck`, `lint`, `build` and 67 unit tests were all green against, either of which would have shipped a screen that 500s.**

## Performance

- **Duration:** ~60 min (first task commit 11:24:41 CDT, last 12:11:19 CDT, plus the verification, mutation and screenshot passes)
- **Tasks:** 3 of 3
- **Files:** 17 created, 2 modified
- **Commits:** 3 task commits + this metadata commit

## Task Commits

| Task | Name | Commit |
|---|---|---|
| 1 | The preset list, its empty state and its loading skeletons | `d7dd27d` |
| 2 | The preset editor — name, atomic clusters, all three geography modes | `fab9c56` |
| 3 | The live estimate — debounce, sequence guard, assumptions surface, first component test | `87023f3` |

`git diff --diff-filter=D --name-only ea296e1..HEAD` is **empty** — no file deleted anywhere in this plan. `STATE.md` and `ROADMAP.md` are untouched, per the parallel-execution contract.

## Accomplishments

- **SRCH-01 is reachable from a browser and proven end to end.** All three geographies — two cities, a county, and a 10-mile radius around a real McAllen street address geocoded live by the US Census — were created through the UI against a locally built server and appeared on `/presets`. Four new Playwright tests, all executed.
- **SRCH-04's estimate is live and never blanks.** Measured on the built app in both themes at both viewports: settled `aria-busy="false"`, recomputing `aria-busy="true"` with the wrapper at opacity `0.6125`, the previous dollar figure still in the document, a spinner beside it, and **zero skeleton elements in every state**.
- **Pitfall 5 is closed and the guard is proven, not asserted.** Deleting `if (mine !== seq.current) return;` reds exactly one named test with the stale `~$1.10` repainted over the fresh `~$2.90`, while the in-order control stays green.
- **D-04's multiplier is computed.** The chip renders `×14.9 vs RGV` from `texasMultiplier(ctx)` against the seeded cell lists (1,016 Texas cells against 68 RGV), not UI-SPEC's illustrative figure — which a grep in the acceptance criteria forbids appearing anywhere in `src/components/preset-editor/`.
- **🔴 Two latent defects were found that no gate in this phase could have caught, both in plan 02-09's never-executed SQL.** One returned a timestamp as a string and 500'd the list inside `Intl`; the other expanded a JS array into `($3, $4)::uuid[]` and made **every multi-cluster save fail**. Both are described under Deviations; their siblings in `duplicate-preset.ts` and `budget.ts` are logged in `deferred-items.md` for the plans that own them.

## Verification Results

Every gate run through the pinned store launcher in this worktree, on the final tree.

| Gate | Result |
|---|---|
| `typecheck` | ✅ exit 0 (`tsc --noEmit`) |
| `lint` | ✅ exit 0 (`eslint .`), no `react-hooks/*` violations |
| `test:unit` | ✅ exit 0 — **18 files, 71 passed (71)** (67 baseline + 4 new) |
| `build` | ✅ exit 0 — `/presets`, `/presets/new`, `/presets/[id]/edit` all present, `Proxy (Middleware)` intact |
| `test:e2e` (local smoke) | ✅ **13 passed, 2 skipped, 0 failed** |
| `test:db` | ⏭️ not run — this plan adds no migration and no schema change |

### `pnpm test:unit -t "stale estimate"` — by NAME

```
 ✓ |dom| tests/unit/stale-estimate.test.tsx > stale estimate > stale estimate: an out-of-order answer never repaints over a fresher one 148ms
 ✓ |dom| tests/unit/stale-estimate.test.tsx > stale estimate > stale estimate: the in-order control still paints the newer answer 45ms
 ✓ |dom| tests/unit/stale-estimate.test.tsx > stale estimate > stale estimate: the previous value stays visible while recomputing 33ms
 ✓ |dom| tests/unit/stale-estimate.test.tsx > stale estimate > stale estimate: no cluster selected renders the prompt, not a zero 11ms
 Test Files  1 passed | 17 skipped (18)
      Tests  4 passed | 67 skipped (71)
```

The names are read, not the exit code: a `-t` filter that matches nothing exits 0 green.

### The watched-red-first mutation — the sequence guard

`if (mine !== seq.current) return;` deleted from `use-live-estimate.ts`. Verbatim:

```
 FAIL  |dom| tests/unit/stale-estimate.test.tsx > stale estimate > stale estimate: an out-of-order answer never repaints over a fresher one
Error: expect(element).toHaveTextContent()

Expected element to have text content:
  ~$2.90
Received:
  ~$1.10
 ❯ tests/unit/stale-estimate.test.tsx:160:23

 Test Files  1 failed | 17 skipped (18)
      Tests  1 failed | 3 passed | 67 skipped (71)
```

**The discrimination is the point:** exactly one test reddened. `stale estimate: the in-order control still paints the newer answer` stayed **green** in the same run, which is what proves the guard drops a stale answer rather than ignoring every answer. The other two stayed green too.

⚠️ **The revert was by hand, not by `git checkout --`.** The file was still untracked when the mutation ran, so git had nothing to restore — the identical situation as 02-09's mutation 3. Verified instead by `grep -n "mine !== seq.current"` returning line 82 and by the full suite going back to 71/71. The plan's "`git diff --stat` empty" criterion cannot apply to an untracked file; the equivalent evidence is recorded here.

### e2e: which specs were EXECUTED, and which were only listed

🔴 **This is a local smoke against a locally built server.** `next build && next start -p 3111`, `E2E_BASE_URL=http://localhost:3111`, the local `siteless_test` database (`SUPABASE_DB_POOL_URL` resolves to `localhost:5432`; the production URL is a `# PROD` comment line in `.env.local`) and the Clerk **dev** instance (`pk_test_`). The authoritative run is plan 02-15's against the deployed URL.

**All 15 tests in the suite were EXECUTED** — none were merely listed. Final run:

```
  ✓   1 [setup] › auth.setup.ts:6:1 › authenticate (3.3s)
  ✓   2 [chromium] › budget-banner.spec.ts:45:1 › budget banner: absent under 80 percent (1.0s)
  -   3 [chromium] › budget-banner.spec.ts:53:1 › budget banner: renders on every route at 80 percent
  -   4 [chromium] › budget-banner.spec.ts:77:1 › budget banner: is not dismissible
  ✓   5 [chromium] › no-access.spec.ts:15:1 › no access: a signed-out visitor never reaches the org-scoped shell (568ms)
  ✓   6 [chromium] › no-access.spec.ts:21:1 › no access: /no-access renders the invite-only message (590ms)
  ✓   7 [chromium] › presets.spec.ts:68:1 › create preset: cities (3.1s)
  ✓   8 [chromium] › presets.spec.ts:82:1 › create preset: county (2.5s)
  ✓   9 [chromium] › presets.spec.ts:95:1 › create preset: radius (2.6s)
  ✓  10 [chromium] › presets.spec.ts:114:1 › preset editor: the Texas row carries a computed multiplier, not a literal (1.9s)
  ✓  11 [chromium] › signed-in.spec.ts:16:1 › signs in and is org-scoped (1.7s)
  ✓  12 [chromium] › theme-tokens.spec.ts:64:1 › theme tokens: the accent resolves in light (1.3s)
  ✓  13 [chromium] › theme-tokens.spec.ts:77:1 › theme tokens: the accent resolves in dark (1.3s)
  ✓  14 [chromium] › theme-tokens.spec.ts:90:1 › theme tokens: the page background matches the painted token (1.5s)
  ✓  15 [chromium] › touch-targets.spec.ts:56:1 › touch targets: every primary control clears 44px at 390x844 (1.3s)

  2 skipped
  13 passed (27.5s)
```

The two skips are **02-10's, unchanged** — they drive the meter through `/settings/budget`, which plan 02-13 builds, and they self-enable the moment `budget-cap-input` exists. This plan added no skip and unskipped nothing.

`create preset: radius` makes a **live call to the US Census Geocoder** (free, no key, no ledger row). It passed in 2.6 s against `1400 N 10th St, McAllen, TX 78501` — the same address `tests/unit/msw/fixtures/census-mcallen.json` was recorded from, so a future failure there is the federal service and not a bad input.

### Screenshots of the BUILT app, and the computed-style probes behind them

**16 screenshots — 4 screen-states × 2 viewports × 2 themes** — written to `test-results/02-11-shots/` (gitignored run evidence, destroyed with the worktree):

| State | Files |
|---|---|
| `/presets` populated | `list-populated-{phone-390x844,desk-1280x800}-{light,dark}.png` |
| Editor, estimate settled | `editor-settled-…` ×4 |
| Editor, estimate **recomputing** | `editor-recomputing-…` ×4 |
| Editor, County mode with the Texas row | `editor-county-…` ×4 |

Desk shots are **viewport-sized, not `fullPage`** — a `position: sticky` rail in a fullPage capture renders at its scrolled offset and misrepresents the layout it is evidence for.

A probe beats a claim, so the numbers are here rather than only the images. Every value measured on the built app with `getComputedStyle`, after asserting `innerHeight > 0`:

| Probe | phone light | phone dark | desk light | desk dark | UI-SPEC |
|---|---|---|---|---|---|
| Page background | `rgb(244,246,247)` | `rgb(14,20,22)` | same | same | `#F4F6F7` / `#0E1416` ✅ |
| Card background | `rgb(255,255,255)` | `rgb(22,30,33)` | same | same | `#FFFFFF` / `#161E21` ✅ |
| CTA fill | `rgb(15,118,110)` | `rgb(45,212,191)` | same | same | `#0F766E` / `#2DD4BF` ✅ |
| CTA hook rendered | `presets-create-cta-mobile` | same | `presets-create-cta` | same | one visible per breakpoint ✅ |
| CTA smallest side | **48 px** | 48 px | 32 px (desk) | 32 px | ≥44 px on phone ✅ |
| Estimate figure | 28 px, `tabular-nums`, accent | same | same | same | Display 28/600 accent ✅ |
| Region ARIA | `aria-live="polite"`, `aria-busy="false"` | same | same | same | ✅ |
| **Recomputing** | `aria-busy="true"`, opacity **0.6125**, figure still present, **1 spinner**, **0 skeletons** | same | same | same | Rule 11 ✅ |
| Texas chip | `×14.9 vs RGV` on `rgb(254,240,199)` / `rgb(181,71,8)` | on `rgb(59,39,8)` / `rgb(253,176,34)` | same | same | warning surface ✅ |

🔴 **Three of those numbers were wrong on the first read, and none of them was a bug.** The opacity read back as `1`, the phone CTA measured `0×0`, and the ToggleGroup screenshot showed *Cities* highlighted while the County panel was open. All three were **probe lies**: a style read immediately after a class change returns the in-flight transition value, and the CTA measured was the `display:none` breakpoint twin. Polling each property until it settled, and selecting the *visible* element rather than the first, produced the table above — and a `data-state` probe independently confirmed the ToggleGroup semantics were correct the whole time (`county: state=on, aria-pressed=true`). This is 02-10's deviation 4 recurring three times in one plan.

### The estimate figures the editor actually rendered

For a reader comparing against `tests/unit/estimate.test.ts`. Two clusters (`home_services` + `food_hospitality`) × two cities (Alamo, Brownsville) = **4 cells**:

```
~$0.00
~36 requests · ~1,457 businesses
0.0% of this month's remaining $50.00
Range $0.00–$0.00 · 12–36 requests
```

`4 cells × 1 page × 3.0 fan-out = 12` requests low, `4 × 3 × 3.0 = 36` high — `Math.ceil`, matching `estimate.ts` exactly. **`$0.00` is correct, not broken:** 36 requests sit entirely inside the month's first 1,000 free Text Search Enterprise requests, which is the whole point of 02-07's free-allowance work and exactly what Executor Rule 16 predicts. The Texas multiplier renders `×14.9`, matching 02-RESEARCH's measured ≈15× and **not** UI-SPEC's illustrative copy.

One figure moved mid-session: `remaining $50.00` read `$44.43` in one capture. A **sibling worktree moved the meter**, which is the shared-database behaviour the wave was warned about, observed live.

### The plan's acceptance greps

| Check | Result |
|---|---|
| `page.tsx` contains `Search presets` / `data-testid="presets-create-cta"` | 1 / 1 |
| `presets-empty.tsx` contains `No search presets yet` / `presets-empty-cta` | 1 / 1 |
| `preset-card.tsx` contains `tabular-nums` / `Never run` / `formatLocal` | 3 / 2 / 3 |
| `Intl.*Format` in `src/components/preset-list/` | **0 files** |
| Hand-rolled `bg-card` / `rounded-*` / `border border-` on a raw `<div>` in either directory or the pages | **nothing** |
| `variant="default"` — `page.tsx` / `create-preset-cta.tsx` / `preset-card.tsx` / `presets-empty.tsx` | 0 / 1 / 0 / 1 (mutually exclusive screens — see Decisions) |
| `form action` in `src/components/preset-editor/` or `src/app/(app)/presets/` | **0 files** |
| `preset-form.tsx` contains `useTransition` / `onSubmit` | 3 / 3 |
| `geography-picker.tsx` contains `Texas (254 counties)` + the three mode hooks + `preset-editor-texas-multiplier` | 1 / 1,1,1 / 1 |
| `x38` / `×38` / `"38"` anywhere in `src/components/preset-editor/` | **nothing** |
| `radius-geocoder.tsx` contains `matchedAddress` / `Finding…` / `Switch to county` / both geocode constants | 2 / 2 / 1 / 2, 3 |
| `preset-form.tsx` contains `aria-invalid` / `aria-describedby` / `circle-alert` / `Close without saving` | 2 / 2 / 4 / 1 |
| Generic labels (`Cancel` / `"Save"` / `"Submit"` / `"OK"`) in `src/components/preset-editor/` | **0 files** |
| `use-live-estimate.ts` contains `seq` / `useRef` / `useTransition` / `400` | 4 / 3 / 3 / 3 |
| `estimate-panel.tsx` contains `aria-busy` / `aria-live="polite"` / `tabular-nums` / `preset-editor-estimate-dollars` / `opacity-60` | 2 / 1 / 5 / 1 / 1 |
| `grep -c "Skeleton" estimate-panel.tsx` | **0** |
| `assumptions-surface.tsx` imports `@/lib/estimate/assumptions`; literal `3.0` or `25` | 1 ; **0** |
| `presets.spec.ts` contains the three mode hooks + `preset-editor-estimate`; literal copy sentences | 1,2,1 + 2 ; **none** |
| Tailwind v4 bare-dash arbitrary values (`[--x]`) in any new file | **nothing** |

## Files Created/Modified

| File | What it does |
|---|---|
| `src/app/(app)/presets/page.tsx` *(replaces 02-10's placeholder)* | Title, count line, 2-column card grid on desk, stacked cards plus a thumb-zone CTA on phone; the data region suspends behind three card skeletons |
| `src/components/preset-list/preset-card.tsx` | UI-SPEC's five-line card anatomy; the whole card is the link to `/presets/[id]`, plus the exported `PresetCardSkeleton` |
| `src/components/preset-list/presets-empty.tsx` | The shadcn `Empty` with the three imported copy constants |
| `src/components/preset-list/create-preset-cta.tsx` | The one filled accent action, defined once, rendered in the desk header and the phone bar with distinct hooks |
| `src/server/queries/preset-cards.ts` | Clusters, geography, version, last run and saved estimate in ONE `withOrg` statement, plus the current-period run count |
| `src/app/(app)/presets/new/page.tsx` | Thin server component: reads the reference rows and meter once, passes props |
| `src/app/(app)/presets/[id]/edit/page.tsx` | The same, plus `getPreset` and the `loadedVersion` that makes the unique constraint optimistic concurrency |
| `src/server/queries/preset-editor.ts` | `EditorReference` — clusters, the 17 cities, the 4 RGV counties, the pinned Texas row, preformatted outlet labels, the computed multiplier, the four radii |
| `src/components/preset-editor/preset-form.tsx` | State, the three inline validations, the `onSubmit` + `useTransition` save path, the conflict and failure branches, the two-column / sticky-bar layout |
| `src/components/preset-editor/cluster-picker.tsx` | Four atomic clusters, 44px rows, outlet counts |
| `src/components/preset-editor/geography-picker.tsx` | The mode ToggleGroup, the city `Command` search with removable pills, the counties and D-04's Texas row |
| `src/components/preset-editor/radius-geocoder.tsx` | Address input, busy "Finding…", the service's `matchedAddress`, both failure branches with real escape controls, the radius `Select` |
| `src/components/preset-editor/use-live-estimate.ts` | The debounce and the monotonic sequence guard |
| `src/components/preset-editor/estimate-panel.tsx` | The five-line focal point that dims rather than blanks |
| `src/components/preset-editor/assumptions-surface.tsx` | Drawer on phone, Popover on desk; every value read, none restated |
| `tests/unit/stale-estimate.test.tsx` | The repo's first component test — four named cases |
| `tests/e2e/presets.spec.ts` | Four Playwright tests, testids only |
| `src/server/actions/save-preset-version.ts` *(modified)* | The `sql.join` array fix — see deviation 2 |
| `.planning/…/deferred-items.md` | Three out-of-scope discoveries logged for their owning plans |

## Decisions Made

1. **The headline is the HIGH end of the range.** `queueRun` reserves `costMicroUsdHi`, so that is the figure the meter will actually be asked for; leading with the low end would quote a number smaller than the one the cap is tested against. Both ends are on the range line directly beneath.
2. **A snapshot is saved only when the estimate is settled.** `busy` means the figure on screen belongs to an earlier selection. No snapshot is a fine outcome; a wrong one is a price nobody was quoted.
3. **Saving returns to `/presets`, not to `/presets/[id]`.** The detail route is plan 02-12's; this plan links to it from every card and does not assume it exists. A `sonner` toast carries `Version {n} saved`.
4. **No `Built-in` badge on a preset card.** `src/db/schema/searches.ts` says in its own header: "there is no such thing as a built-in search" — `org_id` is `NOT NULL` on that table. UI-SPEC's card mock shows the badge, but rendering a branch that can never be true is dead code, and the `Built-in` badge does ship where it is real: on the pinned Texas row in the county picker.
5. **The assumptions trigger renders once, inside the estimate panel.** UI-SPEC lists it both as form item 4 and as the estimate block's fifth line. The panel is on screen at both breakpoints (desk rail, phone sticky bar), so one trigger reaches every user — and a second one would be a second hook for one surface, which is exactly 02-10's deviation 3.
6. **Two new query modules rather than an edit to `src/server/queries/presets.ts`.** Plans 02-12 and 02-13 were executing against that file in sibling worktrees; a new file cannot conflict with them.
7. **Motion is CSS, not the `motion` package.** UI-SPEC's estimate animation is 150 ms opacity plus a 2 px translate with `prefers-reduced-motion` going to zero duration and dropping the transform. `transition-[opacity,transform] duration-150 motion-reduce:duration-0 motion-reduce:transform-none` is that, exactly, with no client dependency — and the NUMBER still renders under reduced motion because only the transition is disabled, never the content (the recorded 956 Woodworks defect).
8. **The Texas row is an ordinary county selection of all 254 ids**, and "Texas is selected" is *derived* from that list rather than held as a separate flag. A flag and a list are two sources of truth for one selection, and D-04 is explicit that nothing is special-cased.
9. **`Search the 17 RGV cities` and `Texas (254 counties)` are computed from the rows that were read.** Both render the numbers UI-SPEC fixes today; if the seed ever ships 16 cities or 253 counties the screen says so instead of lying.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] A `Date` bound through `tx.execute` throws, and a timestamp read back through it is a STRING — the preset list 500'd twice for two different reasons in the same query**

- **Found during:** Task 3, by loading `/presets` against the real database for the first time. Not by reading anything.
- **Issue, part one:** `periodWindow()` returns `Date` objects, and binding one into a drizzle `sql` template fails at query time: `TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`, wrapped in drizzle's `Failed query:`. drizzle's postgres-js driver sends `tx.execute` parameters through postgres.js's `unsafe` path, which does not type-infer a `Date`.
- **Issue, part two:** after that was fixed the page 500'd again with `RangeError: Invalid time value` inside `Intl.DateTimeFormat`. A diagnostic print showed `max(coalesce(started_at, created_at))` arriving as `'2026-09-22 10:21:31.273904-05'` with `Object.prototype.toString` reporting `[object String]` — while `count(*)::int` in the **same row** arrived as a real number. The field was declared `Date | null`, which type-checks, lints, builds and unit-tests perfectly green.
- **Fix:** bind `from.toISOString()` / `to.toISOString()` with an explicit `::timestamptz` cast, and parse the returned value through a new `instantOf()` that accepts a `Date`, parses a string, and returns `null` for anything unparseable. 🔴 The string is parsed **as-is, with its space** — "helpfully" ISO-ifying `'… 10:21:31.273904-05'` to `'…T10:21:31.273904-05'` produces an **Invalid Date**, because the offset has no minutes and that takes the strict ISO path. Both forms were tested before choosing.
- **Files modified:** `src/server/queries/preset-cards.ts`
- **Verification:** `/presets` renders 9 cards with `Never run` and `Est. ~$0.00`; the full e2e suite green.
- **Committed in:** `87023f3`

**2. [Rule 3 — Blocking] `savePresetVersion` expanded a JS array into `($3, $4)::uuid[]`, so EVERY multi-cluster save failed**

- **Found during:** Task 3. The editor was complete and correct, and every save returned `unexpected` with UI-SPEC's "something broke on our side" — a typed refusal, so nothing was logged anywhere. Instrumenting the action's catch produced the statement verbatim:

```
insert into search_versions (…)
values (app.current_org_id(), $1, $2,
        ($3, $4)::uuid[], $5, $6::jsonb, $7::jsonb, $8)
```

- **Issue:** `${resolved.clusterIds}::uuid[]` — interpolating a **JS array** into a drizzle `sql` template expands it into a parenthesised list. `($3, $4)` is a ROW expression, and a row cannot be cast to `uuid[]`. This is 02-09's file and 02-09's SUMMARY says plainly that no statement in that plan was ever executed; `tsc`, eslint, `next build` and 67 unit tests are all green against it. **SRCH-01 was unreachable** — no preset could be saved at all with more than one cluster, and a single-cluster one would have been casting from a one-column row.
- **Fix:** `sql.join(ids.map((id) => sql\`${id}\`), sql\`, \`)` inside `array[…]::uuid[]`, which emits one placeholder per id so every value stays a bound parameter. Reasoned at the point of definition, including the broken form, so nobody "simplifies" it back.
- **Files modified:** `src/server/actions/save-preset-version.ts` — **outside this plan's `files_modified`**, and taken under Rule 3 because it blocked the plan's entire objective. No sibling in this wave owns that file (02-12 owns the detail page, 02-13 owns spend and budget settings).
- **Verification:** all four `presets.spec.ts` tests pass; nine presets saved through the UI across three runs; the temporary `console.error` was removed and `git diff` on the file confirmed clean before the fix was written.
- **Committed in:** `87023f3`

**3. [Rule 2 — Missing critical] The preset card needed three fields no 02-09 query returns**

- **Found during:** Task 1
- **Issue:** `listPresets` returns id, name, status, current version number, version count and `updated_at`. UI-SPEC's card needs the CLUSTER NAMES, the GEOGRAPHY and the LAST RUN. `getPreset` carries the first two but not the third, is one round trip **per preset**, and opens its own `withOrg` — and `src/db/client.ts` pools with `max: 1`, so a `Promise.all` over it waits on a connection an outer transaction holds (02-09's deviation 7).
- **Fix:** `src/server/queries/preset-cards.ts`, one statement with a lateral join over `runs → search_versions`, returning everything the card and the count line need. A new module rather than an edit to `presets.ts`, because two sibling worktrees were executing against that file.
- **Files modified:** `src/server/queries/preset-cards.ts` (new)
- **Committed in:** `d7dd27d`

**4. [Rule 2 — Missing critical] The editor could not import anything it needed**

- **Found during:** Task 2
- **Issue:** `RADIUS_MILE_OPTIONS` and `presetSpecSchema` live in `src/server/queries/presets.ts`, which carries `import 'server-only'`; `texasMultiplier` pulls the committed seed JSON into whatever bundle imports it. A `"use client"` editor importing any of them either fails the build or ships megabytes of seed data to a phone.
- **Fix:** `src/server/queries/preset-editor.ts` reads all of it on the server in one transaction and hands it down as props — including the four radii, so the `Select` still cannot invent a fifth, and the **computed** multiplier. The context handed to `texasMultiplier` is the **real** meter row, not a zeroed placeholder: the multiplier is arithmetically independent of the budget, but a fabricated context on the one screen whose job is being believable about money is not a trade worth making.
- **Files modified:** `src/server/queries/preset-editor.ts` (new)
- **Committed in:** `fab9c56`

**5. [Rule 1 — Bug] The desk action row rendered inside a floating hairline panel**

- **Found during:** Task 3, in the first round of built-app screenshots — not by reading the code.
- **Issue:** the actions sit in a `Card` because on a phone they genuinely are the thumb-zone surface. On desk the Card's own `bg-card` **and** its `ring-1` both survived, so "Create preset / Close without saving" sat in a white bordered box for no reason.
- **Fix:** `sm:bg-transparent sm:ring-0`. The second cause was found by a computed-style probe, not by looking: `backgroundColor` was already `rgba(0,0,0,0)` after the first fix and the visible box was the ring.
- **Verification:** re-screenshotted in both themes; the desk action row is now two buttons on the page background.
- **Committed in:** `87023f3`

**6. [Rule 1 — Bug] Testing Library's cleanup is not automatic in this repo, and the second test in a file failed as though a testid were duplicated**

- **Found during:** Task 3
- **Issue:** RTL registers its own `afterEach(cleanup)` only when vitest runs with `globals: true`, and `vitest.config.ts` deliberately does not. Every render accumulated in one document, and the second test failed with `Found multiple elements by: [data-testid="preset-editor-estimate-dollars"]` — which looks exactly like a duplicated-hook defect and is a harness bug. `tests/unit/jsdom-lane.test.tsx` has a single test and never hit it.
- **Fix:** an explicit `afterEach(cleanup)` with the reason recorded above it, since this is the first multi-test `.test.tsx` in the repo and every future one will need it.
- **Committed in:** `87023f3`

### Deviations of task boundary (no scope change)

**7. Four files were added beyond the plan's `files_modified`:** `src/server/queries/preset-cards.ts` and `preset-editor.ts` (deviations 3 and 4), `src/components/preset-list/create-preset-cta.tsx` (the single definition of the one accent CTA, rendered in two breakpoint slots — Rule 10 with 02-10's deviation-3 discipline), and `.planning/…/deferred-items.md`. One file outside the plan was modified: `src/server/actions/save-preset-version.ts` (deviation 2). All are in the frontmatter above.

**8. Task 3 edited `preset-form.tsx`, which is Task 2's file.** The estimate panel has to be mounted somewhere. Task 2's commit is a complete, building, passing form without the estimate region; Task 3 wires the hook, the panel and the two-column layout. Both tasks' acceptance criteria hold on the final tree.

**9. Screenshots were captured once, at the end, rather than per task.** Tasks 1 and 3 each require built-app screenshots; capturing them per task would have meant three build-and-serve cycles against a database two siblings are sharing. Every state both tasks ask for is in the inventory above.

**10. List-row testids carry a shared hook plus a data attribute** — `preset-editor-city-option` + `data-city-id`, `preset-editor-county-option` + `data-county-fips` — instead of the plan's `preset-editor-city-{id}`. The seed mints fresh uuids on every database, so a uuid-bearing testid cannot be written down in a spec. The FIPS code and the positional index are stable everywhere.

---

**Total deviations:** 6 auto-fixed (3 bugs, 2 missing-critical, 1 blocking) + 4 recorded without scope change.
**Impact:** every auto-fix was required for correctness. 🔴 **Deviations 1 and 2 are the ones that matter:** both are defects in code that *shipped green* through 02-09 and would have shipped green again, because no gate in this repo executes that SQL. They were found by loading one page and pressing one button.

## Issues Encountered

- **The shared `siteless_test` database moved under this plan, twice, visibly.** A preset named `Hidalgo — home services` with two runs was present in an early read and gone by the final one; the estimate's "remaining" figure read `$50.00` in one capture and `$44.43` in another. Neither is a defect here — it is the sibling-worktree behaviour the wave was warned about, and it is the reason `presets.spec.ts` asserts no list counts and no empty state.
- **`next start` caches the build at boot.** Every fix needed a rebuild *and* a restart; a stale server serves the previous bundle and makes a fix look like it had no effect. Only the PID listening on port 3111 — started by me — was ever killed, and port 3111 is free at return.
- **One `pnpm build` exited `-1` during "Collecting page data" and succeeded unchanged on the immediate retry.** Treated as contention from the parallel wave, not as a defect; every subsequent build in this plan exited 0.
- **`pnpm verify` is not runnable on this machine** — it shells out to the wrong global `pnpm`. Each part was run individually through the store launcher.

## Known Stubs

**None in this plan's own output.** Every value on both screens comes from a real query or a real server action: the cards read `searches`/`search_versions`/`runs`, the pickers read the seeded reference rows, the estimate calls the action, and the geocoder calls the live Census service.

Two honest absences, neither a stub:

| Thing | Why |
|---|---|
| Every card reads `Never run` | Because there are no `runs` rows. The join is live; Phase 4 fills it. |
| Every estimate reads `$0.00` | Because 36 requests fall inside the month's 1,000 free Text Search Enterprise requests. Executor Rule 16 predicts exactly this. |

⚠️ **One acceptance criterion was NOT met: the preset list's EMPTY state was never screenshotted on the built app.** The shared database has presets belonging to sibling plans and to this plan's own e2e runs, and Phase 2 ships no delete or archive path by design, so there is no way to reach an empty list without mutating rows this plan does not own. What *is* verified: the three copy constants are imported rather than retyped, the branch and its `presets-empty-cta` hook exist, and the e2e `.or()` locator resolved to `presets-create-cta` every time — which records that the empty branch was not exercised rather than hiding it. **The empty state's first visual verification is owed to plan 02-14 or to any run against a fresh database.**

## Threat Flags

No new network endpoint, no new schema, no new credential. The one new outbound call is 02-07's Census client, reached through 02-09's existing action.

| Threat ID | Disposition | Delivered by |
|---|---|---|
| T-2-01 | mitigate | All three routes sit under `(app)`, whose layout calls `requireOrg()` as its first statement; the pages take `orgClaims()` only to scope their own query. Every action they call re-checks independently, so a directly POSTed action is still refused. Proved live: `no access: a signed-out visitor never reaches the org-scoped shell` passes on the built app. |
| T-2-13 | mitigate | The address leaves `radius-geocoder.tsx` only as the argument to an authenticated server action, which zod-bounds it before `census.ts` bounds it again against a hard-coded host. The component renders the SERVICE's `matchedAddress`, never echoing the raw input into a link or a header — visible in the screenshots, where a card reads `1400 N 10TH ST, MCALLEN, TX, 78501` in the service's own casing rather than the mixed case that was typed. |
| T-2-14 | mitigate | 400 ms debounce, one logical in-flight request per editor via the monotonic sequence guard, and the action authenticates first and makes no paid call — the blast radius is CPU, not dollars. `clusterKeys` is capped at 4 and `cityIds` at 300 by `presetSpecSchema` on the server. |
| Pitfall 5 | mitigate | The monotonic `seq` guard, proven by a named component test watched red with the guard deleted and with its in-order control staying green in the same run. |
| Recorded BIS defect | mitigate | No `<form action>` anywhere in the editor — `grep` returns 0 files across `src/components/preset-editor/` and `src/app/(app)/presets/`. `onSubmit` + `useTransition`, so a failed save cannot reset the form out from under a Radix `Select`. |

## User Setup Required

None. No new environment variable, no credential, no external service. Nothing on either screen reads a Google credential (UI-SPEC Executor Rule 14).

## Next Phase Readiness

**Ready for 02-12, 02-13, 02-14 and 02-15.** Things a downstream plan must know, in order of consequence:

1. 🔴 **Read `deferred-items.md` before writing SQL.** Two defects of the same family are still live in files this plan does not own: `budget.ts`'s `readSpendByRun` binds a JS `Date` (02-13 will 500 on `/spend` → By run), and `duplicate-preset.ts` binds a uuid array (02-12's Duplicate dialog — *verify first*, its array is read back from Postgres and may arrive as a literal string and work by accident).
2. 🔴 **A value out of `tx.execute` is not the type its `rowsOf<T>()` annotation claims.** A `timestamptz` arrives as a **string** while `count(*)::int` arrives as a number, in the same row. Anything that renders a timestamp from a raw query must parse it, and must parse the Postgres form **with its space** — ISO-ifying it yields an Invalid Date.
3. 🔴 **Nine `e2e-*` presets are in the shared `siteless_test` database** and cannot be removed through the product. Do not assert a preset count or an empty list against it.
4. ⚠️ **Poll any computed-style or bounding-box read on a transitioning property.** Three separate probes in this plan reported a false value on a single read: opacity mid-transition, a `display:none` breakpoint twin measured as 0×0, and a ToggleGroup crossfade that made the wrong item look selected.
5. ⚠️ **A multi-test `.test.tsx` needs an explicit `afterEach(cleanup)`** — RTL does not self-register it without `globals: true`.
6. ⚠️ **`/presets/[id]` is linked from every card and does not exist yet.** Plan 02-12 owns it; `preset-card.tsx` also exposes `data-preset-name` for attribute-based spec matching.
7. ⚠️ **The empty-state screenshot is owed** (see Known Stubs).

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All 17 files under `key-files.created` exist on disk (`[ -f ]` each), plus the 2 modified files.
- All three task commits resolve in `git log ea296e1..HEAD`: `d7dd27d`, `fab9c56`, `87023f3`.
- `git diff --diff-filter=D --name-only ea296e1..HEAD` is **empty** — no file deleted anywhere in this plan.
- `git diff --name-only ea296e1..HEAD` lists 19 files and **neither `STATE.md` nor `ROADMAP.md`** — the orchestrator owns those.
- `git status --short` clean; `.env.local` covered by `.gitignore` (`.env.*`) and never staged; `test-results/` is gitignored and carries all run evidence.
- No stray process: port 3111 has no listener, and only the PID I started was ever killed.
- Every temporary diagnostic was removed and verified gone: `git diff` on `save-preset-version.ts` was empty after reverting the `console.error`, and `grep -c "SAVE_DIAG\|CARD_DIAG" src/` returns 0.
- Re-ran every plan-level `<verification>` item on the final tree: typecheck 0, lint 0, `test:unit` 71/71, build 0 with all three routes and `Proxy (Middleware)` intact, e2e 13 passed / 2 skipped / 0 failed, and every acceptance grep tabulated above.
