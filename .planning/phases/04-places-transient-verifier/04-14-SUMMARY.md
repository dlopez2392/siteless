---
phase: 04-places-transient-verifier
plan: 14
subsystem: ui
tags: [run-chrome, live-refresh, spend, nav, accessibility, fake-timers]
requires:
  - phase: 04-07
    provides: STOPPED_REASON, RUN_KIND_LABEL, StoppedReason/RunKind, RUN_REPORT_* and RUN_ANNOUNCE_* copy
  - phase: 04-09
    provides: runs.kind and runs.stopped_reason columns
provides:
  - RunStatusBadge (one shared run status badge, FLAG_BADGE_SIZING, data-status)
  - RunAutoRefresh (router.refresh() live-refresh island, D-17 / Rule 36)
  - /spend By-run stopped-reason sentences, kind label, spend-run-link-{runId}
  - NavItem.alsoActiveUnder + isNavActive(pathname, base, also?) — Presets lit on /runs
affects: [04-23, 04-27, 04-28]
tech-stack:
  added: []
  patterns:
    - "Live island reads the router through a ref so callback identity never re-arms a timer"
    - "Render-time 'adjust state on prop change' for transition-only live-region announcements"
    - "Two labels in one grid cell (idle/busy, one invisible) keep a button's width constant"
key-files:
  created:
    - src/components/runs/run-status-badge.tsx
    - src/components/runs/run-auto-refresh.tsx
    - tests/unit/run-chrome.test.tsx
    - tests/unit/run-auto-refresh.test.tsx
  modified:
    - src/components/spend/by-run.tsx
    - src/server/queries/budget.ts
    - src/components/app-shell/app-sidebar.tsx
    - src/components/app-shell/mobile-tab-bar.tsx
    - src/components/app-shell/more-sheet.tsx
key-decisions:
  - "RunAutoRefresh takes two extra REQUIRED props, costMicroUsd and stoppedReason, because the terminal announcements (RUN_ANNOUNCE_COMPLETE(cost), RUN_ANNOUNCE_STOPPED(reason)) cannot be spoken honestly without them"
  - "RunAutoRefresh renders its live region in EVERY status and hides only its own live line and button when terminal — the report must keep it mounted after the run ends or the terminal announcement unmounts with it"
  - "The refresh watchdog is armed by the FIRST unanswered refresh and not re-armed per tick (a per-tick watchdog at a 5 s cadence never fires)"
  - "/spend stopped reasons stay partial-only (unchanged gating); an unknown key renders nothing"
patterns-established:
  - "Run chrome lives in src/components/runs/ with no client directive except the one island"
requirements-completed: [PLACE-03]
duration: ~30min
completed: 2026-09-23
---

# Phase 4 Plan 14: Shared run chrome Summary

**One `RunStatusBadge` at flag-badge size, a `RunAutoRefresh` island with seven fake-timer proofs (5 s setTimeout chain, hidden pause, 10 s watchdog, transition-only live region), the `/spend` stopped-reason leak closed through `STOPPED_REASON` with `/runs/{id}` links, and Presets lit on `/runs`.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-09-23
- **Tasks:** 2 of 2
- **Files:** 4 created, 5 modified

## Accomplishments

- `RunStatusBadge` lifted from `by-run.tsx` into `src/components/runs/run-status-badge.tsx` (server-safe). It uses `FLAG_BADGE_SIZING` instead of `text-xs`, and carries `data-testid` (default `run-status-badge`) and `data-status`. `running` shows a 16px `Spinner` with `motion-reduce:animate-none` and `aria-hidden`.
- `/spend` By-run (Rule 35 / T-4-05):
  - `stoppedReasonOf` maps the key through `STOPPED_REASON`, and an unknown key renders nothing.
  - The kind renders as `RUN_KIND_LABEL` (muted, with `data-kind`).
  - Each run links to `/runs/{runId}` through `spend-run-link-{runId}`: the name cell on desk, the whole card on phone, exactly one element per layout.
- `readSpendByRun` now selects `r.kind`. `RunSpend` gains `kind: RunKind`, and `stoppedReason` is typed `StoppedReason | null`. The SQL shape was checked read-only against the local test DB.
- `NavItem.alsoActiveUnder` added. `isNavActive(pathname, base, also = [])` applies the same `=== || startsWith(x + '/')` rule to every prefix. Presets sets `['/runs']`, and all five call sites pass `item.alsoActiveUnder` (sidebar ×2, tab bar ×2, More sheet).
- `RunAutoRefresh` (`'use client'`):
  - One `setTimeout` chain (never `setInterval`) runs only while `queued` or `running` and the page is visible.
  - It clears on a terminal status, on hidden and on unmount, and refreshes immediately on `visibilitychange` → visible.
  - "Refresh now" resets the cadence and shows a same-width Spinner + "Refreshing…".
  - A 10 s watchdog swaps in `RUN_REPORT_REFRESH_FAILED`, and a new `renderedAtMs` clears it.
  - The polite `run-live-status` region announces status transitions and the first truncation only.
  - The time is shown through `formatLocal` with `timeStyle: 'medium'`.

## Exported signatures (for 04-23, 04-27, 04-28)

```ts
// src/components/runs/run-status-badge.tsx  (server-safe, no directive)
export function RunStatusBadge(props: { status: string; testId?: string /* default 'run-status-badge' */; className?: string }): JSX.Element
// renders <Badge data-testid={testId} data-status={status}> with FLAG_BADGE_SIZING

// src/components/runs/run-auto-refresh.tsx  ('use client')
export const REFRESH_MS = 5000;
export const REFRESH_TIMEOUT_MS = 10_000;
export function RunAutoRefresh(props: {
  status: string;               // runs.status
  renderedAtMs: number;         // Date.now() on the server at render
  truncatedCount: number;       // tiles still truncated
  costMicroUsd: bigint | number; // for "Run complete — $x"
  stoppedReason: string | null;  // machine key, for "Run stopped early — …"
}): JSX.Element
// testids: run-updated-at (data-state live|failed), run-refresh-now (data-state idle|refreshing, aria-busy),
//          run-refresh-now-idle / run-refresh-now-busy (label spans), run-live-status (always rendered)

// src/components/app-shell/app-sidebar.tsx
export type NavItem = { …; alsoActiveUnder?: readonly string[] };
export function isNavActive(pathname: string, base: string, also?: readonly string[]): boolean

// src/server/queries/budget.ts
export type RunSpend = { …; kind: RunKind; stoppedReason: StoppedReason | null };
```

## Task Commits

1. **Task 1: extract RunStatusBadge, fix the /spend leak, link runs, light Presets:** `987910a` (feat)
2. **Task 2: RunAutoRefresh:**
   - `403ec3b` (test, RED)
   - `f35eb63` (feat, GREEN)
   - `8829a55` (fix, found by mutation: see Deviations)
   - `61ffb9f` (refactor)
   - `9b3c756` (docs, comment wording kept the `text-xs` grep clean)

## Verification

- **`npx tsc --noEmit`:** exit 0.
- **`npx eslint src tests scripts`:** clean.
- **Prettier `--check --end-of-line auto`:** clean on every touched file.
- **Unit lane `npx vitest run tests/unit`:** **65 files / 486 tests passed.**
- **`tests/unit/run-chrome.test.tsx`:** 4 tests, all passing, checked by name:
  - `the run status badge is one component sized as a flag badge`
  - `the spend view renders stopped reasons as sentences`
  - `the spend view links each run to its report`
  - `the run report lights Presets`
- **`tests/unit/run-auto-refresh.test.tsx`:** all 7 tests passing, checked by name:
  - `polls every 5 seconds while running`
  - `stops on a terminal status`
  - `pauses while hidden and refreshes on return`
  - `clears its timer on unmount`
  - `a refresh that does not land within 10 seconds shows the refresh-failed line`
  - `refresh now refreshes immediately and resets the cadence`
  - `the live region announces only transitions`
- **Acceptance greps:**
  - `function RunStatusBadge` in by-run.tsx: none.
  - `text-xs` or `gap-3` in `src/components/runs/` or by-run.tsx: none.
  - `alsoActiveUnder: ['/runs']`: matches.
  - `setInterval`: none.
  - `visibilitychange`: matches.
- **Zone pin:** the auto-refresh test runs in UTC and asserts the literal `2:14:05 PM` for 19:14:05Z, so it only passes if `formatLocal` really pins the Chicago zone.

### Mutations

Each mutation was applied on its own, checked red on the named test, reverted with `git checkout -- <file>`, and the tree was confirmed clean afterwards.

| # | Mutation | Red test |
|---|----------|----------|
| M1 | `stoppedReasonOf` returns the raw key | the spend view renders stopped reasons as sentences |
| M2 | unknown key falls back to itself (`?? run.stoppedReason`) | the spend view renders stopped reasons as sentences (`some_new_key` leaked) |
| M3 | badge back to `'text-xs font-semibold'` | the run status badge is one component… (plus the sentences test, which also checks the badges) |
| M4 | spinner loses `motion-reduce:animate-none` | the run status badge is one component… |
| M5 | `isNavActive` ignores `also` | the run report lights Presets |
| M6 | desk link loses its `spend-run-link-*` testid | the spend view links each run to its report |
| N1 | cadence ignores `visible` | pauses while hidden and refreshes on return |
| N2 | cadence ignores terminal status | stops on a terminal status |
| N3 | cadence timer never cleared | 5 tests incl. clears its timer on unmount |
| N4 | watchdog re-armed per tick | a refresh that does not land within 10 seconds… |
| N5 | "Refresh now" bypasses the cadence reset | refresh now refreshes immediately and resets the cadence (**survived first; see Deviation 1**) |
| N6 | every landed render announced | the live region announces only transitions |
| N7 | truncation announced on every count change | the live region announces only transitions |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The cadence re-armed on every re-render (found by mutation N5)**
- **Found during:** Task 2 mutation pass.
- **Issue:** `refreshNow` depended on the `useRouter()` object, and the cadence effect depended on `refreshNow`. When the router's identity changed, *any* re-render re-armed the 5 s timer: a watchdog firing, a click, a prop change.
- **How it hid:** the test's `next/navigation` mock returns a fresh router on every render. The click's own re-render reset the timer, so "Refresh now bypasses the cadence reset" survived a green suite.
- **Fix:** the island reads the router through a ref, so `refreshNow` has `[]` deps. The test deliberately keeps the per-render mock, which is harsher than Next, and a comment explains why. N5 is now red on the right test.
- **Files:** `src/components/runs/run-auto-refresh.tsx`, `tests/unit/run-auto-refresh.test.tsx`
- **Commit:** `8829a55`

**2. [Rule 2 - Missing critical functionality] `RunAutoRefresh` needs `costMicroUsd` and `stoppedReason`**
- **Issue:** the plan's prop list `{ status, renderedAtMs, truncatedCount }` cannot produce the terminal announcements the spec requires. `RUN_ANNOUNCE_COMPLETE` needs the cost and `RUN_ANNOUNCE_STOPPED` needs the reason.
- **Fix:** added both props as **required**. Making them optional would have meant either announcing a false "$0.00" or inventing new copy. A partial run whose key has no sentence announces nothing rather than the raw key.
- **Impact:** 04-23's plan text lists three props. `tsc` will point its executor at the two extra props, and the report already has the cost and the reason in hand.

**3. [Rule 2] Status-badge and link details not spelled out in the plan**
- `RunStatusBadge` gained optional `testId` and `className` props.
- The badge's spinner is `aria-hidden`, because the primitive's `role="status"` would otherwise add a second, contentless live region.
- The phone card's link WRAPS the `Item` instead of using `Item asChild`. Radix Slot merges props with the child's winning, so the link's `data-testid` would silently replace `spend-run-card`.

**4. [Scope] Unrelated prettier changes reverted**
- Prettier re-wrapped two unrelated function signatures in `budget.ts`. Both were reverted to keep the diff minimal, since parallel plans edit that file.

## TDD Gate Compliance

- **Task 2:** followed RED → GREEN → REFACTOR: `403ec3b` test, then `f35eb63` feat, then `61ffb9f` refactor. The RED run failed because the module did not exist yet.
- **Task 1:** the tests were written right after the implementation, so there is no separate RED commit. To make up for that, all six Task 1 behaviours were mutation-checked (M1–M6 above). Each went red on its named test and was reverted.

## Handoffs / Merge notes

- **04-23 (run report):**
  - Keep `<RunAutoRefresh>` **mounted in every status**. Its plan says "RunAutoRefresh for queued/running, else the Finished line". Instead, render the Finished line *next to* the island when the run is terminal: the island hides its own live line and button, but its `run-live-status` region must survive the transition, or "Run complete — $x" is never announced.
  - Pass `costMicroUsd` and `stoppedReason` to the island.
  - Pass `renderedAtMs={Date.now()}` from the server component.
- **04-27 (recent runs):** use `RunStatusBadge`. On a list it can take `testId` if one hook per row is needed. Show the partial sentence with `STOPPED_REASON[key] ?? null`, never the key.
- **04-28 (e2e):** `/spend` renders `run-status-badge[data-status]` in BOTH the desk table and the phone cards. Both are in the DOM and CSS hides one, so scope selectors to the visible tree or use `:visible`. `spend-run-link-{runId}` also exists once per layout.
- **Merge:** `by-run.tsx`, `budget.ts`, `app-sidebar.tsx`, `mobile-tab-bar.tsx` and `more-sheet.tsx` are the files other waves might touch. The `budget.ts` change is additive: the `RunSpend` fields, the `r.kind` select and group-by, and one type import.

## Known Stubs

None.

## Threat Flags

None. T-4-05 (stopped reason) and T-4-02 (polling) are mitigated as planned and proven by M1/M2 and N1–N3. No new endpoints or trust boundaries were added.

## Self-Check: PASSED

- Files exist: `src/components/runs/run-status-badge.tsx`, `src/components/runs/run-auto-refresh.tsx`, `tests/unit/run-chrome.test.tsx`, `tests/unit/run-auto-refresh.test.tsx`.
- Commits exist on `worktree-agent-a5495dd77d796e9d8`: `987910a`, `403ec3b`, `f35eb63`, `8829a55`, `61ffb9f`, `9b3c756`.
