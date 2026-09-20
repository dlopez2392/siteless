# Feature Research

**Domain:** Local-business lead discovery / agency prospecting SaaS ("find businesses with no website")
**Researched:** 2026-09-20
**Confidence:** MEDIUM-HIGH (feature taxonomy HIGH from vendor pages + platform docs; pricing/compliance detail MEDIUM; user-behavior claims MEDIUM)

> A separate `COMPETITORS.md` covers vendors in depth. This file is the **feature taxonomy and expected behaviors**; vendors are cited only as evidence that a behavior is expected, novel, or a trap.

---

## The one thing that matters

Every tool in this niche already has "filter: no website." D7 Lead Finder has it. Outscraper has an
explicit "Ignore businesses with websites" advanced filter. Every $15/mo micro-SaaS
(LeadsByLocation, Site Finder, Lead Scouter, Grape Leads, Thyonix, LocalLead, Targetron) leads its
homepage with it. **The filter is not the product and never was.**

The competitive frame is stated most bluntly by LeadsByLocation's own comparison page:
*"D7 gives you the list. LeadsByLocation tells you who on that list actually needs your help."*
That is the whole market moving from **enumeration** to **qualification**.

Siteless's stated core value — *a verdict you can trust enough to pick up the phone, with a
**measured** false-positive rate* — sits one step past where the market currently is. Nobody in this
space publishes an accuracy number. Reported accuracy for the big B2B data vendors clusters at
65–80%, and neither Apollo nor ZoomInfo ships a documented "report bad data → measured accuracy
rate" loop. **Measured accuracy is the differentiator. The crawl is table stakes.**

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these and the product feels like a demo. None of them win a deal.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Search = industry × geography** (category picker + named city list / county / radius-around-point) | Universal across every tool surveyed; "enter a keyword and a city" is the genre's default gesture | LOW | Radius needs a geocoded center + meters. County needs a city→county mapping table (TX: 4 RGV counties, 254 statewide). Ship RGV + Texas presets seeded. |
| **Saved search presets, named and re-runnable** | Apollo, LinkedIn SalesNav, every scraper with a scheduler. Re-typing a 14-city list is a non-starter | LOW | Preset = `{clusters[], geography, filters, schedule, budget}`. Versioned — editing a preset must not silently rewrite history of past runs. |
| **Candidate list with sort + filter** (score, city, industry, rating, review count, status) | Nobody triages an unsorted list of 1,200 rows | LOW | Server-side sort/filter; the phone list must paginate, not infinite-scroll-with-no-anchor. |
| **Lead card with the call-ready facts** (name, category, city, phone, rating, review count, verdict, score) | This is the artifact the user acts on. Site Finder's card is literally `name · 4.8★ · 214 reviews · No website` | LOW | Card must be readable at arm's length on a phone in a truck. Phone number is the primary CTA, not an afterthought. |
| **Lead detail view** (all fields, sources, receipts, history, notes) | Desk-side deep dive before a call | MEDIUM | Detail = card + evidence timeline + source attribution + status history. |
| **Web-presence verdict, not a boolean** (`no presence` / `social-only` / `directory-only` / `real site` / `dead or parked`) | A boolean is what burns the call. LeadSwift already flags "missing websites, broken pages, incomplete social presence" as distinct signals | HIGH | The core algorithm. See §C. |
| **Dedupe across sources into one lead** | The single loudest complaint about Google Maps scrapers: "return everything every time… CRM fills with duplicates" | HIGH | See §E. Must dedupe *within* a run (overlapping radii) and *across* runs. |
| **Accept / reject / snooze triage with persisted status** | Without it the user re-reads the same 300 rows tomorrow | LOW | Status is per-org, per-lead, timestamped, with actor. |
| **Tap-to-call from the lead** | The entire point of a phone-first triage app | LOW | `tel:` link. Log the tap as an activity — that is the only call evidence you get. |
| **CSV export** | Every single competitor ships it; its absence reads as "this is a toy" | LOW | Stable column contract. Export must carry the verdict and the score, not just NAP. |
| **CRM handoff on accept** (BIS contact, tagged) | The accepted lead has to land *somewhere*; otherwise triage produces nothing | MEDIUM | See §J. Idempotent by external key. |
| **Scheduled re-run of saved searches** | "One-time scrape goes stale within a quarter" is the accepted wisdom in the niche | MEDIUM | Nightly cron. Must be resumable and must respect the budget cap mid-run. |
| **"New since last run"** | Apollo ships a **Net New** tab. Apify's monitoring actor ships `changeType`. Users expect a fresh-only view | MEDIUM | Depends on dedupe + run history. See §F. |
| **Auth, org scoping, session on mobile** | Baseline | LOW | Clerk, mirroring BIS. Every table `org_id` from migration 0001. |
| **Cost visibility** (spend this month vs cap) | You are metering a paid API against a $50 ceiling; flying blind is not an option | MEDIUM | See §K. |

### Differentiators (Competitive Advantage)

Ranked by how much separation they create against the surveyed field.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Receipts: per-lead evidence record, one tap from the card** | The trust mechanism. "What was searched, what was found, when" — nobody in this niche shows their work; Clay's waterfall (visible provider columns + validation status) is the closest analogue and it's in a different market | MEDIUM | Append-only `evidence` rows: `{probe_type, target, result, status_code, observed_at, source, cost_cents}`. Render as a timeline with the raw artifact behind a disclosure. **This is the feature that makes the phone call possible.** |
| **Measured false-positive rate, displayed** | "Actually has a site" feedback → a number on the dashboard that trends. No competitor publishes accuracy; the category's reputation is 65–80% and unmeasured | MEDIUM | Needs the feedback control (§L) + a denominator (verdicts issued) + a time series. Also the *only* honest way to tune verification thresholds. |
| **Dead-GBP-site detection (`business.site`, parked, placeholder, expired SSL)** | Google shut down ~21.7M Business Profile websites on 2024-03-01; redirects were only guaranteed through 2024-06-10; an estimated 30% of US small businesses had used the builder. Those `websiteUri` values are still in Places data and are now dead links | MEDIUM | A business whose only "website" is a dead `business.site` URL is a *better* lead than one with no URL at all — it proves they wanted a site and lost it. High-yield, specific, checkable. Site Finder already does generic parked-page detection; the `business.site` cohort specifically is under-exploited. |
| **Social-only / directory-only as a named high-priority class** | PROJECT.md's own thesis: FB page + 200 reviews + no site = the hottest lead. Competitors collapse this into "no website" or miss it entirely | MEDIUM | Requires the verification pass to *find* the FB/IG/Linktree/Yelp page, not just fail to find a domain. Absence of evidence ≠ evidence of absence. |
| **Glass-box score with a visible breakdown** | "When a model produces a score like 87 without explanation, sales teams ignore it." Best practice is an explanation card: `+15 rating/reviews · +25 social-only · +20 ticket size · −30 no phone` | LOW-MEDIUM | Deterministic weighted rules, not ML. v1 needs zero training data. Store the component values *with the lead* so a historical score is reproducible after the weights change. |
| **Score weights editable by the user, with re-score preview** | Glass-box goes one better than explainable: it "lets a person correct that decision." danlo's definition of hot will change after 50 calls | MEDIUM | Depends on stored components. Show "this change moves 42 leads across the hot threshold" before committing. |
| **Hard budget cap enforced by the scheduler** (not a warning) | Places (New) bills `websiteUri`/`rating`/`userRatingCount`/`nationalPhoneNumber` at the **Enterprise** SKU — Text Search Enterprise is $35/1,000 with only 1,000 free calls/mo. A runaway nightly crawl across 4 clusters × 17 cities eats $50 fast | MEDIUM | Pre-flight estimate → reserve → spend-with-ledger → refuse. See §K. **Competitors sell you credits; nobody protects you from yourself.** |
| **Cost-per-verified-lead on the dashboard** | Turns the budget from an anxiety into a unit economic. Directly supports "is this worth running Texas-wide?" | MEDIUM | Needs per-call cost attribution on every API request. Cheap if instrumented from day 1, near-impossible to retrofit. |
| **Phone-first triage: swipe accept/reject, thumb-reachable, one-tap receipts** | The stated daily loop is *morning phone triage*. Every competitor is a desktop CSV pipeline; SPOTIO-class field CRMs have the mobile ergonomics but no "no website" discovery | MEDIUM | Swipe right = accept, left = reject, down/long-press = snooze. Undo toast on every action (swipes misfire). Card stack, not a table. |
| **Offline-tolerant triage with a replayed action queue** | RGV fieldwork has dead zones; SPOTIO ships "Download My Day" for exactly this | MEDIUM-HIGH | IndexedDB queue + service worker background sync; local optimistic status, server reconciliation on reconnect. Conflict rule: last-write-wins per lead is fine here (single-user triage), but the queue must be idempotent. |
| **Change detection on re-run** (business gained a website → auto-retire the lead; rating/phone changed → flag) | Apify's monitoring actor sells `detectUpdates` + `updateFields` + `changeType` as its headline. Also prevents the worst call: pitching a site to someone who built one last month | MEDIUM | Depends on run history + stable entity IDs. A lead that gains a real site should close as `no longer qualified`, not silently vanish. |
| **Coverage cross-check from free sources** (TX Comptroller, OSM/Overture, county DBA) | Places' 60-result pagination ceiling per search means dense categories get truncated. Free enumeration finds what Places silently omits — and corroborates NAP for free | HIGH | High effort, real payoff for a Texas-wide claim. Strong candidate for a later phase, not v1 day 1. |
| **Verification budget gating** (only verify candidates that pass a cheap pre-filter) | Enumeration is cheap per-row (20 places per billed Text Search call); *verification* is per-candidate and is the actual cost driver | MEDIUM | Rank candidates by cheap signals first (has phone, review count > n, category ticket size), verify top-N within budget, leave the rest `unverified` and honestly labelled. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Bundled cold-email / SMS sending** | LeadSwift, Instantly and most of the field bundle sequences; it "completes the loop" | TCPA + CAN-SPAM exposure with zero consent infrastructure; state mini-TCPA laws (FL, OK, MD, WA, NJ) carry $500–$20,000 per violation; and the moment you send, you inherit suppression lists, unsubscribe plumbing, bounce handling, domain reputation and a deliverability support burden. Explicitly out of scope in PROJECT.md | Hand off to BIS, which already owns channels and consent. Siteless's job ends at "here is a lead you can trust." |
| **Email discovery / contact enrichment (find the owner's email)** | Everyone asks; it's the default "enrichment" in this category | It is precisely where competitor accuracy collapses to ~65%, it invites CAN-SPAM, and for a business with **no website** there is usually no discoverable business email anyway — you'd be scraping Facebook. Cost per hit is real and the hit rate is bad | Phone-first. A business with a phone and 200 reviews is called, not emailed. Revisit only if call-connect rates disappoint. |
| **AI-generated mock site / instant website preview** | Site Finder and Lead Scouter both lead with it; it demos beautifully and is a genuinely good pitch prop | Doubles the surface area of v1, adds an LLM cost line under a $50 cap, and produces an artifact whose quality reflects on the agency before any human reviews it. PROJECT.md already defers it | Later milestone, gated on a human reviewing each generated preview before it leaves the building. |
| **Full SEO / PageSpeed / schema audit reports** | LeadsByLocation and LeadSwift both ship PDF audits with PageSpeed, SSL, schema | For a business with **no website there is nothing to audit**. It's a feature for the adjacent market (bad-website leads), not this one. Shipping it blurs the product's one sentence | Only for the `dead or parked site` class, and only as a receipt line ("domain resolves, returns 404, cert expired 2023-11"), not a PDF. |
| **Map view with pins as the primary triage surface** | Field-sales intuition; SPOTIO-shaped | Maps JS is a separate billable SKU, and a map is a *territory-planning* surface, not a triage surface — triage is one-decision-at-a-time. It also fights the offline requirement | Card stack for triage; add a read-only map to the desk view later, if at all. City/cluster grouping covers 90% of the need. |
| **"Unlimited leads" / credit-free scraping mode** | The genre's favorite marketing claim (Lead Scouter: "Agency — unlimited") | Structurally incompatible with a hard $50/mo cap on a metered API. Promising it means either eating cost or silently degrading data | Publish the cap. Show the burn. "2,400 verified leads/month at current settings" is a more honest and more useful number. |
| **On-demand "search anything, right now" free-text crawl** | Feels fast and powerful | Unbounded cost per keystroke; the cap gets consumed by exploration instead of the nightly loop | Pre-flight cost estimate + confirm for any ad-hoc run, drawn from the same ledger as scheduled runs. Small ad-hoc allowance, hard-separated. |
| **Auto-merge of duplicates at any confidence** | "Just clean it up for me" | An over-eager merge destroys a distinct business (two taquerias, same family, same phone) and is usually unrecoverable. CRM practice is explicit: **≥95 auto-merge, 80–95 human review queue, <80 ignore** | Three-tier routing with a visible review queue and an **unmerge** action. Never merge on name similarity alone. |
| **Multi-tenant billing, org invites, plan limits** | It's a "standalone sellable product" | v1 has one org. Building billing before a single lead converts is pure speculation | `org_id` on every table from migration 0001 (already decided). Billing when a second org exists. |
| **Native iOS/Android apps** | "Field app" instinct | App-store review latency destroys the small-verifiable-commits remote-control workflow; a PWA gets `tel:`, offline, and install-to-home-screen | Installable PWA, mobile-first. Already decided. |
| **A full CRM inside Siteless** (pipelines, deals, activities, email threads) | Natural scope creep once leads exist | BIS *is* the CRM. Two systems of record for the same contact is the classic disaster | Push on accept, link back to BIS, keep exactly one field here: triage status. |
| **Selling the same lead list to multiple agencies / a lead marketplace** | Obvious monetization | Destroys the value of the lead for the buyer; also the reason D7-class output feels worthless (everyone has the same rows) | Per-org discovery and per-org triage state. Exclusivity is the product. |
| **Scraping Google Maps directly** | Cheaper than Places API | ToS violation; PROJECT.md constraint | Places API (New) is primary; scraping services are verification-only on the open web. |

---

## Feature Taxonomy by Domain

Detail behind the tables above — the **expected behaviors** for each dimension in the brief.

### §A. Search definition

- **Table stakes:** industry cluster multi-select (4 clusters → mapped to Places `includedTypes` + text queries); geography as **named city list** (RGV's 17), **county** (Hidalgo, Cameron, Willacy, Starr), or **radius around a point** (address/geocode + meters); save as a named preset; duplicate-a-preset.
- **Expected behavior:** a preset is a *specification*, and a run is an *execution of that spec at a point in time*. Editing a preset creates a new version; old runs keep pointing at the version that produced them. Without this, "new since last run" becomes meaningless the first time danlo adds a city.
- **Expected behavior:** show an **estimated cost and estimated result count before saving/running** (Places bills per request; a 17-city × 4-cluster expansion is 68 query legs before pagination).
- **Differentiator:** built-in RGV presets shipped as seed data; "Texas-wide" as literally a bigger preset with a visible cost multiplier.
- **Complexity:** LOW (LOW-MEDIUM with cost estimation). **Depends on:** nothing. **Blocks:** everything.

### §B. Ingest / candidate generation

- **Table stakes:** Places API (New) Text Search / Nearby Search with an explicit field mask; `websiteUri` absent → candidate. Per-run provenance on every row.
- **Expected behavior:** the **60-result pagination ceiling** per search is a hard constraint — dense categories in McAllen will truncate. The product must *know* it truncated and say so ("this query hit the ceiling; narrow the radius or split the category"), not silently return a partial city.
- **Expected behavior:** field mask is a **cost decision**. `websiteUri`, `rating`, `userRatingCount`, `nationalPhoneNumber` are all **Enterprise-SKU** fields; you are billed at the highest SKU in the mask. Adding `reviews` to the mask silently promotes every call to Enterprise + Atmosphere ($40/1k on Text Search). The field mask belongs in code review, not in a config file someone edits casually.
- **Differentiator (later phase):** free-source enumeration (TX Comptroller active entities, OSM/Overture POIs, county DBA) to find what Places omits and to corroborate NAP at zero marginal cost.
- **Complexity:** MEDIUM (Places) / HIGH (free sources). **Depends on:** §A. **Blocks:** §C, §E.

### §C. Web-presence verification + receipts

This is the product. Everything else is plumbing.

- **Table stakes:** classify into the five-way verdict. Do **not** ship a boolean.
- **Expected probes** (Site Finder's public feature list is a good floor, and it's a $20/mo tool — treat it as the bar, not the ceiling): DNS resolution; HTTP **and** HTTPS reachability; final URL after redirects; HTTP status; SSL validity / expired-certificate detection; parked-page and placeholder detection; `business.site` and known-builder-shutdown domains; social/directory profile discovery (Facebook, Instagram, Linktree, Yelp, YellowPages).
- **Expected behavior — the receipt record.** Every verdict carries an append-only evidence trail, each row: `{probe_type, target, outcome, http_status | dns_result, final_url, observed_at, source, cost_cents}`. Rendered as a timeline, newest first, with the raw artifact behind a disclosure. Reachable in **one tap** from the card.
- **Expected behavior — negative evidence is evidence.** "Searched `"Joe's Taqueria" McAllen TX site`, 0 results matching NAP" is a receipt. Absence claims must record *what was searched*, or the verdict is unfalsifiable.
- **Expected behavior — confidence, not certainty.** Site Finder pairs its 0–100 presence score with a **confidence percentage**. Do the same: a verdict from 4 agreeing probes ≠ a verdict from 1 timed-out probe. Low-confidence verdicts should be visually distinct and should *not* be auto-pushed to BIS.
- **Expected behavior — staleness.** A receipt has an age. A verdict older than N days on a lead you're about to call should prompt a re-verify (cheap: re-probe the domain, don't re-run the search).
- **Anti-feature:** an LLM "agent" that reads the web and asserts a verdict with no structured probe trail. Unfalsifiable, unpriceable, and it is exactly the thing the receipts exist to prevent.
- **Complexity:** HIGH. **Depends on:** §B. **Blocks:** §D, §L, and the entire value proposition.

### §D. Lead scoring

- **Table stakes:** a single ordinal score plus a hot/warm/cold band (Lead Scouter's "Hot / Warm / Cold instant grading" is the genre default), sortable, filterable.
- **Expected behavior — glass box.** The card shows the number; one tap shows the arithmetic: `reviews & rating +25 · social-only +20 · ticket size +15 · phone reachable +10 · low-confidence verdict −15 = 55`. Publish the weights.
- **Expected behavior — persisted components.** Store each component's value on the lead at scoring time. Otherwise changing a weight silently rewrites history and you can never answer "did the hot leads actually convert better?"
- **Expected behavior — the phone gate.** PROJECT.md: no phone sinks the score. Make it a *multiplier or floor*, not a small subtraction — an uncallable lead is worth ~0 in a phone-first loop, regardless of its other signals.
- **Differentiator:** editable weights with a **re-score preview** ("42 leads cross the hot threshold").
- **Anti-feature:** ML/predictive scoring in v1. Zero labelled outcomes exist. Revisit after ~200 called leads with recorded outcomes.
- **Complexity:** LOW-MEDIUM. **Depends on:** §C (verdict + confidence are inputs). **Enhanced by:** §L (outcome feedback).

### §E. Dedupe / entity resolution

- **Table stakes:** one business = one lead, across Places + Yelp + Comptroller + OSM, and across overlapping radii within a single run. The #1 documented complaint about this tool category is CRM fill with duplicates and "already called" leads.
- **Expected behavior — three-tier routing** (standard CRM practice, and the right default here): **auto-merge** on a trusted identifier match (same Places `id`; or exact normalized phone + same locality); **review queue** on fuzzy agreement (similar name + same phone, or same normalized address + similar name); **ignore** on name-only similarity. Published thresholds roughly ≥95 / 80–95 / <80.
- **Expected behavior — the merged lead keeps all its parents.** Source attribution per field ("phone from Places, entity name from Comptroller"), and **unmerge** must exist. A merge is a hypothesis, not a fact.
- **Expected behavior — stable external key.** The key you push to BIS must survive a merge, or the same business lands twice in the CRM and you've exported your dedupe failure into someone else's system.
- **Watch out (RGV-specific):** heavy name collision (`Taquería Jalisco`, `El Paisano`), Spanish/English name variants, suite-less addresses, shared family phone numbers across two businesses, and `#` vs `Ste` vs nothing in address lines. Normalize aggressively; merge conservatively.
- **Complexity:** HIGH. **Depends on:** §B. **Blocks:** §F (change detection is meaningless without stable identity), §J.

### §F. Saved searches, scheduling, "new since last run"

- **Table stakes:** nightly schedule per preset; run history with counts and cost; a **Net New** view. Apollo ships exactly this (saved search + daily/weekly/monthly subscription alerts + a "Net New" tab of prospects added since your last search) — it is a known, expected shape.
- **Expected behavior — precise semantics.** "New" means *first seen by this org in this preset*, not "returned by the API today." Define and display it, because the two diverge constantly.
- **Expected behavior — differential runs.** Keep a baseline snapshot keyed by preset; compare, and emit a `changeType` per row: `new` / `updated` / `unchanged` / `gone`. The best-in-class Apify monitoring actor does exactly this (`stateKey` baseline, `dedupeStrategy`, `detectUpdates` + `updateFields`, `changeType` in output) **and skips billing for unchanged records in incremental mode**. Copy that: unchanged records should not be re-verified, and that is where the budget is saved.
- **Expected behavior — the "they got a website" event.** Highest-value change of all. Auto-retire the lead as `no longer qualified`, keep it visible in history, never silently delete. Prevents the worst possible call.
- **Expected behavior — resumable, budget-aware runs.** A run that hits the cap at 03:14 stops cleanly, records why, and leaves a partial-but-consistent result set. Never a half-written lead.
- **Expected behavior — a morning digest.** One notification: "Run complete · 38 new · 12 hot · $1.40 spent · $37.20 left this month."
- **Complexity:** MEDIUM. **Depends on:** §A, §E, §K.

### §G. Triage workflow

- **Table stakes:** accept / reject / snooze, bulk select + bulk action, status filter, undo.
- **Expected behavior — reject needs a reason** (picklist: already has a site · no phone · out of area · wrong industry · closed · not interested · duplicate). Rejection reasons are the cheapest tuning data the product will ever get, and "already has a site" *is* the false-positive signal (§L). Make it one tap, never free text only.
- **Expected behavior — snooze resurfaces.** Pick a date (tomorrow / 1 week / 1 month / custom), the lead leaves the queue and comes back. Kondo's model (`H` to snooze, resurface tomorrow / in three days / specific date) is the reference shape.
- **Expected behavior — queue discipline.** Triage works from a *queue* with a visible remaining count and an end state ("Inbox zero: 38 triaged, 12 accepted"). A list you can't finish is a list you stop opening.
- **Differentiator (desk):** keyboard shortcuts — `J/K` navigate, `A` accept, `R` reject, `S` snooze, `U` undo. Kondo's whole pitch is that shortcut-driven triage collapses processing time. Near-free to build, disproportionately loved.
- **Complexity:** LOW (MEDIUM with bulk + undo semantics). **Depends on:** lead list. **Blocks:** §J.

### §H. Mobile usage patterns

- **Table stakes:** mobile-first responsive PWA, installable, `tel:` tap-to-call, thumb-zone actions, readable at arm's length.
- **Expected behavior — swipe triage.** Card stack; right = accept, left = reject (then reason chips), long-press/down = snooze. **Every swipe gets an undo toast** for ~5s — misfires are constant and an un-undoable reject destroys trust in the gesture immediately.
- **Expected behavior — offline tolerance.** Service worker + IndexedDB queue + background sync; the canonical offline-first PWA stack. Triage actions queue locally, apply optimistically, and replay idempotently on reconnect. Show a clear "3 actions pending sync" affordance — never a silent queue.
- **Expected behavior — prefetch the day.** SPOTIO's "Download My Day" is the right primitive: on open (online), cache the current queue + receipts so the whole morning's triage works in a dead zone.
- **Expected behavior — log the call tap.** A `tel:` tap is the only evidence the call happened. Record it, and on return to the app prompt for the outcome (connected / voicemail / bad number / not interested). **Bad number** feeds §E and §L.
- **Anti-feature:** requiring a typed note to complete any triage action. Nobody types in a truck.
- **Complexity:** MEDIUM (MEDIUM-HIGH with offline). **Depends on:** §G.

### §I. Lead card + detail view

- **Card (phone):** name · category · city · rating ★ + review count · **verdict badge** · score + band · phone CTA. That's it. Site Finder's card is this exact shape and it's the right one.
- **Detail (desk + one tap on phone):** everything on the card, plus receipts timeline, score breakdown, source attribution per field, merge history, status history with actor + timestamp, links out (GBP, Facebook, Yelp, Maps directions), and notes.
- **Expected behavior — internal label vs customer-facing name, separated from day 1.** Carried directly from BIS, where `accounts.name` (the agency's internal label) escaped to customers **three times**. Siteless will have internal annotations ("looks like the cousin of the Alamo roofer") and a legal/DBA entity name from the Comptroller that differs from the trading name. Two fields, two purposes, never interchangeable, and a test that asserts the internal one never renders in any export or push payload.
- **Complexity:** LOW (card) / MEDIUM (detail). **Depends on:** §C, §D, §E.

### §J. Export + CRM sync

- **Table stakes:** CSV with a stable column contract including verdict, confidence, score, and receipt-count; and the BIS push on accept.
- **Expected behavior — push is idempotent.** External key (the Siteless lead id, surviving merges) so a retry or a re-accept updates rather than duplicates. Tags: `source:siteless`, industry, city, score band.
- **Expected behavior — push is observable.** Status per lead: `queued` / `pushed` / `failed (reason)` with a retry action. A silent failed push means the accepted lead simply evaporates — the exact failure mode BIS's own history warns about (a state mirror that quietly doesn't fire is invisible).
- **Expected behavior — never push low-confidence verdicts automatically.** The CRM is the agency's system of record; polluting it with unverified leads costs more than the lead is worth.
- **Differentiator (v1.x):** a **generic outbound webhook** with a documented JSON payload. This is the cheapest possible path to "standalone product" — HubSpot, Pipedrive and GoHighLevel all accept inbound webhooks, and GHL's Inbound Webhook workflow trigger is the standard agency integration path (generate URL → send sample payload → map fields → tag → publish). One webhook + docs ≈ three integrations, without owning three OAuth apps and three sync-conflict models.
- **Anti-feature (v1):** native per-CRM OAuth integrations. Each is an ongoing maintenance liability (token refresh, field mapping UI, API version churn, rate limits) for a product with one customer.
- **Complexity:** MEDIUM (BIS push) / LOW (webhook) / HIGH (native CRM integrations — don't). **Depends on:** §E (stable key), §G.

### §K. Cost dashboard + budget caps

Not a garnish. The unit economics of this product are hostile and visible:

| SKU (Places API New) | Free/month | $ per 1,000 (0–100k band) |
|---|---|---|
| Text Search **Enterprise** (needed for `websiteUri`, `rating`, `userRatingCount`, phone) | 1,000 | **$35.00** |
| Text Search Enterprise + Atmosphere (adds `reviews`) | 1,000 | $40.00 |
| Text Search Pro | 5,000 | $32.00 |
| Place Details Enterprise | 1,000 | $20.00 |
| Place Details Enterprise + Atmosphere | 1,000 | $25.00 |
| Place Details / Text Search Essentials (IDs only) | Unlimited | $0 |

You are billed at the **highest SKU present in the field mask**. Siteless's required fields are all Enterprise. At a $50/mo cap: 1,000 free + ~1,428 paid ≈ **~2,400 Text Search calls/month**, each returning up to 20 places (≤60 with pagination, each page billed). Enumeration is therefore cheap per row; **per-candidate verification is the scarce resource.** Design around that.

- **Table stakes:** month-to-date spend vs cap, per-source breakdown (Places / Firecrawl / other), spend per run.
- **Expected behavior — reserve, don't reconcile.** Before a run: estimate → reserve against the cap → execute → true up. Checking spend *after* the fact means the cap is already breached.
- **Expected behavior — hard stop.** At 100%, scheduled runs **refuse** and say so on the dashboard. At 80%, warn. The cap is a contract, not a KPI.
- **Expected behavior — per-request cost ledger.** Every outbound API call writes `{provider, sku, units, cost_cents, run_id, lead_id?}`. This is what makes §K's cost-per-verified-lead, §L's economics and any future pricing decision possible. **Instrument on the first API call written; it cannot be retrofitted.**
- **Differentiator:** **cost-per-verified-lead** and **cost-per-accepted-lead** as headline dashboard numbers. Nobody in this category shows you this; credit systems exist specifically to obscure it.
- **Complexity:** MEDIUM. **Depends on:** §B. **Blocks:** §F (scheduler must consult it).

### §L. False-positive feedback loop

- **Table stakes:** a one-tap **"actually has a site"** control on the card and in the detail view, with a field for the URL.
- **Expected behavior — it closes the loop.** The report (a) retires the lead, (b) records the URL as ground truth, (c) increments the false-positive counter against the verdict that produced it, (d) is visible in a per-verdict-class accuracy table (`no presence: 94% · social-only: 88% · dead site: 71%`), (e) becomes a regression fixture for the verification pass.
- **Expected behavior — a denominator.** FP rate = reported FPs / verdicts issued in the same window. Also run a deliberate **spot-check sample** (PROJECT.md's own v1 success metric): sample N verified leads, manually check, record. Passive reporting under-counts, because a lead nobody called never gets corrected.
- **Expected behavior — trend, not a point.** The number's job is to move. Show it over time next to any verification threshold changes.
- **Why this is a differentiator:** the surveyed vendors ship no equivalent; the category's accuracy is widely estimated at 65–80% and nobody publishes a measured figure or a correction mechanism.
- **Complexity:** MEDIUM. **Depends on:** §C, §G.

### §M. Team / org features

- **Table stakes (v1):** Clerk org-scoped auth; `org_id` on every table; every state change stamped with actor + timestamp.
- **Expected behavior:** because v1 has one org with more than one human (danlo + BIS staff), the only real multi-user need is **"who triaged this and when"** and **not triaging the same lead twice**. A soft claim/lock on a lead open in triage is enough.
- **Defer:** invites, roles/permissions, assignment rules, territories per rep, leaderboards, per-seat billing. All of these are real in a SPOTIO-shaped product and all of them are speculative here.
- **Complexity:** LOW (v1 scoping) / MEDIUM-HIGH (the deferred set). **Depends on:** auth.

### §N. Compliance affordances

Siteless sends nothing. But it hands a human a phone number and an implicit instruction to call, so it carries the obligations of a *calling list*, not of a sender.

- **Table stakes — internal do-not-contact list.** Org-scoped suppression by phone and by business identity. Any lead matching is excluded from queues and from push, visibly ("suppressed: do-not-contact"). Populated from rejects ("asked not to be contacted"), from BIS, and by manual entry. This is the single highest-value compliance feature and it's ~a day of work.
- **Table stakes — calling-window display.** RGV is `America/Chicago`; the conventional telemarketing window is 8am–9pm in the *recipient's* time zone. Show local time on the card; grey the call CTA outside the window with an override. Cheap, visible, and it prevents the dumbest possible violation. **Pin zone and locale in tests** (carried BIS lesson: one instant, two zones, opposite verdicts).
- **Differentiator — likely-mobile-number flag.** The legal seam that actually bites: calls to a business's published landline are broadly outside the National DNC framework (the FTC's Telemarketing Sales Rule exempts most business-to-business calls, with a narrow carve-out for nondurable office/cleaning supplies), **but a small-business owner's personal cell is a different question**, and a large share of RGV micro-businesses list a mobile as their business line. Flagging likely-mobile numbers (line-type lookup, or a cheap heuristic) lets the caller make an informed choice. Note it as *information*, never as legal advice.
- **Table stakes — a short compliance note in-product.** One screen: this is a discovery tool; it does not send; B2B calls to published business lines are generally exempt from the National DNC Registry; personal cell phones, autodialers and prerecorded messages are not the same case; several states (FL, OK, MD, WA, NJ) have their own mini-TCPA statutes with penalties from $500 to $20,000 per violation; consult counsel. Linked from the call CTA.
- **Table stakes — data provenance on export.** Each lead records which source supplied each field. Answers "where did you get my number?" and protects the agency's story.
- **Anti-feature:** implementing National DNC Registry scrubbing in v1. Access is subscription-gated and registry-scrub obligations attach to telemarketing *campaigns*; you are not running one. Build the *internal* list, which is the one that actually applies and actually matters reputationally in a market where everyone knows everyone.
- **Complexity:** LOW-MEDIUM. **Depends on:** §J (suppression must gate the push, not just the UI).
- **Confidence:** MEDIUM on the legal specifics — all of it is secondary-source and current-as-of-2026 summaries. **The product surfaces information; it must not present itself as compliance tooling.**

---

## Feature Dependencies

```
[§A Search presets]
    └──feeds──> [§B Places ingest (field mask = cost decision)]
                    ├──requires──> [§K Cost ledger + budget cap]   (instrument FIRST)
                    ├──feeds─────> [§C Verification + receipts]  ◄── THE PRODUCT
                    │                   ├──feeds──> [§D Glass-box scoring]
                    │                   └──feeds──> [§L False-positive loop]
                    └──feeds─────> [§E Dedupe / entity resolution]
                                        ├──required by──> [§F "New since last run" / change detection]
                                        └──required by──> [§J CRM push (stable external key)]

[§I Lead card/detail] ──renders──> [§C receipts] + [§D score breakdown] + [§E merge history]

[§G Triage (accept/reject/snooze)]
    ├──requires──> [§I Lead card]
    ├──feeds─────> [§J CRM push on accept]
    ├──feeds─────> [§L FP loop (reject reason = "already has a site")]
    └──extended by──> [§H Mobile swipe + offline queue]

[§N Do-not-contact list] ──gates──> [§G triage queue] AND [§J push]     (both, or it leaks)

[§K Budget cap] ──gates──> [§F scheduler]   (scheduler must refuse, not warn)

[Bundled outreach sending] ──conflicts──> [entire v1 scope, TCPA/CAN-SPAM]
[Auto-merge < 95% confidence] ──conflicts──> [§L accuracy measurement]  (silently manufactures errors)
[ML scoring] ──conflicts──> [v1]  (no labelled outcomes exist yet)
```

### Dependency Notes

- **§C requires §B:** you cannot verify a candidate you haven't enumerated. But note the inverse trap — §C's cost is *per candidate* while §B's is *per request*, so §C is the budget bottleneck and must be gated by a cheap pre-filter.
- **§K must precede §B in build order.** The per-request cost ledger has to exist before the first billable call, or the cost-per-verified-lead number is permanently unreconstructable. This inverts the intuitive ordering.
- **§F requires §E.** "New since last run" is a statement about *identity*. Without stable entity resolution, every run reports everything as new (the exact failure that makes competitors' output untrustworthy).
- **§J requires §E.** A merge that changes the external key double-creates the contact in BIS and exports your dedupe bug into the CRM.
- **§L requires §C and §G.** The false-positive rate needs both a recorded verdict (numerator source) and a human control to contradict it.
- **§N gates §G and §J, separately.** Suppressing only in the UI leaves the push path open. Enforce at both layers; test both.
- **§D enhances §G:** score ordering is what makes a queue finishable — the hot leads are at the top, and abandoning the tail is a rational choice rather than a failure.
- **§H extends §G:** mobile triage is the same state machine with different ergonomics and an offline queue. Build §G's state machine transport-agnostic and idempotent from the start; retrofitting idempotency onto a replay queue is miserable.
- **Auto-merge conflicts with §L:** every wrong auto-merge is a manufactured error that the accuracy metric will absorb and mis-attribute to the verification pass. Keep the review queue.

---

## MVP Definition

### Launch With (v1)

Success metric from PROJECT.md: **50 verified no-website leads pushed to BIS and called, with a measured false-positive rate.** Everything below is what that sentence actually requires.

- [ ] **Per-request cost ledger + hard monthly cap** — must exist before the first billable call; the cap is a stated constraint, not a goal
- [ ] **Search presets** (4 clusters × RGV city list / county / radius), seeded, with a pre-run cost estimate
- [ ] **Places ingest** with an explicit, reviewed field mask and pagination-ceiling detection
- [ ] **Verification pass → five-way verdict + confidence** — the product
- [ ] **Receipts**, append-only, one tap from the card, including negative-evidence records
- [ ] **Dedupe** with auto-merge / review-queue / ignore tiers and a stable external key
- [ ] **Glass-box score** with a visible breakdown and persisted components
- [ ] **Lead card + detail view**, internal label separated from customer-facing name
- [ ] **Triage: accept / reject-with-reason / snooze**, undo, status persisted
- [ ] **Mobile-first PWA triage** with swipe + tap-to-call + call-outcome capture
- [ ] **Nightly scheduled runs** with "new since last run", change detection (`gained a website` → auto-retire), and a morning digest
- [ ] **BIS push on accept**, idempotent, observable, with per-lead push status and retry
- [ ] **"Actually has a site" control + false-positive rate on the dashboard** + a spot-check sampling flow
- [ ] **Internal do-not-contact list** gating both queue and push
- [ ] **Calling-window display** (America/Chicago, zone+locale pinned in tests)
- [ ] **CSV export** with verdict, confidence, score
- [ ] **Clerk org-scoped auth**, `org_id` everywhere, actor+timestamp on state changes

### Add After Validation (v1.x)

- [ ] **Offline action queue + background sync** — trigger: the first time a triage action is lost in a dead zone. (Prefetch-the-queue read caching can ship in v1; the *write* queue is the expensive half.)
- [ ] **Generic outbound webhook + payload docs** — trigger: the first non-BIS buyer conversation. Cheapest possible "HubSpot/Pipedrive/GHL integration."
- [ ] **Editable score weights + re-score preview** — trigger: danlo disagrees with the ranking after ~50 calls
- [ ] **Free-source cross-reference** (TX Comptroller, OSM/Overture, county DBA) — trigger: a Places pagination ceiling demonstrably hides real businesses, or a Texas-wide coverage claim is needed
- [ ] **Desk keyboard shortcuts** (`J/K/A/R/S/U`) — trigger: any desk-side bulk triage session
- [ ] **Likely-mobile-number flag** — trigger: first "why are you calling my cell" conversation
- [ ] **Per-verdict-class accuracy table + verification threshold tuning** — trigger: ~100 verdicts with feedback
- [ ] **Re-verify-before-call** for stale receipts — trigger: first call made on a 30-day-old verdict that was wrong

### Future Consideration (v2+)

- [ ] **AI-drafted outreach copy** (human sends) — explicitly a later milestone; defer until the lead quality is proven
- [ ] **Mock-site / preview generation** — high demo value, high cost, needs human review in the loop
- [ ] **Outreach sending with full consent plumbing** — only with suppression, unsubscribe, logging and counsel. Do not partially build this.
- [ ] **Multi-tenant billing, invites, roles** — when org #2 exists
- [ ] **Territory assignment / rep leaderboards** — when there is more than one full-time caller
- [ ] **ML / predictive scoring** — needs ~200+ labelled outcomes; the glass-box rules must stay as the fallback and the explanation
- [ ] **Map view (desk, read-only)** — separate billable SKU, territory-planning value only
- [ ] **Statewide / multi-state expansion** — a cost problem before it is a feature problem

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Verification → five-way verdict + confidence | HIGH | HIGH | **P1** |
| Receipts (evidence trail, one tap) | HIGH | MEDIUM | **P1** |
| Per-request cost ledger + hard cap | HIGH | MEDIUM | **P1** (build first) |
| Search presets (industry × geography) | HIGH | LOW | **P1** |
| Places ingest with reviewed field mask | HIGH | MEDIUM | **P1** |
| Dedupe (3-tier, stable external key) | HIGH | HIGH | **P1** |
| Triage accept/reject-with-reason/snooze | HIGH | LOW | **P1** |
| Mobile PWA card + swipe + tap-to-call | HIGH | MEDIUM | **P1** |
| Glass-box score + breakdown | HIGH | LOW | **P1** |
| BIS push on accept (idempotent, observable) | HIGH | MEDIUM | **P1** |
| Nightly schedule + "new since last run" | HIGH | MEDIUM | **P1** |
| False-positive control + measured rate | HIGH | MEDIUM | **P1** |
| Internal do-not-contact list | MEDIUM | LOW | **P1** |
| Calling-window display | MEDIUM | LOW | **P1** |
| Dead-`business.site` / parked detection | HIGH | MEDIUM | **P1** (rides inside verification) |
| CSV export | MEDIUM | LOW | **P1** |
| Cost-per-verified-lead on dashboard | MEDIUM | LOW (given the ledger) | **P1** |
| Change detection → auto-retire "got a website" | HIGH | MEDIUM | **P1/P2** |
| Offline write queue + background sync | MEDIUM | MEDIUM-HIGH | **P2** |
| Generic outbound webhook | MEDIUM | LOW | **P2** |
| Editable score weights + preview | MEDIUM | MEDIUM | **P2** |
| Desk keyboard shortcuts | MEDIUM | LOW | **P2** |
| Free-source cross-reference (Comptroller/OSM/DBA) | MEDIUM | HIGH | **P2** |
| Likely-mobile-number flag | MEDIUM | MEDIUM | **P2** |
| Bulk actions (multi-select + bulk accept/reject) | MEDIUM | LOW | **P2** |
| Map view (desk, read-only) | LOW | MEDIUM | **P3** |
| AI-drafted outreach copy | MEDIUM | HIGH | **P3** |
| Mock-site generation | MEDIUM | HIGH | **P3** |
| Native CRM integrations (HubSpot/GHL/Pipedrive OAuth) | LOW (v1) | HIGH | **P3** |
| Email discovery / contact enrichment | LOW | MEDIUM | **P3 / anti** |
| Outreach sending | LOW (v1) | HIGH + legal | **Anti-feature** |
| Multi-tenant billing / invites | LOW | HIGH | **P3** |

---

## Competitor Feature Analysis

Brief — depth lives in `COMPETITORS.md`.

| Feature | D7 Lead Finder (list vendors) | Micro-SaaS class (Site Finder, LeadsByLocation, Lead Scouter, Grape Leads) | Scraper/infra class (Outscraper, Apify actors) | Sales-intel class (Apollo, Clay) | **Siteless** |
|---|---|---|---|---|---|
| "No website" filter | Yes — filter to hide leads without website/email/phone | Yes, it's the entire headline | Yes — "Ignore businesses with websites" advanced filter | Not a local-business concept | Yes, but as a *candidate generator*, not a verdict |
| Verification of the verdict | None — "hands you the rows" | Site Finder: DNS + HTTP/HTTPS reachability, SSL validity, parked-page detection, presence score 0–100 **with a confidence %** | None (raw scrape output) | N/A | Five-way verdict + confidence, multi-probe |
| Evidence / receipts shown | No | No (score only, no trail) | No | Clay exposes provider columns + validation status in waterfalls — closest analogue, different market | **Yes — per-lead append-only evidence trail, one tap** |
| Scoring | No | Yes — opportunity score, hot/warm/cold grading, website quality 0–100 | Some actors emit `leadScore`/`leadPriority`/`opportunityScore` | Yes (fit/intent) | Glass-box, breakdown visible, weights editable |
| Dedupe / "new since last run" | Weak | Not mentioned on any surveyed page | **Best in class** — differential scraping, baseline `stateKey`, `changeType`, unchanged rows skip billing | Apollo: saved-search alerts + **Net New** tab | 3-tier dedupe + `changeType` + auto-retire on "got a website" |
| Mobile triage | No | No | No | Mobile apps exist; not triage-shaped | **Phone-first swipe triage, tap-to-call, offline-tolerant** |
| Cost transparency | Credits | Credits ($15–$40/mo) | Event-based billing per place/profile/enrichment | Credits | **Per-request ledger, hard cap, cost-per-verified-lead** |
| Accuracy measurement | No | No | No | No (category sits at a reported 65–80%) | **Measured FP rate + spot-check sampling** |
| Outreach bundled | Some | Lead Scouter/Site Finder: AI site generation instead | No | Yes (Apollo sequences) | **Deliberately not** — hand off to BIS |
| Compliance affordances | No | No | No | Suppression lists exist for senders | Internal DNC + calling window + provenance |

**Read:** the field is strong on *enumeration* and *filters*, thin on *scoring*, near-empty on *verification evidence*, empty on *measured accuracy*, and empty on *phone-first triage*. Siteless's four differentiators are exactly the four empty columns, and three of them (receipts, measured accuracy, cost-per-verified-lead) are cheap once the cost ledger and evidence table exist from day one.

---

## Open Questions for Requirements

1. **Verification budget split.** What fraction of the $50 goes to enumeration vs per-candidate verification? Firecrawl pricing was not verified here — `STACK.md` must pin it, because it sets the per-candidate cost and therefore the nightly candidate ceiling.
2. **What counts as "real site"** when a business's only site is a Facebook page with a custom domain pointed at it, or a Linktree on a bought domain? Needs a written rule before the verification pass is built, not after.
3. **Spot-check sampling size and cadence** for the FP rate — needs to be defined to make the v1 success metric measurable rather than anecdotal.
4. **Line-type lookup cost** for the likely-mobile flag — may be free enough via a carrier-lookup API, may not be worth it.
5. **Who exactly triages?** danlo solo vs BIS staff changes whether soft-locking a lead in triage is needed in v1.

---

## Sources

**Vendor / competitor pages (feature evidence, MEDIUM–HIGH):**
- [Site Finder](https://getsitefinder.com/) — DNS/HTTP/SSL/parked-page verification, presence score with confidence %, opportunity score, CSV, pricing
- [Lead Scouter](https://leadscouter.net/) — Hot/Warm/Cold grading, niche+geo filters, CSV/PDF, tiering
- [LeadsByLocation vs D7](https://leadsbylocation.com/compare/d7-lead-finder/) — website quality score 0–100, PDF audits, "D7 gives you the list" framing
- [D7 Lead Finder](https://d7leadfinder.com/) and [review](https://coldiq.com/tools/d7-lead-finder) — no-website filter, volume per search, rows-not-leads critique
- [LeadSwift review](https://outreachalmanac.com/tools/leadswift/) — audits, missing-website flags, bundled outreach, pricing
- [Outscraper: scrape businesses without websites](https://outscraper.com/google-maps-scrape-businesses-without-websites/) — "Ignore businesses with websites" filter, enrichment chaining
- [Apify — Google Maps Lead Scraper & Monitor (No Duplicates)](https://apify.com/solutionssmart/google-maps-lead-scraper) — differential scraping, `stateKey`, `dedupeStrategy`, `detectUpdates`, `changeType`, event billing, unchanged-rows-skip-billing
- [Apollo — Save, Share, and Set Alerts for Searches](https://knowledge.apollo.io/hc/en-us/articles/4409803718669-Save-Share-and-Set-Alerts-for-Searches) — saved search alerts, Net New tab
- [Clay — waterfall enrichment](https://www.clay.com/waterfall-enrichment) — provider transparency analogue
- [SPOTIO field sales mobile CRM](https://spotio.com/features/field-sales-mobile-crm/) — "Download My Day" offline, one-tap logging, dispositions
- [Kondo (via trykondo)](https://www.trykondo.com/blog/linkedin-tools-for-prospecting) — keyboard triage shortcuts, snooze-and-resurface

**Platform documentation (HIGH):**
- [Google Maps Platform pricing list](https://developers.google.com/maps/billing-and-pricing/pricing) — per-SKU prices and free caps
- [Places API usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) — "billed at the highest SKU applicable to your request"
- [Place Data Fields (New)](https://developers.google.com/maps/documentation/places/web-service/data-fields) and [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search) — `websiteUri`, `rating`, `userRatingCount`, `nationalPhoneNumber` are Enterprise-SKU fields
- [GoHighLevel Inbound Webhook trigger](https://help.gohighlevel.com/support/solutions/articles/48001237383-how-to-use-the-inbound-webhook-workflow-premium-trigger) — the standard agency inbound-lead integration shape

**Domain / practice (MEDIUM):**
- [Google Business Profile websites shut down](https://www.searchenginejournal.com/websites-created-with-google-business-profiles-to-shut-down-in-march/509794/) and [business.site shutdown detail](https://brandefenders.com/blog/important-googles-business-site-shutting-down-what-you-need-to-know/) — ~21.7M sites off 2024-03; redirects guaranteed only to 2024-06-10
- [FTC — Complying with the Telemarketing Sales Rule](https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule) — B2B exemption and its nondurable-office-supplies carve-out
- [State DNC laws for B2B sales](https://www.smarte.pro/blog/state-do-not-call-laws) and [B2B cold calling legal guide](https://instantly.ai/blog/b2b-cold-calling-legal-guide/) — business landline vs owner's personal cell; internal DNC; 8am–9pm window; state mini-TCPA penalties (MEDIUM — secondary sources, verify with counsel)
- [CRM deduplication merge framework](https://www.digitalapplied.com/blog/crm-data-deduplication-merge-framework-2026-methodology) — ≥95 auto-merge / 80–95 review queue / <80 ignore
- [Glass-box scoring](https://hginsights.com/blog/glass-box-scoring-the-case-against-black-box-ai-in-lead-qualification/) — explanation cards, "lets a person correct that decision"
- [Offline-first PWA patterns](https://rohitraj.tech/notes/pwa-offline-sync) — service worker + IndexedDB queue + background sync
- Competitor data-accuracy estimates (65–80%) from comparison write-ups — LOW confidence on the exact figure, HIGH confidence on the directional claim that no vendor publishes a measured rate

---
*Feature research for: local-business lead discovery / "no website" agency prospecting*
*Researched: 2026-09-20*
