# Requirements: Siteless

**Defined:** 2026-09-20
**Core Value:** A "no website" verdict you can trust enough to pick up the phone — every lead shows why it was classified, and the false-positive rate is measured, not assumed.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases. Success metric: 50 verified no-website leads pushed to BIS and called, with a measured false-positive rate.

### Foundations

- [x] **FOUND-01**: User signs in with Clerk; every request is org-scoped; every table carries `org_id` with RLS policies; v1 runs a single org
- [x] **FOUND-02**: Every `org_id` policy is proven by a test that runs through a user-role connection carrying Clerk claims (session token v2 `o.id` shape), pins SQLSTATE `42501` on the refused statement, and was watched failing first
- [x] **FOUND-03**: Every state change on a lead records actor and timestamp
- [x] **FOUND-04**: `legal_name` (Comptroller DBA), `display_name` (shown on the card), and internal annotations are separate fields; a test asserts the internal annotation never appears in any export or push payload
- [x] **FOUND-05**: Durable fields may only cite durable sources — a database constraint (retention class per source record) prevents Google Places content from being persisted beyond `place_id`, lat/lng and the derived boolean
- [x] **FOUND-06**: All timestamps are `timestamptz`; scheduling, calling windows and "new since last run" logic are computed in `America/Chicago`, with zone and locale pinned in tests

### Search Presets

- [x] **SRCH-01**: User can define a search as one or more industry clusters × a geography (named city list, county, or radius around a geocoded point) and save it as a named preset
- [x] **SRCH-02**: The four industry clusters, the RGV city list, and the four RGV counties ship as seed data; a Texas-wide preset is expressible as a larger preset with a visible cost multiplier
- [x] **SRCH-03**: Presets are versioned — editing creates a new version; past runs keep pointing at the version that produced them
- [x] **SRCH-04**: User sees an estimated cost and estimated result count before saving or running a preset

### Free-Data Spine

- [x] **DATA-01**: System ingests Texas Comptroller active sales-tax permit holders (Socrata `jrea-zgmq`) for the target counties, storing DBA name, outlet address, NAICS code, permit and out-of-business dates, with per-field provenance
- [x] **DATA-02**: System ingests Overture Maps places (`basic_category`, `names`, `addresses`, `websites[]`, `socials[]`, `phones[]`, `confidence`) for the target counties, restricted to the Texas side of the border
- [x] **DATA-03**: Comptroller and Overture records form the durable canonical business record; each field records which source supplied it
- [x] **DATA-04**: Ingest is re-runnable and idempotent; a re-run updates changed rows and reports counts

### Places Verifier

- [x] **PLACE-01**: System queries Google Places API (New) Text Search with a hard-coded field-mask allow-list; a `fieldMaskTier()` function maps fields to SKU tier and refuses unknown fields; Place Details is never called per candidate
- [x] **PLACE-02**: System persists only `place_id` (indefinite), lat/lng (30-day TTL, enforced), and derived signals per business — a `had_website_uri` boolean, a host class computed from `websiteUri` at call time (`none | business_site_dead | social | directory | platform_subdomain | other`; the URL itself is discarded), and the `pureServiceAreaBusiness` flag; every other Places field is discarded after the call (amended by 04-CONTEXT D-09/D-13)
- [x] **PLACE-03**: A search that hits the 60-result ceiling is detected and its tile subdivided; a run reports truncation rather than returning a silent partial
- [x] **PLACE-04**: Enterprise-SKU searches run on rotating weekly partitions of the (cluster × city × type) cell list; nightly change detection uses the free IDs-Only SKU
- [x] **PLACE-05**: Searches include pure service-area businesses (`includePureServiceAreaBusinesses: true`)
- [x] **PLACE-06**: Google Maps attribution requirements are met wherever a Places-derived signal is displayed

### Verification & Receipts

- [ ] **VERIF-01**: Every candidate receives a six-way verdict — `no presence` / `social-only` / `directory-only` / `real site` / `dead or parked` / `unverifiable` — with a confidence level
- [ ] **VERIF-02**: Probes cover DNS resolution, HTTP and HTTPS reachability, redirect chain and final URL, HTTP status, TLS validity and expiry, parked/placeholder-page heuristics, and the dead `*.business.site` cohort
- [ ] **VERIF-03**: Social and directory presence (Facebook, Instagram, Linktree, Yelp, Yellow Pages) is discovered from web search (Firecrawl) and Overture `socials[]`, never from the Yelp or Meta APIs
- [ ] **VERIF-04**: Every probe writes an immutable receipt `{probe_type, target, outcome, status, final_url, observed_at, source, cost}`; absence claims record what was searched (negative evidence)
- [ ] **VERIF-05**: Receipts are visible one tap from the lead card, newest first, with the raw artifact behind a disclosure
- [ ] **VERIF-06**: The classifier is a pure, versioned function over receipts; re-classifying all history with a new version costs no external spend
- [ ] **VERIF-07**: Verification is budget-gated — a cheap pre-filter (phone present, review count, ticket size) ranks candidates, the top-N are verified within the period's budget, and the remainder are labelled `unverified`, never silently dropped
- [ ] **VERIF-08**: `unverifiable` verdicts carry their own retry policy and never enter the triage queue as leads

### Scoring

- [ ] **SCORE-01**: Each lead gets a glass-box score from reviews & rating, social-only presence, industry ticket size, and phone presence — where a missing phone acts as a floor or multiplier, not a small subtraction — and a hot / warm / cold band
- [ ] **SCORE-02**: Score components are persisted on the lead at scoring time so a historical score is reproducible; the breakdown is visible from the card

### Entity Resolution

- [x] **DEDUP-01**: Businesses are resolved into one lead across sources and across overlapping tiles within a run using three tiers: ≥95 auto-merge on trusted identifiers (same `place_id`; exact E.164 phone + same locality), 80–95 human review queue, <80 ignore
- [x] **DEDUP-02**: A merged lead retains all parents with per-field provenance; unmerge exists
- [x] **DEDUP-03**: A stable external lead key survives merges
- [x] **DEDUP-04**: Names, addresses and phones are normalized before matching (case, accents via `unaccent`, suite/unit noise, E.164)

### Scheduling & Runs

- [ ] **SCHED-01**: Saved presets run on a schedule via Vercel Cron + Workflow DevKit; runs are resumable and stop cleanly at the budget cap, leaving a consistent partial result and a recorded reason
- [ ] **SCHED-02**: Run history shows counts, duration, and cost per run
- [ ] **SCHED-03**: A "Net New" view shows leads first seen by this org in this preset; each row carries a change type (`new` / `updated` / `unchanged` / `gone`); unchanged records are not re-verified
- [ ] **SCHED-04**: The UI shows "last swept" per partition cell

### Budget

- [x] **BUDG-01**: Every outbound paid API call writes a cost-ledger row `{provider, sku, units, cost_cents, run_id, lead_id?}` — instrumented before the first billable call
- [x] **BUDG-02**: A monthly cap (default < $50) is enforced by an atomic reserve → spend → true-up operation that refuses at 100% and warns at 80%, gating both enumeration and verification
- [x] **BUDG-03**: A Google Cloud per-API daily quota is configured as an independent second wall
- [x] **BUDG-04**: The dashboard shows month-to-date spend versus the cap, broken down by provider

### Triage

- [ ] **TRI-01**: User can accept, reject with a one-tap reason (already has a site · no phone · out of area · wrong industry · closed · not interested · duplicate · do not contact), or snooze with a resurface date
- [ ] **TRI-02**: Every triage action shows an undo toast for ~5 seconds
- [ ] **TRI-03**: The queue is score-ordered, shows a remaining count, and reaches an explicit end state
- [ ] **TRI-04**: The lead card shows name, category, city, rating and review count, verdict badge, score band, and a phone call-to-action; low-confidence verdicts are visually distinct
- [ ] **TRI-05**: The detail view shows the receipts timeline, score breakdown, per-field provenance, merge history, status history with actor and timestamp, outbound links (Maps, Facebook, Yelp), and notes

### Mobile

- [ ] **MOB-01**: The app is an installable, mobile-first PWA with thumb-zone actions, readable at arm's length
- [ ] **MOB-02**: Triage on a phone is a swipe card stack — right accepts, left rejects (then reason chips), long-press snoozes
- [ ] **MOB-03**: Tap-to-call uses `tel:`, is logged as an activity, and on return prompts for an outcome (connected · voicemail · bad number · has a site · not interested)
- [ ] **MOB-04**: On open, the current queue and its receipts are cached so the morning's triage can be read in a dead zone

### Handoff & Export

- [ ] **HAND-01**: Accepting a lead pushes it to BIS as a contact under BIS's dogfood account, tagged `source:siteless`, industry, city, and score band
- [ ] **HAND-02**: The push is idempotent by the stable lead key — a retry or re-accept updates, never duplicates
- [ ] **HAND-03**: Each lead shows push status (`queued` / `pushed` / `failed` + reason) with a retry action
- [ ] **HAND-04**: Low-confidence verdicts and suppressed leads are never pushed automatically
- [ ] **HAND-05**: User can export leads as CSV with a stable column contract including verdict, confidence, score, and receipt count
- [ ] **HAND-06**: The push is built and tested against a documented contract stub until the BIS inbound-lead endpoint exists (external dependency in `bis-platform`)

### False-Positive Loop

- [ ] **FP-01**: A one-tap "actually has a site" control (card and detail) with a URL field retires the lead, records the URL as ground truth, and counts against the verdict class that produced it
- [ ] **FP-02**: The dashboard shows a measured false-positive rate — false positives over verdicts issued in the window — sourced from every called lead's outcome plus a weekly random sample of 20 uncalled verified leads with a recording flow

### Compliance

- [ ] **COMP-01**: An org-scoped internal do-not-contact list (by phone and by business identity) excludes matches from the queue and from the push, visibly; populated from rejects and manual entry
- [ ] **COMP-02**: The lead card shows local time in `America/Chicago`; the call CTA is greyed outside 8 am–9 pm with an override
- [ ] **COMP-03**: Exports carry per-field provenance
- [ ] **COMP-04**: A short in-product compliance note (discovery tool; sends nothing; consult counsel) is linked from the call CTA

## v2 Requirements

Deferred to a later release. Tracked but not in the current roadmap.

### Discovery & Scheduling

- **SCHED-05**: A business that gains a real site is auto-retired as `no longer qualified`, kept in history
- **SCHED-06**: Morning digest notification after each run (new · hot · spent · remaining)
- **SCHED-07**: Ad-hoc "run now" with a pre-flight cost confirm drawn from a separate small allowance

### Verification

- **VERIF-09**: Receipt age shown; stale verdicts prompt a cheap one-tap re-probe before a call
- **VERIF-10**: Per-verdict-class accuracy table on the dashboard

### Scoring & Dedupe

- **SCORE-03**: Editable score weights with a re-score preview
- **DEDUP-05**: Bilingual (Spanish/English) name-variant handling in the dedupe blocker

### Triage & Mobile

- **MOB-05**: Offline write queue in IndexedDB with idempotent background sync and a visible pending count
- **TRI-06**: Desk keyboard shortcuts (J/K/A/R/S/U)
- **TRI-07**: Bulk select and bulk actions on the desk list

### Handoff

- **HAND-07**: Generic outbound webhook with a documented JSON payload (HubSpot / Pipedrive / GoHighLevel path)
- **HAND-08**: BIS inbound-lead endpoint built as a PR in `bis-platform` (reusing its contact-creation logic, HMAC-signed, idempotent)

### Cost & Compliance

- **BUDG-05**: Cost-per-verified-lead and cost-per-accepted-lead headline numbers
- **COMP-05**: Suppression seeded from Comptroller out-of-business dates
- **COMP-06**: Likely-mobile-number flag (line-type lookup), shown as information

### Later Milestones

- **OUT-01**: AI-drafted outreach copy, human sends
- **OUT-02**: Mock-site preview generation with human review
- **OUT-03**: Outreach sending with full consent plumbing
- **ORG-01**: Multi-tenant billing, invites, roles
- **SCORE-04**: ML scoring after ~200 labelled outcomes

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Sending outreach (email/SMS/calls) in v1 | TCPA / CAN-SPAM exposure; BIS owns channels and consent |
| Yelp Fusion API | Terms forbid caching >24 h, building a listings DB, commercial use without consent, blended ratings; $229/mo floor; no business-website field |
| Meta Pages / Graph API | No consent-free page discovery; Overture `socials[]` + web search instead |
| Apify / SerpApi Google-Maps scraping | Google-laundered, not independent verification; carries Google ToS risk |
| Storing Places content beyond `place_id`, lat/lng (30 d), derived boolean | Maps Platform Terms §3.2.3 |
| Direct Google Maps scraping | ToS |
| Email discovery / contact enrichment | Accuracy ~65%, CAN-SPAM exposure, no-website businesses rarely have a business email |
| SEO / PageSpeed audit reports | Nothing to audit on a no-website business |
| Map view as primary triage surface | Separate billable SKU; territory tool, not triage |
| "Unlimited leads" | Incompatible with a hard cap on a metered API |
| Auto-merge below 95% confidence | Manufactures errors the accuracy metric absorbs |
| National DNC Registry scrubbing | Attaches to telemarketing campaigns; internal list is what applies |
| Native iOS/Android apps | App-store latency breaks the small-commit remote workflow |
| A CRM inside Siteless | BIS is the CRM; two systems of record is the classic disaster |
| Lead marketplace / reselling lists | Destroys lead value; exclusivity is the product |
| Building the websites | The agency's job after conversion |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| SRCH-01 | Phase 2 | Complete |
| SRCH-02 | Phase 2 | Complete |
| SRCH-03 | Phase 2 | Complete |
| SRCH-04 | Phase 2 | Complete |
| BUDG-01 | Phase 2 | Complete |
| BUDG-02 | Phase 2 | Complete |
| BUDG-03 | Phase 4 | Complete |
| BUDG-04 | Phase 2 | Complete |
| DATA-01 | Phase 3 | Complete |
| DATA-02 | Phase 3 | Complete |
| DATA-03 | Phase 3 | Complete |
| DATA-04 | Phase 3 | Complete |
| DEDUP-01 | Phase 3 | Complete |
| DEDUP-02 | Phase 3 | Complete |
| DEDUP-03 | Phase 3 | Complete |
| DEDUP-04 | Phase 3 | Complete |
| PLACE-01 | Phase 4 | Complete |
| PLACE-02 | Phase 4 | Complete |
| PLACE-03 | Phase 4 | Complete |
| PLACE-04 | Phase 4 | Complete |
| PLACE-05 | Phase 4 | Complete |
| PLACE-06 | Phase 4 | Complete |
| VERIF-02 | Phase 5 | Pending |
| VERIF-03 | Phase 5 | Pending |
| VERIF-04 | Phase 5 | Pending |
| VERIF-05 | Phase 5 | Pending |
| VERIF-07 | Phase 5 | Pending |
| VERIF-01 | Phase 6 | Pending |
| VERIF-06 | Phase 6 | Pending |
| VERIF-08 | Phase 6 | Pending |
| SCORE-01 | Phase 6 | Pending |
| SCORE-02 | Phase 6 | Pending |
| TRI-01 | Phase 7 | Pending |
| TRI-02 | Phase 7 | Pending |
| TRI-03 | Phase 7 | Pending |
| TRI-04 | Phase 7 | Pending |
| TRI-05 | Phase 7 | Pending |
| MOB-01 | Phase 7 | Pending |
| MOB-02 | Phase 7 | Pending |
| MOB-03 | Phase 7 | Pending |
| MOB-04 | Phase 7 | Pending |
| COMP-01 | Phase 7 | Pending |
| COMP-02 | Phase 7 | Pending |
| COMP-04 | Phase 7 | Pending |
| FP-01 | Phase 7 | Pending |
| HAND-01 | Phase 8 | Pending |
| HAND-02 | Phase 8 | Pending |
| HAND-03 | Phase 8 | Pending |
| HAND-04 | Phase 8 | Pending |
| HAND-05 | Phase 8 | Pending |
| HAND-06 | Phase 8 | Pending |
| COMP-03 | Phase 8 | Pending |
| SCHED-01 | Phase 9 | Pending |
| SCHED-02 | Phase 9 | Pending |
| SCHED-03 | Phase 9 | Pending |
| SCHED-04 | Phase 9 | Pending |
| FP-02 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 63 total
- Mapped to phases: 63
- Unmapped: 0 ✓

*Count correction (2026-09-20, roadmap creation): this section previously read "57 total". A direct count of REQ-IDs in the v1 section returns 63 (FOUND 6, SRCH 4, DATA 4, PLACE 6, VERIF 8, SCORE 2, DEDUP 4, SCHED 4, BUDG 4, TRI 5, MOB 4, HAND 6, FP 2, COMP 4). No requirements were added or removed — only the counter was wrong.*

---
*Requirements defined: 2026-09-20*
*Last updated: 2026-09-20 after roadmap creation (traceability populated, count corrected 57 → 63)*
