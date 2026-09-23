---
phase: 03-free-data-spine-entity-resolution
plan: 16
subsystem: review queue screen (/review)
tags: [ui, rsc, review-queue, entity-resolution, motion, a11y, server-actions]
requires:
  - 03-04 (copy.ts review strings, toasts, empty/error copy)
  - 03-15 (review-queue.ts, record-review-decision.ts, _merge-decisions.ts)
provides:
  - src/app/(app)/review/page.tsx (the /review route)
  - src/components/review/{candidate-pair,signal-chips,review-actions,review-empty,review-skeleton}.tsx
  - src/lib/ui/review-format.ts (reviewChips, formatDistance, displayPhone, formatCount)
  - ReviewQueue.ingested (tells "Nothing to review yet" from "Queue clear")
  - recordReviewDecision → { remaining, merged: { winnerName, loserName } | null }
affects: [03-19 business detail (may want displayPhone), 03-21 e2e (/review testids), 03-22 screenshot review, Phase 7 TRI-03 reuses this shape]
tech-stack:
  added: []
  patterns:
    - "Decision buttons: onClick inside useTransition, advance (router.refresh) only on ok: true"
    - "AnimatePresence keyed by candidate id in ONE grid cell, so the old and new pair overlap and the region is never empty"
    - "useReducedMotion() + the media query read directly; reduced motion zeroes durations, never content"
    - "Two labels in one grid cell with the idle one `invisible`, so a busy button never resizes"
    - "data-testid spelled at the call site as a prop so acceptance greps find the literal"
key-files:
  created:
    - src/app/(app)/review/page.tsx
    - src/components/review/candidate-pair.tsx
    - src/components/review/signal-chips.tsx
    - src/components/review/review-actions.tsx
    - src/components/review/review-empty.tsx
    - src/components/review/review-skeleton.tsx
    - src/lib/ui/review-format.ts
    - tests/unit/review-chips.test.ts
    - tests/unit/review-actions.test.tsx
  modified:
    - src/server/queries/review-queue.ts
    - src/server/actions/_merge-decisions.ts
    - src/server/actions/record-review-decision.ts
    - tests/db/review-actions.test.ts
decisions:
  - "The merged toast's names come from the server (read after mergePair in the same tx). The winner is mergePair's choice (older created_at), which the screen cannot know."
  - "'Nothing to review yet' renders only when no ingest_runs row for the org is complete or stopped. Every other empty queue is 'Queue clear'."
  - "Chips with no copy wording (two different phones, two different ZIPs) render no chip rather than an invented sentence. The values are on the cards."
  - "The live region is the count paragraph itself (review-remaining, aria-live=polite). When the queue empties it holds a visually hidden 'Queue clear', so the end state is announced."
metrics:
  duration: ~75 min
  completed: 2026-09-23
  tasks: 2
  files: 13
---

# Phase 3 Plan 16: The /review queue screen Summary

`/review` now works the 80–94 band one pair at a time, from a phone.

- The two `display_name`s are the focal point.
- A chip band states why the pair scored what it did, as the component vector, never a bare score.
- The count and the score stay quiet.
- The action bar has three buttons. It advances only after the server records the decision.

## What was built

**Task 1: the route, the pair card and the chip band** (`3641c58`)

`page.tsx`:
- Server component with `force-dynamic` and one `withOrg` (`listReviewQueue(orgClaims())`).
- The Suspense fallback renders the same `PageHeading`, so first paint is "Review queue" plus a skeleton pair, never a spinner.
- The header row holds, in order: the title, then the remaining count (Body 16/600 tabular, `data-testid="review-remaining"`, `aria-live="polite"`), then "Highest score first". "Score N of 100" sits right-aligned (`review-score`, `data-score`).
- On phone the thumb bar is a shadcn `Card` fixed at `bottom-[calc(4rem+env(safe-area-inset-bottom))]`. The content gets `pb-[calc(2*3rem+0.5rem+2*1rem+1px)]`, which is two 48px rows, the 8px gap, 16px padding each side and the 1px border.

`candidate-pair.tsx`:
- One grid in DOM order A → chips → B. On phone it stacks that way, which is D-13's order. From 640px up, A and B sit side by side and the chip band spans beneath both.
- Each side shows, in order:
  - the verbatim `display_name` as an h2, with the side name hidden visually: "First record"/"Second record" on phone, "Left"/"Right" on desk
  - the address
  - the phone, formatted by libphonenumber-js
  - category · cluster
  - the source tag as plain muted text
  - `Closed {date}` via `formatLocal`
  - `Chain · {n} in Texas`
- Any missing field reads "Not on this record".

`signal-chips.tsx` + `review-format.ts`:
- `reviewChips()` is pure and reads the `features` vector defensively.
- Chips appear in the spec's order: phone exact / no phone on either side · name 0.81 · 140 m apart / no location on one side · same ZIP · same / different cluster.
- Agreement chips use `secondary`; disagreement and absence chips use `outline` with muted text.
- The band is a `role="group"` labelled "Why these two scored N".

`review-empty.tsx`:
- "Queue clear" (`check-check`) and "Nothing to review yet" (`inbox`).
- The heading is focusable, because focus lands there after the last decision.
- The action is an inline accent link to `/sources`.

`review-skeleton.tsx`: a skeleton pair in the real geometry. The page's loading state renders the real `ReviewActions` in the thumb bar with `candidateId={null}`, so all three buttons show and are `aria-disabled`.

**Task 2: the action bar** (source in `3641c58`, tests `59991f8`)

`review-actions.tsx` (`'use client'`):
- `onClick` inside `useTransition`. No form action.
- Buttons: "Same business" (accent, full width on phone), then "Different" (outline) and "Skip" (ghost) sharing row 2. All are 48px on phone and one 44px row from 640px up.
- The pressed button shows the spinner and "Recording…" in the same grid cell as its label, so its size never changes. The other two go `aria-disabled`.
- On `ok: false` a persistent destructive `Alert` shows the action's own message. "Try again" appears only for retryable failures, and "Reload the queue" always appears.
- A toast fires only on success: the merged toast with the server's names, "Recorded as different", and none for skip. `router.refresh()` is called last.
- `ReviewAdvance` wraps the pair in `AnimatePresence`, keyed by the candidate id:
  - The old pair exits (opacity 1→0, 8px up) while the new one enters (0→1), in the same grid cell, over 150ms.
  - Reduced motion is detected by `useReducedMotion()` or the media query. It sets durations to 0 and drops transforms, and the new pair's target is always opacity 1.
  - After an advance, focus moves to `[data-review-focus]` in the new pair, or to the "Queue clear" heading. The first render never moves focus.
- No confirmation step and no swipe/drag.

## Tests and mutation checks (each reverted and confirmed)

| Mutation | Went red |
|---|---|
| `readMergedNames(tx, loserId, winnerId)` (names swapped) | `a recorded merge names the true winner and loser for the toast` |
| `readIngested` also counts `running` runs | `the empty queue tells "nothing ingested" from "queue clear"` |
| `router.refresh()` moved ahead of the `ok` check (optimistic advance) | `a refused decision does not advance the queue` (plus 3 more that count refreshes) |
| the `if (!busy)` guard removed | `a second tap while one decision is in flight sends nothing` (only that one) |

The winner/loser test makes the Overture side the older record, so it wins. That way the two names differ after survivorship. The existing fixture gives both sides the name "Riverside Stone", which could not detect a swap.

## Gates (final tree `59991f8`, branch `worktree-agent-a33025ab3878f52b1`)

- `tsc --noEmit`: exit 0. `eslint .`: exit 0. `pnpm build`: exit 0 (`ƒ /review` listed).
- `vitest run tests/unit`: **36 files, 249 tests, all passing.** That includes the new `review-chips.test.ts` (9 tests) and `review-actions.test.tsx` (6 tests, dom lane).
- `vitest run --config vitest.db.config.ts --pool=forks`: **27 files, 192 tests, all passing**, including 2 new tests in `review-actions.test.ts`.
- Every filtered run used `npx vitest run <file> --reporter=verbose`, and I read the test names.
- Acceptance greps:
  - `force-dynamic` ✓
  - all 8 required `data-testid="review-…"` literals ✓
  - no `name_norm` / `nameNorm` in `src/components/review/` ✓
  - no `[--` ✓
  - the `bottom-[calc(4rem+env(safe-area-inset-bottom))]` literal in `page.tsx` ✓
  - `useTransition` ✓, no `<form action` ✓, 3 × `data-testid="review-action-` ✓, `h-12` ✓, `useReducedMotion` ✓, no `drag` ✓, `toast(` only on the success branch ✓
  - every `bg-card` / `rounded-` / `border border-` hit is on a shadcn primitive (Card, Empty, EmptyMedia, Skeleton) ✓
  - no `Intl.` in the components or the route ✓

## How the screen was checked

- Built app, not dev mode: `pnpm build`, then `SUPABASE_DB_POOL_URL=postgres://app_user:app_user@localhost:5432/siteless_test npx next start -p 3116`. The override was set on the command line only; `.env.local` was not edited. The app never pointed at prod. Prod lacks 0021–0024, so the successful render is itself evidence the DB was local.
- I signed in with `@clerk/testing` `clerk.signIn` (ticket, danlo's E2E admin), drove Playwright from a script in the OS temp dir, and captured `/review` at 390×844 and 1280×900 in light and dark. Each capture asserted `innerHeight > 0` and `visibilityState === 'visible'`.
- Computed values:
  - h1 and the "Queue clear" heading: 20px / 600.
  - live region: `aria-live=polite`, text "Queue clear".
  - accent link: `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark, 44px tall.
  - body: `rgb(244, 246, 247)` / `rgb(14, 20, 22)`.
- **What the screenshots show:** the real "Queue clear" state in all four combinations. danlo's local org had 91,872 businesses and complete ingest runs, but **no pair in the 80–94 band yet**. Sibling 03-20's resolve pass had written 27,820 blocked candidates, all still at score 0, and none had been scored after 5 minutes of polling.
- **The populated pair view (chips, badges, the two-row thumb bar) is therefore NOT screenshotted.** It is owed to 03-22's screenshot review once the local resolve pass has scored candidates. Its behaviour is covered by the component tests. I deliberately did not seed a candidate into danlo's org: 03-20 is writing to it, and a stray row or a stray delete could corrupt its measurement. I clicked no decision button.

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 2 - Correctness] `ReviewQueue.ingested` added to `review-queue.ts` (03-15's module).** The plan requires both empty states, and the query could not tell "no ingest has run" from "every pair decided". It is one cheap `exists` over `ingest_runs` (`complete`/`stopped`) and runs only when the queue is empty. DB-tested, mutation-checked. Commit `3641c58`.
2. **[Rule 2 - Correctness] `recordReviewDecision` now returns `merged: { winnerName, loserName } | null`.** The success toast "Merged — “{loser}” now resolves to “{winner}”" needs the winner, and `mergePair` picks it server-side by `created_at`. Guessing from the screen would print a false sentence half the time. `_merge-decisions.ts` reads both `display_name`s after the merge in the same transaction. The two existing `toEqual` assertions in `tests/db/review-actions.test.ts` were updated, and a discriminating test was added. Commit `3641c58`.
3. **[Rule 2] `src/lib/ui/review-format.ts` + `tests/unit/review-chips.test.ts`, not in `files_modified`.**
   - The chip derivation, the distance formatter, the phone display formatter and a pinned-locale count formatter are pure and server-safe, so the server-rendered chip band stays testable.
   - `formatDistance` rounds in hundreds of metres, because `(24950/1000).toFixed(1)` is "24.9". The unit test caught this.
   - A doc comment that spelled the literal `"use client"` tripped `ui-maps.test.ts`'s scan and was reworded.
4. **[Rule 2] `tests/unit/review-actions.test.tsx`** (6 dom-lane tests): Executor Rule 20 as named tests. This is Task 2's commit, `59991f8`.
5. **Task split:** `review-actions.tsx` landed in Task 1's commit, because the route cannot build without it and it depends on the action's new return type. Task 2's commit holds its verification.
6. **The thumb bar lives in `page.tsx` (`ThumbBar`), not in `review-actions.tsx`.** This matches the plan's acceptance grep for the `bottom-[calc(…)]` literal in `page.tsx`. The loading state renders the real disabled `ReviewActions` in the same bar, rather than `review-skeleton.tsx` rendering it.
7. **The live region is the count paragraph itself.** When the queue empties, it holds a visually hidden "Queue clear" or "Nothing to review yet". The spec requires the count and the end state to share one live region, and the Empty component lives in the animated stage, not in the header.

### Copy gaps (recorded; `src/lib/ui/copy.ts` NOT edited)

- **Chain flag without a statewide count.** `FLAG_CHAIN` always says "in Texas". When `chain.statewide` is false (RGV-only count), the component renders `FLAG_CHAIN(n).replace(' in Texas', '')`, i.e. "Chain · 7". A dedicated string, such as `FLAG_CHAIN_LOCAL(n)` → "Chain · {n} in the RGV", would be cleaner.
- **No chip wording for two different phones or two different ZIPs.** These render no chip; the two values are visible on the cards.
- **No toast for Skip.** The spec's toast list has none, so Skip advances silently. The advance itself is the feedback.

## Deferred / follow-ups

- **Pair-view screenshots (both themes, 390×844 and desk) are owed to 03-22** once the local resolve pass has scored pairs into 80–94. See "How the screen was checked".
- **Possible duplicate `displayPhone`.** 03-19's detail view also needs a libphonenumber display formatter. `src/lib/ui/review-format.ts` exports `displayPhone`; if 03-19 wrote its own, consolidate one into the other at merge time.
- The refusal `Alert` renders inside the phone thumb bar and makes it taller than the fixed content clearance. For as long as the refusal shows, it can overlap the bottom of card B. That is acceptable for a persistent error, but worth a look in 03-22.

## Known Stubs

None. Every value on the screen comes from `listReviewQueue` or the action result.

## Threat Flags

None beyond the plan's register.
- T-3-10: the component is not the control; `recordReviewDecision` still calls `requireOrg()` first and re-reads under RLS.
- T-3-11: `reviewChips` renders only labels from copy.ts and numbers. A unit test feeds a `nameNorm` key into the vector and asserts it renders nowhere, and no `name_norm` appears in `src/components/review/`.
- The new `merged` names are `display_name` only.

## Self-Check: PASSED

- FOUND: src/app/(app)/review/page.tsx
- FOUND: src/components/review/{candidate-pair,signal-chips,review-actions,review-empty,review-skeleton}.tsx
- FOUND: src/lib/ui/review-format.ts
- FOUND: tests/unit/review-chips.test.ts, tests/unit/review-actions.test.tsx
- FOUND commits: 3641c58, 59991f8
- No file deletions in `822b3c7..HEAD`. STATE.md and ROADMAP.md untouched.
