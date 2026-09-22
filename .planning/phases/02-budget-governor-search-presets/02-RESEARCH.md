# Phase 2: Budget Governor & Search Presets — Research

**Researched:** 2026-09-22
**Domain:** Race-free spend metering in PostgreSQL · versioned search specifications · free-source cost estimation · the birth of the design system
**Confidence:** HIGH on the meter, the seed data and the SKU table (executed locally / queried live); MEDIUM on what `shadcn init` writes into this specific repo (not run, by instruction)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Geography & cluster input**
- **D-01:** A preset's geography supports **all three modes in this phase**: a picker over the seeded RGV city list, a county picker, and a radius around a geocoded address. All three are `geo_presets.kind` values in the research schema; none is deferred.
- **D-02:** The radius center is geocoded with the **US Census Geocoder** (free, no key, US-only). Geocoding is therefore not a paid call and never touches the cost ledger. Google Geocoding is not used.
- **D-03:** The industry side is the **four seeded clusters, atomic**. A preset picks one or more clusters; the Places types and NAICS ranges inside a cluster are seed data, not per-preset toggles. Per-type exclusion is deferred (see Deferred Ideas).
- **D-04:** "Texas-wide" is a **seeded, built-in "Texas (254 counties)" geo preset** beside the RGV ones. The estimator treats it like any geography; the estimate screen shows its cost as a multiple of the RGV preset (e.g. "×38 vs RGV"). Nothing is special-cased.
- **D-05:** Seed data ships as reference rows with `org_id IS NULL` (research: ARCHITECTURE.md § Search definition) so "RGV presets ship built-in" and "every table carries org_id" coexist: read policy `org_id is null or org_id = app.current_org_id()`, write policy `org_id = app.current_org_id()`, so nobody can mutate a built-in. Phase 1's D-10 schema-audit allow-list must be extended deliberately for these reference tables, not bypassed.

**Cost estimate & result count**
- **D-06:** The pre-run estimate shows **requests, dollars, expected results, and the share of this month's remaining budget** (e.g. "~68 requests · ~$2.40 · ~1,100 businesses · 4.8% of remaining $47.60"). Request counts stay visible because they are what makes the Texas multiplier legible.
- **D-07:** The estimate is a **range, not a point**: low–high from 1 to 3 result pages per query leg, with the query fan-out / tile-overlap multiplier the research left unmeasured shown as a **visible, editable assumption stored as a committed constant**, to be trued up with real invoice data at the Phase 6 gate. The estimator is built as a committed test against the real seeded cell list (ROADMAP note), never a spreadsheet.
- **D-08:** The estimate is **live as you edit, debounced** — a server action recomputes on every change to clusters or geography; there is no Estimate button. Estimation makes no paid call.
- **D-09:** Expected result counts come from **seeded TX Comptroller active-outlet counts per (county, cluster/NAICS range)** — measured in DATA-SOURCES.md (34,928 RGV outlets; Hidalgo 21,062 / Cameron 12,313 / Starr 1,226 / Willacy 327). City-list and radius presets apportion from county counts. $0, testable without a Google key. A live Places IDs-only probe is not used for estimation.

**Cap policy & threshold behaviour**
- **D-10:** The monthly cap is **per org, editable in-app on a budget settings screen (admin only), default $50**. The meter row is keyed `(org_id, provider, month)` as Phase 1 deferred. Changing the cap is an audited state change like any other write (Phase 1 D-06/D-07 apply).
- **D-11:** The budget month is the **calendar month in `America/Chicago`**, resetting at local midnight on the 1st. The period-boundary test pins zone AND locale and asserts one instant in two zones with opposite verdicts (Phase 1 rule).
- **D-12:** **At 80%:** a persistent dashboard warning plus an `events` row. **At 100%:** every new reservation is refused; an in-flight run finishes the call it already reserved, records why it stopped, and ends as `partial` with a consistent result set — never a half-written lead. **No email or other outbound notification in this phase.**
- **D-13:** **One cap, no separate ad-hoc allowance.** Manual runs draw from the same monthly meter as scheduled ones.
- **D-14:** The spend view shows **month-to-date per provider (Places, Firecrawl, Anthropic) versus the cap, plus a per-run list with each run's cost**, fed by one ledger row per paid call (`{provider, sku, units, cost_cents, run_id, lead_id?}` per BUDG-01). Layout is the design-system pass's; the information architecture is fixed here.

**Preset versioning**
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

### Deferred Ideas (OUT OF SCOPE)
- **Per-type toggles inside a cluster** (exclude e.g. `car_wash` from auto & retail) — later phase; presets stay cluster-atomic in v1.
- **Email / outbound alerts at 80% and 100%** — no outbound channel in this phase; dashboard + events only.
- **A separate hard-capped ad-hoc allowance** — one meter in v1.
- **Google Geocoding API** as a higher-accuracy geocoder — only if Census proves insufficient on RGV addresses.
- **Preset archiving / soft delete** — not discussed; if needed, follow the `status` + events pattern rather than DELETE.
- **Cost-per-verified-lead headline** (BUDG-05) — needs Phase 5 verification data.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **BUDG-01** | Every outbound paid API call writes a cost-ledger row `{provider, sku, units, cost_cents, run_id, lead_id?}` — instrumented before the first billable call | § Cost Model & Units (µUSD vs cents — **decided by arithmetic, not taste**); § Pattern 2 (`settle()` writes the ledger row, `request_id UNIQUE` makes it idempotent); § Don't Hand-Roll (ledger row shape); verified: one Enterprise request = **3.50 cents**, not an integer |
| **BUDG-02** | A monthly cap (default < $50) enforced by an atomic reserve → spend → true-up that refuses at 100% and warns at 80%, gating enumeration and verification | § Pattern 2 + § Pattern 2b (self-healing reserve). **Proven locally**: 40 concurrent connections, cap 100, unit 10 → exactly 10 granted / 30 denied / 0 over-spend; the naive check-then-spend control over-spent **4×** under the identical burst |
| **BUDG-03** | A Google Cloud per-API daily quota is configured as an independent second wall | § The Second Wall — console path verified, quota metric named, **100 requests/day** recommended with the full derivation, expressed as `checkpoint:human-action` (the GCP project does not exist) |
| **BUDG-04** | The dashboard shows month-to-date spend versus the cap, broken down by provider | § Architecture Patterns → Spend read model; § Validation Architecture (e2e map); UI-SPEC § 5 is the layout contract |
| **SRCH-01** | Define a search as clusters × geography (city list, county, radius around a geocoded point) and save it as a named preset | § Schema — `industry_clusters` / `geo_presets` / `searches` / `search_versions`; § Census Geocoder (verified live against RGV addresses, incl. every failure mode) |
| **SRCH-02** | Four clusters, RGV city list and four RGV counties ship as seed data; Texas-wide is expressible with a visible cost multiplier | § Seed Data — **all counts re-measured live** from Socrata `jrea-zgmq`; the 17-city list *derived and defined* (it exists nowhere in the research corpus); the 254 TX counties sourced from `national_county2020.txt`; **Comptroller code ≠ FIPS** — both ship |
| **SRCH-03** | Presets are versioned — editing creates a new version; past runs keep pointing at the version that produced them | § Versioned Presets — immutable `search_versions` + moving `current_version_id`, `runs.search_version_id` FK with `on delete no action`, version immutability by GRANT |
| **SRCH-04** | User sees an estimated cost and estimated result count before saving or running a preset | § The Estimator — inputs, the committed-constant fan-out, the **free-allowance correction the UI-SPEC's example omits**, and the Texas multiplier as a computed value (≈15×, not the illustrative 38×) |
</phase_requirements>

---

## Summary

Three things in this phase are load-bearing and each has a single correct shape.

**The meter.** The race-free cap is not a design problem, it is a one-statement problem, and I executed it rather than reasoned about it. On the real local PostgreSQL 18.6, a single conditional `UPDATE budget_periods SET reserved = reserved + n WHERE … AND spent + reserved + n <= cap RETURNING id`, hit by **40 genuinely concurrent connections** against a cap that fits exactly 10 reservations, granted exactly 10, denied 30, left `reserved == cap`, and raised no errors. The same burst against the naive `SELECT`-then-`UPDATE` granted **all 40 and over-spent by 4×** — so the concurrency test discriminates, which is the property that matters. `SELECT … FOR UPDATE` is also correct and measured identically fast (72 ms vs 74 ms for 40 workers); the conditional `UPDATE` wins on *correctness by construction* — one statement, no window in which application code can crash, and nothing to forget. Two additions I proved worth having: a table `CHECK (spent + reserved <= cap)` that refuses a hand-written over-reserve with `23514` **and** refuses lowering the cap below `spent + reserved` (exactly the UI-SPEC's "cap below current spend" error, enforced by the database); and a **self-healing reserve** that releases this budget row's expired reservations inside the same call — with a crashed worker holding 100% of the cap in expired reservations, the next burst freed it and granted correctly, which takes the sweeper off the correctness path entirely.

**The seed data.** Everything the estimator needs was re-measured live rather than copied. The four RGV counties return 12,313 / 21,062 / 1,226 / 327 outlets and the four clusters return 1,452 / 5,572 / 977 / 15,977 — matching DATA-SOURCES.md exactly, so its numbers are good. Two things it does *not* contain: the "RGV 17" city list exists nowhere in the corpus (FEATURES says 17, DATA-SOURCES says 22, COMPETITORS says ~20), and the county codes it gives (031/108/214/245) are **Texas Comptroller codes, not FIPS** — Census returns Hidalgo as **215**. Both numbering systems are needed (Comptroller for Phase 3's Socrata ingest, FIPS for the geocoder's county resolution and the 254-county Texas preset), there is **no safe arithmetic conversion by name-sorting** (15 of 254 counties break it), but there *is* an exact one I verified across all 254: Texas FIPS codes are the contiguous odd integers 1…507, so `comptroller = (fips + 1) / 2` holds as a bijection. Ship the table anyway; assert the identity in a test.

**The design system is born here, and the Clerk role claim is a trap.** `shadcn@4.21.0`'s flags are exactly as UI-SPEC records them (there is no `--base-color`; `nova` binds Geist and `neutral`, so both the Inter swap and `migrate base-color --to zinc` are mandatory follow-ups in the same task). The non-obvious hazard is elsewhere: D-10 makes cap edits admin-only, and I decoded danlo's **real** stored Clerk session token — it is `v: 2` with `o.rol = "admin"` (bare), while `@clerk/shared`'s parser builds `auth().orgRole` as `` `org:${o.rol}` `` = `"org:admin"`. **The TypeScript side and the SQL side spell the same role differently**, there is no flat `org_role` claim on this instance, and a naive `coalesce(app.jwt()->'o'->>'rol', app.jwt()->>'org_role')` compares `'admin'` to `'org:admin'`. This is the exact sibling of Phase 1's D-11 "highest-probability silent failure".

**Primary recommendation:** build the meter as `app.reserve_budget()` — a `SECURITY DEFINER` function that self-heals expired reservations and then applies **one** conditional `UPDATE`, returning the reservation id *and* the post-update utilisation so the 80%/100% thresholds are decided in the same statement; store **micro-USD `bigint`** and expose `cost_cents` as a generated `numeric(12,2)` column (one Text Search Enterprise request is 3.50 ¢, and integer-cent rounding is a ±14.3 % error on a $50 cap); seed reference rows with `org_id IS NULL` from a `tsx scripts/seed.ts` runner reading committed JSON, with a `UNIQUE NULLS NOT DISTINCT` key because a plain `UNIQUE (org_id, key)` **does not stop duplicate built-ins**; and treat the Google quota as a `checkpoint:human-action` at **100 requests/day** that no test depends on.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Budget reservation / refusal at 100% | **Database** (`app.reserve_budget`, `SECURITY DEFINER`) | API (server action calls it) | Concurrency control is a row-lock property. Any tier above the row can be raced; the conditional `UPDATE` cannot. Proven locally under a 40-way burst. |
| Cap ceiling invariant (`spent + reserved ≤ cap`) | **Database** (`CHECK` constraint) | — | A constraint refuses even hand-written SQL and even a bug inside the definer function. Verified: `23514 bp_not_over`. |
| Admin-only cap edit | **Database** (definer function re-checking `app.jwt()->'o'->>'rol'`) | Frontend Server (`auth().has({role:'org:admin'})` for rendering) | Mirrors Phase 1's `app.ensure_org` shape: the UI check is for affordance, the DB check is the boundary. |
| Reservation expiry / release | **Database** (inline in `reserve_budget`) | CDN/Cron (optional hygiene sweep, Phase 9) | Self-healing removes the external scheduler from the correctness path; verified against a crashed-worker fixture. |
| Cost derivation from the field mask | **API / server module** (`fieldMaskTier()` pure fn) | Database (`cost_ledger.sku` records the outcome) | The mask is a request-shaping decision; the price table is data. Both unit-testable with zero I/O. |
| Cost / result estimation | **Frontend Server** (server action over seeded tables) | Database (seeded counts) | Pure read + arithmetic. No paid call (D-08). Must run server-side so the price table and the remaining budget are never client-trusted. |
| Address → lat/lng + county | **API / server** (Census Geocoder via `fetch` + zod) | — | Third-party, untrusted, US-only, HTTP 200 on failure. Never called from the browser: the response shape must be validated once, server-side. |
| Preset / version persistence + diff | **Database** (immutable version rows) | Frontend Server (diff rendering) | SRCH-03's "a past run still points at the version that produced it" is a referential-integrity property, not a UI one. |
| Tenant isolation + built-in immutability | **Database** (RLS policies) | — | Phase 1's contract. Verified: built-in mutation is a silent zero-row filter, *not* a refusal — the test must assert `rowCount === 0`. |
| Month boundary (`America/Chicago`) | **Database** (`at time zone`) **and** API (`src/lib/time.ts`) | — | Both tiers bucket days; CONVENTIONS § Time already forbids a bare `::date`. One instant, two zones, opposite verdicts — verified in SQL. |
| Theme, layout, thumb-zone, live estimate UI | **Browser / Client** | Frontend Server (RSC shell) | UI-SPEC is the contract. Client only for `next-themes`, drawers, debounce and the estimate region. |

---

## Standard Stack

### Core (already installed — do not re-decide)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.3.5` | App framework | Installed. Turbopack default; `src/proxy.ts` already in place. `[VERIFIED: package.json]` |
| `react` / `react-dom` | `19.3.0` | UI | Installed; Clerk 7.9.4's peer is `~19.3.0-0` — do not float. `[VERIFIED: package.json]` |
| `drizzle-orm` / `drizzle-kit` | `0.45.2` / `0.31.10` | Schema + migrations | Single migration authority (D-09). Supports `unique().nullsNotDistinct()` — needed for reference rows. `[VERIFIED: node_modules/drizzle-orm/pg-core/unique-constraint.d.ts]` |
| `postgres` (postgres.js) | `3.4.9` | Driver | `prepare:false`, `max:1`. `[VERIFIED: src/db/client.ts]` |
| `zod` | `4.6.5` | Runtime validation | Every Census Geocoder response. `[VERIFIED: package.json]` |
| `@clerk/nextjs` | `7.9.4` | Auth + org role | `auth().orgRole` → `'org:admin'`. `[VERIFIED: @clerk/shared/dist/jwtPayloadParser.mjs]` |

### New in this phase — UI
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `tailwindcss` | `4.3.3` | Styling engine | Current latest, published 2026-09-08. `[VERIFIED: npm view]` |
| `@tailwindcss/postcss` | `4.3.3` | PostCSS plugin | Next 16's own docs name exactly this package + a `postcss.config.mjs`. `[CITED: nextjs.org/docs/app/getting-started/css, v16.3.5, updated 2026-08-25]` |
| `lucide-react` | `1.47.0` | Icons | Current latest, 2026-09-17. `[VERIFIED: npm view]` |
| `class-variance-authority` | `0.7.1` | Variant props | shadcn dependency. `[VERIFIED: npm view]` |
| `tailwind-merge` | `3.7.0` | `cn()` | 2026-09-13. `[VERIFIED: npm view]` |
| `next-themes` | `0.4.6` | Light/dark | Peer `react ^19` ✓. `[VERIFIED: npm view peerDependencies]` |
| `sonner` | `2.0.8` | Toasts | Peer `react ^19.0.0` ✓. `[VERIFIED: npm view peerDependencies]` |
| `vaul` | `1.1.2` | Drawer (via shadcn Radix base) | Peer `react ^19.0.0` ✓. `[VERIFIED: npm view peerDependencies]` |
| `motion` | `13.4.0` | Estimate/gauge transitions | Peer `react ^18 \|\| ^19` ✓. `[VERIFIED: npm view peerDependencies]` |
| `radix-ui` primitives | pulled by `shadcn add` | Behaviour | `-b radix` keeps `vaul` honest (UI-SPEC OQ 3). |

### New in this phase — test harness (Wave 0)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@testing-library/react` | `16.3.3` | Component tests | Peer `react ^19` ✓. `[VERIFIED: npm view]` |
| `@testing-library/jest-dom` | `7.0.1` | DOM matchers | `[VERIFIED: npm view]` |
| `jsdom` | `30.1.1` | DOM env for vitest | `[VERIFIED: npm view]` |
| `@vitejs/plugin-react` | `6.1.1` | JSX transform for vitest | Needed for `.test.tsx` under `vite@8.3.0`. `[VERIFIED: npm view]` |
| `msw` | `2.15.0` | Network mocking | Only for the **Census Geocoder** in this phase — there is no Places call yet. `[VERIFIED: npm view]` |

> **`recharts` does not enter the bundle** (UI-SPEC). The gauge is `Progress` + painted divs.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Conditional `UPDATE` meter | `SELECT … FOR UPDATE` then `UPDATE` | Equally correct, measured equally fast (74 ms vs 72 ms for 40 workers). Rejected because it is two statements: a crash or an early `return` between them leaks the lock-free window back in, and nothing in the type system stops a future caller from omitting `FOR UPDATE`. |
| Conditional `UPDATE` meter | `pg_try_advisory_lock` | Adds a lock namespace to reason about and does not survive a connection drop cleanly. The row lock is already the correct granularity. |
| Self-healing reserve | `pg_cron` sweeper | `pg_cron 1.6.4` **is available** on the real Supabase project (verified), but a scheduler on the correctness path means a paused project silently strands budget. Keep pg_cron/Vercel Cron as Phase 9 hygiene. |
| `micro_usd bigint` | `cost_cents integer` | Rejected on arithmetic: 1 Text Search Enterprise request = 3.50 ¢. Rounding per call is ±14.3 % over 1,428 requests (verified: $57.12 vs $42.84 vs the true $49.98). |
| Server action for the live estimate | `GET` Route Handler | **Next.js Server Actions execute sequentially/queued** `[CITED: github.com/vercel/next.js/discussions/50743]`. D-08 locks the server action; mitigate with a monotonic request id client-side. A `GET` handler would parallelize and be `AbortController`-cancellable — note it as the fallback if the estimate feels laggy. |
| `tsx scripts/seed.ts` loader | Seed rows inside a committed migration | A migration is immutable-by-checksum, which is wrong for a **refreshable** counts table (Comptroller `rowsUpdatedAt` was 2026-09-19). Ship the *schema* in a migration and the *rows* through an idempotent script. |

**Installation (pinned; through the store launcher, never bare `pnpm`):**
```bash
# Task 1 — shadcn init writes its own deps at floating versions; pin immediately after.
node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs \
  add tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 lucide-react@1.47.0 \
      class-variance-authority@0.7.1 tailwind-merge@3.7.0 next-themes@0.4.6 \
      sonner@2.0.8 vaul@1.1.2 motion@13.4.0

# Wave 0 — component-test harness
… -D @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 jsdom@30.1.1 \
     @vitejs/plugin-react@6.1.1 msw@2.15.0
```

---

## Architecture Patterns

### System Architecture Diagram

```
  BROWSER                        │ FRONTEND SERVER (Next 16 RSC)      │ DATABASE (Supabase PG 17.6 / local PG 18.6)
 ─────────────────────────────── │ ────────────────────────────────── │ ────────────────────────────────────────────
                                 │                                    │
 /presets/new                    │                                    │
   ├─ edit clusters ─┐           │                                    │
   └─ edit geography─┤           │                                    │
                     ▼           │                                    │
              debounce 400ms     │                                    │
                     │           │                                    │
                     ├───────────▶ estimatePreset(spec)  "use server" │
                     │             ├─ requireOrg()                    │
                     │             ├─ withOrg(tx) ────────────────────▶ SELECT outlet counts  (org_id IS NULL rows)
                     │             │                                  │ SELECT budget_periods (this month, Chicago)
                     │             ├─ expandCells(spec) ──┐           │
                     │             ├─ priceRequests() ◀── price table (committed constant)
                     │             └─ applyFreeAllowance()│           │
                     ◀─────────────  {lo,hi,requests,results,pctOfRemaining, ×N vs RGV}
                     │           │                                    │
        (drop if seq < latest)   │                                    │
                                 │                                    │
   "Find this address" ──────────▶ geocodeAddress(q)  "use server"    │
                                 │   └─ fetch census ──▶ 🌐 geocoding.geo.census.gov   (FREE · no key · 200-on-failure)
                                 │        └─ zod parse ─▶ {lat,lng,countyFips,matched} │
                                 │                                    │
   "Save as version n" ──────────▶ savePresetVersion()  "use server"  │
                                 │   └─ withOrg(tx) ──────────────────▶ INSERT search_versions (immutable)
                                 │                                    │ UPDATE searches.current_version_id
                                 │                                    │ ▸ app.log_event trigger → events
                                 │                                    │
   "Reserve budget & queue" ─────▶ queueRun()  "use server"           │
                                 │   └─ withOrg(tx) ──────────────────▶ app.reserve_budget(org, 'places', period, µUSD)
                                 │                                    │   1. release expired reservations  (self-heal)
                                 │                                    │   2. UPDATE … WHERE spent+reserved+n ≤ cap
                                 │                                    │        ├─ 1 row  → INSERT cost_reservations
                                 │                                    │        └─ 0 rows → DENIED (cap reached)
                                 │                                    │   3. RETURNING pct_after, at_80, at_100
                                 ◀── reservation_id | refusal + copy  │
                                 │                                    │
 ───────── PHASE 4 BOUNDARY ─────┼────────────────────────────────────┼───────────────────────────────────────────
                                 │  worker: call Places ─────────────▶│ app.settle_reservation(res, request_id, actual)
                                 │                                    │   INSERT cost_ledger ON CONFLICT (request_id)
                                 │                                    │     DO NOTHING            ← idempotent replay
                                 │                                    │   if inserted: reserved -= est; spent += actual
                                 │                                    │
 /spend  ◀──────────────────────── RSC read ────────────────────────── SELECT budget_periods + cost_ledger rollups
 shell banner ≥80% ◀────────────── layout read ─────────────────────── SELECT budget_periods (one row)
                                 │                                    │
 ───────── SECOND WALL (outside every box above) ─────────────────────────────────────────────────────────────────
   Google Cloud console → Google Maps Platform → Quotas → Places API (New) → "Requests per day" = 100
   resets midnight US/Pacific · human-action checkpoint · NOTHING in src/ reads or depends on it
```

### Recommended Project Structure

```
src/
├── app/
│   ├── (app)/                      # NEW route group — carries the shell (sidebar / tab bar / banner)
│   │   ├── layout.tsx              #   requireOrg() + budget banner + ThemeProvider consumer
│   │   ├── presets/{page,new,[id]}/
│   │   ├── spend/page.tsx
│   │   └── settings/{budget,organization}/page.tsx
│   ├── layout.tsx                  # EDIT: globals.css import, Inter, ClerkProvider > ThemeProvider, Toaster
│   └── globals.css                 # NEW: @import "tailwindcss"; @theme inline; :root / .dark literal hex
├── components/ui/                  # shadcn copy-in (NEVER hand-edit beyond the token pass)
├── db/schema/
│   ├── clusters.ts                 # industry_clusters, industry_terms       (reference, org_id NULL)
│   ├── geography.ts                # counties, cities, geo_presets           (reference, org_id NULL)
│   ├── outlet-counts.ts            # outlet_counts (county × cluster)        (reference, org_id NULL)
│   ├── searches.ts                 # searches, search_versions               (tenant)
│   ├── budget.ts                   # budget_periods, cost_reservations, cost_ledger (tenant)
│   └── runs.ts                     # runs (minimal: version ref, cost, status)
├── lib/
│   ├── budget/
│   │   ├── price-book.ts           # SKU → µUSD/request + free allowance   (pure, committed constant)
│   │   ├── field-mask-tier.ts      # fieldMaskTier() — REFUSES unknown fields
│   │   ├── period.ts               # Chicago month boundary helpers (uses src/lib/time.ts)
│   │   └── money.ts                # µUSD ↔ display; Intl.NumberFormat USD
│   ├── estimate/
│   │   ├── expand-cells.ts         # spec → (cluster × geography unit) cells
│   │   ├── assumptions.ts          # FAN_OUT = 3.0, PAGES_LO = 1, PAGES_HI = 3  ← the committed constants
│   │   └── estimate.ts             # cells + counts + price book + free allowance → EstimateRange
│   ├── geocode/census.ts           # fetch + zod; NO key; 200-on-failure handled
│   └── ui/                         # SERVER-SAFE, no "use client": run-tone.ts, copy.ts
├── server/actions/                 # "use server" — every one calls requireOrg() FIRST
└── seed/
    ├── data/*.json                 # committed: clusters, cities, counties(254), outlet-counts
    └── ...                         # loaded by scripts/seed.ts (idempotent upsert as owner)
```

---

### Pattern 1: Reserve → call → settle, as one statement

**What:** the entire concurrency control is a single conditional `UPDATE`. There is no read before it.
**When:** before every billable call, in every tier, forever.

```sql
-- Source: verified by execution on PostgreSQL 18.6, 2026-09-22.
-- 40 concurrent connections · cap 100 · unit 10 → granted 10, denied 30, reserved 100, errors 0.
update budget_periods
   set reserved_micro_usd = reserved_micro_usd + p_micro
 where org_id = p_org and provider = p_provider and period_start = p_period
   and spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd
returning id, reserved_micro_usd, spent_micro_usd, cap_micro_usd
     into v_bp, v_r, v_s, v_c;
if v_bp is null then  -- DENIED. Zero rows is the refusal; there is no error to catch.
```

**Why it cannot race** — PostgreSQL READ COMMITTED re-evaluates the `WHERE` clause against the *committed new* version of a row it had to wait for. `[CITED: postgresql.org/docs/current/transaction-iso.html — quoted verbatim in ARCHITECTURE.md § Pattern 2]` I did not take that on faith: the control experiment below is the evidence.

**The control that proves the test discriminates:**

| Variant | Granted | Reserved vs cap 100 | Over-spend? |
|---|---|---|---|
| naive `SELECT` → decide → `UPDATE` | **40 / 40** | **400** | **YES, 4×** |
| `SELECT … FOR UPDATE` → `UPDATE` | 10 / 40 | 100 | no |
| single conditional `UPDATE` | 10 / 40 | 100 | no |

`[VERIFIED: executed locally, 2026-09-22]`

---

### Pattern 2: Self-healing reserve (the sweeper leaves the correctness path)

**What:** `reserve_budget()` first releases *this budget row's* expired, unsettled reservations, then applies the conditional `UPDATE`. A crashed worker's reservation is reclaimed by the next caller rather than by a scheduler.
**When:** always. It makes the cron sweeper hygiene, not a dependency.

```sql
-- Source: verified by execution on PostgreSQL 18.6, 2026-09-22.
-- Fixture: 5 EXPIRED reservations holding 100% of the cap (a crashed worker).
-- Result:  40-way burst → granted 10, denied 30, reserved 100, open reservations 10, errors 0, 103 ms.
with expired as (
  select r.id, r.est_micro_usd from cost_reservations r
    join budget_periods b on b.id = r.budget_period_id
   where b.org_id = p_org and b.provider = p_prov and b.period_start = p_period
     and r.settled_at is null and r.released_at is null and r.expires_at < now()
   for update of r skip locked                 -- a concurrent healer is releasing it; let them
), rel as (
  update cost_reservations r set released_at = now()
    from expired e where r.id = e.id returning e.est_micro_usd
) select coalesce(sum(est_micro_usd), 0) into v_freed from rel;
if v_freed > 0 then
  update budget_periods set reserved_micro_usd = reserved_micro_usd - v_freed
   where org_id = p_org and provider = p_prov and period_start = p_period;
end if;
```

Index it: `create index cost_reservations_open on cost_reservations (budget_period_id, expires_at) where settled_at is null and released_at is null;` — a partial index so the healing scan is empty-cheap in the common case.

---

### Pattern 3: Thresholds decided inside the meter, never by a follow-up read

**What:** `RETURNING` the post-update utilisation. D-12's 80 % warning and 100 % refusal are then derived from the same row version that granted or denied, so two workers crossing 80 % simultaneously cannot both miss it or both double-emit from a stale read.

```sql
-- Source: verified by execution on PostgreSQL 18.6, 2026-09-22.
-- cap 5000, spent 3900, reserve 200 → {"pct_after":"82.0","at_80":true,"at_100":false}
returning reserved_micro_usd, spent_micro_usd, cap_micro_usd,
          round(100.0 * (spent_micro_usd + reserved_micro_usd) / cap_micro_usd, 1) as pct_after,
          (spent_micro_usd + reserved_micro_usd) * 100 >= cap_micro_usd * 80 as at_80,
          (spent_micro_usd + reserved_micro_usd) >= cap_micro_usd            as at_100
```

🔴 **Integer overflow is live here.** `select (50*1000000)*80/100` raises `22003 integer out of range` — the intermediate is 4×10⁹ against int4's 2.1×10⁹ ceiling `[VERIFIED: executed locally]`. Every literal in the meter must ride on a `bigint` column (as above, where `cap_micro_usd` is `bigint`) or carry an explicit `::bigint`. A cap expressed with bare int literals errors on a *legitimate* computation, which reads as a schema bug.

Emit the crossing through **`app.emit_event`** (Phase 1 migration 0011), never a direct insert: `authenticated` holds no INSERT on `events`, and `emit_event` takes neither `org_id` nor `actor_id` as a parameter, so attribution cannot be forged. Guard it so 80 % emits **once per period**, e.g. a `budget_periods.warned_80_at timestamptz` stamped in the same statement — otherwise every reserve past 80 % writes an event row.

---

### Pattern 4: Idempotent settlement, keyed by request id

```sql
-- Source: verified by execution on PostgreSQL 18.6, 2026-09-22.
-- settle(res,'req-abc',7) twice → first true, second false; ledger rows 1; reserved 100→90, spent 0→7.
insert into cost_ledger (org_id, budget_period_id, reservation_id, request_id, micro_usd, …)
values (…) on conflict (request_id) do nothing;
get diagnostics v_ins = row_count;
if v_ins = 0 then return false; end if;       -- replay: nothing moves, no double count
update budget_periods
   set reserved_micro_usd = reserved_micro_usd - v_est,
       spent_micro_usd    = spent_micro_usd + p_actual
 where id = v_period;
```

**Reserve the worst case, settle the actual.** Reserving one page and discovering three is the only way to breach the cap. The true-up (est 10 → actual 7) returns the difference to the budget, verified above.

---

### Pattern 5: Reference rows (`org_id IS NULL`) — and the two things that surprise you

```sql
-- policies (D-05)
create policy ic_select on industry_clusters for select to authenticated
  using (org_id is null or org_id = (select app.current_org_id()));
create policy ic_insert on industry_clusters for insert to authenticated
  with check (org_id is not null and org_id = (select app.current_org_id()));
create policy ic_update on industry_clusters for update to authenticated
  using  (org_id is not null and org_id = (select app.current_org_id()))
  with check (org_id is not null and org_id = (select app.current_org_id()));
create policy ic_delete on industry_clusters for delete to authenticated
  using (org_id is not null and org_id = (select app.current_org_id()));
```

🔴 **Surprise 1 — a tenant's attempt to mutate a built-in is a silent zero-row filter, not a refusal.** Executed locally: `UPDATE … where org_id is null` → `rowCount 0`, `DELETE` → `rowCount 0`, and only `INSERT (org_id = null)` raises `42501 new row violates row-level security policy`. `[VERIFIED: executed locally]` That is inherent to RLS — an invisible row cannot produce a targeted refusal — so **the test asserts `rowCount === 0` for UPDATE/DELETE and `42501` only for INSERT**, and, per CONVENTIONS § Testing, the one refused statement gets its own rolled-back transaction with a positive control beside it.

I tried to make it loud with a `BEFORE UPDATE OR DELETE` trigger raising `42501` on `org_id IS NULL`. **It does not work and it breaks the seed path**: RLS filters the row before the row trigger fires, so `authenticated` still saw `rowCount 0`; meanwhile the owner — who bypasses RLS but *not* triggers — was refused its legitimate seed update. `[VERIFIED: executed locally]` **Do not add that trigger.**

🔴 **Surprise 2 — `UNIQUE (org_id, key)` does not stop a duplicate built-in.** `NULL != NULL`, so a second `(null, 'home_services')` row inserts cleanly. `UNIQUE NULLS NOT DISTINCT (org_id, key)` refuses it with `23505`. `[VERIFIED: executed locally on PG 18.6; NULLS NOT DISTINCT is PostgreSQL 15+, so prod's 17.6 supports it]` Drizzle expresses it as `unique('…').on(t.orgId, t.key).nullsNotDistinct()` `[VERIFIED: node_modules/drizzle-orm/pg-core/unique-constraint.d.ts]`. Without it the seed script is not idempotent and a re-run silently doubles every built-in.

---

### Pattern 6: Versioned presets

```
searches            (id, org_id, name_internal, display_name, current_version_id → search_versions, status, …)
search_versions     (id, org_id, search_id, version int, cluster_ids uuid[], geo_kind, geo_payload jsonb,
                     created_at, created_by, unique (search_id, version))          ← APPEND-ONLY
runs                (id, org_id, search_version_id → search_versions, status, cost_micro_usd, stopped_reason, …)
```

- **Immutable by GRANT, exactly as `events` is** (CONVENTIONS § Audit): `grant select, insert on search_versions to authenticated` and `revoke update, delete`. A policy-only approach is a silent zero-row filter; the grant refusal is `42501 permission denied for table search_versions`, which cannot be mistaken for "nothing matched". **Pin the message, not only the code.**
- `runs.search_version_id` with `on delete no action` is what makes SRCH-03 true by construction — a version that a run points at cannot be removed.
- "Used by N runs" is `count(*) from runs where search_version_id = v.id` — no denormalised counter to drift.
- **The circular FK**: `searches.current_version_id → search_versions.id` and `search_versions.search_id → searches.id`. Make `current_version_id` nullable and set it in a second statement inside the same transaction, or drizzle-kit cannot order the DDL.
- **Save conflict (UI-SPEC § Error)**: the edit form carries the version number it was loaded from; `insert … (search_id, version) values ($1, $loaded + 1)` and let `unique (search_id, version)` raise `23505` when someone else saved first. That is optimistic concurrency for free, with the exact copy the UI-SPEC already specifies.
- **Attribution scope:** `searches`, `search_versions` and `budget_periods` are state-bearing → add each to `EVENT_LOGGED` in `tests/db/event-trigger.test.ts` and attach `app.log_event`. **`cost_ledger` and `cost_reservations` get NO row trigger** — one ledger row per paid call is exactly the high-volume shape CONVENTIONS excludes `source_records` for (T-1-32). The ledger *is* its own audit record; `app.touch_updated_at` still goes on every mutable table.

---

### Anti-Patterns to Avoid
- **Check-then-spend.** Proven to over-spend 4× here, not in theory. Any `SELECT` of a budget total that is not inside the same statement as the `UPDATE` is the defect.
- **A per-call cost constant.** Cost must come from `fieldMaskTier(actualMaskSent)` (PITFALLS 1). A constant and the invoice diverge silently.
- **Integer cents in the ledger.** 3.50 ¢ per request; see § Cost Model & Units.
- **A trigger to make built-in mutation loud.** Verified not to fire (RLS filters first) and to break the owner's seed path.
- **Deriving FIPS from the Comptroller code by re-sorting county names.** 15 of 254 break it. Ship the table.
- **`RETURNING old.* / new.*`.** PostgreSQL 18 accepts it; **production is 17.6** and will not. See § State of the Art.
- **A second `Intl` call site.** CONVENTIONS § Time: `grep -rn "America/Chicago" src/` must only ever name `src/lib/time.ts`. The spend view and the estimate both format money and dates — both go through that module.
- **25 hand-rolled `bg-card` divs.** UI-SPEC Executor Rule 6. Grep before calling a screen done.

---

## Cost Model & Units

### Verified SKU price table

`[CITED: developers.google.com/maps/billing-and-pricing/pricing, fetched 2026-09-22]`

| SKU | SKU ID | Free / month | $ / 1,000 (first paid band) | µUSD / request |
|---|---|---|---|---|
| Text Search **Essentials (IDs Only)** | `635D-A9DD-C520` | **unlimited** | — | **0** |
| Text Search **Pro** | `4FDA-34B1-A910` | 5,000 | $32.00 | 32,000 |
| Text Search **Enterprise** | `E967-44BC-B44D` | **1,000** | **$35.00** | **35,000** |
| Text Search **Enterprise + Atmosphere** | `120C-BEC3-B48F` | 1,000 | $40.00 | 40,000 |
| Place Details **Essentials** | — | 10,000 | $5.00 | 5,000 |
| Place Details **Pro** | — | 5,000 | $17.00 | 17,000 |
| Place Details **Enterprise** | `2D9A-3DE0-3766` | 1,000 | $20.00 | 20,000 |

Two facts that belong in `fieldMaskTier()`:
- **Billing is at the highest SKU present in the field mask.** `[CITED: developers.google.com/maps/documentation/places/web-service/usage-and-billing — "You are then billed at the highest SKU applicable to your request"]`
- **`nextPageToken` is an Essentials (IDs-Only) field**, so requesting it alongside Enterprise fields does not raise the tier. `[CITED: developers.google.com/maps/documentation/places/web-service/text-search]` — worth a named unit test, because it is the one field a reviewer would assume is free-floating.
- Each `pageToken` page is a separate billable request. `[MEDIUM — inferred from per-request SKU semantics; STACK.md flags the same. Verify on the first invoice at the Phase 6 gate.]`

### µUSD vs cents — decided by arithmetic

| | value |
|---|---|
| 1 Text Search Enterprise request | 35,000 µUSD = **$0.035 = 3.50 ¢** |
| 1,428 paid requests (a $50 cap's worth) | 49,980,000 µUSD = **$49.98** |
| …if each row rounded **up** to 4 ¢ | $57.12 — **+14.3 %**, and the cap silently refuses early |
| …if each row rounded **down** to 3 ¢ | $42.84 — **−14.3 %**, and the cap silently over-spends |

`[VERIFIED: executed locally on PG 18.6, 2026-09-22]`

**Decision: store `micro_usd bigint`. Satisfy BUDG-01's `cost_cents` contract with a generated column**, verified to work:

```sql
cost_cents numeric(12,2) generated always as (micro_usd / 10000.0) stored
```
→ `35000 µUSD` renders `3.50`. The external ledger-row contract `{provider, sku, units, cost_cents, run_id, lead_id?}` is satisfied by name and by value; the internal arithmetic never loses a half-cent. `[VERIFIED: executed locally]`

### The Estimator

**Inputs** (all seeded, all free, no Google key):

```
cells      = |clusters| × |geography units|
requestsLo = cells × PAGES_LO(1) × FAN_OUT(3.0)
requestsHi = cells × PAGES_HI(3) × FAN_OUT(3.0)
results    = Σ over (unit, cluster) of outlet_counts        ← TX Comptroller, measured
billable   = max(0, requests − freeRemainingThisMonth(sku))
costµUSD   = billable × priceBook[sku].microUsdPerRequest
```

`FAN_OUT = 3.0` is D-07's **visible, editable, committed constant** — unmeasured, surfaced verbatim in the assumptions drawer, trued up at the Phase 6 gate.

🔴 **The free allowance is not optional, and the UI-SPEC's example omits it.** The spec's illustration — "~68 requests · ~$2.40" — is 68 × $0.035 with no free tier applied. In reality the first **1,000** Text Search Enterprise requests each calendar month are free, so on the 2nd of the month that same preset estimates **$0.00**, and quoting $2.40 is wrong in the direction that makes danlo distrust the number. `freeRemainingThisMonth(sku)` must be derivable, which means:

> **The ledger must record zero-cost calls too** — one row per *paid-SKU* call with `micro_usd = 0` while the free allowance covers it. BUDG-01 says "every outbound paid API call"; a free-tier Enterprise call *is* a paid-SKU call that happened to cost nothing. If those rows are skipped, the free allowance is untrackable and every early-month estimate is wrong. `units` on the ledger row is exactly the field that carries this.

**The Texas multiplier is computed, not constant.** With the seeded baseline (RGV 17 cities × 4 clusters = **68 cells**) and the Texas preset (254 counties × 4 clusters = **1,016 cells**), the ratio is **≈ 14.9×**. Against the RGV *county* preset (16 cells) it is **63.5×**. By expected outlets it is 552,278 / 23,978 = **23.0×** `[VERIFIED: queried live]`. **None of these is 38** — the UI-SPEC's "×38 vs RGV" is illustrative copy, not an arithmetic contract. Render `×{computed}` from `estimate(texas).requestsHi / estimate(rgvBaseline).requestsHi` and let the copy format stand.

Worth surfacing to danlo: Texas at 1,016 cells × 3 pages × 3.0 fan-out = **9,144 requests ≈ $285 after the free tier** — **5.7× the entire monthly cap**. The estimate screen showing that clearly *is* D-04 working.

**The committed cost-model test** (ROADMAP's "a committed test, not a spreadsheet"): take the real seeded cell list, run the default schedule shape, assert monthly cost ≤ cap. Mutating `FAN_OUT` or a price-book entry must red exactly one named test.

⚠️ **Caveat to print in the assumptions drawer:** the Comptroller under-counts pure-service businesses — Texas does not tax most personal services, which is why personal care shows only 977 RGV outlets against 15,977 for auto & retail `[VERIFIED: queried live; DATA-SOURCES.md § (b)]`. The estimate's "expected businesses" is a *permit-holder* count, not a Places result count.

---

## Seed Data

### Counties — two numbering systems, both required

🔴 **DATA-SOURCES.md's `Cameron 031, Hidalgo 108, Starr 214, Willacy 245` are Texas Comptroller county codes, not FIPS.** The Census Geocoder returns Hidalgo as FIPS **215**. `[VERIFIED: both queried live, 2026-09-22]`

| County | Comptroller code | FIPS | Outlets (all NAICS) |
|---|---|---|---|
| Cameron | `031` | `48061` | 12,313 |
| Hidalgo | `108` | `48215` | 21,062 |
| Starr | `214` | `48427` | 1,226 |
| Willacy | `245` | `48489` | 327 |
| | | | **34,928** |

`[VERIFIED: data.texas.gov/resource/jrea-zgmq.json grouped by outlet_county_code — matches DATA-SOURCES.md exactly]`

**The mapping, verified exhaustively:** Texas's 254 county FIPS codes are the **contiguous odd integers 1, 3, 5 … 507**, so `comptroller_code = (fips + 1) / 2` is an exact bijection — spot-checked against Anderson (1/001), Andrews (2/003), Cameron (31/061), Hidalgo (108/215), Starr (214/427), Willacy (245/489), Zavala (254/507). `[VERIFIED: computed over all 254 rows of national_county2020.txt]`
**Do not derive it by sorting county names** — 15 of 254 break under every collation I tried (El Paso/Ellis, La Salle/Lamar, and the whole `Mc*` block, which FIPS orders *before* `Ma*`). `[VERIFIED: computed]` Ship the 254-row table; assert the identity in a test.

**Source for the 254-county seed (no key, plain text, pipe-delimited):**
`https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt` → 254 `TX|` rows. `[VERIFIED: fetched, 200, 126 KB]`

⚠️ The Comptroller dataset carries **255** distinct `outlet_county_code` values: 001–254 plus a `000` sentinel (1 outlet). Filter `between '001' and '254'`. `[VERIFIED: queried live]`

### The RGV city list — it does not exist in the corpus, so define it

FEATURES.md says "RGV's 17", DATA-SOURCES.md says "22 RGV cities", COMPETITORS.md says "~20". **No file lists them.** Recommended definition, measured and reproducible:

> **The 17 cities in the four RGV counties with ≥ 400 active sales-tax outlets — 90.7 % of the RGV outlet universe.**

| # | City | County | Outlets | cum. |
|---|---|---|---|---|
| 1 | Brownsville | Cameron | 6,678 | 19.1 % |
| 2 | McAllen | Hidalgo | 5,985 | 36.3 % |
| 3 | Edinburg | Hidalgo | 3,092 | 45.1 % |
| 4 | Mission | Hidalgo | 3,034 | 53.8 % |
| 5 | Harlingen | Cameron | 2,626 | 61.3 % |
| 6 | Pharr | Hidalgo | 1,942 | 66.9 % |
| 7 | Weslaco | Hidalgo | 1,551 | 71.3 % |
| 8 | San Benito | Cameron | 948 | 74.0 % |
| 9 | Donna | Hidalgo | 821 | 76.4 % |
| 10 | San Juan | Hidalgo | 791 | 78.6 % |
| 11 | Rio Grande City | Starr | 776 | 80.9 % |
| 12 | Alamo | Hidalgo | 763 | 83.0 % |
| 13 | Mercedes | Hidalgo | 748 | 85.2 % |
| 14 | Hidalgo | Hidalgo | 566 | 86.8 % |
| 15 | Los Fresnos | Cameron | 490 | 88.2 % |
| 16 | Palmview | Hidalgo | 465 | 89.5 % |
| 17 | South Padre Island | Cameron | 417 | 90.7 % |

`[VERIFIED: queried live 2026-09-22 — 114 distinct (city, county) pairs across the four counties]`

⚠️ **City names in the source need normalisation.** Rio Grande City appears three ways: `RIO GRANDE CITY` (776), `RIO GRANDE CY` (35), `RIO GRANDE` (32) — true total 843. The seed loader must fold variants; a committed test should assert the folded count. Willacy's only qualifying town, Raymondville (221), falls below the threshold — if danlo wants every county represented in the city picker, either drop the threshold to 200 or pin Raymondville explicitly. **Flag this to danlo; it is a product call, not a data one.**

### Clusters × counties — the estimator's core table

NAICS ranges from DATA-SOURCES.md, re-measured:

| Cluster | NAICS predicate | Cameron 031 | Hidalgo 108 | Starr 214 | Willacy 245 | RGV | Texas |
|---|---|---|---|---|---|---|---|
| Home services & trades | `230000 ≤ n < 240000` | 442 | 969 | 32 | 9 | **1,452** | 45,612 |
| Food & hospitality | `721000 ≤ n < 723000` | 1,958 | 3,329 | 224 | 61 | **5,572** | 120,749 |
| Personal care & health | `812100 ≤ n < 812200` ∪ `621000 ≤ n < 622000` | 303 | 628 | 43 | 3 | **977** | 23,846 |
| Auto & retail | `811100 ≤ n < 811200` ∪ `440000 ≤ n < 460000` | 5,861 | 9,355 | 606 | 155 | **15,977** | 362,071 |
| | | | | | | **23,978** | **552,278** |

`[VERIFIED: queried live 2026-09-22 — RGV totals match DATA-SOURCES.md to the row]`

🔴 **`outlet_naics_code` is a Socrata *number*.** `starts_with(outlet_naics_code, '23')` returns **HTTP 400 `query.soql.type-mismatch`**; numeric range predicates work. `[VERIFIED: both attempted live]` `outlet_county_code` and `outlet_city` are *text*.

### Seed loader — recommendation

**`tsx scripts/seed.ts` reading committed JSON, not a migration.**
- The schema (tables, policies, grants, `_org_idx`, `UNIQUE NULLS NOT DISTINCT`) ships in a drizzle-kit migration, per CONVENTIONS § Migrations.
- The *rows* ship as `src/seed/data/*.json` + an idempotent `insert … on conflict (org_id, key) do update` run **as the migration owner** (the owner bypasses RLS; `authenticated` cannot write `org_id IS NULL` rows at all, by design). Verified: the owner's update of a built-in succeeds where `authenticated`'s is filtered to zero rows.
- Why not a migration: drizzle-kit hashes migration SQL and CONVENTIONS forbids editing an applied file. Outlet counts are **refreshable** — Socrata's `rowsUpdatedAt` was 2026-09-19 — so a re-pull must be re-runnable, which a migration structurally is not.
- `scripts/seed.ts` follows `scripts/db.ts`'s target gate (`--target=test` refuses a Supabase host) so the seed cannot accidentally run against production unattended.
- The refresh story: `scripts/refresh-outlet-counts.ts` re-queries Socrata, rewrites the JSON, and a committed test asserts the JSON's RGV totals still sum to the four cluster figures — a drift alarm rather than a silent quiet update.

---

## The Census Geocoder (D-02)

**Endpoint** — `https://geocoding.geo.census.gov/geocoder/{locations|geographies}/onelineaddress`

| Param | Value | Note |
|---|---|---|
| `address` | URL-encoded one-line address | |
| `benchmark` | `Public_AR_Current` | id 4, `isDefault: true`. Others live: `Public_AR_ACS2025`, `Public_AR_LUCA`, `Public_AR_Census2020`. `[VERIFIED: /geocoder/benchmarks?format=json]` |
| `vintage` | `Current_Current` | **required when returntype = `geographies`**; id 4, default. `[VERIFIED: /geocoder/vintages?benchmark=…]` |
| `format` | `json` | |
| `layers` | **`Counties`** | ⚠️ use it: the default response carries 11 geography layers at **5,125 bytes**; `layers=Counties` is **1,154 bytes** and still carries `COUNTY`/`GEOID`. `[VERIFIED: measured both]` |

**No API key. No documented rate limit or terms restriction. Batch ceiling 10,000 records/file.** `[CITED: geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html]` Latency measured 138–550 ms over 10 calls.

🔴 **The failure mode is HTTP 200.** Every failing case returned `200` with `addressMatches: []`. A status check is not a success check.

| Input | Result |
|---|---|
| `1400 N 10th St, McAllen, TX 78501` | 1 match · Hidalgo County · 26.2161, −98.2278 |
| `101 N Britton Ave, Rio Grande City, TX 78582` | 1 match · Starr County |
| `Joe's Taqueria, McAllen, TX` (business name) | **no match** |
| `PO Box 1234, Edinburg, TX 78539` | **no match** |
| `Rio Grande City, TX` (city only) | **no match** |
| `1 Cesar Chavez Rd, Alton, TX 78573` (colonia-ish) | **no match** |
| `Av Hidalgo 100, Reynosa, Tamaulipas, Mexico` | **no match** — the Texas-side clip is free here |
| `1400 N 10th St, McAllen, TX 99999` (bad ZIP) | **1 match, ZIP silently corrected to 78501** |

`[VERIFIED: executed live 2026-09-22]` — the UI-SPEC's error copy ("matches street addresses, not business names or PO boxes") is exactly right, and its "Switch to county" escape hatch is the correct recovery for the colonia case, which PITFALLS 213 already warns about.

**zod schema (server-side, one module):**

```typescript
// Source: response shape verified live, 2026-09-22.
const CensusMatch = z.object({
  matchedAddress: z.string(),
  coordinates: z.object({ x: z.number(), y: z.number() }),   // x = lng, y = lat  ← not (lat,lng)
  geographies: z.object({
    Counties: z.array(z.object({
      GEOID: z.string(),   // '48215'  — state+county FIPS
      COUNTY: z.string(),  // '215'
      NAME: z.string(),    // 'Hidalgo County'
      STATE: z.string(),   // '48'
    })).min(1),
  }),
});
const CensusResponse = z.object({ result: z.object({ addressMatches: z.array(CensusMatch) }) });
// addressMatches.length === 0 is NOT a parse error — it is the documented "no match" outcome.
```

**Guards:** `STATE === '48'` (Texas-only, per DATA-SOURCES' 42 %-of-a-naive-bbox-is-Mexico warning); persist `{lat, lng, countyFips, matchedAddress}` on the version row, not the raw payload; **never** put the caller's string anywhere but the `address` query parameter of a hard-coded host.

**msw fixtures to record (one JSON each):** the McAllen hit, the Rio Grande City hit, the empty-`addressMatches` miss, and a 503. CI never touches the network. This is the only external HTTP in Phase 2.

---

## The Second Wall — Google Cloud daily quota (BUDG-03)

**Recommended value: `Requests per day = 100` on Places API (New).** (Matches UI-SPEC OQ 8; I re-derived it rather than adopt it.)

**Derivation, from verified prices:**
```
cap                       $50.00      = 50,000,000 µUSD
Text Search Enterprise    $35.00/1,000 = 35,000 µUSD/request, first 1,000 free
paid requests a $50 cap buys   50,000,000 / 35,000 = 1,428
total monthly ceiling          1,000 free + 1,428 paid = 2,428 requests
÷ 30 days                      ≈ 80.9 requests/day
round up for a weekly-partition burst (PLACE-04) → 100/day
runaway bound                  100 × $0.035 = $3.50/day, vs $50 in an hour unbounded
```

🔴 **Be honest in the copy about what it does not do:** 100/day × 30 = 3,000 requests = $70/month, which *exceeds* the cap. The quota bounds a **runaway day**; only the app meter bounds the **month**. That is precisely what "second wall, not the primary meter" means, and the UI-SPEC's card already says it.

**Console path** — Google Cloud console → **Google Maps Platform → Quotas** → API dropdown → *Places API (New)* → quota metric **"Requests per day"** → ⋮ → **Edit quota** → uncheck *Unlimited* → enter `100` → **Submit request**. (Equivalent path: *IAM & Admin → Quotas & System Limits*, or *APIs & Services → [API] → Quotas → Edit Quotas*.) `[CITED: docs.cloud.google.com/apis/docs/capping-api-usage; corroborated by Google Maps Platform quota guidance]`

Two documented caveats to carry into the runbook:
- Exceeding the quota returns a **`limit exceeded` error**, it does not silently drop traffic. `[CITED: docs.cloud.google.com/apis/docs/capping-api-usage]`
- *"Quota limits are not always entirely precise, because there is some latency between when a quota is surpassed and when the enforcement begins."* `[CITED: same]` — so the quota can overshoot slightly; the meter cannot.
- **Daily quotas refresh at midnight US/Pacific**, which is a **third** timezone alongside `America/Chicago` (the app's budget month) and Google's own billing month. Do not conflate them in any copy. `[MEDIUM — consistently stated across Google quota guidance; not re-read from a single canonical page]`

**A budget alert is not a cap.** PITFALLS 9 quotes Google verbatim: *"Setting a budget does not automatically cap Google Cloud or Google Maps Platform usage or spending."* Keep both, and say which one stops things.

**How to express it in the plan:** a `checkpoint:human-action` task, blocked on "GCP project + Places API (New) key with billing" which **does not exist** (PROJECT.md § Dependencies not yet created). UI-SPEC Executor Rule 14 is the binding constraint: **nothing on any screen reads a Google credential, and no test depends on the key existing.** The settings card renders the number, the derivation and a link; the checkpoint records the console screenshot when danlo sets it.

---

## Frontend on This Repo

### What exists today
`Next 16.3.5` · `React 19.3` · Clerk `7.9.4` · TS `6.0.3`. **No Tailwind, no `components.json`, no stylesheet, no font, no `postcss.config.*`.** `src/app/layout.tsx` carries a comment saying so on purpose. ESLint is `typescript-eslint` only — **no `eslint-plugin-react-hooks`, no `eslint-config-next`** `[VERIFIED: eslint.config.mjs]`. `tsconfig.json` already sets `"jsx": "react-jsx"` and includes `**/*.tsx`. `[VERIFIED: read]`

### `shadcn@4.21.0` — flags verified against the installed CLI

```bash
npx shadcn@4.21.0 init -b radix -p nova -y --css-variables --pointer --no-monorepo --no-rtl
```
`[VERIFIED: npx shadcn@4.21.0 init --help, run from a scratch directory]` — `-t/--template` (new projects), `-b base|radix|aria`, `-p [name]`, `-y` (**default true**), `-d/--defaults` (= `--template=next --preset=base-nova`), `-f/--force`, `--css-variables` (**default true**), `--pointer/--no-pointer`, `--rtl/--no-rtl`, `--monorepo/--no-monorepo`, `--reinstall`. **There is no `--base-color`.** UI-SPEC's command is correct as written.

**The `nova` preset, read out of the shipped bundle:**
```js
nova: { title:"Nova", description:"Lucide / Geist", style:"nova", baseColor:"neutral",
        theme:"neutral", chartColor:"neutral", iconLibrary:"lucide",
        font:"geist", fontHeading:"inherit", menuAccent:"subtle", radius:"default", rtl:false }
vega: { …identical…, style:"vega", font:"inter" }
```
`[VERIFIED: node_modules cache of shadcn@4.21.0, dist/index.js]`

Three consequences the same task must handle:
1. **Font:** `nova` binds **Geist**; the contract is **Inter**. `init` rewrites `next/font/google` imports with ts-morph and binds the font to `--font-sans` `[VERIFIED: ts-morph `getImportDeclarations()` / `--font-sans` mapping in dist]`. Swap to `Inter({ subsets:['latin'], display:'swap', variable:'--font-sans' })` in the same task; never add a `geist` package (UI-SPEC Executor Rule 15).
2. **Base color:** `nova` binds **`neutral`**; the contract is **`zinc`**. `npx shadcn@4.21.0 migrate base-color --to zinc -y` is the supported non-interactive path — `migrate --list` confirms `base-color` is a shipped migration `[VERIFIED: run]`.
3. **Radius:** the preset's `radius: "default"` is shadcn's `0.625rem`/`0.5rem`, not the contract's `--radius: 12px`. Paint it in `globals.css`.

⚠️ **`init` aborts if `components.json` already exists** (`"A components.json file already exists… To start over, remove the file and run init again"`) unless `-f`. `[VERIFIED: dist source]` So init is a one-shot first task and the working tree must be clean before it — which it is (`git status` clean, `main` @ `510c8d7`).

### Tailwind v4 on Next 16 / Turbopack
Next's own v16.3.5 docs prescribe exactly: `pnpm add -D tailwindcss @tailwindcss/postcss`, a `postcss.config.mjs` exporting `{ plugins: { '@tailwindcss/postcss': {} } }`, `@import 'tailwindcss'` in `app/globals.css`, and importing that file from the root layout. **No `tailwind.config.ts`.** `[CITED: nextjs.org/docs/app/getting-started/css]` UI-SPEC Executor Rule 13 already forbids creating one; `components.json → tailwind.config` stays `""`.

Next also warns that **CSS ordering can differ between dev and `next build`** — which is why UI-SPEC Executor Rule 8 requires screenshots of the *built* app. `[CITED: same page]`

### The live debounced estimate (D-08)

🔴 **Next.js Server Actions execute sequentially — they are queued, not parallel.** `[CITED: github.com/vercel/next.js/discussions/50743; hmos.dev/en/next-server-action-sequence]` And *"Server Actions must be asynchronous, while transitions must be synchronous."* `[CITED: vercel/next.js#57652]`

With D-08's server action locked, the shape is:

```tsx
'use client';
// Source: React 19 transition semantics + the recorded BIS defect below.
const seq = useRef(0);
const [pending, startTransition] = useTransition();
const [estimate, setEstimate] = useState<EstimateRange | null>(null);

const recompute = useDebouncedCallback((spec: PresetSpec) => {
  const mine = ++seq.current;
  startTransition(async () => {
    const next = await estimatePreset(spec);      // "use server"
    if (mine === seq.current) setEstimate(next);  // drop a stale, out-of-order answer
  });
}, 400);
```

- **The monotonic `seq` guard is not optional.** Server Actions have no `AbortController`; a queued earlier answer can land after a later one and repaint a stale dollar figure. This is the one bug class the queue behaviour creates.
- **Never `<form action={…}>` for this.** Recorded BIS defect: *React resets a `<form action>` even when the action FAILED, and Radix Select drives state backwards on that reset.* Use `onSubmit` + `useTransition` for the save path too.
- **Never blank the number** (UI-SPEC Executor Rule 11 + § States): previous values at 60 % opacity, inline `Spinner`, `aria-busy="true"`. No skeleton.
- **`requireOrg()` is the first line of every action.** `src/proxy.ts` carries no authorization by design (CVE-2025-29927; Clerk deprecates its route matcher with *"Server Functions are POSTs to the page's route"*) — a server action reached directly is a real entry point.
- **Fallback if it feels laggy:** a `GET` Route Handler, which parallelizes and is `AbortController`-cancellable. Note it; do not build it unless measured.

### Admin gate (D-10) — the Clerk role trap

I decoded danlo's **real** stored session token (`tests/e2e/.auth/storage-state.json`, gitignored, read only):

```json
{ "v": 2, "o": { "id": "org_3Jf2…", "rol": "admin", "slg": "bis-…" },
  "org_id": "org_3Jf2…", "role": "authenticated", "sts": "active", … }
```

And the parser that produces `auth().orgRole`:

```js
// @clerk/shared/dist/jwtPayloadParser.mjs — shipped inside @clerk/nextjs@7.9.4
case 2:
  if (claims.o) { orgId = claims.o?.id; orgSlug = claims.o?.slg;
                  if (claims.o?.rol) orgRole = `org:${claims.o?.rol}`; }
  break;
default: orgId = claims.org_id; orgRole = claims.org_role; …
```
`[VERIFIED: read from node_modules, 2026-09-22]`

**Therefore:**
- TypeScript: `auth().orgRole === 'org:admin'`, or `auth().has({ role: 'org:admin' })`.
- SQL: `app.jwt()->'o'->>'rol'` is **`'admin'`** — bare, no prefix. **There is no flat `org_role` claim on this instance.**
- A naive `coalesce(app.jwt()->'o'->>'rol', app.jwt()->>'org_role')` compares `'admin'` to `'org:admin'` and the admin gate silently fails or silently passes depending on which side you wrote first.

Write the helper to normalise, mirroring `app.current_org_id()`'s coalesce:

```sql
create or replace function app.current_org_role() returns text
language sql stable security definer set search_path = public as $$
  -- v2 nests the BARE role under o.rol ('admin'); v1 carries the PREFIXED form
  -- ('org:admin') flat. Normalise to the bare form; the TS side uses the prefixed one.
  select coalesce(app.jwt()->'o'->>'rol',
                  nullif(replace(coalesce(app.jwt()->>'org_role',''), 'org:', ''), ''))
$$;
```
Both shapes get their own test, exactly as Phase 1's D-11 pair does.

**Enforce admin in the database, not only in the UI.** Follow `app.ensure_org`'s shape: a `SECURITY DEFINER` `app.set_budget_cap(p_provider text, p_cap_micro bigint)` that re-checks `app.current_org_role() = 'admin'` and raises `42501` otherwise, with `set search_path = public` on the same statement (ASVS V4, CONVENTIONS). `authenticated` then needs **no UPDATE grant on `budget_periods.cap_micro_usd`** at all. The `CHECK (spent + reserved <= cap)` is the second layer: lowering the cap below what is already committed is refused with `23514` — verified boundary-exact at `cap >= spent + reserved` (5000→1600 accepted, →1599 refused, with spent 1200 + reserved 400). `[VERIFIED: executed locally]` Note this is *tighter* than the UI-SPEC's copy ("at least {spent + $1}") — the true floor is `spent + reserved`.

### Route-group and e2e move
`(app)` route group + the existing catch-all `proxy.ts` matcher needs no change. **Phase 1's `signed-in-as` / `org-id` / `org-row-id` testids move to `/settings/organization` and `tests/e2e/signed-in.spec.ts` moves in the same task** (UI-SPEC Executor Rule 7; that spec currently visits `/`). A retired testid fails silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cap enforcement under concurrency | A read + an `if` + a write | One conditional `UPDATE` (Pattern 1) | Proven 4× over-spend here, not in theory |
| Releasing crashed workers' reservations | A cron job you must remember to deploy | Self-healing `reserve_budget` (Pattern 2) | A paused project strands the budget forever |
| Duplicate-settlement protection | A "have we seen this?" `SELECT` | `request_id UNIQUE` + `ON CONFLICT DO NOTHING` | Same race, same class |
| Cap ceiling | Trusting the function | `CHECK (spent + reserved <= cap)` | Also refuses hand-written SQL and a future bug inside the definer |
| Money arithmetic | Floats, or integer cents | `bigint` µUSD + generated `numeric(12,2)` cents | 3.50 ¢/request; ±14.3 % otherwise |
| Money display | `toFixed(2)` + `'$'` | `Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})` via `src/lib/time.ts`'s pinned locale | UI-SPEC; and an unpinned locale is an SSR hydration mismatch |
| Month boundary | `new Date().getMonth()` | `at time zone 'America/Chicago'` in SQL; `APP_TZ` in TS | `Intl` formats in the *system* zone; `Date.UTC` anchors UTC midnight |
| Duplicate built-ins | A "does it exist?" check in the seed script | `UNIQUE NULLS NOT DISTINCT` | `NULL != NULL` — plain `UNIQUE` accepts the duplicate |
| Comptroller ↔ FIPS | Name sorting | The committed 254-row table + a `(fips+1)/2` assertion | 15 of 254 break under every collation |
| Geocoding | A Google Geocoding call | US Census Geocoder | Free, no key, US-only, and D-02 |
| Optimistic concurrency on save | A version-compare `SELECT` | `unique (search_id, version)` → `23505` | Race-free, and the UI-SPEC copy already exists for it |
| Audit rows | An app-tier `emit()` helper | `app.log_event` trigger / `app.emit_event` | BIS had five byte-identical copies; a fix reached one |
| Cards, sheets, drawers, badges | `<div className="bg-card rounded-lg border">` | shadcn primitives | UI-SPEC Executor Rule 6 — a treatment on the shared `Card` alone reaches almost nothing |
| Charts | `recharts` | `Progress` + painted divs | UI-SPEC; no chart library in this phase |

**Key insight:** every one of these is a place where the *correct* version is shorter than the hand-rolled one. The budget governor is not complex code; it is one statement plus two constraints, and every line of application logic added around it is a line that can be raced.

---

## Common Pitfalls

### Pitfall 1: The local database is PostgreSQL 18 and production is PostgreSQL 17
**What goes wrong:** PG 18-only syntax passes `pnpm test:db` and `pnpm verify`, then fails `pnpm db:migrate:prod`.
**Evidence:** local `server_version_num` = **180006**; Supabase `jahgeqshuesndyscnmjo` reports **PostgreSQL 17.6**; CI uses `postgres:18`. `[VERIFIED: both queried this session; 17.6 also recorded in 01-10-SUMMARY and 01-12-SUMMARY]`
**The live trap here:** `update … returning old.reserved, new.reserved` — a PG 18 feature — **is accepted locally** `[VERIFIED: executed]` and does not exist in 17. `uuidv7()` and virtual generated columns are the same class.
**How to avoid:** write PG 17-compatible SQL only; add a named DB test asserting `current_setting('server_version_num')::int >= 170000` and a grep gate over `drizzle/*.sql` for `returning old.`/`returning new.`/`uuidv7(`. `NULLS NOT DISTINCT` (PG 15+) and `MAINTAIN` (PG 17+) are both safe.
**Warning signs:** a migration that applies locally and errors on `db:migrate:prod`.

### Pitfall 2: Integer overflow in the meter's own arithmetic
**What goes wrong:** `(50*1000000)*80/100` → `22003 integer out of range` — a *correct* threshold computation that errors. `[VERIFIED: executed locally]`
**How to avoid:** every meter literal rides a `bigint` column or carries `::bigint`; prefer `(spent+reserved)*100 >= cap*80` over `cap*80/100`; a test at a $500 cap, not only $50.

### Pitfall 3: Mutating a built-in is silent, so the test must assert zero rows
**What goes wrong:** the obvious test (`expect(...).rejects.toThrow('42501')`) is green for the wrong reason on UPDATE/DELETE, because RLS filters rather than refuses. `[VERIFIED: executed locally]`
**How to avoid:** `rowCount === 0` for UPDATE/DELETE; `42501` for the forged-built-in INSERT only, in its own rolled-back transaction, with a positive control beside it.

### Pitfall 4: The free allowance makes an early-month estimate wrong
**What goes wrong:** the estimate quotes $2.40 for a preset that will cost $0.00 because the month's first 1,000 Enterprise requests are free. danlo stops trusting the number, which is the whole product.
**How to avoid:** `billable = max(0, requests − freeRemaining(sku))`, and **the ledger records zero-cost paid-SKU calls** so `freeRemaining` is derivable at all.

### Pitfall 5: A stale estimate repaints over a fresh one
**What goes wrong:** Server Actions are queued and uncancellable; an earlier answer lands last.
**How to avoid:** a monotonic sequence guard (§ Frontend). A named component test: fire two recomputes, resolve them out of order, assert the newer value survives.

### Pitfall 6: `starts_with()` on `outlet_naics_code`
**What goes wrong:** HTTP 400 `query.soql.type-mismatch` — it is a Socrata *number*. `[VERIFIED: attempted live]`
**How to avoid:** numeric range predicates. STACK.md already flags it; the seed script is where it bites.

### Pitfall 7: Comptroller county codes mistaken for FIPS
**What goes wrong:** the geocoder returns `215` for Hidalgo; the seed has `108`; the radius preset's county never matches and every radius estimate silently returns zero expected businesses.
**How to avoid:** both columns on the counties table, the `(fips+1)/2` identity asserted over all 254 rows, and a test that geocodes a recorded RGV fixture and resolves it to the right seeded county.

### Pitfall 8: `orgs` rows cannot be deleted
**What goes wrong:** `app.log_event`'s AFTER DELETE trigger inserts an `events` row referencing the just-deleted org → `events_org_id_orgs_id_fk` violation. I hit this in a probe. `[VERIFIED: executed locally]`
**How to avoid:** irrelevant inside `withRollback` (which is every DB test), but any *committed* fixture or script that creates an org cannot clean up by deleting it. Phase 2 adds no org-deletion path; just do not write one.

### Pitfall 9: A row trigger on `cost_ledger`
**What goes wrong:** one paid call → one ledger row → one `events` row carrying a full before/after payload. At Phase 4 volumes that is the `source_records` mistake CONVENTIONS already decided against (T-1-32).
**How to avoid:** no `log_event` on `cost_ledger` or `cost_reservations`; run-level events through `app.emit_event`; `EVENT_LOGGED` in `tests/db/event-trigger.test.ts` widened only for `searches`, `search_versions`, `budget_periods` — and the enumeration asserts **set equality in both directions**, so omitting one is red and adding one silently is also red.

### Pitfall 10: `shadcn init` on a dirty tree, or twice
**What goes wrong:** `init` refuses when `components.json` exists, and its edits to `layout.tsx` are ts-morph rewrites that are painful to untangle from unrelated changes.
**How to avoid:** first task, clean tree, `git status` printed before and after; record `npx shadcn@4.21.0 info`'s real `style`/`baseColor`/`iconLibrary` in the SUMMARY and **do not "fix" a value that differs** (UI-SPEC Step 4).

### Pitfall 11: Three timezones, all called "monthly"
`America/Chicago` (the app's budget period, D-11) · **US/Pacific** (Google's daily quota reset) · Google's billing month (billing-account aligned). They do not coincide. Never write copy that implies they do; the cap-reset sentence must keep saying "12:00 AM America/Chicago".

### Pitfall 12: `pnpm verify` does not run on this machine
Recorded four times in Phase 1. The composite shells out to a bare `pnpm` → global 11.9.0 → dies before the first constituent. **Run the four constituents individually through the store launcher.** CI on Linux is unaffected.

---

## Code Examples

### The meter, end to end (the shape to migrate)

```sql
-- Source: assembled from the four probes executed on PostgreSQL 18.6, 2026-09-22.
-- Kept PG 17-compatible: no RETURNING old./new., no uuidv7(), no virtual generated columns.
create or replace function app.reserve_budget(
  p_provider text, p_period date, p_micro bigint, p_run uuid, p_sku text,
  p_ttl interval default '10 minutes')
returns table (reservation_id uuid, pct_after numeric, at_80 boolean, at_100 boolean)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_bp uuid; v_res uuid; v_r bigint; v_s bigint; v_c bigint; v_freed bigint;
begin
  v_org := app.current_org_id();
  if v_org is null then raise exception 'reserve_budget: no current org' using errcode='42501'; end if;
  if p_micro <= 0 then raise exception 'reserve_budget: non-positive estimate' using errcode='22023'; end if;

  -- 1. self-heal (Pattern 2)
  with expired as (
    select r.id, r.est_micro_usd from cost_reservations r
      join budget_periods b on b.id = r.budget_period_id
     where b.org_id = v_org and b.provider = p_provider and b.period_start = p_period
       and r.settled_at is null and r.released_at is null and r.expires_at < now()
     for update of r skip locked
  ), rel as (
    update cost_reservations r set released_at = now()
      from expired e where r.id = e.id returning e.est_micro_usd
  ) select coalesce(sum(est_micro_usd),0) into v_freed from rel;
  if v_freed > 0 then
    update budget_periods set reserved_micro_usd = reserved_micro_usd - v_freed
     where org_id = v_org and provider = p_provider and period_start = p_period;
  end if;

  -- 2. the meter (Pattern 1) — ONE statement, no read first
  update budget_periods
     set reserved_micro_usd = reserved_micro_usd + p_micro
   where org_id = v_org and provider = p_provider and period_start = p_period
     and spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd
  returning id, reserved_micro_usd, spent_micro_usd, cap_micro_usd
       into v_bp, v_r, v_s, v_c;

  if v_bp is null then                                    -- DENIED
    select b.reserved_micro_usd, b.spent_micro_usd, b.cap_micro_usd into v_r, v_s, v_c
      from budget_periods b
     where b.org_id = v_org and b.provider = p_provider and b.period_start = p_period;
    return query select null::uuid, round(100.0*(v_s+v_r)/v_c, 1),
                        (v_s+v_r)*100 >= v_c*80, (v_s+v_r) >= v_c;
    return;
  end if;

  insert into cost_reservations (org_id, budget_period_id, run_id, sku, est_micro_usd, expires_at)
  values (v_org, v_bp, p_run, p_sku, p_micro, now() + p_ttl)
  returning id into v_res;

  -- 3. thresholds from the SAME row version (Pattern 3)
  return query select v_res, round(100.0*(v_s+v_r)/v_c, 1),
                      (v_s+v_r)*100 >= v_c*80, (v_s+v_r) >= v_c;
end $$;
```

### The concurrency proof (success criterion 5) — real connections, not `withRollback`

```typescript
// tests/db/budget-concurrency.test.ts
// withRollback is ONE transaction and CANNOT express this: the workers must be able to see
// each other's commits. This test therefore commits, and cleans up in `finally`.
// Source: the shape executed locally 2026-09-22 — granted 10 / denied 30 / reserved == cap.
const N = 40, CAP = 100n, UNIT = 10n;                 // exactly 10 reservations fit
const clients = await Promise.all(range(N).map(openTestClient));
await settle(150);                                     // let every socket finish handshaking
const results = await Promise.all(clients.map((c) =>
  c.query(`select reservation_id from app.reserve_budget('places', $1, $2, null, 'ts_enterprise')`,
          [PERIOD, UNIT.toString()])
   .then((r) => r.rows[0].reservation_id)));
expect(results.filter(Boolean)).toHaveLength(10);      // granted
expect(results.filter((r) => r === null)).toHaveLength(30); // denied — zero rows, not an error
const row = await readBudget();
expect(BigInt(row.reserved) + BigInt(row.spent)).toBe(CAP);  // no over-spend, no under-grant
```

**The control that makes it a proof, not a ritual** — the plan must also record that the same burst against a naive `SELECT`-then-`UPDATE` grants 40 and reserves 400. That is the mutation: swap `app.reserve_budget`'s body for the naive form on the **live local database** (never in the migration file, so the revert is provable by `git diff --stat` being empty), watch this one test go red, revert, verify from `pg_get_functiondef`.

### `fieldMaskTier()` — refuses, never defaults

```typescript
// Source: field→SKU table at developers.google.com/maps/documentation/places/web-service/data-fields
const ESSENTIALS = ['places.id', 'places.name', 'nextPageToken'] as const;   // nextPageToken is Essentials
const PRO        = ['places.displayName', 'places.formattedAddress', 'places.location',
                    'places.types', 'places.businessStatus'] as const;
const ENTERPRISE = ['places.websiteUri', 'places.nationalPhoneNumber',
                    'places.rating', 'places.userRatingCount'] as const;
const ATMOSPHERE = ['places.reviews'] as const;

export type PlacesField = typeof ESSENTIALS[number] | typeof PRO[number]
                        | typeof ENTERPRISE[number] | typeof ATMOSPHERE[number];

export function fieldMaskTier(mask: readonly PlacesField[]): Sku {
  if (mask.length === 0) throw new Error('fieldMaskTier: empty mask');
  let tier: Sku = 'ts_essentials';
  for (const f of mask) {
    if (ATMOSPHERE.includes(f as never))      tier = 'ts_enterprise_atmosphere';
    else if (ENTERPRISE.includes(f as never)) tier = max(tier, 'ts_enterprise');
    else if (PRO.includes(f as never))        tier = max(tier, 'ts_pro');
    else if (!ESSENTIALS.includes(f as never))
      // REFUSE. Defaulting to Essentials is how a field silently costs $40/1,000.
      throw new Error(`fieldMaskTier: unknown field ${f satisfies never}`);
  }
  return tier;
}
```
The union type bans `'*'` at compile time (PITFALLS 1). The mutation check: append `places.reviews` in a test and assert both the tier **and** the ledger price change.

### Chicago month boundary — one instant, two zones, opposite verdicts

```sql
-- Source: executed locally 2026-09-22.
-- 2026-10-01 04:30 UTC is 2026-09-30 in Chicago and 2026-10-01 in UTC.
select (timestamptz '2026-10-01 04:30:00+00' at time zone 'America/Chicago')::date  -- 2026-09-30
     , (timestamptz '2026-10-01 04:30:00+00' at time zone 'UTC')::date               -- 2026-10-01
     , date_trunc('month', timestamptz '2026-10-01 04:30:00+00'
                           at time zone 'America/Chicago')::date;                    -- 2026-09-01
-- October's period therefore begins at 2026-10-01T05:00:00Z, not at 2026-10-01T00:00:00Z.
```
Chicago only ever as half a pair; suites run `TZ=UTC` so a forgotten zone is red (CONVENTIONS § Time, `vitest.config.ts` line 1).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Legacy Places API + `next_page_token` | Places API (New), REST + `X-Goog-FieldMask` | 2025-03-01 pricing model | The field mask **is** the budget control; there is no cheap `websiteUri` |
| `tailwind.config.ts` | `@theme` inside `globals.css`, `@tailwindcss/postcss` | Tailwind v4 | UI-SPEC Executor Rule 13; `rounded-[--x]` silently emits invalid CSS — use `[var(--x)]` |
| shadcn default base = Radix | shadcn default base = **Base UI** (2026-07) | `-b radix` required | `vaul@1.1.2` is the Radix variant; STACK.md pins it |
| Clerk session token v1 (flat `org_id`, `org_role`) | v2 (`o.id`, `o.rol` — bare role) | Clerk v2 default | `auth().orgRole` is `'org:admin'`; the JWT holds `'admin'`. Two spellings |
| `middleware.ts` doing authorization | `proxy.ts` for session context only | Next 16 / CVE-2025-29927 | Authorization in the server action, next to the data |
| A GCP budget alert as the cap | A per-API **quota** as the second wall | always been true, widely misunderstood | *"Setting a budget does not automatically cap… usage or spending"* |
| `pg_cron` sweeper on the correctness path | Self-healing reserve | this research | Removes a scheduler dependency; pg_cron becomes optional hygiene |

**Deprecated / outdated:**
- `api.census.gov` data endpoints now require a key (`Missing Key` HTML on an unkeyed request `[VERIFIED: fetched]`). The **geocoder** at `geocoding.geo.census.gov` does **not**, and neither does `www2.census.gov`'s static reference file. Use those two.
- `starts_with()` on Socrata numeric columns — never worked; it is a type error, not a deprecation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| **A1** | The "RGV 17" is definable as the 17 cities with ≥400 active outlets (90.7 % coverage). The corpus gives 17 / ~20 / 22 with no list. | § Seed Data | Wrong city list ⇒ wrong seed, wrong estimate, wrong Phase 3 ingest scope. **This is the Phase 2 ∥ Phase 3 shared contract — confirm with danlo before planning.** Willacy's only town (Raymondville, 221) falls below the threshold. |
| **A2** | 100 requests/day is the right Google quota. | § Second Wall | Too low throttles a weekly partition (PLACE-04); too high widens the runaway bound. Reversible in the console; the derivation is printed on the card. |
| **A3** | `FAN_OUT = 3.0` (query fan-out / tile overlap). | § Estimator | Every dollar figure scales linearly with it. **Explicitly unmeasured by design (D-07)**; trued up at the Phase 6 gate. |
| **A4** | Each `pageToken` page is separately billed. | § Cost Model | If pages are bundled, every estimate is up to 3× too high. STACK.md carries the same MEDIUM. Verify on the first invoice. |
| **A5** | Google daily quotas reset at midnight **US/Pacific**. | § Second Wall | Only affects runbook copy, not the meter. |
| **A6** | `tsx scripts/seed.ts` over a committed migration for the seed rows. | § Seed loader | If the planner prefers a migration, the counts table stops being refreshable without a new migration per refresh. |
| **A7** | The Vercel project is on **Pro**. | § Environment | Blocks nothing in Phase 2 (self-healing reserve needs no cron) but decides the Phase 9 scheduler. `vercel teams ls` → *"The specified token is not valid"*; unverified. |
| **A8** | `shadcn init` writes `postcss.config.mjs`, `src/app/globals.css`, `src/lib/utils.ts`, `components.json` and rewrites `layout.tsx`'s font import. | § Frontend | I was instructed not to run `init`. The font rewrite and the `components.json` abort-if-exists are **verified from the package source**; the exact file set is inferred. Record the real output in the task SUMMARY. |
| **A9** | `budget_periods` rows are created lazily on first use, copying the org's `cap_micro_usd` default. | § Schema | Where the default $50 lives (an `orgs` column vs a constant vs a `budget_settings` row) is undecided. Copy `drizzle/0009`'s select-then-do-nothing shape whichever way it goes. |

---

## Open Questions

1. **Which 17 cities?** (A1)
   - *What we know:* the measured outlet distribution for all 114 (city, county) pairs; a ≥400 threshold yields a clean 17 covering 90.7 %.
   - *What's unclear:* whether danlo wants every county represented (Willacy's Raymondville is 22nd at 221 outlets) and whether `RIO GRANDE CY`/`RIO GRANDE` fold into Rio Grande City in the picker.
   - *Recommendation:* take the measured 17 as the default, surface the list in the plan for a one-line confirmation, and fold the name variants. **Phase 3 reads this — agree it before the two phases run in parallel.**

2. **Where does the default $50 cap live?** (A9)
   - *Recommendation:* `budget_periods.cap_micro_usd` with a `DEFAULT 50000000`, seeded lazily by a `get-or-create-period` definer copying the previous period's cap (so an edited cap persists across months). A cap on `orgs` is the alternative; either way the edit path is `app.set_budget_cap`.

3. **Does Phase 2 wire "Run this preset" at all?**
   - UI-SPEC OQ 7 already decided the fallback: the button ships with its label plus visible helper text ("Runs start when the Places verifier ships in Phase 4"). But the `runs` row + the reservation *can* be created here, which is what makes criterion 5's "concurrent burst is refused" reachable from the UI rather than only from a test.
   - *Recommendation:* create `runs` in status `queued` and take the reservation; Phase 4 picks it up. Say so in the drawer copy.

4. **Is the Vercel project on Pro?** (A7) — not blocking Phase 2; needed before the Phase 9 scheduler is planned. A `checkpoint:human-action` one-liner.

5. **`cost_ledger` retention.** One row per paid call, forever, is fine at 2,400 rows/month, but the spend view's "by run" query wants `(org_id, budget_period_id, run_id)` indexes from day one. Partitioning is Phase 9's problem; the index is this phase's.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Local PostgreSQL (test target) | every DB test, the meter proof | ✓ | **18.6** (`server_version_num` 180006) | — |
| Supabase production | `db:migrate:prod` | ✓ | **17.6** ⚠️ **version drift from local/CI** | — |
| `pg_cron` on the Supabase project | optional sweeper | **available, not installed** | `1.6.4` in `pg_available_extensions` | Self-healing reserve (recommended) or Vercel Cron |
| `pg_net` / `postgis` / `pg_trgm` / `fuzzystrmatch` / `unaccent` | Phase 3+ | available, not installed | 0.20.4 / 3.3.7 / 1.6 / 1.2 / 1.1 | — |
| Installed extensions on prod | — | `pg_stat_statements 1.11`, `pgcrypto 1.3`, `uuid-ossp 1.1`, `supabase_vault 0.3.1`, `plpgsql` | | |
| Node.js | everything | ✓ | 24.13.0 | — |
| pnpm 12.5.1 | install / scripts | ✓ **launcher only** | 12.5.1 via the store path; bare `pnpm` is 11.9.0 | run constituents individually |
| `npx` / npm registry | `shadcn`, version checks | ✓ | shadcn 4.21.0 reachable | — |
| US Census Geocoder | D-02 radius mode | ✓ | `Public_AR_Current` / `Current_Current` | msw fixtures in CI; "switch to county" in the UI |
| `www2.census.gov` county FIPS file | 254-county seed | ✓ | `national_county2020.txt`, 254 TX rows | commit the file |
| TX Comptroller Socrata `jrea-zgmq` | outlet counts | ✓ | `rowsUpdatedAt` 2026-09-19 | commit the derived JSON |
| `api.census.gov` data API | — | ✗ (**`Missing Key`**) | — | not needed; use the two above |
| `psql` on PATH | convenience | ✗ | — | `pg` from `node_modules` (used throughout this research) |
| **Google Cloud project + Places API (New) key** | BUDG-03 | ✗ | — | **none — `checkpoint:human-action`.** Nothing in `src/` may depend on it (UI-SPEC Rule 14) |
| Vercel plan (Pro?) | Phase 9 cron | **unknown** | CLI token invalid | not needed in Phase 2 |

**Missing dependencies with no fallback:** the GCP project/key — but by design it blocks nothing in this phase.
**Missing with fallback:** `psql` (use `pg`); `pg_cron` (self-healing reserve); `api.census.gov` (static file).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@5.0.1` (+ `vite@8.3.0`) unit & DB-integration; `@playwright/test@1.63.0` E2E |
| Config files | `vitest.config.ts` (TZ+locale pinned on line 1, `pool:'forks'`) · `vitest.db.config.ts` (`pool:'forks'`, `fileParallelism:false`, `isolate:false`, `.env.local`) · `playwright.config.ts` (deployed URL only) |
| Quick run command | `pnpm test:unit` → `vitest run tests/unit` |
| DB suite command | `pnpm test:db` → `vitest run --config vitest.db.config.ts --pool=forks` |
| Full suite command | `pnpm verify` → typecheck + lint + unit + db + build — 🔴 **not runnable on this machine; run the five constituents individually through the store launcher** |
| E2E command | `pnpm test:e2e` → against `E2E_BASE_URL` (deployed) |
| Baseline at the Phase 1 gate | unit **11** (4 files) · db **31** (9 files) · e2e **4** |

🔴 **Two harness changes this phase forces:**
1. `vitest.db.config.ts` sets `fileParallelism: false` and `isolate: false`. The **concurrency test must open its own `pg.Client` connections** (as my probes did) — serial *files* is orthogonal, but the test cannot use `withRollback`, which is one transaction and therefore cannot express two workers seeing each other's commits. It commits and cleans up in `finally`; the cleanup **cannot delete an `orgs` row** (Pitfall 8) so it must key off a dedicated provider/period, not a throwaway org.
2. Component tests need `environment: 'jsdom'` + `@vitejs/plugin-react`. `vitest.config.ts` already globs `**/*.test.tsx` but has neither — a `.test.tsx` today fails on the JSX transform. Either add a `environmentMatchGlobs`-style split or a third config; **do not change the node-environment default for `tests/unit/**/*.test.ts`**, because `suite-zone.test.ts` and `time.test.ts` depend on it.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| BUDG-02 | 40 concurrent reservations against a cap that fits 10 → exactly 10 granted, `reserved == cap`, 0 errors | DB (multi-conn) | `pnpm test:db -t "concurrent burst"` | ❌ Wave 0 |
| BUDG-02 | **Control:** the naive check-then-spend body over-spends under the same burst | DB (mutation) | applied to the live DB at the gate, `pg_get_functiondef` verified | ❌ Wave 0 |
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
| BUDG-01 | **Mutation:** appending `places.reviews` raises the tier **and** the ledger price | unit | `pnpm test:unit -t "atmosphere"` | ❌ Wave 0 |
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
| D-10/FOUND-03 | A cap change writes an `events` row with actor + timestamp, from a raw SQL write | DB | `pnpm test:db -t "cap change is audited"` | ❌ Wave 0 |
| Phase 1 carry | Every new table is in `TENANT_TABLES`; live catalog equals the array | DB | `pnpm test:db -t "holds no"` | ✏️ extend |
| Phase 1 carry | Every new table has `org_id` + RLS + ≥1 policy; every timestamp is `timestamptz` | DB | `pnpm test:db -t "every public table"` | ✅ auto-covers |
| UI-SPEC R7 | `signed-in-as` / `org-id` / `org-row-id` resolve on `/settings/organization` | E2E | `pnpm test:e2e -g "org-scoped"` | ✏️ move spec |
| UI-SPEC R2/R8 | Computed accent is `rgb(15, 118, 110)` light / `rgb(45, 212, 191)` dark, on the **built** app | E2E | `pnpm test:e2e -g "theme tokens"` | ❌ Wave 0 |
| UI-SPEC R9 | Primary controls ≥44×44 at 390×844 | E2E | `pnpm test:e2e -g "touch targets"` | ❌ Wave 0 |
| Pitfall 1 | `server_version_num >= 170000`; no `returning old.`/`new.`/`uuidv7(` in `drizzle/*.sql` | DB + unit (grep) | `pnpm test:db -t "server version"` · `pnpm test:unit -t "pg17"` | ❌ Wave 0 |

### Sampling Rate
- **After every task commit:** `pnpm test:unit` + the single `-t "<name>"` filter for the test that task made green — **read the test name in the output**; a `-t` filter that matches nothing exits 0 green.
- **After every plan wave:** the five `verify` constituents individually through the store launcher.
- **Before `/gsd-verify-work`:** all constituents green, `pnpm test:e2e` green against the deployed URL, and the mutation checks below applied to the **live local database** and reverted with `git diff --stat` empty.
- **Max feedback latency:** 60 s (unit + one DB filter).

**Proposed phase-gate mutations (M7–M12, continuing Phase 1's numbering):**

| # | Mutation on the live local DB | Must red — exactly |
|---|---|---|
| M7 | Replace `app.reserve_budget`'s conditional `UPDATE` with a `SELECT`-then-`UPDATE` | `concurrent burst` only. The single-worker tests stay green — which is the point. |
| M8 | `alter table budget_periods drop constraint bp_not_over` | `bp_not_over` + `cap below current spend`; the positive control (raising the cap) stays green |
| M9 | `alter table cost_ledger drop constraint cost_ledger_request_id_key` | `settlement idempotency` only |
| M10 | `create or replace function app.current_org_role()` returning the literal `'admin'` | `set_budget_cap refuses a member` only; the admin positive control stays green |
| M11 | Append `places.reviews` to the production field mask constant | `fieldMaskTier atmosphere` **and** the ledger-price test — two, and they are independent |
| M12 | `grant update on public.search_versions to authenticated` | `versions immutable` only; `run keeps its version` stays green |

Each per CONVENTIONS § Testing: watched failing first, SQLSTATE **and** constraint name pinned, message pinned where two invariants share `42501`, one refused statement per rolled-back transaction, a positive control beside every refusal, and every test's **name** read in the output.

### Wave 0 Gaps
- [ ] `vitest.config.ts` — a jsdom lane for `**/*.test.tsx` + `@vitejs/plugin-react`, **without** changing the node default for `*.test.ts`
- [ ] `tests/unit/_setup-dom.ts` — `@testing-library/jest-dom` matchers
- [ ] `tests/db/_concurrency.ts` — an `openTestClient()` helper that opens N real connections against `TEST_DATABASE_URL` (refusing a Supabase host, like `withRollback` does) and tears them down in `finally`; **not** built on `withRollback`
- [ ] `tests/unit/msw/` — `server.ts` + recorded Census fixtures (McAllen hit, Rio Grande City hit, empty `addressMatches`, 503)
- [ ] `tests/unit/fixtures/preset.ts` — a `PresetSpec` fixture shared by the estimator and component tests
- [ ] `src/seed/data/*.json` — clusters, 17 cities, 4+254 counties, outlet counts — committed before any test that reads them
- [ ] `tests/db/grants-audit.test.ts` — extend `TENANT_TABLES` with all eight new tables (test 1 asserts the array equals the live catalog, so forgetting is red)
- [ ] `tests/db/event-trigger.test.ts` — extend `EVENT_LOGGED` with `searches`, `search_versions`, `budget_periods`; **deliberately exclude** `cost_ledger`, `cost_reservations`
- [ ] `eslint-plugin-react-hooks` (or `eslint-config-next`) — the current config has no React rules at all, and this is the first phase with hooks
- [ ] Framework install: see § Standard Stack installation block

---

## Security Domain

ASVS **L1**, `security_block_on: high`. The phase note is explicit: *budget enforcement is a spend-control boundary; the reserve→spend→true-up path must be race-free and unbypassable.*

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes (inherited) | Clerk; `requireOrg()` first line of every page, route handler **and server action** |
| V3 Session Management | yes (inherited) | Clerk session; claims bound transaction-locally by `withOrg` (`set_config(..., true)`) |
| V4 Access Control | **yes — primary** | RLS `org_id` policies + `_org_idx`; explicit DML grants; `app.set_budget_cap` re-checks `app.current_org_role()`; every `SECURITY DEFINER` pins `set search_path = public` on the same statement |
| V5 Input Validation | yes | `zod` on the Census response; `PlacesField` union bans `'*'`; cap input parsed to `bigint` µUSD server-side; `CHECK (est_micro_usd > 0)` |
| V6 Cryptography | no | No new secrets in this phase. The Google key does not exist; `src/env.ts` declares names only |
| V7 Error Handling & Logging | yes | `app.log_event` / `app.emit_event`; `events` immutable by GRANT; refusals name the SQLSTATE, never leak another tenant's figures |
| V8 Data Protection | yes (inherited) | FOUND-05 retention constraints untouched; the geocoder result stores only lat/lng/county/matched-address |
| V12 Business Logic | **yes — primary** | The meter itself: atomic, idempotent, self-healing, with a `CHECK` backstop |

### Known Threat Patterns

| Ref | Pattern | STRIDE | Standard Mitigation |
|---|---|---|---|
| T-2-01 | Server action POSTed directly, bypassing the UI's gating | Elevation | `requireOrg()` + role check inside every action; `proxy.ts` carries no authorization by design |
| T-2-02 | A member raises the cap | Elevation | `app.set_budget_cap` (definer) re-checks `app.current_org_role()`; `authenticated` holds no UPDATE on `budget_periods.cap_micro_usd` |
| T-2-03 | **A paid call made outside the meter** | Tampering / Repudiation | `cost_ledger.reservation_id` is `NOT NULL` + FK, so a ledger row cannot exist without a reservation; a grep gate keeps `X-Goog-FieldMask` in one module (PITFALLS 1) |
| T-2-04 | Read-then-spend race overruns the cap | Tampering | Pattern 1 + the M7 mutation control |
| T-2-05 | Settlement replayed → double count | Tampering | `request_id UNIQUE` + `ON CONFLICT DO NOTHING` (M9) |
| T-2-06 | Crashed worker's reservation strands budget → self-DoS | DoS | TTL + self-healing reserve (Pattern 2) |
| T-2-07 | Negative or overflowing reservation amount | Tampering | `CHECK (est_micro_usd > 0)`, `bigint` throughout, `CHECK (spent + reserved <= cap)` |
| T-2-08 | Ledger price from a constant instead of the mask | Repudiation | `fieldMaskTier(actualMaskSent)` + the M11 mutation |
| T-2-09 | Built-in reference rows mutated or forged by a tenant | Tampering | Write policies exclude `org_id IS NULL`; verified zero-rows / `42501` split |
| T-2-10 | Cross-org budget or preset read/write | Info disclosure | Phase 1 `orgPolicies` + `_org_idx`; two orgs in every fixture |
| T-2-11 | Actor forged on a cap change | Repudiation | `app.log_event` trigger; `events` INSERT revoked from `authenticated` (0011) |
| T-2-12 | A run re-pointed at a different preset version after the fact | Tampering | `search_versions` immutable by GRANT; `runs.search_version_id` FK `on delete no action` (M12) |
| T-2-13 | Geocoder input abused (SSRF / injection) | Tampering | Hard-coded host; the address only ever a query parameter; zod-bounded length + charset; response parsed, never `eval`'d |
| T-2-14 | Estimate action used as an unauthenticated compute oracle | DoS | Auth first; 400 ms debounce; one in-flight request; no paid call, so the blast radius is CPU, not dollars |
| T-2-15 | Google key leaked to the client | Info disclosure | The key does not exist; `src/env.ts` is `server-only`; no `NEXT_PUBLIC_` name; UI-SPEC Rule 14 |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the planner must honour. Treated with the same authority as CONTEXT.md's locked decisions.

- **PR-only once CI exists; no autonomous merges — danlo reviews before merge.**
- **`typescript@6.0.3`, never 7.x** — `typescript-eslint@8.70.0`'s peer is `>=4.8.4 <6.1.0`.
- **Own Supabase project (`jahgeqshuesndyscnmjo`), never BIS's `tlbkbmlrfafquucsmsmm`.**
- **Every table carries `org_id` with RLS from the first migration; every assertion tested through a user-role connection with Clerk claims, pinning `42501`, watched failing first, one refused statement per rolled-back transaction.**
- **`legal_name` / `display_name` / internal annotations are three fields, never interchangeable**; a test asserts the internal one never reaches an export or push payload. New user-visible names on presets follow the same split (`name_internal` / `display_name`) and register with `PAYLOAD_BUILDERS` if they ever go outbound.
- **World-class UI/UX is a first-class requirement** — `/gsd-ui-phase` ran; 02-UI-SPEC.md is the contract.
- **RGV is `America/Chicago`; tests pin zone AND locale.**
- **Carried-over BIS gotchas:** painted values not CSS custom properties for anything a test pins; Tailwind v4 uses `[var(--x)]` not `[--x]`; a `"use client"` module's exports are client references inside a server component.
- **Budget:** `< $50/month` enforced as an atomic reservation cap **plus** a Google Cloud per-API daily quota; a GCP budget alert alone does not stop spend.
- **Places via REST `fetch` with a hard-coded field-mask allow-list**; `@googlemaps/*` packages are on the do-not-use list.
- **Drizzle-kit is the single migration authority.** No Supabase CLI migrations, no MCP `apply_migration`.
- **`msw` with recorded real payloads; CI must never spend budget.**
- **A green suite proves nothing a mutation check hasn't** — one named test per mutation, reverted, diffed back, and read the failing test's *name*.
- **Vercel Pro (~$20/mo) is infrastructure, separate from the $50 data cap — never merge the two numbers in reporting** (the spend view's footer note already says this).

---

## Sources

### Primary (HIGH — executed or read directly this session)
- **Local PostgreSQL 18.6** (`TEST_DATABASE_URL`) — four throwaway-schema probes, all rolled back / dropped, `git status` clean afterwards: the 40-way concurrency burst and its naive/`FOR UPDATE` controls; settlement idempotency; the `bp_not_over` CHECK and its cap-lowering boundary; the self-healing reserve against a crashed-worker fixture; `RETURNING old./new.` acceptance; the Chicago/UTC month pair; reference-row RLS (zero-rows vs `42501`) and the trigger that does not work; `UNIQUE` vs `UNIQUE NULLS NOT DISTINCT`; µUSD→cents generated column; int4 overflow in the threshold expression
- **Supabase project `jahgeqshuesndyscnmjo`** (read-only, `SUPABASE_DB_URL`) — `select version()` → **PostgreSQL 17.6**; `pg_extension` and `pg_available_extensions` → **`pg_cron 1.6.4` available, not installed**
- `data.texas.gov/resource/jrea-zgmq.json` — county totals, cluster×county matrix, statewide totals, the 114 (city, county) pairs, the `000` sentinel, `starts_with` type-mismatch
- `geocoding.geo.census.gov/geocoder/` — `benchmarks`, `vintages`, `locations/onelineaddress`, `geographies/onelineaddress`, the `layers` parameter, and eight failure-mode cases
- `www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt` — 254 TX rows; the contiguous-odd-FIPS proof
- `npm view` (2026-09-22) — every version and peer range in § Standard Stack
- `npx shadcn@4.21.0 {--help, init --help, add --help, migrate --list}` and the cached package's `dist/index.js` — flags, preset map, `components.json` abort, ts-morph font rewrite
- `node_modules/.../@clerk/shared/dist/jwtPayloadParser.mjs` — the v1/v2 → `orgRole` mapping
- `tests/e2e/.auth/storage-state.json` (local, gitignored, read-only) — danlo's real `v:2` token with `o.rol = "admin"`
- Repo: `src/db/**`, `drizzle/0007`–`0011`, `tests/db/**`, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest*.config.ts`

### Secondary (HIGH-MEDIUM — official documentation)
- `developers.google.com/maps/billing-and-pricing/pricing` — the SKU table with SKU IDs and free allowances
- `developers.google.com/maps/documentation/places/web-service/usage-and-billing` — "billed at the highest SKU applicable"
- `docs.cloud.google.com/apis/docs/capping-api-usage` — the quota console path, the `limit exceeded` behaviour, the enforcement-latency caveat
- `nextjs.org/docs/app/getting-started/css` (v16.3.5, updated 2026-08-25) — Tailwind v4 + `@tailwindcss/postcss` + `postcss.config.mjs`; dev-vs-build CSS ordering
- `tailwindcss.com/docs/installation/framework-guides/nextjs` — same, from the other side
- `geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html` — endpoints, parameters, the 10,000-record batch ceiling, no stated rate limit
- `supabase.com/docs/guides/cron` — `cron.job` / `cron.job_run_details`, ≤8 concurrent jobs, ~10 min each
- Project corpus: `.planning/research/{ARCHITECTURE,STACK,FEATURES,PITFALLS,DATA-SOURCES}.md`, `.planning/CONVENTIONS.md`, `.planning/phases/01-foundations-tenancy/01-VALIDATION.md` and the twelve SUMMARYs

### Tertiary (MEDIUM/LOW — corroborating, flagged)
- `github.com/vercel/next.js/discussions/50743`, `hmos.dev/en/next-server-action-sequence`, `vercel/next.js#57652` — Server Actions execute sequentially; transitions must be synchronous. Consistent across three independent sources; not in Next's own docs.
- Google daily-quota **US/Pacific** reset — consistent across quota guidance, not re-read from a single canonical page (A5)
- Per-page `pageToken` billing — inferred from per-request SKU semantics (A4); STACK.md carries the same MEDIUM

---

## Metadata

**Confidence breakdown:**
- **Meter / concurrency / settlement:** **HIGH** — executed on the real local PostgreSQL under real concurrency, with a discriminating control
- **Seed data (counties, clusters, outlet counts, FIPS):** **HIGH** — re-queried live; matches DATA-SOURCES.md to the row; the FIPS bijection computed over all 254
- **The 17-city list:** **MEDIUM** — the *data* is verified; the *threshold* is my recommendation (A1) and is a product call
- **SKU price table:** **HIGH** — official pricing page, with SKU IDs
- **Census Geocoder:** **HIGH** — every endpoint, parameter, benchmark, vintage and failure mode exercised live
- **`shadcn init` flags and preset map:** **HIGH** — read from the shipped package
- **What `init` writes into *this* repo:** **MEDIUM** — not run, by instruction (A8)
- **Clerk role claim shape:** **HIGH** — real token + the shipped parser, both read
- **pg_cron availability:** **HIGH** — queried on the actual production project (closes STACK.md's LOW-confidence item)
- **Google quota console path:** **MEDIUM-HIGH** — official capping doc + corroborating Maps Platform guidance; the exact menu labels drift
- **Texas multiplier / fan-out:** **LOW by design** — D-07 makes it an explicit committed constant to be trued up at the Phase 6 gate

**Research date:** 2026-09-22
**Valid until:** 2026-10-22 for the stack and SKU prices (verify `npm view` and the Google pricing page before Phase 4's first paid call); **7 days** for `shadcn@4.21.0`'s registry behaviour, which moves fast.

**Working-tree hygiene:** every probe ran against the LOCAL database in a throwaway schema or a rolled-back transaction, each dropped in `finally`; one probe left a committed `orgs` row (Pitfall 8) which was removed via `session_replication_role = replica` and verified gone (`orgs 0, events 0, probe schemas 0`). No package installed, no migration written, no `shadcn init` run. `git status` is clean apart from this file; `main` @ `510c8d7`.
