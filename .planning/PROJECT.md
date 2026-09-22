# Siteless

## What This Is

Siteless finds small businesses that have **no website** — starting in the Rio Grande Valley and scaling to Texas — across four industry clusters: home services & trades, food & hospitality, personal care & health, and auto & retail. It enumerates businesses from free, license-clean public data (Overture Maps + Texas Comptroller sales-tax permits), uses Google Places as a transient verifier, proves every "no website" verdict with receipts, scores each lead by how hot it is, and lets danlo and the BIS team triage leads from a phone. Accepted leads land in the BIS CRM as tagged contacts. It is a standalone product with a multi-tenant-ready core; BIS is its first integration, not its owner.

## Core Value

A "no website" verdict you can trust enough to pick up the phone — every lead shows *why* it was classified, and the false-positive rate is measured, not assumed.

## Requirements

### Validated

- [x] Clerk org-scoped auth; `org_id` on every table with RLS; actor + timestamp on every state change; single org in v1 — *Validated in Phase 1: Foundations & Tenancy (2026-09-22): deployed at siteless-iota.vercel.app; RLS refusal pinned to 42501 through user-role connections; Places retention CHECK/FK constraints; append-only `events` by trigger and grant; platform default grants revoked (gap plan 01-12); 31 DB + 11 unit tests, e2e twice on the real URL.*

### Active

Detailed, testable requirements with REQ-IDs live in `.planning/REQUIREMENTS.md`. The hypotheses, in one line each:

- [ ] User defines searches as industry cluster(s) × geography (city list / county / radius), saved as versioned presets with RGV seeds and a pre-run cost estimate
- [ ] The durable business record comes from TX Comptroller sales-tax permits + Overture Maps places for the target counties (Texas side only), with per-field provenance
- [ ] Google Places API (New) acts as a transient verifier: Enterprise field mask on Text Search only, storing nothing but `place_id`, lat/lng (30-day TTL) and a derived `had_website_uri` boolean; free IDs-Only SKU for nightly change detection; saturation detected and tiles subdivided
- [ ] Every candidate gets a six-way web-presence verdict (no presence / social-only / directory-only / real site / dead-or-parked / unverifiable) with confidence, from DNS/HTTP/TLS/parked-page probes, the dead `business.site` cohort, and social/directory discovery via web search + Overture `socials[]`
- [ ] Every probe writes an immutable receipt (negative evidence included), visible one tap from the lead; receipts are separate from a versioned classifier so re-classification costs no spend
- [ ] Verification is budget-gated: a cheap pre-filter ranks candidates, top-N are verified within the period's budget, the rest are labelled `unverified`
- [ ] Glass-box lead score (reviews & rating, social-only, industry ticket size, phone as a floor) with a hot/warm/cold band and persisted components
- [ ] Three-tier entity resolution (≥95 auto-merge on trusted identifiers / 80–95 review queue / <80 ignore) with provenance, unmerge, and a stable external key that survives merges
- [ ] Saved presets run on a schedule — weekly rotating Enterprise partitions + nightly free change detection — on Vercel Cron + Workflow DevKit; runs are resumable and stop cleanly at the cap; a "Net New" view carries per-row change type
- [ ] Per-request cost ledger from the first billable call; atomic reserve → spend → true-up cap (< $50/mo default) that refuses at 100% and gates both enumeration and verification; dashboard shows spend vs cap per source
- [ ] Triage: accept / reject-with-reason / snooze, undo on every action, a queue with a remaining count and an end state, card + detail views, internal label separated from display name with a test
- [ ] Mobile-first installable PWA: swipe card stack, tap-to-call logged with an outcome prompt, prefetch-the-day read cache
- [ ] Accepting a lead pushes it to BIS as a tagged contact under BIS's dogfood account — idempotent by the stable key, observable per-lead status with retry; low-confidence and suppressed leads never auto-push; CSV export with a stable column contract
- [ ] One-tap "actually has a site" control feeding a measured false-positive rate: every called lead's outcome plus a weekly random sample of 20 uncalled verified leads
- [ ] Org-scoped internal do-not-contact list gating both the queue and the push; calling-window display in `America/Chicago`; per-field provenance on export; in-product compliance note

### Out of Scope

- Sending outreach (email, SMS, calls) — TCPA / CAN-SPAM exposure; v1 hands off to BIS where channels and consent already exist
- AI-drafted outreach and mock-site previews — a later milestone, human still sends and reviews
- Automated sequences / suppression / unsubscribe plumbing — only with consent infrastructure, later still
- **Yelp Fusion API** — its terms forbid caching beyond 24 h, building a listings DB, and commercial use without consent; $229/mo floor; no business-website field. Yelp presence is detected from web-search URLs instead
- **Meta Pages / Graph API** — no consent-free page discovery exists; Facebook URLs come from Overture `socials[]` and web search
- **Apify / SerpApi Google-Maps scraping** — not independent verification (Google laundered) and carries Google's ToS risk; Places API (New) is the only Google path
- **Storing Places content beyond `place_id`, lat/lng (30 days) and a derived boolean** — Maps Platform Terms §3.2.3; the minimum-exposure design survives a lawyer's "no" as a config change
- Direct Google Maps scraping — ToS
- Email discovery / contact enrichment — accuracy collapses to ~65%, invites CAN-SPAM, and no-website businesses rarely have a discoverable business email; phone-first
- SEO / PageSpeed audit reports — a no-website business has nothing to audit
- Map view as the primary triage surface — a separate billable SKU and a territory tool, not a triage tool
- "Unlimited leads" — incompatible with a hard cap on a metered API; publish the cap and the burn instead
- Auto-merge below 95% confidence — manufactures errors the accuracy metric would absorb
- National DNC Registry scrubbing — attaches to telemarketing campaigns; the internal list is the one that applies
- Multi-tenant billing, org invites, roles, plan limits — schema is org-scoped from day 1; one org in v1
- Native iOS/Android apps — app-store latency breaks the small-commit remote workflow; PWA gets `tel:`, offline, install
- A CRM inside Siteless — BIS is the CRM; exactly one field lives here: triage status
- ML / predictive scoring — no labelled outcomes exist yet
- Building the websites — that is the agency's job once the lead converts

## Context

- **Who and why:** danlo runs **BIS** (app.bis-rgv.com), a CRM / booking / review-request platform for local service businesses in the RGV — monorepo at `C:\Users\danlo\bis-platform` (Next.js, Supabase, Clerk, Vercel, Telnyx SMS, GitHub Actions CI). A business with no website is BIS's ideal customer. Siteless replaces "driving around looking for businesses without a site" with a system.
- **Success for v1:** 50 verified no-website leads pushed to BIS and called, with a measured false-positive rate. Measurement rule (decided): every called lead's outcome counts, plus a weekly random sample of 20 uncalled verified leads checked by hand and recorded.
- **The daily loop:** scheduled runs (weekly paid partitions, nightly free detection) → morning phone triage → accepted → BIS. The desk is for setup and deep dives.
- **Verification is the product, not the crawl.** Research (six dimensions, `.planning/research/`) confirmed it from the market side: the "no website" filter is table stakes in 20+ products; zero of 23 surveyed show receipts or measure their false-positive rate; exactly one (Webleadr, a PWA at $0.24–0.28/lead) is mobile-first. The empty columns are the product.
- **Live-measured RGV universe (2026-09-20):** Overture 57,494 places on the Texas side (19,414 with no website, 16,882 social-only); Comptroller sales-tax permits 34,928 outlets (9,896 in the four clusters, 38% sole proprietors); OSM 2,674 (skipped). A naive RGV bounding box is 42% Mexico — filter by county/country. Overture's `categories` field is removed in the 2026-09-23.0 release — build on `basic_category`.
- **Cost model (measured):** `websiteUri` / phone / rating / review count are Enterprise-SKU fields — Text Search Enterprise $35 per 1,000 requests, 1,000 free/month, 20 places per request → ~$1.75 per 1,000 businesses; Place Details per candidate is ~11× worse; Text Search IDs-Only is free and unlimited. A nightly full sweep costs $91–261/mo; the rotating-partition design lands at ~$21–37/mo. Vercel Pro (~$20/mo) is separate infrastructure spend.
- **Legal read pending:** whether a derived boolean over Places content is itself "Content" under Maps Platform Terms §3.2.3(c), and the scope of the §3.2.3(d)(iii) "listings or directory service" clause — 30 minutes with counsel before the first paid outreach. The design stays on the safe side of every unambiguous clause.
- **Tooling in hand:** Firecrawl is connected to Claude via MCP; the app needs its own Firecrawl key. Firecrawl's docs disagree on credits per search (2 vs 10) — pin on the first invoice.
- **Remote Control:** the build must be drivable from Claude Code mobile — small verifiable commits, no interactive-only steps, all state in `.planning/`, phases that can be picked up mid-flight.
- **Name:** Siteless. `siteless.com` was available as an exact-match .com on 2026-09-20 — **not purchased**; `weblessleads.com` exists and is worth a manual look for adjacency before any purchase. The repo directory is still `prospector`.
- **BIS dependency:** the BIS-side inbound-lead endpoint does not exist. It is a small PR in `bis-platform` (reuse its contact-creation logic, HMAC-signed, idempotent) tracked as an external dependency; Siteless's push is built and tested against a contract stub until then.
- **Prior art in danlo's own work:** BIS already has a work queue, review-request automation, brand-name resolver, and a contacts model.

## Constraints

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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Overture + TX Comptroller are the primary, durable enumerators; Places is a transient verifier storing `place_id` + lat/lng (30 d) + a derived boolean | Maps Platform Terms allow caching only `place_id` and lat/lng and forbid building a listings DB; free sources are license-clean and, live-measured, cover more of the RGV than Places can | — Pending (legal read on the derived boolean in parallel) |
| Enterprise field mask on Text Search only; never Place Details per candidate; free IDs-Only SKU for nightly change detection | ~$1.75 vs ~$20 per 1,000 businesses; IDs-Only is free and unlimited | — Pending |
| Weekly rotating Enterprise partitions + nightly free detection instead of a nightly full sweep | A nightly sweep costs $91–261/mo; partitions land at $21–37/mo under the $50 cap | — Pending |
| Verification is budget-gated (pre-filter → top-N → rest `unverified`) | Verification, not discovery, is the expensive per-candidate step | — Pending |
| Six-way verdict including `unverifiable`; `*.business.site` treated as dead and a prime lead | Bot walls otherwise become false positives; ~21.7M GBP sites died in 2024 and the URLs remain in Places data | — Pending |
| Receipts are immutable and separate from a versioned classifier | Re-classifying history costs $0, so thresholds can be tuned against the labelled set without re-crawling | — Pending |
| Yelp Fusion and Meta APIs out of v1; presence detected from web-search URLs + Overture `socials[]` | Yelp terms forbid the persisted DB and blended ratings; Meta offers no consent-free discovery | — Pending |
| Apify / SerpApi skipped | Google-laundered, not independent verification; carries the ToS risk without adding signal | — Pending |
| Vercel Pro for the scheduler (Vercel Cron + Workflow DevKit) | Hobby cron is once a day with ±59 min jitter; pg_cron silently drops ticks; Trigger.dev's tier costs the data budget | — Pending |
| Cost ledger + atomic cap is Phase-1 infrastructure, built before the first billable call | Per-request attribution cannot be retrofitted; three differentiators depend on it | — Pending |
| Hand-triggered vertical slice (one city × one industry) before the scheduler | A nightly crawl producing confident nonsense is worse than no crawl | — Pending |
| False-positive rate = called-lead outcomes + weekly random sample of 20 uncalled | Passive reporting under-counts; a lead nobody calls never gets corrected | — Pending |
| Leads land as tagged contacts under BIS's dogfood account; BIS endpoint is an external dependency with a contract stub | No BIS schema change; existing work queue and reminders apply | — Pending |
| Standalone repo integrating with BIS via API | Sellable on its own; BIS is the first integration target, not the owner | — Pending |
| Discovery-only v1, no sending | Cold outreach carries TCPA/CAN-SPAM exposure; BIS already has channels | — Pending |
| Scheduled runs + phone triage | Matches danlo's actual daily loop | — Pending |
| Multi-tenant-ready schema, single org in v1 | Retrofitting `org_id` touches every table and query | — Pending |
| Geography = city list + county + radius, saved as versioned presets | Matches how danlo targets; Texas-wide is just a bigger preset; versioning keeps "new since last run" honest | — Pending |
| Scoring = reviews/rating + social-only + ticket size + phone as a floor | danlo's definition of a hot lead; an uncallable lead is worth ~0 in a phone-first loop | — Pending |
| Name: Siteless | Exact-match `siteless.com` available; says what it finds | — Pending (not purchased) |
| GSD: YOLO, Standard granularity, all agents on, Quality models | danlo: "don't skimp on agents"; phone-drivable needs few blocking prompts | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-22 after Phase 1 (Foundations & Tenancy) completed and verified 5/5*
