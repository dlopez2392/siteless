---
phase: 03-free-data-spine-entity-resolution
plan: 19
subsystem: business detail screen (/businesses/[id])
tags: [ui, provenance, entity-resolution, unmerge, rsc, shadcn, timezone]
requires:
  - 03-04 (copy.ts strings for § 4, the unmerge dialog and the refusal sentences)
  - 03-15 (getBusinessDetail / readBusinessDetail with per-field provenance; unmergeBusiness)
provides:
  - src/app/(app)/businesses/[id]/page.tsx (the route, uuid-guarded, one withOrg)
  - src/components/business-detail/{detail-header,copy-lead-key,fields-and-sources,source-records,merge-history,unmerge-dialog}.tsx
  - the D-18 field order + text source-tag treatment that Phase 7's triage card inherits
affects: [03-22 screenshot review, Phase 7 triage card]
tech-stack:
  added: []
  patterns:
    - "server components for every section; two client islands (copy button, unmerge dialog), each exporting only a component"
    - "per-row testids written as literals so the row order is readable in the file"
    - "floating Comptroller dates anchored at noon UTC before formatLocal (midnight renders the previous day in Chicago)"
    - "dom-lane tests mock the server action AND run-drawer's queue-run action (useIsDesk lives in run-drawer.tsx)"
key-files:
  created:
    - src/app/(app)/businesses/[id]/page.tsx
    - src/app/(app)/businesses/[id]/not-found.tsx
    - src/app/(app)/businesses/[id]/loading.tsx
    - src/components/business-detail/detail-header.tsx
    - src/components/business-detail/copy-lead-key.tsx
    - src/components/business-detail/fields-and-sources.tsx
    - src/components/business-detail/source-records.tsx
    - src/components/business-detail/merge-history.tsx
    - src/components/business-detail/unmerge-dialog.tsx
    - tests/unit/business-detail.test.tsx
    - tests/unit/unmerge-dialog.test.tsx
  modified:
    - tests/unit/ids.test.ts
decisions:
  - "The lead keys travel on MergeRow, not MergeContext: a winner with two merges has two different loser keys, so a shared context would print the wrong key in one dialog"
  - "The chain badge says 'in Texas' only when ChainFlag.statewide is true; otherwise 'Chain · {n} in the RGV' (inline string, copy gap)"
  - "Merge actors are resolved to names through one Clerk getUserList call in the page, falling back to the stored id; an auto merge prints no actor (the actor is etl:resolve)"
  - "Every active merge row shows its Unmerge button, including non-latest ones; the server's LIFO refusal (UNMERGE_LATER_MERGE_FIRST) explains why rather than a hidden button"
  - "Aliases are read by the query but not rendered: neither the plan nor the UI-SPEC Copy Table gives them a surface"
metrics:
  duration: ~45 min
  completed: 2026-09-23
  tasks: 2
  files: 12
---

# Phase 3 Plan 19: Business detail screen Summary

`/businesses/[id]` is built. The route is uuid-guarded and reads everything in one `withOrg`. It shows the ten D-18 fields in the order Phase 7 inherits, each with an always-visible plain-text source tag. The lead key is the screen's only accent. Merge history is listed newest first, and every active merge has a named unmerge action. That action always opens a Dialog (desk) or Drawer (phone) confirmation, which closes only on `ok: true`.

## What was built

**Task 1 (`6ccfbf9`): route, header, fields and source records**
- `page.tsx` (RSC, `force-dynamic`):
  - `if (!isUuid(id)) notFound();` runs before any read.
  - One `getBusinessDetail(claims, id)` call, which is the one `withOrg` for the page.
  - `null` → `notFound()`. Unknown and foreign ids get the same answer (T-3-09).
  - The desk-only breadcrumb is wrapped in `hidden lg:block`.
- `detail-header.tsx`:
  - `display_name` verbatim at Heading 20/600.
  - `Lead key SL-…` in accent Body 16/600 `tabular-nums` (`business-lead-key`), with a text "Copy lead key" button (`copy-lead-key.tsx`, client).
  - Badges, each only when set: `Closed {date}` on the destructive surface, the chain flag (outline), `Merged away` (secondary). A merged-away record also links to its survivor.
- `fields-and-sources.tsx`:
  - Ten rows written out as literals, in the contract order: Display name · Legal name · Phone · Address · City · ZIP · Location · Category / cluster · Overture confidence · Permit dates · Closed on.
  - Each row is a `dt` and two `dd`s. Desk uses a 3-column grid with the tag right-aligned; phone stacks them into three lines.
  - A null value renders "Not stored". `provenance: 'none'` renders the tag "No durable source". The two are independent, as 03-15 designed.
  - Phone is a `tel:` link with E.164 in the href and the `libphonenumber-js` national form on screen.
  - No `Badge`, no `Tooltip`, no `Intl.` in the file.
- `source-records.tsx`: one row per record with source, version ingested, external id, first seen and last seen. A `stale` record reads "Last seen in the {version} release — not in the latest run".
- `ids.test.ts`: the walker now needs at least 3 routes and must find `businesses/[id]/page.tsx` specifically.

**Task 2 (`43863b0`): merge history and unmerge**
- `merge-history.tsx` (server):
  - Rows appear in the query's order (newest first; this component never re-sorts).
  - Each row reads "{loser} merged into {winner}", then "Reviewed by {actor}" or "Auto-merged at {score}", then the time in Chicago.
  - Active rows carry a named destructive-outline "Unmerge {loser}" button (`business-unmerge-{mergeId}`).
  - Undone rows read "Unmerged by {actor} on {date}" and have no action.
  - With no merges, it shows the `Empty` state "One source, no merges" with the `Merge` icon and no action.
- `unmerge-dialog.tsx` (`'use client'`):
  - `useIsDesk()` picks Dialog on desk, Drawer on phone.
  - A destructive `Alert` carries `UNMERGE_BODY` (all four consequences plus the audit line) and doubles as the Dialog/Drawer description.
  - `onClick` runs inside `useTransition`, with no form action. The confirm button shows `Spinner` + "Unmerging…".
  - While the write is pending, Escape, outside-click and dismiss are all refused.
  - On `!result.ok` it renders `result.message` in a persistent destructive Alert with "Try again" and "Open sources", and the dialog stays open.
  - On `ok: true` it shows a toast, closes, and calls `router.refresh()`.
  - Dismiss reads "Keep them merged". The corner close glyph is suppressed (`showCloseButton={false}`). No animation-library wrapper.
- `page.tsx`: merge actors are resolved to names (see Deviations). `not-found.tsx` renders `BUSINESS_NOT_FOUND` + "Open businesses". `loading.tsx` renders the spec's skeleton geometry.

## Mutations run, each caught by the test named for it (all reverted, diffs confirmed empty)

| Mutation | Red |
|---|---|
| `isUuid` guard removed from the page | `ids: every [id] route guards its id before it queries` |
| floating date anchored at 00:00 UTC | `two zones: a floating permit date keeps its calendar day in Chicago` (`'Mar 31, 2019' to be 'Apr 1, 2019'`) |
| tag for a sourceless field → a source name | `an unsourced field reads Not stored with the tag No durable source` |
| merge time formatted in the process zone (`toLocaleString`) | `two zones: merge and undo times render in Chicago, not in the suite zone (UTC)` |
| modal guard (`!next && isPending`) removed | `while unmerging the confirm reads Unmerging… and the dialog stays open and modal` |
| `setOpen(false)` before the `ok` check | all three `a refused unmerge (…) keeps the dialog open…` + the pending test |
| the action called on dialog open | `unmerge always confirms…` + `on a phone the confirmation is a drawer…` |

## Gates (final tree `43863b0`, branch `worktree-agent-a84cfb05cf7c9f9e7`)

- `tsc --noEmit`, `pnpm lint` and `pnpm build`: all exit 0. The build lists `ƒ /businesses/[id]`.
- `pnpm test:unit`: **36 files, 254 tests, all pass.** The base had 234. This plan adds 10 in `business-detail.test.tsx` and 10 in `unmerge-dialog.test.tsx`, and extends the `ids` walker.
- Filtered runs used `npx vitest run <file> --reporter=verbose`. I read the test names each time.
- Acceptance greps:
  - `data-testid="business-field-` matches 30 times (10 values × 2 branches + 10 `-source` tags).
  - These greps return nothing: `internal_notes|name_norm|nameNorm`, `Tooltip`, `Badge` (in fields-and-sources), `Intl.`, `>Cancel<`, `<form action`, `motion`, `bg-card|rounded-|border border-`.
- `test:db` was not run: this plan adds no SQL, and the query and action tier is 03-15's (179 DB tests green there).

## How the screen was checked

- **Rendered in jsdom** against fixtures (20 tests above), in a UTC suite, with Chicago-disagreeing instants.
- **Built** (`next build`).
- **Import graph checked by hand for the client-reference trap.** The two server files that import client modules (`detail-header.tsx` → `CopyLeadKeyButton`, `merge-history.tsx` → `UnmergeDialog`) import only components. No plain data crosses from a `'use client'` module. `useIsDesk` goes client→client.
- **Not run: a live built-app smoke.** The worktree sandbox refused to run a scratch harness outside the repo, and the plan's own verification assigns the both-theme screenshots of the built screen to 03-22.
- **Safety:** the app was never started, never pointed at production, and unmerge was never pressed on any data. The unmerge flow was proven only through mocked-action component tests. 03-15's DB tests prove the action itself.

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 1 - Bug] `loserKey` / `winnerKey` moved from `MergeContext` to `MergeRow`.** The plan's shared context would have printed one key pair in every row's dialog. A winner with two merges has two different loser keys, so the keys now travel per row. `MergeContext` is `{ businessName, businessId }`. Commit `43863b0`.
2. **[Rule 2 - Correctness] "in Texas" only when true.** `ChainFlag.statewide` (03-15) says whether the count is statewide. When it is not, the badge reads `Chain · {n} in the RGV` instead of overstating a local count. That string is inline in the page (copy gap below). The count goes through the pinned locale in the route, because no component may call `Intl`. Commit `6ccfbf9`.
3. **[Rule 2 - Correctness] Actor names.** `merged_by` / `undone_by` hold Clerk subjects (`user_…`). The page makes one `clerkClient().users.getUserList({ userId })` call for the ids a row actually prints. The name is `fullName` → `username` → primary email. If the lookup fails, the page shows the raw id, so the record of who acted is never dropped. `etl:resolve` is never printed: an auto merge reads "Auto-merged at {score}". Commit `43863b0`.
4. **[Rule 3] `copy-lead-key.tsx` added.** Copying needs the clipboard and a toast, so it is a client island. The header stays a server component. Commit `6ccfbf9`.
5. **[Rule 2] `not-found.tsx` and `loading.tsx` added** for the spec's error and loading states. There is one answer for malformed, unknown and foreign ids: `BUSINESS_NOT_FOUND` + "Open businesses" (T-3-09). `BUSINESS_BAD_ID` is unused because `notFound()` cannot carry which case it was, and telling them apart would weaken T-3-09. Commit `43863b0`.
6. **[Rule 2] Tests added beyond the plan's `ids` verify:** `tests/unit/business-detail.test.tsx` and `tests/unit/unmerge-dialog.test.tsx` (dom lane). The latter also mocks `@/server/actions/queue-run`, because `useIsDesk` lives in `run-drawer.tsx`, which imports that action.
7. **Destructive "filled" confirm.** The shadcn `destructive` button variant is a 10% tint, not a fill. The confirm uses `bg-destructive text-destructive-foreground` over the default variant (both are painted tokens in `globals.css`).
8. **Floating permit dates.** `permit_issue_date` / `first_sales_date` are zoneless Socrata dates. They are anchored at noon UTC before `formatLocal`, because a midnight anchor renders the previous day in Chicago. The mutation table above catches this.

### Copy gaps (recorded; `src/lib/ui/copy.ts` NOT edited)

- `Chain · {n} in the RGV`: the non-statewide chain flag (`page.tsx`).
- `Issued {date}` / `First sales {date}`: the halves of the Permit dates value (`fields-and-sources.tsx`).
- `External id`, `First seen`, `Last seen`: source-record labels (`source-records.tsx`, `RECORD_LABEL`). "Version ingested" reuses `SOURCES_COLUMN.version`.
- No string exists for rendering aliases, so they are not shown (see decisions). The loser's key already appears in the unmerge dialog body.

## Known Stubs

None. Every section renders live `getBusinessDetail` data. "Open sources" links to `/sources`, which sibling 03-17 builds in this wave.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: outbound-identity-lookup | src/app/(app)/businesses/[id]/page.tsx | One Clerk Backend API call (`users.getUserList`) per detail render that has a reviewed/undone merge, sending only Clerk user ids already stored as actors. Read-only, server-side, failure falls back to the stored id. |

T-3-09 (uuid guard, same `notFound()`), T-3-10 (the dialog sends only `{ mergeId }`, and the action enforces `requireOrg` + RLS), T-3-11 (no internal column in any component, confirmed by grep), T-3-13 (the lead key is display and copy only) and T-3-06 (honest "Not stored / No durable source") are implemented as the plan registers them.

## Self-Check: PASSED

- FOUND: all 11 created files and the modified `tests/unit/ids.test.ts`
- FOUND commits: `6ccfbf9`, `43863b0`
- No file deletions in `822b3c7..HEAD`. STATE.md / ROADMAP.md / copy.ts are untouched.
