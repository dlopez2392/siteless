# Phase 4: Places Transient Verifier - Research

**Researched:** 2026-09-23
**Domain:** Google Places API (New) Text Search as a billed, transient verifier; Vercel Workflow DevKit (first use); quadtree tiling; in-memory entity matching; retention-enforced storage; Vercel Cron
**Confidence:** HIGH on the Workflow SDK, the Places request shape, the place-type table and the repo's own budget/tenancy mechanics (all verified this session by install, spike, raw-HTML parse or source read). MEDIUM on tiling constants, SAB behaviour under `locationRestriction`, and per-page billing (empirical; settled by the D-04 run and the first invoice).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Legal gate, Google setup and the first real call
- **D-01:** **Build and test the whole phase against recorded payloads. Gate production.** Every plan until the gate runs on msw-recorded Places payloads. CI never spends budget (Phase 2 D-04), and nothing in the app needs the key to pass its tests.
  - Before the **first real Places call of any SKU**, a `checkpoint:human-action` records one of two things in PROJECT.md Key Decisions: counsel's answer on Maps Platform Terms §3.2.3(c) (is a derived value "Content"?) and §3.2.3(d)(iii) (is a lead tool a "listings or directory service"?), **or** danlo's own written risk call.
  - The checkpoint enumerates exactly what persists (D-05, D-10, D-13), so the call covers the real list, not the PLACE-02 wording alone.
- **D-02:** **A kill switch ships regardless of the legal answer:** a `PLACES_MODE` env var with values `off | ids_only | enterprise`, **defaulting to `off`**.
  - It is declared in `src/env.ts` (fail loudly on an unknown value) and read by the adapter.
  - Changing it takes a Vercel env edit and a redeploy. That is deliberately hard to flip by accident; there is no in-app toggle.
  - `off` refuses before any reservation. `ids_only` permits only the Essentials mask (change detection). `enterprise` permits the full mask.
  - A "no" from counsel is a config change, as the roadmap requires.
- **D-03:** **GCP setup is a runbook-driven human-action checkpoint, and danlo does the clicking.** danlo:
  1. creates the Google Cloud project;
  2. enables Places API (New);
  3. attaches billing;
  4. sets **Places API (New) → Requests per day = 100** (the value and derivation already in `docs/runbooks/google-quota.md`);
  5. creates an API key **restricted to Places API (New)**.

  The key goes into `.env.local` and Vercel env, names only in `.env.example`. Claude verifies the key with **one free IDs-Only call** and closes BUDG-03. `tests/unit/no-google-credential.test.ts` must be amended deliberately, never deleted: the adapter module becomes the one sanctioned reader.
- **D-04:** **The first real run is one city × one cluster** (e.g. McAllen × home services). It is sized to fit inside the free 1,000 Text Search Enterprise requests per month. It:
  - records the msw fixtures from real payloads;
  - proves saturation, subdivision and SAB inclusion on real RGV density;
  - makes the TTL purge and the run report non-synthetic.

  It also un-synthesizes the Phase 2 items deferred to this phase: the 80 % / 100 % banner shots and the two `budget-banner` specs that self-skip on production (02 deferred-items). Its geography is the likely Phase 6 slice.

#### Matching Places results to the spine
- **D-05:** Each Places result is scored **in memory, at call time** against spine businesses, reusing Phase 3's weighted features, weights module and 95/80 thresholds. Google's name, address and phone are never persisted.
  - **≥95** attaches the `place_id` (a join table, never an FK on `businesses`).
  - **80–95** attaches as **`tentative`**, carrying its score and component vector (derived numbers only). A tentative attachment is **excluded from every verdict input** until confirmed. It lands in the **existing review queue**, which shows the spine side plus the signal chips (Google's text cannot be shown because it isn't stored). Actions: confirm / reject; a reject marks the pair so it never re-attaches.
  - **<80** is dropped from matching and counted.
- **D-06:** **Unmatched Places results keep only their `place_id`**, in a tile-membership record. This is legal indefinitely and required anyway: IDs-Only change detection diffs the set of place_ids per tile, and an unkept id would read as "new" every night. These results never become businesses or leads. The run report counts "Google places that matched nothing in the spine" **per cluster**, so the coverage gap is measured, not guessed. Home-services trades are the expected gap: Texas residential repair is often not sales-taxable, so there's no Comptroller permit.
- **D-07:** **The pure service-area-business branch** (Phase 3 deferred it to here). A result with `pureServiceAreaBusiness` and no location can reach ≥95 via **exact E.164 phone plus name similarity above the bar**, with **the queried city standing in for locality**. Without an exact phone it caps at the tentative band. The Phase 3 rule "never merge across > 25 km" is unaffected; an SAB simply has no distance to test.
- **D-08:** **Collisions:**
  - **Many place_ids → one business is allowed** (Google has duplicate listings too). The business's current `had_website_uri` is **true if any attached, non-tentative listing's latest observation is true**. That leans against a false "no website" lead.
  - **One place_id tying across two businesses at ≥95 goes to tentative/review.** The system never picks silently.
  - Chain-flagged businesses (Phase 3 D-11) follow the same rules. Phase 3 already keeps them out of the funnel.

#### What survives the call: the website signal
- **D-09:** **Amends PLACE-02 and roadmap success criterion 2.** A **derived host class** persists beside the boolean. At call time a pure, unit-tested string match classifies `websiteUri` into `none | business_site_dead | social | directory | platform_subdomain | other`, and then **the URL itself is discarded**. The host-pattern table follows PITFALLS Pitfall 4:
  - `business.site` / `g.page` → dead;
  - facebook / instagram / linktr.ee / beacons.ai → social;
  - yelp / yellowpages / bbb / nextdoor / mapquest / manta → directory;
  - wixsite / square.site / myshopify / godaddysites → platform subdomain.

  This captures the prime `business.site` cohort at $0 without storing a URL. Phase 5 probes `other` through durable URLs (Overture `websites[]`) or web search, never through a stored Places URL. The planner updates REQUIREMENTS.md PLACE-02 and the ROADMAP criterion text in the same plan that introduces the column.
- **D-10:** **Observations are append-only.** There is one immutable row per (business, `place_id`, run) holding:
  - the boolean;
  - the host class;
  - the SKU tier the observation was billed at;
  - `observed_at`;
  - the derived `pureServiceAreaBusiness` flag (see D-13);
  - lat/lng with a **30-day `expires_at`**.

  The business's current signal is its latest row. "Got a website since last run" becomes a query, which Phase 9's lead auto-retire reads. UPDATE/DELETE are revoked by grant, except the coordinate purge (D-12), which nulls coordinates and never deletes the observation.
- **D-11:** **Attribution is inline with the signal (PLACE-06).** It uses the Phase 3 source-tag pattern, e.g. "No website listed · Google Maps · Sep 23", as another source tag beside "Comptroller" and "Overture". A test pins that the tag renders **wherever** a Places-derived signal renders. No non-Google map is ever rendered on a screen that shows Places content (DATA-SOURCES § Google attribution, §3.2.3(e) / §B.14.2).
- **D-12:** **The TTL purge is observable.** `/sources` gains a **"Google Places (transient)"** row showing:
  - place_ids held;
  - coordinates held;
  - the oldest coordinate's age (always < 30 days);
  - the last purge time and the rows purged.

  The purge is a **daily Vercel Cron** job (Pro). It must not depend on a run happening. A database-level proof ensures no coordinate older than 30 days can be read (a CHECK or read-path guard, plus a named test), so a missed cron day is visible and never silently in breach.
- **D-13:** `pureServiceAreaBusiness` joins the field mask; it's Pro tier, so free at the margin under Enterprise. Update `fieldMaskTier`'s PRO list and `PLACES_TEXT_SEARCH_FIELD_MASK`, keeping the M11 mutation test meaningful. The flag persists on the observation as a derived signal and is named in D-01's legal enumeration. Nothing else from the response persists.

#### How a run executes
- **D-14:** **The executor is a Vercel Workflow (Workflow DevKit, `workflow@4.x`).** Phase 2's Run button (`queue-run.ts`, which already creates a `queued` run and holds the worst-case reservation) starts a workflow run. There is **one step per (Places type × tile) request** (not per business, per ARCHITECTURE anti-pattern 2). It is resumable across crashes and deploys and drivable from danlo's phone. Phase 9's scheduler calls the same workflow. This is the repo's first Workflow; research covers setup, local dev, testing and the Vercel project config.
- **D-15:** **Spend control is two layers inside the monthly cap.**
  1. **Every request reserves on the meter just in time**, before it leaves (roadmap criterion 5). A denial ends the run as `partial` with its stopped reason. A refused reservation is zero rows, not an exception (the Phase 2 pattern).
  2. **A run may spend at most 2× its estimate-high.** Past that it stops as `partial` with `stopped_reason` "exceeded estimate", and the report names the tiles still subdividing. The multiplier is a **committed constant** beside `FAN_OUT` in `src/lib/estimate/assumptions.ts`.

  The Phase 2 run-level hold is settled or released against the actual spend; the planner reconciles the run hold with per-call reservations so nothing is double-counted.
- **D-16:** **Run scope in this phase:**
  - **Run** = a **full Enterprise sweep** of the preset version's cells. The Phase 6 slice needs this.
  - **Partition assignment** (cell → ISO week, stable hashing, so a cell stays in its week across runs and cells are added without reshuffling) and the **IDs-Only change-detection pass** (diff each tile's place_id set against D-06's membership records; only changed tiles become Enterprise candidates) are built and tested as functions.
  - The preset page gains two manual actions: **"Run this week's partition"** and **"Check for changes (free)"**. Both go through the same meter and kill switch; IDs-Only still writes a zero-cost ledger row, since the free-allowance math needs every paid-SKU call and zero rows cost nothing. PLACE-04 closes here; Phase 9 only puts them on a clock.
- **D-17:** **The run report is a live, ledger-style run detail page** that refreshes while the run is `running`. It shows:
  - status and stopped reason;
  - requests by SKU;
  - cost versus the estimate range;
  - tiles searched, saturated, subdivided, and **still truncated at minimum size**, shown as an explicit truncation warning, never a silent partial (criterion 3);
  - outcomes: attached / tentative / unmatched (per cluster) / `had_website_uri` split / host-class counts.

  The tone matches `/sources`. Layout is the UI pass's.

### Claude's Discretion
- **Tiling geometry.** Quadtree over `locationRestriction` rectangles; the starting tile per geography unit; minimum tile size and maximum depth; the saturation test (a full 20 + 20 + 20 with a `nextPageToken` exhausted at 60, or the Pitfall 7 heuristic). Tile overlap and double-billing avoidance follow PITFALLS Pitfall 7. The constants are committed and tuned on the D-04 run.
- **Query shape.** `includedType` + `strictTypeFiltering` per Places type versus a `textQuery` per type. One request builder module owns the field mask, `includePureServiceAreaBusinesses: true`, and the type/region/language parameters, so none can be omitted per call site (Pitfall 1 / Pitfall 8).
- **Validating every `placesTypes` entry in `src/seed/data/clusters.json` against the Places API (New) type table** before the first paid call. This was promised in the seed's own `placesTypesNote`. An invalid type fails a named test; the corrected list is committed.
- **Schema shapes and names:** the place attachment join table (with `status in ('attached','tentative','rejected')`, score, features jsonb), observations, tile membership, and run-tile progress. Every new table has `org_id`, RLS, explicit grants and a `TENANT_TABLES` row. Observations are append-only by grant. A `google_places` source record's retention class is `ephemeral`, and the Phase 1 composite FK must keep refusing any durable field that cites it; re-prove it for every new pair.
- **How pagination is priced and reserved.** Each `pageToken` page is a separately billed request (MEDIUM confidence; verify against the first invoice after D-04). Reserve per page.
- Settling reservations for failed or timed-out requests, retries (non-retryable on a budget denial; bounded retries on 5xx/429 that reserve again), and Workflow step idempotency keyed by (run, tile, type, page) so a replay never double-bills.
- The key's application restriction: Vercel functions have no fixed egress IP, so the key is API-restricted only and server-only (never `NEXT_PUBLIC_`). Document this in the runbook.
- Where the review queue shows tentative Places attachments: a second item kind in `/review` or a filter. Reuse the Phase 3 pair card and chips.
- The IDs-Only request mask (Essentials only, `places.id` + `nextPageToken`) and how detection handles a tile whose id set shrinks (gone) versus grows (new).
- e2e specs for the run page and `/sources` Places row. Fixtures must avoid the `preset-detail.spec.ts` two-databases trap: self-skip unless local, or seed through the product.
- The `presets.spec.ts` teardown owed since Phase 2 (no product delete path). A plan in this phase may own the preset archive/delete action if it is cheap; otherwise it stays deferred.

### Deferred Ideas (OUT OF SCOPE)
- **Google-only candidates as a lead source.** Places results with no spine match (D-06 keeps only their `place_id`). Pursuing them means displaying Google content live at view time, which changes the legal posture and needs per-candidate lookups (contradicts criterion 1). Revisit with D-06's measured gap numbers.
- **In-app `PLACES_MODE` toggle.** Rejected for v1 (D-02); env-only.
- **Scheduling partitions weekly and detection nightly.** Phase 9.
- **The `business.site` → `dead` verdict and probing `other` URLs.** Phase 5/6, consuming D-09's host class.
- **Preset archive/delete path and the `presets.spec.ts` teardown.** Owed since Phase 2; in scope only if a Phase 4 plan picks it up cheaply (see Discretion).
- **D-11 chain amendment (≥3 members >500 m apart), resolve-pass performance fixes, and the "X merged into X" header.** Phase 3 follow-ups; not this phase's unless a Phase 4 plan touches the same code.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLACE-01 | Text Search with a hard-coded field-mask allow-list; `fieldMaskTier()` refuses unknown fields; Place Details never called per candidate | § Places request shape (single builder, verified `searchText` contract); § Pattern 3 (the client requires a reservation token and only knows `:searchText`); D-13 mask change; mutations M26, M27, M51 |
| PLACE-02 | Persist only `place_id`, lat/lng ≤30 d, derived `had_website_uri` (+ D-09 host class, D-13 SAB flag) | § Schema (observations append-only; coordinates in a separate grant-less table); § Pitfalls 1–4 (Vercel workflow event log, fixtures, logs, errors are all "persistence"); M36–M39, M45 |
| PLACE-03 | Saturation (60) detected, tile subdivided, truncation reported | § Tiling geometry (quadtree + polygon pruning + novelty rule + depth/size floors); `run_searches` progress table; M30, M31 |
| PLACE-04 | Enterprise sweeps on rotating weekly partitions; change detection on free IDs-Only | § Partitions and change detection (FNV-1a cell hash, weeks-since-epoch in Chicago, leaf-tile id-set diff); M47 |
| PLACE-05 | `includePureServiceAreaBusinesses: true` on every search | § Places request shape (one builder; msw handler returns 501 when absent); SAB matching branch; M26, M42 |
| PLACE-06 | Google Maps attribution wherever a Places-derived signal renders | UI-SPEC Rules 28–32 (already contracted); § Validation M44 |
| BUDG-03 | GCP per-API daily quota as an independent second wall (carried from Phase 2) | § Legal/GCP checkpoint ordering; the 100/day quota counts IDs-only requests too and caps every run at ~100 requests/day — § Open Question 1 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the planner must verify compliance with (treated with the authority of locked decisions):

- **Legal:** Google Places API (New) is the only Google path, used as a transient verifier. Persist only `place_id`, lat/lng (≤30 days) and a derived boolean (+ D-09/D-13 derived signals). No direct scraping of Google Maps.
- **Budget:** < $50/month data spend, enforced as an atomic reservation cap, plus a GCP per-API daily quota as a second wall. A GCP budget alert alone does not stop spend.
- **Hosting:** Vercel Pro for Cron + Workflow DevKit.
- **Stack:** standalone repo, own Supabase project (never BIS's `tlbkbmlrfafquucsmsmm`), own Vercel project; `typescript@6.x` (not 7); **Places via REST `fetch` with a hard-coded field-mask allow-list** (never `@googlemaps/places`); Postgres-native dedupe (`pg_trgm`, `unaccent`; `app.distance_m()` haversine instead of PostGIS — see 0021).
- **Data:** every table carries `org_id` with RLS from the migration that creates it; every `org_id` assertion tested through a user-role connection with Clerk claims, pinning SQLSTATE `42501`, watched failing first; one refused statement per rolled-back transaction.
- **Data:** `legal_name` vs `display_name` vs internal annotations never interchangeable; the internal one never reaches an export/push payload.
- **Design:** `/gsd-ui-phase` done (04-UI-SPEC approved); mobile-first.
- **Timezone:** `America/Chicago`; tests pin zone **and** locale.
- **Carried gotchas:** painted values not CSS custom properties for anything a test pins; Tailwind v4 `[var(--x)]`; a `"use client"` module's exports are client references in a server component.
- **Process:** GSD; PR-only; no autonomous merges; a hand-triggered vertical slice before the scheduler.
- **CONVENTIONS.md (authoritative):** `withOrg()` is the runtime DB entry point; drizzle-kit is the single migration authority; hand-written SQL via `pnpm db:custom` with `--> statement-breakpoint` between every statement; a new table inherits no grants — grant explicitly in the creating migration, add to `TENANT_TABLES`; every SECURITY DEFINER pins `set search_path = public` (and, since 0025, searches `pg_temp` last); PG17-compatible SQL only (prod is 17.6); µUSD bigint money; `timestamptz` via `tstz()`; `pnpm` only via the store launcher; `$PNPM test:x -t "name"` (not `-- -t`); no scratch `.ts` under the repo.

## Summary

The phase has three hard problems and a long tail of plumbing. The hard problems are: (1) **making spend unconditionally bounded** when the executor is a durable, retrying, deployment-pinned workflow; (2) **keeping Places content out of every place it could persist**, which in this stack includes Vercel's workflow event log, committed msw fixtures, logs and thrown error messages — not just the database; and (3) **tiling that terminates** when service-area businesses can saturate every sub-tile of a city.

The Workflow SDK question is fully answered. `workflow@4.8.9` (published 2026-09-15, `latest`) integrates with Next 16 via `withWorkflow()` in `next.config.ts`, uses `"use workflow"` / `"use step"` directives, and starts runs with `start()` from `workflow/api`, callable from a server action. I installed it and `@workflow/vitest@4.0.25` in the session scratchpad against the repo's exact `vitest@5.0.1` + `vite@8.3.0` and **ran a spike on this Windows machine: in-process integration tests pass** (saturation → subdivision loop, a refused reservation → `partial`, `FatalError` → not retried and catchable in the workflow, default retry succeeds on attempt 2). Two spike findings shape the plan: **`vi.mock` of a local `@/` module does NOT reach step code** (steps run from a prebuilt bundle — measured: returned the real 7, not the mocked 99), while **msw DOES intercept `fetch` inside steps** (in-process). And an msw string path `places:searchText` treats `:searchText` as a route parameter (measured: it also matched `/v1/placesXYZ`) — use a RegExp.

The budget design the repo already has is correct and reusable, but the reconciliation needs one new SQL function: there is **no explicit release** today (only `settle_reservation`, which writes a ledger row with `units > 0` — settling the queue-time hold would count a phantom Enterprise request against the free allowance). Recommended shape: `queue-run` keeps its worst-case hold as **admission control**, the workflow's first step releases it via a new `app.release_reservation()`, and every page reserves just-in-time in the same transaction as a conditional `runs.calls_count` increment that is the D-15 ceiling. Two numerical findings the planner must put in front of danlo: the estimator's `FAN_OUT = 3.0` is *per cell* while clusters carry 6–7 Places types each, so **D-15's 2× ceiling will stop even the D-04 run** unless the estimate becomes type-aware; and **the 100/day GCP quota caps every run at ~100 requests** (IDs-only included), so an RGV partition cannot finish in a day.

**Primary recommendation:** Build the executor as a thin deterministic workflow over a pure tiling reducer, with one step per (type × tile) search that loops its ≤3 pages internally, reserves per page, checkpoints per page in Postgres, and returns only our own ids and counts — never a byte of the Places response.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Kill switch (`PLACES_MODE`) | API / Backend (server env, `src/env.ts`) | Browser (disabled affordance only) | Server action + adapter refuse independently; the UI is an affordance (UI Rule 33) |
| Admission (run hold) | API / Backend (`queue-run.ts` server action) | Database (`app.reserve_budget`) | Existing Phase 2 path; refuses before a workflow exists |
| Orchestration (queue of tile searches) | Workflow runtime (`"use workflow"`, sandboxed, deterministic) | — | Resumable across crashes/deploys; must hold no Node I/O |
| Places HTTP call + reservation + settle | Workflow step (`"use step"`, Node) | Database (meter definers) | Side effects only in steps; the meter is the DB's |
| In-memory matching | Workflow step (TS scorer) | Database (candidate fetch + `similarity()`) | Scorer is pure TS; `nameSim` must come from pg_trgm (Phase 3 contract) |
| Persisting derived signals | Database (SECURITY DEFINER writers) | — | Attribution and append-only by grant, as Phase 2/3 |
| Coordinate TTL purge | Vercel Cron → route handler | Database (cross-org definer under a dedicated role) | Must not depend on a run; cross-tenant by nature |
| Run report / sources card / review | Frontend Server (RSC) | Browser (`router.refresh()` island) | UI-SPEC: server component re-renders from DB |
| Attribution rendering | Frontend Server (server-safe `GoogleMapsTag`) | — | UI-SPEC Rule 28/29 |

## Standard Stack

### Core (new in this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `workflow` | **4.8.9** (pin exact) | Durable executor: `"use workflow"`/`"use step"`, `start()`, `FatalError`/`RetryableError`, `withWorkflow()` for Next | Locked (D-14). `latest` dist-tag; 5.x is `beta` (5.0.0-beta.55). Runs on 4.x live in `iad1` [VERIFIED: npm registry, vercel.com/docs/workflows 2026-09-04] |
| `@workflow/vitest` (dev) | **4.0.25** (pin exact) | In-process workflow integration tests (Local World, no server) | Same release train as `workflow@4.8.9` (both 2026-09-15; depends on `@workflow/core@4.8.9`). **Spike-verified with vitest 5.0.1 + vite 8.3.0 on Windows** [VERIFIED: scratch spike] |

Transitive packages the install adds that matter here [VERIFIED: `npm ls` in scratch]:
- `@workflow/next@4.1.13` (peer `next >13`), `@workflow/core@4.8.9`, `@workflow/world-vercel@4.7.4`, `@workflow/world-local@4.4.1`, `@workflow/builders@4.1.14`.
- `@swc/core@1.15.3` (exact peer of `@workflow/swc-plugin`) — **has a `postinstall` script**.
- `cbor-extract@2.2.2` (via `world-vercel` → `cbor-x`) — **has an `install` script** (`node-gyp-build-optional-packages`, prebuilt binaries).
- `workflow` pulls every framework integration (nest, nuxt, astro, sveltekit…): ~447 packages in a clean install. Expected; no action.

### Supporting (already in the repo — reuse, do not add)
| Library | Version | Purpose in Phase 4 |
|---------|---------|--------------------|
| `zod` | 4.6.5 | Places response schema; server-action inputs |
| `msw` | 2.15.0 | Places replay (RegExp path), in unit, DB and workflow lanes |
| `date-fns` + `@date-fns/tz` | 4.4.0 / 1.5.0 | Chicago-anchored partition week |
| `libphonenumber-js` (via `phoneE164`) | 1.13.13 | Places `nationalPhoneNumber` → E.164 in memory |
| `drizzle-orm` / `postgres` | 0.45.2 / 3.4.9 | Unchanged |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-(type×tile) step looping ≤3 pages | One step per page | 3× the workflow events (≈3 events/step, measured); RGV sweep would cross the 2,000-event "slower replay" line sooner. Per-page checkpoints in Postgres give the same idempotency |
| Single workflow per run | Child workflow per cell (background `start()` in a step) | Needed only past ~2,000 events/run; the D-04 slice and an RGV partition stay far below. Document as the scale path |
| `@workflow/vitest` integration lane | Pure-reducer unit tests only | The reducer tests are the fast layer; one integration lane proves the directives compile and the loop behaves (the thing unit tests cannot see) |

**Installation:**
```bash
cd /c/Users/danlo/prospector && $PNPM add workflow@4.8.9 && $PNPM add -D @workflow/vitest@4.0.25
```
Then `pnpm-workspace.yaml` → `allowBuilds:` must gain explicit entries for `'@swc/core'` and `cbor-extract` (true or false — decide and prove), or `pnpm install --frozen-lockfile` exits 1 with `ERR_PNPM_IGNORED_BUILDS` in CI (the file's own header documents this failure mode). Recommendation: `'@swc/core': true` (its postinstall validates/falls back the native binding the build needs), `cbor-extract: false` (cbor-x falls back to pure JS) — verify with a clean `install --frozen-lockfile` + `next build` + one workflow integration test.

**Version verification:** `npm view workflow` → `latest: 4.8.9`, modified 2026-09-21; `@workflow/vitest` latest `4.0.25` (2026-09-15); `@workflow/next@4.1.13` (2026-09-15). All older than any plausible `minimumReleaseAge` [VERIFIED: npm registry 2026-09-23].

## Architecture Patterns

### System Architecture Diagram

```
 danlo (phone/desk)                                      Vercel Cron (daily, UTC)
   │ Run full sweep / partition / check (free)              │ GET + Authorization: Bearer CRON_SECRET
   ▼                                                        ▼
 queueRun server action ──(PLACES_MODE off? → refuse)    /api/cron/purge-places route
   │ withOrg txn: stale-run reclaim → estimate (type-aware)      │ timingSafeEqual → db txn, SET ROLE siteless_cron
   │ → insert runs(kind, estimate, ceiling) → reserve HOLD      ▼
   │   (refused → runs.refused)                           app.purge_expired_place_coordinates()
   │ commit                                                 (all orgs: delete expired coords rows;
   ▼                                                         one place_purge_runs row per org)
 start(placesSweep, [{runId, clerkOrgId}])  ──► Vercel Queue (only reachable path to handlers)
   ▼
 ┌──────────────────────── placesSweep  ("use workflow", sandboxed, deterministic) ────────────────┐
 │ beginRun step: claim run (queued→running), RELEASE hold, plan root searches                    │
 │ loop over search queue (pure reducer):                                                         │
 │   searchTile step ──► per page p≤3:                                                            │
 │      txn A: mode check → reserve_budget(price) → runs.calls_count++ < ceiling                  │
 │             (either refuses → stop: budget_cap_reached | exceeded_estimate)                    │
 │      mark page in-flight (reservation id)                                                      │
 │      fetch places.googleapis.com/v1/places:searchText  (builder: mask + SAB flag + type + rect) │
 │      txn B: settle (200 / timeout) or release (error response) → zod parse → derive            │
 │             → candidate fetch (phone | addr | trigram | proximity) + similarity() → score      │
 │             → app.record_places_page(): membership, outcomes, attachments, observations,       │
 │               coords  (only ids, numbers, enums, booleans cross into Postgres)                 │
 │   returns {searched, saturated, children[] | truncated | stopped}  ← no Places content          │
 │   children pruned by unit polygon; novelty rule; depth/size floors                             │
 │ finishRun step: complete | partial(reason) | failed(reason); cost from ledger                  │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
   ▼
 /runs/[id] (RSC, router.refresh every 5 s)  ·  /review (?kind=google)  ·  /sources transient card
 ·  /businesses/[id] Google Maps check (security_invoker signal view, attached-only)
```

### Recommended Project Structure
```
src/
├── lib/places/
│   ├── request.ts          # THE builder: body + mask per mode; includePureServiceAreaBusinesses; regionCode; languageCode
│   ├── client.ts           # the ONLY module that names the key, the host, X-Goog-Api-Key; requires a ReservedCall token
│   ├── response.ts         # zod schema for searchText responses (+ error envelope)
│   ├── host-class.ts       # D-09 pure classifier
│   ├── place-types.ts      # committed Table A snapshot (478 types, fetched 2026-09-23) for the seed test
│   ├── tiling.ts           # pure: rect math, split, polygon prune, saturation/novelty rules, constants
│   ├── partition.ts        # pure: FNV-1a cell hash, Chicago weeks-since-epoch, current partition
│   ├── change-detect.ts    # pure: id-set diff → unchanged | new | gone | both | saturated
│   ├── match.ts            # pure: Places result → Side; located vs SAB branch; tie/collision rules
│   └── candidates.ts       # SQL builder for the per-page candidate fetch (one statement per page)
├── workflows/places-sweep/
│   ├── workflow.ts         # "use workflow" only; imports steps + pure reducer; NO Node modules
│   ├── steps.ts            # "use step" functions (beginRun, searchTile, finishRun)
│   └── reducer.ts          # pure queue reducer (unit-tested without the compiler)
├── db/with-worker-org.ts   # claims {o:{id}} + app.actor_id GUC + SET LOCAL ROLE authenticated (no fabricated sub)
├── db/with-cron-role.ts    # SET LOCAL ROLE siteless_cron, no claims (allow-listed role)
├── app/api/cron/purge-places/route.ts
├── app/(app)/runs/[id]/…   # UI-SPEC screen 1
└── seed/data/geo-shapes.json  # TIGERweb bboxes + simplified rings for the 17 cities + 4 counties
```

### Pattern 1: Workflow wiring (Next 16)
**What:** `withWorkflow()` wraps the config; the workflow file holds only orchestration; steps live in their own file.
```typescript
// next.config.ts  — Source: workflow/docs/getting-started/next.mdx (bundled with workflow@4.8.9)
import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';
const nextConfig: NextConfig = { reactStrictMode: true };
export default withWorkflow(nextConfig);
```
```typescript
// src/workflows/places-sweep/workflow.ts — sandboxed: no fs/net/pg imports here
import { beginRun, searchTile, finishRun } from './steps';
import { initialQueue, applyResult, nextSearch } from './reducer';

export async function placesSweep(input: { runId: string; clerkOrgId: string }) {
  'use workflow';
  const plan = await beginRun(input);                 // step: claim, release hold, root searches
  let state = initialQueue(plan);
  try {
    for (let s = nextSearch(state); s; s = nextSearch(state)) {
      const r = await searchTile(input, s);           // step: ≤3 pages, reserve per page
      state = applyResult(state, s, r);               // pure: children / truncated / stop
      if (state.stopped) break;
    }
  } catch (e) {
    return finishRun(input, { status: 'failed', reason: 'places_request_rejected' });
  }
  return finishRun(input, state.stopped
    ? { status: 'partial', reason: state.stopped }
    : { status: 'complete' });
}
```
```typescript
// queue-run.ts (after the withOrg transaction COMMITS) — Source: workflow/docs/foundations/starting-workflows.mdx
import { start } from 'workflow/api';
import { placesSweep } from '@/workflows/places-sweep/workflow';
const run = await start(placesSweep, [{ runId, clerkOrgId: orgId }]);
// then a second withOrg txn stores run.runId in runs.workflow_run_id
```
Rules, all from the bundled docs: never put `"use server"` at the top of a module a workflow or step imports (`queue-run.ts` imports the workflow, never the reverse) [CITED: workflow/docs/api-reference/workflow-next/with-workflow.mdx]; step arguments/returns are serialized by value [CITED: foundations/workflows-and-steps.mdx]; `getStepMetadata()` throws outside the runtime, so idempotency keys are passed in, not read from metadata.

### Pattern 2: A step that cannot double-bill and cannot under-ledger
**What:** per page, in this order — (A) reserve + ceiling in one transaction, (B) in-flight marker, (C) call, (D) settle-or-release + write results in one transaction. On a retry, an in-flight page whose reservation is unsettled is **settled as charged** before re-calling (unknown outcome → pessimistic; PITFALLS 9).
```typescript
// Sketch — the SQL shapes are the repo's own (0016/0019/0020); names for new objects are proposals.
async function reservePage(tx, run: RunRef, sku: TextSearchSku) {
  const price = PRICE_BOOK[sku].microUsdPerRequest;
  const hold = price > 0 ? BigInt(price) : 1n;            // 22023 on 0 — Phase 2's 1 µUSD rule
  const m = await tx.execute(sql`select reservation_id from app.reserve_budget(
      'places', ${run.period}::date, ${hold.toString()}::bigint, ${run.id}::uuid, ${sku})`);
  if (!m[0]?.reservation_id) return { stop: 'budget_cap_reached' } as const;  // zero rows ≠ exception
  const c = await tx.execute(sql`update runs set calls_count = calls_count + 1, heartbeat_at = now()
      where id = ${run.id} and status = 'running' and calls_count < ceiling_requests
      returning calls_count`);
  if (c.length === 0) throw new RollbackTo('exceeded_estimate');  // rolls back the reservation too
  return { reservationId: m[0].reservation_id } as const;
}
```
Both refusals in one transaction means a refused ceiling never leaves a dangling hold. The `status = 'running'` predicate is also the **stop lever** for a run whose deployment is pinned (see Pitfall 5).

### Pattern 3: The client refuses unless handed a reservation (tool contract, not prompt rule)
```typescript
// src/lib/places/client.ts — the only module that names the host, the key and the API-key header.
declare const reserved: unique symbol;
export type ReservedCall = { readonly [reserved]: true; reservationId: string; sku: TextSearchSku };
export async function searchText(call: ReservedCall, req: PlacesRequest): Promise<SearchTextOutcome>
```
`ReservedCall` is constructible only in the meter module. Criterion 5 then holds by type as well as by test, and `searchText` is the only exported function — no Place Details path exists to call (criterion 1).

### Pattern 4: Places request shape (one builder)
```typescript
// Source: developers.google.com/maps/documentation/places/web-service/text-search (updated 2026-09-17)
POST https://places.googleapis.com/v1/places:searchText
Headers: Content-Type: application/json · X-Goog-Api-Key · X-Goog-FieldMask: <mask joined by ','>
{
  "textQuery": "roofing contractor",          // REQUIRED; categorical phrase = type with '_'→' '
  "includedType": "roofing_contractor",        // Table A only
  "strictTypeFiltering": true,
  "locationRestriction": { "rectangle": {      // rectangle ONLY; categorical queries only
      "low":  { "latitude": 26.1019, "longitude": -98.3183 },
      "high": { "latitude": 26.4667, "longitude": -98.1954 } } },
  "includePureServiceAreaBusinesses": true,
  "pageSize": 20,
  "regionCode": "US",
  "languageCode": "en"
  // page 2/3: identical body + "pageToken": "<nextPageToken>"
}
```
Verified facts [CITED: text-search page, 2026-09-17]: `textQuery` is required; `pageSize` 1–20 (replaces deprecated `maxResultCount`); `locationRestriction` accepts only a rectangle and applies to categorical queries only; **"All parameters other than `maxResultCount`, `pageSize`, and `pageToken` must be the same as the previous request. Otherwise, the API returns an `INVALID_ARGUMENT` error."**; **"Text Search (New) returns a maximum of 60 results across all pages, although this limit is subject to change."** No inter-page delay is documented.

**Masks (verified tiers, data-fields page 2026-09-17):**
- Enterprise mask (D-13): current `PLACES_TEXT_SEARCH_FIELD_MASK` + `places.pureServiceAreaBusiness` (Pro). Tier stays `ts_enterprise`.
- IDs-only mask: `['places.id', 'nextPageToken']` → `ts_essentials` (free, unlimited per the Phase 2 price book).
- Also Essentials, and free: `places.attributions` (relevant to UI-SPEC OQ 10 — raise at the D-01 checkpoint).
- Structured-address fields `places.postalAddress` / `places.addressComponents` are **Pro** (free at the margin). Not needed: parse the ZIP out of `formattedAddress` (`…, TX 78501, USA`) through the existing `addressKey()`.

### Pattern 5: Tiling geometry (discretion — recommended design)
- **Root tile per geography unit = the unit's bbox**, from a committed seed `src/seed/data/geo-shapes.json` generated by a desk script from Census **TIGERweb** (public domain): `TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/25` (Census 2020 Incorporated Places) for cities, `TIGERweb/State_County/MapServer/55` (Census 2020 Counties) for counties. **Verified live:** all 17 seeded cities resolve (e.g. McAllen GEOID 4845384, bbox lng −98.318…−98.195, lat 26.102…26.467 ≈ 11 × 40 km; Brownsville 34 × 42 km). Cells carry no bbox today (`expand-cells.ts` produces `{clusterKey, unitKind, unitId, …}` only) [VERIFIED: source + TIGERweb query].
- **Radius** units: the circle's bounding square; prune children outside the circle.
- **Polygon pruning:** store simplified rings (`geometryPrecision=4`, ~11 m) beside the bbox; a child rectangle that does not intersect the unit polygon is **never searched**. This is what kills cross-border and cross-city double-billing: Brownsville's bbox reaches 25.84° N, which includes Matamoros; McAllen's bbox overlaps Pharr/Edinburg (Pitfall 7, and Phase 3's own 42 % Mexican-side finding).
- **Split:** 2×2 quadtree on lat/lng midpoints (children partition the parent exactly; boundary places are deduped by `place_id` per run).
- **Saturation test:** a search is saturated iff it returned **60 results** (3 full pages and no further token). Not ≥ 20.
- **Termination (three floors, all committed constants, tuned on D-04):** `MAX_DEPTH` (recommend 5 from the unit root), `MIN_TILE_SIDE_M` (recommend 500), and a **novelty rule** — stop subdividing a branch when a saturated child's id set is ≥ `NOVELTY_MAX_OVERLAP` (recommend 0.75) identical to its parent's. The novelty rule is the one that matters for **service-area businesses**: a city-wide SAB population > 60 re-appears in every child, and without it the quadtree runs to `MAX_DEPTH` (≤ 4^(D+1) − 1 requests per type × unit = 4,095 at D = 5). A branch stopped by depth, size or novelty is **truncated** and reported (criterion 3).
- **Worst case per (type × unit) with the floors:** ≤ 3 × (number of searched tiles); with MAX_DEPTH 5 the absolute ceiling is 4,095 requests — which is why the D-15 run ceiling (below) is the final wall, not the geometry.

### Pattern 6: Budget reconciliation (D-15) — recommended
1. **Admission hold stays** (Phase 2 `queue-run`): `costMicroUsdHi` (or 1 µUSD), TTL 10 min. Its job is to refuse a run that cannot fit.
2. **`beginRun` releases it** through a new definer **`app.release_reservation(p_reservation uuid) returns bigint`**: tenancy re-checked like `settle_reservation`; only when `settled_at is null and released_at is null`; decrements `reserved_micro_usd` by the est; idempotent (second call frees 0); **writes no ledger row**. Settling the hold instead is wrong: `settle_reservation` requires `units > 0` and writes an `ts_enterprise` ledger row that `readUnitsUsedThisPeriod` would count as a real request, silently eating the free allowance [VERIFIED: drizzle/0016, 0019].
3. **Every page** reserves just-in-time at the SKU's gross price (35,000 µUSD Enterprise; 1 µUSD IDs-only) and settles the **actual** (`priceRequests(sku, 1, freeRemaining(sku, unitsUsed))` — 0 inside the free 1,000) with a **per-attempt** `request_id` (`places:{runId}:{searchId}:p{page}:{attemptUuid}`). Per attempt, not per logical page: each attempt that reached Google is a separately billed request, and a per-page key would make `on conflict (request_id) do nothing` swallow the second real charge.
4. **The D-15 ceiling is enforced on requests, not dollars.** `runs.ceiling_requests = ceil(RUN_CEILING_MULTIPLIER × requestsHi)` stored at queue time. In dollars the ceiling is broken inside the free allowance: estimate-high there is $0.00, so "2 × $0" stops the run on its first paid request. Display both ("this run stops at {price} · {n} requests").
5. **TTL vs long runs:** per-page reservations live seconds, so the 10-minute self-heal never touches a healthy run; the only hold that could expire mid-run is the admission hold, and step 2 releases it first.

### Pattern 7: In-memory matching (D-05/D-07/D-08)
- **Candidate fetch — one statement per page**, never per result and never org-wide: pass the ≤20 normalized probes as ONE jsonb parameter (`jsonb_to_recordset($1::jsonb)`; a JS array interpolates as N placeholders — the documented Drizzle trap) and `cross join lateral` four bounded arms per probe, all `merged_into_id is null` and `org_id` bound:
  - **B1 phone:** `phone_e164 = p.phone and phone_blockable` → `businesses_phone_idx`.
  - **B2 address:** `(postal, street_num)` → `businesses_addr_idx`.
  - **B3 trigram:** `name_norm % p.name_norm order by name_norm <-> p.name_norm limit 5` within the postal (located) or within `lower(city) = lower($queriedCity)` (SAB) → GIN `businesses_name_trgm` as the driver (the Phase 3 lateral shape, measured 3.3 ms/probe). `set local pg_trgm.similarity_threshold` first, every time.
  - **B4 proximity (located only):** lat/lng box of ±150 m → needs a new partial index `businesses_latlng_idx on (org_id, lat) where lat is not null and merged_into_id is null` (no spatial index exists; `app.distance_m` is haversine) [VERIFIED: drizzle/0021, 0023].
  - Return `similarity(p.name_norm, b.name_norm)` as `nameSim` — the scorer's contract says the database supplies it [VERIFIED: score.ts header].
  - Local spine shape (read-only probe, 2026-09-23): 90,779 live rows; Comptroller rows 34,783 with only 813 phones and 27,758 geocoded; Overture 55,996 with 50,262 phones. **Comptroller-only businesses can reach ≥95 only through name + address/distance** — B2 and B4 are not optional. City spellings are inconsistent (`McAllen` 6,298 / `Mcallen` 111 / `MCALLEN` 18…) — the SAB city comparison must be case-insensitive.
- **Located results:** build a Places `Side` (`nameNorm`, `phoneE164`/`phoneBlockable` from `phoneE164()`, `addressKey()` of the first `formattedAddress` segment + ZIP, `lat/lng`, `locationMatchType: 'overture'`-equivalent trust, `clusterKey` = the queried cluster) and call the existing `score()` unchanged. R1 (25 km), R3/R4, R5, R6 apply as-is.
- **Chain cap (R2):** pass `chainKey: null` on both sides for Places pairs. R2 exists to stop two chain *branches* merging (D-11); applied to a Places→business attachment it makes every chain listing tentative, which is a special case D-08 says not to create. **Flag at planning** (A4).
- **SAB branch (D-07) — a separate pure function, not a null-coalesce:** `scoreSab(place, business, nameSim)`: `phoneMatch && cityMatch && nameSim ≥ PHONE_LOCALITY_NAME_SIM (0.6)` → 95 with `rule: 'sab_phone_city'`; else `min(raw, 94)`. Treat **any** `pureServiceAreaBusiness: true` result as SAB even if a `location` is present (a service area's pin is not a storefront). Widen `Features['rule']` and `Side['source']` types; do not touch `score()`'s committed fixture.
- **Collisions:** ≥95 against two businesses → both rows `tentative`, `reason: 'tie'`, each naming the other (UI-SPEC tie copy). Many place_ids → one business: allowed. A `rejected` pair is **sticky**: the writer's upsert never changes a `rejected` row.
- **Outside the geography:** a located result whose `formattedAddress` country is not the US is recorded in tile membership (so change detection stays stable) but excluded from outcomes.

### Pattern 8: Schema (discretion — recommended shapes)
All tables: `org_id` + `orgPolicies()` + `_org_idx` + explicit grants in the creating migration + `TENANT_TABLES` row (7 new tables). All writes through SECURITY DEFINER functions that resolve org and actor from claims (Phase 2/3 precedent); `authenticated` gets **SELECT only**.

| Table | Key columns | Notes |
|---|---|---|
| `place_attachments` | `business_id`, `place_id text`, `status ∈ attached/tentative/rejected`, `reason ∈ score/tie/confirmed/detached`, `score int`, `features jsonb` (integers, `nameSim`, `distanceM`, `rule` only), `tie_business_id`, `first_seen_run_id`, `last_seen_run_id`, `decided_by`, `decided_at` | `unique(org_id, business_id, place_id)`; `(org_id, status, score desc)` queue index; `log_event` trigger **narrowed to status changes** (the matcher's per-run upserts would otherwise write thousands of events — the `budget_periods` precedent) |
| `place_observations` | `business_id`, `place_id`, `run_id`, `attachment_id`, `had_website_uri bool`, `host_class` (6-value CHECK), `sku` (CHECK in text-search SKUs), `pure_sab bool`, `observed_at` | `unique(run_id, business_id, place_id)`; **no UPDATE/DELETE for anyone but the owner**, plus a BEFORE UPDATE OR DELETE trigger that raises (belt and braces) |
| `place_coordinates` | `observation_id` (pk, fk), `lat`, `lng`, `expires_at` | **Recommended split** (see below). `authenticated` gets **no privilege at all**; CHECK `expires_at <= observed_at + interval '30 days'` via the writer; purge **deletes** rows |
| `place_tiles` | `tile_key` (`{unitKind}:{unitId}|{type}|{quadPath}`), rect (4 × double), `depth`, `is_leaf`, `saturated`, `truncated`, `last_swept_run_id/at`, `last_checked_at`, `changed_at` | Shared across presets (same unit + type → same tiles), which is what makes change detection reusable |
| `place_tile_members` | `tile_id`, `place_id`, `first_seen_at`, `last_seen_at`, `gone_at` | `unique(tile_id, place_id)`; place_id only — legal indefinitely (D-06) |
| `run_searches` | `run_id`, `tile_key`, `cell_key`, `places_type`, `kind ∈ enterprise/ids_only`, `status`, `pages_done`, `results_count`, `saturated`, `subdivided`, `truncated`, `next_page_token` (transient, nulled when done), in-flight page reservation id | `unique(run_id, tile_key)`; drives Tiles counts and "tiles still subdividing" |
| `run_place_outcomes` | `run_id`, `place_id`, `cluster_key`, `outcome ∈ attached/tentative/unmatched/outside` | `unique(run_id, place_id, cluster_key)`; drives Matching + per-cluster counts |
| `place_purge_runs` | `ran_at`, `rows_purged`, `trigger ∈ cron/desk` | One row per org per purge, zero-count included (so "last purge" is per tenant and true) |

`runs` gains: `kind` (`full_sweep|partition|change_check`, UI OQ 19), `partition_index`, `estimate_requests_lo/hi`, `estimate_micro_usd_lo/hi`, `ceiling_requests`, `workflow_run_id`, `requested_by`, `heartbeat_at`. 🔴 `runs` UPDATE is a **column** grant (0013) — `heartbeat_at` must be added to it; `ceiling_requests` must **not** be (immutable after insert). New stopped_reason machine keys need `STOPPED_REASON` copy (UI Rule 35): `budget_cap_reached`, `exceeded_estimate`, `google_daily_quota`, `places_request_rejected`, `places_unavailable`, `never_started`, `abandoned`.

**Why split coordinates out (recommended over nulling in place):** D-10's requirement is "never deletes the observation" and D-12's is "no coordinate older than 30 days can be read". A side table satisfies both with *zero* UPDATE path on observations (fully immutable, no column-grant carve-out, no trigger that must permit exactly-lat/lng-to-null) and makes the DB proof trivial: `authenticated` has no privilege on `place_coordinates`, so any read is `42501 permission denied for table place_coordinates`; `/sources` counts come from a definer `app.places_transient_stats()` (coords held, oldest age, expired-awaiting-purge, last purge, rows purged). If the planner prefers the literal in-row form, the equivalent is: `grant select (<every column except lat, lng>)`, a `has_coords` stored generated column for the counts, and a BEFORE UPDATE trigger allowing only lat/lng → NULL.

**Current signal:** a `security_invoker = true` view (PG15+, prod 17.6) `business_place_signal` — per business, latest observation per **attached** place, `bool_or(had_website_uri)`; tentative and rejected excluded (D-05/D-08). It never selects coordinates.

**`google_places` source records:** write **none**. The observation rows are the Places record; a `source_records` payload would be Places content. No new provenance pair is added to `businesses`, so "re-prove the composite FK for every new pair" reduces to keeping M18 green plus a schema test that `businesses` gains no Places-derived column.

### Pattern 9: Partitions and change detection (D-16)
- `partitionOf(cellKey) = fnv1a32(cellKey) % PARTITION_COUNT` (4), `cellKey = clusterKey + '\u0000' + unitId` (the `expand-cells` separator). Independent of list order, so adding cells never reshuffles.
- `currentPartition(now) = weeksSinceEpoch(Monday 00:00 America/Chicago) % 4` — strictly rotating (ISO week mod 4 repeats at the week-53/week-1 boundary). The UI shows the ISO week number and date range (UI-SPEC) — keep display and index as two functions.
- Change check: for each **leaf** tile in `place_tiles` for the preset's (unit × type), IDs-only search with the **identical body** (same builder, IDs mask) → diff against `place_tile_members`: `unchanged | new | gone | both`, plus `saturated` (a leaf now returning 60 needs subdivision). New ids → insert members; gone → set `gone_at` (never delete — "gone" is history). Changed tiles set `changed_at` = candidates for the next paid sweep.
- A change check still reserves 1 µUSD and settles 0 with `units = 1` on `ts_essentials` (D-16: zero rows still ledgered).

### Pattern 10: Vercel Cron purge
```jsonc
// vercel.json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "framework": "nextjs",
  "crons": [{ "path": "/api/cron/purge-places", "schedule": "17 9 * * *" }] }  // 09:17 UTC ≈ 04:17 Chicago
```
- Auth: `Authorization: Bearer ${CRON_SECRET}`, compared with `crypto.timingSafeEqual` on equal-length buffers; `CRON_SECRET` absent → refuse (never "open when unset") [CITED: vercel.com/docs/cron-jobs/manage-cron-jobs, 2026-08-11].
- Delivery is best-effort and may **duplicate or skip**; no retries on failure → the purge is an idempotent reconciliation ("delete everything expired"), and the read guard + purge-overdue alert cover a skipped day [CITED: same page].
- Tenancy: the purge is cross-org by nature. Recommended: a NOLOGIN role `siteless_cron` created in a migration (the `app_user` bootstrap pattern in 0000), `grant siteless_cron to app_user`, `grant execute on app.purge_expired_place_coordinates() to siteless_cron` only (revoke from public). The route runs `set local role siteless_cron` through a tiny allow-listed helper — so no tenant session can call it.
- "Copy the purge command" (UI) → a desk script `scripts/purge-places.ts` calling the same function.

### Anti-Patterns to Avoid
- **Returning Places content from a step.** Step inputs/outputs are persisted in the Vercel World for run lifetime + **7 days (Pro)**, visible decrypted to team owners [CITED: vercel.com/docs/workflows/pricing, 2026-09-16]. In the local/test world they sit unencrypted on disk (measured: `.workflow-data/steps/*.json`). Steps return our ids, tile keys, counts and enums only.
- **A step per business or per page** — ARCHITECTURE anti-pattern 2; events ≈ 3 per step.
- **Holding a DB transaction open across the HTTP call.**
- **Settling the queue-time hold** to "release" it (phantom request in the free allowance).
- **A dollar-denominated D-15 ceiling** (collapses to $0 inside the free allowance).
- **Retrying a daily-quota 429** — the runbook already rules it a hard stop for the day.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable retries/resume | A cron-driven state machine over `runs` | `workflow@4.8.9` steps | Locked (D-14); replay + deployment pinning solved |
| Race-free spend check | Any read-then-decide | `app.reserve_budget` (single conditional UPDATE, 40-way burst proven) | Phase 2's measured proof |
| Run-level ceiling | A counter in workflow memory | Conditional `update runs … where calls_count < ceiling_requests` in the reserve transaction | Same shape as the meter; survives replay; doubles as a stop lever |
| Name similarity | A TS trigram | `similarity()` from pg_trgm in the candidate SQL | Scorer contract: nameSim comes from the DB |
| Phone/address/name keys | New normalizers | `phoneE164`, `addressKey`, `nameNorm` | Must agree byte-for-byte with the spine's keys |
| City/county bounds | Hand-typed boxes | TIGERweb seed + desk script with provenance | Reproducible, public domain |
| Place-type validity | Hope | Committed Table A snapshot + named test | Measured: 1 of 27 seeded types is invalid |
| Webhook-style cron auth | Custom tokens | `CRON_SECRET` Bearer + `timingSafeEqual` | Vercel's documented contract |

## Validated place types (research priority 3)

Parsed from the raw HTML of `developers.google.com/maps/documentation/places/web-service/place-types` (page "Last updated 2026-09-17 UTC"): **Table A = 478 types, Table B = 36**. The page states Table A values are "used … as part of a Text Search (New) request, used as the value of the `includedType` parameter" and "Values from Table B may NOT be used as part of a request" [VERIFIED: raw HTML parse, not a summarizer].

| Cluster | Seeded type | Table | Verdict |
|---|---|---|---|
| home_services | plumber, electrician, roofing_contractor, painter, locksmith, moving_company | A | valid |
| home_services | **general_contractor** | **B only** | **INVALID — remove.** No Table A equivalent exists (Services lists no HVAC, handyman, landscaper, carpenter or cleaning type) |
| food_hospitality | restaurant, cafe, bar, bakery, meal_takeaway, hotel | A | valid |
| personal_care_health | hair_salon, barber_shop, nail_salon, spa, dentist, doctor, physiotherapist | A | valid |
| auto_retail | car_repair, car_wash, car_dealer, tire_shop, auto_parts_store, furniture_store, clothing_store | A | valid |

Optional Table A additions for danlo (not required): personal care `beauty_salon`, `beautician`, `hair_care`, `massage`; auto `truck_dealer`. The committed test (`every placesTypes entry is a Table A type`) must read a **committed snapshot** (`src/lib/places/place-types.ts` with source URL + fetch date), never the network (`no-network.test.ts`).

## Common Pitfalls

### Pitfall 1: Places content leaks into places that are not the database
**What goes wrong:** the ToS forbids "copy and save business names, addresses" (§3.2.3(a)(iii), quoted in DATA-SOURCES). Four non-obvious sinks: (a) **Vercel workflow event log** — step I/O retained run + 7 days on Pro; (b) **committed msw fixtures** "recorded from real payloads" (D-04) are business names/addresses/phones in git forever; (c) `console`/pino logs of the response; (d) **thrown error messages** containing response fragments land in `step_failed` events.
**How to avoid:** steps return only derived data (a named test inspects every step's return type/value against a sentinel fixture); the D-04 recording script **anonymizes in memory before writing** (keep structure, pagination, counts, SAB flags and host classes; synthesize names/addresses/phones/URL hosts; keep `place_id`s, which are exempt); never log bodies; error messages carry status codes and our own keys only. Add all four to the D-01 enumeration.
**Warning signs:** a fixture file containing a real RGV business name; `displayName` in any step return type.

### Pitfall 2: The estimate is per cell, the requests are per type
**What goes wrong:** `requestsHi = cells × PAGES_HI × FAN_OUT = cells × 9`, but one cell = 6–7 type searches. D-04 (1 cell) → estimate-high 9 requests, ceiling 18; six types × even one page is 6, and any saturated trade (plumbers with SABs) runs 3 pages + 4 children × up to 3 pages. **The D-04 run would stop `exceeded_estimate`.**
**How to avoid:** make the estimate type-aware: `requestsLo = Σ types × PAGES_LO`, `requestsHi = Σ types × PAGES_HI × FAN_OUT` (FAN_OUT now means tiles-per-type). Consequences to show danlo: the RGV baseline moves from 612 to ~3,978 requests high (17 cities × 26 valid types × 9), ~$104 gross — **the full RGV sweep's admission hold exceeds a $50 cap and is refused**; a partition (~¼) fits. That is the honest number (runbook: 2,428 requests/month ceiling at $50). The Phase 2 committed cost-model test goes red by design and is re-pinned.
**Warning signs:** a run ending `exceeded_estimate` with most tiles unsearched.

### Pitfall 3: The daily quota is the real throughput limit
**What goes wrong:** Requests per day = 100 applies per API, and IDs-only change-check requests count too [ASSUMED — quota metrics are per API/method, not per SKU]. A run past ~100 requests hits `429 RESOURCE_EXHAUSTED`.
**How to avoid:** distinguish daily-quota 429 (stop, `google_daily_quota`, non-retryable — the runbook's rule) from per-minute 429 (`RetryableError` with backoff) by the error `details` quota metadata; when ambiguous, stop (the safe direction). D-04 fits under 100. Everything bigger needs danlo's call (Open Question 1).

### Pitfall 4: `locationRestriction` + SABs saturate forever
**What goes wrong:** with `includePureServiceAreaBusinesses: true`, a city-wide SAB population can return in every sub-tile; the quadtree never gets under 60.
**How to avoid:** the novelty rule + depth/size floors; report as truncated; tune on D-04.

### Pitfall 5: The kill switch does not stop an in-flight run
**What goes wrong:** "Workflow runs are pinned to the deployment that starts them" [CITED: workflow/docs/foundations/versioning.mdx]. Flipping `PLACES_MODE` and redeploying leaves running runs on the old deployment, **with the old env**, still calling Google.
**How to avoid:** the per-page reserve transaction requires `runs.status = 'running'`; the runbook for a "no" from counsel is: flip `PLACES_MODE`, redeploy, **cancel in-flight runs** (`npx workflow` / dashboard, or `getRun(id).cancel()`), and set their `runs` rows to `failed`/`cancelled`-reason — the DB predicate stops the next page even if the cancel lags.

### Pitfall 6: Generated workflow files trip the repo's walkers and lint
**What goes wrong:** `next build`/`next dev` writes `src/app/.well-known/workflow/v1/{flow,step,webhook/[token]}/route.js` + `manifest.json` (with a nested `.gitignore *`) [VERIFIED: @workflow/next builder source]. `tests/unit/field-mask-tier.test.ts` walks **every file** under `src` and would find `X-Goog-FieldMask` in the bundled step route after any local build; `no-network.test.ts` scans `.js`/`.json`; `eslint .` lints dot-folders. CI is green only because `build` runs last.
**How to avoid:** exclude `src/app/.well-known/workflow/**` in every walker (a shared helper), ESLint `ignores`, `.prettierignore`; add `.workflow-data/`, `.workflow-vitest/`, `.swc/` to `.gitignore` (the spike created all three).

### Pitfall 7: `src/proxy.ts` intercepts workflow's internal POSTs
**What goes wrong:** the current matcher `'/((?!_next|…).*)'` matches `/.well-known/workflow/v1/flow`. The docs: `[local world] Queue operation failed … detached ArrayBuffer` is exactly this, "especially easy to miss in Next.js 16" [CITED: getting-started/next.mdx].
**How to avoid:** add `\\.well-known/workflow/` to the negative lookahead, keeping proxy.ts free of the tokens its guards forbid.

### Pitfall 8: msw string path with `places:searchText`
Measured: the string is parsed as `places` + param `:searchText` and also matched `/v1/placesXYZ`. Use `http.post(/^https:\/\/places\.googleapis\.com\/v1\/places:searchText$/, …)`. The handler must return **501** when the mask header, the key header or `includePureServiceAreaBusinesses: true` is missing (the Socrata-handler discipline), so a builder regression is red, not silently served.

### Pitfall 9: Retry arithmetic on the ledger
A per-page idempotency key on `cost_ledger.request_id` swallows the second real charge after a retry; a crash between call and settle loses the charge when the reservation self-heals. Per-attempt ids + in-flight marker + pessimistic settle on unknown outcome (Pattern 2). Error *responses* are released, not settled [ASSUMED — Google does not bill error responses; confirm on the first invoice].

### Pitfall 10: e2e specs that spend or starve production
UI-SPEC Rules 38/39 and OQ 14 already list them: `spend.spec.ts:128` clicks Run+confirm against the deployed app (a billed sweep from CI once prod is `enterprise`); `budget-banner.spec.ts` lowers the production cap and would stop a live run. Fix in the task that wires the executor.

### Pitfall 11: Workflow discovery misses the server-action entry
`withWorkflow()` discovers workflows transitively from `route`/`page`/`layout` files that reach a `start()` call [CITED: with-workflow.mdx]. Our `start()` lives in a server action reached through a `"use client"` drawer. Discovery follows imports by regex, so it should resolve — but **verify after `next build`** that the generated `manifest.json` lists `workflow//…/places-sweep/workflow…//placesSweep`; a missing registration fails only at runtime.

## Code Examples

### zod response schema (hand-authored from the documented shape until D-04 records real ones)
```typescript
// src/lib/places/response.ts
const LatLng = z.object({ latitude: z.number(), longitude: z.number() });
export const PlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string(), languageCode: z.string().optional() }).optional(),
  formattedAddress: z.string().optional(),        // absent on pure SABs (docs)
  location: LatLng.optional(),
  types: z.array(z.string()).optional(),
  businessStatus: z.enum(['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY']).optional(),
  pureServiceAreaBusiness: z.boolean().optional(),
  websiteUri: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
});
export const SearchTextResponse = z.object({
  places: z.array(PlaceSchema).optional().default([]),   // zero results → {} [ASSUMED]
  nextPageToken: z.string().optional(),
});
export const GoogleErrorEnvelope = z.object({
  error: z.object({ code: z.number(), message: z.string(), status: z.string(),
                    details: z.array(z.unknown()).optional() }),
});
```
Use `.safeParse` and never interpolate `issues` values into an error message (Pitfall 1d).

### Host-class classifier (D-09)
```typescript
// src/lib/places/host-class.ts — pure; the URL is discarded by the caller after this returns.
export type HostClass = 'none' | 'business_site_dead' | 'social' | 'directory' | 'platform_subdomain' | 'other';
const TABLE: ReadonlyArray<readonly [HostClass, readonly string[]]> = [
  ['business_site_dead', ['business.site', 'g.page']],
  ['social', ['facebook.com', 'instagram.com', 'linktr.ee', 'beacons.ai']],
  ['directory', ['yelp.com', 'yellowpages.com', 'bbb.org', 'nextdoor.com', 'mapquest.com', 'manta.com']],
  ['platform_subdomain', ['wixsite.com', 'square.site', 'myshopify.com', 'godaddysites.com']],
];
export function hostClass(websiteUri: string | undefined): HostClass {
  if (!websiteUri) return 'none';
  let host: string;
  try { host = new URL(websiteUri).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return 'other'; }                          // present but unparseable: never 'none'
  for (const [cls, domains] of TABLE)
    if (domains.some((d) => host === d || host.endsWith('.' + d))) return cls;
  return 'other';
}
```
Suffix match on a dot boundary: `m.facebook.com` is social, `notfacebook.com` is not. Named cases: `https://acme.business.site` → dead; `http://g.page/r/xyz` → dead.

### Worker transaction helper (tenant context without a fabricated user)
```typescript
// src/db/with-worker-org.ts — mirrors resolveEtlOrg: claims {o:{id}} only, actor via GUC, no org_role.
export async function withWorkerOrg<T>(clerkOrgId: string, actor: `workflow:${string}`,
                                       fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims',
                            json_build_object('o', json_build_object('id', ${clerkOrgId}::text))::text, true)`);
    await tx.execute(sql`select set_config('app.actor_id', ${actor}, true)`);
    await tx.execute(sql.raw('set local role authenticated'));
    return fn(tx);
  });
}
```
No `sub` (attribution falls to `app.actor_id`, like `etl:<script>`); no `org_role` (a workflow can never pass an admin-gated definer). Every step's first statement re-reads the run under RLS; zero rows → `FatalError` (a mismatched org id can only fail closed).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `maxResultCount` | `pageSize` (1–20) | Text Search (New) | Use `pageSize` |
| Workflow runs always in `iad1` | Multi-region | `workflow@5.0.0-beta.33+` | Stay on 4.x (single-region RGV; Supabase is `us-east-1`) |
| `middleware.ts` | `src/proxy.ts` | Next 16 | Matcher exclusion for `.well-known/workflow/` lives in proxy.ts |

**Deprecated/outdated:** `general_contractor` as a request type (Table B only). `*.business.site` sites 404 since 2024-06-10 (PITFALLS 4).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Each `pageToken` page bills as a separate request | Pattern 6 | Over-reservation only (safe direction); verify on first invoice |
| A2 | Google does not bill HTTP error responses | Pitfall 9 | Ledger under-records failed calls; small; verify on invoice |
| A3 | The 100/day quota counts IDs-only requests as well as Enterprise | Pitfall 3 | If not, change checks are unbounded by the quota (only by the meter) |
| A4 | R2 (chain cap) should not apply to Places→business attachments | Pattern 7 | If danlo wants chains tentative, every chain listing floods /review |
| A5 | A zero-result search returns `{}` (no `places` key) | Code Examples | zod default covers it either way |
| A6 | SABs are returned under `locationRestriction` searches whose rectangle overlaps their service area | Pattern 5 | Criterion 4's "SABs appear" could fail on real data; D-04 measures it |
| A7 | `includedType` + `strictTypeFiltering` gives acceptable recall per type (and applies to `hotel`) | Pattern 4 | Coverage gap; D-04 compares against the spine per cluster |
| A8 | Treating any SAB as SAB-branch even with a `location` is correct | Pattern 7 | A few storefront-like SABs lose the geo path |
| A9 | Daily-quota vs per-minute 429 are distinguishable from `error.details` | Pitfall 3 | Fallback is "stop" — safe, may stop a run that could have waited a minute |
| A10 | The Vercel project uses Fluid compute (recommended for Workflows) | Environment | Higher cost/cold starts only; check at the D-03 checkpoint |

## Open Questions

1. **The 100/day quota vs any real sweep.** An RGV partition is ~250–1,000 requests; it will stop `google_daily_quota` at ~100. Options: (a) raise the quota after D-04 (runbook anticipates it); (b) multi-day runs (the workflow `sleep()`s to 00:05 US/Pacific — free, but a `running` run for days needs UI copy); (c) accept `partial` and re-run. Recommendation: implement the stop reason now, keep 100 for D-04, decide (a)/(b) on D-04's numbers. Needs danlo.
2. **Type-aware estimate (Pitfall 2).** Changes displayed Phase 2 numbers and makes the full RGV sweep refuse at admission. Recommendation: do it (otherwise D-15 stops every run); surface the new numbers to danlo in the plan.
3. **Rating/review count vs SCORE-01/TRI-04.** Phase 6 scoring and the Phase 7 card want rating and review count; D-13 persists neither. Keep them in the mask (free at the margin, in memory only) and add "a derived review-volume bucket" to the D-01 legal enumeration so Phase 6 is not blocked by a later surprise. Alternatively drop them from the mask for data minimization. Not Phase 4's to decide; raise at the checkpoint.
4. **UI copy gaps** (small UI-SPEC amendment): stopped reasons beyond the two specified (`google_daily_quota`, `places_request_rejected`, `places_unavailable`, `never_started`, `abandoned`); "a run is already in progress" (if the one-active-run-per-org index is adopted — recommended, Pitfall 9 of PITFALLS); "stops at $0.00 · N requests" wording.
5. **Fixture anonymization vs "record real payloads" (D-04).** Recommendation above; confirm at the D-01 checkpoint.
6. **Coordinates side table vs in-row nulling** — equivalent guarantees; recommendation is the side table.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/tests | ✓ | 24.13.0 | — |
| pnpm (store launcher) | install/tests | ✓ | 12.5.1 | — |
| Local PostgreSQL (`siteless_test`) | DB lane | ✓ | 18.6 (prod 17.6) | — |
| `workflow` / `@workflow/vitest` | executor/tests | ✗ (not installed) | 4.8.9 / 4.0.25 on npm | none — Wave 0 install |
| Vercel CLI | env/crons/deploy | ✓ | 54.20.1 | dashboard |
| Vercel Pro plan | Cron + Workflows | ✓ (confirmed 02-14) | — | — |
| Google Cloud project + Places key + quota | first real call | ✗ | — | none — D-01 then D-03 checkpoints; everything before runs on msw |
| `CRON_SECRET` | purge route | ✗ | — | route refuses until set |
| `psql` / `gcloud` | — | ✗ | — | not needed (node `pg`; console) |
| Census TIGERweb | geo seed script (desk) | ✓ (queried live) | — | — |

**Missing with no fallback:** the GCP project/key (blocks only the D-04 plan, by design).
**Missing with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@5.0.1` (+ `vite@8.3.0`) unit / DB; **new** workflow lane with `@workflow/vitest@4.0.25`; `@playwright/test@1.63.0` e2e |
| Config files | `vitest.config.ts` (node + dom lanes), `vitest.db.config.ts`, **new `vitest.workflow.config.ts`** (Wave 0: `workflow()` plugin, TZ/LANG pinned on line 1, `server-only` → no-op alias, `pool:'forks'`, include `tests/workflow/**/*.test.ts`) |
| Quick run | `$PNPM test:unit -t "<name>"` |
| DB suite | `$PNPM test:db -t "<name>"` |
| Workflow lane | `$PNPM test:workflow` (new script) — needs `RUNTIME_DB_URL`/`SUPABASE_DB_POOL_URL` → local `app_user`; runs in CI's `db` job |
| Full suite | typecheck · lint · test:unit · test:db · test:workflow · build (individually, via the store launcher) |

`$PNPM` = `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`; every command prefixed `cd /c/Users/danlo/prospector &&`.

**Layering (from the spike):** (1) pure modules — unit lane; (2) step bodies — DB lane, called as plain functions (the directive is a no-op without the compiler), with `@/db/with-worker-org` swapped for a SAVEPOINT in the test's rolled-back transaction (the Phase 3 `review-actions` pattern) and msw for Places; (3) orchestration — workflow lane, real compiled workflow, msw for Places (verified to intercept in-process), **real local DB** with a dedicated test org created and torn down by the owner connection (`vi.mock` cannot reach steps — measured).

### Phase Requirements → Test Map
| Req | Behavior | Type | Automated Command | File Exists? |
|-----|----------|------|-------------------|--------------|
| PLACE-01 | builder sends mask + `includePureServiceAreaBusinesses` + type/region/language on every request | unit (msw 501) | `$PNPM test:unit -t "every places request carries includePureServiceAreaBusinesses"` | ❌ Wave 0 |
| PLACE-01 | `fieldMaskTier` Pro list includes `pureServiceAreaBusiness`; mask tier stays enterprise; M11 still red on `places.reviews` | unit | `$PNPM test:unit -t "fieldMaskTier"` | ✅ extend |
| PLACE-01 | the client refuses without a ReservedCall; only `:searchText` exists; no Place Details path | unit (type + grep) | `$PNPM test:unit -t "place details is unreachable"` | ❌ |
| PLACE-01 | the key/host/API-key header are named in exactly one module | unit (grep) | `$PNPM test:unit -t "no google credential is read anywhere in src"` | ✅ amend |
| PLACE-01 | page 2/3 repeat page 1's body except pageToken | unit | `$PNPM test:unit -t "a page request repeats the first request's body"` | ❌ |
| PLACE-02 | no Places text reaches the database (sentinel names/phones/URLs scanned in every new table after a replayed page) | DB | `$PNPM test:db -t "no Places text reaches the database"` | ❌ |
| PLACE-02 | no step returns Places content | unit | `$PNPM test:unit -t "no step returns Places content"` | ❌ |
| PLACE-02 | `authenticated` cannot read coordinates (`42501`) | DB | `$PNPM test:db -t "authenticated cannot read place coordinates"` | ❌ |
| PLACE-02 | the purge deletes expired coordinates and keeps the observation; returns per-org counts | DB | `$PNPM test:db -t "the purge removes expired coordinates and keeps the observation"` | ❌ |
| PLACE-02 | the purge refuses a tenant session | DB | `$PNPM test:db -t "the purge refuses a tenant session"` | ❌ |
| PLACE-02 | observations are append-only by grant (UPDATE/DELETE `42501`, one test each) | DB | `$PNPM test:db -t "place observations are append-only"` | ❌ |
| PLACE-02 | host classifier table (dead/social/directory/platform/other/none) | unit | `$PNPM test:unit -t "host class"` | ❌ |
| PLACE-02 | purge route refuses without `CRON_SECRET` | unit | `$PNPM test:unit -t "the purge route refuses without the cron secret"` | ❌ |
| PLACE-03 | a 60-result search is saturated and subdivided; 59 is not | unit (reducer) | `$PNPM test:unit -t "a 60-result tile is saturated and subdivided"` | ❌ |
| PLACE-03 | saturation at min size / max depth / novelty → truncated and reported | unit + DB | `$PNPM test:unit -t "truncated at minimum size"` · `$PNPM test:db -t "run report counts truncated tiles"` | ❌ |
| PLACE-03 | children outside the unit polygon are never searched | unit | `$PNPM test:unit -t "a child outside the unit polygon is pruned"` | ❌ |
| PLACE-03 | end-to-end saturation → subdivision → complete with truncation count | workflow | `$PNPM test:workflow -t "a saturated tile subdivides and the run completes"` | ❌ |
| PLACE-04 | a cell keeps its partition when cells are added; partitions rotate weekly; one instant in two zones | unit | `$PNPM test:unit -t "partition"` | ❌ |
| PLACE-04 | change detection: unchanged / new / gone / both / saturated | unit + DB | `$PNPM test:unit -t "change detection"` | ❌ |
| PLACE-04 | IDs-only mode refuses an Enterprise mask; a change check ledgers a zero-cost ts_essentials row | unit + DB | `$PNPM test:unit -t "ids_only refuses an Enterprise mask"` · `$PNPM test:db -t "a change check ledgers a zero-cost row"` | ❌ |
| PLACE-05 | SAB with exact phone + city + name ≥ 0.6 → 95; without phone → ≤ 94 | unit | `$PNPM test:unit -t "service-area"` | ❌ |
| PLACE-05 | the recorded SAB fixture yields a `pure_sab` observation | DB | `$PNPM test:db -t "a service-area listing is observed with its flag"` | ❌ |
| PLACE-06 | tag renders wherever a places signal renders; formatter imports bring the tag | unit (dom) | `$PNPM test:unit -t "google maps attribution"` | ❌ (UI Rule 28) |
| PLACE-06 | no map library or embed | unit | `$PNPM test:unit -t "no map library or map embed anywhere in the app"` | ❌ (UI Rule 31) |
| D-05/D-08 | ≥95 attaches; 80–94 tentative; <80 unmatched; tie → tentative both; rejected is sticky; tentative excluded from signal | unit + DB | `$PNPM test:unit -t "places match"` · `$PNPM test:unit -t "a place tying two businesses at 95 goes to review"` · `$PNPM test:db -t "a rejected pair never re-attaches"` · `$PNPM test:db -t "a tentative attachment is excluded from the signal"` | ❌ |
| D-15 / crit. 5 | no request leaves without a reservation (msw handler asserts an open reservation for the run at request time) | DB | `$PNPM test:db -t "no places request leaves without a reservation"` | ❌ |
| D-15 | refused reservation → `partial` / `budget_cap_reached`, zero requests after | DB + workflow | `$PNPM test:workflow -t "a refused reservation ends the run partial"` | ❌ |
| D-15 | the run stops at 2× estimate-high (requests) | DB | `$PNPM test:db -t "a run stops at 2x its estimate-high"` | ❌ |
| D-15 | the admission hold is released at begin with no ledger row; release is idempotent and tenancy-checked | DB | `$PNPM test:db -t "release_reservation"` | ❌ |
| D-15 | a retried page settles the in-flight reservation as charged before calling again | DB | `$PNPM test:db -t "a retried page never under-ledgers"` | ❌ |
| D-02 | `off` refuses before any reservation (action + adapter); unknown `PLACES_MODE` fails env parse | unit + DB | `$PNPM test:unit -t "PLACES_MODE"` · `$PNPM test:db -t "off mode refuses before any reservation"` | ❌ |
| Tenancy | a workflow step cannot touch another org's run (zero rows → fatal); definers refuse foreign ids `42501` | DB | `$PNPM test:db -t "a workflow step cannot write another org's run"` | ❌ |
| Seed | every `placesTypes` entry is a Table A type | unit | `$PNPM test:unit -t "every placesTypes entry is a Table A type"` | ❌ |
| Grants | 7 new tables in `TENANT_TABLES`; column grant on `runs` includes `heartbeat_at`, excludes `ceiling_requests` | DB | `$PNPM test:db -t "grants"` | ✅ extend |
| Daily quota | a daily-quota 429 stops the run `google_daily_quota` without retry | unit/workflow | `$PNPM test:workflow -t "google daily quota stops the run"` | ❌ |
| UI | run report, preset actions per mode, review Google kind, sources transient card, business Google card | unit (dom) + e2e (local-only or fixture-free) | per UI-SPEC Rules 28–42 | ❌ |

### Gate mutations (continue from Phase 3's M25b)
| ID | Mutation (apply to the live code/DB, revert, diff back) | Must turn red (exactly) |
|---|---|---|
| M26 | builder drops `includePureServiceAreaBusinesses` | "every places request carries includePureServiceAreaBusinesses" |
| M27 | remove `places.pureServiceAreaBusiness` from the PRO list | "fieldMaskTier maps every known field to its tier" |
| M28 | remove the `off` check from the reserve helper | "off mode refuses before any reservation" |
| M29 | `ids_only` accepts an Enterprise mask | "ids_only refuses an Enterprise mask" |
| M30 | saturation `=== 60` → `> 60` | "a 60-result tile is saturated and subdivided" |
| M31 | min-size saturation not flagged truncated | "truncated at minimum size" |
| M32 | call before reserve | "no places request leaves without a reservation" |
| M33 | refused reservation thrown as a retryable error | "a refused reservation ends the run partial" |
| M34 | drop `calls_count < ceiling_requests` | "a run stops at 2x its estimate-high" |
| M35 | `business.site` removed from the dead list | "host class" (dead case) |
| M36 | writer copies `displayName` into `features` | "no Places text reaches the database" |
| M37 | `grant select on place_coordinates to authenticated` | "authenticated cannot read place coordinates" |
| M38 | purge predicate inverted | "the purge removes expired coordinates and keeps the observation" |
| M39 | `grant execute on purge to authenticated` | "the purge refuses a tenant session" |
| M40 | upsert overwrites `rejected` | "a rejected pair never re-attaches" |
| M41 | tie resolved to the higher score | "a place tying two businesses at 95 goes to review" |
| M42 | SAB branch lifts to 95 without a phone | "service-area … without an exact phone caps at 94" |
| M43 | signal view includes tentative | "a tentative attachment is excluded from the signal" |
| M44 | delete the tag from the Google card | "google maps attribution renders wherever a places signal renders" (UI Rule 28) |
| M45 | `searchTile` returns `displayName` in its summary | "no step returns Places content" |
| M46 | step skips the run-org check | "a workflow step cannot write another org's run" |
| M47 | partition hash uses list index | "a cell keeps its partition when cells are added" |
| M48 | restore `general_contractor` | "every placesTypes entry is a Table A type" |
| M49 | page 2 body drops `strictTypeFiltering` | "a page request repeats the first request's body" |
| M50 | remove the `CRON_SECRET` comparison | "the purge route refuses without the cron secret" |
| M51 | read the key in a second module | "no google credential is read anywhere in src" |
| M52 | daily-quota 429 → `RetryableError` | "google daily quota stops the run" |
| M53 | settle the admission hold instead of releasing it | "release_reservation" (asserts no ledger row, free allowance unchanged) |

Read the failing test's **name** on every filtered run (a `-t` that matches nothing exits green).

### Sampling Rate
- **Per task commit:** the quick unit filter for the touched module + `typecheck`.
- **Per wave merge:** test:unit, test:db, test:workflow, typecheck, lint, **build** (the build is what generates `.well-known/workflow` and proves registration — check the manifest).
- **Phase gate:** full suite green + mutations M26–M53 logged in `docs/measurements/04-gate-mutations.md` before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Install `workflow@4.8.9`, `@workflow/vitest@4.0.25`; `allowBuilds` entries for `@swc/core`, `cbor-extract`; prove `install --frozen-lockfile` + `build`.
- [ ] `next.config.ts` → `withWorkflow`; proxy matcher exclusion; `.gitignore` / `.prettierignore` / ESLint ignores; shared walker exclusion for `src/app/.well-known/workflow/**` in `field-mask-tier`, `no-network`, `no-google-credential` tests.
- [ ] `vitest.workflow.config.ts` + `test:workflow` script + CI step in the `db` job.
- [ ] msw Places handler (RegExp path, 501 on missing mask/key/SAB flag) + anonymized synthetic fixtures with a `synthetic: true` sidecar: 3-page saturated set, empty tile, SAB listing, `business.site` listing, tie pair, daily-quota 429 envelope, per-minute 429, 400 `INVALID_ARGUMENT`, 503.
- [ ] `src/lib/places/place-types.ts` Table A snapshot; `src/seed/data/geo-shapes.json` + `scripts/fetch-geo-shapes.ts` (desk; host allowed only in scripts/).
- [ ] DB fixtures for the new tables; `withWorkerOrg` / `withCronRole` savepoint doubles for the DB lane.
- [ ] `clusters.json`: remove `general_contractor` (with the test watched red first).

## Security Domain

### Applicable ASVS Categories (Level 1)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (Clerk, unchanged) | — |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | RLS + SELECT-only grants; SECURITY DEFINER writers resolving org/actor from claims; `withWorkerOrg` (no sub, no role); `siteless_cron` role for the one cross-org function; queue-only workflow handlers |
| V5 Input Validation | **yes** | zod on every Places response and server-action input; Places strings never interpolated into SQL (jsonb bound once) |
| V6 Cryptography | **yes (narrow)** | `crypto.timingSafeEqual` for `CRON_SECRET`; never hand-rolled |
| V7 Error handling & logging | **yes** | no response bodies in logs or thrown messages (they persist in the workflow event log) |
| V8 Data protection | **yes** | retention: place_id only indefinitely; coordinates ≤30 d with a grant-level read barrier + daily purge; derived signals only |
| V14 Configuration | **yes** | key server-only, API-restricted to Places API (New); `PLACES_MODE` default `off`; key never `NEXT_PUBLIC_` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key exposure (bundle, logs, repo) | Information disclosure | One sanctioned reader module; `server-only`; grep test with an explicit allow-list; application restriction = API restriction only (no fixed Vercel egress IP) documented in the runbook; key in Vercel env (Production only) |
| Spend runaway (retry amplification, SAB saturation loop, duplicate runs) | Denial of service (financial) | Per-page reserve; D-15 request ceiling in the same txn; novelty/depth/size floors; no retry on 200 or daily quota; one active run per org (unique partial index); GCP 100/day as the second wall |
| Kill switch bypassed by deployment pinning | Elevation / Tampering | `runs.status = 'running'` predicate on every reserve; runbook: cancel in-flight runs after a flip |
| Retention breach (coordinates > 30 d; Places text in event log / fixtures / logs) | Information disclosure (legal) | Grant-less coordinates table + purge + purge-overdue alert; step-return and DB sentinel tests; anonymized fixtures |
| Cross-tenant writes from workflow or cron tier | Tampering | Workflow input from server-verified `auth()` only; handlers reachable only via Vercel Queues [CITED: vercel-world.mdx]; every step re-reads the run under RLS; definers compare tenancy explicitly (the 0020 WR-04 shape); cron role holds execute on one function only |
| Forged cron invocation | Spoofing | Bearer `CRON_SECRET`, timing-safe compare, refuse when unset; idempotent purge |
| Tenant resets `runs.calls_count` to evade its own ceiling | Tampering | Accepted: the monthly meter still bounds spend; `ceiling_requests` excluded from the UPDATE column grant |
| CI clicking Run against production | Financial | UI Rules 38/39 rewrite of `spend.spec.ts` / `preset-detail.spec.ts`; e2e never reaches Google |
| "Open on Google Maps" link injection | Tampering | href built from stored `place_id` + `encodeURIComponent` of our own display name/city only |

## Sources

### Primary (HIGH confidence)
- `workflow@4.8.9`, `@workflow/core@4.8.9`, `@workflow/next@4.1.13`, `@workflow/builders@4.1.14`, `@workflow/utils`: installed in the session scratchpad; read `dist/*.d.ts`, builder source, and the bundled docs (`workflow/docs/**`: getting-started/next, foundations/{workflows-and-steps, starting-workflows, errors-and-retries, idempotency, common-patterns, versioning}, api-reference/{workflow-next/with-workflow, workflow-api/start, vitest}, testing/index, deploying/world/{vercel-world, local-world}, how-it-works/{code-transform, encryption})
- Scratch spike (`@workflow/vitest@4.0.25` + `vitest@5.0.1` + `vite@8.3.0`, Windows): 3 orchestration tests pass; `vi.mock` does not reach steps; msw intercepts inside steps; msw colon-path behaviour
- npm registry (`npm view`), 2026-09-23 — versions, dist-tags, publish dates, peers, install scripts
- https://vercel.com/docs/workflows (updated 2026-09-04) and /workflows/pricing (updated 2026-09-16) — limits, 7-day Pro retention, events per step, 4.x in `iad1`
- https://vercel.com/docs/cron-jobs/manage-cron-jobs (updated 2026-08-11) — `CRON_SECRET`, best-effort/duplicate delivery, no retries
- https://developers.google.com/maps/documentation/places/web-service/text-search (updated 2026-09-17) — request fields, pagination rule, 60 cap, rectangle-only restriction
- https://developers.google.com/maps/documentation/places/web-service/data-fields (updated 2026-09-17) — Text Search tiers
- https://developers.google.com/maps/documentation/places/web-service/place-types (updated 2026-09-17) — raw HTML parsed: Table A 478, Table B 36
- Census TIGERweb REST (`Places_CouSub_ConCity_SubMCD/MapServer/25`, `State_County/MapServer/55`) — queried live for all 17 cities
- Repo source: `drizzle/0016`, `0018`, `0019`, `0020`, `0021`, `0023`, `0013`, `0000`; `src/server/actions/queue-run.ts`, `src/lib/budget/*`, `src/lib/estimate/*`, `src/lib/resolve/{score,block}.ts`, `src/lib/normalize/*`, `src/lib/ingest/etl-actor.ts`, `src/db/*`, `src/env.ts`, `src/proxy.ts`, the walker tests; `docs/runbooks/google-quota.md`, `docs/deploy.md`; local `siteless_test` (read-only transaction)

### Secondary (MEDIUM confidence)
- Google Cloud error model (`code`/`message`/`status`/`details`) via search results on developers.google.com; the `error-messages` page URL 404s

### Tertiary (LOW confidence)
- SAB behaviour under `locationRestriction`; per-page billing; error-response billing; quota metric scope — all flagged in the Assumptions Log for D-04 / first-invoice verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed, spiked on this machine, versions from the registry
- Architecture: HIGH for the budget/tenancy/workflow mechanics (source-verified); MEDIUM for tiling constants (empirical by design)
- Pitfalls: HIGH for the repo-mechanical ones (walkers, proxy, msw, ledger arithmetic, estimate); MEDIUM for Google-behaviour ones

**Research date:** 2026-09-23
**Valid until:** 2026-10-07 for the Workflow SDK (fast-moving: 4.8.x released weekly) and Google pages; 2026-10-23 for the repo-internal findings
</content>
</invoke>
