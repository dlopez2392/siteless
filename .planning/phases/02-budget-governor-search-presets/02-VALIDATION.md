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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending planner_ | | | | | | | | | ⬜ pending |

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

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — a jsdom lane for `**/*.test.tsx` + `@vitejs/plugin-react`, **without** changing the node default for `*.test.ts`
- [ ] `tests/unit/_setup-dom.ts` — `@testing-library/jest-dom` matchers
- [ ] `tests/db/_concurrency.ts` — an `openTestClient()` helper that opens N real connections against `TEST_DATABASE_URL` (refusing a Supabase host, like `withRollback` does) and tears them down in `finally`; **not** built on `withRollback`
- [ ] `tests/unit/msw/` — `server.ts` + recorded Census fixtures (McAllen hit, Rio Grande City hit, empty `addressMatches`, 503)
- [ ] `tests/unit/fixtures/preset.ts` — a `PresetSpec` fixture shared by the estimator and component tests
- [ ] `src/seed/data/*.json` — clusters, 17 cities, 4+254 counties, outlet counts — committed before any test that reads them
- [ ] `tests/db/grants-audit.test.ts` — extend `TENANT_TABLES` with all eight new tables (test 1 asserts the array equals the live catalog, so forgetting is red)
- [ ] `tests/db/event-trigger.test.ts` — extend `EVENT_LOGGED` with `searches`, `search_versions`, `budget_periods`; **deliberately exclude** `cost_ledger`, `cost_reservations`
- [ ] `eslint-plugin-react-hooks` (or `eslint-config-next`) — the current config has no React rules at all, and this is the first phase with hooks
- [ ] Framework install — Tailwind 4.3.3, shadcn 4.21.0 init + components, `@testing-library/*`, `msw`, `jsdom` (see `02-RESEARCH.md` § Standard Stack and `02-UI-SPEC.md` § Components)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Google Cloud per-API daily quota set on Places API (New) | BUDG-03 | The GCP project and key do not exist; setting a console quota is a human action (`checkpoint:human-action`) | Follow the console path in `02-RESEARCH.md` § The Second Wall; record the quota value and a screenshot in the plan's SUMMARY; the app must not depend on the key to pass tests |
| Visual quality of the seven screens in both themes | UI-SPEC (design bar) | Computed-style probes prove tokens shipped, not that the screens meet the bar | Screenshot every screen on the **built** app at 390×844 and 1280×800 in light and dark; danlo reviews against `02-UI-SPEC.md` § Screen Inventory before merge |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
