---
phase: 03-free-data-spine-entity-resolution
plan: 18
subsystem: /businesses list screen (UI) + list query performance
tags: [ui, rsc, search, suspense, shadcn, paging, performance, jsdom]
requires:
  - 03-04 (copy.ts: every /businesses string, SOURCE_TAG, FLAG_CLOSED, NO_CLUSTER_MAPPED)
  - 03-06 (sql-never-normalizes guard, unaccent allow-list)
  - 03-15 (src/server/queries/businesses.ts: listBusinesses / BusinessListRow / ClusterOption)
provides:
  - src/app/(app)/businesses/page.tsx (the /businesses RSC route)
  - src/components/business-list/business-filters.tsx (BusinessFilters, SearchRetryButton)
  - src/components/business-list/business-table.tsx (BusinessTable, BusinessesShowMore)
  - src/components/business-list/business-cards.tsx (BusinessCards + shared sourcesLine / clusterLabel / BusinessStatusBadge)
  - src/components/business-list/businesses-empty.tsx (BusinessesEmpty, BusinessesNoMatch, BusinessesSearchFailed)
  - src/components/business-list/businesses-skeleton.tsx (BusinessesSkeleton)
affects: [03-19 business detail (link target /businesses/[id]), 03-16 nav (nav-businesses destination), 03-22 screenshots]
tech-stack:
  added: []
  patterns:
    - "Rows-only Suspense keyed on the search + filters but NOT on limit: search shows skeletons, append is a transition over a revealed boundary"
    - "One listBusinesses promise per request, awaited by the rows region and passed (as a derived, never-rejecting promise) to the client filters for the cluster options"
    - "Client search box: local state + debounced router.replace; URL→box sync only for URL changes the box did not write"
    - "Desk autofocus decided once, on the first render that has the real breakpoint (useIsDesk + a hydrated flag)"
    - "Shared list helpers live in the server-safe cards module; the client table module exports components only"
key-files:
  created:
    - src/app/(app)/businesses/page.tsx
    - src/components/business-list/business-filters.tsx
    - src/components/business-list/business-table.tsx
    - src/components/business-list/business-cards.tsx
    - src/components/business-list/businesses-empty.tsx
    - src/components/business-list/businesses-skeleton.tsx
    - tests/unit/business-list.test.tsx
  modified:
    - src/server/queries/businesses.ts
decisions:
  - "The unaccent allow-list was already complete at two entries (03-15 added businesses.ts in its own commit); left untouched, M24 still reds it"
  - "The list's srcs CTE is `as materialized`: without it Postgres inlines it per row and seq-scans source_records once per page row (5.6 s/page at 92k)"
  - "Append pager caps at 500 rows (the query module's per-request ceiling); past it the button hides and the count line still says 'showing the first 500'"
  - "Zero rows with only filters active renders the no-match state quoting the filter labels, action 'Clear filters' (no dedicated copy exists)"
  - "No live-server check against the local DB: the app shell writes on every request (ensure_org upsert, ensure_budget_period), and 03-20's DB must not be written; real-volume timing measured in read-only transactions instead"
metrics:
  duration: ~35 min
  completed: 2026-09-23
  tasks: 2
  files: 8
---

# Phase 3 Plan 18: /businesses list Summary

`/businesses` is built. It has a 48px search field that paints at once and never blanks, Cluster and Status filters, a desk table and phone cards, and "No cluster mapped" rows kept visible. Sources render as muted text, and a "Show 50 more" button appends 50 rows at a time. While measuring the search at real volume I found that 03-15's list query spent 5.6 s on every page load. A one-word SQL fix brought that to 167 ms.

## What was built

**Task 1: the route, the search field and the two filters** (`4e3f40f`)
- **`page.tsx`**: an RSC with `force-dynamic`.
  - State lives in `searchParams` (`q`, `cluster`, `status`, `limit`). Every value is parsed defensively: the query is trimmed and capped at 200 characters, the cluster key must match a regex, the status must be in the allow-set, and the limit is clamped to 50–500.
  - The page opens one `listBusinesses` promise. The rows region awaits it. The filters receive `listing.then(r => r.clusters, () => null)`, so the cluster names come from the same single `withOrg`.
  - A database failure becomes `{ ok: false }` via `unstable_rethrow` plus a catch, so the rows region shows `BUSINESS_SEARCH_FAILED` and the search box is left alone.
- **Hierarchy:** "Businesses" (Heading 20/600), then the search field, then the count line (`businesses-count`, tabular, pinned-locale count through `BUSINESSES_COUNT_LINE`), then the rows.
- **Only the rows suspend.** The heading, the search field and both selects render outside the `Suspense`, as the real controls.
  - The boundary is keyed on `q + cluster + status`, so a new search shows 8 row skeletons.
  - It is not keyed on `limit`. "Show 50 more" is therefore a transition over an already-revealed boundary, and the rows on screen never blank.
- **`business-filters.tsx`** (`'use client'`):
  - The search `Input` has `data-testid="businesses-search"`, is `h-12`, and uses `text-base md:text-base` so it stays 16px at every width. It has `type="search"`, an accessible name taken from the placeholder constant, and a 300 ms debounce. Enter commits immediately through `onSubmit`, never a form `action`.
  - **Always `router.replace`, never `push`.** Every navigation drops `limit`.
  - The typed text is local state. The box follows the URL only when the URL changed from somewhere else (Clear search, back/forward), never when the URL is catching up to what was just typed.
  - **Autofocus is desk-only**, via the imported `useIsDesk()`. The decision is made once, on the first render that has the real breakpoint. During hydration `useIsDesk` still returns its server snapshot, and re-deciding on every change would focus a phone rotated into landscape. There is no second `matchMedia`.
  - Two `Select`s (`businesses-filter-cluster`, `businesses-filter-status`) use `useOptimistic` for instant feedback. They are 44px on phone and 48px on desk, via `data-[size=default]:h-*`, because the primitive's attribute-variant `h-8` would beat a bare `h-11`. Cluster options are "Any cluster", then the display names from the query, then "No cluster mapped". Status options are Any · Active · Closed · Merged away.
  - `SearchRetryButton` does "Try again" as a `router.refresh()`, so the query is untouched.
- **`businesses-skeleton.tsx`**: the count-line block plus 8 row skeletons. It is only the rows' fallback.

**Task 2: table, cards, empty states, paging** (`d7ee0c4`)
- **`business-table.tsx`** (`'use client'`, because it owns the pager): a shadcn `Table` with Name · City · Cluster · Sources · Status.
  - The name cell is the only link. Its href is `/businesses/${row.id}`, the internal uuid. The row is not a link.
  - Sources are muted text joined with ` · `.
  - The status is a `Badge` only when the row is not Active. Active keeps an `sr-only` word.
  - Row testid is `businesses-row-{id}`.
- **`BusinessesShowMore`** (`businesses-show-more`, the only instance) is outline, 44px and Body 16/400. It writes `limit` inside a transition with `scroll: false`, and shows `Spinner` + "Loading…" at the same `min-w-44`.
- **`business-cards.tsx`** has no directive and is server-rendered.
  - One `Item` per business, and the whole card is the link (`businesses-card-{id}`). A `role="listitem"` wrapper keeps the anchor's link role.
  - Each card shows `display_name` verbatim (Heading 20/600), then "McAllen · Home services & trades", then "Comptroller · Overture", then the badge.
  - The module also exports the helpers the table uses, so the two breakpoints cannot disagree.
  - `Closed {date}` goes through `formatLocal`, which is Chicago-zoned with a pinned locale, and sits on the destructive surface.
- **`businesses-empty.tsx`**:
  - **Spine empty:** the `store` icon, "The spine is empty", and "Open sources" linking to `/sources`.
  - **No match:** the `search` icon and "No business matches “{query}”", with the long query wrapping. The action is "Clear search", which keeps the filters.
  - **Search failed:** a destructive-surface `Alert` with `BUSINESS_SEARCH_FAILED`, "Try again" and "Clear filters" (which keeps the query).
  - Every string comes from `copy.ts`. The actions are outline buttons; there is no accent CTA.

**Added: performance fix** (`baade63`) and **tests** (`c13fb13`). See Deviations.

## Search timing at real volume

Measured on the local spine that 03-20 loaded: **91,872 businesses** and **141,242 source records** under danlo's org. The queries ran as `app_user` → `set local role authenticated` with that org's Clerk claims, so exactly as `withOrg` runs them. All of it was inside `begin read only`, and nothing was written. The machine was contended (03-20 loading, sibling builds).

| Case | Count query | Page (50 rows), as shipped by 03-15 | Page after the fix |
|---|---|---|---|
| no query | 11–71 ms | **5.6–7.3 s** | **167 ms** |
| no query, 500 rows | 12 ms | **49 s** | **270 ms** |
| `taqueria` (650 hits) | 312–880 ms | 4.4–6.0 s | 415 ms |
| `guera` (accent-folded, 10 hits) | 400–570 ms | 1.4–4.5 s | 366 ms |
| `SL-3KCRMF` (lead key) | 1.1–1.2 s | 1.5–1.7 s | 1.6 s |
| `a` (75k hits, worst case) | 530–740 ms | 4.3–6.9 s | 1.5 s |

- The count is a seq scan: `unaccent(...) ilike` over 92k rows, about 0.3–0.7 s. Because of the `OR`, the lead-key branch cannot use `businesses_external_key_uniq`, so a lead-key search still costs a full scan (about 1.2 s).
- Both are follow-ups for query shape, not migrations. See Deferred.
- The materialized and non-materialized pages returned **byte-identical** results for the no-query and `taqueria` cases.

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 1 - Bug] The list query seq-scanned `source_records` once per page row** (`src/server/queries/businesses.ts`, 03-15's file, outside `files_modified`). Commit `baade63`.
   - **Found during:** the real-volume timing requested by the orchestrator.
   - **Cause:** the `srcs` CTE is referenced once, so Postgres 12+ inlined it into the per-row `string_agg` subplan and pushed `business_id = p.id` down. `EXPLAIN ANALYZE` showed 50 loops × a 108 ms seq scan of 141k rows. The module's own comment says it exists to avoid exactly that.
   - **Fix:** `srcs as materialized (`. SQL only; no migration, no index.
   - **Verification:** the result is identical, 5.6 s became 167 ms, and `tests/db/provenance-render.test.ts` is 3/3 green on the changed SQL (rolled back, nothing persisted).
2. **[Rule 2 - Correctness] Added `tests/unit/business-list.test.tsx`** (10 tests, jsdom lane). Commit `c13fb13`. The plan had no tests, and I could not run the app against the local DB (item 5). These pin the must-have truths:
   - sources as text, never badges
   - "No cluster mapped" visible on both breakpoints
   - uuid-only hrefs, and only the name cell is a link
   - the Closed date in Chicago, as a discriminating instant: Sep 3 UTC vs Sep 2 Chicago in a UTC suite
   - `display_name` verbatim
   - debounced `replace`, never `push`
   - the box never blanks while the URL catches up
   - the box follows an outside URL change
   - desk-only autofocus
   - 48px / 16px
3. **Allow-list handoff:** `tests/unit/sql-never-normalizes.test.ts` already listed exactly `drizzle/0021_extensions.sql` and `src/server/queries/businesses.ts`. 03-15 added the second entry in its commit `d72b86e`. **No duplicate was added and the file is unmodified here.**
   - The guard passes.
   - **M24 still reds it and nothing else:** `unaccent(o.name_norm) % c.name_norm` at `src/lib/resolve/block.ts:251` produced `SQL never normalizes` × naming `block.ts:251`. Reverted.
4. **Append ceiling at 500 rows.** `listBusinesses` clamps each request to 500 (`MAX_LIMIT`, unexported). The page mirrors that as `MAX_ROWS = 500` and hides "Show 50 more" there, rather than editing 03-15's module to export the constant. The count line still reads "{n} businesses · showing the first 500". Chunked reads past 500 would be a follow-up if anyone ever needs row 501 without searching.
5. **No live screen check against the local DB.** The `(app)` layout writes on every request: `app.ensure_org` upserts the orgs row and `app.ensure_budget_period` may insert this month's period. The brief forbids writing to the DB 03-20 is loading.
   - Real-volume behaviour was measured at the SQL layer in read-only transactions, and the render contract is pinned in jsdom.
   - **Not yet observed in a real browser:** the keyed-Suspense and transition behaviour (rows never blanking on append, skeletons on a new search), and the Flight-serialized `clusters` promise resolving in the client. Both are covered by the 03-22 both-theme screenshots.
6. **Copy gaps (recorded, `copy.ts` not edited):**
   - **No sentence exists for "zero rows because of the filters alone"** (no text typed). I reused `BUSINESSES_NO_MATCH_HEADING` with the filter labels quoted (e.g. "No business matches “No cluster mapped · Closed”") and `ERROR_ACTION.clearFilters`. The body still talks about names, which fits less well; a dedicated string would help.
   - **No search-field label string.** The accessible name reuses `BUSINESSES_SEARCH_PLACEHOLDER`.
   - A business with an empty source list renders `FIELD_NO_DURABLE_SOURCE`, and a null city renders `FIELD_NOT_STORED`. Both are existing constants with the right meaning.

### unaccent in the `extensions` schema (question from the brief)

The predicate calls `unaccent(...)` unqualified, and `set local role authenticated` does **not** re-apply role-level `search_path`. The effective path is therefore the connecting session's (app_user's or the database's). Locally that path is `"$user", public`, and `unaccent` 1.1 lives in `public`.

**If production has `unaccent` in `extensions`, the predicate works only if that session's `search_path` includes `extensions`.** Supabase's database default normally does.

If it does not:
- **What fails:** every non-empty search raises `42883`.
- **How that looks on screen:** the rows region catches the error and shows "The search didn't come back. Your query is still in the box". This is not a 500. The unfiltered list, the filters and the paging keep working, because the predicate is only added for a typed query.
- **The fix:** qualify the call as `extensions.unaccent`, or set `search_path` on app_user.
- **Before 03-18 ships:** run one read-only `select unaccent('é')` / `EXPLAIN` of the search on the production pooler. I did not touch production.

## Deferred / follow-ups

- **Lead-key search is a full scan (about 1.2 s).** The `OR` stops `businesses_external_key_uniq` from being used. A `UNION` of an exact-key arm and the text arm would make the key lookup an index probe. This is query shape, not a migration.
- **The free-text count is a seq scan (0.3–0.7 s at 92k).** `unaccent` is STABLE, so no expression index can serve it (the 42P17 measured in 03-06). The options are to accept it or to add a stored folded-display column, which would be a migration and a D-12 conversation.
- **`source_records.business_id` still has no index** (03-15's follow-up). With `materialized` the list is fine without one; the detail page still does one seq scan.

## Known Stubs

None. Every row, count, option and badge is wired to `listBusinesses`.

## Threat Flags

None beyond the register:
- **T-3-05:** the query is a bound parameter, and the page additionally trims and caps it at 200 characters and allow-lists `status` and the `cluster` key.
- **T-3-11:** there is no `name_norm`, `street_norm`, `internal_notes`, chain key or lead key anywhere in `src/components/business-list/` (grep empty).
- **T-3-13:** every href is `/businesses/{uuid}`, pinned by a test.
- **T-3-03:** there is no `dangerouslySetInnerHTML`.
- **T-3-09:** `requireOrg()` runs in the layout, and there is one `withOrg` per request.

## Verification

- Final tree `c13fb13` on `worktree-agent-acc700f2cae8dca08`:
  - `tsc --noEmit` exit 0
  - `pnpm lint` exit 0
  - `pnpm test:unit` **35 files, 244 tests passed** (234 before this plan + 10)
  - `pnpm build` exit 0, `ƒ /businesses`
- `npx vitest run tests/unit/sql-never-normalizes.test.ts -t "SQL never normalizes" --reporter=verbose` shows `✓ … SQL never normalizes`.
- `tests/db/provenance-render.test.ts`: 3/3 green on the changed list SQL.
- The acceptance greps all pass:
  - `force-dynamic` is present.
  - `businesses-search` matches once, and `businesses-filter-` counts 2.
  - `useIsDesk` is imported, with no `matchMedia` in `business-list/`.
  - `businesses-show-more` appears once across the table and card files.
  - There is no `Badge` in the Sources cell.
  - No internal columns and no `[--` appear.
  - `NO_CLUSTER_MAPPED` is imported.
  - The `bg-card` / `rounded-` / `border border-` hits are primitive props only: the link's focus-ring `rounded-sm`, and `Empty` / `EmptyMedia` classes copied from `presets-empty.tsx`. There are no raw surfaces.

### Watched red (mutation → the one test that went red; each reverted, `git status` clean after)

| Mutation | Red |
|---|---|
| `navigate` uses `router.push` | `businesses search: debounced router.replace, never push, limit dropped` |
| URL→box sync unguarded (`if (true)`) | `businesses search: the box keeps what is being typed when the URL catches up` |
| URL→box sync removed (`setQuery` dropped) | `businesses search: a URL change it did not make (Clear search) empties the box` |
| autofocus regardless of breakpoint | `businesses search: autofocus on desk only` |
| closed date via an unzoned `Intl.DateTimeFormat` | `business list: Closed carries the America/Chicago date…` (`Closed Sep 2, 2026` not found) |
| `clusterName ?? ''` | `business list: an unmapped row reads No cluster mapped…` |
| Sources cell wrapped in a `data-slot="badge"` span | `business list: sources render as plain text…` (+ the Active-no-badge assertion) |
| card href built from the display name | `business list: every link carries the internal uuid…` |
| `unaccent(o.name_norm)` in `block.ts:251` (M24) | `SQL never normalizes` |

## Self-Check: PASSED

- FOUND: `src/app/(app)/businesses/page.tsx`, `src/components/business-list/{business-filters,business-table,business-cards,businesses-empty,businesses-skeleton}.tsx`, `tests/unit/business-list.test.tsx`
- FOUND commits: `4e3f40f`, `d7ee0c4`, `baade63`, `c13fb13`
- No file deletions in `822b3c7..HEAD`. STATE.md and ROADMAP.md are untouched. No migration, no production access, and the app was never pointed at any database.
