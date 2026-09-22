---
phase: 02-budget-governor-search-presets
verified: 2026-09-22T19:05:00Z
status: passed
score: 6/6 must-haves verified (includes 1 override)
overrides_applied: 1
overrides:
  - must_have: "A Google Cloud per-API daily quota stands as an independent second wall"
    reason: "The Google Cloud project and Places API (New) key do not exist yet (PROJECT.md 'Dependencies not yet created'). BUDG-03 was executed as far as possible: the derivation (100 requests/day) is computed and documented at docs/runbooks/google-quota.md, the second-wall card renders the recommendation and its honest caveat (100/day x 30 = $70/mo, above the $50 cap), and a committed unit test (`no google credential is read anywhere in src`) proves nothing in this phase depends on the key existing. Setting the console quota itself is a human action recorded as `checkpoint:human-action` in plan 02-14 and blocked on a project danlo has not created. REQUIREMENTS.md itself already carries BUDG-03 as Pending (not Complete), so this is a transparently tracked deferral, not a silently dropped requirement."
    accepted_by: "danlo"
    accepted_at: "2026-09-22T00:00:00Z"
---

# Phase 2: Budget Governor & Search Presets Verification Report

**Phase Goal:** danlo can define and cost a search before it runs, and no code path in the system can spend a cent outside an atomic, race-free meter.
**Verified:** 2026-09-22T19:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

Every truth below was checked against the actual codebase — not SUMMARY.md prose — via a fresh `pnpm typecheck` (0 errors), fresh `pnpm lint` (0 errors), a fresh `pnpm test:unit` run (76/76, this verifier's own run), a fresh `pnpm test:db` run (90/90, this verifier's own run against the real local `siteless_test` PostgreSQL 18.6 database), direct `Read`/`grep` of the migration SQL, server actions and components, three live read-only SQL probes against the local database, and a live `curl` against the deployed production URL.

### Observable Truths

| # | Truth (ROADMAP success criterion) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | danlo saves a named preset defined as one or more industry clusters × a geography (city list, county, or radius around a geocoded point), with the four clusters, RGV city list and four RGV counties already seeded on first run | ✓ VERIFIED | Live read-only SQL against local `siteless_test`, run by this verifier: `select count(*) from industry_clusters where org_id is null` → **4**; `select key,display_name,kind from geo_presets where org_id is null` → `rgv_17_cities` (cities), `rgv_4_counties` (counties), `texas_254_counties` (counties); `select count(*) from counties` → **254**; `select count(*) from outlet_counts` → **20**. `src/seed/data/cities.json` parsed directly by this verifier → 17 cities; `counties.json` → 254 rows, 4 flagged RGV; `clusters.json` → 4 clusters. Reference-row isolation (`org_id IS NULL`, tenant SEES but cannot mutate) is enforced by `drizzle/0013_reference_policies_and_grants.sql`, proven in `tests/db/reference-rows.test.ts` (part of the 90/90 green run). All three geography kinds persist and round-trip (`sv_geo_kind_known` CHECK refuses a fourth), confirmed by reading `src/db/schema/searches.ts` and `tests/db/versioned-presets.test.ts`. |
| 2 | Before saving or running, the preset shows an estimated cost and an estimated result count; a Texas-wide preset is expressible and shows its cost multiplier | ✓ VERIFIED | `src/server/actions/estimate-preset.ts` (read in full) makes zero database writes and zero outbound requests — it computes purely from the seeded reference tables plus one read of the live budget row, confirmed by its own header comment and by `tests/unit/no-google-credential.test.ts` passing. `src/lib/estimate/estimate.ts:165` — `texasMultiplier()` is computed as `9144/612` from the real seeded cell counts (read directly), and `grep -n "38" src/lib/estimate/` (re-run by this verifier) finds no hardcoded multiplier literal. The `texas_254_counties` geo preset exists live in the database (see truth 1's probe). Cost-model unit tests (`cost model: the RGV baseline priced over the real seeded cell list`, `cost model: Texas exceeds the cap and says so`, `texas multiplier is computed, not a constant`) are part of this verifier's own 76/76 unit-test run. |
| 3 | Editing a preset creates a new version, and a past run still points at the version that produced it | ✓ VERIFIED | `src/server/actions/save-preset-version.ts` (read in full): every edit INSERTs a new `search_versions` row and moves `searches.current_version_id` in one transaction; the previously-documented `uuid[]` binding defect (deferred-items.md) is fixed with `sql.join` over one placeholder per id — confirmed present in the current file, not merely claimed. `search_versions` is immutable by GRANT (`drizzle/0013...sql`, `revoke update, delete`), and the column-level hole M12b found (`grant update (geo_payload)` surviving the table-level sentinel) is closed: `tests/db/grants-audit.test.ts` (read directly, lines ~285-310) now asserts `has_any_column_privilege('authenticated','public.search_versions','UPDATE')` is false. `runs.search_version_id` is outside the authenticated column grant (`on delete no action`), so a finished run cannot be silently re-pointed. All of this is part of this verifier's own 90/90 db-suite run, which includes `tests/db/versioned-presets.test.ts`'s `run keeps its version after the preset moves on`. Caveat: the browser-level check (`tests/e2e/preset-detail.spec.ts`) self-skips against the deployed target by danlo's own recorded 2026-09-22 decision, because its fixture seeds the local database while the deployed app reads production — the DB-level proof above is what CI actually runs on every push, and it is a stronger, mutation-checked proof of this exact claim than a browser click-through would be. |
| 4 | A spend view shows month-to-date spend versus the cap broken down by provider, fed by a ledger row per paid call | ✓ VERIFIED | `src/app/(app)/spend/page.tsx` (read in full) renders real reads from `src/server/queries/budget.ts` (`getCurrentPeriod`, `getSpendByProvider`, `getSpendByRun`), each a genuine `tx.execute(sql...)` against `budget_periods`/`cost_ledger` — no hardcoded or mocked data at any point in the chain. `cost_ledger`'s live schema (read from `drizzle/0014_brown_phantom_reporter.sql`) matches BUDG-01's external contract exactly: `{provider, sku, units, cost_cents (generated from micro_usd), run_id, lead_id}`, plus a `UNIQUE(request_id)` that backs idempotent settlement. `app.settle_reservation` (read from `drizzle/0016...sql`) uses `on conflict (request_id) do nothing` + `get diagnostics` to guarantee one row per paid call, including zero-cost free-allowance calls (`p_actual_micro = 0` is explicitly legitimate, documented in the function). Both settlement-idempotency and zero-cost-ledger-row db tests are in this verifier's own 90/90 run. A provider with no spend renders `$0.00 · no calls yet` rather than being hidden — confirmed by reading `src/components/spend/by-provider.tsx`'s calling code in `spend/page.tsx`. Production deployed URL confirmed live and matching the expected commit: `curl https://siteless-iota.vercel.app/api/health` → `{"ok":true,"db":"up","proxy":"up","commit":"6d6c52f..."}` (re-curled by this verifier). |
| 5a | With the cap reached, a concurrent burst of workers is refused at 100% (and warned at 80%) with no over-spend — proven by a concurrency test | ✓ VERIFIED | `drizzle/0016_budget_meter_functions.sql`'s `app.reserve_budget` (read in full) contains exactly ONE conditional `UPDATE ... WHERE spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd` with no preceding `SELECT` of a budget total — the single-statement shape that makes the race impossible under PostgreSQL READ COMMITTED, confirmed by reading the function body directly rather than trusting the comment. Denial is zero rows (no exception). `tests/db/budget-concurrency.test.ts` (read in full) opens 40 REAL `pg.Client` connections via `tests/db/_concurrency.ts`, issues a genuine concurrent burst against a cap that fits exactly 10, and asserts exactly 10 granted / 30 denied / `reserved == cap` / zero errors — this is a real commit-based test, not a mock, and it is part of this verifier's own 90/90 green db-suite run. The 80% warning path (`app.reserve_budget`'s `warned_80_at` guard, emitting exactly once via `app.emit_event`) and its UI (`src/components/app-shell/budget-banner.tsx`, read in full, wired into `src/app/(app)/layout.tsx` at line 102 — confirmed applied on every route under the `(app)` group) are both read directly and confirmed non-stub. |
| 5b | A Google Cloud per-API daily quota stands as an independent second wall | ⚠ PASSED (override) | Override: the GCP project and Places API (New) key do not exist yet (a real external dependency, not a code gap); BUDG-03 was carried as far as this phase can take it — derivation documented at `docs/runbooks/google-quota.md`, the second-wall card (`src/components/budget/second-wall-card.tsx`, read in full) renders the 100/day recommendation with an honest "this does not replace the meter" caveat, and `tests/unit/no-google-credential.test.ts` proves the rest of the phase has zero dependency on the key. REQUIREMENTS.md's own traceability table (line 76, re-read by this verifier) already marks BUDG-03 `Pending`, not `Complete` — accepted by danlo, 2026-09-22, carried to Phase 4. |

**Score:** 5/6 truths VERIFIED outright, 1/6 PASSED via a documented, user-accepted override — 6/6 overall.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `drizzle/0016_budget_meter_functions.sql` | The race-free meter: `reserve_budget`, `settle_reservation`, `set_budget_cap`, `ensure_budget_period`, `current_org_role` | ✓ VERIFIED | Read in full; single-conditional-UPDATE meter confirmed, `search_path` pinned on every DEFINER function, admin gate checked in SQL not just TS |
| `drizzle/0014_brown_phantom_reporter.sql` | `cost_ledger` table matching BUDG-01's external contract | ✓ VERIFIED | Read in full; columns match `{provider, sku, units, cost_cents, run_id, lead_id}` exactly, `UNIQUE(request_id)` present |
| `src/server/actions/save-preset-version.ts`, `duplicate-preset.ts` | Version-creating save path, duplicate-at-v1 path | ✓ VERIFIED | Both read in full; the previously-logged `uuid[]` binding defects (deferred-items.md) are fixed in the CURRENT files, confirmed by reading the fix, not the changelog |
| `src/server/queries/budget.ts` | Spend-by-provider, spend-by-run, current-period reads | ✓ VERIFIED | Read in full; the previously-logged `Date`-binding defect on `readSpendByRun` is fixed (`.toISOString()::timestamptz`), confirmed in the current file |
| `src/components/app-shell/budget-banner.tsx` | Persistent 80%/100% banner, every route | ✓ VERIFIED, WIRED | Read in full; mounted in `src/app/(app)/layout.tsx` line 102, inside the group layout every Phase-2+ screen renders under |
| `src/components/budget/second-wall-card.tsx` | BUDG-03 derivation card, no live Google dependency | ✓ VERIFIED | Read in full; static prose only, no credential read |
| `src/seed/data/{clusters,cities,counties,geo-presets,outlet-counts}.json` | Committed seed data | ✓ VERIFIED, LOADED | Parsed directly (4/17/254/3/20) AND confirmed present in the live local database by direct SQL |
| `tests/db/budget-concurrency.test.ts` | 40-way real-connection burst proof | ✓ VERIFIED | Read in full; genuine `pg.Client` connections, real commits, not `withRollback`; green in this verifier's own run |
| `tests/db/grants-audit.test.ts` | Column-level grant sentinel (M12b fix) | ✓ VERIFIED | Read directly; `has_any_column_privilege(...,'search_versions','UPDATE')` assertion present and green |
| `src/app/(app)/presets/*`, `spend/page.tsx`, `settings/budget/page.tsx` | All screens named in the plan | ✓ VERIFIED, EXIST | All 7 route files exist, substantive (79–402 lines each), no placeholder/stub content found by grep |
| `docs/runbooks/google-quota.md` | BUDG-03 console path + derivation | ✓ VERIFIED (exists) | Present per 02-14-SUMMARY and 02-VALIDATION.md; not independently re-read line-by-line but its existence and the card content it backs were confirmed |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/app/(app)/layout.tsx` | `BudgetBanner` | direct render, `period` prop from `getCurrentPeriod` | ✓ WIRED | Confirmed by direct read: import line 3, render line 102, one meter read per request above it |
| `src/server/actions/save-preset-version.ts` | `search_versions` table | `tx.execute(sql...)` insert with `sql.join`-bound array | ✓ WIRED | Confirmed by direct read; the array-binding fix is present, not merely referenced |
| `app.reserve_budget` | `app.emit_event` | 80% crossing, guarded once by `warned_80_at is null` | ✓ WIRED | Confirmed in `drizzle/0016...sql`; the guard is an UPDATE whose `found` gates the emit, not a duplicate-check read |
| `src/app/(app)/spend/page.tsx` | `cost_ledger` | `getSpendByProvider`/`getSpendByRun` → `tx.execute(sql...)` | ✓ WIRED, DATA FLOWS | Real SQL reads against real tables; `$0.00 · no calls yet` is a genuine empty-provider render path, not an omitted row |
| `tests/db/budget-concurrency.test.ts` | `app.reserve_budget` | 40 real `pg.Client` connections | ✓ WIRED | Confirmed genuine multi-connection test, not `withRollback` |

### Data-Flow Trace (Level 4)

- **Presets list (`/presets`)**: `listPresetCards(claims)` → real `withOrg` transaction → real SQL against `searches`/`search_versions`. Confirmed by reading `src/app/(app)/presets/page.tsx` and `src/server/queries/preset-cards.ts`; no hardcoded array.
- **Spend view (`/spend`)**: traced above — `getCurrentPeriod`/`getSpendByProvider`/`getSpendByRun` are three sequential real transactions, each opening and closing its own `withOrg` to avoid the documented connection-pool deadlock (`max: 1`). Confirmed by direct read of both the page and the query module.
- **Budget banner**: `period` prop sourced from `getCurrentPeriod` in the layout, a real read of `budget_periods`, not a static/default value. `at80`/`at100` computed with the same integer cross-multiplication the SQL uses (`committed * 100n >= cap * 80n`), documented specifically to avoid a TypeScript/SQL rounding mismatch.
- **Estimate panel**: `estimatePreset` server action computes purely from the seeded reference index and the live budget row — confirmed no paid call and no mocked estimate; live in the local database.

No hollow props or disconnected data sources found in any traced surface.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| `pnpm typecheck` | `tsc --noEmit` | exit 0, no output | ✓ PASS |
| `pnpm lint` | `eslint .` | exit 0, no output | ✓ PASS |
| `pnpm test:unit` (fresh, this verifier's run) | `vitest run tests/unit` | 19 files, 76/76 passed | ✓ PASS |
| `pnpm test:db` (fresh, this verifier's run, against real local `siteless_test`) | `vitest run --config vitest.db.config.ts` | 15 files, 90/90 passed | ✓ PASS |
| Seed data live in local database | direct SQL probe (see truth 1) | 4 clusters / 3 geo presets incl. Texas-wide / 254 counties / 20 outlet-count rows | ✓ PASS |
| Production health endpoint | `curl https://siteless-iota.vercel.app/api/health` | `{"ok":true,"db":"up","proxy":"up","commit":"6d6c52f..."}` | ✓ PASS |
| Deployed code matches current HEAD except test/lint-config files | `git diff --stat 6d6c52f HEAD -- . ':!docs' ':!.planning'` | 3 files changed, all in `tests/` or `eslint.config.mjs` — zero `src/` drift | ✓ PASS |
| `cost_ledger` schema matches BUDG-01 contract | direct read of `drizzle/0014...sql` | columns match `{provider, sku, units, cost_cents, run_id, lead_id}` | ✓ PASS |
| Concurrency test opens real connections, not mocked | direct read of `tests/db/budget-concurrency.test.ts` | confirmed `pg.Client`, `Promise.all`, real commits | ✓ PASS |

`pnpm test:e2e` was NOT re-run by this verifier (it targets the deployed production URL and would create additional `e2e-*` rows in production, compounding the already-tracked cleanup debt in `deferred-items.md`). The 15-passed/6-skipped/0-failed result from `02-15-SUMMARY.md` and `02-VALIDATION.md` is accepted as recorded evidence, corroborated independently by: (a) this verifier's own fresh, byte-identical unit/db suite runs: (b) direct reads of the six self-skipping tests' guard conditions, all of which name a real, verifiable precondition (zero production spend, cross-database fixture mismatch) rather than a hidden failure; and (c) the live production health check matching the exact commit the e2e run was recorded against.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SRCH-01 | 02-01, 02-03, 02-06, 02-07, 02-09, 02-11 | Define a search as clusters × geography, save as named preset | ✓ SATISFIED | Truth 1; live seed data; three geo kinds round-trip |
| SRCH-02 | 02-02, 02-03, 02-06, 02-11, 02-14 | Four clusters, RGV cities, RGV counties seeded; Texas-wide expressible with multiplier | ✓ SATISFIED | Truth 1 & 2; live probe of seeded rows |
| SRCH-03 | 02-03, 02-06, 02-09, 02-12, 02-15 | Presets versioned; past runs keep pointing at their version | ✓ SATISFIED | Truth 3; DB-level mutation-checked (M12, M12b) |
| SRCH-04 | 02-01, 02-04, 02-07, 02-09, 02-11, 02-12 | Estimated cost and result count before saving/running | ✓ SATISFIED | Truth 2; `estimate-preset.ts` read directly, no paid call |
| BUDG-01 | 02-04, 02-05, 02-07, 02-13, 02-14, 02-15 | Every paid call writes a ledger row `{provider,sku,units,cost_cents,run_id,lead_id?}` | ✓ SATISFIED (instrumentation) | Truth 4; `cost_ledger` schema matches contract exactly. Requirement text itself reads "instrumented before the first billable call" — no outbound paid call exists yet (Phase 4), so the claim is about the instrumentation existing and being idempotent/correct, which is proven. REQUIREMENTS.md marks it Complete. |
| BUDG-02 | 02-05, 02-08, 02-09, 02-10, 02-12, 02-13, 02-14, 02-15 | Atomic reserve→spend→true-up meter, refuses at 100%, warns at 80% | ✓ SATISFIED | Truth 5a; real 40-connection concurrency proof |
| BUDG-03 | 02-02, 02-13, 02-14, 02-15 | Google Cloud per-API daily quota as independent second wall | ⚠ PASSED (override) | Truth 5b; blocked on a GCP project that does not exist; REQUIREMENTS.md itself marks this Pending |
| BUDG-04 | 02-01, 02-10, 02-13, 02-15 | Spend view: MTD vs cap by provider | ✓ SATISFIED | Truth 4; real DB-backed spend view |

No orphaned requirements: every ID declared across the 15 plans' `requirements:` frontmatter matches BUDG-01..04 / SRCH-01..04, and REQUIREMENTS.md's traceability table (lines 195-202) lists exactly these eight against Phase 2, no more, no fewer.

### Anti-Patterns Found

None that rise to blocker or warning level. Grep sweeps for `TODO|FIXME|XXX|HACK|PLACEHOLDER`, `placeholder|coming soon|not yet implemented` (case-insensitive), `return null|return {}|return []|=> {}`, and `console.log` across `src/` turned up only: (a) legitimate HTML input `placeholder=` attributes, (b) a code comment explicitly documenting the ABSENCE of a placeholder state ("no placeholder anywhere in this file... the previous version of this route said so out loud"), and (c) ordinary null-guard early returns in query helper functions. Zero stub components, zero hardcoded empty arrays feeding a rendered list, zero `console.log`-only handlers.

### Human Verification Required

None outstanding. The items that would normally require human testing were already performed and recorded with independent provenance:
- **Design quality on all seven screens, both themes, two viewports** — danlo's verbatim `design: approved`, 2026-09-22, reviewing the deployed app directly (02-VALIDATION.md, Manual-Only Verifications).
- **The four deployed state-shot screenshots (80%/100% banner, refused-run drawer, assumptions drawer)** — explicitly deferred to Phase 4 by danlo's verbatim decision (`state shots: defer to Phase 4`), because production committed spend is $0 until Phase 4 calls Places, making the deployed states synthetic today. The equivalent LOCAL states were proven by this verifier reading `src/components/app-shell/budget-banner.tsx` directly (the `at80`/`at100` logic, the non-dismissible `Alert` with no close affordance, the icon+word+figures redundancy) rather than by re-capturing screenshots.
- **The Google Cloud quota console setting** — a real human action blocked on a project that does not exist; not something any agent can perform. Covered by the override above.

### Gaps Summary

No blocking gaps. One requirement (BUDG-03, "Google Cloud per-API daily quota as an independent second wall") cannot be fully satisfied because its precondition — a Google Cloud project and a Places API (New) key — does not exist yet. This is not a code defect or an oversight: every piece of BUDG-03 that CAN exist without that dependency does exist (the derivation, the runbook, the UI card, the proof that nothing in the phase reads a Google credential), and REQUIREMENTS.md's own traceability table already carries BUDG-03 as `Pending` rather than `Complete` — the phase's own bookkeeping is honest about this, not silently claiming completion. danlo recorded the acceptance verbatim on 2026-09-22 and it is carried forward as a named Phase 4 blocker. Applied here as a documented override rather than a gap requiring a closure plan.

Everything else — the atomic race-free meter (proven by a genuine 40-connection concurrency test, not a mock), the versioned presets (proven by mutation-checked DB tests reaching down to column-level grants), the seeded geography/cluster data (independently confirmed live in the local database by this verifier's own SQL), the live cost estimator (confirmed to make zero paid calls), and the spend view (confirmed to read real ledger data) — is genuinely built, genuinely tested, and genuinely deployed. The deployed production commit (`6d6c52f`) differs from current HEAD only by test files and an eslint config change; zero application-code drift exists between what was verified and what is live.

---

_Verified: 2026-09-22T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
