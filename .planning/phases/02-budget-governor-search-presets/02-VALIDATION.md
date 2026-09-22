---
phase: 2
slug: budget-governor-search-presets
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-22
updated: 2026-09-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` § Validation Architecture (the requirement → test map, the six
> gate mutations and the Wave 0 gaps are copied from there verbatim). Phase 1's
> `01-VALIDATION.md` is the format precedent, including how it was closed.
>
> **Closed by `02-15` Task 3 on 2026-09-22.** Every Status below is recorded from a run that
> was read by test NAME, not by exit code, and each cites the SUMMARY that ran it. Every
> mutation in the M7–M12 table was applied to the **live local database** during this plan,
> re-verified rather than copied forward, direction-checked, reverted, and the revert proven
> from the catalog against a capture taken before any mutation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (+ `vite@8.3.0`) for unit and DB-integration; `@playwright/test@1.63.0` for E2E |
| **Config file** | `vitest.config.ts` (TZ + locale pinned on line 1, `pool: 'forks'`, jsdom lane for `*.test.tsx`) · `vitest.db.config.ts` (`pool: 'forks'`, `fileParallelism: false`, `isolate: false`, `.env.local` loaded) · `playwright.config.ts` (deployed URL only) |
| **Quick run command** | `pnpm test:unit` → `vitest run tests/unit` |
| **DB suite command** | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks` (as `app_user` against local PostgreSQL 18.6 via `TEST_DATABASE_URL`) |
| **Full suite command** | `pnpm verify` → typecheck + lint + unit + db + build — 🔴 **not runnable on this machine** (bare `pnpm` resolves to global 11.9.0; recorded since `01-01-SUMMARY` deviation 1). Run the five constituents individually through the pinned store launcher: `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs <script>` |
| **E2E command** | `pnpm test:e2e` → `playwright test` against `E2E_BASE_URL` (the **deployed** URL, never localhost) |
| **Measured runtime at the gate** | unit **7.2 s** · db **11.7 s** · lint ~40 s · typecheck ~25 s · build ~90 s · e2e **43.2 s** against the deployed URL |
| **Baseline at the Phase 1 gate** | unit **11** tests (4 files) · db **31** tests (9 files) · e2e **4** (3 specs + the auth setup) |

### Final suite sizes at the Phase 2 gate, against the Phase 1 baseline

| Suite | Phase 1 gate | Phase 2 gate | Growth | Read from |
|---|---|---|---|---|
| unit | 11 tests, 4 files | **76 tests, 19 files** | ×6.9 | `test:unit` on `98d99ff`, all 76 green |
| db | 31 tests, 9 files | **90 tests, 15 files** | ×2.9 | `test:db` on `98d99ff`, all 90 green |
| e2e | 4 (3 specs + setup) | **21 (20 spec tests in 8 spec files + the auth setup)** | ×5.25 | `test:e2e` against `https://siteless-iota.vercel.app` — **15 passed, 6 skipped, 0 failed** |

🔴 **The six e2e skips are self-skips with recorded reasons, not failures, and a skip reads
the same as a pass in a summary line — so each is named here rather than counted.**

| Skipped test | Why it skips | When it stops skipping |
|---|---|---|
| `budget banner: renders on every route at 80 percent` | Asserts against **committed** spend, and production spend is $0 until anything calls Places | Phase 4 |
| `budget banner: is not dismissible` | Same precondition | Phase 4 |
| `spend: the by-run tab lists a queued run` | Its own precondition — no run exists on the deployed tenant | Phase 4 |
| `preset detail: a saved edit shows two versions and the run keeps the old one` | The fixture seeds the **local** database while the app under test is the deployed one — see M12 / SRCH-03 below and `deferred-items.md`. danlo's decision, 2026-09-22 | when a local target is used, today (all three run green there) |
| `preset detail: duplicate creates a new preset at version 1` | Same | Same |
| `preset detail: run this preset queues a run` | Same | Same |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit` plus the single `-t "<name>"` filter for the test that task made green — **read the test name in the output**; a `-t` filter that matches nothing exits 0 green (Phase 1 lesson, and it bit this plan twice: once when an M11 anchor failed to match under CRLF and the suite ran unmutated, once when M8b's DDL aborted and the suite ran under M8 while the log said M8b. Both were caught by reading the red set, not the exit code).
- **After every plan wave:** Run the five `verify` constituents individually through the store launcher.
- **Before `/gsd-verify-work`:** all constituents green, `pnpm test:e2e` green against the deployed URL, and the gate mutations M7–M12 below applied to the **live local database**, watched red by test NAME, reverted with `git diff --stat` empty.
- **Max feedback latency:** 60 seconds (unit + one DB filter).

---

## Phase-Gate Mutations M7–M12 — **as run**, not as planned

Every mutation below was applied during **plan 02-15 Task 3** to the live local
`siteless_test` (PostgreSQL 18.6), never to a migration file, so each revert is provable by
construction. The suite was run, the failing test **names** read, the mutation reverted, and
the revert verified from `pg_get_functiondef` / `pg_constraint` / `pg_indexes` /
`information_schema.role_table_grants` compared **byte-for-byte against a capture taken
before any mutation** (`reserve_budget` 5249 chars / 0 CR, `settle_reservation` 3103 / 0 CR,
`current_org_role` 287 / 0 CR — the same lengths 02-08 recorded, which is itself a check
that the database had not drifted between the two plans). `git diff --stat` was empty after
every DB mutation.

Where the planned recipe and the executed recipe differ, **the executed one is
authoritative** and the correction is recorded.

| # | Mutation, **as actually run** | The test(s) that went red, by NAME | Direction check | Suite | Recorded in |
|---|---|---|---|---|---|
| **M7** | **SURGICAL.** Only step 2 of `app.reserve_budget` — the single conditional UPDATE — replaced by `SELECT` → decide in plpgsql → unconditional `UPDATE`. A whole-body rewrite is **wrong**: 02-08 recorded that it also reds `self-heal` and `threshold`, which proves only that the rewrite deleted them. | `concurrent burst: 40 workers against a cap that fits 10`, `concurrent burst: open reservations equal the grants`, `concurrent burst survives a crashed worker holding the whole cap` — **exactly three**, 3 failed / **87 passed** | **This IS the direction check.** Every single-worker test stayed green, which is the property that proves the concurrency file is not redundant with `budget-meter.test.ts`. | 90 | 02-08 · **re-verified 02-15 T3** |
| **M7 + M8** | Both walls down — the control that reproduces RESEARCH's over-spend | the same three | `granted=34 denied=6 errors=0 reserved=340` against a cap of **100** — a **3.4× over-spend**, zero errors (02-08 measured 37/370; the exact number is scheduling-dependent, the over-spend is not) | 90 | **02-15 T3** |
| **M8** | `alter table budget_periods drop constraint bp_not_over` — as written | `bp_not_over refuses a hand-written over-reserve`, `cap below current spend is refused` — **two**, 2 failed / 88 passed | `cap at exactly spent plus reserved is accepted` ✓ **green by name** under the mutation (run with `-t`, the name read) — the boundary-exact positive control | 90 | 02-08 · **re-verified 02-15 T3** |
| **M8b** | The narrower mutation demanded by the standing lesson: keep the constraint, drop `spent` from the sum — `check (reserved_micro_usd <= cap_micro_usd)` | `cap below current spend is refused` — **exactly one**, 1 failed / 89 passed | `bp_not_over refuses a hand-written over-reserve` ✓ **green by name** | 90 | **02-15 T3** |
| **M9** | `alter table cost_ledger drop constraint cost_ledger_request_id_key` — as written | **FOUR**, not the one the map predicted: `settlement idempotency: settle twice with one request_id`, `settlement: reserve the worst case, settle the actual`, `settlement: a zero-cost paid-SKU call still writes a ledger row`, `cost_cents renders micro-USD exactly` | The UNIQUE index is the arbiter of `on conflict (request_id)`, so without it every settlement raises `42P10` and three tests fail before reaching their own assertion. Not a coupling to fix — a dependency to record. | 90 | 02-08 · **re-verified 02-15 T3** |
| **M9b** | The one-test discriminator: keep the index, delete **only** the `on conflict (request_id) do nothing` clause from `app.settle_reservation` | `settlement idempotency: settle twice with one request_id` — **exactly one**, 1 failed / 89 passed, the replay raising `duplicate key value violates unique constraint "cost_ledger_request_id_key"` | the other three settlement tests stayed green | 90 | 02-08 · **re-verified 02-15 T3** |
| **M10** | `create or replace function app.current_org_role()` returning the literal `'admin'` | **TWO**, as 02-08 recorded: `current_org_role returns null for a member` and `set_budget_cap refuses a member` | `set_budget_cap accepts an admin` ✓ **green by name** under the mutation — so the gate is not "working" by refusing everything | 90 | 02-08 · **re-verified 02-15 T3** |
| **M10b** | The independence probe, in the **other direction**: resolver left byte-identical to the capture, and the four-line admin gate deleted from `app.set_budget_cap` | `set_budget_cap refuses a member` — **exactly one**, 1 failed / 89 passed | proves the two reds are **independent properties** (the gate and the resolver), Phase 1's M3/M5 shape, rather than two views of one object | 90 | **02-15 T3** |
| **M11** | Append `places.reviews` to `PLACES_TEXT_SEARCH_FIELD_MASK` in `src/lib/budget/field-mask-tier.ts` — the one **source** mutation, applied to the committed file so `git diff -U0` shows the `+` line | `fieldMaskTier atmosphere: appending places.reviews raises the tier` **and** `price book atmosphere: the ledger price follows the mask` — **two, in two different files**, 2 failed / 74 passed | 🔴 The first attempt matched no anchor (the file is CRLF) and **the suite ran unmutated and green**. Caught by reading the red set, which was empty. Recorded because it is the exact failure mode the "read the NAME" rule exists for. | 76 | 02-04 · **re-verified 02-15 T3** |
| **M11b** | The independence probe: mask left **unmutated**, `PRICE_BOOK.ts_enterprise_atmosphere.microUsdPerRequest` 40000 → 35000 | `price book atmosphere: the ledger price follows the mask` — **exactly one**, 1 failed / 75 passed | `fieldMaskTier atmosphere` ✓ green — so the two halves rest on **different objects** (the tier function and the price book) and share no assertion. Independence **proven**, not argued. | 76 | **02-15 T3** |
| **M12** | `grant update on public.search_versions to authenticated` | 🔴 **TWO against the full suite**, not the one 02-06 recorded: `versions immutable: UPDATE as authenticated is refused` **and** `authenticated holds exactly the DML each Phase 2 table needs`. 02-06 ran only its own 12-test file, before 02-05's grants sentinel covered this table. | `run keeps its version after the preset moves on` ✓ **green by name** under the mutation, as the plan required | 90 | 02-06 · **corrected and re-verified 02-15 T3** |
| **M12-delete** | The companion `grant delete on public.search_versions to authenticated` | `versions immutable: DELETE as authenticated is refused` + the same sentinel — and **not** the UPDATE test | confirms UPDATE and DELETE rest on **separate grants** rather than sharing one refusal | 90 | 02-06 · re-verified 02-15 T3 |
| **M12b** | 🔴 **The mutation that SURVIVED, and the defect it found.** `grant update (geo_payload) on public.search_versions to authenticated` — a **column-level** grant | **NOTHING. 90 passed.** See below. | — | 90 | **02-15 T3** |

### M12b — the surviving mutation, and the guard that now kills it

`grant update (geo_payload) on public.search_versions to authenticated` left the **entire
90-test suite green** while `has_column_privilege('authenticated','public.search_versions',
'geo_payload','UPDATE')` read **TRUE**. A tenant could have rewritten a stored version's
geography — precisely what SRCH-03 and T-2-12 forbid — and nothing would have noticed:

- the table-level row stayed `[t,t,f,f]` because `has_table_privilege` is **blind to column
  grants**, and
- `versions immutable: UPDATE as authenticated is refused` stayed green because it updates
  `geo_kind`, a column the grant did not name.

The standing question when a mutation survives is *what else is already doing the job*, not
*strengthen the test*. The answer here was **nothing** — and the sentinel already carried
exactly this check for `budget_periods`, `cost_reservations`, `cost_ledger` and `runs`, with
its own comment explaining why. It simply never covered `search_versions`. Extended there
(commit `98d99ff`), and watched **both ways**: green against the real grants, red under M12b,
green again after the revoke.

A first version of that assertion also carried an `sv_any_delete` companion. It was written,
**watched red**, and removed: PostgreSQL has no column-level DELETE, and
`has_any_column_privilege(...,'DELETE')` does not return false — it raises
`unrecognized privilege type: "DELETE"` and takes the whole test down with it. The reason is
recorded in the test so it is not re-added.

### The standing lesson, carried forward from Phase 1 and re-earned here

A mutation must be checked for **direction** — a guard that fails *closed* is
indistinguishable from a working guard by exit code alone. A mutation that reds **two** tests
is acceptable only when the two properties are proven independent (M10/M10b, M11/M11b here;
M3/M5 in Phase 1). And **a mutation that reds nothing is the most informative result of all**
(M12b): it is the only kind that finds a guard nobody wrote.

Two new corollaries this plan paid for, both about the mutation never actually being applied:

1. **A source mutation that silently matches no anchor produces a green suite that looks like
   a surviving mutation.** M11's first attempt. The file is CRLF; the anchor was LF.
2. **A DDL mutation that aborts leaves the PREVIOUS mutation in place, and the run then
   reports the previous mutation's red set under the new one's name.** M8b's first attempt
   died on `42704` because M8 had already dropped the constraint.

Both were caught by reading the red set against the prediction. Neither would have been
caught by an exit code.

---

## Requirement → Test Map (source for the per-task map)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| BUDG-02 | 40 concurrent reservations against a cap that fits 10 → exactly 10 granted, `reserved == cap`, 0 errors | DB (multi-conn) | `pnpm test:db -t "concurrent burst"` | ✅ 02-08 |
| BUDG-02 | **Control:** the naive check-then-spend body over-spends under the same burst | DB (mutation M7) | applied to the live DB at the gate, `pg_get_functiondef` verified | ✅ 02-08 / 02-15 |
| BUDG-02 | Denial is **zero rows**, not an exception | DB | `pnpm test:db -t "denied returns null"` | ✅ 02-08 |
| BUDG-02 | `CHECK (spent+reserved<=cap)` refuses a hand-written over-reserve → `23514 bp_not_over` | DB | `pnpm test:db -t "bp_not_over"` | ✅ 02-08 |
| BUDG-02 | Lowering the cap below `spent+reserved` → `23514`; to exactly `spent+reserved` → accepted | DB | `pnpm test:db -t "cap below"` | ✅ 02-08 |
| BUDG-02 | A crashed worker's expired reservations are released by the next reserve | DB | `pnpm test:db -t "self-heal"` | ✅ 02-08 |
| BUDG-02 | Non-admin cannot change the cap → `42501`; admin can (positive control) | DB | `pnpm test:db -t "set_budget_cap"` | ✅ 02-08 |
| BUDG-02 | `o.rol` (v2, bare) **and** `org_role` (v1, prefixed) both resolve to `admin` | DB | `pnpm test:db -t "current_org_role"` | ✅ 02-08 |
| BUDG-02 | 80 % crossing emits exactly one `events` row per period; 100 % refuses | DB | `pnpm test:db -t "threshold"` | ✅ 02-08 |
| BUDG-01 | `settle()` twice with one `request_id` → one ledger row, one balance move | DB | `pnpm test:db -t "settlement idempotency"` | ✅ 02-08 |
| BUDG-01 | `micro_usd 35000` renders `cost_cents 3.50`; 1,428 rows sum to `$49.98` | DB | `pnpm test:db -t "cost_cents"` | ✅ 02-08 |
| BUDG-01 | `fieldMaskTier()` throws on an unknown field; each known field maps to its tier | unit | `pnpm test:unit -t "fieldMaskTier"` | ✅ 02-04 |
| BUDG-01 | **Mutation:** appending `places.reviews` raises the tier **and** the ledger price | unit (mutation M11) | `pnpm test:unit -t "atmosphere"` | ✅ 02-04 |
| BUDG-01 | `cost_ledger` carries **no** `log_event` trigger; `searches`/`search_versions`/`budget_periods` do (set equality both ways, `tgenabled` asserted) | DB | `pnpm test:db -t "after-row trigger"` | ✅ 02-05 |
| BUDG-03 | Nothing in `src/` reads a Google credential; no test requires the key | unit (grep) | `pnpm test:unit -t "no google credential"` | ✅ 02-02 |
| BUDG-04 | Spend view renders MTD, per-provider rows (incl. `$0.00 · no calls yet`) and per-run rows | E2E | `pnpm test:e2e -g "spend"` | ✅ 02-13 |
| BUDG-04 | ≥80 % renders the persistent banner on **every** route, not dismissible | E2E | `pnpm test:e2e -g "budget banner"` | ✅ 02-10 (self-skips on production until Phase 4) |
| SRCH-01 | Preset saves with cities / county / radius; each round-trips | DB + E2E | `pnpm test:db -t "geo kind"` · `pnpm test:e2e -g "create preset"` | ✅ 02-06 / 02-11 |
| SRCH-01 | Census parse: hit, empty `addressMatches`, 503 — all from msw fixtures | unit | `pnpm test:unit -t "census"` | ✅ 02-07 |
| SRCH-01 | A non-TX match (`STATE !== '48'`) is rejected | unit | `pnpm test:unit -t "texas only"` | ✅ 02-07 |
| SRCH-02 | Seed is idempotent: two runs, same row counts (`NULLS NOT DISTINCT` proves it) | DB | `pnpm test:db -t "seed idempotent"` | ✅ 02-06 |
| SRCH-02 | A tenant **sees** built-ins; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501` | DB | `pnpm test:db -t "built-in"` | ✅ 02-06 |
| SRCH-02 | All 254 TX counties seeded; `fips = 2*comptroller - 1` for every row | DB | `pnpm test:db -t "254 counties"` | ✅ 02-06 |
| SRCH-02 | RGV cluster×county counts equal the measured matrix (1,452/5,572/977/15,977) | unit | `pnpm test:unit -t "outlet counts"` | ✅ 02-02 |
| SRCH-03 | Saving an edit inserts a version and moves `current_version_id`; the old version survives | DB | `pnpm test:db -t "new version"` | ✅ 02-06 |
| SRCH-03 | A run keeps pointing at its version after the preset moves on | DB | `pnpm test:db -t "run keeps its version"` | ✅ 02-06 |
| SRCH-03 | `UPDATE`/`DELETE` on `search_versions` as `authenticated` → `42501 permission denied for table search_versions` (**message pinned**) | DB | `pnpm test:db -t "versions immutable"` | ✅ 02-06 |
| SRCH-03 | Concurrent save of the same version number → `23505` | DB | `pnpm test:db -t "save conflict"` | ✅ 02-06 |
| SRCH-04 | Committed cost-model test: real seeded cells, default schedule, monthly cost ≤ cap | unit | `pnpm test:unit -t "cost model"` | ✅ 02-07 |
| SRCH-04 | Free allowance: 68 requests with 1,000 free remaining → **$0.00**; with 0 remaining → $2.38 | unit | `pnpm test:unit -t "free allowance"` | ✅ 02-04 / 02-07 |
| SRCH-04 | Texas multiplier is computed from the two estimates, not a constant | unit | `pnpm test:unit -t "texas multiplier"` | ✅ 02-07 |
| SRCH-04 | Out-of-order estimate responses: the newer value survives | component | `pnpm test:unit -t "stale estimate"` | ✅ 02-11 |
| D-11 | One instant, two zones, opposite month verdicts (SQL **and** TS), plus the DST pair | DB + unit | `pnpm test:db -t "two zones"` · `pnpm test:unit -t "opposite"` | ✅ 02-04 / 02-08 |
| D-10 / FOUND-03 | A cap change writes an `events` row with actor + timestamp, from a raw SQL write | DB | `pnpm test:db -t "cap change is audited"` | ✅ 02-08 |
| Phase 1 carry | Every new table is in `TENANT_TABLES`; live catalog equals the array | DB | `pnpm test:db -t "holds no"` | ✅ 02-03 / 02-05 |
| Phase 1 carry | Every new table has `org_id` + RLS + ≥1 policy; every timestamp is `timestamptz` | DB | `pnpm test:db -t "every public table"` | ✅ auto-covers |
| UI-SPEC R7 | `signed-in-as` / `org-id` / `org-row-id` resolve on `/settings/organization` | E2E | `pnpm test:e2e -g "org-scoped"` | ✅ 02-10 |
| UI-SPEC R2/R8 | Computed accent is `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark, on the **built** app | E2E | `pnpm test:e2e -g "theme tokens"` | ✅ 02-10 |
| UI-SPEC R9 | Primary controls ≥44×44 at 390×844 | E2E | `pnpm test:e2e -g "touch targets"` | ✅ 02-10 |
| Pitfall 1 | `server_version_num >= 170000`; no `returning old.`/`new.`/`uuidv7(` in `drizzle/*.sql` | DB + unit (grep) | `pnpm test:db -t "server version"` · `pnpm test:unit -t "pg17"` | ✅ 02-02 / 02-08 |

---

## Per-Task Verification Map

> `$PNPM` in every command below is the pinned store launcher, written out in full:
> `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`
> Bare `pnpm` on this machine is the global 11.9.0 and dies before any script runs.
> `A→B` in Task ID means the test is written in A and turned green in B.
> Threat Ref cites the plan's `<threat_model>` entry (T-2-NN) or `—`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T3 | 02-01 | 1 | SRCH-04 | T-2-17 | a `.test.tsx` runs under jsdom while `*.test.ts` keeps `environment: node` and the main-process `TZ=UTC` pin | unit (jsdom) | `$PNPM test:unit -t "jsdom lane"` | 02-01 T3 | ✅ green (02-01; `jsdom lane renders a shadcn primitive`, and `the suite runs in a zone that can discriminate` still green beside it) |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | the seeded RGV cluster×county matrix equals the live-measured 1452/5572/977/15977 and the grand totals 23978/552278 | unit | `$PNPM test:unit -t "outlet counts"` | 02-02 T1 | ✅ green (02-02; `outlet counts match the measured RGV matrix`) |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | all 254 TX counties seeded; `county_fips = 2 * comptroller_code - 1` for every row; exactly 4 are RGV | unit | `$PNPM test:unit -t "254 counties seeded"` | 02-02 T1 | ✅ green (02-02; corroborated in the DB by `254 counties: the FIPS and Comptroller identity holds for every row`) |
| 02-02-T1 | 02-02 | 1 | SRCH-02 | — | the 17-city list, its folded Rio Grande City total (843) and both coverage percentages (90.7 before folding, 90.9 after) | unit | `$PNPM test:unit -t "the RGV 17-city list"` | 02-02 T1 | ✅ green (02-02; the product call confirmed by danlo at the 02-14 checkpoint — `17 as measured`) |
| 02-02-T3 | 02-02 | 1 | BUDG-03 | T-2-15 | nothing under `src/` reads a Google credential; no test requires the key; the walker is proven non-empty | unit (grep) | `$PNPM test:unit -t "no google credential"` | 02-02 T3 | ✅ green (02-02; `no google credential is read anywhere in src` + `src/env.ts declares no Google variable`. **This is what makes BUDG-03's `blocked` acceptable — see criterion 5**) |
| 02-02-T3 | 02-02 | 1 | Pitfall 1 | — | no `returning old./new.`, `uuidv7(` or virtual generated column in `drizzle/*.sql`, with SQL comments stripped first and the stripper itself tested | unit (grep) | `$PNPM test:unit -t "pg17"` | 02-02 T3 | ✅ green (02-02; the production database is PostgreSQL **17.6** while local/CI is 18 — this guard is the reason 0000–0016 applied cleanly to prod in 02-14) |
| 02-03-T3 | 02-03 | 1 | Phase 1 carry | T-2-10 | every new table is in `TENANT_TABLES` and the array equals the live catalog (13 after this plan) | DB | `$PNPM test:db -t "holds no"` | ✏️ extended | ✅ green (02-03, widened in 02-05 to 16) |
| 02-03-T3 | 02-03 | 1 | Phase 1 carry | T-2-10 | every public table has `org_id` + RLS + ≥1 policy; every timestamp is `timestamptz`; `ALLOW_NO_ORG_ID` unchanged | DB | `$PNPM test:db -t "every public table"` | ✅ auto-covers | ✅ green (02-03; `every public table is org-scoped and has RLS enabled`, `every timestamp column in public is timestamptz`) |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | `fieldMaskTier()` throws on an unknown field and on an empty mask; each known field maps to its tier; `nextPageToken` does not raise it | unit | `$PNPM test:unit -t "fieldMaskTier"` | 02-04 T1 | ✅ green (02-04; mutation 2 — returning `ts_essentials` instead of throwing — reds it) |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | **M11 half 1:** appending `places.reviews` raises the tier to `ts_enterprise_atmosphere` | unit (mutation) | `$PNPM test:unit -t "atmosphere"` | 02-04 T1 | ✅ green (02-04; **M11** reds it, re-verified 02-15 T3) |
| 02-04-T1 | 02-04 | 1 | BUDG-01 | T-2-08 | **M11 half 2, independent:** the same append raises the ledger price 35,000,000 → 40,000,000 µUSD | unit (mutation) | `$PNPM test:unit -t "price book atmosphere"` | 02-04 T1 | ✅ green (02-04; **M11** reds it too and **M11b** reds it ALONE — independence proven 02-15 T3) |
| 02-04-T1 | 02-04 | 1 | SRCH-04 | — | free allowance: 68 requests cost $0.00 with 1,000 free, 2,380,000 µUSD with 0 free, 980,000 with 40 free | unit | `$PNPM test:unit -t "free allowance"` | 02-04 T1 | ✅ green (02-04; the free allowance is why the estimate legitimately reads $0.00 early in the month) |
| 02-04-T2 | 02-04 | 1 | D-11 | — | one instant, two zones, opposite month verdicts in TypeScript; plus the CST month-edge pair and the CST/CDT reset-instant pair | unit | `$PNPM test:unit -t "opposite"` | ✏️ extended | ✅ green (02-04; `one instant renders on opposite days in UTC and America/Chicago`, plus `DST: the offset is not a constant` in SQL) |
| 02-04-T2 | 02-04 | 1 | BUDG-01 | T-2-07 | `parseUsdToMicro` refuses negatives, non-numerics and >2 decimals; `formatUsd` pins the locale (spy) | unit | `$PNPM test:unit -t "money"` | 02-04 T2 | ✅ green (02-04; 3 tests, the locale pinned by constructor spy) |
| 02-05-T1 | 02-05 | 2 | BUDG-01 | T-2-11 | `cost_ledger` and `cost_reservations` carry **no** `log_event` trigger; `searches`/`search_versions`/`budget_periods` do; set equality both ways, `tgenabled` asserted | DB | `$PNPM test:db -t "after-row trigger"` | ✏️ extended | ✅ green (02-05; `every state-bearing table has an app.log_event after-row trigger`) |
| 02-05-T1 | 02-05 | 2 | Phase 1 carry | T-2-10 | `TENANT_TABLES` widened to 16 and still equal to the live catalog | DB | `$PNPM test:db -t "holds no"` | ✏️ extended | ✅ green (02-05; **MGRANT** and **M12** both red the companion `authenticated holds exactly the DML each Phase 2 table needs`) |
| 02-06-T1 | 02-06 | 2 | SRCH-02 | D-04 | `db:seed` is idempotent end to end; CI seeds between `db:migrate` and `test:db`; `--target=test` refuses a Supabase host | script | `$PNPM db:seed && $PNPM db:seed` | 02-06 T1 | ✅ green (02-06; `0 inserted` on the second pass. **M-A** — dropping `nulls not distinct` — doubles the row count, 4 → 8) |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | T-2-09 | a tenant SEES built-ins; UPDATE/DELETE → `rowCount 0`; forged INSERT → `42501 new row violates row-level security policy`; duplicate built-in → `23505` | DB | `$PNPM test:db -t "built-in"` | 02-06 T2 | ✅ green (02-06; 5 tests. **M-B** reds the UPDATE filter alone) |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | T-2-09 | a second upsert over the committed JSON changes no row count and no row id | DB | `$PNPM test:db -t "seed idempotent"` | 02-06 T2 | ✅ green (02-06; **M-C** reds this **and** the duplicate-built-in test — recorded as one invariant seen from two sides, not designed away) |
| 02-06-T2 | 02-06 | 2 | SRCH-02 | — | all 254 counties live; the FIPS bijection holds for every row; `counties_fips_identity` refuses a counterexample with `23514` | DB | `$PNPM test:db -t "254 counties"` | 02-06 T2 | ✅ green (02-06; **M-D** reds the bijection test alone) |
| 02-06-T3 | 02-06 | 2 | SRCH-01 | — | a preset round-trips through `cities`, `counties` and `radius`; a fourth kind is refused `23514 sv_geo_kind_known` | DB | `$PNPM test:db -t "geo kind"` | 02-06 T3 | ✅ green (02-06; 2 tests) |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | saving an edit inserts a version and moves `current_version_id`; version 1 survives unchanged | DB | `$PNPM test:db -t "new version"` | 02-06 T3 | ✅ green (02-06; **criterion 3, first half**) |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | a run keeps pointing at its version after the preset moves on | DB | `$PNPM test:db -t "run keeps its version"` | 02-06 T3 | ✅ green (02-06; **criterion 3, second half**. Stays green under M12 — the direction check. 🔴 This is the test that carries SRCH-03 in CI now that `preset-detail.spec.ts` self-skips against a deployed target) |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | UPDATE/DELETE on `search_versions` as `authenticated` → `42501 permission denied for table search_versions` (**message pinned**); INSERT still allowed | DB | `$PNPM test:db -t "versions immutable"` | 02-06 T3 | ✅ green (02-06; 3 tests. **M12** reds the UPDATE one, the `grant delete` companion reds the DELETE one — separate grants, not one shared refusal) |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | — | a concurrent save of the same version number → `23505 search_versions_search_version_uniq` | DB | `$PNPM test:db -t "save conflict"` | 02-06 T3 | ✅ green (02-06) |
| 02-06-T3 | 02-06 | 2 | SRCH-03 | T-2-12 | `runs.search_version_id` cannot be re-pointed by `authenticated` (outside the column grant); a `status` update still succeeds | DB | `$PNPM test:db -t "re-pointed at a different version"` | 02-06 T3 | ✅ green (02-06; **M-E** — `grant update (search_version_id) on runs` — reds it alone, control green) |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | T-2-08 | the committed cost model over the real seeded cell list: RGV 68 cells / 612 requests / 21,420,000 µUSD at zero free; Texas 1016 cells / 9144 / 285,040,000 µUSD, above the cap | unit | `$PNPM test:unit -t "cost model"` | 02-07 T1 | ✅ green (02-07; 3 tests. Mutation 1 — `FAN_OUT 3.0 → 6.0` — reds all three, recorded as broader than predicted rather than narrowed) |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | — | the Texas multiplier is computed as `9144 / 612` ≈ 14.9, and the literal `38` appears nowhere in `src/lib/estimate/` | unit | `$PNPM test:unit -t "texas multiplier"` | 02-07 T1 | ✅ green (02-07; `texas multiplier is computed, not a constant`. **criterion 2, second half**) |
| 02-07-T1 | 02-07 | 2 | SRCH-04 | — | a city cell apportions from its county (McAllen × home_services = 275); a radius scales by the square of the radius ratio (155 at 10 mi) | unit | `$PNPM test:unit -t "estimate:"` | 02-07 T1 | ✅ green (02-07; 4 tests, including the never-divide-by-zero guard) |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | Census parse: McAllen hit, Rio Grande City hit, empty `addressMatches` → `no_match`, 503 → `unreachable`; axis order pinned by a sign assertion; msw errors on any unhandled request | unit (msw) | `$PNPM test:unit -t "census"` | 02-07 T2 | ✅ green (02-07; mutation 3 — swapping `x`/`y` — reds the SIGN assertion exactly as intended) |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | a non-TX match (`STATE !== '48'`) is rejected, with the unmodified fixture as the positive control | unit | `$PNPM test:unit -t "texas only"` | 02-07 T2 | ✅ green (02-07; mutation 4 reds it **ALONE**, 1 of 63) |
| 02-07-T2 | 02-07 | 2 | SRCH-01 | T-2-13 | the address is only ever a query parameter of a hard-coded host; an over-long or empty address never reaches the network | unit (msw) | `$PNPM test:unit -t "only ever a query parameter"` | 02-07 T2 | ✅ green (02-07) |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-04 | a denial is **zero rows**, not an exception; nothing throws and no reservation row is created | DB | `$PNPM test:db -t "denied returns null"` | 02-08 T1 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-07 | `CHECK (spent+reserved<=cap)` refuses a hand-written over-reserve → `23514 bp_not_over` | DB | `$PNPM test:db -t "bp_not_over"` | 02-08 T1 | ✅ green (**M8** reds it; **M8b** proves it is not redundant with the cap test) |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-07 | lowering the cap below `spent+reserved` → `23514`; to exactly `spent+reserved` → accepted (positive control) | DB | `$PNPM test:db -t "cap below"` | 02-08 T1 | ✅ green (**M8** and **M8b** both red it; the boundary-exact control stays green under both) |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-06 | a crashed worker's expired reservations are released by the next reserve; a LIVE reservation is not | DB | `$PNPM test:db -t "self-heal"` | 02-08 T1 | ✅ green (2 tests; **M-self-heal** reds the first alone — a healer that released everything would pass it alone) |
| 02-08-T1 | 02-08 | 3 | BUDG-02 | T-2-11 | the 80 % crossing emits exactly ONE `events` row per period (second reserve does not re-emit); 100 % refuses | DB | `$PNPM test:db -t "threshold"` | 02-08 T1 | ✅ green (2 tests. **criterion 5, the 80 % half**) |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | T-2-05 | `settle()` twice with one `request_id` → one ledger row, one balance move, `false` on the replay | DB | `$PNPM test:db -t "settlement idempotency"` | 02-08 T1 | ✅ green (**M9b** reds it alone; **M9** reds it plus three that depend on the same index) |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | T-2-03 | a zero-cost paid-SKU call still writes a ledger row (`micro_usd 0`, `units 1`) — the free allowance is otherwise untrackable | DB | `$PNPM test:db -t "zero-cost paid-SKU"` | 02-08 T1 | ✅ green |
| 02-08-T1 | 02-08 | 3 | BUDG-01 | — | `micro_usd 35000` renders `cost_cents 3.50`; 1,428 rows sum to `$49.98` | DB | `$PNPM test:db -t "cost_cents"` | 02-08 T1 | ✅ green |
| 02-08-T1 | 02-08 | 3 | Pitfall 1 | — | the test database reports `server_version_num >= 170000` | DB | `$PNPM test:db -t "server version"` | 02-08 T1 | ✅ green (local 18.6; production is 17.6 — both clear the floor) |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | a non-admin cannot change the cap → `42501 set_budget_cap: admin role required`; an admin can (positive control) | DB | `$PNPM test:db -t "set_budget_cap"` | 02-08 T2 | ✅ green (**M10** and **M10b** both red it; the admin control stays green under both) |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | `o.rol` (v2, bare) **and** `org_role` (v1, prefixed) both resolve to `admin`; a member does not | DB | `$PNPM test:db -t "current_org_role"` | 02-08 T2 | ✅ green (3 tests. **M10** reds `returns null for a member`; **M10b** leaves it green — independence proven) |
| 02-08-T2 | 02-08 | 3 | BUDG-02 | T-2-02 | a direct `update budget_periods` as `authenticated` → `42501 permission denied for table budget_periods` — a DIFFERENT invariant from the role check | DB | `$PNPM test:db -t "no direct UPDATE"` | 02-08 T2 | ✅ green (**MGRANT** reds it and leaves the role check green — the two cap refusals rest on different invariants) |
| 02-08-T2 | 02-08 | 3 | D-10 / FOUND-03 | T-2-11 | a cap change writes an `events` row with actor + timestamp from a RAW SQL write; a reservation does NOT | DB | `$PNPM test:db -t "cap change is audited"` | 02-08 T2 | ✅ green (2 tests, the negative one asserting a reservation writes nothing) |
| 02-08-T2 | 02-08 | 3 | D-11 | — | one instant, two zones, opposite month verdicts in SQL; October's period begins 05:00Z and March's 06:00Z | DB | `$PNPM test:db -t "two zones"` | ✏️ extended | ✅ green (2 tests, plus `set_budget_cap buckets the period in Chicago, not UTC`) |
| 02-08-T3 | 02-08 | 3 | BUDG-02 | T-2-04 | **criterion 5:** 40 concurrent reservations against a cap that fits 10 → exactly 10 granted, 30 denied, `reserved+spent == cap`, 0 errors; and the same under a crashed-worker fixture | DB (multi-conn) | `$PNPM test:db -t "concurrent burst"` | 02-08 T3 | ✅ green (3 tests. **M7** reds all three and **nothing else** — 87 single-worker tests stay green, which is what proves this file is not redundant) |
| 02-09-T3 | 02-09 | 3 | BUDG-02 | T-2-01 | every server action declares `'use server'` and calls `requireOrg()` BEFORE its first `withOrg(`; the walker is proven non-empty | unit (static) | `$PNPM test:unit -t "every server action"` | 02-09 T3 | ✅ green (4 tests, including `no server action reads a Google credential`) |
| 02-10-T2 | 02-10 | 4 | BUDG-04 | D-12 | ≥80 % renders the persistent banner on **every** route and it is not dismissible; <80 % renders nothing | E2E | `$PNPM test:e2e -g "budget banner"` | 02-10 T2 | ✅ green (02-10, against the **built** app with the meter driven to each threshold and `getComputedStyle` probed, cap restored and re-read). ⚠️ The 80 %/not-dismissible pair **self-skips against production** — committed spend there is $0 until Phase 4. `budget banner: absent under 80 percent` passed on the deployed URL |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R7 | T-2-10 | `signed-in-as` / `org-id` / `org-row-id` resolve on `/settings/organization` | E2E | `$PNPM test:e2e -g "org-scoped"` | ✏️ moved | ✅ green (02-10; `signs in and is org-scoped` passed against the deployed URL, 02-15 T1) |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R2/R8 | — | computed accent `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark and the two backgrounds, on the **built** app, with `innerHeight > 0` asserted first | E2E | `$PNPM test:e2e -g "theme tokens"` | 02-10 T3 | ✅ green (3 tests, all green against the **deployed** URL in 02-15 T1 — painted values, not custom properties) |
| 02-10-T3 | 02-10 | 4 | UI-SPEC R9 / MOB-01 | — | primary controls ≥44×44 at 390×844, with the viewport width asserted first | E2E | `$PNPM test:e2e -g "touch targets"` | 02-10 T3 | ✅ green (deployed, 02-15 T1) |
| 02-11-T3 | 02-11 | 5 | SRCH-01 | T-2-01 | a preset saves through all three geography modes from the UI and appears on `/presets` | E2E | `$PNPM test:e2e -g "create preset"` | 02-11 T3 | ✅ green (3 tests — cities, county, radius — all green against the **deployed** URL, 02-15 T1. **criterion 1**) |
| 02-11-T3 | 02-11 | 5 | SRCH-04 | Pitfall 5 | two recomputes resolved OUT OF ORDER → the newer value survives; in-order control still paints; the previous value stays visible with `aria-busy` and no skeleton | component (jsdom) | `$PNPM test:unit -t "stale estimate"` | 02-11 T3 | ✅ green (4 tests) |
| 02-12-T1 | 02-12 | 5 | SRCH-03 | — | the version diff reads as a sentence (`Added Auto & retail`, `Geography changed from County to Cities`), never a hash; unchanged items produce no clause | unit | `$PNPM test:unit -t "version diff"` | 02-12 T1 | ✅ green (5 tests) |
| 02-12-T2 | 02-12 | 5 | SRCH-03 / BUDG-02 | T-2-12 | an edit shows two versions and the run keeps the old one; duplicate creates a new preset at version 1; Run queues a run | E2E | `$PNPM test:e2e -g "preset detail"` | 02-12 T2 | ✅ green **against a local target** (02-12, and re-confirmed by the 02-15 orchestrator). ⚠️ **Self-skips against a deployed target** by danlo's decision of 2026-09-22 — the fixture writes to the LOCAL database while the app under test is the deployed one. SRCH-03 is carried in CI by `run keeps its version after the preset moves on` (02-06 T3), which **M12 direction-checks green** |
| 02-13-T1 | 02-13 | 5 | BUDG-04 | — | the spend view renders MTD, the gauge, and per-provider rows including `$0.00 · no calls yet`, plus per-run rows | E2E | `$PNPM test:e2e -g "spend"` | 02-13 T1 | ✅ green (`spend: month-to-date, the gauge and all three providers render` and `spend: the by-run tab reports its own state`, both against the **deployed** URL. `spend: the by-run tab lists a queued run` self-skips — no run exists on the deployed tenant until Phase 4. **criterion 4**) |
| 02-13-T2 | 02-13 | 5 | BUDG-03 | T-2-15 | the second-wall card renders the 100/day recommendation and its derivation with NO Google credential anywhere in `src/` | unit (grep, re-run) | `$PNPM test:unit -t "no google credential"` | ✅ 02-02 T3 | ✅ green (02-13; the card is rendered copy, the guard is the test) |
| 02-14-T2 | 02-14 | 6 | BUDG-01/02, SRCH-02 | T-2-03, T-2-12 | production carries the same twelve tables, five functions, named constraints and grants as local; `search_versions` insert-only, budget tables select-only, `runs.search_version_id` not updatable — read from `information_schema`, not inferred | script + manual | `$PNPM db:migrate:prod && $PNPM db:seed:prod` | 02-14 T2 | ✅ green (02-14; migrations 0000–0016 applied to production Supabase **by drizzle-kit only**, side-by-side read against local. 🔴 Production is PostgreSQL **17.6**, local/CI 18 — the Pitfall-1 guard is what made that safe) |
| 02-14-T3 | 02-14 | 6 | BUDG-03 | T-2-15 | the Google Cloud daily quota is set at 100 requests/day, or recorded as blocked on a project that does not exist — and nothing in `src/` depends on the key | **manual (checkpoint)** | see Manual-Only below | 02-14 T3 | 🟡 **blocked — no GCP project yet** (danlo, 02-14). Carried to Phase 4. Runbook written at `docs/runbooks/google-quota.md`. **Blocks nothing in Phase 2**, because `no google credential is read anywhere in src` is green and no test requires the key |
| 02-15-T1 | 02-15 | 7 | all 8 | T-2-01 | the whole e2e suite green against the **deployed** URL of a verified commit; signed-out `/presets`, `/spend`, `/settings/budget` all redirect and leak no `org-id` | E2E | `$PNPM test:e2e` | ✅ all specs | ✅ green (02-15 T1 + T3; **15 passed / 6 skipped / 0 failed** against `https://siteless-iota.vercel.app` @ `6d6c52f`, 43.2 s. Six new routes each `307 → /sign-in` signed out, none carrying `data-testid="org-id"`) |
| 02-15-T2 | 02-15 | 7 | UI-SPEC | — | danlo reviewed all seven screens on the deployed app, both themes, 390×844 and 1280×800 | **manual (checkpoint)** | see Manual-Only below | — | ✅ **approved** (danlo, verbatim `design: approved`, 2026-09-22, on the deployed app) |
| 02-15-T2 | 02-15 | 7 | UI-SPEC / BUDG-04 | D-12 | the four state shots on the DEPLOYED app — 80 % banner, 100 % banner, refused run drawer, assumptions drawer | **manual (capture)** | — | — | 🟡 **deferred to Phase 4 (danlo, 2026-09-22)** — verbatim `state shots: defer to Phase 4`. Production committed spend is $0 until Phase 4, so the deployed states would be synthetic. The local hex-probed proofs from **02-10** (both thresholds) and **02-12/02-13** (the refusal) stand in |
| 02-15-T3 | 02-15 | 7 | BUDG-01/02, SRCH-03 | T-2-02…T-2-12 | gate mutations **M7–M12** applied to the live local database, each reding exactly the predicted named test, direction-checked, reverted and verified from the catalog | gate (mutation) | see Phase-Gate Mutations above | — | ✅ green (02-15 T3; 13 mutations run — M7, M7+M8, M8, M8b, M9, M9b, M10, M10b, M11, M11b, M12, M12-delete, M12b. All six catalog objects byte-identical to the pre-mutation capture; `git diff --stat` empty after every DB mutation) |
| 02-15-T3 | 02-15 | 7 | SRCH-03 | T-2-12 | **new, found by the gate:** `authenticated` holds no **column-level** UPDATE on `search_versions` | DB | `$PNPM test:db -t "holds exactly the DML each Phase 2 table needs"` | 02-15 T3 (`98d99ff`) | ✅ green (02-15 T3; written because **M12b survived** — see the M12b section. Watched green → red under M12b → green after the revoke) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · 🟡 manual, recorded outcome*

**No row is ❌ or ⬜.** Two rows are 🟡: BUDG-03's Google quota (blocked on a Google Cloud
project that does not exist, carried to Phase 4, blocking nothing here) and the four deployed
state shots (deferred to Phase 4 by danlo). Four rows carry a ⚠️ annotation about a test that
**self-skips against production** while being green against a local target; in every case the
reason is recorded, the requirement is carried by a named test that CI runs, and the skip is
listed by name in the table at the top of this file rather than hidden inside a count.

---

## Wave 0 Requirements

"Wave 0" is realised as plans **02-01** through **02-04**, all in wave 1, because the
framework install, the seed data, the schema and the pure cost model have no dependencies on
one another and only 02-03 touches the database. **All closed.**

- [x] `vitest.config.ts` — a jsdom lane for `**/*.test.tsx` + `@vitejs/plugin-react`, **without** changing the node default for `*.test.ts` — **02-01 T3** (vitest 5 `test.projects`)
- [x] `tests/unit/_setup-dom.ts` — `@testing-library/jest-dom` matchers — **02-01 T3**
- [x] `tests/db/_concurrency.ts` — `openTestClient()` / `openTestClients()` / `closeAll()` / `withCommittedFixture()`, refusing a Supabase host, **not** built on `withRollback`, never deleting an `orgs` row — **02-02 T2** (two latent defects in it surfaced and were fixed by its first consumer, 02-08 — a harness with only a read-only smoke test of its own)
- [x] `tests/unit/msw/` — recorded Census fixtures — **02-02 T2**; the `server.ts` that replays them — **02-07 T2**
- [x] `tests/unit/fixtures/preset.ts` — `PresetSpec` fixtures derived FROM the seed JSON — **02-02 T2**
- [x] `src/seed/data/*.json` — clusters, 17 cities, 4+254 counties, outlet counts, geo presets — **02-02 T1**
- [x] `tests/db/grants-audit.test.ts` — `TENANT_TABLES` extended to 13 — **02-03 T3** — then to 16 — **02-05 T1** — then given a column-privilege assertion for `search_versions` — **02-15 T3**
- [x] `tests/db/event-trigger.test.ts` — `EVENT_LOGGED` extended to 4 — **02-03 T3** — then to 5 — **02-05 T1**
- [x] `eslint-plugin-react-hooks` — **02-01 T3**
- [x] Framework install — Tailwind 4.3.3, shadcn 4.21.0 init + 33 components, `@testing-library/*`, `msw`, `jsdom`, `@vitejs/plugin-react`, all pinned exactly — **02-01 T1 and T3**

> 🔴 **The [BLOCKING] schema push.** `pnpm build` and `pnpm typecheck` pass WITHOUT a migration
> having been applied, because Drizzle's types come from the schema files and not from the live
> database. That is a false-positive verification state. Every wave that added schema therefore
> ended with a blocking `db:generate` → `db:custom` → `db:migrate` → `test:db` task:
> **02-03 T2/T3**, **02-05 T1/T2**, and **02-14 T2** for production. All three closed.

---

## Manual-Only Verifications

| Behavior | Requirement | Plan / Task | Why Manual | Result and provenance |
|----------|-------------|-------------|------------|------------------------|
| Google Cloud per-API daily quota on Places API (New) | BUDG-03 | **02-14 T3** | The GCP project and the Places key do not exist; setting a console quota is a human action | 🟡 **`blocked - no GCP project yet`** — danlo, 2026-09-22. Carried to **Phase 4**, where the key is first needed. `docs/runbooks/google-quota.md` records the console path, the derivation to 100/day, and the honesty line that 100/day × 30 ≈ $70/month, **above** the $50 cap — so the quota is a second wall against runaway, not a budget. 🔴 Blocks nothing in Phase 2: `no google credential is read anywhere in src` is green and no test requires the key |
| Visual quality of the seven screens in both themes | UI-SPEC (the design bar) | **02-15 T2** | Computed-style probes prove the tokens shipped, not that the screens meet the bar | ✅ **`design: approved`** — danlo, verbatim, 2026-09-22, reviewing `https://siteless-iota.vercel.app` @ `6d6c52f` on a phone and a desk, in both themes. No screen was listed as needing work, so there are no numbered follow-ups |
| The four deployed state shots (80 %, 100 %, refused run, assumptions drawer) | BUDG-04 / UI-SPEC | **02-15 T2** | The states need the production cap driven and restored | 🟡 **`state shots: defer to Phase 4`** — danlo, verbatim, 2026-09-22. Production committed spend is $0 until Phase 4 calls Places, so the deployed states would be synthetic. The local **hex-probed** captures from 02-10 (both thresholds, cap restored and re-read from `budget_periods`) and 02-12/02-13 (the refusal drawer) stand in |
| The RGV 17-city list is the one Phase 3 will ingest against | SRCH-02 | **02-02 T1** → **02-14 T2** | A product call, not a data one | ✅ **`17 as measured`** — danlo, 02-14. The Phase 2 ∥ Phase 3 shared contract is settled |
| Vercel plan is Pro | — (Phase 9 dependency) | **02-14 T3** | Research could not verify it — `vercel teams ls` returned an invalid token | ✅ **"I have vercel pro"** — danlo, verbatim, 2026-09-22. Unblocks the Phase 9 per-minute cron; Hobby's once-a-day ±59-minute cron would not have served it. Pro's ~$20/mo is infrastructure and is never merged into the $50 data cap |
| danlo signs in on the deployed URL and every new route is org-scoped | criterion 1 carried forward | **02-15 T1 and T2** | Requires a human Clerk sign-in with an email code | ✅ Both halves. **Automated:** `signs in and is org-scoped` + 14 more green against the deployed URL. **Human:** danlo worked the app on his phone before replying `design: approved` |
| Screenshot inventory | UI-SPEC Executor Rule 8 | 02-10 → 02-13 | — | ⚠️ **Recorded honestly: 84 captures were taken across 02-10 (8), 02-11 (16), 02-12 (16) and 02-13 (44), all of the BUILT app via `next start`, all written to gitignored run-evidence directories inside worktrees that have since been destroyed. Zero image files exist on this machine today.** What survives is each SUMMARY's inventory table and, more importantly, the **computed-style probes** recorded beside them — which is the evidence that actually discriminates, since a screenshot cannot prove which theme it was taken in and a probe can. The 28 **deployed** captures 02-15 T2 asked for were not taken: danlo reviewed the deployed app directly instead, which is the thing the captures existed to enable |

---

## The five ROADMAP success criteria, closed

**1. "danlo saves a named preset defined as one or more industry clusters × a geography
(named city list, county, or radius around a geocoded point), with the four clusters, the RGV
city list and the four RGV counties already seeded on first run."** — **CLOSED.** All three
geography modes were saved from the real UI against the **deployed** app and each appeared on
`/presets`: `create preset: cities`, `create preset: county`, `create preset: radius`, green
in 02-15 T1's run against `https://siteless-iota.vercel.app`. At the database layer
`preset geo kind round-trips for cities, counties and radius` proves the round-trip and
`preset geo kind: a fourth kind is refused by sv_geo_kind_known` proves the set is closed. The
seed is idempotent and complete: `outlet counts match the measured RGV matrix`,
`254 counties: the FIPS and Comptroller identity holds for every row`,
`built-in reference rows are visible to a tenant`, and `seed idempotent: a second upsert
changes no row count` — the last of which M-A kills by dropping `nulls not distinct` (row
count doubles 4 → 8).

**2. "Before saving or running, the preset shows an estimated cost and an estimated result
count; a Texas-wide preset is expressible and shows its cost multiplier."** — **CLOSED.** The
estimate is computed from the **real seeded cell list** in a committed test, not a
spreadsheet: `cost model: the RGV baseline priced over the real seeded cell list` (68 cells /
612 requests / 21,420,000 µUSD at zero free) and `cost model: Texas exceeds the cap and says
so` (1016 cells / 9144 requests / 285,040,000 µUSD). The multiplier is **derived**, not
declared — `texas multiplier is computed, not a constant` asserts `9144 / 612` ≈ 14.9 and that
the illustrative literal `38` appears nowhere in `src/lib/estimate/`. On the deployed app,
`preset editor: the Texas row carries a computed multiplier, not a literal` proves the same
thing through the browser. The $0.00 an early-month estimate legitimately shows is the free
allowance, pinned by `free allowance:` and by `price book atmosphere: the ledger price follows
the mask` — the price comes from the field mask, never from a per-call constant, and **M11**
reds both halves while **M11b** reds only the price half, proving they are independent.

**3. "Editing a preset creates a new version, and a past run still points at the version that
produced it."** — **CLOSED, at the layer that owns it.** `new version: saving an edit inserts
a version and moves current_version_id` covers the first half; `run keeps its version after
the preset moves on` covers the second. Immutability is a **GRANT**, not a policy — a policy's
`WITH CHECK` sees only the finished row and can never say "this column did not change" —
pinned by `versions immutable: UPDATE as authenticated is refused` on the **message**
(`permission denied for table search_versions`, which distinguishes a grant refusal from an
RLS one). **M12** reds it while `run keeps its version` stays green; the `grant delete`
companion reds only the DELETE test, so the two do not share one refusal. 🔴 **M12b found the
hole in this criterion's defence and it is now closed:** a *column-level* grant on
`geo_payload` let a tenant rewrite a version's geography with the whole suite green. The
sentinel now asserts `has_any_column_privilege('authenticated','public.search_versions',
'UPDATE')` is false (`98d99ff`). The browser-level version of this criterion
(`preset detail: a saved edit shows two versions and the run keeps the old one`) is green
against a local target and self-skips against a deployed one by danlo's decision — the
database test is the one CI runs on every push.

**4. "A spend view shows month-to-date spend versus the cap broken down by provider, fed by a
ledger row per paid call."** — **CLOSED.** `spend: month-to-date, the gauge and all three
providers render` passed against the **deployed** URL, including the `$0.00 · no calls yet`
row that an empty provider must show rather than being omitted. The ledger underneath is one
row per paid call and is idempotent: `settlement idempotency: settle twice with one
request_id` (**M9b** reds it alone), `settlement: a zero-cost paid-SKU call still writes a
ledger row` — without which the free allowance is untrackable — and `cost_cents renders
micro-USD exactly`, which pins that 1,428 rows of 35,000 µUSD sum to **$49.98** and not to the
$57.12 or $42.84 that integer cents would produce. `spend: the by-run tab lists a queued run`
self-skips on the deployed tenant, which has no run; the by-run tab's own empty state is
asserted instead by `spend: the by-run tab reports its own state`.

**5. "With the cap reached, a concurrent burst of workers is refused at 100 % (and warned at
80 %) with no over-spend — proven by a concurrency test — and a Google Cloud per-API daily
quota stands as an independent second wall."** — **CLOSED on the first half, and the second
half is recorded as blocked, by design.**

*The burst.* `concurrent burst: 40 workers against a cap that fits 10` opens 40 real
connections (it cannot use `withRollback`, which is one transaction and so cannot express two
workers seeing each other's commits) and asserts **exactly 10 granted, 30 denied,
`spent + reserved == cap`, and zero errors** — errors asserted first and **by content**, so a
connection failure cannot masquerade as a refusal. `concurrent burst: open reservations equal
the grants` and `concurrent burst survives a crashed worker holding the whole cap` cover the
other two shapes. The 80 % half is `threshold: the 80 percent crossing emits exactly one
events row per period` and the 100 % half `threshold: at 100 percent every new reservation is
refused`. **This is a proof and not a green light, because M7 makes it red:** replacing the
single conditional UPDATE with a naive SELECT-then-UPDATE reds all three burst tests and
**nothing else** — 87 single-worker tests stay green. With `bp_not_over` also dropped, the
naive meter **granted 34 of 40 and reserved 340 against a cap of 100**, a 3.4× over-spend with
zero errors. That is the measured control.

*The second wall.* **BUDG-03 is `blocked - no GCP project yet`** (danlo, plan 02-14), carried
to **Phase 4**, with the runbook written and committed at `docs/runbooks/google-quota.md` —
including the honest arithmetic that 100 requests/day × 30 days ≈ $70/month, *above* the $50
cap, so the quota is a runaway stop and never a budget. This blocks nothing in Phase 2 and the
claim is enforced rather than asserted: `no google credential is read anywhere in src` and
`src/env.ts declares no Google variable` are green, and `no server action reads a Google
credential` is green beside them. Nothing in this phase can spend a cent at Google, because
nothing in this phase can authenticate to Google.

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify or an explicit Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (unit 7.2 s + one DB filter)
- [x] Gate mutations **M7–M12** recorded **as run**, each reverted and diffed back, each direction-checked; every mutation reding two tests carries a proof of independence (**M8b**, **M10b**, **M11b**), and the one mutation that **survived** (**M12b**) produced a new guard rather than a note
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** 2026-09-22 — closed by **02-15 T3**, on danlo's `design: approved` for the
deployed app, a 15-passed / 6-skipped / 0-failed e2e run against
`https://siteless-iota.vercel.app`, thirteen gate mutations run against the live local
database with every revert proven from the catalog, and a final five-constituent gate green on
a printed branch and sha.
