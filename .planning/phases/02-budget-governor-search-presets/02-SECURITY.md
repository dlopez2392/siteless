---
phase: 2
slug: budget-governor-search-presets
status: open
threats_open: 2
asvs_level: 1
created: 2026-09-22
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Verified against implemented code at HEAD `29b4997` (branch `main`), local migrations
> `drizzle/0012_eager_vertigo.sql` … `drizzle/0020_yellow_ricochet.sql` (9 journal rows beyond
> Phase 1's 12), and a read-only execution of both pinned suites: `pnpm test:unit` →
> **81/81 passed** (20 files), `pnpm test:db` → **102/102 passed** (15 files, local PostgreSQL
> 18.6, `siteless_test`, rolled-back or self-cleaning transactions). These counts match
> `02-REVIEW-FIX.md`'s recorded gate exactly. Evidence below is file:line, test name, SQL
> fragment, or migration comment — never a SUMMARY claim taken on faith. Where `02-REVIEW.md`
> found a gap in a mitigation this register already counted as closed (CR-01, WR-01, WR-03,
> WR-04, WR-09), the evidence cites the fix commit and the current code, not the original
> (superseded) mitigation text, exactly as `01-SECURITY.md` did for its own review findings.
>
> 🔴 **Two rows are marked `open`, not `closed`, for a reason that is not a code defect.**
> `02-REVIEW-FIX.md`'s own "Production owed" section states plainly that migrations
> `0017`–`0020` — which carry the CR-01 and WR-04 fixes — were applied to the **local**
> `siteless_test` database only; production Supabase (PostgreSQL 17.6, last migrated through
> `0016_budget_meter_functions` per `02-14-SUMMARY.md` line 129: 17 journal rows) has not
> received them. This audit does not open a production connection (forbidden by its own
> constraints), so it cannot confirm the fix is live where real tenants' data lives. See
> **Open Threats** below for the precise, disposition-relevant reasoning on each of the two
> rows — they are not equivalent, and one is materially lower-risk than the other.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| SECURITY DEFINER function → foreign key it accepts | A definer's own privileges satisfy any FK the statement touches; RLS never evaluates a referential check, so a definer that accepts a caller-supplied id without an explicit tenant comparison can write onto another tenant's row through the FK alone (CR-01, WR-04) | tenant data, budget rows |
| RLS INSERT policy → the row's own columns only | A policy sees the row being written, never the table it points at through a foreign key — "the new row's org_id is mine" says nothing about whose row the FK names | cross-tenant references |
| `authenticated` role → `search_versions` | Grant-level immutability (`grant select, insert` / `revoke update, delete`) is the only wall once a row exists; `runs.search_version_id` sits outside its own column grant | version history integrity |
| client (typed cap, geocoder address) → server action → SQL | Every value a browser can produce is attacker-controlled twice: `parseUsdToMicro` and CHECK constraints on the money path, zod length/character bounds before `census.gov` on the geocoder path | money, outbound HTTP request shape |
| server action → SECURITY DEFINER budget functions | `reserve_budget` / `settle_reservation` / `set_budget_cap` are the only writers to `budget_periods` / `cost_reservations` / `cost_ledger`; `authenticated` holds no direct DML grant on any of the three | budget, spend |
| concurrent connections → one budget row | Every "Run this preset" is a request to spend from a shared, contended cap; the entire concurrency control is one conditional `UPDATE` with no preceding read | budget integrity under race |
| crashed / abandoned worker → held budget | A reservation that is never settled or released strands its hold until self-heal reclaims it; nothing on the correctness path is a scheduler | budget availability |
| Google Places field mask → ledger price | The price of a call is a property of `X-Goog-FieldMask`, derived through one function (`fieldMaskTier` → `priceRequests`); a change to the mask that is not priced is unbilled scope creep | ledger accuracy |
| client string (address) → Census Geocoder | The only outbound HTTP call this phase makes; host and path are constants, the address is the only variable and is bounded before the URL is built | SSRF / injection surface |
| estimate action → compute | No paid call, but an authenticated caller can still burn CPU; bounded by auth-first, debounce, and hard caps on `clusterKeys`/`cityIds` | compute / cost of an unauthenticated-adjacent request |
| `src/lib/ui/*` (data module) → client component | A `"use client"` directive on a module a server component imports turns its plain data exports into client references that arrive `undefined` at runtime — 500 with typecheck/lint/build all green | availability |
| retired Phase 1 testid → orphaned spec | A spec asserting a hook that moved elsewhere is a green spec asserting nothing | test suite honesty (indirectly, security review) |
| repository → npm / shadcn registry | Every dependency and every copied-in primitive executes on the dev machine, CI and Vercel; only the official `ui.shadcn.com/r` registry is used, no `--registry` flag, no floated version | supply chain |
| dev machine timezone → jsdom/vitest assertion | `TZ=UTC` must be set in the MAIN process before any worker spawns, for both the unit and DB configs, or a Chicago machine silently makes every `America/Chicago` assertion vacuous | test suite honesty |
| production migration state → deployed code | Server action code and the database schema it calls deploy on independent schedules; a Vercel deploy does not run `drizzle/*.sql`, and `pnpm db:migrate:prod` is a separate, human-gated step | schema/code skew |
| (all Phase 1 boundaries) | Unchanged and still verified — see `01-SECURITY.md` | — |

---

## Threat Register

82 rows across the fifteen plans of this phase (the same Threat ID recurring across plans is a
separate row per (plan, threat) pair, matching `01-SECURITY.md`'s convention). 80 rows
`status: closed`. 2 rows `status: open` (production-migration gap, not a code defect — see
**Open Threats**). 1 row (`T-2-05`, 02-09) carries `disposition: accept`, not `mitigate` as the
audit brief summarized; verified against this document's own Accepted Risks Log, which is
where it is recorded below.

| Threat ID | Plan | Category | Component | Disposition | Evidence | Status |
|-----------|------|----------|-----------|-------------|----------|--------|
| T-2-15 | 02-01 | Information Disclosure | client bundle / font loader | mitigate | `src/app/layout.tsx` — only match for `google` is `import { Inter } from 'next/font/google'`; `grep -c 'Geist' src/app/layout.tsx` → 0; no `NEXT_PUBLIC_GOOGLE*` name introduced | closed |
| T-2-16 | 02-01 | Tampering (supply chain) | shadcn / npm registry | mitigate | `grep -cE '"[\^~]' package.json` → 0; 02-01-SUMMARY.md:426 — the "surprising" `cn`/`radix-ui`/`tw-animate-css`/`shadcn` deps verified against `https://ui.shadcn.com/r/styles/radix-nova/index.json`, no `--registry` flag used | closed |
| T-2-17 | 02-01 | Tampering (test harness) | `vitest*.config.ts` | mitigate | `vitest.config.ts:16` and `vitest.db.config.ts:4` — `process.env.TZ = 'UTC'` above the first import, in the main process, both configs | closed |
| T-2-15 | 02-02 | Information Disclosure | Google credential in `src/` | mitigate | `tests/unit/no-google-credential.test.ts` — 5 forbidden patterns incl. `GOOGLE_*KEY`, `NEXT_PUBLIC_GOOGLE`, `X-Goog-Api-Key`, `maps.googleapis.com`; two-sided (`scanned.length > 15`, contains `env.ts`/`time.ts`); part of the green 81/81 unit run | closed |
| T-2-06 | 02-02 | Denial of Service | committing test fixture | mitigate | `tests/db/_concurrency.ts:144` `withCommittedFixture`, cleanup in `finally` (lines 155, 162), dedicated org/period pair (comment line 41-53), never deletes an `orgs` row | closed |
| T-2-13 | 02-02 | Tampering | Census Geocoder response | mitigate | `tests/unit/msw/server.ts:2,19,25-28` — four verbatim recorded payloads replayed via msw; CI never issues the real request | closed |
| Pitfall 1 | 02-02 | Tampering | migration portability | mitigate | `tests/unit/pg17-compat.test.ts:32,68,89-122` — greps `drizzle/*.sql` for `returning old./new.`, `uuidv7(`; comment-stripper has its own two-sided pair (lines 89-122) proving it discriminates a real violation from one mentioned only in prose | closed |
| T-2-09 | 02-03 | Tampering | reference rows (`org_id IS NULL`) | mitigate | `drizzle/0013_reference_policies_and_grants.sql:43-44` — write policies carry `org_id is not null and org_id = (select app.current_org_id())`; `tests/db/reference-rows.test.ts:127,144` — `42501` on forged INSERT, `23505` on duplicate built-in | closed |
| T-2-10 | 02-03 | Information Disclosure | cross-org presets, versions, runs | **superseded — see Open Threats** | `02-REVIEW.md` CR-01: `savePresetVersion` inserted a version onto another tenant's search through an FK bypass of RLS. Fixed in `6b1bfd7` / `drizzle/0017_strange_mathemanic.sql` (composite `(search_id, org_id)` FK) + `src/server/actions/save-preset-version.ts:126-129` (ownership SELECT under RLS before insert, `not_found` on miss). Watched red first and green after: `tests/db/versioned-presets.test.ts:366,402` (`tenancy: a version cannot be attached to another org's search` / `... own search is still accepted`) | **open (production)** |
| T-2-12 | 02-03 | Tampering | `runs.search_version_id`, `search_versions` | mitigate | `drizzle/0013_reference_policies_and_grants.sql:63-65` — `grant select, insert` + `revoke update, delete` on `search_versions` (`42501`); `:88` — `runs` column grant excludes `search_version_id` (comment lines 68-84); `tests/db/grants-audit.test.ts:352` `has_column_privilege(...,'search_version_id','UPDATE')` = false | closed |
| T-2-11 | 02-03 | Repudiation | actor on a preset or version change | mitigate | `drizzle/0007_event_triggers.sql:12-13,25` — `security definer`, actor `coalesce(app.jwt()->>'sub', current_setting('app.actor_id', true), 'system')`; `drizzle/0013_reference_policies_and_grants.sql:105-108` attaches the trigger to `searches`/`search_versions`; `tests/db/event-trigger.test.ts:52,109,204` `EVENT_LOGGED` set-equality on `tgenabled` | closed |
| Pitfall 1 | 02-03 | Tampering | migration portability | mitigate | `tests/unit/pg17-compat.test.ts` re-run against `0012`-`0016` (and, currently, `0017`-`0020` too — all clean, confirmed by direct grep, no `returning old./new.`/`uuidv7(` in any Phase 2 migration file) | closed |
| T-2-08 | 02-04 | Repudiation | ledger price derived from a constant | mitigate | `src/lib/budget/field-mask-tier.ts:98` `fieldMaskTier`, `src/lib/budget/price-book.ts:112` `priceRequests` — the only priced path; `tests/unit/field-mask-tier.test.ts:58,119` `X-Goog-FieldMask is named in at most one module under src` (grep confirms exactly `field-mask-tier.ts`); mutation M11 (02-VALIDATION.md line 95) reds both `fieldMaskTier atmosphere` and `price book atmosphere` on a mask append | closed |
| T-2-07 | 02-04 | Tampering | reservation amount arithmetic | mitigate | `src/lib/budget/money.ts:76-122` `parseUsdToMicro` — refuses negative/non-numeric/>2-decimal/`>MAX_PARSEABLE_MICRO_USD`, composed from string parts, no float intermediate; DB-side `CHECK`s land in 02-05 (see below) | closed |
| T-2-05 | 02-04 | Tampering | field union admitting a wildcard | mitigate | `src/lib/budget/field-mask-tier.ts:26-57` `PlacesField` union of four `as const` arrays; `'*'` is a compile-time type error, not spellable | closed |
| D-11 | 02-04 | Tampering | month boundary | mitigate | `src/lib/budget/period.ts:37,54,60,98` — `formatToParts`/`TZDate` against `APP_TZ`, never `getMonth()`; `tests/unit/budget-period.test.ts:26,44,55,74` — three discriminating pairs incl. the CST/CDT reset-instant pair, run under `TZ=UTC` | closed |
| T-2-03 | 02-05 | Tampering / Repudiation | `cost_ledger` without a reservation | mitigate | `drizzle/0014_brown_phantom_reporter.sql:24` `reservation_id uuid NOT NULL` + `:60` FK to `cost_reservations`; `drizzle/0015_budget_grants_and_triggers.sql:47-50` `authenticated` holds no INSERT on `cost_ledger` | closed |
| T-2-04 | 02-05 | Tampering | read-then-spend race | mitigate | `drizzle/0016_budget_meter_functions.sql` (superseded by `0020`, see below) — one conditional `UPDATE`, no preceding read; `tests/db/budget-concurrency.test.ts:111,149,176` — 40-way burst against a cap fitting 10; mutation M7 (02-VALIDATION.md:87) reds exactly those 3 tests, 87 single-worker tests stay green | closed |
| T-2-05 | 02-05 | Tampering | replayed settlement | mitigate | `drizzle/0014_brown_phantom_reporter.sql:34` `cost_ledger_request_id_key` UNIQUE; `drizzle/0019_aromatic_bromley.sql` `on conflict (request_id) do nothing` + `get diagnostics`; mutation M9/M9b (02-VALIDATION.md:91-92) reds `settlement idempotency` alone under M9b | closed |
| T-2-06 | 02-05 | Denial of Service | crashed worker stranding budget | mitigate | `drizzle/0016_budget_meter_functions.sql` self-heal, now `app.release_expired_reservations` (`drizzle/0018_condemned_luke_cage.sql`) called from `reserve_budget` **and** `ensure_budget_period` (every read); `tests/db/budget-meter.test.ts:248,276,353,384` — self-heal + TTL-read tests, all green | closed |
| T-2-07 | 02-05 | Tampering | negative or overflowing reservation | mitigate | `drizzle/0014_brown_phantom_reporter.sql:15-16` `bp_not_over`/`bp_non_negative`; `:53` `cr_est_positive`; `:35-36` `cl_micro_non_negative`/`cl_units_positive`; `drizzle/0016_...sql:224` `(v_s+v_r)*100 >= v_c*80` (never `/100`) | closed |
| T-2-02 | 02-05 | Elevation of Privilege | member raises the cap | mitigate | `drizzle/0015_budget_grants_and_triggers.sql:47,50` — `grant select` only, `revoke insert, update, delete` on `budget_periods`; `drizzle/0016_...sql:345-346` `set_budget_cap` raises `42501 set_budget_cap: admin role required` on `current_org_role() ≠ 'admin'`; mutation M10/M10b (02-VALIDATION.md:93-94) proves the two refusals independent | closed |
| T-2-11 | 02-05 | Repudiation | forged actor on a cap change | mitigate | `drizzle/0015_budget_grants_and_triggers.sql:101-108` `budget_periods_event_upd` fires `app.log_event` only on `cap_micro_usd` change; actor from `app.jwt()->>'sub'`, `authenticated` has no INSERT on `events` (migration 0011, unchanged) | closed |
| T-2-10 | 02-05 | Information Disclosure | cross-org budget rows | **superseded — see Open Threats** | `02-REVIEW.md` WR-04: `app.reserve_budget` accepted a `p_run` from any org (definer insert bypasses RLS + FK bypass). Fixed in `01f9afe` / `drizzle/0020_yellow_ricochet.sql:38-43` — explicit `exists (select 1 from runs where id = p_run and org_id = v_org)` check, `42501` on mismatch. Watched red first: `reserve_budget refuses a run belonging to another org`, green control: `reserve_budget accepts the caller's own run` (`tests/db/budget-meter.test.ts`) | **open (production) — see reasoning below; not reachable through any current application code path** |
| T-2-09 | 02-06 | Tampering | built-in reference rows | mitigate | `tests/db/reference-rows.test.ts:127,144,192` — `rowCount === 0` for UPDATE/DELETE, `42501` for forged INSERT, `23505` for duplicate built-in, each in its own rolled-back tx with a positive control | closed |
| T-2-12 | 02-06 | Tampering | a run re-pointed, a version edited | mitigate | Same grant evidence as 02-03/T-2-12; `tests/db/versioned-presets.test.ts` `run keeps its version after the preset moves on` — direction-checked green under mutation M12 (02-VALIDATION.md:97); M12b (line 99) found the **column-level** grant gap, closed in `98d99ff` — `tests/db/grants-audit.test.ts:305` `has_any_column_privilege('authenticated','public.search_versions','UPDATE')` = false | closed |
| T-2-11 | 02-06 | Repudiation | version authorship | mitigate | `tests/db/event-trigger.test.ts` — raw SQL insert with no application code in the path still produces an audited row | closed |
| T-2-10 | 02-06 | Information Disclosure | cross-org reference and preset rows | mitigate | `tests/db/reference-rows.test.ts:192` `built-in rows: org A cannot see org B's own reference row` — two orgs in the fixture, dedicated test | closed |
| D-04 | 02-06 | Tampering | seed pointed at production | mitigate | `scripts/seed.ts:346-355` — same `looksLikeSupabase` gate as `scripts/db.ts:36-47`; `--target=test` throws on a Supabase host, `--target=prod` demands the session pooler (`:5432`) | closed |
| T-2-13 | 02-07 | Tampering | Census Geocoder call (SSRF / injection) | mitigate | `src/lib/geocode/census.ts:37` `CENSUS_HOST` constant, `:77-78` zod `.min(3).max(200)`, `:138` `new URL(...)` built from constants + one query param; `tests/unit/census.test.ts:128,154` — origin/pathname assertion, over-long/empty refusal before any request | closed |
| T-2-15 | 02-07 | Information Disclosure | Google credential | mitigate | `grep -rn 'googleapis\|GOOGLE' src/lib/geocode/` → 0 matches; free federal geocoder, no key | closed |
| T-2-14 | 02-07 | Denial of Service | estimate as a compute oracle | mitigate | Estimator is pure arithmetic over seeded tables, no paid call (`src/lib/estimate/estimate.ts`); auth + debounce added at the 02-09/02-11 boundary (see below) | closed |
| T-2-08 | 02-07 | Repudiation | estimate diverging from the ledger | mitigate | `src/lib/estimate/estimate.ts` prices through the same `priceRequests`/`PRICE_BOOK` the ledger uses; exact-value tests red on a price-book constant change | closed |
| UI-SPEC Rule 5 | 02-07 | Tampering | `"use client"` on a data module | mitigate | `grep -rln 'use client' src/lib/ui/*.ts` → 0 files; `tests/unit/ui-maps.test.ts` two-sided grep for the directive | closed |
| T-2-04 | 02-08 | Tampering | read-then-spend race | mitigate | `tests/db/budget-concurrency.test.ts` `concurrent burst: 40 workers against a cap that fits 10` — grants, denials, `reserved+spent==cap`, 0 errors; mutation M7 reds exactly 3 named tests, direction-checked | closed |
| T-2-05 | 02-08 | Tampering | replayed settlement | mitigate | `tests/db/budget-meter.test.ts` `settlement idempotency` — one row, one balance move, `false` on replay; M9 reds it + 3 dependents, M9b isolates it alone | closed |
| T-2-06 | 02-08 | Denial of Service | crashed worker stranding budget | mitigate | Two self-heal tests (expired released / live not released) + the 40-way burst under a crashed-worker fixture; a mutation removing the self-heal block reds only the first | closed |
| T-2-07 | 02-08 | Tampering | breach by hand-written SQL | mitigate | `bp_not_over` asserted by `23514` with constraint name pinned; boundary-exact positive control at `cap = spent+reserved`; M8/M8b (02-VALIDATION.md:89-90) both applied and direction-checked | closed |
| T-2-02 | 02-08 | Elevation of Privilege | member raises the cap | mitigate | Two independent refusals (`set_budget_cap: admin role required` / grant-layer `permission denied for table budget_periods`), each with its own mutation (M10/M10b) and positive control; both Clerk claim spellings tested (`tests/db/_fixtures.ts` v1/v2) | closed |
| T-2-11 | 02-08 | Repudiation | forged actor on a cap change | mitigate | `cap change is audited` — raw SQL write, no app code in path, asserts actor+timestamp; `a reservation does NOT write an events row` proves trigger narrowing didn't disable the audit | closed |
| T-2-03 | 02-08 | Tampering | spending outside the meter | mitigate | Every settlement test goes through `app.settle_reservation` with a real reservation id; `cost_ledger.reservation_id` NOT NULL + FK closes any bypass attempt | closed |
| T-2-01 | 02-09 | Elevation of Privilege | server action POSTed directly | mitigate | `tests/unit/server-actions-guard.test.ts:78,180` — walks `src/server/actions/`, fails if any of the 6 action files omits `'use server';` as the literal first code line or calls `withOrg` before `requireOrg()`; confirmed live: `requireOrg` is the first statement in all six action files (grep, above) | closed |
| T-2-02 | 02-09 | Elevation of Privilege | member changes the cap | mitigate | `src/app/(app)/settings/budget/page.tsx:48-49` `orgRole === 'org:admin'` (affordance); `app.set_budget_cap` re-checks in SQL (boundary); `authenticated` holds no UPDATE grant on `budget_periods` | closed |
| T-2-03 | 02-09 | Tampering | spending outside the meter | mitigate | `src/server/actions/queue-run.ts` is the only action that can cause spend, goes through `app.reserve_budget`; no action writes `cost_ledger` directly (grep: `settle_reservation` appears only in comments under `src/`) | closed |
| T-2-10 | 02-09 | Information Disclosure | cross-org preset, version or run access by id | mitigate | `src/server/queries/presets.ts`, `preset-editor.ts`, `preset-cards.ts` all route through `withOrg`; `src/lib/ui/copy.ts:260-263` `NOT_FOUND` — one copy for "removed" and "another organisation", not distinguishable | closed |
| T-2-13 | 02-09 | Tampering | geocoder input | mitigate | `src/server/actions/geocode-address.ts` bounds the address before `src/lib/geocode/census.ts` bounds it again | closed |
| T-2-14 | 02-09 | Denial of Service | estimate as a compute oracle | mitigate | `requireOrg()` first in `estimate-preset.ts`; `src/server/queries/presets.ts:111,132` `cityIds.max(300)`, `clusterKeys.max(CLUSTER_KEYS.length)` bound the request server-side | closed |
| T-2-05 (deferred) | 02-09 | Tampering | settlement replay | **accept** | See **Accepted Risks Log** — `app.settle_reservation` is not called anywhere in Phase 2 (`grep -rn settle_reservation src/` matches only comments in `budget.ts`/`queue-run.ts`, confirmed live); the function, its `request_id UNIQUE`, and its proof all exist and are tested (02-05, 02-08) ahead of Phase 4's first billable call | closed (accepted) |
| T-2-01 | 02-10 | Elevation of Privilege | `(app)` route group | mitigate | `src/app/(app)/layout.tsx:48` `requireOrg()` is the first statement of the group layout (confirmed live, grep above); `src/proxy.ts` carries no `createRouteMatcher`/`auth.protect` (0 matches, confirmed live) | closed |
| T-2-10 | 02-10 | Information Disclosure | organization settings page | mitigate | `src/app/(app)/settings/organization/page.tsx:21,30,32` — `ensureOrgRow`/`auth()` only; no header/query/cookie read (confirmed by read) | closed |
| T-2-02 | 02-10 | Elevation of Privilege | "Raise the monthly cap" affordance | mitigate | `src/components/app-shell/budget-banner.tsx:121` "Ask an admin to raise the cap" for non-admins; affordance only, boundary is `set_budget_cap` (above) | closed |
| D-12 | 02-10 | Repudiation | threshold visibility | mitigate | `src/components/app-shell/budget-banner.tsx:98,133` `role="alert"` (100%) / `role="status"` (80%); `grep -cE 'onDismiss\|dismissible\|toast\('` → 0 in the file | closed |
| UI-SPEC Rule 7 | 02-10 | Tampering | retired test hooks | mitigate | 02-10-SUMMARY.md:90,202-207 — three testids moved with their spec in commit `dda2d9f`; `grep -rn 'data-testid="signed-in-as"' src/` → exactly 1 | closed |
| T-2-14 | 02-11 | Denial of Service | estimate action as a compute oracle | mitigate | `src/components/preset-editor/use-live-estimate.ts:43` `ESTIMATE_DEBOUNCE_MS = 400`; monotonic `seq` guard (below) gives one logical in-flight request; server action authenticates first | closed |
| T-2-13 | 02-11 | Tampering | geocoder input | mitigate | `src/components/preset-editor/radius-geocoder.tsx` calls the authenticated action only; renders the service's own `matchedAddress`, never echoing raw input | closed |
| T-2-01 | 02-11 | Elevation of Privilege | editor routes | mitigate | Both editor pages sit under `(app)`; every action they call re-checks `requireOrg()` independently (grep confirms all 6) | closed |
| Pitfall 5 | 02-11 | Tampering | stale estimate repainting | mitigate | `tests/unit/stale-estimate.test.tsx:13-14` — monotonic `seq` guard documented and tested, watched red with the guard deleted, in-order control stays green | closed |
| Recorded BIS defect | 02-11 | Tampering | form reset on a failed action | mitigate | `grep -rn '<form action' src/components/preset-editor/ src/app/(app)/presets/` → 0 matches; `onSubmit` + `useTransition` used instead (`src/server/actions/save-preset-version.ts:40-46` docblock, confirmed by the action's own call sites) | closed |
| T-2-04 | 02-12 | Tampering | reservation from the UI | mitigate | `src/components/preset-detail/run-drawer.tsx` calls `queueRun` only; `queueRun` is the sole path to `app.reserve_budget`'s conditional UPDATE | closed |
| T-2-10 | 02-12 | Information Disclosure | preset or version by id | mitigate | `getPreset` reads through `withOrg`; page renders `notFound()` (`src/app/(app)/presets/[id]/page.tsx:201`) rather than confirming existence | closed |
| T-2-12 | 02-12 | Tampering | a run re-pointed at another version | mitigate | UI never sends `search_version_id` on update; column grant excludes it (02-03/02-06 evidence, above) | closed |
| T-2-02 | 02-12 | Elevation of Privilege | "Raise the monthly cap" in the refusal | mitigate | `src/components/preset-detail/run-drawer.tsx:258` "Ask an admin to raise the cap" for non-admins | closed |
| D-12 | 02-12 | Repudiation | refusal visibility | mitigate | Refusal rendered as a persistent destructive `Alert` inside the drawer (confirmed by read, `run-drawer.tsx`), not a toast | closed |
| T-2-02 | 02-13 | Elevation of Privilege | cap edit | mitigate | `src/app/(app)/settings/budget/page.tsx:48-49` affordance; `src/server/actions/set-budget-cap.ts` re-checks; `app.set_budget_cap` re-checks in SQL; `authenticated` holds no UPDATE grant — four layers confirmed live | closed |
| T-2-15 | 02-13 | Information Disclosure | Google credential | mitigate | `grep -n 'GOOGLE\|X-Goog\|googleapis\|process.env' src/components/budget/*.tsx` → 0 matches | closed |
| T-2-10 | 02-13 | Information Disclosure | cross-org spend figures | mitigate | `src/server/queries/budget.ts:154,244,343` — `readCurrentPeriod`/`readSpendByProvider`/`readSpendByRun` all through `withOrg` | closed |
| T-2-07 | 02-13 | Tampering | cap input | mitigate | `src/server/actions/set-budget-cap.ts:77` `parseUsdToMicro(capUsd)`; `:109` `isCheckViolationOn(error, 'bp_not_over')` surfaces the real floor inline | closed |
| T-2-11 | 02-13 | Repudiation | cap change attribution | mitigate | `budget_periods_event_upd` trigger (02-05 evidence); 02-13-SUMMARY.md:189 — real `events` row (id 5254) pasted from a hand-verified read, plus rows 5509/5510 cited at line 326 | closed |
| D-14 | 02-13 | Repudiation | hidden zero-spend provider | mitigate | `src/components/spend/by-provider.tsx:29-41` — all three `PROVIDER_LABEL` entries render unconditionally, `'no calls yet'` when `calls <= 0` | closed |
| T-2-03 | 02-14 | Tampering | production spend path | mitigate | 02-14-SUMMARY.md — production schema verified via `information_schema.role_table_grants`: `authenticated` SELECT-only on all three budget tables, `cost_ledger.reservation_id NOT NULL` + FK, read from production not assumed | closed |
| T-2-02 | 02-14 | Elevation of Privilege | production cap | mitigate | 02-14-SUMMARY.md — post-flight confirms `authenticated` holds no INSERT/UPDATE/DELETE on `budget_periods` in production | closed |
| T-2-09 | 02-14 | Tampering | production reference rows | mitigate | 02-14-SUMMARY.md — seed run as owner behind `scripts/seed.ts`'s `--target=prod` gate; post-flight confirms reference tables' write policies exclude NULL-org rows | closed |
| T-2-12 | 02-14 | Tampering | production version and run integrity | mitigate | 02-14-SUMMARY.md — `information_schema.role_table_grants` for `search_versions`, `information_schema.column_privileges` for `runs.search_version_id`, both read from production (grant-level immutability, unaffected by the later composite-FK migrations 0017/0020 — see note below) | closed |
| T-2-15 | 02-14 | Information Disclosure | Google credential | mitigate | 02-14-SUMMARY.md:388,472-476 — `git grep` for credential-shaped strings finds none real; `no-google-credential.test.ts` re-run green; key still absent, quota set by a human in console | closed |
| Pitfall 1 | 02-14 | Tampering | PG18-only syntax reaching PG17 | mitigate | 02-14-SUMMARY.md:16,85 — "PostgreSQL 17.6 accepted every statement of migrations 0012–0016... proven on the real server", 17 journal rows | closed |
| T-1-10 (carried) | 02-14 | Information Disclosure | credentials in the SUMMARY | mitigate | 02-14-SUMMARY.md:472-476 — discriminating scan (live-shaped key regex, non-localhost connection strings) found no real credential; only a `pk_test_` placeholder and an illustrative `x`-password URL | closed |
| T-2-01 | 02-15 | Elevation of Privilege | the six new routes in production | mitigate | 02-15-SUMMARY.md — signed-out smokes of `/presets`, `/spend`, `/settings/budget` assert redirect + absence of `data-testid="org-id"`; authenticated e2e against the deployed URL with a real Clerk session | closed |
| T-2-04 | 02-15 | Tampering | the race-free meter, in production shape | mitigate | 02-VALIDATION.md:87 — mutation M7 re-run and recorded as run: naive body reds the 3-test concurrent burst, 87 single-worker tests stay green | closed |
| T-2-02, T-2-05, T-2-07, T-2-12 | 02-15 | Elevation / Tampering | admin gate, settlement, cap ceiling, version immutability | mitigate | 02-VALIDATION.md:87-99 — M7, M8, M8b, M9, M9b, M10, M10b, M11, M11b, M12, M12-delete, M12b **all re-run against the live local database** (not production), each reding exactly the predicted named test, reverted, verified byte-identical from `pg_get_functiondef`/catalog capture | closed |
| T-2-08 | 02-15 | Repudiation | ledger price from the mask | mitigate | 02-VALIDATION.md:95-96 — M11 appends `places.reviews` to `PLACES_TEXT_SEARCH_FIELD_MASK` (the source file, committed), reds `fieldMaskTier atmosphere` AND `price book atmosphere` in two different files; M11b isolates the price half alone | closed |
| T-2-15 | 02-15 | Information Disclosure | credentials in the deployed surface | mitigate | 02-15-SUMMARY.md:100-106 — `curl https://siteless-iota.vercel.app/api/health` body scanned, contains none of `postgres://`, `password`, `sk_`, the Supabase project ref | closed |
| T-1-35 (carried) | 02-15 | Tampering | a gate green on the wrong commit | mitigate | 02-15-SUMMARY.md:319,462 — branch + sha printed before AND after every long gate; unchanged (`main` @ `98d99ff`) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Open Threats

Both open rows trace to the same root cause: `02-REVIEW.md` found real gaps (CR-01, WR-04),
`02-REVIEW-FIX.md` fixed them correctly in code and in a local-only migration, and explicitly
recorded — in its own words — that production was **not** migrated:

> "🔴 Four new migrations were applied to the LOCAL `siteless_test` database only... Production
> is owed the same pre-flight read → danlo's approval → `db:migrate:prod` → post-flight read
> sequence plan 02-14 used. That is danlo's decision and his to run, not this agent's: no
> production connection was opened at any point in this pass." — `02-REVIEW-FIX.md`, "Production
> owed"

This audit is bound by the same constraint (no production connection), so it cannot itself
close these two rows. It can, however, state precisely what is and is not at risk today,
because both gaps were analyzed against the **current, already-deployed** application code path
rather than assumed:

### T-2-10 / 02-05 (WR-04 — `reserve_budget` accepts a foreign `p_run`)

**Missing evidence:** `drizzle/0020_yellow_ricochet.sql`'s `exists (select 1 from runs where id
= p_run and org_id = v_org)` check is not present in production's `app.reserve_budget` (last
migrated through `0016`, confirmed by `02-14-SUMMARY.md` line 129: 17 journal rows, none named
`0020`). This is a certain fact from the project's own migration record, independent of
whether the application layer has redeployed — a database function's body does not change
until a migration runs against that database.

**Why this is lower-risk than it looks:** the only application code path that calls
`app.reserve_budget` is `src/server/actions/queue-run.ts`, and its `p_run` argument is never
client-supplied — it is the id of a `runs` row the same transaction just inserted with
`values (app.current_org_id(), ...)` (`queue-run.ts` lines ~125-131, confirmed by read), so it
is always the caller's own org by construction. The vulnerable path requires either
hand-written SQL as the `authenticated` role (a much narrower trust boundary than the public
app) or a future code path that accepts a client-supplied run id. **Not exploitable through any
UI or server action shipped in this phase**, but the database-level wall the review demanded is
absent in production until the migration runs.

**Action:** `pnpm db:migrate:prod` for `0017`–`0020`, with the pre-flight read → approval →
post-flight read sequence `02-14` used, before Phase 4 introduces any client-supplied run id or
calls `app.settle_reservation` for the first time.

### T-2-10 / 02-03 (CR-01 — `savePresetVersion` cross-tenant version write)

**Missing evidence:** the composite-FK defense-in-depth (`drizzle/0017_strange_mathemanic.sql`)
is confirmed absent from production for the same reason as above. Unlike WR-04, this fix has
**two layers**, and only one is database-only:

1. **Database (`0017`, not on production):** composite `(search_id, org_id)` FK. Defense-in-depth
   against hand-written SQL or a future code path that skips the application check.
2. **Application (`src/server/actions/save-preset-version.ts:126-129`, in the repository at
   HEAD):** an ownership `SELECT` under RLS before the insert, returning `not_found` on a
   foreign or deleted id. This layer alone closes the exploit *as `02-REVIEW.md` described it*
   (an attacker driving the UI/action against a real foreign `searchId`), because the RLS-scoped
   SELECT simply returns no row for another tenant's search.

**Why this audit cannot close it anyway:** whether layer 2 is live on production depends on
whether Vercel has redeployed the app since commit `6b1bfd7`. `docs/deploy.md`'s "live
deployment" table records commit `6d6c52f` (predating the review) as the last **verified** sha
and was flagged stale by the review itself (IN-09); no later verification exists in the
repository. Because `vercel git connect` deploys on every push to `main` (`docs/deploy.md`
line 111), it is likely the application layer *is* live — but "likely" is not evidence this
audit can cite, and per this audit's own adversarial stance a mitigation is `open` until a
grep-equivalent — here, a live check — proves it, not until it is plausible.

**Action:** confirm the deployed commit (`curl` `/api/health`'s git-sha field or equivalent,
against `6b1bfd7` or later) and separately run the same `0017`–`0020` migration as above. Until
both are confirmed, treat the database-level wall as absent and the application-level wall as
unconfirmed.

**Not opened, and why:** `T-2-03`/`T-2-08` (WR-03 — `settle_reservation` trusting caller
`sku`/`provider`, and losing a ledger row on a late settle) rests entirely on
`app.settle_reservation`, which is not called by any Phase 2 code path (confirmed live, `grep
-rn settle_reservation src/` matches only comments) — the same fact this document's Accepted
Risks Log already relies on for `T-2-05 (deferred)`. The production copy of that function is
stale in exactly the same way as the two rows above, but nothing in this phase can reach it, so
it is not counted as an open threat here; it is folded into the same migration action item.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-03 | T-2-05 (deferred) (02-09, Tampering, settlement replay, low) | `app.settle_reservation` is not called anywhere in Phase 2 — confirmed live: `grep -rn settle_reservation src/` matches only explanatory comments in `src/db/schema/budget.ts` and `src/server/actions/queue-run.ts`, never a call site. Phase 4 makes the first billable call. The function, its `cost_ledger_request_id_key UNIQUE` constraint, and the settlement-idempotency proof all exist now (plans 02-05, 02-08) and are exercised by `tests/db/budget-meter.test.ts`, so the path is instrumented and tested before it is ever live, exactly as BUDG-01 requires. | plan author (02-09-PLAN.md `<threat_model>`) | 2026-09-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|----------------|--------|------|--------|
| 2026-09-22 | 82 | 80 | 2 | gsd-security-auditor |

**Supporting evidence for this run:**
- `pnpm test:unit --reporter=verbose` (via the pnpm store launcher; bare `pnpm` is the wrong
  version on this machine) → 20 files, **81/81 tests passed**
- `pnpm test:db --reporter=verbose` → 15 files, **102/102 tests passed** (local PostgreSQL
  18.6, `siteless_test`) — both counts match `02-REVIEW-FIX.md`'s recorded gate exactly, run
  independently by this audit rather than copied forward
- `02-REVIEW.md` (2026-09-22, status: `issues_found`) — 1 CRITICAL (CR-01) + 9 WARNINGs found
  across 124 reviewed files
- `02-REVIEW-FIX.md` (2026-09-22, status: `all_fixed`) — 10/10 in-scope findings (CR-01,
  WR-01…WR-09) fixed and committed (`6b1bfd7`, `a6139bc`, `d2bc23f`, `498008c`, `01f9afe`,
  `3d05833`, `c3acb46`, `98931a3`, `2db5d1a`, `90aa202`), each watched red first by test name,
  four new migrations (`0017`-`0020`) applied to the **local** database only, and this audit
  independently confirmed each fix's code and test evidence rather than trusting the fix
  report's own claims (CR-01, WR-01, WR-03, WR-04, WR-09 all re-verified against current source)
- `02-VALIDATION.md` — gate mutations M7–M12 (13 variants incl. M7+M8, M8b, M9b, M10b, M11b,
  M12-delete, M12b) recorded as run against the live local database in `02-15`, each reding the
  predicted named test(s), reverted, and verified byte-identical from the catalog; M12b is the
  one mutation that survived and produced a new guard (`tests/db/grants-audit.test.ts` "holds
  exactly the DML each Phase 2 table needs", commit `98d99ff`)
- Every plan's `## Threat Flags` section in its SUMMARY.md was read; all report "None" beyond
  the threats already in the register, except the one genuine cross-plan note in
  `02-01-SUMMARY.md` about the `no google credential` guard needing to exclude
  `next/font/google` — confirmed already excluded (see `no-google-credential.test.ts`'s
  pattern list above, which matches on credential shapes, not the bare substring `google`)
- **Production migration state independently confirmed, not assumed:** `02-14-SUMMARY.md` line
  129 records production's journal at 17 rows (`0000`…`0016`); `02-REVIEW-FIX.md`'s own
  "Production owed" section states `0017`-`0020` were applied locally only. No production
  connection was opened by this audit (forbidden by its own constraints) — the conclusion rests
  entirely on these two documents' own words, not on any live read

## Unregistered Flags

None. Every plan's `## Threat Flags` section maps its new surface to an existing threat ID in
the register above, or states "None" with a named reason (e.g., "no new network endpoint, no
new auth path, no schema change"). The one cross-plan note (`02-01-SUMMARY.md`'s warning about
`next/font/google` false-positiving the credential guard) was resolved before it ever shipped —
the guard's actual pattern list targets credential shapes, not the bare word `google` — and is
recorded as closed above rather than left as a flag.

## Observations

*(Not register rows — noted per this audit's own instructions, since they do not correspond to
a declared `<threat_model>` disposition.)*

1. **WR-02 (cap scope copy vs. enforcement) is deliberately deferred architecture, not a
   security gap.** `budget_periods` is keyed `(org, provider, month)`; the meter's entire
   concurrency guarantee rests on one conditional `UPDATE` touching one row, which a
   cross-provider ceiling cannot preserve without redesigning the meter. The review's fix
   (`d2bc23f`) corrected the copy to say what the meter actually enforces
   (`src/lib/ui/copy.ts:153` — "Applies to Places, the only provider Siteless spends on
   today.") rather than widen the enforcement to match a promise it can't atomically keep.
   Logged in `deferred-items.md` under danlo, with the Phase 5 trap named explicitly (a lazily
   created $50 Firecrawl row nobody set or sees). No threat register row covers "cap scope",
   so this is not counted as open, but it is the kind of thing that becomes one if Phase 5
   ships against the current schema unchanged.
2. **Ten Info-level findings (IN-01…IN-10) from `02-REVIEW.md` were out of scope for the fix
   pass** (`fix_scope: critical_warning`) and remain untouched. None are security-relevant by
   the review's own classification (comment drift, duplicate default strings, a `Date`
   double-computation, an unprefixed request-id collision surface across orgs at very low
   probability, a stale docs table, an Escape-key coupling to a Radix implementation detail).
   Not re-litigated here.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — 81 `mitigate`, 1 `accept`
- [x] Accepted risks documented in Accepted Risks Log (AR-03)
- [ ] `threats_open: 0` confirmed — **false; `threats_open: 2`**, both traced to the same
      unapplied production migration (`0017`–`0020`), not to a missing or untested code
      mitigation. See **Open Threats** for the exact action that closes each.
- [ ] `status: verified` set in frontmatter — **not set; `status: open`**, pending the
      migration + deployment confirmation named above

**Approval:** not verified — 2 threats open, both production-deployment gaps requiring
danlo's `pnpm db:migrate:prod` decision, consistent with `02-REVIEW-FIX.md`'s own deferral of
that step. Re-run this audit after the migration and a confirmed-commit deployment check.
