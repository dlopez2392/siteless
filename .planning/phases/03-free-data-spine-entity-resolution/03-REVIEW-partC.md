---
phase: 03-free-data-spine-entity-resolution
slice: C (UI — /review, /sources, /businesses, /businesses/[id], nav, shared Sheet)
reviewed: 2026-09-23T00:00:00Z
depth: standard
branch: gsd/phase-03-free-data-spine-entity-resolution
head: 93bf4cd
files_reviewed: 37
files_reviewed_list:
  - src/app/(app)/businesses/[id]/loading.tsx
  - src/app/(app)/businesses/[id]/not-found.tsx
  - src/app/(app)/businesses/[id]/page.tsx
  - src/app/(app)/businesses/page.tsx
  - src/app/(app)/review/page.tsx
  - src/app/(app)/sources/page.tsx
  - src/components/app-shell/app-sidebar.tsx
  - src/components/app-shell/mobile-tab-bar.tsx
  - src/components/app-shell/more-sheet.tsx
  - src/components/app-shell/top-bar.tsx
  - src/components/business-detail/copy-lead-key.tsx
  - src/components/business-detail/detail-header.tsx
  - src/components/business-detail/fields-and-sources.tsx
  - src/components/business-detail/merge-history.tsx
  - src/components/business-detail/source-records.tsx
  - src/components/business-detail/unmerge-dialog.tsx
  - src/components/business-list/business-cards.tsx
  - src/components/business-list/business-filters.tsx
  - src/components/business-list/business-table.tsx
  - src/components/business-list/businesses-empty.tsx
  - src/components/business-list/businesses-skeleton.tsx
  - src/components/flags/closed-badge.tsx
  - src/components/review/candidate-pair.tsx
  - src/components/review/review-actions.tsx
  - src/components/review/review-empty.tsx
  - src/components/review/review-skeleton.tsx
  - src/components/review/signal-chips.tsx
  - src/components/review/thumb-bar.tsx
  - src/components/sources/attribution-block.tsx
  - src/components/sources/confidence-distribution.tsx
  - src/components/sources/copy-command-button.tsx
  - src/components/sources/source-ledger.tsx
  - src/components/sources/sources-skeleton.tsx
  - src/components/ui/sheet.tsx
  - src/lib/ui/copy.ts
  - src/lib/ui/review-format.ts
  - src/lib/ui/run-tone.ts
findings:
  critical: 1
  warning: 7
  info: 9
  total: 17
status: issues_found
---

# Phase 3: Code Review Report, Slice C (UI)

**Reviewed:** 2026-09-23
**Depth:** standard (plus targeted cross-file reads of `src/server/queries/{businesses,review-queue}.ts`, `src/server/actions/{record-review-decision,unmerge-business,_result}.ts`, `src/app/(app)/layout.tsx`, `src/app/layout.tsx`, `src/components/ui/{item,badge}.tsx`)
**Files Reviewed:** 37
**Status:** issues_found

## Summary

I checked each known defect class in the brief against the code:

- **Client-reference trap (Rule 5): clean.** Every server component that imports from a `"use client"` module imports components only: `BusinessTable`/`BusinessesShowMore`, `SearchRetryButton`, `ReviewActions`/`ReviewAdvance`, `ThumbBar`, `UnmergeDialog`, `CopyLeadKeyButton`, `CopyCommandButton`, `ConfidenceDistribution`. The shared data (`LEDGER_SOURCES`, `COUNT_KINDS`, the helpers in `business-cards`, copy, run-tone and review-format) lives in modules with no directive. The one latent hazard is C-IN-05.
- **Form-reset / Rule 20: clean.** Review decisions and unmerge both use `onClick` inside `useTransition`. The queue advances, and the dialog closes, only on `ok: true`.
- **One `withOrg` per request: clean.** Each page opens exactly one, and nothing is nested. The Clerk call runs after the transaction, not inside it.
- **Tailwind `[--x]`: clean.** Grep found no hits.
- **Direct `Intl` in components: clean.** Only the two routes build pinned-locale formatters.
- **Internal annotation, `name_norm`, legal/display swap: clean.** None is selected or rendered.
- **URL params:** clamped and validated. `isUuid` runs before any read.

The blocker is error handling. The app has no `error.tsx` or `global-error.tsx`. A server action that rejects (the likeliest failure on a phone), or a read that throws, replaces the whole screen with Next's generic "Application error". The spec's error copy for those cases exists in `copy.ts` but can never render.

## Critical Issues

### C-CR-01: No error boundary anywhere. A network failure during a review decision or an unmerge crashes the whole app, and the spec'd error states can't be reached

**Files:**
- `src/components/review/review-actions.tsx:89-107`
- `src/components/business-detail/unmerge-dialog.tsx:111-124`
- `src/app/(app)/review/page.tsx:58-60`
- `src/app/(app)/businesses/[id]/page.tsx:105-107`

**Issue:**
- `find src/app -name error.tsx -o -name global-error.tsx` returns nothing, and there is no `ErrorBoundary` anywhere in `src`.
- `decide()` and `confirm()` do `await recordReviewDecision(...)` / `await unmergeBusiness(...)` inside `startTransition(async …)` with no `try/catch`. The action returns `{ok:false}` only for failures caught on the server. When the request itself fails, the promise rejects. That covers a phone losing signal mid-tap, a Vercel 5xx or timeout, and a deploy that invalidates the action id.
- In React 19 an error thrown inside a transition goes to the nearest error boundary. With no `error.tsx`, that is Next's built-in "Application error: a client-side exception has occurred" page. The queue, the pair and the tab bar are all gone.
- The spec's own row for this exact case ("That decision didn't reach the server… Try again · Reload the queue", UI-SPEC § Error) is only shown for server-side DB failures.
- The two read paths fail the same way. `listReviewQueue` in `ReviewRegion` and `getBusinessDetail` in the detail page are not caught, so a DB error (for example the `->> chain_key)::int` cast in the chain lateral) produces the same generic crash.
- As a result, `REVIEW_LOAD_FAILED` and `SPINE_UNEXPECTED_ERROR` in `copy.ts` are defined and referenced by no file (checked with grep).

No decision is lost, because Rule 20 holds and the pair is still pending. But on the phone-first primary screen, a routine connectivity blip becomes a full app crash.

**Fix:** catch the rejection in both transitions and map it to the refusal UI:
```tsx
startTransition(async () => {
  let result;
  try {
    result = await recordReviewDecision({ candidateId, decision });
  } catch {
    setRefusal({ message: REVIEW_DECISION_FAILED, retryable: true, decision });
    return;
  }
  if (!result.ok) { /* existing branch */ }
  ...
});
```
Do the same in `unmerge-dialog.tsx`, using `setError(UNMERGE_FAILED)`. Then add segment boundaries:
- `src/app/(app)/review/error.tsx` rendering `REVIEW_LOAD_FAILED` with "Try again" (`reset()`) and "Open sources".
- `src/app/(app)/businesses/[id]/error.tsx` rendering `SPINE_UNEXPECTED_ERROR('this business')`.
- A generic `src/app/(app)/error.tsx`.

## Warnings

### C-WR-01: The Clerk `getUserList` call on every detail render has no timeout, so a slow Clerk API blocks the whole page, and the fallback can print a reviewer's email

**File:** `src/app/(app)/businesses/[id]/page.tsx:77-95, 109`

**Issue:**
- `actorNames()` is awaited before anything renders. It is server-only (good), runs outside the `withOrg` (good), and a thrown error falls back to raw ids (good). But it has no timeout. If Clerk's Backend API is slow or rate-limited (it is called once per page view, with no caching), `/businesses/[id]` hangs until the SDK gives up. The unmerge action and every field on the page go with it, all for cosmetic names.
- Cross-org exposure is bounded: only ids stamped on this org's `business_merges` are looked up. However, `primaryEmailAddress` is the third fallback, so a user with no full name or username has their email printed as "Reviewed by jane@…" to every org member, including the `Member` role.
- `limit: ids.length` is fine until one business has more than 500 distinct actors, which Clerk rejects. That case falls back to raw ids.

**Fix:**
```ts
const lookup = client.users.getUserList({ userId: ids, limit: Math.min(ids.length, 100) });
const { data } = await Promise.race([
  lookup,
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('clerk timeout')), 1500)),
]);
```
- Drop the email fallback, or show initials only.
- Better still, stream the names: render the rows with ids first and put the names inside a `Suspense`.

### C-WR-02: The chain flag is rendered three different ways, including string surgery on a copy function

**Files:**
- `src/components/review/candidate-pair.tsx:113-117`
- `src/app/(app)/businesses/[id]/page.tsx:139-144`

**Issue:** The same fact comes out in three spellings:
- `/review`, statewide count: `FLAG_CHAIN(n)` → "Chain · 1284 in Texas". The count skips the pinned-locale formatter, so there is no grouping separator.
- `/review`, local count: `FLAG_CHAIN(n).replace(' in Texas', '')` → "Chain · 1284". The `replace` edits the output of a copy function, so any rewording of `FLAG_CHAIN` (for example "…statewide") silently brings back the overclaim this code exists to prevent.
- Detail page, local count: an inline `Chain · ${…} in the RGV`. This literal is not in `copy.ts`, which breaks Rule 5 ("every string lands in copy.ts").

So one business reads "Chain · 12" on `/review` and "Chain · 12 in the RGV" on its detail page, and statewide counts read "1284" on `/review` but "1,284" on the detail page.

**Fix:**
- Add `FLAG_CHAIN_LOCAL(n, shown)` to `copy.ts`.
- Use `statewide ? FLAG_CHAIN(n, formatCount(n)) : FLAG_CHAIN_LOCAL(n, formatCount(n))` in both places.
- Delete the `.replace`.

### C-WR-03: The detail header's Chain and Merged away badges have drifted to the Badge default 12/500, the same defect `ClosedBadge` was created to fix

**File:** `src/components/business-detail/detail-header.tsx:96-105`

**Issue:**
- `<Badge variant="outline">{chainLabel}</Badge>` and `<Badge variant="secondary">Merged away</Badge>` carry no typography classes. They render the primitive's `h-5 text-xs font-medium` (checked in `ui/badge.tsx:7`).
- They sit beside `ClosedBadge` (`h-auto px-2 py-1 text-sm font-semibold`), whose own header comment records that the detail header "had drifted to the Badge default 12/500, below the type scale (03-22)".
- `/review`'s chain badge and `/businesses`' merged-away badge both use the 14/600 treatment, so only this header is off-scale.
- `tests/unit/closed-badge.test.tsx` only pins `ClosedBadge`, which is why this passed.

**Fix:** Add `className="h-auto px-2 py-1 text-sm font-semibold tabular-nums"` to both, or better, extract a shared `FlagBadge` like `ClosedBadge` and pin it in the same test.

### C-WR-04: On phone, `/sources` renders `role="list"` with no `listitem` children (an ARIA required-children violation)

**Files:**
- `src/components/sources/source-ledger.tsx:281-290`
- `src/components/sources/sources-skeleton.tsx:70-72`

**Issue:**
- `ItemGroup` renders `role="list"` (`ui/item.tsx:11`), but `Item` is a plain `div` with no role. The phone ledger and its skeleton put four `Item`s directly under `ItemGroup`.
- Screen readers announce a list of zero or unknown items, and axe flags `aria-required-children` / `listitem`.
- `business-cards.tsx:250` already fixed exactly this with a `role="listitem"` wrapper, so the pattern exists in the codebase but wasn't applied here.

**Fix:** Wrap each `Item` in `<div role="listitem">`, as `business-cards.tsx` does, or pass `role="listitem"` on the `Item` itself.

### C-WR-05: An unmerge refusal offers "Try again" for conflicts that can never succeed, and leaves the stale Unmerge button on the page

**File:** `src/components/business-detail/unmerge-dialog.tsx:115-118, 145-169`

**Issue:**
- Every `!result.ok` shows the same Alert with "Try again" and "Open sources". For `conflict/already_undone` (someone else already undid it) and `conflict/later_merge_first`, a retry sends the same request and gets the same refusal.
- `UNMERGE_ALREADY_UNDONE` tells the user to "Reload to see the current merge history", but no reload action is offered.
- The page is never refreshed on failure. After dismissing, the row still reads as an active merge with a live Unmerge button, so the user can repeat the loop indefinitely.
- `review-actions.tsx` solved this with `isRetryable()` plus a "Reload the queue" action. The unmerge path did not reuse that pattern.

**Fix:**
- Carry `code` and `detail.reason` into the error state.
- Show "Try again" only when `code === 'unexpected' || reason === 'concurrent_merge'`.
- On any `conflict` / `not_found`, call `router.refresh()` so the row re-renders as undone, and offer a "Reload" action in place of retry.

### C-WR-06: The Skip and Different helper sentences in the Copy Table are never rendered, even though "Different" is permanent and deliberately unconfirmed

**File:** `src/components/review/review-actions.tsx:159-186` (constants at `src/lib/ui/copy.ts:396-398`)

**Issue:**
- UI-SPEC § Copy Table lists `/review` "Skip helper" and "Different helper". Grep shows `REVIEW_SKIP_HELPER` and `REVIEW_DIFFERENT_HELPER` are referenced by no file.
- Rule 23 removes any confirmation from "Different", yet the action is permanent: "records these two as separate for good — they will never auto-merge". The helper sentence is the only disclosure the spec gives the reviewer, and it isn't shown.

**Fix:**
- Render both helpers as Label 14/400 muted text beneath the action row. On phone they can go inside the thumb bar under row 2; `ThumbBar` already measures its own height.
- Link them with `aria-describedby` on the Different and Skip buttons.

### C-WR-07: Success toasts will likely cover the phone thumb bar right after each decision

**Files:**
- `src/components/review/review-actions.tsx:100-104`
- `src/components/review/thumb-bar.tsx:47`
- `src/app/layout.tsx:49` (`<Toaster />` with defaults)

**Issue:**
- `<Toaster />` uses sonner's defaults: `bottom-right`, which becomes a full-width bottom stack under 600px with a 16px mobile offset, at a very high z-index.
- The thumb bar is fixed at `bottom: 4rem + safe-area`, with its "Different / Skip" row roughly 80–128px from the bottom.
- `TOAST_MERGED` quotes two business names and wraps to two or three lines (about 80–100px). That puts it over the lower action row for its roughly 4s lifetime, which is exactly when the reviewer reaches for the next pair.
- I have not measured this on the built app. It is inferred from sonner's defaults and the bar's geometry.

**Fix:**
- Verify with a 390×844 screenshot of the built app, per Rule 8.
- Then set `<Toaster position="top-center" />`, or `mobileOffset={{ bottom: 'calc(4rem + env(safe-area-inset-bottom) + <bar height>)' }}` on `/review`.

## Info

### C-IN-01: The bad-id copy was never wired up: a malformed id shows "No business with that id"

**File:** `src/app/(app)/businesses/[id]/page.tsx:103`, `not-found.tsx:30`

UI-SPEC § Error gives a malformed id its own sentence (`BUSINESS_BAD_ID`: "the lead key is for reading aloud, not for the address bar"). That constant is referenced by no file. `isUuid` failing calls `notFound()`, which renders `BUSINESS_NOT_FOUND`.

A malformed segment reveals nothing about existence, so T-3-09 does not require collapsing the two. That matters because pasting `SL-7F3K2` into the URL is the likely mistake. **Fix:** pass a flag (for example, render an inline `Empty` with `BUSINESS_BAD_ID` instead of calling `notFound()` when `!isUuid(id)`), or record the divergence in the spec.

### C-IN-02: The header's "merged into" link can read "X merged into X"

**File:** `src/components/business-detail/detail-header.tsx:76-84`

`MERGE_ROW(displayName, mergedInto.displayName)` repeats the 03-22 defect that `merge-history.tsx` fixed with `MERGE_SIDE(key, source)`: after survivorship both names are often equal. **Fix:** name the survivor by its lead key, using `MERGE_SIDE`.

### C-IN-03: Duplicate formatters that disagree

**Files:**
- `src/lib/ui/review-format.ts:58-63, 70-73`
- `src/components/business-detail/fields-and-sources.tsx:74-76`
- `src/app/(app)/businesses/page.tsx:123`
- `src/app/(app)/businesses/[id]/page.tsx:139`

`formatCount` exists twice, in `lib/time.ts` and `review-format.ts`, and both routes build a third `Intl.NumberFormat`. There are also two phone formatters:
- `displayPhone` parses with default region `'US'`.
- `phoneDisplay` parses with no default region.

So a stored value lacking `+1` is formatted on `/review` but shown raw on the detail page. Rule 26 names a single phone formatter. **Fix:** keep one `formatCount` (in `lib/time`) and one `displayPhone`, and import them everywhere.

### C-IN-04: User-facing strings outside `copy.ts` (Rule 5)

These literals live in component or route files:
- `[id]/page.tsx:143`: "in the RGV"
- `fields-and-sources.tsx:150,153`: "Issued", "First sales"
- `source-records.tsx:28-32`: `RECORD_LABEL`
- `confidence-distribution.tsx:60`: "No confidence"
- `copy-command-button.tsx:24-26`: "Copied: …"
- `source-ledger.tsx:218`: `UNRECORDED_ERROR`
- `top-bar.tsx:30`: "Open navigation"

Several are self-documented as "copy gaps". **Fix:** move them into `copy.ts` now that the phase owns that file again.

### C-IN-05: `app-sidebar.tsx` is a `"use client"` module that exports data

**File:** `src/components/app-shell/app-sidebar.tsx:74, 105, 133, 136`

`LEADS_NAV`, `OPERATIONS_NAV`, `NAV_ITEMS` and `isNavActive` are exported from a client module. Every current importer is client-side (checked with grep), so this is not a live bug. It is, however, the exact trap Rule 5 describes: the first server component that imports `NAV_ITEMS` (a breadcrumb, a sitemap) gets `undefined` with every gate green. **Fix:** move the nav tables and `isNavActive` to a server-safe `src/lib/ui/nav.ts`. The `Icon` component references are fine in a shared module.

### C-IN-06: The unmerge dialog uses `disabled` while pending, so focus drops to `<body>` inside a modal

**File:** `src/components/business-detail/unmerge-dialog.tsx:181, 200`

The focused confirm button becomes `disabled`, so the browser blurs it, and Radix's FocusScope does not restore focus to a removed or disabled target. `review-actions.tsx:216-218` deliberately uses `aria-disabled` for this reason. **Fix:** use `aria-disabled` plus a guard in `onClick`, as `DecisionButton` does.

### C-IN-07: Orphaned doc comment

**File:** `src/app/(app)/businesses/[id]/page.tsx:52-53`

"Merge actors that are a Clerk user…" is attached to nothing: the next declaration, `sourceTagOf`, has its own comment. It is left over from an edit. **Fix:** move it onto `clerkUserIds` or delete it.

### C-IN-08: Skipping the last remaining pair is a visible no-op

**File:** `src/components/review/review-actions.tsx:100-106`, with ordering in `src/server/queries/review-queue.ts:162`

With one pending pair, Skip records `skipped_at`, `router.refresh()` returns the same `candidateId`, and nothing changes: no animation, no focus move, no toast, same count. That is indistinguishable from a dropped tap. **Fix:** when `decision === 'skip'` and the refreshed id equals the old one, show a quiet toast. Or render `REVIEW_SKIP_HELPER` (see C-WR-06) so the behaviour is explained.

### C-IN-09: The cluster Select shows a blank trigger for a URL cluster it has no option for

**File:** `src/components/business-list/business-filters.tsx:97, 246-266`

`urlCluster` is taken raw from the URL. The server ignores a key that fails `CLUSTER_KEY` (treating it as "any"), but the client still binds `value="Foo!"`. Radix Select then renders an empty trigger, not "Any cluster". The same happens before the cluster promise resolves, or for good if the list read failed (options stay `[]`). **Fix:** fall back to `ANY` when `urlCluster` is neither `ANY`/`NO_CLUSTER` nor present in `clusterOptions` once they have loaded. While loading, render the option label from the URL, not a blank.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), slice C_
_Depth: standard_
