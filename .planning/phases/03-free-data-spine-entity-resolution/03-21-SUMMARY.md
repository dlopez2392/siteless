---
phase: 03-free-data-spine-entity-resolution
plan: 21
subsystem: deploy / production database / e2e
tags: [production-migration, supabase, vercel, playwright, pg_trgm, unaccent]
requires:
  - 03-16 (/review), 03-17 (/sources), 03-18 (/businesses), 03-19 (/businesses/[id]), 03-20 (desk run)
  - migrations 0021_extensions, 0022_spine_tables, 0023_spine_constraints_grants, 0024_merge_functions
provides:
  - production Supabase at journal 25, with the Phase 3 schema and 70 overture_category_map built-ins
  - production deployment dpl_3EwN5CwiKtnKyMAQvjkpAuXMLDry serving 8acee7c
  - tests/e2e/sources.spec.ts and tests/e2e/businesses.spec.ts (chrome only, deployed URL)
  - the presets.spec.ts row report + the recorded delete-path gap
affects:
  - docs/deploy.md (Phase 3 migration row, lessons, live deployment)
  - .vercelignore (.claude/)
tech-stack:
  added: []
  patterns:
    - "Runtime-role proof: app_user pooler URL -> set local role authenticated -> unqualified extension calls, rolled back"
    - "Compare pg_constraint across PG17/PG18 with contype <> 'n'"
    - "E2E count-or-empty: .or() union with toHaveCount(1) for a region that renders one of two states"
key-files:
  created:
    - tests/e2e/sources.spec.ts
    - tests/e2e/businesses.spec.ts
  modified:
    - tests/e2e/presets.spec.ts
    - docs/deploy.md
    - .vercelignore
    - .planning/phases/03-free-data-spine-entity-resolution/deferred-items.md
decisions:
  - "Task 1 answered by danlo 2026-09-23: Apply + deploy (migrate once, seed twice, catalog verify, vercel --prod from the branch, confirm sha, smoke, e2e on the real URL)"
  - "presets.spec.ts gets a report-only afterAll: the product has no preset delete path, and a direct owner-credential delete from a spec is refused"
  - "businesses-count is asserted as count-OR-empty exactly once, because the count line only renders when total > 0 and production's businesses table is empty"
metrics:
  duration: ~45 min
  completed: 2026-09-23
  tasks: 3
  files: 6
---

# Phase 3 Plan 21: Production migrate, deploy, and deployed-URL e2e Summary

Migrations 0021–0024 went to production once and were verified from the catalog. I proved
`unaccent`/`similarity`/`app.distance_m` resolve unqualified for the runtime role
(`app_user` → `authenticated`). The seed ran twice: 70 inserted, then 0. Commit `8acee7c`
is deployed as `dpl_3EwN5CwiKtnKyMAQvjkpAuXMLDry`, and `/api/health` echoes that sha. Two
new chrome-only specs pass, both checked by mutation, and the full suite is green against
the deployed alias.

## Task 1: the gate (checkpoint:decision)

danlo answered on 2026-09-23: **"Apply + deploy"**. Verbatim: "Run db:migrate:prod once, then
db:seed:prod twice (the second must report 0 inserted), verify from the catalog, `vercel
--prod` from the branch, confirm the deployed sha, smoke, then run the e2e suite on the real
URL." It is recorded in `docs/deploy.md` § 4 "Phase 3 (plan 03-21): what the run taught".

## Task 2: migrate, seed, deploy

**Pre-flight read (production, owner, `begin read only`, before any write):**

| Read | Value |
|---|---|
| `server_version` | 17.6 |
| `select count(*) from businesses` | **0** |
| `pg_extension` | pg_stat_statements 1.11, pgcrypto 1.3, uuid-ossp 1.1 (schema `extensions`); plpgsql; supabase_vault |
| `pg_trgm` / `unaccent` | available (1.6 / 1.1), **not installed** |
| `drizzle.__drizzle_migrations` | **21** (0000–0020) |
| migration-role `search_path` | `"$user", public, extensions` (no `postgres` schema exists) |
| `app_user` role setconfig | none (`authenticated` has only `statement_timeout=8s`) |
| spine tables present | none |

This matched the orchestrator's earlier read. Freshness gates just before the write:
`tests/unit/pg17-compat.test.ts` 2/2 passed, and `test:db` "server version" 1 passed (20 skipped).

**`db:migrate:prod`, run exactly once:** exit 0, `[✓] migrations applied successfully!` (the
banner is not the evidence; the journal count is).

**Post-flight, from the catalog on a separate later connection:**

- `pg_trgm 1.6` and `unaccent 1.1`, both in schema **`public`**.
- Six `businesses_%_src_fk`: address, closed_at, display_name, legal_name, location, phone.
- `businesses` indexes include `businesses_name_trgm` and `businesses_external_key_uniq`
  (nine in total).
- `record_merge`, `undo_merge` and `record_candidate_decision` all have `prosecdef = t` and
  `search_path=public`. The helpers `apply_survivorship` and `survivorship_snapshot` are
  invokers, and so is `distance_m`.
- `authenticated` holds `SELECT` only on `ingest_runs`, `merge_candidates`, `business_merges`
  and `business_aliases`. On `overture_category_map` it holds S/I/U/D: that is the
  reference-table grant in 0023, with RLS confining writes to org rows.
- `drizzle.__drizzle_migrations` = **25**.
- Parity with local, scoped to `public`, all equal: RLS tables 21, policies 76, triggers 25,
  `app.*` functions 18, indexes 74. The constraint totals differ, 111 on production and 277
  locally. That is PG18 cataloguing NOT NULL as `contype='n'` (166 rows). By type, c/f/p/u
  are 26/49/21/15 on both.
- **Runtime-role proof.** I connected through the transaction-pooler URL that Vercel holds.
  Before the role switch the session is `app_user` with `search_path` = `"$user", public`, so
  `extensions` is not on the path. Inside a rolled-back transaction I ran `set local role
  authenticated`, then `select unaccent('Café'), similarity('taqueria','taqueria el'),
  app.distance_m(26.2,-98.2,26.3,-98.1)`. It returned `Cafe`, `0.75` and `14936.5058630996`,
  with no schema qualification. This answers 03-18's concern about the unqualified
  `unaccent(`.

**`db:seed:prod` ×2:**

| Table | Run 1 | Run 2 |
|---|---|---|
| counties | 0 ins, 254 upd | 0 ins, 254 upd |
| industry_clusters | 0 / 4 | 0 / 4 |
| industry_terms | 0 / 33 | 0 / 33 |
| cities | 0 / 17 | 0 / 17 |
| outlet_counts | 0 / 20 | 0 / 20 |
| geo_presets | 0 / 3 | 0 / 3 |
| **overture_category_map** | **70 inserted**, 0 upd | **0 inserted**, 70 upd |

Read back independently: 70 rows, 70 with `org_id IS NULL`. No ingest or resolve ran
against production (D-01), and `businesses` is still 0.

**Deploy:**

- Pre-deploy checks: `git status --porcelain --untracked-files=all` was empty, there was no
  `coverage/`, and `.claude/` contained no files. I removed an empty stale dir,
  `.claude/worktrees/agent-a917ec3ba235901ad`. `.claude/` was neither vercelignored nor
  gitignored, so I added it to `.vercelignore` (`8acee7c`).
- Local gates at `8acee7c`: `typecheck`, `lint` and `build` all exited 0.
- `vercel deploy --prod --yes --scope team_8zjV46sJxQDsVzikNQa1JaO2`: `dpl_3EwN5CwiKtnKyMAQvjkpAuXMLDry`,
  READY, target production, aliased to `https://siteless-iota.vercel.app`. The remote build
  listed `/review`, `/sources`, `/businesses` and `/businesses/[id]`.
- The build log names no sha (as recorded in deploy.md § 10), so the commit check is
  `/api/health`: `{"ok":true,"db":"up","proxy":"up","commit":"8acee7c35e4122697530f18bee74b637e4c3924f"}`.
  That equals HEAD at deploy time.
- Signed-out smoke: `/` → `307 /presets`; `/sources`, `/businesses` and `/review` → `307` to
  `/sign-in`. The authenticated smoke is `signs in and is org-scoped` in the e2e run below.

## Task 3: specs, teardown, full e2e

- `tests/e2e/sources.spec.ts`, desk at 1280×800: `sources-table` is visible and
  `sources-load-failed` is absent. There are exactly 4 `sources-row-*`, and each is checked
  by exact key. Every `sources-count-{key}-{kind}` has a numeric `data-count`.
  `sources-attribution` is visible. `nav-sources` has exactly one visible match and
  `aria-current="page"`, and the tab bar is hidden.
- The same spec on a phone at 390×844: `nav-sources` has 0 visible matches until
  `nav-more` is tapped. Then `more-sheet` is visible and there is exactly one visible
  `nav-sources`. Tapping it navigates to `/sources` and closes the sheet. `sources-cards` is
  visible and `sources-table` hidden, the 4 `sources-card-{key}` rows are checked by exact
  key (the prefix would also match `sources-card-count-*`), and `nav-more` has
  `data-active="true"`.
- `tests/e2e/businesses.spec.ts`: `businesses-search` has exactly one visible match and
  takes focus. Both `businesses-filter-*` are visible. The list region shows exactly one of
  `businesses-count` or `businesses-empty`, and there is no `businesses-search-failed`.
  Typing an unmatchable query and pressing Enter sets `?q=`, `businesses-no-match` renders,
  and **the input still holds the typed value**.
- `presets.spec.ts`: there is no product delete path, so the gap is recorded in
  `deferred-items.md` and `afterAll` prints the preset names it created.
- **Full suite against `https://siteless-iota.vercel.app` (serving `8acee7c`): 20 passed, 5
  skipped, 0 failed, 59 s wall.** Names in the pass list:
  - `sources: desk › sources: four static rows, the attribution block and the six-row sidebar`
  - `sources: phone › sources: at 390x844 the screen is reached only through the More sheet`
  - `businesses: search and filters render, and a no-match search keeps its query`
  - `touch targets: every primary control clears 44px at 390x844`
  - `desk › touch targets: all six sidebar rows clear 44px at 1280x800`
  - `signs in and is org-scoped`
  - plus presets ×4, spend ×3, theme-tokens ×3, no-access ×2, budget banner (absent) ×1, and auth setup.

  The 5 skips are the existing deliberate self-skips: `preset-detail` ×3 (the two-databases
  trap) and `budget-banner` ×2.
- **Mutation check** (run with `npx playwright test <files>`, not a `-g` filter). I changed
  the row count to `SOURCE_KEYS.length + 1`: the desk sources test failed with "Expected 5,
  Received 4". I changed the value check to `toHaveValue("")`: the businesses test failed
  with Received `zzqxj-e2e-1790140579222`. Both files were restored byte-identical, as
  confirmed by `git diff --no-index`.
- Acceptance greps: no `TEST_DATABASE_URL`/`withDb(` and no `getByText(` in the new specs.
  `afterAll` appears in presets.spec.ts, and `more-sheet` appears in sources.spec.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's `businesses-count is present` assertion could not pass on production**
- **Found during:** Task 3
- **Issue:** `businesses-count` only renders when `total > 0` (`BusinessRows` in
  `src/app/(app)/businesses/page.tsx`). Production's `businesses` table is empty by design
  (D-01), so the page correctly renders `businesses-empty` there instead.
- **Fix:** the spec asserts that the union `businesses-count | businesses-empty` has exactly
  one match and is visible, and that `businesses-search-failed` is absent. This holds today
  and after a production load, and it fails if the region renders neither or both.
- **Files:** tests/e2e/businesses.spec.ts. **Commit:** 8a14f96

**2. [Rule 3 - Blocking] `.claude/` was not excluded from the Vercel upload**
- **Found during:** Task 2 (pre-deploy check requested by the orchestrator)
- **Fix:** added `.claude/` to `.vercelignore` with a rationale comment, and removed an empty
  stale worktree dir (it was untracked and empty).
- **Commit:** 8acee7c

**3. [Rule 1] The desk active-state hook differs from the phone one**
- Sidebar rows mark the current route with `aria-current="page"`. Only the tab bar's
  `nav-more` carries `data-active`. The spec asserts the attribute each element actually has.

### Notes (not deviations)
- The deployed sha is `8acee7c`, and HEAD is now `8a14f96` plus this SUMMARY commit. The
  commits after the deploy touch only `docs/`, `tests/` and `.planning/`, which are all in
  `.vercelignore`, so the deployed bundle is what HEAD would build.
- The Vercel CLI printed `Error while parsing config file: "…\pnpm-lock.yaml"`. The
  deployment still built and went READY, and this is noted in deploy.md.
- The `sources: phone` test took 12.4 s in the mutation run and 1.7 s in the full run. It
  passed both times, so this is cold-start variance with no failure involved.

## Known Stubs

None. The specs assert real rendered chrome, and nothing in them is placeholder data.

## Threat Flags

None. There is no new network surface. The two specs open no database connection
(T-3-14). The production reads used the owner credential from `.env.local` on this machine
only, and no value was printed or committed.

## Open items for danlo

- 🔴 **Production now serves a feature-branch commit** (`8acee7c` on
  `gsd/phase-03-free-data-spine-entity-resolution`, not pushed). Because of `vercel git
  connect`, the next push to `main` redeploys from `main` and rolls the four Phase 3 screens
  back. Merge the phase branch before anything else lands on `main`. CI's e2e health poll
  expects `GITHUB_SHA`, which this deployment will not match until the merge redeploys.
- Production has 15 `e2e-*` presets (5 runs), and no product path can delete them. See
  `deferred-items.md` § From 03-21.

## Self-Check: PASSED

- FOUND: tests/e2e/sources.spec.ts, tests/e2e/businesses.spec.ts, docs/deploy.md, .vercelignore, deferred-items.md
- FOUND commits: 8acee7c, f3c8718, 8a14f96
- Nothing pushed; no PR opened.
