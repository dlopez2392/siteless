<!-- GSD:project-start source:PROJECT.md -->
## Project

**Siteless**

Siteless finds small businesses that have **no website** — starting in the Rio Grande Valley and scaling to Texas — across four industry clusters: home services & trades, food & hospitality, personal care & health, and auto & retail. It enumerates businesses from free, license-clean public data (Overture Maps + Texas Comptroller sales-tax permits), uses Google Places as a transient verifier, proves every "no website" verdict with receipts, scores each lead by how hot it is, and lets danlo and the BIS team triage leads from a phone. Accepted leads land in the BIS CRM as tagged contacts. It is a standalone product with a multi-tenant-ready core; BIS is its first integration, not its owner.

**Core Value:** A "no website" verdict you can trust enough to pick up the phone — every lead shows *why* it was classified, and the false-positive rate is measured, not assumed.

### Constraints

- **Legal**: Google Places API (New) is the only Google path and is used as a transient verifier — persist only `place_id`, lat/lng (≤30 days) and a derived boolean; Overture (CDLA-Permissive 2.0) and Comptroller (public domain) are the durable record; no direct scraping of Google Maps
- **Legal**: No outreach sending in v1 — TCPA (calls/SMS) and CAN-SPAM (email) exposure; consent plumbing precedes any future sending. Texas's mini-TCPA covers text messages as of 2025-09-01 (flagged for BIS separately)
- **Budget**: < $50/month data spend (Places + Firecrawl) enforced as an atomic reservation cap, plus a Google Cloud per-API daily quota as a second wall; a GCP budget alert alone does not stop spend
- **Hosting**: Vercel Pro (~$20/mo) for Vercel Cron + Workflow DevKit; Hobby's once-a-day jittered cron cannot run the scheduler
- **Tech stack**: standalone repo; own Supabase project (never BIS's `tlbkbmlrfafquucsmsmm`) and own Vercel project; Clerk auth mirroring BIS — note Clerk session token v2 nests org claims under `o`, so BIS's `app.current_account_id()` helper must be adapted with `coalesce(jwt->'o'->>'id', jwt->>'org_id')`; `typescript@6.x` (not 7 — `typescript-eslint` peer range); Places via REST `fetch` with a hard-coded field-mask allow-list; Postgres-native dedupe (`pg_trgm`, `fuzzystrmatch`, `unaccent`, PostGIS); `@serwist/turbopack` for the PWA; `motion` for gestures
- **Data**: multi-tenant-ready — every table carries `org_id` with RLS from the first migration; every `org_id` assertion tested through a user-role connection with Clerk claims, pinning SQLSTATE `42501`, watched failing first; one refused statement per rolled-back transaction
- **Data**: `legal_name` (Comptroller DBA, often mistyped) vs `display_name` (what the triage card shows) vs internal annotations — three fields, never interchangeable, a test asserts the internal one never reaches an export or push payload
- **Design**: world-class UI/UX is a first-class requirement — `/gsd-ui-phase` on every frontend phase; mobile-first, desk second
- **Timezone**: RGV is `America/Chicago` — tests pin zone **and** locale
- **Carried-over gotchas (BIS)**: painted values not CSS custom properties for anything a test pins; Tailwind v4 uses `[var(--x)]` not `[--x]`; a `"use client"` module's exports are client references inside a server component
- **Process**: GSD methodology, not superpowers; maximal parallel agents at every stage; a hand-triggered vertical slice (one city × one industry, ~50 verdicts eyeballed) before the scheduler is built; PR-only once CI exists; no autonomous merges — danlo reviews before merge
- **Dependencies not yet created**: Google Cloud project + Places API (New) key with billing and a daily quota, Firecrawl app key, Supabase project, Vercel Pro project, Clerk app; BIS-side inbound-lead endpoint
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## The one finding that should drive the roadmap
| SKU | Price / 1,000 requests | Free / month | Gets you `websiteUri`? |
|---|---|---|---|
| Text Search Essentials | free, unlimited | unlimited | No — IDs only |
| Text Search Pro | $32.00 | 5,000 | No |
| **Text Search Enterprise** | **$35.00** | **1,000** | **Yes — for up to 20 places per request** |
| Place Details Essentials | $5.00 | 10,000 | No |
| Place Details Pro | $17.00 | 5,000 | No |
| Place Details Enterprise | $20.00 | 1,000 | Yes — for **one** place per request |
| Item | Volume | Cost |
|---|---|---|
| RGV addressable universe (4 counties × 4 clusters, active sales-tax outlets) | 9,896 | — |
| Full Places sweep at 20 places/request, 3× query overlap | ~1,500 requests (1,000 free) | **$17.50** |
| Firecrawl verification search, gated behind DNS/HTTP probes | ~2,000 searches ≈ 4,000 credits | **$16.00** (Hobby) |
| Claude Haiku 4.5 classification, Batch API | ~2,000 calls | **~$3.00** |
| **Total data spend** | | **~$36.50 / mo** |
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| Next.js | `16.3.5` | App framework, API routes, PWA shell | Current stable. Turbopack is the default bundler in 16 — this is why `next-pwa` is dead and Serwist is the only live option. Note `middleware.ts` → `app/proxy.ts`, Node runtime only. |
| React | `19.3.0` | UI | Satisfies Next 16 peer (`^19.0.0`) and Clerk 7's narrow peer (`~19.3.0-0`). |
| **TypeScript** | **`6.0.3` — NOT 7.0.2** | Types | **`typescript-eslint@8.70.0` declares peer `typescript: ">=4.8.4 <6.1.0"`.** Installing `typescript@latest` (7.0.2) fails with `ERESOLVE` and breaks type-aware linting, because TS 7.0 ships without a stable programmatic compiler API (expected in 7.1). Verified directly from npm peer metadata. See Version Compatibility. |
| Node.js | `24.x LTS` | Runtime | Next requires `>=20.9.0`; Vitest 5 wants `@types/node ^22 \|\| >=24`. Pin in `.nvmrc` and in the CI matrix. |
| pnpm | `12.5.1` | Package manager | Matches BIS. Critically, `pnpm install --frozen-lockfile` works from a Windows-authored lockfile — `npm ci` does not (a documented, repeated cost in BIS CI). |
| Tailwind CSS | `4.3.3` | Styling | v4 engine. **Arbitrary values must use `[var(--x)]`, never `[--x]`** — v4 dropped the shorthand and emits invalid CSS *silently*. |
| shadcn CLI | `4.21.0` | Component scaffolding | Tailwind v4 + React 19 aware. Copy-in components, not a dependency. |
| Clerk | `@clerk/nextjs@7.9.4` | Auth, orgs | Peer allows `next ^16.1.0-0`. Mirrors BIS. Supplies `org_id` as a JWT claim. |
| Supabase Postgres | project-hosted | Database | **New project — never `tlbkbmlrfafquucsmsmm`.** Ships pg_trgm / fuzzystrmatch / unaccent / postgis, which is the entire dedupe engine. |
| Drizzle ORM | `0.45.2` (+ `drizzle-kit@0.31.10`) | Typed DB access + migrations | Schema, types, **and** RLS policies in one TS file. `drizzle-orm/supabase` exports `authenticatedRole` / `anonRole` / `serviceRole` and `pgPolicy()` links policies to tables, so the `org_id` guarantee is a compile-time artifact instead of a convention. |
| `postgres` (postgres.js) | `3.4.9` | Postgres driver | Drizzle's recommended Supabase driver. **Use the transaction-mode pooler URL with `prepare: false`** — the most common Supabase+Drizzle production failure. |
| Vercel Workflows / Workflow DevKit | `workflow@4.8.9` | Durable ingestion pipeline | See Scheduler decision below. |
| Vercel | Pro plan | Hosting, cron | Hobby cron is once/day ±59 min; Pro is per-minute. Function max duration: 300 s default, **800 s max on Pro**. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `zod` | `4.6.5` | Runtime validation | Every external response: Places, Firecrawl, Socrata, BIS webhook ack. Non-negotiable — these are untrusted, versioned, third-party payloads. |
| `firecrawl` | `4.41.0` | Web-search verification | The "search the web for this business" pass. **Package is `firecrawl`, not `@mendable/firecrawl-js`** (legacy alias, same version). |
| `libphonenumber-js` | `1.13.13` | Phone → E.164 | The single highest-precision blocking key for dedupe. Normalize on write, index the E.164 column. |
| `@anthropic-ai/sdk` | `0.127.0` | LLM classification | Only for the narrow judgements rules can't make (see Scoring). |
| `undici` | `8.10.2` | HTTP probing | Fine-grained control that global `fetch` doesn't expose: `redirect: 'manual'`, per-request timeouts, connection limits, custom User-Agent. |
| `node:dns/promises` | built-in | DNS probing | A/AAAA/CNAME/NS/MX lookups for parked-domain detection. Zero dependencies. |
| `p-limit` | `7.3.3` | Concurrency control | Cap outbound fan-out inside a workflow step. Vercel functions share **1,024 file descriptors** across concurrent executions — unbounded `Promise.all` over HTTP probes will exhaust them. |
| `@serwist/next` | `9.5.12` | PWA service worker | Precache manifest + `public/sw.js`. Use **`@serwist/turbopack@9.5.12`** instead if you keep Next 16's default Turbopack build. |
| `idb` | `8.0.3` | IndexedDB wrapper | Offline triage queue and decision outbox. |
| `motion` | `13.4.0` | Swipe gestures + animation | `drag="x"` + `onDragEnd` gives swipe-to-accept/reject **and** the spring animation from one actively maintained dependency (published 2026-09-16). |
| `sonner` | `2.0.8` | Toasts | Undo affordance for swipe decisions. Maintained (2026-08). |
| `@tanstack/react-query` | `5.103.1` | Client cache + retries | Offline tolerance: `networkMode`, retry/backoff, optimistic triage mutations. |
| `date-fns` + `@date-fns/tz` | `4.4.0` / `1.5.0` | Dates | Explicit IANA zone at every call site. See the timezone note under Testing. |
| `@duckdb/node-api` | `1.5.5-r.5` | Overture Maps ETL | **Offline script only** (`tsx scripts/load-overture.ts`), never inside a Vercel function — native binary + bundle weight. |
| `pino` | `10.3.1` | Structured logging | Receipts and cost-ledger events want structured JSON, not `console.log`. |
### Development Tools
| Tool | Purpose | Notes |
|---|---|---|
| `vitest@5.0.1` | Unit / integration tests | Requires `vite ^8.0.0` (`8.3.0` current) and `@types/node >=24`. |
| `@playwright/test@1.63.0` | E2E + PWA | Next 16 itself declares a `@playwright/test ^1.51.1` peer. Run the installed-PWA path in Chromium. |
| `@testing-library/react@16.3.3` | Component tests | Peer `react ^19.0.0`. |
| `msw@2.15.0` | Network mocking | Record real Places / Firecrawl / Socrata payloads once, replay in CI. **Never let CI spend Places budget.** |
| `typescript-eslint@8.70.0` + `eslint@10.11.0` | Linting | Constrains TypeScript to `<6.1.0`. |
| `prettier@3.9.8` | Formatting | |
| `supabase@2.117.0` (CLI) | Local Postgres for tests | Used for `supabase start` only. **Drizzle-kit is the single migration authority** — two migration systems against one database is a guaranteed drift bug. |
| `tsx@4.23.15` | Script runner | One-shot ETL (Overture, Comptroller backfill) and budget-audit scripts. |
## (a) Scheduler + budget cap — the comparison
| Option | Durability / retries | Cost at this scale | Budget-cap fit | Verdict |
|---|---|---|---|---|
| **Vercel Cron + Workflow DevKit** | Per-step retries, replay across crashes *and* deployments, unlimited run duration, unlimited `sleep`, built-in tracing in Vercel Observability | $0.02 / 1K events, $0.50/GB written; Hobby includes 50K events. A nightly sweep is **single-digit dollars/month** | Ledger is your code, inside a step, in your own Postgres | **Chosen** |
| Inngest `4.20.0` | Strongest primitives: `concurrency`, `throttle`, `rateLimit`, `debounce`, fan-out | Free 50K executions / 5 concurrent steps; **Pro jumps to $99/mo** | Same ledger pattern; `throttle` is a genuinely nicer second wall | **Runner-up.** Switch if per-source rate-limiting becomes the dominant complexity |
| Trigger.dev `@trigger.dev/sdk@4.6.3` | Dedicated compute, no serverless timeout, open source (self-hostable) | Free tier is only **$5 credits + 1-day log retention**; Hobby $10/mo, Pro $50/mo | Fine | **Rejected.** A second deploy target and a second vendor, and Pro's $50 *is* the entire data budget |
| Supabase `pg_cron` + `pg_net` + Edge Functions | **None.** Skipped runs are not retried; a tick firing while the previous holds a lock is silently dropped; no alerting beyond a log row; a paused project stops every schedule | ~free | Ledger is one table away | **Rejected for the pipeline.** Acceptable only for trivial internal housekeeping |
### The budget cap — build it as two walls, not one
- Before any billable call, a step opens a transaction, `SELECT ... FOR UPDATE` on the current month's row for that provider, checks `reserved + spent + estimated_cost <= cap_cents`, and inserts a reservation. If it would breach, it throws a **non-retryable** error that halts the workflow and writes a `budget_exhausted` event.
- After the call returns, commit the actual cost (Places bills per request, so cost is knowable exactly from SKU tier × request count).
- Reservations older than N minutes are released by a sweeper — this is what makes crashes safe.
- Estimate cost from the **field mask**, not from the endpoint. A `fieldMaskTier()` pure function mapping field lists → `essentials | pro | enterprise` is the single most test-worthy function in the codebase. Unit-test it against Google's published field table, and make it *refuse* an unknown field rather than defaulting to Essentials.
## (b) Verification pipeline
| Stage | Tool | Cost | Produces |
|---|---|---|---|
| 1. Places field harvest | REST `fetch` | already paid | `websiteUri` present/absent |
| 2. DNS probe | `node:dns/promises` | free | A/AAAA/CNAME/NS/MX → resolves at all? |
| 3. Parking-NS match | static list + `NS`/`CNAME` compare | free | Sedo / Bodis / Afternic / HugeDomains / registrar default NS → **parked** |
| 4. HTTP probe | `undici`, `redirect: 'manual'`, 5 s timeout | free | status, redirect chain, final host, content-length, `<title>` |
| 5. Content heuristics | regex/cheerio on stage-4 body | free | "coming soon", "this domain is for sale", default CMS template, byte-size floor |
| 6. Web search | `firecrawl` `search()` | 2 credits / 10 results | social pages, directory pages, an undiscovered real site |
| 7. LLM adjudication | `claude-haiku-4-5` | ~$0.0015/lead | only for genuinely ambiguous stage-5/6 output |
## (c) Entity resolution / dedupe
- `phone_e164` — `libphonenumber-js`, region `US`. Highest-precision key.
- `name_norm` — lowercase, `unaccent`, strip legal suffixes (`LLC`, `INC`, `L.L.C.`, `CO`, `DBA`), collapse whitespace/punctuation.
- `street_num` + `street_norm` — leading house number split out, USPS abbreviations folded (`STREET`→`ST`, `AVENUE`→`AVE`). Hand-roll this with a table-driven map and unit tests; `addresser@1.1.22` is the only maintained parser (2026-08) and is a reasonable fallback, but the field is short enough that owning it beats depending on it.
- `geom` — PostGIS point from the Places `location`.
- exact `phone_e164` match, or
- `name_norm % name_norm` (pg_trgm `similarity` above threshold) **and** same `zip`, or
- `ST_DWithin(geom, geom, 150)` **and** trigram similarity above a looser threshold.
## (d) Scoring
## (e) Mobile-first installable PWA
| Concern | Choice | Why |
|---|---|---|
| Service worker | `@serwist/turbopack@9.5.12` (or `@serwist/next@9.5.12` on webpack) | **`next-pwa@5.6.0` is webpack-only and unmaintained; Next 16 defaults to Turbopack.** Serwist is the successor and the only live option. |
| Manifest | Next's `app/manifest.ts` | Typed, no static file drift. |
| Offline store | `idb@8.0.3` | Triage decisions queue locally, flush on reconnect. |
| Mutation queue | `@tanstack/react-query@5.103.1` | `networkMode: 'offlineFirst'` + optimistic updates + retry. |
| Swipe | `motion@13.4.0` — `drag="x"`, `onDragEnd` | Gesture *and* spring animation in one maintained dep (2026-09-16). |
| Tap-to-call | `<a href="tel:+19565551234">` | No library. Format with `libphonenumber-js` for display, E.164 in the href. |
| Sheets/drawers | `vaul@1.1.2` (via shadcn `Drawer`) | Low activity (2024) but stable and pinned by shadcn; acceptable. |
| Toasts/undo | `sonner@2.0.8` | Undo is mandatory for swipe UIs. |
## (f) BIS CRM handoff
- **Signing:** HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw-body}`. Sign and verify against the **raw** body, never a re-serialized object — JSON key ordering will betray you. Verify with `crypto.timingSafeEqual`.
- **Replay protection:** BIS rejects a `webhook-timestamp` older than 5 minutes.
- **Idempotency:** `webhook-id` = the Siteless lead UUID, stable across retries. BIS stores processed IDs and returns `200` on a duplicate (not an error) so retries converge. This is the Standard Webhooks recommendation and it means a redelivered accept never creates a second contact.
- **Delivery:** one `crm_deliveries` row per attempt (`lead_id`, `attempt`, `status`, `response_body`, `at`). Retry as a Workflow step — its built-in backoff plus `sleep` handles BIS being down for an hour without a cron storm.
- **Rejected: `svix@2.5.0`.** It's an SDK for a hosted webhook-delivery service. For exactly one known consumer that you also own, it adds a vendor and a bill to replace ~60 lines you need to understand anyway.
## (g) Testing, typed DB access, migrations, CI
- `supabase-js@2.116.0` stays for **auth session plumbing only**. Its PostgREST query builder cannot express the dedupe SQL (trigram similarity, `ST_DWithin`, `FOR UPDATE` on the spend ledger) and its generated types are weaker than Drizzle's inferred ones.
- `kysely@0.29.6` is an excellent query builder but **has no migration or schema story**, and Siteless needs `org_id` + RLS declared alongside the schema.
- Drizzle expresses table, types, **and** `pgPolicy` in one file. The `org_id`-on-every-table constraint becomes a shared `orgScoped()` table helper plus a policy factory — and a test that enumerates `information_schema` and fails if any table lacks `org_id` or lacks RLS enabled.
- `vitest@5.0.1` for units — scoring, field-mask tiering, phone/name normalization, parked heuristics, HMAC signing.
- `msw@2.15.0` with **recorded real payloads** for Places/Firecrawl/Socrata. CI must never spend budget.
- `@playwright/test@1.63.0` for triage flows, offline, and installed-PWA behaviour.
- 🔴 **Timezone + locale:** run tests with `TZ=America/Chicago` **and** pin the locale explicitly. A fixture zone equal to the dev zone cannot discriminate — assert **one instant in two zones with opposite verdicts**; Chicago only ever as half a pair. `Intl` formats in the *system* zone while `Date.UTC` anchors UTC midnight, which renders the previous day across the Americas. Spy the constructor and assert the pin.
- 🔴 A green suite proves nothing a mutation check hasn't. One named test per mutation, reverted, diffed back — and **read the failing test's name**, because a `-t` filter matching nothing exits green.
## Data source clients
### Google Places API (New) — use REST, not the SDK
### Free public data — verified live during this research
| Dataset | ID | Rows (verified) | Carries |
|---|---|---|---|
| **Active Sales Tax Permit Holders** | `jrea-zgmq` | **887,244** | `outlet_name` (**DBA**), `outlet_address`, `outlet_city`, `outlet_zip_code`, `outlet_county_code`, **`outlet_naics_code`**, permit dates |
| Active Franchise Taxpayers | `9cir-efmm` | **3,463,622** | legal name, mailing address, county, SOS status |
### Overture Maps
### OSM / Overpass
## Installation
# Core
# Pipeline
# UI / PWA
# Dev  — NOTE: typescript is pinned to 6.0.3, NOT 7.x
# Offline ETL only — keep out of the deployed bundle
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Vercel Workflow DevKit | Inngest `4.20.0` | When per-source throttling/concurrency becomes the dominant complexity. Its `throttle`/`rateLimit`/`concurrency` primitives are better than hand-rolled — but Pro is $99/mo. |
| Vercel Workflow DevKit | Trigger.dev `4.6.3` | Only if you must self-host or need a single step to run far past 800 s on dedicated compute. |
| Drizzle | Kysely `0.29.6` | If a future milestone needs heavy analytical SQL (window functions, CTEs, lateral joins) — Kysely types those better than anything. Can coexist on the same pool. |
| REST + `fetch` for Places | `@googlemaps/places@3.0.0` | Effectively never for this project — see What NOT to Use. |
| Postgres-native dedupe | Python `splink` / `dedupe` in a sidecar | Only at 100k+ records with a labelled training set. Massive overkill for ~10k. |
| `motion` | `react-swipeable@7.0.2` | If you want swipe with zero animation dependency — it's maintained (2026-07) and tiny. You'd still need a second lib for the spring. |
| `@serwist/turbopack` | `@serwist/next@9.5.12` | If you opt out of Turbopack back to webpack. |
| Firecrawl | SerpApi / Apify | Only if measured coverage gaps justify it. PROJECT.md already scopes these out pending evidence — keep them out. |
| TX Comptroller Socrata | Yelp Fusion | Yelp is paid since 2024 and adds *reviews*, not *enumeration*. Defer until the social-only class proves under-detected. |
## What NOT to Use
| Avoid | Why | Use Instead |
|---|---|---|
| **`typescript@7.0.2`** | `typescript-eslint@8` peer is `>=4.8.4 <6.1.0` → `ERESOLVE`. TS 7.0 ships **no stable programmatic compiler API** (slated for 7.1), so typescript-eslint, ts-jest and ts-morph cannot run on it. | **`typescript@6.0.3`**. Or run TS 7 for `tsc` only alongside `@typescript/typescript6@6.0.2` (ships a `tsc6` binary + re-exports the 6.0 API). Revisit when 7.1 + a typescript-eslint major land. |
| **`@googlemaps/places@3.0.0`** | Pulls `google-gax@^6` (gRPC + protobufjs), 2.2 MB unpacked, and wraps the field mask in a client abstraction — when the field mask **is** your budget control. | Plain `fetch` + `X-Goog-FieldMask` + zod. ~80 lines, exact cost control, no bundle cost. |
| **`@googlemaps/google-maps-services-js@3.4.2`** | Client for the **legacy** Maps web services, not Places API (New). Wrong API surface, and the legacy Places API is the one Google is retiring. | Same as above. |
| **`next-pwa@5.6.0`** | Requires webpack to build; **Next 16 defaults to Turbopack**. Unmaintained. | `@serwist/turbopack@9.5.12`. |
| **`@use-gesture/react@10.3.1`** | Last published **2024-03**. | `motion@13.4.0` (`drag` + `onDragEnd`). |
| **`talisman`, `fastest-levenshtein`, `parse-address`** | All last published **2022**. | Postgres `pg_trgm` + `fuzzystrmatch` + `unaccent`; `addresser@1.1.22` or a tested in-house normalizer. |
| **`node-postal`** | Native C `libpostal` dependency — will not build/deploy on Vercel Functions. | Table-driven USPS abbreviation normalization. |
| **`overpass-ts`, `osmtogeojson`** | 2022. Trivially replaced by `fetch` + a small mapper. | Overture via DuckDB; or raw Overpass `fetch` if truly needed. |
| **`svix@2.5.0`** | Hosted webhook-delivery SDK. A vendor and a bill for one consumer you own. | HMAC-SHA256 + Standard Webhooks headers + a `crm_deliveries` table. |
| **`@supabase/auth-helpers-nextjs@0.15.0`** | Superseded by `@supabase/ssr`. | `@supabase/ssr@0.12.7`. |
| **Clerk's Supabase JWT template** | **Deprecated 2025-04-01.** Requires sharing your Supabase JWT secret with Clerk and fetching a fresh token per request. | Supabase **native third-party auth** for Clerk — Supabase trusts Clerk-issued JWTs directly; read claims via `auth.jwt()` in RLS. |
| **`pg_cron` + `pg_net` as the pipeline scheduler** | No retries on skipped runs; a tick firing while the prior run holds a lock is **silently dropped**; no alerting beyond a log row; stops entirely if the project pauses. Recommended ceiling is 8 concurrent jobs / 10 min each. | Vercel Cron + Workflow DevKit. Keep pg_cron for trivial housekeeping only. |
| **Vercel Hobby plan for cron** | Cron limited to **once per day** with **±59 minutes** of jitter; more frequent expressions **fail at deploy time**. | Vercel **Pro** ($20/mo, infra budget — not the $50 data budget). |
| **Scraping Google Maps directly** | ToS violation; PROJECT.md scopes it out. | Places API (New) as the legal primary. |
| **Auth checks in `app/proxy.ts`** | Next 16 renamed middleware → `proxy.ts` partly in response to **CVE-2025-29927** (middleware auth bypass). Vercel's guidance: proxy is for routing, not authorization. | `clerkMiddleware()` in `proxy.ts` for session context; `await auth.protect()` / explicit checks in layouts, route handlers, and server actions — **as close to the data as possible**. |
## Stack Patterns by Variant
- Split the sweep: **Text Search Essentials (IDs-only, unlimited free)** to enumerate place IDs per tile, then a *single* Enterprise sweep only over tiles whose ID set changed since last run. Detection cost then scales with churn, not with inventory.
- Move the full sweep to monthly and run nightly deltas on the highest-scoring clusters only.
- Promote stage 6 (Firecrawl search) from gated to default for the `no presence` class specifically — that class is where a missing `websiteUri` most often just means Google didn't have it. Budget by narrowing stages 1–5 instead.
- The `org_id` + RLS design already covers it. What does **not** scale is a single shared Places key and a single shared cap — make `spend_ledger` keyed by `(org_id, provider, month)` from the first migration, even though v1 has one org. Retrofitting a per-org cap means re-reading every call site.
- Swap the client-side offline queue's conflict policy from last-write-wins to a server-side claim (`claimed_by`, `claimed_at`) before adding a second triager. Two people swiping the same lead offline is a silent double-push to BIS otherwise.
## Version Compatibility
| Package A | Compatible With | Notes |
|---|---|---|
| `typescript-eslint@8.70.0` | `typescript >=4.8.4 <6.1.0` | 🔴 **Hard blocker on TypeScript 7.** Verified from npm peer metadata. |
| `next@16.3.5` | `react ^18.2.0 \|\| ^19.0.0`, `node >=20.9.0` | React 19.3.0 satisfies. |
| `@clerk/nextjs@7.9.4` | `next ^16.1.0-0`, `react ~19.3.0-0` | Narrow React range — do **not** float React past 19.3.x without re-checking. |
| `vitest@5.0.1` | `vite ^6.4 \|\| ^7 \|\| ^8`, `@types/node ^22 \|\| >=24` | Use `vite@8.3.0`, `@types/node@26.6.2`. |
| `@testing-library/react@16.3.3` | `react ^19.0.0`, `@testing-library/dom ^10` | |
| `workflow@4.x` | Runs pinned to `iad1` | Multi-region needs `5.0.0-beta.33+`. **Stay on 4.x** — 5.x is beta and region-pinning is irrelevant to a single-region RGV product. |
| `drizzle-orm@0.45.2` + `postgres@3.4.9` | Supabase **transaction pooler** URL | Must set `prepare: false`. The most common Supabase+Drizzle production failure. |
| Vercel Functions | 300 s default / **800 s max (Pro)** / 1800 s beta | A sweep exceeding this must be a Workflow, not a long function. |
| Workflow runs | 10,000 steps, 25,000 events, 240 s replay | Use child workflows per tile past ~2,000 events. |
| Socrata `outlet_naics_code` | numeric type | `starts_with()` fails — use numeric range predicates. |
## Confidence Assessment
| Claim | Confidence | Basis |
|---|---|---|
| All package versions listed | **HIGH** | Queried the npm registry directly, 2026-09-20 |
| `typescript-eslint` blocks TypeScript 7 | **HIGH** | npm peer metadata (`>=4.8.4 <6.1.0`), corroborated by TS 7.0 release coverage |
| Places SKU prices and per-SKU free caps | **HIGH** | Google's official pricing page |
| `websiteUri`/phone/rating are Enterprise-tier | **HIGH** | Google's Place Data Fields table + Text Search docs, two independent reads |
| Text Search: 20/page, 60 max, one `includedType`, 50 km radius | **HIGH** | Official Text Search (New) docs |
| Each `pageToken` page is separately billed | **MEDIUM** | Not stated explicitly in the docs; inferred from per-request SKU semantics. **Verify on the first invoice.** |
| Vercel Workflows GA, pricing, limits | **HIGH** | Official docs (pages dated 2026-09-04 / 2026-09-16) |
| Vercel cron and function limits per plan | **HIGH** | Official docs (2026-07-15 / 2026-08-24) |
| Firecrawl pricing and credit rates | **HIGH** | Official pricing page |
| Claude model IDs and pricing | **HIGH** | platform.claude.com models overview |
| TX Comptroller datasets, schemas, row counts, RGV counts | **HIGH** | Queried the live Socrata API during this research |
| Inngest / Trigger.dev pricing | **HIGH** | Official pricing pages |
| Overture release `2026-08-19.0` + DuckDB access | **MEDIUM-HIGH** | Overture docs via search; release string not re-verified against the bucket |
| Postgres-native dedupe as the right approach | **MEDIUM-HIGH** | Strong convergence across sources + the verified absence of a maintained TS library |
| `pg_cron` availability on Supabase free tier | **LOW — sources conflict** | One source says every project/all plans, another says Pro+. Not load-bearing (pg_cron is rejected for the pipeline), but **confirm against the real project** if it's ever used. |
| Clerk + Next 16 `proxy.ts` pattern | **MEDIUM** | Clerk's own Next-16 upgrade page 404s; pattern assembled from Clerk's `clerkMiddleware` reference + Next 16 upgrade docs. **Re-verify at implementation time.** |
## Gaps / open questions for later phases
## Sources
- npm registry (`npm view`), queried 2026-09-20 — every version, peer range, and last-publish date above
- https://developers.google.com/maps/billing-and-pricing/pricing — Places SKU prices and free caps
- https://developers.google.com/maps/documentation/places/web-service/data-fields — field → SKU tier table
- https://developers.google.com/maps/documentation/places/web-service/text-search — pageSize/60-cap/radius/`includedType`
- https://developers.google.com/maps/documentation/places/web-service/usage-and-billing — "billed at the highest SKU applicable"
- https://vercel.com/docs/workflows and /workflows/pricing — GA status, billing, run limits (docs dated 2026-09-04 / 2026-09-16)
- https://vercel.com/docs/cron-jobs/usage-and-pricing — per-plan cron limits
- https://vercel.com/docs/functions/limitations — duration, memory, bundle, file-descriptor limits
- https://www.firecrawl.dev/pricing — plans and credit consumption
- https://www.inngest.com/pricing · https://trigger.dev/pricing — scheduler comparison
- https://platform.claude.com/docs/en/docs/about-claude/models/overview — model IDs and pricing
- https://data.texas.gov/resource/jrea-zgmq.json and /9cir-efmm.json — **queried live**; schemas, row counts, RGV county/NAICS counts
- Context7 `/drizzle-team/drizzle-orm-docs` — `pgPolicy`, `authenticatedRole`, Supabase RLS patterns
- https://docs.overturemaps.org/getting-data/duckdb/ — Overture via DuckDB httpfs
- https://operations.osmfoundation.org/policies/api/ and Overpass commons — usage policy
- https://supabase.com/docs/guides/auth/third-party/clerk — native integration; JWT template deprecated 2025-04-01
- https://nextjs.org/docs/app/guides/upgrading/version-16 — `middleware.ts` → `proxy.ts`, CVE-2025-29927 context
- https://github.com/standard-webhooks/standard-webhooks — signature + `webhook-id` idempotency
- NDSS "Parking Sensors: Analyzing and Detecting Parked Domains" — DNS-based parked detection accuracy
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
