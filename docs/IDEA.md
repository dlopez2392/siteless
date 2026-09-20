# Prospector — kickoff brief

> **Working name.** The product name gets decided in `/gsd-new-project` questioning.
> This file is the handoff from the session that created the repo (2026-09-20).
> Feed it to `/gsd-new-project` as `@docs/IDEA.md`.

## The idea (danlo's words, distilled)

An app that finds small businesses that have **no website**, in a chosen geography (Texas; the Rio Grande Valley first) and chosen industries, and turns them into leads for web/digital work. A **standalone product** — sellable on its own — that also **integrates with the BIS CRM platform** (`C:\Users\danlo\bis-platform`, app.bis-rgv.com).

Danlo also asked for a competitive read: "scour the internet for applications that are similar" — this is a research deliverable, not optional.

## Decisions already made — do not re-ask

| Question | Decision |
|---|---|
| **Data sources** | ALL FOUR, layered: **Google Places API (New)** is the primary detector — absence of `websiteUri` is the signal · **free public data** (TX Comptroller franchise-tax entity list, Overture/OSM POIs, county DBA filings) for enumeration + cross-reference · **scraping services** (Firecrawl — already connected via MCP; SerpApi/Apify optional) for a "search the web for this business" verification pass · **Yelp Fusion + Meta pages** to catch businesses that live only on Yelp/Facebook |
| **Repo** | Standalone repo (this one). Own Supabase + Vercel projects. Integrates with BIS via API/webhook, pushing accepted leads into BIS as contacts. BIS is one integration target among future ones. |
| **v1 scope** | Discovery + enrichment + scoring + review-queue UI + CRM handoff. **No outreach sending in v1** (TCPA / CAN-SPAM exposure). AI-drafted outreach is a later milestone; automated sending later still, with consent plumbing first. |
| **Mobile** | BOTH: (a) the **build** must be drivable from Claude Code mobile / Remote Control — small verifiable commits, no interactive-only steps, all state in `.planning/`; (b) the **product** is mobile-first — triage and approve leads from the field (tap-to-call, swipe-to-qualify, offline-tolerant). |
| **Methodology** | GSD (get-shit-done), **not** superpowers. Max out parallel agents at every stage — research, design, dev, security, review. Don't skimp on agent count or roles. |
| **Design** | World-class UI/UX is a first-class requirement, not a polish pass. `/gsd-ui-phase` on every frontend phase. |

## Why "no website" is the signal — and why it's subtle

- Places API returns `websiteUri`; its absence is the primary detector. But a business can have a Facebook page, a Yelp page, a Linktree, or a Google-Business-Profile-only presence — those are the **hottest** leads (they've proven they want to be found online and have no real site). The verification pass must classify each business: `no web presence` / `social-only` / `directory-only` / `has real site` / `has dead or parked site`.
- Dead, parked, or template-placeholder domains count as "no website" for lead purposes.
- False positives (Places simply lacked the URL) burn outreach credibility. The verification pass is what makes the product trustworthy — it is the differentiator, not the crawl.

## Integrations & keys danlo must provide

| Service | Needed for | Status |
|---|---|---|
| Google Cloud project + **Places API (New)** key, billing enabled | primary detector | NOT YET — danlo creates |
| **Firecrawl** API key | verification search / scrape from the app itself | Connected to Claude via MCP; a keyed connector appears present (`firecrawl_map` / `firecrawl_agent` / `firecrawl_crawl` are exposed) — confirm, and get a key the app can use |
| **Yelp Fusion** | Yelp-only businesses | NOT YET — paid tiers since 2024; research decides |
| **SerpApi / Apify** | optional Google Maps scraping | NOT YET — research decides if needed at all |
| **Supabase** (new project) | app database | NOT YET — do NOT reuse BIS's `tlbkbmlrfafquucsmsmm` (shared with BIS e2e) |
| **Vercel** (new project) | hosting | NOT YET |
| **Clerk** | auth — BIS uses Clerk; reuse the pattern | NOT YET |
| **BIS inbound-lead endpoint** | lead handoff | BIS side likely needs a new API route — check `apps/web` for existing contact-creation logic |

## Constraints & gotchas carried over from BIS work

- 🔴 Places API is the ToS-legal primary path. Scraping services are secondary / verification only.
- 🔴 In BIS, `accounts.name` is the agency's INTERNAL label and escaped to customers three times. Separate internal labels from customer-facing names from day 1.
- 🔴 Painted values, never CSS custom properties, for anything a test pins. Tailwind v4: `[var(--x)]`, not `[--x]`.
- 🔴 A `"use client"` module's exports are client references inside a server component — even plain data objects.
- Timezone: RGV is `America/Chicago`. Pin zone **and** locale in tests.
- PR-only workflow once CI exists; merge only on green for the current head.

## Process expectations for the relaunched session

1. `/gsd-new-project` — config: commit docs **Yes**; research before planning **Yes**; models per danlo's preference.
2. Deep questioning must cover: product name · **target industries for v1** (danlo said "certain industries" — get the list; likely trades/services: roofing, HVAC, plumbing, landscaping, auto repair, restaurants, salons, cleaning, etc.) · RGV city list (McAllen, Edinburg, Mission, Pharr, Brownsville, Harlingen, Weslaco, San Juan, Alamo, Donna, Mercedes, La Feria, Rio Grande City, Roma, Raymondville, Port Isabel, South Padre Island…) · lead-scoring criteria · who the users are (danlo solo? BIS sales staff? other agencies?) · tenancy (single-tenant for BIS first, or multi-tenant from day 1 since it's a standalone product?).
3. Research fan-out: 4 `gsd-project-researcher` agents in parallel (stack, features, architecture, pitfalls). **Features research must include the competitive landscape** — tools that already find businesses without websites. Starting points to verify: D7 Lead Finder, Outscraper, LeadSwift, ScrapeHero, Ocean.io, Apollo, Clay, Instantly's lead finder, Google-Maps-scraper style Apify actors — what they charge, what they miss, and what an agency in the RGV would actually pay for.
4. Roadmap → `/gsd-ui-phase` on every frontend phase; `/gsd-secure-phase` on the crawler/ingest and BIS-integration phases; `/gsd-code-review` before every ship.
