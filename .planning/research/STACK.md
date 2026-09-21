# Stack Research

**Domain:** Scheduled multi-source data-ingestion SaaS with mobile-first triage (local-business lead finder)
**Researched:** 2026-09-20
**Confidence:** HIGH on versions and pricing (npm registry + official docs, verified live). MEDIUM on scheduler choice (new-ish GA product). MEDIUM on dedupe approach (no dominant library — pattern, not product).

---

## The one finding that should drive the roadmap

**The Places API fields Siteless exists to read — `websiteUri`, `nationalPhoneNumber`, `rating`, `userRatingCount` — are all *Enterprise*-tier fields.** Verified against Google's own field-tier table and cross-checked against the text-search docs.

That collapses the design space:

| SKU | Price / 1,000 requests | Free / month | Gets you `websiteUri`? |
|---|---|---|---|
| Text Search Essentials | free, unlimited | unlimited | No — IDs only |
| Text Search Pro | $32.00 | 5,000 | No |
| **Text Search Enterprise** | **$35.00** | **1,000** | **Yes — for up to 20 places per request** |
| Place Details Essentials | $5.00 | 10,000 | No |
| Place Details Pro | $17.00 | 5,000 | No |
| Place Details Enterprise | $20.00 | 1,000 | Yes — for **one** place per request |

Two consequences, both load-bearing:

1. **Never call Place Details per candidate.** Place Details Enterprise costs $0.020 per business. A 20-result Text Search Enterprise page costs $0.00175 per business — **11× cheaper for the identical fields**. The whole pipeline must harvest everything from the *search page* response.
2. **You are billed at the highest tier in your field mask.** One stray `places.rating` in a field mask promotes an entire Pro sweep to Enterprise. The field mask is the budget control surface, which is why the client choice below matters (see "What NOT to Use").

Verified-live budget model (numbers from the TX Comptroller API, queried during this research):

| Item | Volume | Cost |
|---|---|---|
| RGV addressable universe (4 counties × 4 clusters, active sales-tax outlets) | 9,896 | — |
| Full Places sweep at 20 places/request, 3× query overlap | ~1,500 requests (1,000 free) | **$17.50** |
| Firecrawl verification search, gated behind DNS/HTTP probes | ~2,000 searches ≈ 4,000 credits | **$16.00** (Hobby) |
| Claude Haiku 4.5 classification, Batch API | ~2,000 calls | **~$3.00** |
| **Total data spend** | | **~$36.50 / mo** |

Under the $50 cap with ~25% headroom. **Vercel Pro ($20/mo) is separate infrastructure spend, not data spend** — and it is required, because Hobby cron runs *once per day with ±59 minutes of jitter*.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| Next.js | `16.3.5` | App framework, API routes, PWA shell | Current stable. Turbopack is the default bundler in 16 — this is why `next-pwa` is dead and Serwist is the only live option. Note `middleware.ts` → `proxy.ts` at the project root (or `src/proxy.ts` — level with `app/`, never inside it; corrected 2026-09-21), Node runtime only. |
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

---

## (a) Scheduler + budget cap — the comparison

**Recommendation: Vercel Cron (trigger) + Workflow DevKit `workflow@4.8.9` (durable execution) + a Postgres spend ledger (the actual cap).** Confidence: MEDIUM-HIGH.

| Option | Durability / retries | Cost at this scale | Budget-cap fit | Verdict |
|---|---|---|---|---|
| **Vercel Cron + Workflow DevKit** | Per-step retries, replay across crashes *and* deployments, unlimited run duration, unlimited `sleep`, built-in tracing in Vercel Observability | $0.02 / 1K events, $0.50/GB written; Hobby includes 50K events. A nightly sweep is **single-digit dollars/month** | Ledger is your code, inside a step, in your own Postgres | **Chosen** |
| Inngest `4.20.0` | Strongest primitives: `concurrency`, `throttle`, `rateLimit`, `debounce`, fan-out | Free 50K executions / 5 concurrent steps; **Pro jumps to $99/mo** | Same ledger pattern; `throttle` is a genuinely nicer second wall | **Runner-up.** Switch if per-source rate-limiting becomes the dominant complexity |
| Trigger.dev `@trigger.dev/sdk@4.6.3` | Dedicated compute, no serverless timeout, open source (self-hostable) | Free tier is only **$5 credits + 1-day log retention**; Hobby $10/mo, Pro $50/mo | Fine | **Rejected.** A second deploy target and a second vendor, and Pro's $50 *is* the entire data budget |
| Supabase `pg_cron` + `pg_net` + Edge Functions | **None.** Skipped runs are not retried; a tick firing while the previous holds a lock is silently dropped; no alerting beyond a log row; a paused project stops every schedule | ~free | Ledger is one table away | **Rejected for the pipeline.** Acceptable only for trivial internal housekeeping |

Why Workflow DevKit wins here specifically: GA since **2026-04-16** (beta since Oct 2025; >100M runs, >1,500 customers), it is already the platform Siteless deploys to, and its `'use workflow'` / `'use step'` directives make each external API call a *separately retryable, separately observable* unit — which is exactly the granularity a cost ledger needs.

**Limits you will actually hit:** 10,000 steps/run, 25,000 events/run, 240 s max *replay* duration. A "sweep all of RGV" workflow will exceed these as one run. **Design it as a parent workflow that spawns one child workflow per (cluster × city) tile** — Vercel's own docs recommend child workflows past 2,000 events for replay performance.

### The budget cap — build it as two walls, not one

*Wall 1 — in code, authoritative.* A `spend_ledger` table with a **reserve → commit/release** pattern:

- Before any billable call, a step opens a transaction, `SELECT ... FOR UPDATE` on the current month's row for that provider, checks `reserved + spent + estimated_cost <= cap_cents`, and inserts a reservation. If it would breach, it throws a **non-retryable** error that halts the workflow and writes a `budget_exhausted` event.
- After the call returns, commit the actual cost (Places bills per request, so cost is knowable exactly from SKU tier × request count).
- Reservations older than N minutes are released by a sweeper — this is what makes crashes safe.
- Estimate cost from the **field mask**, not from the endpoint. A `fieldMaskTier()` pure function mapping field lists → `essentials | pro | enterprise` is the single most test-worthy function in the codebase. Unit-test it against Google's published field table, and make it *refuse* an unknown field rather than defaulting to Essentials.

*Wall 2 — at the provider, independent.* Set **per-day request quotas on the Google Cloud API key** and a billing budget alert. A code bug that bypasses the ledger still cannot produce a surprise invoice. Firecrawl's plan credit ceiling is the equivalent wall on that side.

Never rely on Wall 2 alone (it's coarse and reactive) or Wall 1 alone (it's the thing most likely to have the bug).

---

## (b) Verification pipeline

Order the probes by cost, cheapest first, and **stop as soon as the verdict is determined**. This is what keeps Firecrawl inside budget.

| Stage | Tool | Cost | Produces |
|---|---|---|---|
| 1. Places field harvest | REST `fetch` | already paid | `websiteUri` present/absent |
| 2. DNS probe | `node:dns/promises` | free | A/AAAA/CNAME/NS/MX → resolves at all? |
| 3. Parking-NS match | static list + `NS`/`CNAME` compare | free | Sedo / Bodis / Afternic / HugeDomains / registrar default NS → **parked** |
| 4. HTTP probe | `undici`, `redirect: 'manual'`, 5 s timeout | free | status, redirect chain, final host, content-length, `<title>` |
| 5. Content heuristics | regex/cheerio on stage-4 body | free | "coming soon", "this domain is for sale", default CMS template, byte-size floor |
| 6. Web search | `firecrawl` `search()` | 2 credits / 10 results | social pages, directory pages, an undiscovered real site |
| 7. LLM adjudication | `claude-haiku-4-5` | ~$0.0015/lead | only for genuinely ambiguous stage-5/6 output |

Research consensus (NDSS "Parking Sensors"; later authoritative-DNS work) is that **DNS-based parked detection reaches ~92.8% accuracy without crawling the page at all** — stages 2–3 should therefore resolve most of the "dead or parked" class for free.

**Receipts:** one append-only `verification_probes` table — `lead_id`, `stage`, `probe_type`, `request` (URL/query/field mask), `response_summary` (jsonb), `verdict_contribution`, `cost_cents`, `probed_at`. The lead's verdict is a *derived* value with a `verdict_version`; the probes are the immutable evidence. This is what makes "receipts one tap away" a `SELECT`, not a reconstruction — and it is what makes the false-positive rate measurable rather than assumed.

Social-page detection is a URL-pattern classifier over stage-6 results (`facebook.com/<handle>`, `instagram.com/<handle>`, `linktr.ee`, `yelp.com/biz`, `business.site`, `*.godaddysites.com`, …) — a data table, not a library. Keep it in the database so it's editable without a deploy.

---

## (c) Entity resolution / dedupe

**Recommendation: Postgres-native three-stage resolution (normalize → block → weighted score). Confidence: MEDIUM-HIGH on the approach, HIGH on the negative finding.**

The negative finding first, because it's the useful one: **there is no maintained TypeScript entity-resolution library worth adopting.** `talisman` last published 2022-06; `fastest-levenshtein` 2022-08; `parse-address` 2022-06; `node-postal` needs a native C library that will not deploy to Vercel Functions. The mature tooling (Python `dedupe`, `splink`) is the wrong runtime. Building this in SQL is not a workaround — it is the standard answer, and Supabase already ships every extension it needs.

**Stage 1 — normalize (columns, written once, indexed):**
- `phone_e164` — `libphonenumber-js`, region `US`. Highest-precision key.
- `name_norm` — lowercase, `unaccent`, strip legal suffixes (`LLC`, `INC`, `L.L.C.`, `CO`, `DBA`), collapse whitespace/punctuation.
- `street_num` + `street_norm` — leading house number split out, USPS abbreviations folded (`STREET`→`ST`, `AVENUE`→`AVE`). Hand-roll this with a table-driven map and unit tests; `addresser@1.1.22` is the only maintained parser (2026-08) and is a reasonable fallback, but the field is short enough that owning it beats depending on it.
- `geom` — PostGIS point from the Places `location`.

**Stage 2 — block (never compare all pairs).** 9,896 RGV records is 49M pairs per pass. Generate candidates only where at least one holds:
- exact `phone_e164` match, or
- `name_norm % name_norm` (pg_trgm `similarity` above threshold) **and** same `zip`, or
- `ST_DWithin(geom, geom, 150)` **and** trigram similarity above a looser threshold.

GIN index on `name_norm gin_trgm_ops`; btree on `phone_e164`; GiST on `geom`.

**Stage 3 — weighted score.** `similarity()` (pg_trgm) for names, `levenshtein()` (fuzzystrmatch) for short fields, exact/near for phone and street number, distance for geometry. Sum weights → auto-merge above the high threshold, queue for human review in the band, reject below. Store the **pair score and its component parts** on the merge record: when a merge is wrong, you need to see which component lied.

**Survivorship** is per-field, not per-record: prefer Places for `websiteUri` and `rating`, prefer the Comptroller `outlet_name` for the legal/DBA name, prefer whichever source has a phone. Record `source` per surviving field.

🔴 **Carry-over from BIS:** keep the *internal* label and the *customer-facing* name in separate columns from the first migration. In BIS, `accounts.name` was the agency's internal label and escaped to customers three times. Here the analogue is `outlet_name` (a state-filing string, often mis-typed — the live sample literally contains `LANKMARK INTERIOR BUILDERS` for `LANDMARK`) versus the Places `displayName` that a human would recognize on a call. Never let the Comptroller string be the one shown on the triage card.

---

## (d) Scoring

**Rules first, in TypeScript, deterministic and versioned. Confidence: HIGH.**

A pure `scoreLead(features): { score, breakdown, version }` module — no I/O, no dates read from `Date.now()` inside it (pass the clock in). Persist `score`, `score_version`, and the full `breakdown` jsonb per lead. When the model changes, you re-score and can *diff*; with only a number stored you cannot.

The four inputs from PROJECT.md map cleanly to weighted sub-scores: reviews/rating (`userRatingCount` × `rating`), social-only presence (verdict class), industry ticket size (a NAICS→weight table — **in the database**, because danlo will tune it weekly), and phone presence/reachability.

**Where an LLM fits — and only here:**
1. **Parked/template adjudication** when stage-5 heuristics are inconclusive (is this a real one-page site or a GoDaddy placeholder?).
2. **Social-page identity match** — does `facebook.com/riogranderoofing` actually belong to *this* business at *this* address, or a same-named one in Houston?

Both are short-input, single-label classifications. Use **`claude-haiku-4-5`** ($1 / $5 per MTok, 200K context, fastest) via `@anthropic-ai/sdk@0.127.0`, through the **Message Batches API for a 50% discount** since nothing here is latency-sensitive. Constrain output with a tool-use schema, validate with zod, and **store the prompt and the raw response as a probe receipt** — an LLM verdict with no receipt is exactly the kind of unfalsifiable claim this product exists to eliminate. Never let the LLM produce the *score*; let it produce a *feature* the rules consume.

---

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

**Three carried-over traps that apply directly here:**

1. **Tailwind v4: `[var(--x)]`, never `[--x]`.** The shorthand was dropped and fails silently.
2. **Painted values, never CSS custom properties, for anything a test pins.** Three occurrences in BIS. And: composed custom properties resolve *where declared* — put brand-composed tokens on `*`, not `:root`.
3. **A `"use client"` module's exports are client references inside a server component** — even plain data objects. Two occurrences in BIS, each a 500 with typecheck + lint + build all green. Keep the scoring-weights table and the social-URL pattern table in server-only modules.

Offline tolerance is a *product* requirement here ("tolerant of a bad connection" — triage happens in the field, in the RGV, on cellular). Test it as one: Playwright with `context.setOffline(true)` over the installed-PWA path, asserting decisions queue and flush.

---

## (f) BIS CRM handoff

**Recommendation: hand-rolled HMAC-signed POST following the Standard Webhooks header shape. Confidence: HIGH.**

- **Signing:** HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw-body}`. Sign and verify against the **raw** body, never a re-serialized object — JSON key ordering will betray you. Verify with `crypto.timingSafeEqual`.
- **Replay protection:** BIS rejects a `webhook-timestamp` older than 5 minutes.
- **Idempotency:** `webhook-id` = the Siteless lead UUID, stable across retries. BIS stores processed IDs and returns `200` on a duplicate (not an error) so retries converge. This is the Standard Webhooks recommendation and it means a redelivered accept never creates a second contact.
- **Delivery:** one `crm_deliveries` row per attempt (`lead_id`, `attempt`, `status`, `response_body`, `at`). Retry as a Workflow step — its built-in backoff plus `sleep` handles BIS being down for an hour without a cron storm.
- **Rejected: `svix@2.5.0`.** It's an SDK for a hosted webhook-delivery service. For exactly one known consumer that you also own, it adds a vendor and a bill to replace ~60 lines you need to understand anyway.

🔑 The BIS side must reuse its existing contact-creation logic (brand-name resolver included) rather than inserting directly — BIS's `brandName` vs `accounts.name` separation is enforced there, and bypassing it re-opens a bug class that took three occurrences to close.

---

## (g) Testing, typed DB access, migrations, CI

**Typed DB access — Drizzle, not supabase-js, not Kysely.**

- `supabase-js@2.116.0` stays for **auth session plumbing only**. Its PostgREST query builder cannot express the dedupe SQL (trigram similarity, `ST_DWithin`, `FOR UPDATE` on the spend ledger) and its generated types are weaker than Drizzle's inferred ones.
- `kysely@0.29.6` is an excellent query builder but **has no migration or schema story**, and Siteless needs `org_id` + RLS declared alongside the schema.
- Drizzle expresses table, types, **and** `pgPolicy` in one file. The `org_id`-on-every-table constraint becomes a shared `orgScoped()` table helper plus a policy factory — and a test that enumerates `information_schema` and fails if any table lacks `org_id` or lacks RLS enabled.

🔴 **Test-visibility trap carried from BIS:** service-role test fixtures are **blind to column grants and RLS**. A `serviceDb` fixture will pass on a query a real user session refuses. Any RLS/`org_id` assertion must run through a *user-role* connection (Clerk JWT → `set local role authenticated` + claims) inside a rolled-back transaction, pin the **SQLSTATE** (`42501`, not `status >= 400`), and be watched failing first. One refused statement per transaction — the first refusal aborts it and the next reports `25P02`.

**Migrations:** `drizzle-kit generate` → SQL committed to the repo → applied in a PR gate. Supabase CLI runs a local Postgres for tests, nothing else. Two migration authorities against one database is drift waiting to happen.

**Testing:**
- `vitest@5.0.1` for units — scoring, field-mask tiering, phone/name normalization, parked heuristics, HMAC signing.
- `msw@2.15.0` with **recorded real payloads** for Places/Firecrawl/Socrata. CI must never spend budget.
- `@playwright/test@1.63.0` for triage flows, offline, and installed-PWA behaviour.
- 🔴 **Timezone + locale:** run tests with `TZ=America/Chicago` **and** pin the locale explicitly. A fixture zone equal to the dev zone cannot discriminate — assert **one instant in two zones with opposite verdicts**; Chicago only ever as half a pair. `Intl` formats in the *system* zone while `Date.UTC` anchors UTC midnight, which renders the previous day across the Americas. Spy the constructor and assert the pin.
- 🔴 A green suite proves nothing a mutation check hasn't. One named test per mutation, reverted, diffed back — and **read the failing test's name**, because a `-t` filter matching nothing exits green.

**CI (GitHub Actions):** `verify` (typecheck → lint → unit) and `e2e` jobs, `pnpm/action-setup` + `pnpm install --frozen-lockfile`. PR-only; merge only when both are green **on the current head** — `origin/main` moves during long gates, so fetch before deciding and re-run on the combined tree. Print branch + HEAD sha *after* every long gate; a parallel session can move the tree mid-gate and turn a gate green on the wrong commit.

---

## Data source clients

### Google Places API (New) — use REST, not the SDK

```ts
await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
    'X-Goog-FieldMask': fieldMask,      // <- the cost control surface
  },
  body: JSON.stringify({ textQuery, locationRestriction, includedType, pageSize: 20, pageToken }),
});
```

Verified constraints: `pageSize` 1–20; **max 60 results across all pages**; circle radius max 50,000 m; rectangle (viewport) also supported; **`includedType` accepts exactly one type** ("Only one type may be specified"). The 60-result ceiling is what forces tiling by (cluster subtype × city), and the single-`includedType` rule is what multiplies the query count — both are budget inputs, not implementation details.

⚠️ One thing the docs do **not** state explicitly: whether each `pageToken` page is separately billed. Every other per-request SKU implies yes, and the budget model above assumes yes. **Verify empirically against the first real billing cycle** rather than trusting either reading.

### Free public data — verified live during this research

`data.texas.gov` is a **Socrata portal with a SoDA JSON API**. No scraping, no key needed for modest volume, no library — plain `fetch` + SoQL.

| Dataset | ID | Rows (verified) | Carries |
|---|---|---|---|
| **Active Sales Tax Permit Holders** | `jrea-zgmq` | **887,244** | `outlet_name` (**DBA**), `outlet_address`, `outlet_city`, `outlet_zip_code`, `outlet_county_code`, **`outlet_naics_code`**, permit dates |
| Active Franchise Taxpayers | `9cir-efmm` | **3,463,622** | legal name, mailing address, county, SOS status |

`jrea-zgmq` is the better source by a wide margin — it has the **trading name, the physical outlet address, and a NAICS code**, which is exactly industry × geography. Live counts for the four RGV counties (Hidalgo `108`, Cameron `031`, Starr `214`, Willacy `245`): **34,928 outlets total**, of which food services 5,425 · auto/repair 1,701 · personal care 1,129 · specialty trade 919 · building services 722.

⚠️ Gotcha found by probing: `outlet_naics_code` is typed **numeric** in Socrata, so `starts_with()` errors with `query.soql.type-mismatch`. Filter with ranges — `outlet_naics_code >= 238000 AND outlet_naics_code < 239000`.

Neither dataset has a phone number, and neither knows about websites. Their role is **enumeration and coverage measurement** — "Places returned 40 restaurants in Alamo, the state says there are 67" is the signal that a tile was under-crawled. Do **not** use them to drive per-business Places lookups (that's the $0.02/business path).

### Overture Maps

Latest release **`2026-08-19.0`**, GeoParquet on S3 (`s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*`) and Azure. Query with **DuckDB** (`httpfs` + `spatial` extensions) using HTTP range reads — you transfer only the RGV bbox, not the planet.

Run this as a **one-shot offline ETL** (`tsx` + `@duckdb/node-api@1.5.5-r.5`) that loads an RGV subset into Postgres. DuckDB's native binary has no business in a Vercel function bundle. If it ever must run in-function, `hyparquet@1.31.1` is a pure-JS Parquet reader (actively maintained, 2026-09-17), but it has no spatial predicates — a worse trade.

### OSM / Overpass

**Recommendation: skip Overpass entirely for v1.** Overture already incorporates OSM-derived POIs, so Overpass is a fourth source of the same data with an extra failure mode.

If it is added later: **do not use `overpass-ts@4.3.8` (last publish 2022-05) or `osmtogeojson@3.0.0-beta.5` (2022-10)** — both stale, both trivially replaced by `fetch` + a 30-line mapper. Respect the policy: **~10,000 requests/day and ~1 GB/day**, load-shed hits heavy users first, and a descriptive User-Agent is expected. For anything bulk, take a Geofabrik Texas extract offline instead of hammering the public instance.

---

## Installation

```bash
# Core
pnpm add next@16.3.5 react@19.3.0 react-dom@19.3.0 \
  @clerk/nextjs@7.9.4 @supabase/supabase-js@2.116.0 @supabase/ssr@0.12.7 \
  drizzle-orm@0.45.2 postgres@3.4.9 zod@4.6.5

# Pipeline
pnpm add workflow@4.8.9 @vercel/functions@3.9.8 \
  firecrawl@4.41.0 @anthropic-ai/sdk@0.127.0 \
  libphonenumber-js@1.13.13 undici@8.10.2 p-limit@7.3.3 pino@10.3.1

# UI / PWA
pnpm add tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 \
  motion@13.4.0 sonner@2.0.8 vaul@1.1.2 lucide-react@1.47.0 \
  class-variance-authority@0.7.1 tailwind-merge@3.7.0 next-themes@0.4.6 \
  @tanstack/react-query@5.103.1 idb@8.0.3 \
  date-fns@4.4.0 @date-fns/tz@1.5.0

# Dev  — NOTE: typescript is pinned to 6.0.3, NOT 7.x
pnpm add -D typescript@6.0.3 @types/node@26.6.2 @types/react@19 @types/react-dom@19 \
  drizzle-kit@0.31.10 supabase@2.117.0 tsx@4.23.15 \
  vitest@5.0.1 @vitest/coverage-v8@5.0.1 vite@8.3.0 \
  @playwright/test@1.63.0 @testing-library/react@16.3.3 \
  @testing-library/jest-dom@7.0.1 @testing-library/user-event@14.6.7 \
  msw@2.15.0 jsdom@30.1.0 \
  eslint@10.11.0 typescript-eslint@8.70.0 prettier@3.9.8 \
  @serwist/turbopack@9.5.12 serwist@9.5.12

# Offline ETL only — keep out of the deployed bundle
pnpm add -D @duckdb/node-api@1.5.5-r.5
```

---

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

---

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
| **Auth checks in `proxy.ts` at the project root (or `src/proxy.ts` — level with `app/`, never inside it; corrected 2026-09-21)** | Next 16 renamed middleware → `proxy.ts` partly in response to **CVE-2025-29927** (middleware auth bypass). Vercel's guidance: proxy is for routing, not authorization. | `clerkMiddleware()` in `proxy.ts` for session context; `await auth.protect()` / explicit checks in layouts, route handlers, and server actions — **as close to the data as possible**. |

---

## Stack Patterns by Variant

**If the monthly Places bill approaches the cap:**
- Split the sweep: **Text Search Essentials (IDs-only, unlimited free)** to enumerate place IDs per tile, then a *single* Enterprise sweep only over tiles whose ID set changed since last run. Detection cost then scales with churn, not with inventory.
- Move the full sweep to monthly and run nightly deltas on the highest-scoring clusters only.

**If false-positive rate measures above ~10%:**
- Promote stage 6 (Firecrawl search) from gated to default for the `no presence` class specifically — that class is where a missing `websiteUri` most often just means Google didn't have it. Budget by narrowing stages 1–5 instead.

**If a second org ever onboards:**
- The `org_id` + RLS design already covers it. What does **not** scale is a single shared Places key and a single shared cap — make `spend_ledger` keyed by `(org_id, provider, month)` from the first migration, even though v1 has one org. Retrofitting a per-org cap means re-reading every call site.

**If the triage volume outgrows one person:**
- Swap the client-side offline queue's conflict policy from last-write-wins to a server-side claim (`claimed_by`, `claimed_at`) before adding a second triager. Two people swiping the same lead offline is a silent double-push to BIS otherwise.

---

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

---

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

1. **Per-page Places billing** — resolve empirically in the first billing cycle; the budget model's headroom depends on it.
2. **Clerk's official Next 16 guidance** — the dedicated upgrade page returns 404. Confirm `clerkMiddleware` in `proxy.ts` against Clerk's live quickstart when the auth phase starts.
3. **Places coverage vs. the Comptroller list** — the real false-positive driver is unknown until measured. Instrument the gap (state says N, Places returned M) from the first sweep.
4. **Query-fan-out multiplier** — the budget assumes ~3× overlap across tiles. Measure it on the first RGV sweep; it is the single largest uncertainty in the $36.50 estimate.
5. **Firecrawl MCP connector vs. app key** — IDEA.md notes a keyed MCP connector may already exist. The app needs its own key regardless; MCP access does not transfer.

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

---
*Stack research for: scheduled multi-source lead-discovery SaaS (Siteless)*
*Researched: 2026-09-20*
