# Siteless

## What This Is

Siteless finds small businesses that have **no website** — starting in the Rio Grande Valley and scaling to Texas — across four industry clusters: home services & trades, food & hospitality, personal care & health, and auto & retail. It runs saved searches on a nightly schedule, verifies every "no website" verdict with receipts, scores each lead by how hot it is, and lets danlo and the BIS team triage leads from a phone. Accepted leads land in the BIS CRM as tagged contacts. It is a standalone product with a multi-tenant-ready core; BIS is its first integration, not its owner.

## Core Value

A "no website" verdict you can trust enough to pick up the phone — every lead shows *why* it was classified, and the false-positive rate is measured, not assumed.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can define a search as industry cluster(s) × geography (named city list, county, or radius around a point) and save it as a reusable preset; RGV presets ship built-in, Texas-wide is just a larger preset
- [ ] System ingests businesses for a search from Google Places API (New) and flags those with no `websiteUri` as candidates
- [ ] System cross-references free public data (TX Comptroller active-entity list, Overture/OSM POIs, county DBA filings) to surface businesses Places misses and to corroborate name/address/phone
- [ ] System verifies each candidate's web presence and classifies it as one of: `no presence` / `social-only` (Facebook, Instagram, Linktree) / `directory-only` (Yelp, GBP-only, Yellow Pages) / `real site` / `dead or parked site`
- [ ] Every classification carries receipts — what was searched, what was found (URLs, social pages, domain probe result), and when — visible one tap from the lead
- [ ] System detects Yelp-only and Facebook/Instagram-only businesses as a distinct, high-priority class
- [ ] System scores each lead from: reviews & rating (active, real customers), social-only presence (wants to be found, chose the free option), industry ticket size (a roofer's job ≠ a taco plate), and phone presence/reachability (no phone sinks the score)
- [ ] System dedupes the same business across sources (Places + Yelp + Comptroller + OSM) into one lead
- [ ] Saved searches re-run on a schedule (nightly by default) with a hard monthly data-cost cap (< $50/mo to start) enforced by the scheduler; the dashboard shows cost-per-verified-lead
- [ ] User can triage new leads on a phone: accept / reject / snooze, tap-to-call, receipts one tap away, tolerant of a bad connection
- [ ] User has a desk view for setup, saved searches, deep dives on a lead, and the dashboard
- [ ] Accepting a lead pushes it to BIS as a contact under BIS's own dogfood account, tagged `source:siteless`, industry, city, and score, via an inbound-lead endpoint on the BIS side
- [ ] User can mark a lead "actually has a site" (false positive) and the system tracks the false-positive rate over time
- [ ] Auth is org-scoped (Clerk, mirroring BIS); every table carries `org_id`; v1 runs a single org (danlo + BIS team)

### Out of Scope

- Sending outreach (email, SMS, calls) — TCPA / CAN-SPAM exposure; v1 hands off to BIS where channels already exist
- AI-drafted outreach and mock-site previews — a later milestone, human still sends
- Automated sequences / suppression lists / unsubscribe plumbing — only with consent infrastructure, later still
- Multi-tenant billing, org invites, plan limits — schema is org-scoped from day 1, but only one org exists in v1
- Building the websites — that is the agency's job once the lead converts
- Scraping Google Maps directly — Google ToS; Places API is the legal primary, scraping services are verification-only
- Native iOS/Android apps — mobile-first web (installable PWA) is v1
- Yelp Fusion paid tier and SerpApi/Apify — only if research shows they add coverage worth the budget

## Context

- **Who and why:** danlo runs **BIS** (app.bis-rgv.com), a CRM / booking / review-request platform for local service businesses in the RGV — monorepo at `C:\Users\danlo\bis-platform` (Next.js, Supabase, Clerk, Vercel, Telnyx SMS, GitHub Actions CI). A business with no website is BIS's ideal customer. Siteless replaces "driving around looking for businesses without a site" with a system.
- **Success for v1:** 50 verified no-website leads pushed to BIS and called, with a measured false-positive rate (spot-check: how many actually had a real site?).
- **The daily loop:** nightly saved searches → morning phone triage → accepted → BIS. The desk is for setup and deep dives.
- **Verification is the product, not the crawl.** Places lacking a URL ≠ no website. A business with a Facebook page and 200 reviews and no site is the hottest lead there is; a business Places simply didn't have a URL for is a false positive that burns credibility on the call.
- **Competitive read requested:** danlo asked for a survey of tools that already do this — starting points to verify: D7 Lead Finder, Outscraper, LeadSwift, ScrapeHero, Ocean.io, Apollo, Clay, Instantly's lead finder, Apify Google-Maps actors — what they charge, what they miss, what an RGV agency would actually pay for. This is a research deliverable.
- **Tooling already in hand:** Firecrawl is connected to Claude via MCP (a keyed connector appears present); the app itself needs its own Firecrawl key.
- **Remote Control:** the build must be drivable from Claude Code mobile — small verifiable commits, no interactive-only steps, all state in `.planning/`, phases that can be picked up mid-flight.
- **Name:** Siteless. `siteless.com` was available as an exact-match .com on 2026-09-20 — **not purchased**; nothing is bought until danlo says so. The repo directory is still `prospector`.
- **Prior art in danlo's own work:** BIS already has a work queue, review-request automation, brand-name resolver, and a contacts model — the BIS-side inbound-lead endpoint should reuse its contact-creation logic.

## Constraints

- **Legal**: Google Places API (New) is the ToS-legal primary source — scraping services are secondary / verification only; no direct Google Maps scraping
- **Legal**: No outreach sending in v1 — TCPA (calls/SMS) and CAN-SPAM (email) exposure; consent plumbing precedes any future sending
- **Budget**: < $50/month data spend (Places + Firecrawl + any Yelp/SerpApi) — the scheduler enforces this as a hard cap, not a warning
- **Tech stack**: standalone repo; own Supabase project (never BIS's `tlbkbmlrfafquucsmsmm`, which is shared with BIS e2e) and own Vercel project; Clerk auth mirroring BIS's pattern; TypeScript / Next.js expected — research confirms
- **Data**: multi-tenant-ready — every table carries `org_id` from the first migration, even though v1 has one org
- **Design**: world-class UI/UX is a first-class requirement — `/gsd-ui-phase` on every frontend phase; mobile-first, desk second
- **Timezone**: RGV is `America/Chicago` — tests pin zone **and** locale
- **Carried-over gotchas (BIS)**: keep internal labels separate from customer-facing names from day 1; painted values not CSS custom properties for anything a test pins; Tailwind v4 uses `[var(--x)]` not `[--x]`; a `"use client"` module's exports are client references inside a server component
- **Process**: GSD methodology, not superpowers; maximal parallel agents at every stage; PR-only once CI exists; no autonomous merges — danlo reviews before merge
- **Dependencies not yet created**: Google Cloud project + Places API key with billing, Firecrawl app key, Supabase project, Vercel project, Clerk app; BIS-side inbound-lead endpoint

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Four layered data sources with Places API as primary | Legal + highest-signal detector; free data fills enumeration gaps; scraping/Yelp/Meta catch social-only businesses | — Pending |
| Standalone repo integrating with BIS via API | Sellable on its own; BIS is the first integration target, not the owner | — Pending |
| Discovery-only v1, no sending | Cold outreach carries TCPA/CAN-SPAM exposure; BIS already has channels | — Pending |
| Scheduled nightly crawl + phone triage | Matches danlo's actual daily loop | — Pending |
| Verdict + receipts on every lead | Trust is earned per lead; false positives burn credibility on the call | — Pending |
| Leads land as tagged contacts under BIS's dogfood account | No BIS schema change; existing work queue and reminders apply | — Pending |
| Multi-tenant-ready schema, single org in v1 | Retrofitting `org_id` touches every table and query | — Pending |
| Geography = city list + county + radius, saved as presets | Matches how danlo targets; Texas-wide is just a bigger preset | — Pending |
| Scoring = reviews/rating + social-only + ticket size + phone reachability | danlo's definition of a hot lead | — Pending |
| Hard $50/mo data cap enforced by the scheduler | Nightly crawls across four clusters must not run away | — Pending |
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
*Last updated: 2026-09-20 after initialization*
