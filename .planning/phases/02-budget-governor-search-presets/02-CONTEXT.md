# Phase 2: Budget Governor & Search Presets - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

danlo can define and cost a search before it runs, and no code path in the system can spend a cent outside an atomic, race-free meter. Concretely: search presets (one or more of the four seeded industry clusters × a geography — seeded RGV city list, county, or radius around a geocoded point — saved, named, versioned, duplicable), a pre-run estimate (requests, dollars, expected results, against the month's remaining budget), a per-org monthly spend ledger with a reserve → spend → true-up meter that refuses at 100% and warns at 80%, a spend view broken down by provider and by run, and a Google Cloud per-API daily quota as an independent second wall. Phase 3 reads the geography and cluster seed defined here. This is the first phase with real screens; the design system is born in `/gsd-ui-phase 2`, which runs before planning.

Out of scope here: running searches against Google (Phase 4), tiling and saturation (Phase 4), the scheduler and rotating partitions (Phase 9), verification spend (Phase 5), cost-per-lead headline numbers (BUDG-05, later).

</domain>

<decisions>
## Implementation Decisions

### Geography & cluster input
- **D-01:** A preset's geography supports **all three modes in this phase**: a picker over the seeded RGV city list, a county picker, and a radius around a geocoded address. All three are `geo_presets.kind` values in the research schema; none is deferred.
- **D-02:** The radius center is geocoded with the **US Census Geocoder** (free, no key, US-only). Geocoding is therefore not a paid call and never touches the cost ledger. Google Geocoding is not used.
- **D-03:** The industry side is the **four seeded clusters, atomic**. A preset picks one or more clusters; the Places types and NAICS ranges inside a cluster are seed data, not per-preset toggles. Per-type exclusion is deferred (see Deferred Ideas).
- **D-04:** "Texas-wide" is a **seeded, built-in "Texas (254 counties)" geo preset** beside the RGV ones. The estimator treats it like any geography; the estimate screen shows its cost as a multiple of the RGV preset (e.g. "×38 vs RGV"). Nothing is special-cased.
- **D-05:** Seed data ships as reference rows with `org_id IS NULL` (research: ARCHITECTURE.md § Search definition) so "RGV presets ship built-in" and "every table carries org_id" coexist: read policy `org_id is null or org_id = app.current_org_id()`, write policy `org_id = app.current_org_id()`, so nobody can mutate a built-in. Phase 1's D-10 schema-audit allow-list must be extended deliberately for these reference tables, not bypassed.

### Cost estimate & result count
- **D-06:** The pre-run estimate shows **requests, dollars, expected results, and the share of this month's remaining budget** (e.g. "~68 requests · ~$2.40 · ~1,100 businesses · 4.8% of remaining $47.60"). Request counts stay visible because they are what makes the Texas multiplier legible.
- **D-07:** The estimate is a **range, not a point**: low–high from 1 to 3 result pages per query leg, with the query fan-out / tile-overlap multiplier the research left unmeasured shown as a **visible, editable assumption stored as a committed constant**, to be trued up with real invoice data at the Phase 6 gate. The estimator is built as a committed test against the real seeded cell list (ROADMAP note), never a spreadsheet.
- **D-08:** The estimate is **live as you edit, debounced** — a server action recomputes on every change to clusters or geography; there is no Estimate button. Estimation makes no paid call.
- **D-09:** Expected result counts come from **seeded TX Comptroller active-outlet counts per (county, cluster/NAICS range)** — measured in DATA-SOURCES.md (34,928 RGV outlets; Hidalgo 21,062 / Cameron 12,313 / Starr 1,226 / Willacy 327). City-list and radius presets apportion from county counts. $0, testable without a Google key. A live Places IDs-only probe is not used for estimation.

### Cap policy & threshold behaviour
- **D-10:** The monthly cap is **per org, editable in-app on a budget settings screen (admin only), default $50**. The meter row is keyed `(org_id, provider, month)` as Phase 1 deferred. Changing the cap is an audited state change like any other write (Phase 1 D-06/D-07 apply).
- **D-11:** The budget month is the **calendar month in `America/Chicago`**, resetting at local midnight on the 1st. The period-boundary test pins zone AND locale and asserts one instant in two zones with opposite verdicts (Phase 1 rule).
- **D-12:** **At 80%:** a persistent dashboard warning plus an `events` row. **At 100%:** every new reservation is refused; an in-flight run finishes the call it already reserved, records why it stopped, and ends as `partial` with a consistent result set — never a half-written lead. **No email or other outbound notification in this phase.**
- **D-13:** **One cap, no separate ad-hoc allowance.** Manual runs draw from the same monthly meter as scheduled ones.
- **D-14:** The spend view shows **month-to-date per provider (Places, Firecrawl, Anthropic) versus the cap, plus a per-run list with each run's cost**, fed by one ledger row per paid call (`{provider, sku, units, cost_cents, run_id, lead_id?}` per BUDG-01). Layout is the design-system pass's; the information architecture is fixed here.

### Preset versioning
- **D-15:** **Every saved edit creates a new immutable version row automatically**; the preset's "current" pointer moves. No drafts. A run always references the version that produced it (SRCH-03).
- **D-16:** **Version history is visible on the preset page**: a version list showing what changed (clusters / geography diff) and "used by N runs" per version. **Any version is re-runnable** explicitly; the default Run action uses the current version.
- **D-17:** **Duplicate** creates a new preset (version 1) copied from any chosen version, named "Copy of …".

### Claude's Discretion
- The **Google Cloud per-API daily quota value** (BUDG-03), derived from the cap: at $50/mo and Text Search Enterprise at $35/1,000 with 1,000 free, roughly 80–100 requests/day is the ceiling — pick the number, document the derivation, and make setting it a `checkpoint:human-action` because the **Google Cloud project and Places API (New) key do not exist yet** (PROJECT.md "Dependencies not yet created"). The quota is a second wall, not the primary meter; the plan must not make the app depend on the key existing to pass its tests (msw-recorded payloads, D-04 CI-never-spends).
- The **reserve → call → settle mechanics**: the single conditional `UPDATE … WHERE spent + reserved + n <= cap RETURNING id` on one `budget_periods` row per (org, provider, month); `cost_reservations` with a TTL; idempotent settlement keyed by request id; a sweeper that releases expired reservations (pg_cron is acceptable for this housekeeping per STACK.md, but its availability on the Supabase plan is LOW-confidence — verify against the real project or run the sweeper from Vercel Cron). The concurrency proof (success criterion 5) is a real multi-worker test against the local database, not a mock.
- `fieldMaskTier()` and the SKU price table as pure, unit-tested functions that **refuse an unknown field**; cost derives from the mask actually sent (PITFALLS Pitfall 1), never from a per-call constant — plus the mutation check that appending an Enterprise field changes the ledger price.
- Exact table shapes and names (research proposes `industry_clusters`, `industry_terms`, `geo_presets`, `searches`, `budget_periods`, `cost_reservations`, `cost_ledger`, `runs`); micro-USD vs cents storage (BUDG-01 says `cost_cents`; research uses `micro_usd` — pick one and keep the ledger row shape from BUDG-01 as the external contract).
- Seed-data file format and loader (a committed migration vs a `tsx scripts/seed.ts`), the RGV 17-city list source (FEATURES research names "RGV's 17"; DATA-SOURCES gives county codes 031/108/214/245), and the county → NAICS count table's refresh story.
- Which events the ledger and preset tables emit through Phase 1's trigger pattern versus `app.emit_event` — `cost_ledger` is high-volume, so row triggers on it are a T-1-32 concern; state-bearing tables (`searches`, versions, `budget_periods` cap changes) get the standard attribution.
- The runs table lands here only as far as presets need it (a run points at a version, has a cost, and can be `partial`); executing runs is Phase 4's.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` § Phase 2 — goal, five success criteria, UI hint, security note, the "committed cost-model test" note
- `.planning/REQUIREMENTS.md` — BUDG-01…BUDG-04 (lines 74–77), SRCH-01…SRCH-04 (lines 21–24)

### Research (project-level, already decided)
- `.planning/research/ARCHITECTURE.md` § "Search definition (reference rows are global; org_id IS NULL = built-in)" (~L107) — the preset/geo/cluster schema and the null-org RLS pattern
- `.planning/research/ARCHITECTURE.md` § "Pattern 2: Reserve → call → settle" (~L409) — the race-free meter, `app.reserve_budget`, settlement, sweeper, and the PostgreSQL READ COMMITTED citation
- `.planning/research/ARCHITECTURE.md` § "Cost Model" (~L570) — verified SKU prices and the µUSD-per-business arithmetic
- `.planning/research/ARCHITECTURE.md` anti-pattern § "3. Check-then-spend budgeting" (~L791)
- `.planning/research/STACK.md` § "The budget cap — build it as two walls, not one" (~L113–120) — `fieldMaskTier()`, non-retryable halt, reservation TTL
- `.planning/research/FEATURES.md` § A "Search presets" (~L100–103) and § K "Cost dashboard + budget caps" (~L192–209); dependency graph (~L248–268: instrument the ledger FIRST)
- `.planning/research/PITFALLS.md` Pitfall 1 (field-mask SKU, ~L41–47), Pitfall 2 (budget arithmetic and the committed model test, ~L74–99), Pitfall 7 (tiling/double-billing — Phase 4 context, ~L237–274), Pitfall 9 (read-then-spend races, retry amplification, duplicate cron, ~L306)
- `.planning/research/DATA-SOURCES.md` — RGV county codes (Cameron 031, Hidalgo 108, Starr 214, Willacy 245), outlet counts by county and by cluster (~L308–331), NAICS cluster ranges

### Locked by Phase 1
- `.planning/phases/01-foundations-tenancy/01-CONTEXT.md` — D-01…D-11b (tenancy, events, drizzle-kit authority, test database, RLS proof standard)
- `.planning/CONVENTIONS.md` — § Migrations, § Grants (every new table's migration grants its DML explicitly and extends `TENANT_TABLES` in `tests/db/grants-audit.test.ts`), § Audit and attribution
- `.planning/phases/01-foundations-tenancy/01-VALIDATION.md` — the gate-mutation standard (M1–M6 as run)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema/_helpers.ts` — `orgScoped()` table helper and `orgPolicies()` policy factory (InitPlan-wrapped predicates, `_org_idx` per table); reference tables with `org_id IS NULL` need a variant read policy, not a bypass
- `src/db/with-org.ts` — `withOrg()` is the one runtime database entry point (transaction-local claims, `set local role authenticated`); every server action in this phase goes through it
- `drizzle/0007_event_triggers.sql` — `app.log_event()` and `app.touch_updated_at()` triggers for state-bearing tables; `drizzle/0011_events_no_caller_insert.sql` — `app.emit_event` for application-emitted events (threshold crossings, cap changes)
- `drizzle/0009_ensure_org_no_write.sql` — the select-then-do-nothing idempotency shape to copy for "get or create this month's budget period"
- `src/lib/time.ts` — `APP_TZ`, `localDate` helpers; the month-boundary logic builds on these
- `src/lib/export/registry.ts` + `tests/unit/no-internal-leak.test.ts` — the internal-annotation sentinel; presets carry `name_internal` vs `display_name` (research schema) and must register with it
- `tests/db/_fixtures.ts` — `withRollback` / `actAs` / `actAsRole` / `seedTwoOrgs`; the concurrency test (criterion 5) will need real parallel connections, not a rolled-back single transaction
- `scripts/db.ts` — `db:custom` for hand-written SQL (functions, policies), `db:generate` for schema-derived migrations, `db:migrate` / `db:migrate:prod`
- `src/env.ts` — fail-loudly env guard; new variables (Google key when it exists) are declared here, names only in `.env.example`

### Established Patterns
- Every table: `org_id`, RLS, explicit grants in the same migration (0008 retired the platform default ACL), a row in `TENANT_TABLES`; the schema-audit test fails otherwise
- Proof standard: watched failing first, SQLSTATE pinned, one refused statement per rolled-back transaction, one named mutation per guard run on the live local database
- Timezone: zone AND locale pinned; one instant, two zones, opposite verdicts
- pnpm on this machine only through the store launcher (see 01-01-SUMMARY deviation 1); `--reporter=verbose` on filtered vitest runs

### Integration Points
- `src/db/schema/index.ts` — new schema modules register here
- `src/app/` — the unstyled shell (`/`, `/no-access`, `/sign-in`, `/api/health`) gains the preset list/detail, budget settings and spend views; `requireOrg()` guards every page
- `.github/workflows/ci.yml` — verify / db / e2e jobs; the DB suite runs as `app_user` against a `postgres:18` service; CI must never spend a paid API (msw-recorded payloads)
- `tests/e2e/` — Playwright against the deployed URL; new screens get specs with `data-testid` hooks, no `setActive` workarounds

</code_context>

<specifics>
## Specific Ideas

- Estimate line as danlo wants to read it: "~68 requests · ~$2.40 · ~1,100 businesses · 4.8% of this month's remaining $47.60", with the range and the multiplier assumption one tap away.
- Texas-wide reads as a multiple: "×38 vs RGV".
- Duplicated presets are named "Copy of …".
- The 80% warning is a persistent banner, not a toast.

</specifics>

<deferred>
## Deferred Ideas

- **Per-type toggles inside a cluster** (exclude e.g. `car_wash` from auto & retail) — later phase; presets stay cluster-atomic in v1.
- **Email / outbound alerts at 80% and 100%** — no outbound channel in this phase; dashboard + events only.
- **A separate hard-capped ad-hoc allowance** — one meter in v1.
- **Google Geocoding API** as a higher-accuracy geocoder — only if Census proves insufficient on RGV addresses.
- **Preset archiving / soft delete** — not discussed; if needed, follow the `status` + events pattern rather than DELETE.
- **Cost-per-verified-lead headline** (BUDG-05) — needs Phase 5 verification data.

</deferred>

---

*Phase: 02-budget-governor-search-presets*
*Context gathered: 2026-09-22*
