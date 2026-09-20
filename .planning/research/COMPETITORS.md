---
title: Competitive Landscape — Siteless
date: 2026-09-20
dimension: competitors
confidence: MEDIUM-HIGH
---

# Competitive Landscape — Siteless

> **How to read the confidence tags.** Every factual claim below carries one of
> `[HIGH]` (read today, 2026-09-20, off the vendor's own page or official docs),
> `[MED]` (multiple third-party sources agree, vendor page unreachable or silent),
> `[LOW]` (single source, or SEO-farm content I could not corroborate).
> The lead-gen review space is dominated by competitor-written "X pricing 2026"
> blogspam. I treated every one of those as a hypothesis and went to the source.
> Where the source blocked me (403/404), I say so rather than launder the blogspam.

## Summary (10 lines max)

1. **This space is crowded but shallow.** 20+ products will hand you a list of Google Maps businesses whose `website` field is empty. That is the whole product for nearly all of them.
2. **Almost nobody verifies.** "No website field on Google Maps" is treated as the verdict, not the hypothesis. Only **Webleadr** and one 40-user Apify actor go further.
3. **Exactly one competitor is mobile-first** (Webleadr, a PWA). Everything else is CSV export, desktop software, or a Chrome extension. Nothing is built for phone triage.
4. **Zero products measure their own false-positive rate.** Not one. This is the single biggest open gap.
5. **Zero products show receipts** — "here is what we searched, here is what we found, here is when." The closest is Webleadr's AI design score, which is an opinion, not evidence.
6. **Social-only is named by three products and prioritized by none.** The hottest lead class in danlo's thesis is a checkbox elsewhere, not a ranking signal.
7. **Price floor is brutally low**: $0.0015–$0.01 per raw record (Apify/Outscraper), $0.24 per *qualified* lead (Webleadr). Subscription fat-part is **$19–$99/mo**.
8. **The legal path is cheaper than the market assumes.** Places API Text Search Enterprise works out to ~**$1.75 per 1,000 places** — competitive with Apify's $1.50 and cheaper than Outscraper's loaded ~$14. `[HIGH]`
9. **But Places ToS forbids warehousing** everything except `place_id`. This is an architectural constraint no competitor discusses, and it is why the scraper industry exists.
10. **Bilingual RGV coverage is a market of zero.** Every tool is English-category-driven. Nothing indexes `taquería`, `llantera`, `barbería`, `panadería`, or es-MX Facebook pages.

---

## Comparison table

| Product | Price anchor (date-checked 2026-09-20) | No-website filter? | Verification? | Sources | Mobile? | CRM sync? | Verdict for a 2-person RGV agency |
|---|---|---|---|---|---|---|---|
| **Webleadr** | $14 / 50 leads, $24 / 100 leads (~$0.24–0.28/lead), pay-as-you-go `[HIGH]` | **Yes** — 3 buckets: real site / third-party platform / none `[HIGH]` | **Partial** — Lighthouse-style health grade A–F + AI-vision design score 1–10 `[HIGH]` | Undisclosed; "business websites and public sources in real-time" `[MED]` | **Yes — installable PWA** `[HIGH]` | CSV/XLSX/PDF/JSON; "integrate with your CRM" (no named connectors) `[MED]` | **Closest competitor. Buy it, use it, learn from it.** No receipts, no FP tracking, no scheduling, no Spanish. |
| **Apify — `fervent_bus/no-website-business-leads`** | **$0.004 per record** `[HIGH]` | **Yes — best taxonomy in market**: `none` / `social_only` / `free_builder` / `weak` (Linktree, bio.link) `[HIGH]` | No — classification only, no evidence trail `[HIGH]` | Google Maps (scraped) `[HIGH]` | No | Apify API / webhook | **Read its docs, then out-build it.** 40 total users, 10 MAU, no rating. Proof the idea is live and unowned. |
| **Apify — `code-node-tools/google-maps-businesses-without-websites`** | $0.01 per qualified lead; $0.0005 per business checked `[HIGH]` | Yes — returns only `website == null` `[HIGH]` | No `[HIGH]` | Google Maps (scraped, direct HTTP) `[HIGH]` | No | Apify API | **Cautionary tale.** 993 users, **1.88★ rating** — people bought naive no-website detection and hated it. `[HIGH]` |
| **Apify — `compass/crawler-google-places`** | From **$1.50 / 1,000 places** `[HIGH]` | Yes — `website` input param (with/without) `[HIGH]` | No `[HIGH]` | Google Maps (scraped) | No | Apify API / integrations | **The infrastructure everyone resells.** 611,386 users, 4.70★. Good verification-pass fallback; ToS-grey as a primary. |
| **Scrap.io** | $35–$350/mo yearly; $49–$499/mo monthly; Basic = 10,000 exports/mo `[HIGH]` | **Yes** — "filter on no website *before* you export" `[MED]` | No — filters, not evidence `[MED]` | Google Maps + **Apple Maps + Bing Maps**, 195 countries, 4,000+ categories `[HIGH]` | No | REST API + **MCP server**; no named CRM connectors `[HIGH]` | **Best filter depth (17 pre-export filters).** $49/mo monthly is real money for 2 people, and you still get a CSV, not a call list. |
| **Outscraper** | First 500 free, then **$3 / 1,000**; $1/1,000 above 100K; à-la-carte per endpoint `[MED]` | Yes — site filter `[MED]` | No `[MED]` | Google Maps + many others | No | API, Zapier, Make `[MED]` | **Cheapest headline, worst bill.** Every enrichment is a separate billed task; loaded cost ~$14/1,000. 4.9★ on **4** G2 reviews — ignore the rating. |
| **Targetron** | 50 free/mo; **$15/1,000** (51–5K), $10/1,000 (5K–50K), $5/1,000 (50K+) `[HIGH]` | **Yes — explicit 3-way**: With website / Without website / Enter domain `[MED]` | No `[MED]` | Google Maps–derived directory `[MED]` | No | CSV/XLSX/JSON/**Parquet**, API at Business tier `[HIGH]` | **Honest metered pricing, boring product.** Parquet export is a tell: it's a data vendor, not an agency tool. |
| **D7 Lead Finder** | ~$44.99 Starter / ~$54.99–69.99 Agency / ~$119.99 Pro per month `[LOW — sources disagree; d7leadfinder.com/pricing returns 404]` | **Not advertised.** Their own homepage lists `Website Link` as an output field, never a filter `[HIGH]` | No `[HIGH]` | Aggregated directories, "up to 1,200 leads per search" `[HIGH]` | No | CSV/XLSX export; API on Pro `[MED]` | **Skip.** Named in the brief as a hypothesis; it fails the first test — it has no no-website filter. 3.7★ on **5** G2 reviews; recurring "stale data" complaint. `[MED]` |
| **LeadSwift** | $24.99 / $49.99 / $99.99 per month; annual $19.99 / $39.99 / $79.99. **Tiers differ only by searches/day: 1 / 5 / 20** `[HIGH]` | **No mention anywhere on the pricing page** `[HIGH]` | No | Google Maps + website audit snapshot `[MED]` | No | CSV; built-in email sequences `[MED]` | **Wrong shape.** 4.9/5 from 649 Trustpilot reviews `[HIGH]`, but a 1-search-a-day quota is hostile to nightly re-runs, and it bundles outreach sending — the exact thing Siteless deliberately excludes. |
| **LeadsGorilla 2.0** | $27 / $39 / $67 per month, plus a $397 one-time "bundle" + OTO ladder `[MED]` | Partial — Facebook + Google lead finder with audit scores `[MED]` | No — audit reports, widely reported as broken `[MED]` | Google Maps + Facebook Pages `[MED]` | No | CSV + built-in email `[MED]` | **Avoid.** ~3.2/5 across a small base; reported double-charging, denied refunds, "not enough information to generate a report" errors, **and it runs on your own Google API key** so the real cost is +$50–200/mo. `[MED]` |
| **Lead Scrape** | **$97/yr Standard, $247/yr Business** (desktop, 2 machines) `[HIGH]` | Not advertised `[MED]` | No — merges 3 or 7 sources and dedupes `[HIGH]` | 3 sources (Standard) / 7 sources (Business) `[HIGH]` | No — desktop | CSV `[HIGH]` | **Cheapest annual in the survey** and it dedupes across sources — the one idea worth stealing. Desktop-only kills it for field triage. |
| **LocalScraper** | $19.99/mo, or $15.99/mo on 6-month `[HIGH]` | No `[HIGH]` | No | Google Maps ×3, Google Places, Bing Maps, Yahoo Local, Yellow Pages ×2 `[HIGH]` | No — Windows/Mac desktop | CSV `[HIGH]` | **Skip.** Desktop software, 42–49 columns, no no-website concept. |
| **G Maps Extractor** | Free 1,000/mo; **$19/mo for 20,000 records**; API $15/1,000 req `[HIGH]` | Not advertised on pricing page `[HIGH]` | No | Google Maps (extension + cloud + API) | Chrome extension only | CSV/Excel/JSON `[HIGH]` | **Best raw $/record in the survey.** A commodity pipe, not a product. |
| **GMapsScraper.io** | ~$19/mo Starter (~15,000 searches), $49/mo Pro, emails included `[LOW — vendor's own comparison blog; pricing page not independently read]` | Implied, not verified `[LOW]` | No | Google Maps | Web app, no extension `[LOW]` | CSV `[LOW]` | **2026 entrant competing purely on flat-rate simplicity.** Watch the pricing model, not the product. |
| **GoHighLevel Premium Prospecting** | **$29/mo per enabled sub-account**, on top of GHL `[HIGH, help article updated 2026-04-21]` | **No** — it audits *existing* presence (listings, GBP, reviews, site speed, SEO heatmaps) `[HIGH]` | Audit-based, but of sites that exist `[HIGH]` | GBP + listings + Lighthouse `[HIGH]` | Via GHL mobile app | **Native CRM — best in class here** `[HIGH]` | **Structurally can't serve this use case.** A business with no website has nothing to audit. Free tier: 5 premium/mo, 50 basic/day. |
| **Apollo.io** | Free / $49 / $79 / $119 per user/mo annual `[MED]`; Google Maps local company search is **paid plans only** `[MED]` | No `[MED]` | No | 200M+ B2B contact DB + **new Google Maps local import** `[MED]` | Mobile app | HubSpot, Salesforce native `[MED]` | **Wrong database.** Apollo knows companies with domains — which is the exact inverse of the target. The 2026 Maps feature is an import, not a filter. |
| **Clay** | Free / **$167/mo Launch** / **$446/mo Growth** annual; dual Data Credits + Actions after the **March 2026 overhaul** `[HIGH]` | Build-it-yourself | Build-it-yourself | 150+ providers, Google Maps source included free `[HIGH]` | No | Everything | **You could build Siteless-lite in Clay.** At $167/mo minimum, and you pay for enrichment attempts that return nothing. `[MED]` Wrong price point for a 2-person shop. |
| **Instantly Lead Finder** | ~$47/mo for lead access; realistic $94–194/mo with outreach `[MED]` | No `[MED]` | Email verification only `[MED]` | SuperSearch, 450M+ contacts `[MED]` | No | Native to Instantly campaigns | **Wrong database again**, plus it's an outreach-sending product. |
| **Origami.chat** | Free 1,000 credits / **$29 Starter / $129 Pro / $399 Max** per month `[HIGH]` | No explicit filter — AI agent searches in natural language `[MED]` | **Claims cross-source corroboration** (Maps + state licensing + permits + directories) `[MED]` | Live web + Google Maps + **state license boards + permit records** `[MED]` | No | CSV export `[HIGH]` | **The most interesting 2026 entrant.** Its guide (pub. 2026-04-24, upd. 2026-09-11) openly admits "expect more manual verification than a normal B2B list" — an honest competitor. Licensing-board data is a source idea worth stealing (TDLR for TX trades). |
| **Micro-SaaS cluster** — LocalLead, Thyonix, Grape Leads, B2BLeadFinder, Webless Leads, Vonsel, LeadsAgent | Free tiers to ~$29/mo; Grape Leads 20 free credits; LeadsAgent 1,000 free leads/mo; B2BLeadFinder 7-day/25-scan trial `[MED]` | **Yes — it's their entire pitch** `[HIGH]` | **No** — none describe verification `[HIGH]` | Google Places / SearchAPI / Google Maps `[MED]` | No | CSV, some webhook/Zapier (Grape Leads) `[MED]` | **This is the competitive noise floor.** Nearly free, nearly identical, nearly all one-person projects. LocalLead is the only one that says it flags Facebook/Instagram/Yelp-only businesses `[HIGH]`. Thyonix bundles AI demo-site generation. |
| **Near misses** — Snov.io ($39–738/mo), PhantomBuster ($69–439/mo), Ocean.io (~$0.071/credit), BrightLocal ($39–59/mo), Lead Scrape competitors | — | No | — | — | — | — | **Not competitors.** Ocean.io has documented gaps in North American SMB coverage (match rates as low as 5% on some US segments) `[MED]`. BrightLocal is a local-SEO reporting suite. PhantomBuster charges by execution-hour, not by lead. |

---

## Product notes

### Webleadr — the one to beat
`https://webleadr.com/` · checked 2026-09-20

The only product in this survey that shares Siteless's actual thesis: that the *verdict* is the product, not the list. It sorts businesses into three buckets — real website, third-party platform (Facebook, Yelp), no presence — and explicitly "detects third-party platforms masquerading as dedicated sites." `[HIGH]` It then runs two scores: a **Health Score A–F** (SSL, SEO basics, security headers, server speed, mobile readiness) and a **Design Quality Score 1–10** using AI vision. `[HIGH]`

It is also the only PWA — installable on iPhone, iPad, Android, Mac, Windows. `[HIGH]` Pricing is pay-as-you-go credits: **$14 for 50 leads, $24 for 100** (bonus credits on top), credits never expire, 14-day refund if unused. `[HIGH]` A third-party review corroborates ~$12/100 credits and a referral program. `[MED]`

**What it misses.** No receipts — the A–F grade and the 1–10 score are outputs with no visible evidence trail; you cannot see *what was searched* or *when*. No false-positive tracking. No scheduling or recurrence — it is a search box, not a nightly job. No budget cap. No Spanish. No named CRM connectors (the site says "integrate with your favorite CRM," which in practice means CSV). Its January 2026 review on 1Capture `[HIGH]` is entirely positive and raises no accuracy concerns, which — given it's an affiliate-shaped review — tells us nothing about real accuracy.

**RGV judgment:** at $0.24/lead, 100 leads costs $24 once. A two-person shop should just buy it this week as competitive intelligence. It does not solve the trust problem, and it will never speak Spanish.

### Apify `fervent_bus/no-website-business-leads` — the taxonomy Siteless wants, at 40 users
`https://apify.com/fervent_bus/no-website-business-leads` · checked 2026-09-20

The single best classification scheme found anywhere: `none` (no website field), `social_only` (Facebook, Instagram), `free_builder` (Wix subdomain, WordPress.com, Blogspot), `weak` (Linktree, bio.link). An `includeWeakWebsite` toggle controls the last three. It scores leads: +40 phone, +30 rating with 10+ reviews, +20 at 50+ reviews, +10 complete address, max 100. `[HIGH]`

That scoring model is **conspicuously close** to danlo's stated scoring criteria (reviews/rating + social-only + phone reachability). Two people arrived at the same answer independently. That's validation, not a problem.

**$0.004 per record.** `[HIGH]` **40 total users, 10 monthly active, no star rating yet.** `[HIGH]` It ships the right idea into a market that hasn't found it. Its own stated limitation is the whole opening: *"Accuracy depends on Google Maps listing completeness."* `[HIGH]` — i.e. it inherits every false positive Google hands it and says so.

### Apify `code-node-tools/google-maps-businesses-without-websites` — 1.88 stars is the market's verdict
`https://apify.com/code-node-tools/google-maps-businesses-without-websites` · checked 2026-09-20

Fetches full business details, filters out anything with a website, returns the rest. $0.01 per qualified lead, ~$0.022 all-in on their own worked example (50 leads = $1.08). **993 total users, 63 MAU, 100% successful runs — and 1.88/5 stars.** `[HIGH]`

Read that carefully: the runs *succeed*. The technology works. Users still rate it 1.88. **Nearly a thousand people bought naive no-website detection, got exactly what was advertised, and were angry anyway.** That is the strongest single piece of evidence in this document that verification — not extraction — is the product.

### Scrap.io — best filters, no verdict
`https://scrap.io/pricing` · checked 2026-09-20

Seventeen filters applied *before* you spend a credit: main-activity-only, digital presence (website/email/phone), phone type (mobile vs landline), review count range, rating, claimed status, first-seen date, duplicate exclusion, contact-form and ad-pixel detection, radius and polygon geosearch. `[MED]` It pulls from **Google Maps, Apple Maps and Bing Maps** across 195 countries and 4,000+ categories `[HIGH]` — the broadest legitimate multi-source enumeration in the survey.

`first_seen date` is a filter idea worth stealing outright: it is the closest anyone comes to recurrence/delta detection.

Pricing is the highest-friction part: **$35/mo Basic on annual, $49/mo on monthly**, 10,000 export credits. `[HIGH]` Exports via CSV, REST API and — notably for 2026 — an **MCP server**. `[HIGH]` No named CRM connectors, no mobile, no verification, and their own filtering guide never actually names a "without website" filter even though their marketing copy does. `[MED — vendor copy and vendor docs disagree]`

### Outscraper — the à-la-carte bill is the story
`https://outscraper.com/pricing/` (403 to automated fetch; figures from converging third parties) · checked 2026-09-20

First 500 Google Maps records free monthly, then **$3/1,000** up to 100K, **$1/1,000** beyond. `[MED]` No subscription; credits don't expire; tiers reset every 30 days. `[MED]`

The universal complaint across G2, Capterra and review blogs is not accuracy — reviewers report ~95% accuracy and unusually responsive support `[MED]` — it is **billing shape**. Emails, email validation and phone lookup are each separately billed services. A usable B2B lead stacks three or four billed tasks, putting real cost near **$14/1,000**. `[MED]` For a product with a hard $50/mo cap, that variance is the disqualifier, not the price.

Note the G2 sample: **4 reviews at 4.9★.** `[MED]` Treat the rating as noise.

### Targetron — the only vendor with a literal three-way website filter
`https://targetron.com/pricing/` · checked 2026-09-20

Website filter offers **"With website" / "Without website" / "Enter domain."** `[MED]` Free 50 records/month, then $15/1,000 (51–5,000), $10/1,000 (5,001–50,000), $5/1,000 (50K–500K), dropping to $0.50/1,000 at eight figures. `[HIGH]` CSV/XLSX/JSON/**Parquet**; API from the Business tier. `[HIGH]` Also sells via AppSumo lifetime deals. `[MED]`

At low volume it is the *most expensive* per record in the survey ($15/1,000 vs Apify's $1.50) — metered pricing tuned for data buyers, not agencies.

### D7 Lead Finder — fails the first test
`https://d7leadfinder.com/` · checked 2026-09-20 (their `/pricing/` and `/app/pricing/` both 404)

Listed in the kickoff brief as a starting point. It should be dropped. Their own homepage lists **`Website Link` as an output column and offers no website filter** `[HIGH]` — it's a directory aggregator that returns up to 1,200 leads per search in ~3 minutes, with social links, review scores, ad tracking and website tech.

Pricing is unverifiable from the vendor: third parties variously report Agency at **$54.99** and **$69.99**, which is itself a red flag about how current any of it is. `[LOW]` Reviews are thin — **3.7/5 from five G2 reviews**, nothing on Trustpilot or Capterra as of Aug 2026 `[MED]` — with recurring complaints about stale data in specific markets and slow support. `[MED]` For a border market like the RGV, "stale data in certain markets" is precisely the failure mode that matters.

### LeadSwift — good reviews, wrong economics
`https://leadswift.com/pricing` · checked 2026-09-20

Three tiers — $24.99 / $49.99 / $99.99 monthly, $19.99 / $39.99 / $79.99 annual — and the pricing page is unusually blunt: *"The number of searches is the only way our packages differ."* Starter gets **1 search per day**. `[HIGH]` Everything else (leads, contacts, exports, data points, list uploads) is unlimited. A "search" is a query like "Restaurants in Toronto" yielding thousands of businesses.

4.9/5 across **649 Trustpilot reviews, 126 in the last 12 months** `[HIGH]` — by far the most genuinely-reviewed product here. Praise is for speed, price and support; the one recurring gripe is that the platform "can feel a bit clunky while navigating through the lead verification process." `[HIGH]`

**But there is no no-website filter on the pricing page at all** `[HIGH]`, and a daily-search quota is structurally incompatible with a nightly scheduler covering 4 clusters × 20 RGV cities. It also bundles email sequences — the CAN-SPAM surface Siteless deliberately refuses in v1.

### LeadsGorilla 2.0 — the one to actively avoid
`https://leadsgorilla.io/` · checked 2026-09-20 (`/pricing` 404s; figures from third parties)

$27 / $39 / $67 per month, or a $397 one-time bundle behind a coupon (`LGBUNDLE`), with an OTO ladder: Citations $57, Agency $47, ClientsNest $197. `[MED]` Finds local business leads on Facebook and Google, generates audit reports and AI outbound emails.

The complaint pattern is severe and consistent: GMB reports "not accurate at all or do not even gather the information that is clearly visible on Google"; web-vitals reports erroring with "not enough information to generate a report" almost every time; double-charging without authorization and refusals to refund against usage limits. `[MED]` ~3.2/5 across a small Capterra/G2 base. `[MED]`

The structural problem is worse than the reviews: **it runs on your own Google Maps API key**, so the $27–67/mo headline hides $50–200+/mo of real API spend. `[MED]` That is the exact anti-pattern Siteless's hard budget cap exists to prevent.

### The micro-SaaS cluster — LocalLead, Thyonix, Grape Leads, B2BLeadFinder, Webless Leads, Vonsel, LeadsAgent
All checked 2026-09-20

Seven near-identical products, most of them one-person builds, all shipped in roughly the last eighteen months. Every one has the same pitch: search a city and a category, get businesses with an empty website field.

- **LocalLead** (`local-leadfinder.com`) — *the only one with a real detection method described*: divides the search area into **overlapping zones**, scans nearby businesses per zone, then checks every result "for a real website," and explicitly flags businesses relying solely on **Facebook, Instagram, or Yelp** as leads. `[HIGH]` Powered by Google Places. `[HIGH]` "Charged once per search," amount not published. `[HIGH — the absence is the finding]` CSV with name, address, phone, Maps link.
  The overlapping-zone tiling is a genuinely good idea and directly relevant: it's how you beat the Places API's 60-results-per-query ceiling legally.
- **Thyonix** — free, uses **live Google Maps via SearchAPI** rather than a stale scrape `[HIGH]`, then funnels you into AI demo-website generation and AI outreach emails. `[HIGH]`
- **Grape Leads** — Google Maps, a "Without websites" filter, 20 free credits, **CSV or webhook → Zapier** `[HIGH]` (the only webhook-native one in the cluster). No verification described. `[HIGH]`
- **B2BLeadFinder** — scans Google Maps for listings with no website URL, then runs **11 decision-maker discovery sources** (Google, LinkedIn, review-author names, **WHOIS**, directories) to find an owner email/phone. `[HIGH]` 60 companies per search; 7-day / 25-scan free trial; pricing not on the tool page. `[HIGH]` The WHOIS idea is interesting and inverted — WHOIS only helps if a domain exists, which is a *disqualifying* signal worth capturing.
- **Webless Leads** (`weblessleads.com`) — name-adjacent to Siteless, JS-rendered site I could not read; **pricing unverifiable.** `[LOW]` Scamadviser has a listing for the domain, which I did not evaluate. Worth a manual look before anyone commits to the "Siteless" name.
- **Vonsel** — free Chrome extension that captures Maps listings, then filter the website column for blanks; paid "mapped CRM" dashboard with review analysis and AI emails. `[HIGH]` Their own how-to article **contains no discussion of false positives or verification whatsoever** `[HIGH]` — it never considers that a website field can be blank for reasons other than not having a website.
- **LeadsAgent** — 1,000 free leads/month, autonomous agent framing, no API key needed. `[MED]` Publishes the "27% of small businesses have no website in 2026" stat, sourced to Smart Soft Solutions 2025. `[MED]`

**What the cluster proves:** demand is real and the price floor is near zero. **What it proves harder:** none of them can charge money, because none of them solved trust.

### GoHighLevel Premium Prospecting — a CRM's answer, structurally wrong
`https://help.gohighlevel.com/.../155000005458` · article updated 2026-04-21 `[HIGH]`

**$29/mo per enabled sub-account.** `[HIGH]` Free tier: 5 premium reports/month, 50 basic/day, agency level only. Premium adds unlimited reports, weekly auto-refresh, AI prospecting that delivers ready-made reports every few days, website performance audits, SEO heatmaps, a lead-gen widget, and CRM/SMS integration. `[HIGH]`

It audits **listings, GBP, reviews, site speed and SEO** — all of which require a website to exist. For a no-website prospect the report is empty by construction. GHL is a competitor for *the agency's budget*, not for this job. The weekly auto-refresh cadence, though, is a useful benchmark: the market's incumbent thinks **weekly**, not nightly, is the right recurrence.

### Origami.chat — the honest AI-native entrant
`https://origami.chat/pricing` · checked 2026-09-20

Free 1,000 credits, then **$29 Starter (2,000 credits/mo) / $129 Pro (10,000) / $399 Max (30,000)**. `[HIGH]` You describe an ICP in plain English; an agent searches Google Maps, **state licensing boards, permit records** and local directories live, and claims to cross-reference sources in real time — verifying addresses through Maps and phones through directories. `[MED]`

Their guide (published 2026-04-24, updated 2026-09-11) is the most honest document in this entire survey `[HIGH]`: it warns that "verified work-email rates are lower" for offline businesses, that users should "expect more manual verification than a normal B2B list," and explicitly recommends **against** full automation.

**Steal the source idea, not the product.** Texas has TDLR licensing for HVAC, electrical, plumbing, cosmetology and auto — a public, free, per-name-and-address enumeration of exactly danlo's four clusters. The PROJECT already lists TX Comptroller and county DBA filings; TDLR belongs on that list.

### Clay and Apollo — right sophistication, wrong database
Both checked 2026-09-20

**Clay** overhauled pricing on **2026-03-11**: Free, **Launch $167/mo** (15,000 Actions + 3,000 Data Credits), **Growth $446/mo** (40,000 + 6,000), Enterprise custom — with a new dual-currency model separating Data Credits (from $0.05, rolls over up to 2× monthly) from Actions (under $0.01, no rollover). `[HIGH]` Google Maps is a free prospecting source inside Clay. `[MED]` You genuinely could prototype Siteless in Clay — and you would pay Data Credits for every enrichment attempt including the ones that return nothing. `[MED]` Wrong price point by an order of magnitude for a two-person shop.

**Apollo** added Google Maps local-company import, paid plans only, at $49/$79/$119 per user/mo annual. `[MED]` Apollo's core asset is a 200M+ contact database keyed on companies that have domains — the structural inverse of the target. Its knowledge-base article blocked automated fetch `[HIGH — 403]`, so feature detail is `[MED]`.

### Chrome extensions and the DIY tier — the real price floor
Checked 2026-09-20

A long tail of free or near-free extensions does the naive version: **Lead Extractor**, **Maps Extractor by Leads Extractor**, **MapsLeads.net**, **G Maps Extractor** (free 1,000 records/mo, $19/mo for 20,000) `[HIGH]`, **Map Lead Scraper** ($19–29/mo) `[MED]`, **WebHarvy** ($19 one-time) `[MED]`, plus an open-source **`GustavoN-S/extrator-de-leads`** on GitHub that scrapes Maps, *prioritizes businesses without a site*, builds WhatsApp-ready phone links for 96 countries, assigns a priority score and exports CSV/JSON — Manifest V3, no build step, free. `[MED]`

Below that: **n8n and Make workflows sold on Gumroad** for a few dollars that do Maps → CSV with no paid API at all. `[MED]`

**This is the honest price floor: $0.** Anything Siteless charges has to be defended against a free Chrome extension, and the only defensible ground is the thing none of them have — a verdict you can trust.

---

## Gap analysis — where Siteless wins

Ordered by how defensible the gap is, not by how easy it is to build.

### 1. Verification with receipts — **owned by nobody**
Not one product shows *what was searched, what was found, and when*. Webleadr shows a score; the Apify actors show a label; the micro-SaaS cluster shows a blank column. When a two-person shop dials a roofer in Pharr and the owner says *"I have a website, it's on Facebook"*, the caller needs to already know that, and needs to know how the system knows.

**Why it's defensible:** receipts are a data-model and UX commitment, not a feature. Bolting them onto a CSV product means rebuilding the product. The 1.88★ on a 993-user actor is the market telling you this gap is worth money.

### 2. False-positive rate as a tracked, displayed number — **owned by nobody**
Zero competitors measure their own accuracy. Zero. The entire category asserts correctness and moves on. A "mark as actually has a site" button that feeds a visible FP rate over time converts an unprovable claim into a measured one — and it is the only honest way to answer "should I trust this before I dial?"

**RGV specifics:** the RGV has heavy Facebook-first and WhatsApp-first commerce. Base-rate false positives will be higher here than in Austin. Measuring it is the difference between a tool and a guess.

### 3. Bilingual / es-MX coverage — **market of zero**
Every product surveyed is English-category-driven. None index Spanish trade vocabulary (`llantera`, `taquería`, `panadería`, `barbería`, `carnicería`, `refaccionaria`, `lavandería`), none handle bilingual GBP names, none check Spanish-language Facebook pages, none know that in Hidalgo/Cameron/Starr/Willacy the *listing* may be English while the *business* operates in Spanish. More than 85% of McAllen residents are Hispanic or Latino. `[MED]`

This is not a nice-to-have in the RGV; it is a recall problem. An English-only category sweep misses a chunk of the target population outright, and misclassifies social-only businesses whose only presence is an es-MX Facebook page.

**Why it's defensible:** it requires actually being from here. No solo dev in Lisbon building a Maps wrapper will do it.

### 4. Social-only as the *top* of the ranking, not a checkbox — **weakly held**
Three products name it (LocalLead, the `fervent_bus` actor, Webleadr). None *prioritize* it. danlo's thesis — a business with a Facebook page, 200 reviews and no site is the hottest lead there is — is correct and unexpressed in this market. Make it the default sort, not a filter.

**Contested ground:** the `fervent_bus` actor has the taxonomy right. Assume someone builds the ranking on top of it within a year. Move.

### 5. Phone-first triage on a phone — **held by exactly one competitor**
Webleadr is a PWA. Everything else is CSV, desktop, or a browser extension. Nothing in the market is designed for the actual loop: wake up, 12 new leads, swipe accept/reject/snooze, tap-to-call, receipts one tap away, on a bad connection in a truck between McAllen and Rio Grande City.

**RGV specifics:** rural Starr and Willacy county coverage is genuinely poor. Offline tolerance is a real requirement, not a checkbox.

### 6. Budget-capped scheduling — **owned by nobody, and actively inverted by most**
Outscraper bills per endpoint with no cap. Clay bills for enrichment attempts that fail. LeadsGorilla puts the API bill on your own key. LeadSwift caps *searches* (which throttles the wrong thing). **Nobody enforces a hard dollar ceiling and nobody reports cost-per-verified-lead.** A scheduler that refuses to spend the 51st dollar, and a dashboard that shows what each verified lead cost, is a category-level differentiator that happens to also be a budget requirement.

### 7. Recurrence and delta detection — **near-zero**
The whole market sells one-shot exports. Only Scrap.io's `first_seen` filter gestures at it. Nobody tells you *"this business still has no site after 60 days"* (warmer — they're not fixing it themselves) or *"this one got a site last week, drop it"* (stop calling, you look stupid). Delta detection is what turns a list into a queue, and it is what justifies a subscription rather than a one-time credit purchase.

### 8. Dead / parked / orphaned-domain detection — **partially held**
On **2024-03-05 Google shut down ~21.7 million `.business.site` websites** generated from Business Profiles, removing the URLs from the website field and killing the redirect on **2024-06-10**. `[MED — consistent across many sources; Search Engine Land 403'd on fetch]` That event created an enormous cohort of businesses that *thought* they had a website and now 404. Webleadr's health grade catches some of this. Nobody classifies "parked / expired / placeholder / template-default" as a distinct, pitchable state — which is a shame, because it's the easiest sales conversation there is.

### 9. Hyper-local presets — **unclaimed**
Everyone ships "city + category." Nobody ships a curated, maintained **RGV preset**: the four counties, the ~20 named cities including the border towns and the colonias, tuned category lists per cluster, and the overlapping-zone tiling LocalLead described so you actually get past the 60-result ceiling in Edinburg instead of stopping at the first 60 taquerías. Texas-wide then really is just a bigger preset.

### 10. CRM handoff that isn't a CSV — **held only by GoHighLevel**
Of everything surveyed, only GHL has native CRM write-back, and it's their own CRM. Every other product ends at CSV (a few at webhook). Siteless pushing an accepted lead straight into BIS as a tagged contact, reusing BIS's existing contact-creation logic and work queue, is a real integration where the market has a download button.

---

## Pricing anchors

### Per raw record (what extraction costs)

| Source | Price per record | Note |
|---|---|---|
| Apify `compass/crawler-google-places` | **$0.0015** | Market floor; 611K users `[HIGH]` |
| Outscraper (base) | **$0.003** | First 500/mo free `[MED]` |
| Outscraper (loaded, 3–4 endpoints) | **~$0.014** | The number that actually shows up on the bill `[MED]` |
| Apify `fervent_bus/no-website-business-leads` | **$0.004** | Includes classification + lead score `[HIGH]` |
| Scrap.io Basic | **~$0.005** | $49/mo ÷ 10,000 exports, monthly billing `[HIGH]` |
| Apify `code-node-tools` (per *qualified* lead) | **$0.010–0.022** | Plus $0.0005 per business merely checked `[HIGH]` |
| Targetron (low volume) | **$0.015** | $15/1,000 in the 51–5,000 band `[HIGH]` |
| G Maps Extractor | **$0.00095** | $19/mo ÷ 20,000 records `[HIGH]` |
| Chrome extensions / n8n workflows | **$0** | The honest floor `[MED]` |

### Per *verified* lead (what a verdict costs)
| Source | Price |
|---|---|
| **Webleadr** | **$0.24–$0.28** `[HIGH]` |

That is the only per-verified-lead anchor in the market, and it is **~160× the raw-record floor.** The spread between $0.0015 and $0.24 is the entire commercial opportunity: it is what the market already pays for classification, and nobody in that band is even showing receipts.

### Monthly subscription bands
| Band | Products | Price |
|---|---|---|
| Free / freemium | Thyonix, LeadsAgent, Grape Leads, extensions, Targetron 50/mo, Apify free tier | $0 |
| Micro-SaaS entry | Webleadr credits, LeadsGorilla, Origami Starter, GHL Premium Prospecting, LocalScraper, G Maps Extractor, GMapsScraper.io | **$14–$29** |
| **Agency sweet spot** | LeadSwift ($24.99–99.99), Scrap.io ($35–49), D7 ($45–120), BrightLocal ($39–59), Instantly ($47) | **$25–$120** ← *the fat part of the market* |
| Data-team tier | Clay ($167–446), Snov.io Pro ($99–554), PhantomBuster ($69–439) | **$99–$450** |
| Annual desktop | Lead Scrape | **$97–$247/yr** |

### Siteless's own input costs — the finding that matters most

**`websiteUri` is an Enterprise-SKU field.** `[HIGH]` On Places API (New), requesting `places.websiteUri` (or `rating`, `userRatingCount`, or phone numbers) promotes the whole request to the **Enterprise** tier. `[HIGH]`

| SKU | Free/month | $/1,000 requests (0–100K) |
|---|---|---|
| Text Search Essentials | 10,000 | **$2.83** |
| Text Search Pro | 5,000 | $32.00 |
| **Text Search Enterprise** | **1,000** | **$35.00** |
| Place Details Essentials | 10,000 | $5.00 |
| **Place Details Enterprise** | **1,000** | **$20.00** |

`[HIGH — developers.google.com/maps/billing-and-pricing/pricing, read 2026-09-20]`

Text Search (New) returns **20 results per page, max 20**, and **a maximum of 60 results across all pages.** `[HIGH]`

**Therefore:** at 20 places per request, Text Search Enterprise is **$35 ÷ 20,000 = ~$1.75 per 1,000 places**, and the 1,000 free Enterprise calls are worth **~20,000 free places per month**. The legal path is *cheaper per place than Outscraper's base rate and competitive with Apify's floor.* This inverts the industry's assumption that you scrape because the API is expensive.

**The $50/mo cap math, concretely.** A full enumeration sweep of 4 clusters × ~15 categories × ~20 RGV cities ≈ 1,200 distinct queries. Paginated to 60 results each = ~3,600 Text Search Enterprise requests. Less 1,000 free = 2,600 × $0.035 = **~$91/month.** `[Derived from HIGH inputs — the query count is my estimate, not a verified figure.]`

**A nightly full sweep does not fit the budget.** The architecture that does fit:
- **Periodic full enumeration** (monthly or quarterly) — the ~$91 sweep, amortized.
- **Nightly delta re-check** against cached `place_id`s via Place Details Enterprise: 2,000 known candidates × $0.020, less 1,000 free = **~$20/month.** `[Derived from HIGH inputs]`
- Free public data (TX Comptroller, TDLR, OSM/Overture, county DBA) carries enumeration breadth at $0.

**The ToS constraint that forces this shape.** Google permits storing **`place_id` indefinitely**; everything else — names, ratings, reviews, phone numbers — is subject to caching restrictions, with coordinates commonly cited at 30 days. `[HIGH for place_id exemption and the general "must not pre-fetch, cache, or store Places API content beyond the allowed exceptions" prohibition, from the official Places policies page. MED for the specific 30-day figure — the Service Specific Terms page truncated on fetch and the 30-day number comes from secondary sources.]` **Verify this against the current Service Specific Terms before designing the schema** — it determines whether Siteless stores leads or stores pointers, and it is the single highest-consequence unresolved question in this document.

**Yelp is probably out.** Yelp ended free Fusion access in mid-2024; current reported tiers are **$7.99 / $9.99 / $14.99 per 1,000 API calls**, with an earlier structure around $229/mo for 1,000 calls/day. `[MED — reported consistently, Yelp's own pricing page not read]` At those rates Yelp cannot fit inside a $50/mo cap alongside Places. Treat Yelp presence as something to *detect on the open web* (a yelp.com/biz URL found during the verification pass), not something to *query the API for*. The PROJECT's "only if research shows it adds coverage worth the budget" test: **it doesn't.**

### What Siteless should charge (recommendation)
Price against the **$25–$120 agency band**, not against the $0.0015 extraction floor — you are selling verdicts, not records. **$49/mo** for the single-agency tier reads as serious next to $24.99 LeadSwift and undercuts $69 Scrap.io Professional, while the input cost is ~$40/mo all-in. A **$99/mo** multi-market tier follows when Texas-wide presets ship. Resist per-lead credit pricing: it is Webleadr's model, it caps your revenue at the honesty of your own lead counts, and it makes the FP-tracking feature actively hostile to your P&L (every false positive you admit is a refund conversation).

---

## Do NOT copy

| Anti-feature | Who does it | Why not |
|---|---|---|
| **Daily-search quotas as the pricing lever** | LeadSwift (1/5/20 per day), D7 (15/30/100) | Throttles exactly the behavior Siteless needs — a nightly scheduler across 4 clusters × 20 cities. Meter *verified leads*, not searches. |
| **Bring-your-own Google API key** | LeadsGorilla | Turns a $27/mo product into a $200/mo surprise `[MED]` and makes the hard budget cap unenforceable. Siteless owns the key and owns the cap. |
| **À-la-carte per-endpoint billing** | Outscraper, Clay | Unpredictable by construction. Clay even bills for enrichment attempts that return nothing `[MED]`. Incompatible with a hard ceiling. |
| **Bundled outreach sending** | LeadSwift, LeadsGorilla, Thyonix, Oppora, Instantly | TCPA and CAN-SPAM exposure with no consent plumbing. Already out of scope — this survey confirms it's the *default* in the category, which makes refusing it a positioning statement, not a gap. |
| **AI-generated mock sites / demo previews as the hook** | Thyonix, Vonsel, LeadsGorilla | Shifts the pitch from *"you're invisible"* to *"here's a thing I made without asking."* Already deferred in PROJECT; keep it deferred. It also invites the prospect to judge your design before they've judged your insight. |
| **Vanity audit PDFs, SEO heatmaps, Lighthouse reports** | GoHighLevel Premium, LeadsGorilla, BrightLocal | Structurally void for the target: a business with no website has nothing to audit. LeadsGorilla's most-reported bug is literally its audit erroring with "not enough information to generate a report." `[MED]` |
| **Lifetime deals and OTO upsell ladders** | LeadsGorilla ($397 bundle + 4 OTOs), Targetron (AppSumo) | Poisons the brand, destroys recurring revenue, and attracts customers who will never pay again. The refund and double-charge complaints against LeadsGorilla are the predictable end state. `[MED]` |
| **Desktop-only distribution** | LocalScraper, Lead Scrape | Kills phone triage outright. A Windows binary cannot be the product when the daily loop happens in a truck. |
| **Scraping reviewer personal data** | Apify `compass/crawler-google-places` (reviews with reviewer personal data) `[HIGH]` | GDPR/CCPA exposure for zero lead value. Review *count* and *rating* are the signal; reviewer identities are liability. |
| **Direct Google Maps scraping as the primary source** | Most of the category | Google's Maps Platform ToS prohibits exporting/extracting/scraping Maps content for use outside the Services `[MED]`. Already a PROJECT constraint. The cost analysis above removes the last excuse: the legal path is ~$1.75/1,000 places. |
| **A raw CSV dump as the deliverable** | Nearly everyone | The CSV *is* the commodity, and the commodity is free (Chrome extensions, n8n workflows, Gumroad). Shipping a CSV puts Siteless in a price war it will lose. |
| **Star ratings from 4–5 reviews used as proof** | Outscraper (4.9★/4 reviews), D7 (3.7★/5 reviews) | Not a product anti-pattern — a *research* anti-pattern. Don't let these numbers into a positioning deck; they mean nothing. |

---

## Sources

All URLs fetched or searched on **2026-09-20** unless a publication date is noted.

**Read directly from the vendor / official docs — `[HIGH]`**
- https://leadswift.com/pricing — plans, the "searches are the only difference" quote
- https://targetron.com/pricing/ — full metered tier table
- https://scrap.io/pricing — monthly vs yearly tiers, export credits, geo filters
- https://scrap.io/ — 195 countries, 4,000+ categories, Google/Apple/Bing Maps, REST API + MCP
- https://apify.com/fervent_bus/no-website-business-leads — $0.004/record, 4-way taxonomy, scoring model, 40 users
- https://apify.com/code-node-tools/google-maps-businesses-without-websites — pay-per-event pricing, 993 users, **1.88★**
- https://apify.com/compass/crawler-google-places — $1.50/1,000, `website` filter, 611,386 users, 4.70★
- https://webleadr.com/ — $14/50 and $24/100 leads, 3-bucket classification, Health Score, AI-vision Design Score, PWA
- https://local-leadfinder.com/ — overlapping-zone method, Facebook/Instagram/Yelp-only flagging, Google Places
- https://www.thyonix.com/tools/find-businesses-without-websites — free, live Maps via SearchAPI, AI demo sites
- https://grapeleads.com/ — "Without websites" filter, 20 free credits, CSV + webhook/Zapier
- https://b2bleadfinder.io/tools/find-companies-without-websites — 11 decision-maker sources incl. WHOIS, 7-day/25-scan trial
- https://vonsel.com/blog/find-business/find-businesses-without-a-website — method, free extension; **no FP/verification discussion**
- https://d7leadfinder.com/ — output fields, 1,200 leads/search, no website filter (`/pricing/` and `/app/pricing/` both 404)
- https://www.localscraper.com/google-maps-scraper.php — $19.99/mo, desktop, 8 sources, 42–49 columns
- https://gmapsextractor.com/pricing — full three-product pricing tables
- https://origami.chat/pricing — $29/$129/$399 tiers, 1,000 free credits
- https://origami.chat/blog/find-businesses-without-websites — pub. 2026-04-24, upd. 2026-09-11; honest limitations
- https://www.clay.com/pricing — $167/$446 annual, Data Credits + Actions split
- https://help.gohighlevel.com/support/solutions/articles/155000005458-free-vs-premium-prospecting-in-highlevel — $29/mo, free vs premium table, updated 2026-04-21
- https://www.1capture.io/blog/webleadr-review — pub. 2026-01-04
- https://www.trustpilot.com/review/leadswift.com — 4.9/5, 649 reviews, 126 in last 12 months
- https://developers.google.com/maps/billing-and-pricing/pricing — full Places API (New) SKU price table
- https://developers.google.com/maps/documentation/places/web-service/data-fields — `websiteUri`/`rating`/phone are **Enterprise** tier
- https://developers.google.com/maps/documentation/places/web-service/text-search — 20 per page, 60 max across pages
- https://developers.google.com/maps/documentation/places/web-service/policies — `place_id` exempt; no pre-fetch/cache/store otherwise
- https://mapsplatform.google.com/pricing/ — free-call allowances per tier

**Blocked on automated fetch (403/404) — claims downgraded to `[MED]`/`[LOW]`**
- https://outscraper.com/pricing/ — 403
- https://outscraper.com/google-maps-data-scraper-filters/ — 403
- https://knowledge.apollo.io/hc/en-us/articles/44340555852685 — 403
- https://searchengineland.com/google-shutting-down-websites-business-profiles-436393 — 403
- https://cloud.google.com/maps-platform/terms/maps-service-terms — truncated on fetch
- https://leadsgorilla.io/pricing — 404
- https://weblessleads.com/pricing — JS-rendered, no readable content
- https://d7leadfinder.com/pricing/, /app/pricing/, /app/plans/ — all 404

**Search-derived, multi-source corroborated — `[MED]`**
- Outscraper pricing (free 500, $3/1,000, $1/1,000 >100K; loaded ~$14/1,000): gmapsscraper.io, scrap.io, syncgtm.com, salesforge.ai — all competitor-authored, all agreeing
- D7 pricing ($44.99/$54.99–69.99/$119.99): fullenrich.com, coldiq.com, saleshandy.com, tomba.io — **sources contradict on the Agency tier**
- D7 reviews (3.7★/5 G2; nothing on Trustpilot or Capterra as of Aug 2026; stale-data and support complaints): coldreach.ai, leadsforge.ai, saleshandy.com
- LeadsGorilla pricing and complaints ($27/$39/$67; $397 bundle; BYO API key +$50–200/mo; GMB report inaccuracy; double-charging): capterra.com/p/266217, trustpilot.com/review/leadsgorilla.io, syncgtm.com, guideblogging.com
- Lead Scrape ($97/$247 per year, 3 vs 7 sources): leadscrape.com/buy.html, capterra.com/p/198617
- Apollo (Free/$49/$79/$119 per user/mo; Maps import paid-only): salesmotion.io, saleshandy.com, emelia.io, capterra.com/p/158696
- Instantly Lead Finder (~$47/mo; $94–194 realistic; SuperSearch 450M+): woodpecker.co, lemlist.com, saleshandy.com
- Yelp Fusion paid-only since mid-2024 ($7.99/$9.99/$14.99 per 1,000 calls): appdevelopermagazine.com, docs.developer.yelp.com/docs/plans, techcrunch.com (2024-08-02)
- `.business.site` shutdown (21.7M sites, 2024-03-05, redirect ended 2024-06-10): searchengineland.com, seedprod.com, bluehost.com, multiple
- Google Maps ToS no-scraping + 30-day coordinate cache: cloud.google.com/maps-platform/terms, thunderbit.com, bizcollect.dev, mapsleads.co
- Ocean.io North America coverage gaps (match rates as low as 5%): syncgtm.com, salesrobot.co, pipeline.zoominfo.com
- RGV bilingual market (>85% of McAllen residents Hispanic or Latino): 956-media.com, cabrialeswebstudio.com, pronovatx.com
- "27–29% of small businesses have no website in 2026": leadsagent.io (citing Smart Soft Solutions 2025), b2bleadfinder.io, zippia.com, networksolutions.com (**17%** — an outlier)

**Single-source, uncorroborated — `[LOW]`**
- GMapsScraper.io pricing ($19/$49) — from the vendor's own comparison blog only
- Webless Leads — pricing and everything else unreadable
- Open-source `github.com/GustavoN-S/extrator-de-leads` — README description only, not run
- Map Lead Scraper ($19–29/mo), WebHarvy ($19 one-time), ScrapeHero (10 credits/record, $ per credit never published)

---

## Confidence

**Overall: MEDIUM-HIGH.**

| Area | Confidence | Why |
|---|---|---|
| **The core gap exists** (nobody verifies, nobody shows receipts, nobody tracks FP rate) | **HIGH** | Checked across 20+ products; read the primary pages for 12 of them. Consistent absence, not absence of evidence. |
| **Webleadr is the closest competitor** | **HIGH** | Read their site directly: PWA, 3-bucket classification, AI-vision scoring, exact pricing. |
| **Google Places API economics** (Enterprise SKU, $35/1,000 req, 20/page, ~$1.75/1,000 places) | **HIGH** | Three official Google docs pages, read today. The $91 and $20 monthly figures are *derived*, and the query-count estimate behind them is mine. |
| **Places ToS caching constraint** | **MEDIUM** | `place_id` exemption and the general prohibition are official. **The 30-day figure is secondary-source only — the Service Specific Terms page truncated on fetch. Verify before schema design.** |
| **Pricing for vendors whose pages I read** (LeadSwift, Targetron, Scrap.io, Clay, Origami, Webleadr, G Maps Extractor, Apify actors, GHL, LocalScraper) | **HIGH** | Vendor's own page, date-checked 2026-09-20. |
| **Pricing for vendors who blocked me** (Outscraper, D7, LeadsGorilla, Apollo, Instantly) | **MEDIUM → LOW for D7** | Competitor-authored blogspam only. D7's sources actively contradict each other on the Agency tier. |
| **Review sentiment** (LeadsGorilla negative, LeadSwift positive, Apify 1.88★) | **MIXED** | Apify's 1.88★ and LeadSwift's 649-review Trustpilot score are HIGH. Outscraper's 4.9★ rests on **4** reviews and D7's 3.7★ on **5** — statistically meaningless, reported here only to show how thin the evidence base is. |
| **Bilingual gap** | **MEDIUM-HIGH** | Confident that no surveyed product advertises Spanish-language category or presence handling. Cannot prove a negative — flagged as "found no evidence of," not "does not exist." |
| **RGV-specific economics** (what a local shop will pay) | **LOW** | Inferred from the $25–120 band and danlo's context. **No RGV agency pricing or willingness-to-pay data was found. This needs a real conversation, not a search.** |

**Known gaps in this research:**
- Webless Leads is unread. Given the name adjacency to **Siteless**, someone should open it manually before the domain gets bought.
- I could not surface genuine Reddit or practitioner discussion — every `site:reddit.com` query returned SEO farms instead. **The practitioner voice is missing from this document.** What agencies actually say about false positives on these tools is unknown, and that is exactly the question Siteless is betting on.
- No competitor's false-positive rate is published, so Siteless's differentiator has no benchmark to beat. The first measured FP rate will be the first number in the category.
- ScrapeHero's per-credit dollar cost was never findable.
