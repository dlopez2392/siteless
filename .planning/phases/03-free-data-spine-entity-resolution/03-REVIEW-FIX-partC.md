---
phase: 03-free-data-spine-entity-resolution
slice: C (UI)
fixed_at: 2026-09-23T00:00:00Z
review_path: .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partC.md
iteration: 1
base: e9bbed58867201911ba07733b3d58583069c9e11
head: 659f48c
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report, Slice C (UI)

**Fixed at:** 2026-09-23
**Source review:** .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partC.md
**Iteration:** 1
**Branch:** `worktree-agent-a31b4f18c6193cb8a`, reset to `e9bbed5` and then 7 commits, head `659f48c`

**Summary:**
- Findings in scope: 8 (C-CR-01, C-WR-01 … C-WR-07). Info findings were out of scope.
- Fixed: 8, in 7 commits. C-WR-02 and C-WR-03 share one commit because they change the same badge and the same header.
- Skipped: 0

**Protocol for every behavioural fix:**
1. A named test was run and seen failing by its name.
2. The fix was applied, and the test passed.
3. A mutation reverting the fix was applied with the change committed. The named test went red by name.
4. `git checkout -- <file>` restored the file, and `git status` came back clean.

**Final gates on `659f48c`:**
- `tsc --noEmit`: 0.
- `eslint .`: 0.
- `vitest run tests/unit`: 44 files, 320 tests, all passing.
- `next build`: exit 0 on the C-WR-07 tree. That tree matches the committed head.

I did not edit anything owned by fixer A or fixer B. `src/lib/time.ts` was not changed; `formatCount` was only imported.

## Fixed Issues

### C-CR-01: No error boundary anywhere; a rejected action crashes the app

**Commit:** `61fd55e`

**Files:**
- `src/components/review/review-actions.tsx`
- `src/components/business-detail/unmerge-dialog.tsx`
- `src/components/app-shell/route-error.tsx` (new)
- `src/app/(app)/error.tsx` (new)
- `src/app/(app)/review/error.tsx` (new)
- `src/app/(app)/businesses/[id]/error.tsx` (new)
- `src/lib/ui/copy.ts` (adds `ERROR_THING`)
- tests: `tests/unit/review-actions.test.tsx`, `tests/unit/unmerge-dialog.test.tsx`, `tests/unit/segment-error.test.tsx` (new)

**Applied fix:**
- Both transitions now `try/catch` the awaited action.
  - `/review`: a rejected promise sets the existing refusal, `REVIEW_DECISION_FAILED`, and it is retryable. The pair stays on screen and nothing refreshes or toasts. Rule 20 holds, because the queue still advances only on `ok: true`.
  - Unmerge: a rejection shows `UNMERGE_FAILED` in the open dialog. It does not close or refresh.
- Three client `error.tsx` boundaries use Next 16.3's `retry()`, which re-fetches and re-renders the segment. `reset()` does not re-fetch, so it was not used.
  - `(app)`: `UNEXPECTED_ERROR('this page')`.
  - `/review`: keeps the page title, shows `REVIEW_LOAD_FAILED`, and offers "Try again" and "Open sources".
  - `/businesses/[id]`: `SPINE_UNEXPECTED_ERROR('this business')`, with "Try again" and "Open sources".
- All three render inside the `(app)` layout, so the tab bar survives.
- The shared `RouteError` is a client module that exports only a component. Its copy comes from `copy.ts`, so there is no client-reference trap.
- The boundaries never print `error.message`.

**Named tests, each seen failing first:**
- `a decision whose request never reaches the server keeps the pair and shows the refusal`
- `an unmerge whose request never reaches the server keeps the dialog open with the unmerge-failed sentence`
- `the review boundary renders the review-load-failed sentence and retries the segment`
  - Plus three sibling boundary tests in the same file.

**Mutation:** make both catches rethrow, and render the wrong sentence in the review boundary. Exactly those three named tests went red.

### C-WR-01: Clerk lookup had no timeout and could print an email

**Commit:** `44f3a49`

**Files:**
- `src/app/(app)/businesses/[id]/actor-names.ts` (new; extracted from `page.tsx`)
- `src/app/(app)/businesses/[id]/page.tsx`
- `tests/unit/actor-names.test.ts` (new; Clerk is factory-mocked)

**Applied fix:**
- `getUserList` now races a 1500ms deadline (`ACTOR_LOOKUP_TIMEOUT_MS`). A timeout or a throw falls back to the raw id.
- The losing promise's late rejection is swallowed, and the timer is cleared.
- At most 100 ids go into one page. Any beyond that print as raw ids.
- The name is first + last, else the username, else nothing, so the raw id prints. **The email fallback is gone.**
- `copy.ts` has no "a teammate" string, so I kept the existing raw-id fallback and did not invent copy.

**Named tests, seen failing first:**
- `a Clerk lookup that never answers falls back to the raw ids once the budget runs out`
- `a user with no name and no username is never named by their email`
- `the page size stays inside what Clerk accepts`

**Mutation:** remove the race and restore the email fallback. The first two named tests went red.

### C-WR-02 and C-WR-03: One chain-flag formatter, and one flag-badge size

**Commit:** `3f429e8` (both findings)

**Files:**
- `src/lib/ui/copy.ts`
- `src/components/flags/flag-badge.tsx` (new)
- `src/components/flags/closed-badge.tsx`
- `src/components/review/candidate-pair.tsx`
- `src/components/business-detail/detail-header.tsx`
- `src/components/business-list/business-cards.tsx`
- `src/app/(app)/businesses/[id]/page.tsx`
- tests: `tests/unit/closed-badge.test.tsx`, `tests/unit/business-detail.test.tsx` (prop rename only)

**Applied fix:**
- **Chain wording (C-WR-02).**
  - `copy.ts` gains `FLAG_CHAIN_LOCAL` ("Chain · {n} in the RGV") and `FLAG_CHAIN_LABEL(chain, shown)`. `FLAG_CHAIN_LABEL` is the one place the wording is chosen from `statewide`, and `shown` is required.
  - `ChainBadge` renders the label with the count from the pinned-locale `formatCount` (`src/lib/time.ts`).
  - The `.replace(' in Texas', '')` is gone, and so is the inline detail-page literal and its `new Intl.NumberFormat`.
  - `DetailHeader` now takes `chain` (the facts), not a pre-formatted `chainLabel`.
  - Result: the review card and the detail header both read "Chain · 1,284 in the RGV", or "… in Texas" for a statewide count.
- **Badge sizing (C-WR-03).**
  - `FLAG_BADGE_SIZING` (`h-auto px-2 py-1 text-sm font-semibold tabular-nums`) is shared by `ClosedBadge`, `ChainBadge` and `MergedAwayBadge`.
  - It applies on the detail header, the review card and the `/businesses` list.

**Named tests, seen failing first:**
- `the chain flag reads one way on the review card and the detail header (a local count)`
- `the chain flag reads one way on the review card and the detail header (a statewide count)`
- `the chain and merged-away badges share the Closed badge sizing (14/600, not the Badge default 12/500)`

**Mutations, each red by name:**
1. The formatter always says "in Texas": the local-count test went red.
2. The count is printed raw instead of through `formatCount`: both chain tests went red.
3. `MergedAwayBadge` loses the shared sizing: the sizing test went red.

### C-WR-04: Phone /sources list had no listitem children

**Commit:** `d1ae792`

**Files:**
- `src/components/sources/source-ledger.tsx`
- `src/components/sources/sources-skeleton.tsx`
- `tests/unit/sources-ledger.test.tsx`

**Applied fix:** `role="listitem"` goes directly on each source `Item`. The Item is a plain div, not a link. `business-cards.tsx` wraps its Item instead, but only because its Item is a link.

**Named tests, seen failing first:**
- `the phone ledger list owns one listitem per source`
- `the phone skeleton list owns one listitem per source`

**Mutation:** drop the role on the ledger. The ledger test went red.

### C-WR-05: Unmerge offered "Try again" for conflicts that can never succeed

**Commit:** `0011aca`

**Files:**
- `src/components/business-detail/unmerge-dialog.tsx`
- `src/lib/ui/copy.ts` (adds `ERROR_ACTION.reloadHistory` = "Reload the merge history")
- `tests/unit/unmerge-dialog.test.tsx`

**Applied fix:**
- The error state carries `retryable`. "Try again" and "Open sources" appear only for `unexpected` and for `conflict`/`concurrent_merge`, mirroring `isRetryable` in `review-actions.tsx`.
- `already_undone`, `later_merge_first`, `lead_key_in_use` and `not_found` get one action: "Reload the merge history". It closes the dialog and calls `router.refresh()`.
- Closing the dialog any other way after such a refusal (Keep them merged, or Escape) also refreshes. This removes the stale Unmerge button.
- The refresh is deliberately **not** fired at the moment of refusal. Re-reading the page then could unmount the row's dialog before the sentence has been read.
- The existing parameterised refusal test was split into retryable and non-retryable cases. Its mocks now carry the `detail.reason` the real action sends.

**Named tests, seen failing first:**
- `a refused unmerge that can never succeed (later merge first) …`
- `… (already undone) …`
- `dismissing after a refusal that can never succeed still refreshes, so the stale button goes away`

**Mutations, each red on all three:**
1. Every refusal becomes retryable.
2. The refresh on close is removed.

### C-WR-06: Skip and Different helper sentences were never rendered

**Commit:** `2ced4b8`

**Files:**
- `src/components/review/review-actions.tsx`
- `src/app/(app)/review/page.tsx`
- `tests/unit/review-actions.test.tsx`

**Applied fix:**
- `ReviewHelpers` renders `REVIEW_DIFFERENT_HELPER` and `REVIEW_SKIP_HELPER` as Label 14/400 muted text.
- The Different and Skip buttons point at them with `aria-describedby`. The ids are private to the module, so no data is exported from the client module.
- **Where it sits differs from the review's suggestion, on purpose.** It is not inside the fixed thumb bar. Three more lines there would take about 70px of a 390×844 phone permanently.
  - On phone, the page renders it in the scrolling flow just above the bar's spacer.
  - From 640px up, `sm:order-last` puts it beneath the action row.
- **Measured on the built app:**
  - Phone (390×844): the helpers sit at 563–627px, above the thumb bar at 643px.
  - Desk (1280×800): the helpers sit at 546–590px, below the Different button at 478–522px.
  - Painted style is `14px/400 rgb(91, 104, 109)` (`#5B686D`).
  - The accessible description on Different resolves to the helper sentence.
  - This was a temporary Playwright probe and is not committed. No decision button was pressed.

**Named test, seen failing first:** `the Different and Skip helper sentences are shown and describe their buttons`

**Mutation:** remove `aria-describedby`. The named test went red.

### C-WR-07: Success toasts covered the phone thumb bar (unmeasured in the review)

**Commit:** `659f48c`

**Files:**
- `src/lib/ui/chrome.ts` (new, server-safe)
- `src/components/review/thumb-bar.tsx`
- `src/app/layout.tsx`
- tests: `tests/unit/thumb-bar.test.tsx`, `tests/e2e/toast-clearance.spec.ts` (new)

**Measured first, on a local `next build` + `next start -p 3133` against the local DB, 390×844, signed in with `@clerk/testing`:**
- **Before the fix**, a one-line toast sat at **774.5–828px**. That is over the thumb bar (**643–780px**) and over the tab bar (from **779px**). sonner's default is 16px off the bottom edge.
- The e2e test `a toast clears the tab bar and the review thumb bar on a phone` failed by name on this build.

**Applied fix:**
- `ThumbBar` writes its measured height to `--thumb-bar-height` on `<html>`, using the ResizeObserver 03-22 already added. It removes the variable on unmount.
- The root `Toaster` takes `mobileOffset={PHONE_TOAST_OFFSET}`, which is `{ bottom: 'calc(4rem + env(safe-area-inset-bottom) + var(--thumb-bar-height, 0px) + 0.5rem)' }`.
- This puts the stack above the tab bar on every phone screen, and above the thumb bar on `/review`. It follows the bar when a refusal makes the bar taller.

**After the fix, rebuilt and re-measured:** the toast sits at **581.5–635.0px**, and the thumb bar top is **643.0px**. The e2e test passes.

**Named unit test, seen failing first:** `thumb bar publishes its measured height for the phone toast offset, and withdraws it on unmount`

**Mutation:** remove `setProperty`. The named test went red.

**How the e2e spec stays read-only:**
- The toast comes from "Copy lead key", which writes nothing.
- A keyboard client-side navigation carries it to `/review`, with the pointer resting on the toast so sonner pauses its dismiss timer.
- The spec skips with a named reason where there is no pending pair or no business. That includes production, whose spine is empty this phase.

**Known gap:** sonner switches to `mobileOffset` below 600px, but the tab bar shows below 640px. From 600 to 639px, sonner's desktop offset still applies. That band was not measured or changed.

## Local-environment notes

- The local DB was read-only throughout. No Same, Different, Skip or Unmerge was pressed.
- Only my own `next start` PIDs were killed: 105696 and 66924, both on port 3133.
- Temporary measurement specs (`tests/e2e/zz-tmp-*.spec.ts`) and logs were deleted, and the working tree is clean. `.env.local` was copied in and not committed.
- `gsd-sdk` is not on PATH here, so the commits were made with `git commit` in the required `fix(03): <ID> …` format.
- No second worktree was created. The orchestrator-provided worktree was used as the isolation boundary.

---

_Fixed: 2026-09-23_
_Fixer: Claude (gsd-code-fixer), slice C_
_Iteration: 1_
