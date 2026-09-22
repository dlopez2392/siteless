---
phase: 2
slug: budget-governor-search-presets
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` § Validation Architecture (the requirement → test map, the six
> gate mutations and the Wave 0 gaps are copied from there verbatim). The **Per-Task Verification
> Map** is filled by `/gsd-plan-phase` once plan and task IDs exist; the executor updates **Status**
> only. Phase 1's `01-VALIDATION.md` is the format precedent, including how it was closed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (+ `vite@8.3.0`) for unit and DB-integration; `@playwright/test@1.63.0` for E2E |
| **Config file** | `vitest.config.ts` (TZ + locale pinned on line 1, `pool: 'forks'`) · `vitest.db.config.ts` (`pool: 'forks'`, `fileParallelism: false`, `isolate: false`, `.env.local` loaded) · `playwright.config.ts` (deployed URL only) |
| **Quick run command** | `pnpm test:unit` → `vitest run tests/unit` |
| **DB suite command** | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks` (as `app_user` against local PostgreSQL 18 via `TEST_DATABASE_URL`) |
| **Full suite command** | `pnpm verify` → typecheck + lint + unit + db + build — 🔴 **not runnable on this machine** (bare `pnpm` resolves to global 11.9.0; recorded since `01-01-SUMMARY` deviation 1). Run the five constituents individually through the pinned store launcher: `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs <script>` |
| **E2E command** | `pnpm test:e2e` → `playwright test` against `E2E_BASE_URL` (the **deployed** URL, never localhost) |
| **Estimated runtime** | unit < 10 s · db ~30–60 s (grows with the eight new tables) · constituents ~2–3 min · e2e ~2–3 min against the deployed URL |
| **Baseline at the Phase 1 gate** | unit **11** tests (4 files) · db **31** tests (9 files) · e2e **4** (3 specs + the auth setup) |

🔴 **Two harness changes this phase forces (from research):**

1. `vitest.db.config.ts` runs files serially in one process. The **concurrency proof (BUDG-02, success criterion 5) must open its own `pg.Client` connections** — it cannot use `withRollback`, which is one transaction and therefore cannot express two workers seeing each other's commits. It commits, and cleans up in `finally`; the cleanup **cannot delete an `orgs` row** (Pitfall 8), so it keys off a dedicated provider/period rather than a throwaway org.
2. Component tests need `environment: 'jsdom'` + `@vitejs/plugin-react`. `vitest.config.ts` already globs `**/*.test.tsx` but has neither — a `.test.tsx` fails on the JSX transform today. Add a jsdom lane for `*.test.tsx` **without** changing the node-environment default for `tests/unit/**/*.test.ts` (`suite-zone.test.ts` and `time.test.ts` depend on it).

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — **read the test name in the output**; a `-t` filter that matches nothing exits 0 green (Phase 1 lesson).
- **After every plan wave:** Run the five `verify` constituents individually through the store launcher.
- **Before `/gsd-verify-work`:** all constituents green, `pnpm test:e2e` green against the deployed URL, and the gate mutations M7–M12 below applied to the **live local database**, watched red by test NAME, reverted with `git diff --stat` empty.
- **Max feedback latency:** 60 seconds (unit + one DB filter).

---

## Requirement → Test Map (source for the per-task map)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| BUDG-02 | 40 concurrent reservations against a cap that fits 10 → exactly 10 granted, `reserved == cap`, 0 errors | DB (multi-conn) | `pnpm test:db -t "concurrent burst"` | ❌ Wave 0 |
| BUDG-02 | **Control:** the naive check-then-spend body over-spends under the same burst | DB (mutation M7) | applied to the live DB at the gate, `pg_get_functiondef` verified | ❌ Wave 0 |
| BUDG-02 | Denial is **zero rows**, not an exception | DB | `pnpm test:db -t "denied returns null"` | ❌ Wave 0 |
| BUDG-02 | `CHECK (spent+reserved<=cap)` refuses a hand-written over-reserve → `23514 bp_not_over` | DB | `pnpm test:db -t "bp_not_over"` | ❌ Wave 0 |
| BUDG-02 | Lowering the cap below `spent+reserved` → `23514`; to exactly `spent+reserved` → accepted | DB | `pnpm test:db -t "cap below"` | ❌ Wave 0 |
| BUDG-02 | A crashed worker's expired reservations are released by the next reserve | DB | `pnpm test:db -t "self-heal"` | ❌ Wave 0 |
| BUDG-02 | Non-admin cannot change the cap → `42501`; admin can (positive control) | DB | `pnpm test:db -t "set_budget_cap"` | ❌ Wave 0 |
| BUDG-02 | `o.rol` (v2, bare) **and** `org_role` (v1, prefixed) both resolve to `admin` | DB | `pnpm test:db -t "current_org_role"` | ❌ Wave 0 |
| BUDG-02 | 80 % crossing emits exactly one `events` row per period; 100 % refuses | DB | `pnpm test:db -t "threshold"` | ❌ Wave 0 |
| BUDG-01 | `settle()` twice with one `request_id` → one ledger row, one balance move | DB | `pnpm test:db -t "settlement idempotency"` | ❌ Wave 0 |
| BUDG-01 | `micro_usd 35000` renders `cost_cents 3.50`; 1,428 rows sum to `$49.98` | DB | `pnpm test:db -t "cost_cents"` | ❌ Wave 0 |
| BUDG-01 | `fieldMaskTier()` throws on an unknown field; each known field maps to its tier | unit | `pnpm test:unit -t "fieldMaskTier"` | ❌ Wave 0 |
| BUDG-01 | **Mutation:** appending `places.reviews` raises the tier **and** the ledger price | unit (mutation M11) | `pnpm test:unit -t "atmosphere"` | ❌ Wave 0 |
| BUDG-01 | `cost_ledger` carries **no** `log_event` trigger; `searches`/`search_versions`/`budget_periods` do (set equality both ways, `tgenabled` asserted) | DB | `pnpm test:db -t "after-row trigger"` | ✏️ extend `EVENT_LOGGED` |
| BUDG-03 | Nothing in `src/` reads a Google credential; no test requires the key | unit (grep) | `pnpm test:unit -t "no google credential"` | ❌ Wave 0 |
| BUDG-04 | Spend view renders MTD, per-provider rows (incl. `$0.00 · no calls yet`) and per-run rows | E2E | `pnpm test:e2e -g "spend"` | ❌ Wave 0 |
| BUDG-04 | ≥80 % renders the persistent banner on **every** route, not dismissible | E2E | `pnpm test:e2e -g "budget banner"` | ❌ Wave 0 |
| SRCH-01 | Preset saves with cities / county / radius; each round-trips | DB + E2E | `pnpm test:db -t "geo kind"` · `pnpm test:e2e -g "create preset"` | ❌ Wave 0 |
| SRCH-01 | Census parse: hit, empty `addressMatches`, 503 — all from msw fixtures | unit | `pnpm test:unit -t "census"` | ❌ Wave 0 |
| SRCH-01 | A non-TX match (`STATE !== '48'`) is rejected | unit | `pnpm test:unit -t "texas only"` | ❌ Wave 0 |
| SRCH-02 | Seed is idempotent: two runs, same row counts (`NULLS NOT DISTINCT` proves it) | DB | `pnpm test:db -t "seed idempotent"` | ❌ Wave 0 |
| SRCH-02 | A tenant **sees** built-ins; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501` | DB | `pnpm test:db -t "built-in"` | ❌ Wave 0 |
| SRCH-02 | All 254 TX counties seeded; `fips = 2*comptroller - 1` for every row | DB | `pnpm test:db -t "254 counties"` | ❌ Wave 0 |
| SRCH-02 | RGV cluster×county counts equal the measured matrix (1,452/5,572/977/15,977) | unit | `pnpm test:unit -t "outlet counts"` | ❌ Wave 0 |
| SRCH-03 | Saving an edit inserts a version and moves `current_version_id`; the old version survives | DB | `pnpm test:db -t "new version"` | ❌ Wave 0 |
| SRCH-03 | A run keeps pointing at its version after the preset moves on | DB | `pnpm test:db -t "run keeps its version"` | ❌ Wave 0 |
| SRCH-03 | `UPDATE`/`DELETE` on `search_versions` as `authenticated` → `42501 permission denied for table search_versions` (**message pinned**) | DB | `pnpm test:db -t "versions immutable"` | ❌ Wave 0 |
| SRCH-03 | Concurrent save of the same version number → `23505` | DB | `pnpm test:db -t "save conflict"` | ❌ Wave 0 |
| SRCH-04 | Committed cost-model test: real seeded cells, default schedule, monthly cost ≤ cap | unit | `pnpm test:unit -t "cost model"` | ❌ Wave 0 |
| SRCH-04 | Free allowance: 68 requests with 1,000 free remaining → **$0.00**; with 0 remaining → $2.38 | unit | `pnpm test:unit -t "free allowance"` | ❌ Wave 0 |
| SRCH-04 | Texas multiplier is computed from the two estimates, not a constant | unit | `pnpm test:unit -t "texas multiplier"` | ❌ Wave 0 |
| SRCH-04 | Out-of-order estimate responses: the newer value survives | component | `pnpm test:unit -t "stale estimate"` | ❌ Wave 0 |
| D-11 | One instant, two zones, opposite month verdicts (SQL **and** TS), plus the DST pair | DB + unit | `pnpm test:db -t "two zones"` · `pnpm test:unit -t "opposite"` | ✏️ extend Phase 1's |
| D-10 / FOUND-03 | A cap change writes an `events` row with actor + timestamp, from a raw SQL write | DB | `pnpm test:db -t "cap change is audited"` | ❌ Wave 0 |
| Phase 1 carry | Every new table is in `TENANT_TABLES`; live catalog equals the array | DB | `pnpm test:db -t "holds no"` | ✏️ extend |
| Phase 1 carry | Every new table has `org_id` + RLS + ≥1 policy; every timestamp is `timestamptz` | DB | `pnpm test:db -t "every public table"` | ✅ auto-covers |
| UI-SPEC R7 | `signed-in-as` / `org-id` / `org-row-id` resolve on `/settings/organization` | E2E | `pnpm test:e2e -g "org-scoped"` | ✏️ move spec |
| UI-SPEC R2/R8 | Computed accent is `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark, on the **built** app | E2E | `pnpm test:e2e -g "theme tokens"` | ❌ Wave 0 |
| UI-SPEC R9 | Primary controls ≥44×44 at 390×844 | E2E | `pnpm test:e2e -g "touch targets"` | ❌ Wave 0 |
| Pitfall 1 | `server_version_num >= 170000`; no `returning old.`/`new.`/`uuidv7(` in `drizzle/*.sql` | DB + unit (grep) | `pnpm test:db -t "server version"` · `pnpm test:unit -t "pg17"` | ❌ Wave 0 |

---

## Per-Task Verification Map

> Filled by `/gsd-plan-phase` from the plans' task IDs; every row above must map to at least one task.
> Threat Ref cites the plan's `<threat_model>` entry (T-2-NN) or `—`.
> `$PNPM` in every command below is the pinned store launcher: `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs` — bare `pnpm` is the wrong global version on this machine.

> **`$PNPM` below means the pinned store launcher, written out in full:**
> `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`
> Bare `pnpm` on this machine is the global 11.9.0 and dies before any script runs. `A→B` in Task ID means the test is written in A and turned green in B.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T3 | 02-01 | 1 | SRCH-04 | T-2-17 | a `.test.tsx` runs under jsdom while `*.test.ts` keeps `environment: node` and the main-process `TZ=UTC` pin | unit (jsdom) | `$PNPM test:unit -t "jsdom lane"` | ❌ W0 | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | the seeded RGV cluster×county matrix equals the live-measured 1452/5572/977/15977 and the grand totals 23978/552278 | unit | `$PNPM test:unit -t "outlet counts"` | ❌ W0 | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | all 254 TX counties seeded; `county_fips = 2 * comptroller_code - 1` for every row; exactly 4 are RGV | unit | `$PNPM test:unit -t "254 counties seeded"` | ❌ W0 | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | the 17-city list, its folded Rio Grande City total (843) and both coverage percentages (90.7 before folding, 90.9 after) | unit | `$PNPM test:unit -t "the RGV 17-city list"` | ❌ W0 | ⬜ pending |
| 02-02-T3 | 02-02 | 1 | BUDG-03 | T-2-15 | nothing under `src/` reads a Google credential; no test requires the key; the walker is proven non-empty | unit (grep) | `$PNPM test:unit -t "no google credential"` | ❌ W0 | ⬜ pending |
| 02-02-T3 | 02-02 | 1 | Pitfall 1 | — | no `returning old./new.`, `uuidv7(` or virtual generated column in `drizzle/*.sql`, with SQL comments stripped first and the stripper itself tested | unit (grep) | `$PNPM test:unit -t "pg17"` | ❌ W0 | ⬜ pending |
| 02-03-T3 | 02-03 | 1 | Phase 1 carry | T-2-10 | every new table is in `TENANT_TABLES` and the array equals the live catalog (13 after this plan) | DB | `$PNPM test:db -t "holds no"` | ✏️ extend | ⬜ pending |
| 02-03-T3 | 02-03 | 1 | Phase 1 carry | T-2-10 | every public table has `org_id` + RLS + ≥1 policy; every timestamp is `timestamptz`; `ALLOW_NO_ORG_ID` unchanged | DB | `$PNPM test:db -t "every public table"` | ✅ auto-covers | ⬜ pending |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | `fieldMaskTier()` throws on an unknown field and on an empty mask; each known field maps to its tier; `nextPageToken` does not raise it | unit | `$PNPM test:unit -t "fieldMaskTier"` | ❌ W0 | ⬜ pending |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | **M11 half 1:** appending `places.reviews` raises the tier to `ts_enterprise_atmosphere` | unit (mutation) | `$PNPM test:unit -t "atmosphere"` | ❌ W0 | ⬜ pending |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | **M11 half 2, independent:** the same append raises the ledger price 35,000,000 → 40,000,000 µUSD | unit (mutation) | `$PNPM test:unit -t "price book atmosphere"` | ❌ W0 | ⬜ pending |
| 02-04-T1 | 02-04 | 1 | SRCH-04 | — | free allowance: 68 requests cost $0.00 with 1,000 free, 2,380,000 µUSD with 0 free, 980,000 with 40 free | unit | `$PNPM test:unit -t "free allowance"` | ❌ W0 | ⬜ pending |
| 02-04-T2 | 02-04 | 1 | D-11 | — | one instant, two zones, opposite month verdicts in TypeScript; plus the CST month-edge pair and the CST/CDT reset-instant pair | unit | `$PNPM test:unit -t "opposite"` | ✏️ extend Phase 1's | ⬜ pending |
| 02-04-T2 | 02-04 | 1 | BUDG-01 | T-2-07 | `parseUsdToMicro` refuses negatives, non-numerics and >2 decimals; `formatUsd` pins the locale (spy) | unit | `$PNPM test:unit -t "money"` | ❌ W0 | ⬜ pending |
| 02-05-T1 | 02-05 | 2 | BUDG-01 | T-2-11 | `cost_ledger` and `cost_reservations` carry **no** `log_event` trigger; `searches`/`search_versions`/`budget_periods` do; set equality both ways, `tgenabled` asserted | DB | `$PNPM test:db -t "after-row trigger"` | ✏️ extend `EVENT_LOGGED` | ⬜ pending |
| 02-05-T1 | 02-05 | 2 | Phase 1 carry | T-2-10 | `TENANT_TABLES` widened to 16 and still equal to the live catalog | DB | `$PNPM test:db -t "holds no"` | ✏️ extend | ⬜ pending |
| 02-06-T1 | 02-06 | 2 | SRCH-02 | D-04 | `db:seed` is idempotent end to end; CI seeds between `db:migrate` and `test:db`; `--target=test` refuses a Supabase host | script | `$PNPM db:seed && $PNPM db:seed` | ❌ W0 | ⬜ pending |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | T-2-09 | a tenant SEES built-ins; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501 new row violates row-level security policy`; duplicate built-in → `23505` | DB | `$PNPM test:db -t "built-in"` | ❌ W0 | ⬜ pending |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | T-2-09 | a second upsert over the committed JSON changes no row count and no row id | DB | `$PNPM test:db -t "seed idempotent"` | ❌ W0 | ⬜ pending |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | — | all 254 counties live; the FIPS bijection holds for every row; `counties_fips_identity` refuses a counterexample with `23514` | DB | `$PNPM test:db -t "254 counties"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-01 | — | a preset round-trips through `cities`, `counties` and `radius`; a fourth kind is refused `23514 sv_geo_kind_known` | DB | `$PNPM test:db -t "geo kind"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | saving an edit inserts a version and moves `current_version_id`; version 1 survives unchanged | DB | `$PNPM test:db -t "new version"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | a run keeps pointing at its version after the preset moves on | DB | `$PNPM test:db -t "run keeps its version"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | UPDATE/DELETE on `search_versions` as `authenticated` → `42501 permission denied for table search_versions` (**message pinned**); INSERT still allowed | DB | `$PNPM test:db -t "versions immutable"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | — | a concurrent save of the same version number → `23505 search_versions_search_version_uniq` | DB | `$PNPM test:db -t "save conflict"` | ❌ W0 | ⬜ pending |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | `runs.search_version_id` cannot be re-pointed by `authenticated` (outside the column grant); a `status` update still succeeds | DB | `$PNPM test:db -t "re-pointed at a different version"` | ❌ W0 | ⬜ pending |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | T-2-08 | the committed cost model over the real seeded cell list: RGV 68 cells / 612 requestsHi / 21,420,000 µUSD at zero free; Texas 1016 cells / 9144 / 285,040,000 µUSD, above the cap | unit | `$PNPM test:unit -t "cost model"` | ❌ W0 | ⬜ pending |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | — | the Texas multiplier is computed as `9144 / 612` ≈ 14.9, and the literal `38` appears nowhere in `src/lib/estimate/` | unit | `$PNPM test:unit -t "texas multiplier"` | ❌ W0 | ⬜ pending |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | — | a city cell apportions from its county (McAllen × home_services = 275); a radius scales by the square of the radius ratio (155 at 10 mi) | unit | `$PNPM test:unit -t "estimate:"` | ❌ W0 | ⬜ pending |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | Census parse: McAllen hit, Rio Grande City hit, empty `addressMatches` → `no_match`, 503 → `unreachable`; axis order pinned by a sign assertion; msw errors on any unhandled request | unit (msw) | `$PNPM test:unit -t "census"` | ❌ W0 | ⬜ pending |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | a non-TX match (`STATE !== '48'`) is rejected, with the unmodified fixture as the positive control | unit | `$PNPM test:unit -t "texas only"` | ❌ W0 | ⬜ pending |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | the address is only ever a query parameter of a hard-coded host; an over-long or empty address never reaches the network | unit (msw) | `$PNPM test:unit -t "only ever a query parameter"` | ❌ W0 | ⬜ pending |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-04 | a denial is **zero rows**, not an exception; nothing throws and no reservation row is created | DB | `$PNPM test:db -t "denied returns null"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-07 | `CHECK (spent+reserved<=cap)` refuses a hand-written over-reserve → `23514 bp_not_over` | DB | `$PNPM test:db -t "bp_not_over"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-07 | lowering the cap below `spent+reserved` → `23514`; to exactly `spent+reserved` → accepted (positive control) | DB | `$PNPM test:db -t "cap below"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-06 | a crashed worker's expired reservations are released by the next reserve; a LIVE reservation is not | DB | `$PNPM test:db -t "self-heal"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-11 | the 80 % crossing emits exactly ONE `events` row per period (second reserve does not re-emit); 100 % refuses | DB | `$PNPM test:db -t "threshold"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | T-2-05 | `settle()` twice with one `request_id` → one ledger row, one balance move, `false` on the replay | DB | `$PNPM test:db -t "settlement idempotency"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | T-2-03 | a zero-cost paid-SKU call still writes a ledger row (`micro_usd 0`, `units 1`) — the free allowance is otherwise untrackable | DB | `$PNPM test:db -t "zero-cost paid-SKU"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | — | `micro_usd 35000` renders `cost_cents 3.50`; 1,428 rows sum to `$49.98` | DB | `$PNPM test:db -t "cost_cents"` | ❌ W0 | ✅ green |
| 02-08-T1 | 02-08 | 3 | Pitfall 1 | — | the test database reports `server_version_num >= 170000` | DB | `$PNPM test:db -t "server version"` | ❌ W0 | ✅ green |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | a non-admin cannot change the cap → `42501 set_budget_cap: admin role required`; an admin can (positive control) | DB | `$PNPM test:db -t "set_budget_cap"` | ❌ W0 | ✅ green |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | `o.rol` (v2, bare) **and** `org_role` (v1, prefixed) both resolve to `admin`; a member does not | DB | `$PNPM test:db -t "current_org_role"` | ❌ W0 | ✅ green |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | a direct `update budget_periods` as `authenticated` → `42501 permission denied for table budget_periods` — a DIFFERENT invariant from the role check | DB | `$PNPM test:db -t "no direct UPDATE"` | ❌ W0 | ✅ green |
| 02-08-T2 | 02-08 | 3 | D-10 / FOUND-03 | T-2-11 | a cap change writes an `events` row with actor + timestamp from a RAW SQL write; a reservation does NOT | DB | `$PNPM test:db -t "cap change is audited"` | ❌ W0 | ✅ green |
| 02-08-T2 | 02-08 | 3 | D-11 | — | one instant, two zones, opposite month verdicts in SQL; October's period begins 05:00Z and March's 06:00Z | DB | `$PNPM test:db -t "two zones"` | ✏️ extend Phase 1's | ✅ green |
| 02-08-T3 | 02-08 | 3 | BUDG-02 | T-2-04 | **criterion 5:** 40 concurrent reservations against a cap that fits 10 → exactly 10 granted, 30 denied, `reserved+spent == cap`, 0 errors; and the same under a crashed-worker fixture | DB (multi-conn) | `$PNPM test:db -t "concurrent burst"` | ❌ W0 (harness 02-02-T2) | ✅ green |
| 02-09-T3 | 02-09 | 3 | BUDG-02 | T-2-01 | every server action declares `'use server'` and calls `requireOrg()` BEFORE its first `withOrg(`; the walker is proven non-empty | unit (static) | `$PNPM test:unit -t "every server action"` | ❌ W0 | ⬜ pending |
| 02-10-T2 | 02-10 | 4 | BUDG-04 | D-12 | ≥80 % renders the persistent banner on **every** route and it is not dismissible; <80 % renders nothing | E2E | `$PNPM test:e2e -g "budget banner"` | ❌ W0 | ⬜ pending |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R7 | T-2-10 | `signed-in-as` / `org-id` / `org-row-id` resolve on `/settings/organization` | E2E | `$PNPM test:e2e -g "org-scoped"` | ✏️ move spec | ⬜ pending |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R2/R8 | — | computed accent `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark and the two backgrounds, on the **built** app, with `innerHeight > 0` asserted first | E2E | `$PNPM test:e2e -g "theme tokens"` | ❌ W0 | ⬜ pending |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R9 / MOB-01 | — | primary controls ≥44×44 at 390×844, with the viewport width asserted first | E2E | `$PNPM test:e2e -g "touch targets"` | ❌ W0 | ⬜ pending |
| 02-11-T3 | 02-11 | 5 | SRCH-01 | T-2-01 | a preset saves through all three geography modes from the UI and appears on `/presets` (spec written in Task 3) | E2E | `$PNPM test:e2e -g "create preset"` | ❌ W0 | ⬜ pending |
| 02-11-T3 | 02-11 | 5 | SRCH-04 | Pitfall 5 | two recomputes resolved OUT OF ORDER → the newer value survives; in-order control still paints; the previous value stays visible with `aria-busy` and no skeleton | component (jsdom) | `$PNPM test:unit -t "stale estimate"` | ❌ W0 | ⬜ pending |
| 02-12-T1 | 02-12 | 5 | SRCH-03 | — | the version diff reads as a sentence (`Added Auto & retail`, `Geography changed from County to Cities`), never a hash; unchanged items produce no clause | unit | `$PNPM test:unit -t "version diff"` | ❌ W0 | ⬜ pending |
| 02-12-T2 | 02-12 | 5 | SRCH-03 / BUDG-02 | T-2-12 | an edit shows two versions and the run keeps the old one; duplicate creates a new preset at version 1; Run queues a run | E2E | `$PNPM test:e2e -g "preset detail"` | ❌ W0 | ⬜ pending |
| 02-13-T1 | 02-13 | 5 | BUDG-04 | — | the spend view renders MTD, the gauge, and per-provider rows including `$0.00 · no calls yet`, plus per-run rows | E2E | `$PNPM test:e2e -g "spend"` | ❌ W0 | ⬜ pending |
| 02-13-T2 | 02-13 | 5 | BUDG-03 | T-2-15 | the second-wall card renders the 100/day recommendation and its derivation with NO Google credential anywhere in `src/` | unit (grep, re-run) | `$PNPM test:unit -t "no google credential"` | ✅ 02-02-T3 | ⬜ pending |
| 02-14-T2 | 02-14 | 6 | BUDG-01/02, SRCH-02 | T-2-03, T-2-12 | production carries the same twelve tables, five functions, named constraints and grants as local; `search_versions` insert-only, budget tables select-only, `runs.search_version_id` not updatable — read from `information_schema`, not inferred | script + manual | `$PNPM db:migrate:prod && $PNPM db:seed:prod` | ❌ W0 | ⬜ pending |
| 02-14-T3 | 02-14 | 6 | BUDG-03 | T-2-15 | the Google Cloud daily quota is set at 100 requests/day, or recorded as blocked on a project that does not exist — and nothing in `src/` depends on the key | manual (checkpoint) | see Manual-Only below | ❌ W0 | ⬜ pending |
| 02-15-T1 | 02-15 | 7 | all 8 | T-2-01 | the whole e2e suite green against the **deployed** URL of a verified commit; signed-out `/presets`, `/spend`, `/settings/budget` all redirect and leak no `org-id` | E2E | `$PNPM test:e2e` | ✅ (all specs) | ⬜ pending |
| 02-15-T2 | 02-15 | 7 | UI-SPEC | — | danlo reviewed all seven screens on the deployed app, both themes, 390×844 and 1280×800, plus the four state shots | manual (checkpoint) | see Manual-Only below | — | ⬜ pending |
| 02-15-T3 | 02-15 | 7 | BUDG-01/02, SRCH-03 | T-2-02…T-2-12 | gate mutations **M7–M12** applied to the live local database, each reding exactly the predicted named test, direction-checked, reverted and verified from the catalog | gate (mutation) | see Phase-Gate Mutations below | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Phase-Gate Mutations (M7–M12, continuing Phase 1's numbering)

| # | Mutation on the live local DB | Must red — exactly |
|---|---|---|
| M7 | Replace `app.reserve_budget`'s conditional `UPDATE` with a `SELECT`-then-`UPDATE` | `concurrent burst` only. The single-worker tests stay green — which is the point. |
| M8 | `alter table budget_periods drop constraint bp_not_over` | `bp_not_over` + `cap below current spend`; the positive control (raising the cap) stays green |
| M9 | `alter table cost_ledger drop constraint cost_ledger_request_id_key` | `settlement idempotency` only |
| M10 | `create or replace function app.current_org_role()` returning the literal `'admin'` | `set_budget_cap refuses a member` only; the admin positive control stays green |
| M11 | Append `places.reviews` to the production field mask constant | `fieldMaskTier atmosphere` **and** the ledger-price test — two, and they are independent |
| M12 | `grant update on public.search_versions to authenticated` | `versions immutable` only; `run keeps its version` stays green |

Each per CONVENTIONS § Testing: watched failing first, SQLSTATE **and** constraint name pinned, message pinned where two invariants share `42501`, one refused statement per rolled-back transaction, a positive control beside every refusal, and every test's **name** read in the output.

### Executed at plan 02-08 — two of the predictions above are wrong, and here is what happened

| # | Predicted | **Measured** (live local DB, 2026-09-22) |
|---|---|---|
| M7 | over-spend: granted 40 of 40, reserved 400 | 🔴 **Only with `bp_not_over` ALSO dropped** (granted 37, reserved 370). With the constraint standing, the naive body granted 10 and raised `23514` for the other 30 — the second wall converts the race into 30 crashed workers rather than an over-spend. Both configurations red all three `concurrent burst` tests and leave **every** single-worker test green (87 passed). M7 must be applied SURGICALLY (swap only the conditional UPDATE): a whole-body rewrite also reds `self-heal` and `threshold`, which proves only that the rewrite deleted them. |
| M9 | `settlement idempotency` only | 🔴 **Reds FOUR tests.** The UNIQUE index is the arbiter of `on conflict (request_id)`, so dropping it makes every settlement raise `42P10` — the three other settlement tests fail before reaching their own assertion. Use **M9b** for a one-test result: keep the index, delete only the `on conflict … do nothing` clause from `app.settle_reservation`, and a replay raises `23505` while everything else stays green. |
| M8 · M10 | as predicted | ✅ M8 reds `bp_not_over refuses a hand-written over-reserve` + `cap below current spend is refused`, control green. M10 reds `set_budget_cap refuses a member` + `current_org_role returns null for a member` (two independent properties — the gate and the resolver, exactly as Phase 1's M3/M5), control green. |
| MGRANT | — (new) | `grant update on public.budget_periods to authenticated` reds `budget_periods holds no direct UPDATE for authenticated` **and** 02-05's `authenticated holds exactly the DML each Phase 2 table needs`, and NOT the role check — the two cap refusals rest on different invariants. |

🔴 **Reverting a function from the migration file must normalise CRLF first.** The files are checked out with Windows line endings while the migrator fed PostgreSQL LF-only text, so a straight re-create stores a semantically identical body that differs from `pg_get_functiondef` by one `\r` per line — and the revert then cannot be proven.

---

## Wave 0 Requirements

Each item now carries the plan and task that owns it. "Wave 0" is realised as plans **02-01** through **02-04**, all in wave 1, because the framework install, the seed data, the schema and the pure cost model have no dependencies on one another and only 02-03 touches the database.

- [ ] `vitest.config.ts` — a jsdom lane for `**/*.test.tsx` + `@vitejs/plugin-react`, **without** changing the node default for `*.test.ts` — **02-01 T3** (preferred: vitest 5 `test.projects`; documented fallback: `vitest.dom.config.ts`)
- [ ] `tests/unit/_setup-dom.ts` — `@testing-library/jest-dom` matchers — **02-01 T3**
- [ ] `tests/db/_concurrency.ts` — `openTestClient()` / `openTestClients()` / `closeAll()` / `withCommittedFixture()`, refusing a Supabase host, **not** built on `withRollback`, never deleting an `orgs` row — **02-02 T2**
- [ ] `tests/unit/msw/` — recorded Census fixtures (McAllen hit, Rio Grande City hit, empty `addressMatches`, 503) — **02-02 T2**; the `server.ts` that replays them — **02-07 T2** (it imports `msw`, which 02-01 installs)
- [ ] `tests/unit/fixtures/preset.ts` — the `PresetSpec` fixtures shared by the estimator and the component tests, derived FROM the seed JSON rather than restating it — **02-02 T2**
- [ ] `src/seed/data/*.json` — clusters, 17 cities, 4+254 counties, outlet counts, geo presets, all committed before any test reads them — **02-02 T1**
- [ ] `tests/db/grants-audit.test.ts` — `TENANT_TABLES` extended to 13 — **02-03 T3** — then to 16 — **02-05 T1**
- [ ] `tests/db/event-trigger.test.ts` — `EVENT_LOGGED` extended to 4 — **02-03 T3** — then to 5 — **02-05 T1**; **deliberately excluding** `cost_ledger`, `cost_reservations`, `runs` and every reference table
- [ ] `eslint-plugin-react-hooks` — the current config has no React rules at all and this is the first phase with hooks — **02-01 T3**
- [ ] Framework install — Tailwind 4.3.3, shadcn 4.21.0 init + 33 components, `@testing-library/*`, `msw`, `jsdom`, `@vitejs/plugin-react`, all pinned exactly — **02-01 T1 and T3**

> 🔴 **The [BLOCKING] schema push.** `pnpm build` and `pnpm typecheck` pass WITHOUT a migration having been applied, because Drizzle's types come from the schema files and not from the live database. That is a false-positive verification state. Every wave that adds schema therefore ends with a blocking `db:generate` → `db:custom` → `db:migrate` → `test:db` task: **02-03 T2/T3** for the nine search and reference tables, **02-05 T1/T2** for the three budget tables and the five functions, and **02-14 T2** for production.

---

## Manual-Only Verifications

| Behavior | Requirement | Plan / Task | Why Manual | Test Instructions |
|----------|-------------|-------------|------------|-------------------|
| Google Cloud per-API daily quota set on Places API (New) | BUDG-03 | **02-14 T3** (`checkpoint:human-action`) | The GCP project and the Places key do not exist; setting a console quota is a human action | Follow `docs/runbooks/google-quota.md` (written in the same task) — the console path, the derivation to 100/day, and the honesty line that 100/day × 30 = $70/month, ABOVE the cap. Record the value and a screenshot in the SUMMARY. 🔴 The app must not depend on the key to pass any test — `tests/unit/no-google-credential.test.ts` enforces that, so `blocked` is an acceptable answer and blocks nothing in Phase 2. |
| Visual quality of the seven screens in both themes | UI-SPEC (the design bar) | **02-15 T2** (`checkpoint:human-verify`) | Computed-style probes prove the tokens shipped, not that the screens meet the bar | Screenshot every screen on the **deployed** app at 390×844 and 1280×800 in light and dark — 28 base images plus four state shots (80 % banner, 100 % banner, refused run drawer, assumptions drawer). danlo reviews against `02-UI-SPEC.md` § Screen Inventory before merge. Assert `window.innerHeight > 0` before capture; a hidden window makes every measurement lie. |
| The RGV 17-city list is the one Phase 3 will ingest against | SRCH-02 | **02-02 T1** (flagged) → **02-14 T2** (confirmed) | It is a product call, not a data one: the measured threshold leaves Willacy County unrepresented among cities | The seed JSON documents the rule, both coverage percentages and the next five candidates. danlo answers `17 as measured` or `add Raymondville` at the 02-14 checkpoint. 🔴 This is the Phase 2 ∥ Phase 3 shared contract and must be settled before Phase 3 runs. |
| Vercel plan is Pro | — (Phase 9 dependency) | **02-14 T3** | Research could not verify it — `vercel teams ls` returned an invalid token | Confirm in the Vercel dashboard. Blocks nothing in Phase 2; Hobby's once-a-day ±59-minute cron is what would block the Phase 9 scheduler. Pro's ~$20/mo is infrastructure and is never merged into the $50 data cap. |
| danlo signs in on the deployed URL and every new route is org-scoped | criterion 1 carried forward | **02-15 T1 and T2** | Requires a human Clerk sign-in with an email code | The e2e suite covers the automated half against the deployed URL; danlo's own sign-in on a phone is the other half and is recorded verbatim in the 02-15 SUMMARY. |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or an explicit Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references (see the plan/task attribution above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] Gate mutations **M7–M12** recorded **as run**, each reverted and diffed back, each direction-checked; any mutation reding two tests carries a proof of independence (Phase 1's standing lesson from M1, M3 and M5)
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete: true` set in frontmatter

**Approval:** pending — closed by **02-15 T3**.
