# Pitfalls Research

**Domain:** Local-business discovery / "no website" lead generation (Google Places API (New) + multi-source verification + scheduled crawls under a hard budget cap + mobile triage PWA + CRM handoff)
**Researched:** 2026-09-20
**Confidence:** HIGH on Google Places billing/coverage/ToS and Yelp/Meta terms (verified against official docs and terms pages). MEDIUM on entity-resolution heuristics and parked-domain detection (synthesized from research literature + practitioner sources, no single authority). MEDIUM on compliance interpretation (statute text verified; application to this product needs counsel before the outreach milestone).

> **Read this first.** The three findings most likely to change the roadmap:
> 1. `websiteUri` — the one field the entire product depends on — is an **Enterprise-SKU** field. So are `rating`, `userRatingCount`, and the phone numbers. Only **1,000 Enterprise calls/month are free**. A nightly full re-crawl of the RGV is arithmetically impossible inside $50/mo. (Critical Pitfall 1 and 2.)
> 2. **Yelp Fusion's terms forbid what this product does** — 24-hour cache limit, no building a database of business listings, no blending Yelp ratings with other sources, no commercial use without written consent. Yelp-as-a-data-source has to be redesigned or dropped. (Critical Pitfall 10.)
> 3. A `websiteUri` that is present is **not** proof of a website, and a `websiteUri` that is absent is **not** proof of no website. Both directions fail, and the product's entire credibility claim rests on getting this right. (Critical Pitfalls 3 and 4.)

---

## Critical Pitfalls

### Pitfall 1: The field mask silently selects the most expensive SKU — and `websiteUri` is in the most expensive tier

**What goes wrong:**
Google Places API (New) bills per request at **the highest SKU tier touched by any field in your field mask**. Verbatim from the docs: *"You are then billed at the highest SKU applicable to your request. That means if you select fields in both the Essentials and the Pro SKUs, you are billed based on the Pro SKU."*

The tier assignments matter enormously here:

| Tier | Fields relevant to Siteless |
|------|------------------------------|
| Essentials (IDs Only) | `id`, `name`, `photos`, `attributions`, `consumerAlert`, `movedPlace`, `movedPlaceId` |
| Essentials | `location`, `formattedAddress`, `addressComponents`, `shortFormattedAddress`, `types`, `viewport`, `plusCode`, `postalAddress`, `adrFormatAddress`, `addressDescriptor` |
| Pro | `displayName`, `primaryType`, `primaryTypeDisplayName`, **`businessStatus`**, `googleMapsUri`, `googleMapsLinks`, `pureServiceAreaBusiness`, `containingPlaces`, `openingDate`, `timeZone`, `utcOffsetMinutes` |
| **Enterprise** | **`websiteUri`**, **`rating`**, **`userRatingCount`**, **`nationalPhoneNumber`**, `internationalPhoneNumber`, `regularOpeningHours`, `currentOpeningHours`, `priceLevel`, `priceRange` |
| Enterprise + Atmosphere | `reviews`, `editorialSummary`, `generativeSummary`, `servesX`, `parkingOptions`, ... |

Siteless needs `websiteUri` (the detector), `rating` + `userRatingCount` (two of four scoring inputs), and `nationalPhoneNumber` (the third scoring input and the tap-to-call target). **All four are Enterprise.** There is no cheaper path to them. Every discovery request is an Enterprise request.

The corollary trap: someone adds `reviews` to a field mask to "improve scoring" and every request jumps to Enterprise + Atmosphere, the most expensive SKU on the platform, with the same 1,000-call free cap. Or someone uses `*` in development and it ships. The docs warn explicitly: *"While this wildcard field mask is okay to use in development, don't use the wildcard (\*) response field mask in production. The cost may be higher than expected."*

**Why it happens:**
Field masks are a header (`X-Goog-FieldMask`) or a request field, far from the billing code. Nothing in the response indicates which SKU you were billed at. The tier table lives on a different documentation page from the pricing table. A one-line diff adding a field can multiply the bill with a green test suite.

**How to avoid:**
- Define the field mask in **exactly one module** as a typed constant per call site. No ad-hoc masks anywhere. Lint/grep-gate against `X-Goog-FieldMask` appearing outside that module.
- Write a **pure function `skuForFieldMask(mask: string[]): Sku`** that encodes the official tier table, and a **unit test per field** asserting its tier. When Google moves a field between tiers, one test fails instead of the invoice.
- The cost ledger (Pitfall 5) must compute cost from `skuForFieldMask(actualMaskSent)`, never from a hard-coded per-call estimate. Estimates and reality diverge silently; a derived value cannot.
- Add a **mutation check**: append an Enterprise+Atmosphere field to the mask in a test and assert the SKU classifier reports the higher tier and the ledger price changes. A green suite that survives this mutation is theatre.
- Ban `*` at the type level — make the mask parameter a union of allowed field literals, not `string[]`.

**Warning signs:**
- Google Cloud billing shows a SKU line you didn't expect (e.g. "Places API Text Search Enterprise + Atmosphere").
- Actual spend diverges from the in-app ledger by more than a few percent.
- Any code review where a field is added to a mask "just to have it."

**Phase to address:** Discovery/Places-ingestion phase (P1), day one. The SKU classifier and the single-source field mask are part of the first Places client commit, not a later hardening pass.

---

### Pitfall 2: The nightly-full-crawl model does not fit inside $50/month — and you find out on day 31

**What goes wrong:**
The PROJECT.md requirement is "saved searches re-run on a schedule (nightly by default)" across four industry clusters × ~20 RGV cities, under a hard $50/month cap. Run the arithmetic against verified pricing:

Verified pricing (developers.google.com/maps/billing-and-pricing/pricing, fetched 2026-09-20; model effective 2025-03-01, free caps reset monthly **per SKU**):

| SKU | Price / 1,000 | Free calls/month |
|-----|---------------|------------------|
| Text Search Essentials | $32 | 10,000 |
| Text Search Pro | $32 | 5,000 |
| **Text Search Enterprise** | **$35** | **1,000** |
| Nearby Search Essentials | $32 | 5,000 |
| Nearby Search Pro | $32 | 5,000 |
| **Nearby Search Enterprise** | **$35** | **1,000** |
| Place Details Essentials | $5 | 10,000 |
| Place Details Pro | $17 | 5,000 |
| **Place Details Enterprise** | **$20** | **1,000** |
| Geocoding | $5 | 10,000 |

Budget math, assuming Firecrawl Hobby ($19/mo, 5,000 credits) takes the first bite of the $50:

- Remaining for Places: **~$31/month**.
- Text Search Enterprise: 1,000 free + ($31 ÷ $0.035) ≈ 885 paid = **~1,885 discovery requests per month, total.**
- At the best case of 20 results per request with no tile saturation: **~37,700 place observations per month** — but spread over 30 nights that is only **~63 requests/night**.
- A single full RGV sweep at realistic granularity (4 clusters × ~10–15 Places `includedType` values × ~20 cities, with saturated tiles needing up to 3 pages) is **500–1,500 requests**. That is **one sweep per month**, not thirty.

The classic failure: build the scheduler to re-run every saved search nightly, watch it work fine during the first week of testing (inside the 1,000 free Enterprise calls), and hit the wall in week two with the cap tripped and no leads flowing.

The sibling trap that makes it worse: the "obvious" architecture of *cheap search to enumerate IDs, then Place Details per place for `websiteUri`* is **~11× more expensive**, not cheaper:

- Text Search Enterprise: $0.035 per request ÷ 20 places = **$0.00175 per place** (with `websiteUri` included).
- Place Details Enterprise: **$0.02 per place**.

**Why it happens:**
"Nightly" sounds like a scheduling decision, not a budget decision. And the search-then-details pattern is the canonical Places tutorial shape — it's correct for a store locator (one place at a time), catastrophic for bulk discovery.

**How to avoid:**
- **Put the Enterprise field mask on the SEARCH request.** Never call Place Details to obtain `websiteUri` for a place you just found in a search. Place Details is only for (a) refreshing a single lead a user opened, and (b) free `id`-only place-ID refresh.
- Redesign the schedule as a **rotating partition**, not a full sweep: the month's request budget is divided into 30 nightly slices, and each night processes the next slice of the (cluster × city × type) cell list. A cell is revisited roughly monthly; the UI shows "last swept" per cell so a user can force a cell to the front of the queue.
- Separate **discovery cost** from **verification cost** in the ledger and in the UI. Discovery is not the bottleneck at this scale — Firecrawl verification is (~5 credits per candidate → **~1,000 candidates/month** on the Hobby plan). Design the funnel so discovery over-produces cheaply and verification is gated by score.
- Model the budget **before writing the scheduler**: a spreadsheet or a test that takes (cells, types, pages, verification rate) and asserts monthly cost ≤ cap. Make it a committed test, not a one-off.
- Write the v1 success criterion into the model: 50 verified leads is ~250–500 verifications and ~1 sweep. That fits. Thirty sweeps does not.

**Warning signs:**
- The ledger's projected month-end spend exceeds the cap before the 10th.
- Any saved search whose "next run" is < 7 days away and whose cell count is > ~60.
- Firecrawl credits burning faster than Places dollars (means verification is unfiltered).

**Phase to address:** Scheduler + cost-governor phase (P5) owns enforcement, but the **cost model must be produced during the Discovery phase (P1)** and must gate the roadmap's schedule design. If the model says nightly-full is impossible, the requirement in PROJECT.md should be amended before P5 is planned.

---

### Pitfall 3: `websiteUri` absent ≠ no website (the false-positive that burns the call)

**What goes wrong:**
PROJECT.md is explicit that this is the core risk, and it is right. The absence of `websiteUri` on a Google Business Profile means only that **nobody typed a URL into an optional field**. The documented false-positive paths, in rough order of frequency:

1. **The owner never filled the field in.** Extremely common for businesses whose site was built by a relative, a template service, or a one-off contractor who never touched the GBP.
2. **The site is under a DBA or brand name** different from the legal/listed name. "Garcia Enterprises LLC" on the listing; `valleyacrepair.com` in reality.
3. **Franchise / multi-location parent.** The location has no site; the brand does. Selling a website to a Subway franchisee is a wasted call.
4. **Duplicate listing.** The same business has two `place_id`s; the other one has the URL.
5. **Site linked only from the Facebook page**, never from Google.
6. **Site is on a platform subdomain** (`*.square.site`, `*.myshopify.com`, `*.wixsite.com`, `*.godaddysites.com`) that a naive "is this a real site?" classifier may mistake for a directory.
7. **Pure service-area business** (see Pitfall 8) whose listing is thin across the board.

**Why it happens:**
The signal is free and available in bulk; the correction is expensive and per-business. Teams ship the cheap signal and call the expensive one "verification, phase 2."

**How to avoid:**
- **Never let a Places-only verdict reach the triage queue.** The queue contains only *verified* candidates. A `no websiteUri` place is a **candidate**, a distinct state, not a lead. Enforce with a DB constraint or a view, not a convention.
- The verification pass must seek **affirmative disconfirmation**: a candidate is only "no website" after a web search for `{displayName} {city} TX` plus `{nationalPhoneNumber}` returned no page that (a) sits on a domain containing a normalized token of the business name, **or** (b) contains the business's phone number in any format.
- **Phone-number match across formats is the single strongest and cheapest disconfirming signal** and is routinely skipped. Normalize to E.164 and also probe `956-555-1212`, `(956) 555-1212`, `9565551212`, `956.555.1212` in page text.
- **Chain/franchise suppression before verification** (see Pitfall 6) — don't spend Firecrawl credits disproving a Subway.
- Track the false-positive rate as a **first-class metric from the first lead**, not from a later dashboard phase. PROJECT.md already requires the "actually has a site" mark; the number it produces is the product's only honest quality claim.

**Warning signs:**
- Triage sessions where danlo marks > ~10% "actually has a site."
- Verification verdicts produced in < 1 second per candidate (means it short-circuited without searching).
- A verified-lead count that tracks the candidate count too closely (real funnels lose 30–60% at verification).

**Phase to address:** Verification phase (P2) builds it; the **candidate-vs-lead state separation belongs in the schema in P0** so it cannot be bypassed later.

---

### Pitfall 4: `websiteUri` present ≠ has a website (the false-negative that hides your best leads)

**What goes wrong:**
Filtering out every place that has a `websiteUri` discards the hottest leads in the dataset. Specific, verifiable cases:

- **`*.business.site` URLs are guaranteed dead.** Google shut down Business-Profile-generated websites on **2024-03-05**, redirected them to the GBP until **2024-06-10**, and after that they **404**. Thousands of GBP listings still carry a `*.business.site` value in `websiteUri`. Any listing with that URL is a *prime* lead — a business that wanted a website enough to click the free button and now has literally nothing — and a naive filter throws it away.
- `websiteUri` pointing at **Facebook, Instagram, Linktree, a `linktr.ee`/`beacons.ai` page, a `g.page` short link, a Yelp page, a Google Sites page, or a YellowPages/BBB/Nextdoor profile**. These are exactly the `social-only` / `directory-only` classes PROJECT.md wants to surface as high-priority — they arrive *with* a `websiteUri`.
- **Expired / parked domains that return HTTP 200** from a registrar parking page (see Pitfall 5 below for detection).
- **Dead-but-resolving sites**: a WordPress install returning a "coming soon" plugin page, a default nginx/Apache/IIS page, an "Index of /" listing, or a template with `Just another WordPress site` still in the title.

**Why it happens:**
"Has a URL" is a boolean in the response and a boolean feels like an answer. The dead/parked/social cases require a network probe the team hasn't budgeted for yet.

**How to avoid:**
- **Classify every place, never filter on `websiteUri` presence.** `websiteUri` presence selects the *branch* of the classifier, not inclusion in the funnel.
- Maintain a **host-pattern table** (seeded, then grown from real data) mapping hosts to classes: `facebook.com|instagram.com|linktr.ee|beacons.ai` → `social-only`; `yelp.com|yellowpages.com|bbb.org|nextdoor.com|mapquest.com|manta.com` → `directory-only`; `business.site|g.page` → **`dead`** (hard rule — those are 404 by design since 2024-06-10); `*.wixsite.com|*.square.site|*.myshopify.com|*.godaddysites.com` → `real site (platform subdomain)` with a lower score, because these ARE real sites and the pitch is different.
- **Parked/dead detection needs ≥2 independent signals, never HTTP 200 alone.** Research on parked-domain classification is explicit that status codes and emptiness heuristics produce heavy false positives. Usable signals, all cheap:
  - DNS: NXDOMAIN or no A/AAAA record on **both** apex and `www` → dead.
  - Final URL host ≠ requested host after redirects → likely registrar parking.
  - Nameservers or IP in a known parking network (sedoparking, bodis, above.com, parklogic, GoDaddy parking ranges).
  - **Soft-404 probe** — fetch `https://host/<random-uuid>` and compare the body to the homepage body. Near-identical → the server returns the same page for everything → parked or wildcard placeholder. This is the most reliable generic test and almost nobody implements it.
  - Body contains `buy this domain`, `domain is for sale`, `coming soon`, `under construction`, `Welcome to nginx`, `Apache2 Default Page`, `IIS Windows Server`, `Index of /`, `Just another WordPress site`.
  - Heavy third-party ad iframes with no first-party internal links.
  - **Do not use word count alone.** Many legitimate RGV small-business sites are one page with 60 words. That heuristic will mislabel real sites as parked.
- Record **which signals fired** as the receipt. "Dead site" with no receipt is an unfalsifiable claim on a sales call.

**Warning signs:**
- Zero `dead or parked site` verdicts in a month of crawling (the class is never firing → the branch is dead code).
- Zero `*.business.site` hits across the RGV (statistically implausible → the host table isn't being consulted).
- Leads whose receipt shows only "HTTP 200" or only "HTTP 404".

**Phase to address:** Verification phase (P2). The host-pattern table and the soft-404 probe are P2 scope. The `dead` hard rule for `business.site` is a 3-line rule worth shipping in the first P2 commit.

---

### Pitfall 5: A "verified unavailable" verdict that's really a bot wall — the missing sixth class

**What goes wrong:**
PROJECT.md defines five classes: `no presence` / `social-only` / `directory-only` / `real site` / `dead or parked site`. There is no class for **"we could not determine this."** In practice, a large fraction of probes come back inconclusive:

- Cloudflare / Akamai / PerimeterX bot walls returning 403 or 503 to your crawler while the site is perfectly fine for a human.
- Facebook and Instagram requiring login for many public pages, and blocking datacenter IPs.
- Sites that only answer on `www` or only on `https` with a broken redirect chain.
- Firecrawl / search API timeouts, rate limits, or credit exhaustion mid-run.
- `robots.txt` disallow (which you should honor).

If `unknown` collapses into `no presence`, **every bot wall becomes a false positive** — and this is, in practice, the #1 source of false positives in automated site-presence checks.

**Why it happens:**
Classifiers get written as exhaustive switch statements with a `default:` branch. The `default:` branch quietly becomes the largest bucket.

**How to avoid:**
- Add a sixth verdict: **`unverifiable`** (or `blocked`). It has its own status, its own receipt, its own retry policy, and it **never appears in the triage queue as a lead**.
- Make the enum a Postgres enum or a CHECK constraint and make `unverifiable` non-promotable to lead by policy, not by UI.
- Retry `unverifiable` on a separate, slower schedule with a different strategy (Firecrawl stealth mode, 5 credits/page — budget it explicitly rather than letting it silently 5× your credit burn).
- Surface the `unverifiable` count on the dashboard next to the false-positive rate. A rising `unverifiable` share is the earliest signal that the verification pass is degrading.

**Warning signs:**
- The `no presence` class is > ~50% of verified candidates (real-world rates are lower once social and directory presence is counted).
- HTTP 403/503 counts in the receipts logs that don't correspond to any verdict class.
- Verification wall-clock time dropping suddenly (fast failures being counted as answers).

**Phase to address:** Verification phase (P2) — but the **enum belongs in the P0 schema migration** since adding a value to a Postgres enum later is a migration that touches every query and every UI branch.

---

### Pitfall 6: Entity resolution in a bilingual border market — where the generic playbook breaks

**What goes wrong:**
Four RGV-specific failure modes, each of which produces either duplicate leads (wasted calls, looks unprofessional) or wrongly merged leads (call the roofer, reach the salon):

1. **Accents and Spanish/English variants.** `Taquería La Única` / `Taqueria La Unica` / `La Unica Taqueria` / `Taqueria la unica #2` are one business across four sources. A byte-equality or even a trigram match without normalization treats them as four. But over-normalizing is its own bug: stripping `ñ`→`n` for *display* mangles the business's own name on the card danlo is reading off while dialing.
2. **Genuinely-duplicate names.** "La Michoacana" names dozens of unrelated paleterías across the Valley; "El Pollo Loco", "Rio Grande Tire", "Valley Auto" recur in every city. A name+fuzzy-match merge collapses distinct businesses into one lead and you lose 90% of a category.
3. **Phone-number reuse.** In the RGV it is completely normal for one cell number to serve a roofing business, the owner's wife's salon, and a taquería. **Phone alone must never merge two records.** Treat it as corroboration only.
4. **Address noise.** `1234 N 10th St Ste B` / `1234 N 10th St #B` / `1234 North Tenth Street, Suite B`. Worse: the RGV has extensive colonias and unincorporated areas where the **mailing city ≠ the physical city** (an Alton business with a Mission mailing address; a Palmhurst address on a McAllen listing). City-based dedupe misfires, and **city-based search presets under-cover**.

**Why it happens:**
Entity-resolution tutorials are written against US corporate data with clean addresses and unique names. None of the standard assumptions hold in a bilingual border county.

**How to avoid:**
- **Two name fields, always.** `display_name` (verbatim from the source, shown to humans, required by Google's attribution rules) and `match_key` (normalized: NFD decompose → strip combining marks → lowercase → strip punctuation → drop a bilingual stopword list `el la los las de del y and the taqueria carniceria panaderia llc inc co dba #`). Never show `match_key`. This is the same shape as the BIS `accounts.name` lesson — internal label separate from the customer-facing name, from day 1.
- **Never parse `formattedAddress`.** Use `addressComponents` (Essentials tier, cheap) and build a structured address. Normalize the suite/unit component separately and **exclude it from the match key** while keeping it on the lead for the call.
- **A merge requires two independent signals plus a geo gate.** Concretely: merge only if (normalized-name similarity ≥ threshold **AND** haversine distance ≤ 250 m) **OR** (exact E.164 phone match **AND** name similarity ≥ a lower threshold **AND** distance ≤ 500 m). Anything that matches on one signal only goes to a **`needs_review` queue**, not to an automatic merge.
- **Hard rule: never merge across > 25 km.** "Rio Grande Tire" in Brownsville and Rio Grande City are different businesses, period.
- **Chain detection before verification.** If ≥3 places share a `match_key` within Texas, mark the cluster `chain` and suppress it from the funnel (or route it to a separate, manually-reviewed list). Also use `containingPlaces` (Pro tier) to catch mall/food-court tenants.
- Postgres tooling: `unaccent` + `pg_trgm` with a GIN index on the normalized key; `earthdistance`/PostGIS for the geo gate. Both cheap and both standard.
- **`place_id` is a reference, not a primary key.** Google merges and splits listings; place IDs change. Store your own `lead_id` UUID as the PK, keep `place_id` in a join table (a lead can accumulate several over time), and honor `movedPlaceId` / `movedPlace` (Essentials IDs-only tier) when it appears. Refresh place IDs older than 12 months — **that refresh is free** (a Place Details call requesting only the ID field).

**Warning signs:**
- Two triage cards in the same session with the same phone number.
- A lead whose `display_name` contains a `#2` / `#3` suffix and whose merge cluster has one member (numbered locations are a chain tell).
- A `needs_review` merge queue that is empty (means the thresholds are too loose and everything auto-merged) or that is 40% of all records (too tight).
- `place_id` used as a foreign key anywhere.

**Phase to address:** Dedupe / entity-resolution phase (P3) owns the algorithm. **The two-name-field schema and the lead-UUID-vs-place_id separation belong in P0.** Retrofitting either one touches every table and every query — the same reason PROJECT.md already puts `org_id` in the first migration.

---

### Pitfall 7: Tiling a county — silent coverage holes and invisible double-billing

**What goes wrong:**
Both Places search endpoints have hard result caps that make single-query coverage of a city impossible, and the two endpoints fail differently:

| | Text Search (New) | Nearby Search (New) |
|---|---|---|
| Results per page | ≤ 20 (`pageSize`) | ≤ 20 (`maxResultCount`) |
| Pagination | `nextPageToken`, **max 60 results total** | **None — no `nextPageToken` at all** |
| Location scoping | `locationRestriction` (**rectangle only**, categorical queries only) or `locationBias` (rect or circle) | `locationRestriction` circle, **radius 0–50,000 m** |
| Saturation detectable? | Yes — 60 returned means truncated | **No** — 20 returned tells you nothing |

The failure modes:

- **Silent truncation.** A tile covering downtown McAllen with `includedType: restaurant` returns 60 results and stops. There are 400. Nothing in the response says so. You ship with 15% of the market and a dashboard that looks healthy.
- **Nearby Search is a coverage trap for this use case.** With no pagination and a hard 20, you can never distinguish "this tile has 20 places" from "this tile has 2,000 places." Complete coverage via Nearby Search requires subdividing until every tile returns < 20 — vastly more requests, each an Enterprise request.
- **Radius truncation.** A 50 km circle centered on McAllen does *not* mean you get everything within 50 km; it means results are restricted to that circle and then capped at 20.
- **Double-counting.** Overlapping tiles return the same `place_id` repeatedly. Deduping by `place_id` fixes the *data*; it does nothing about the *cost*, which was already billed per request.
- **`locationRestriction` on Text Search is rectangle-only and applies only to categorical queries.** Passing a circle, or a free-text query, silently falls back to biasing — results leak outside the intended county and you bill for places in Mexico.

**Why it happens:**
The caps are documented on pages developers read once. The API returns a 200 with plausible-looking data in every failure case.

**How to avoid:**
- **Use Text Search, not Nearby Search, for enumeration.** Text Search is the only one of the two with a *detectable* saturation condition.
- **Saturation rule: if a tile returns 60 results across 3 pages, it is truncated — subdivide it and re-run.** Make this a loop with a max depth and a per-run request budget, and **log every subdivision**. A tile that subdivides to depth 4 is telling you something about market density that belongs in the dashboard.
- **Tile from a stored geometry, not from a radius.** Store county/city polygons once (TIGER/Line or OSM boundaries are free) and generate an explicit **rectangle grid** clipped to the polygon. Then: no double-counting by construction, complete coverage is provable, and the tile list is a stable, resumable work queue. (Hex tiling is more efficient for circles; rectangles match `locationRestriction`'s actual shape and are the right choice here.)
- **Persist the tile grid as rows.** Each tile row gets `last_swept_at`, `result_count`, `saturated`, `subdivided_into`. This makes the crawl resumable mid-flight (a Remote-Control requirement from PROJECT.md), makes the rotating-partition schedule (Pitfall 2) trivial, and makes coverage auditable.
- **Coverage assertion, not coverage hope.** For one pilot city, get an independent count (TX Comptroller active-taxpayer rows for that city × NAICS, or an OSM/Overture POI count) and compare against your discovered count. A 10× gap is a tiling bug; a 2× gap is normal source divergence. Do this once per cluster in P1 and record the number.
- **Set `includePureServiceAreaBusinesses: true`** — see Pitfall 8.

**Warning signs:**
- Any tile with `result_count == 60` and `subdivided == false`.
- Discovered business count for a city that is flat across industry types (real markets are heavily skewed).
- More than ~30% of billed requests producing zero new `place_id`s (over-overlapping grid).
- Results whose `location` falls outside the county polygon.

**Phase to address:** Discovery phase (P1). The tile table is a P0 schema object; the saturation loop and the coverage assertion are P1 acceptance criteria.

---

### Pitfall 8: The trades cluster is excluded by default — service-area businesses have no address

**What goes wrong:**
Roofers, plumbers, HVAC techs, mobile mechanics, mobile detailers, cleaning services, landscapers, food trucks — the exact businesses in PROJECT.md's highest-ticket cluster — frequently register on Google as **service-area businesses** with **no physical address displayed**. Places API (New) marks these with `pureServiceAreaBusiness` (Pro tier) and, critically, **excludes them from search results unless you explicitly opt in** with `includePureServiceAreaBusinesses: true` (supported on Text Search (New) and Autocomplete (New)).

If you don't set it, you silently lose a large share of the single most valuable cluster — and there is no error, no warning, just a thinner result set that looks like "the RGV doesn't have many roofers."

There's a second-order effect: service-area businesses have no address, so **every address-based dedupe rule and every geo gate (Pitfall 6) fails on them**. A merge rule requiring `distance ≤ 250 m` will never merge two records for the same roofer because neither has coordinates you can trust.

**Why it happens:**
The parameter defaults to excluding them, and the default is invisible.

**How to avoid:**
- Set `includePureServiceAreaBusinesses: true` on every discovery Text Search. Put it in the same single-source request-builder module as the field mask (Pitfall 1) so it cannot be omitted per-call-site.
- Include `pureServiceAreaBusiness` in the field mask (it's Pro tier — you're already paying Enterprise, so it's free at the margin) and **store the flag**.
- **Branch the entity-resolution rules on it:** for `pureServiceAreaBusiness == true`, drop the geo gate and require name + phone agreement instead. Write this as an explicit code path with its own tests, not as a null-coalesce.
- Branch the **scoring** on it too — a service-area roofer with 80 reviews and no website is the single best lead this product can produce, and a scoring model tuned on storefronts will under-rank it.
- **Verify the parameter is honored** with a named test against a known RGV service-area business: assert it appears with the flag true and is absent with the flag false. If that test can't be written, the parameter isn't doing what you think.

**Warning signs:**
- The "home services & trades" cluster produces fewer businesses per city than "food & hospitality" (implausible in the RGV).
- Zero rows with `pure_service_area = true`.
- Dedupe clusters in the trades cluster are all singletons.

**Phase to address:** Discovery phase (P1) for the parameter; Resolution phase (P3) for the branched merge rules; Scoring phase (P4) for the branched weights.

---

### Pitfall 9: The hard cap that isn't — read-then-spend races, retry amplification, and duplicate cron runs

**What goes wrong:**
"Hard cap" is a concurrency problem disguised as a budget feature. Four distinct ways it leaks:

1. **Read-then-spend race.** The naive implementation is `SELECT sum(cost) FROM spend WHERE month = X; if (total < cap) callApi(); INSERT INTO spend ...`. Two workers both read $48, both decide they're under the cap, both spend. With Vercel's cron behavior (below), this is not hypothetical.
2. **Vercel cron invokes the same scheduled run more than once.** Vercel documents cron delivery as best-effort with **at-least-once** semantics: *"cron delivery can also occasionally invoke the same scheduled run more than once"*, and jobs *"should be designed to be idempotent."* It also does not guarantee timing — a job set for 01:00 fires somewhere in 01:00–01:59. And on the **Hobby plan, cron jobs can only run once per day** — a `*/15` expression fails deployment outright.
3. **Retry amplification.** Google bills *successful* requests. A request that returned 200 with `ZERO_RESULTS` is billable. A client that retries on *timeout* — where the request actually succeeded server-side — double-bills for nothing. Three retries on a 200-that-looked-like-a-timeout = 3× spend for 1 result set.
4. **Overlapping long runs.** A sweep that takes 25 minutes and a schedule that fires every 15 minutes means two sweeps running concurrently, both spending, both writing duplicate rows.

And the backstop everyone assumes exists does not: **a Google Cloud budget alert does not stop spending.** Verbatim from Google's docs: *"Setting a budget does not automatically cap Google Cloud or Google Maps Platform usage or spending... budget alert emails might prompt you to take action... but they don't automatically prevent the use or billing of your services."* Google Cloud's newer spend-cap feature does **not** currently cover Maps Platform.

**Why it happens:**
The cap is written as a business rule in application code, where it's a read followed by a write, and tested single-threaded.

**How to avoid:**
- **Reserve-then-spend, atomically.** One statement, no read first:
  - `UPDATE budget_period SET reserved_cents = reserved_cents + $1 WHERE period = $2 AND reserved_cents + $1 <= cap_cents RETURNING reserved_cents;`
  - Zero rows returned → cap reached → stop. Reconcile reserved vs. actual after each call. This is the only shape that is correct under concurrency, and it needs one named test that runs two concurrent reservations against a cap that only fits one.
- **A run lock, taken before the first paid call.** Either `pg_try_advisory_lock(hashtext(saved_search_id))` or a `runs` table with a unique partial index `ON runs (saved_search_id) WHERE status = 'running'`. Duplicate cron invocations then no-op cleanly instead of double-spending.
- **Make the run idempotent by construction.** Each run gets a deterministic `run_key` (e.g. `{saved_search_id}:{YYYY-MM-DD in America/Chicago}`); a second invocation for the same key attaches to the existing run rather than starting a new one.
- **Retry policy: only on 429 and 5xx, with jitter and a per-run retry budget. Never retry a request that returned 200.** On timeout, treat the outcome as *unknown* and charge the ledger anyway — pessimistic accounting is the safe direction.
- **Two independent caps.** (a) The app ledger. (b) A **per-API daily quota cap in the Google Cloud Console**, which actually stops requests ("once requests in your project reach that limit, your service stops responding"). Set the daily cap at ~1/25th of the monthly budget so a runaway loop costs at most one day. Document both in the runbook.
- **Firecrawl: never call `crawl`.** A single `crawl` on a business site can burn hundreds of credits. Use `scrape` with an explicit page limit, or `search`. Budget credits per candidate (search 2 credits/10 results + scrape 1 credit/page; stealth mode is **5 credits/page**) and record them in the same ledger as Places dollars so the cap covers both.
- **Vercel plan check:** the nightly schedule requires a Pro plan if you want anything finer than once-a-day. Confirm the plan before designing the schedule.

**Warning signs:**
- Two `runs` rows for the same saved search on the same Chicago day.
- Ledger total vs. Google Cloud billing diverging by more than a few percent (means calls happened outside the ledger).
- Retry counts > ~2% of requests.
- Any `SELECT` of a budget total that isn't inside the same statement as the `UPDATE`.

**Phase to address:** Scheduler + cost-governor phase (P5). The `budget_period` and `runs` tables belong in P0. The Cloud Console daily quota cap is a P1 setup task with a runbook entry — it must exist before the first automated sweep.

---

### Pitfall 10: Yelp Fusion's terms are incompatible with a persisted lead database

**What goes wrong:**
PROJECT.md lists Yelp as a layered source and requires detecting "Yelp-only businesses as a distinct, high-priority class." The Yelp API Terms of Use (version 2025-01-13) forbid essentially every part of that as normally implemented:

- **24-hour cache ceiling:** you may not *"cache, record, pre-fetch, or otherwise store any portion of the Yelp Content for a period longer than twenty-four (24) hours from receipt."*
- **No database building:** you may not *"modify the Yelp Content, or use it to update or create your own database of business listing information, unless such modification is for non-commercial analysis."*
- **No commercial use without consent:** you may not *"create or disclose metrics about, or perform any analysis of the API, or use Yelp Content for any commercial purpose without the express written consent of Yelp."*
- **No blending ratings:** you may not display Yelp ratings *"alongside or in conjunction with other user-generated content."* This directly forbids a lead score that mixes Yelp review counts with Google review counts.
- **Takedown on demand:** you must remove and destroy Yelp Content within 24 hours of a written request.
- Yelp Fusion moved to paid tiers; there is no free commercial path.

A lead database whose whole value is *persisting* business listings and *blending* signals into a score is a direct conflict.

Meta is a separate wall: the **Pages Search** endpoint requires the **Page Public Metadata Access** or **Page Public Content Access** feature, which requires **Business Verification plus App Review**, and PPMA is *superseded* by PPCA (you can't have both). Planning v1 around Graph API page search means planning around a review process you may not pass and cannot schedule.

**Why it happens:**
Both APIs have generous-looking free-tier docs and hostile terms pages. Nobody reads the terms until a takedown notice or an App Review rejection.

**How to avoid:**
- **Drop Yelp Fusion from v1.** Detect "Yelp-only" the way a human would: the verification web search returns a `yelp.com/biz/...` URL and nothing else. **Store the URL and the fact that it was found — never Yelp's ratings, review counts, addresses, hours, or photos.** A URL discovered via a third-party search index is not "Yelp Content" obtained from the Yelp API.
- **Same pattern for Meta.** Detect a `facebook.com/...` or `instagram.com/...` presence from search results. Do not scrape facebook.com directly (it blocks datacenter IPs, requires login for much content, and its automated-access terms are their own problem). Do not build v1 on Graph API page search.
- **Score only on Google's `rating` / `userRatingCount`** (already Enterprise-tier and already paid for). This sidesteps the blending prohibition entirely and makes the score explainable.
- **Attribution for Google data is required** where you display it: Google's Places policies require crediting Google (Google Maps logo, or the text "Google Maps" in space-constrained contexts, unmodified — no re-capitalization, no localization, no line wrapping), and require crediting the author when displaying photos or reviews with a link back to the source on Google Maps. The triage card showing a rating needs this. Put it in the design system in the mobile-triage phase, not as a compliance patch.
- If Yelp coverage later proves worth paying for, revisit with **written consent from Yelp** as the gate, and design the storage model around the 24-hour ceiling (fetch-at-view, never persist).

**Warning signs:**
- A `yelp_rating` or `yelp_review_count` column in a migration.
- Any table storing Yelp or Meta content with no TTL.
- A scoring function whose inputs include ratings from more than one platform.
- An App Review submission on the critical path of a milestone.

**Phase to address:** This is a **roadmap-shaping decision, not a phase task** — it should change the data-source list in PROJECT.md before the roadmap is written. Implementation lands in Verification (P2) and Scoring (P4). Attribution lands in the Mobile Triage phase (P6).

---

### Pitfall 11: Storing Google Places content as if it were yours

**What goes wrong:**
Google Maps Platform Service Specific Terms §3.2.3(b) restricts caching of Places content. The explicit exceptions are narrow:

- **Place IDs are exempt** from the §3.2.3(b) caching restriction and may be stored indefinitely. Google recommends refreshing IDs older than **12 months**, and that refresh is **free** (a Place Details request specifying only the ID field).
- **Latitude/longitude may be cached for up to 30 consecutive calendar days**, after which they must be deleted.

Note what is *not* granted: there is no stated 30-day right to persist `websiteUri`, `nationalPhoneNumber`, `displayName`, `rating`, or `userRatingCount`. The common folk-reading of "you can cache Places data for 30 days" overstates the license — the 30-day exception is written for lat/lng. The terms also prohibit scraping, and prohibit using the Services to create a substitute or competing product.

The failure mode: a `leads` table that is, structurally, a redistributable database of Google business listings — which is exactly what a lead-gen SaaS sells.

**Why it happens:**
The obvious schema is one wide `leads` table with all the Places fields on it. It's also the schema that is hardest to unwind later.

**How to avoid:**
- **Split the schema by provenance.** Two tables, from the first migration:
  - `places_cache` — Places-derived fields, keyed by `place_id`, with `fetched_at` and a **TTL sweep job that deletes rows past the retention window**. Treat 30 days as the ceiling, and shorter is safer.
  - `leads` — your own UUID PK, your derived verdict, your score, your receipts (which *you* generated by probing the open web), your triage state, `org_id`, and a `place_id` reference. This table survives the cache sweep.
- **The UI renders Places fields from `places_cache` with Google attribution; it renders your verdict and receipts from `leads` without.** The distinction should be visible in the component tree.
- **Push to BIS what you're entitled to push.** Name, phone, and address for a business you are about to call are operational contact data; a bulk export of Google's listing database is not. Push per-lead on acceptance (which PROJECT.md already specifies), never in bulk.
- **Write the retention policy down in the repo** (`docs/data-retention.md`) with the clause citations, and make the TTL sweep a tested job — not a comment saying "TODO: expire this."
- Get counsel to read §3.2.3–3.2.4 before this is a commercial product with paying customers. The engineering design above is the conservative reading; the legal question of what a lead-gen product may persist is not one to settle from documentation summaries.

**Warning signs:**
- A migration adding `website_uri`, `rating`, or `phone` directly to `leads`.
- No job that deletes anything.
- An export/CSV feature that emits Places-derived columns.

**Phase to address:** Foundations (P0) — this is a schema shape, and retrofitting it means rewriting every query. The TTL sweep job is P5 (scheduler) but its absence should block P0's definition of done.

---

### Pitfall 12: America/Chicago scheduling and "new since last run"

**What goes wrong:**
Five distinct bugs, all of which produce silently-wrong lead counts rather than errors:

1. **Vercel cron expressions are UTC.** A "2 AM Chicago" nightly job written as `0 7 * * *` is correct in CST and an hour off in CDT (and vice versa). The crawl drifts across the DST boundary twice a year and nobody notices because the leads still arrive.
2. **Spring forward: 02:00–02:59 America/Chicago does not exist** on the second Sunday in March. A job scheduled in that window in local time simply never runs that day. Fall back: 01:00–01:59 **happens twice** on the first Sunday in November — a job scheduled there runs twice, which, combined with Vercel's at-least-once delivery, means double spend on exactly the night nobody is watching.
3. **Day buckets computed in UTC.** `date_trunc('day', created_at)` on a `timestamptz` truncates in the session timezone (UTC on the server). Every lead created between 18:00 and 23:59 Chicago lands in *tomorrow's* bucket. The dashboard's "leads found today" is wrong for the six hours of the day danlo is most likely to look at it. This is the recorded BIS lesson — *Intl formats in the SYSTEM zone; `Date.UTC` anchors UTC midnight; Americas render the previous day* — reappearing in a new product.
4. **"New since last run" driven by wall-clock instead of a watermark.** `WHERE first_seen_at > now() - interval '1 day'` breaks whenever a run is late, is retried, or spans a DST transition. Worse: advancing the watermark on a run that failed halfway silently loses every lead discovered in the missing half — and nothing reports it.
5. **Locale.** `es-MX` vs `en-US` formatting in an SSR/hydration boundary produces a React hydration mismatch, and in a bilingual market the browser locale genuinely varies.

**How to avoid:**
- **Store everything `timestamptz`.** Never `timestamp`. No exceptions.
- **One exported constant `APP_TZ = 'America/Chicago'`.** Every day-bucket query uses `(created_at AT TIME ZONE 'America/Chicago')::date`. Every client-side format passes the zone explicitly to `Intl.DateTimeFormat`.
- **Schedule in UTC, but pick a UTC hour that is safe in both offsets** — e.g. `0 8 * * *` UTC = 02:00 CST / 03:00 CDT, both comfortably outside the DST gap and outside the repeated hour. Document why that hour was chosen, in `vercel.json`'s vicinity.
- **Watermarks, not wall clocks.** The `runs` table holds `watermark_from` and `watermark_to`; the next run starts at the last **successfully completed** run's `watermark_to`. A failed run does not advance it. Gaps and overlaps become visible as data rather than as absence.
- **Tests must pin zone AND locale, and must discriminate.** Per the BIS hard lesson: a fixture zone equal to the dev machine's zone proves nothing. Spy the `Intl.DateTimeFormat` constructor and assert the timezone argument; run the same instant through two zones and assert **opposite** verdicts. Include a test at 2026-03-08T02:30 America/Chicago (nonexistent local time) and one at 2026-11-01T01:30 (ambiguous local time).

**Warning signs:**
- A dashboard "today" count that changes when you look at it after 6 PM.
- Any `timestamp` column without `tz`.
- A run's lead count that is ~0 or ~2× normal on a DST Sunday.
- A test file with no explicit `TZ=` and no locale pin.

**Phase to address:** Foundations (P0) for the column types and the `APP_TZ` constant; Scheduler (P5) for the watermark and the DST-safe cron hour; every phase with dates for the test discipline.

---

### Pitfall 13: Supabase RLS in a "single-org for now" multi-tenant schema

**What goes wrong:**
The most dangerous configuration in this project is the one PROJECT.md describes: `org_id` on every table, but only one org in v1. **Every RLS bug is invisible** because there is nothing to leak *to*. The policies get written, never exercised, and the first real second tenant discovers them.

The specific mechanisms:

1. **The crawler runs as `service_role`, which bypasses RLS entirely.** Every ingest write must set `org_id` explicitly — there is no policy to catch a null or a wrong one. With one org, a wrong `org_id` is unobservable.
2. **`auth.uid()` does not work with Clerk.** Clerk uses string IDs; `auth.uid()` returns a UUID. Policies must read `auth.jwt() ->> 'sub'` and the Clerk org claim. Also: the **Clerk↔Supabase JWT template was deprecated 2025-04-01** in favor of Supabase's native Third-Party Auth integration — copying BIS's pattern may be copying the deprecated one. Verify against the Clerk version you install, and verify the exact org claim path (it has moved between Clerk session-token versions) with a live token, not from a blog post.
3. **RLS enabled with zero policies returns empty results, not errors** through PostgREST. An `UPDATE` policy without a matching `SELECT` policy makes updates **silently fail**.
4. **Tests that use the service-role client are blind.** This is the recorded BIS lesson verbatim: *serviceDb test fixtures are BLIND to column grants — only e2e/userDb/`withRollback`+`actAs` see them.* A suite that proves the policies work while running as service_role proves nothing.
5. **Performance:** `auth.jwt()` in a policy is re-evaluated **per row** unless wrapped as `(select auth.jwt())`, which promotes it to an InitPlan. On a leads table with tens of thousands of rows this is the difference between 5 ms and 5 s. And `org_id` needs an index — RLS predicates don't get one for free.
6. **Service-role key exposure.** `NEXT_PUBLIC_`-prefixing it, or importing the server Supabase client into a `"use client"` module. Related to the recorded BIS lesson that *a `"use client"` module's exports are client references in a server component* — the same boundary, the opposite direction, and both fail at runtime with a green typecheck.

**How to avoid:**
- **Two clients, two files, enforced.** `lib/db/service.ts` (service role, `import 'server-only'` at the top) and `lib/db/user.ts` (anon key + the Clerk token). A lint rule or a CI grep that fails if `SUPABASE_SERVICE_ROLE_KEY` appears anywhere but `service.ts`. Every user-facing request goes through `user.ts` so RLS applies.
- **Seed a second org in the test database from day one,** even though production has one. Every RLS test asserts org A cannot see org B's rows. This is the only way a single-tenant v1 can have tested multi-tenancy.
- **Test through the user client with `actAs`-style helpers and `withRollback`,** never through service role. Pin the expected SQLSTATE (`42501` for insufficient privilege vs `PGRST204`), never `status >= 400`. **One refused statement per transaction** — the first refusal aborts the tx and the next reports `25P02`. (All four of these are recorded BIS lessons that transfer unchanged.)
- **Watch the RLS test fail first.** Write the policy after the test; a policy test that has never been red has never been tested.
- Wrap every `auth.jwt()` call in a policy as `(select auth.jwt())`. Index `org_id` on every table. Consider a `SECURITY DEFINER` helper for membership lookups rather than a correlated `EXISTS` per row.
- **Ingest writes:** make `org_id` `NOT NULL` with no default, so a service-role insert that forgets it fails loudly instead of writing an orphan.

**Warning signs:**
- Any test file that imports the service-role client to assert user-visible behavior.
- A table with RLS enabled and no policies (Supabase's advisors surface this — check them).
- `EXPLAIN` on a leads query showing a filter re-evaluating a function per row.
- A migration adding a table without `org_id NOT NULL`.

**Phase to address:** Foundations (P0), with `/gsd-secure-phase` review. Re-verified in the BIS-integration phase (P8), which is where a service-role path most plausibly reaches user-facing data.

---

### Pitfall 14: PWA offline triage that serves another user's page, or double-pushes a lead

**What goes wrong:**
The mobile triage screen is the product's daily surface, and Next.js App Router + service workers has a specific set of traps:

1. **Caching authenticated HTML or RSC payloads.** The App Router fetches route data as `?_rsc=` requests. A default `stale-while-revalidate` runtime caching rule (which `next-pwa` and many Serwist recipes apply broadly) will cache those. Result: a stale lead list that never refreshes, and — if the device is ever shared or the auth state changes — one user's server-rendered payload served to another. This is a data-leak class bug, not a staleness bug.
2. **Precache pointing at deleted chunks.** Next.js build IDs change on every deploy. A precached HTML document referencing `/_next/static/<oldBuildId>/...` produces `ChunkLoadError` on a white screen for anyone who had the old SW active.
3. **iOS standalone-mode auth.** A PWA launched from the Home Screen can have a separate storage/cookie context from Safari. An OAuth round-trip to Clerk and back can drop the session, or open the provider in Safari and strand the user outside the app. This is a well-documented iOS PWA failure and it will not reproduce in Chrome DevTools or in the simulator.
4. **iOS platform gaps:** no `beforeinstallprompt` (so no install button — you need a manual "Add to Home Screen" coach); Web Push only when installed to the Home Screen (16.4+); storage eviction for sites without recent user engagement, which can delete a queued offline action.
5. **Offline accept → duplicate CRM push.** The user accepts a lead in a dead zone, the action queues, the app retries on reconnect, the first request had actually succeeded — BIS now has two contacts. Background Sync is Chromium-only; on iOS the replay happens on next foreground, which is exactly when a double-fire is most likely.
6. **`tel:` link details** that only show up on a real phone: iOS ignores extensions after `,`/`;`; numbers must be E.164-normalized or the dialer mangles RGV 956 numbers; a `tel:` anchor inside a swipeable card fires on swipe-release unless you gate on pointer movement; `tel:` does nothing on desktop, so the desk view needs a copy-to-clipboard fallback; and an `<a href="tel:">` nested in a `<button>` is invalid HTML that behaves inconsistently.

**How to avoid:**
- **Default the service worker to NetworkOnly and opt in explicitly.** Precache the app shell and static assets only. Explicitly exclude: `/api/*`, anything containing `_rsc`, any Clerk endpoint (`/__clerk/*`, the handshake routes), and every authenticated route's document. If a rule can't be stated as "this is safe to serve to a logged-out stranger," it doesn't get cached.
- **`skipWaiting` + `clientsClaim` + a version check that prompts reload.** And ship a kill-switch path: a route that unregisters the SW and clears caches, so a bad deploy is recoverable without asking a user to delete an app icon.
- **Client-generated idempotency keys.** Every triage action gets a UUID created **at the moment of the tap**, stored in IndexedDB with the action, and sent as the idempotency key. Replay uses the same key. This is what makes at-most-once possible across an unreliable link (see Pitfall 15).
- **Show queue state in the UI.** "3 actions pending sync" is the difference between a trustworthy offline app and one danlo stops believing. Silent queues are worse than no queue.
- **Test sign-in from an installed Home Screen icon on a real iPhone.** Not the simulator, not Chrome's device emulation. The recorded BIS lesson applies directly: *verify on device before iterating.* Add it to the phase DoD.
- **Normalize to E.164 at write time**, store the normalized form, render the pretty form, and link the normalized form. One function, tested against RGV 956 numbers with and without country code, with extensions, and with the `+52` numbers that appear in a border market.
- Per the BIS carry-overs: **painted values, not CSS custom properties, for anything a test pins**; Tailwind v4 uses `[var(--x)]` not `[--x]`; and screenshot the **real** screens in both themes on the built app, never a styleguide.

**Warning signs:**
- A lead card showing data that a hard refresh changes.
- `ChunkLoadError` in logs after any deploy.
- Two BIS contacts created within a few seconds of each other.
- Any Workbox/Serwist config with a broad `urlPattern` regex and a `StaleWhileRevalidate` strategy.
- Sign-in works on desktop and on mobile Safari but was never tried from the installed icon.

**Phase to address:** Mobile triage phase (P6), with `/gsd-ui-phase`. The idempotency-key contract is shared with the BIS handoff phase (P8) and should be designed once, in P6, and consumed in P8.

---

### Pitfall 15: CRM handoff duplicates, and webhook auth done from memory

**What goes wrong:**

**Duplicates.** Four independent sources: (a) the offline replay above; (b) a double-tap on Accept; (c) a network timeout where the POST actually succeeded; (d) the same business re-discovered next month under a new `place_id` and accepted again. Keying the BIS-side dedupe on **phone or name** makes it worse, not better — RGV phone reuse (Pitfall 6) will merge a roofer into a salon's contact record inside the CRM, which is a far more expensive bug than a duplicate.

**Webhook/endpoint auth.** The common mistakes, in order of how often they ship:
- Verifying an HMAC against the **parsed-and-re-serialized** body instead of the raw bytes. In Next.js App Router you must `await req.text()` **before** any `req.json()`, sign that exact string, and parse afterward. Key order and whitespace differ after a round-trip and the signature fails — or worse, someone "fixes" it by weakening the check.
- `===` instead of a constant-time compare.
- No timestamp in the signed payload → unlimited replay. Sign `{timestamp}.{rawBody}`, reject skew > 5 minutes, and store seen nonces.
- A bearer token in a query string (it lands in logs and in Vercel's request telemetry).
- No response-time budget: the receiver does the work inline, times out, the sender retries, and now you have (a) again.

**Internal labels escaping.** The BIS lesson that cost three occurrences — *`accounts.name` is the agency's internal label and keeps escaping to customers* — has an exact analogue here. The saved-search preset name ("RGV roofers — trial batch 2", "cheap leads test") must never become part of the contact's name, a customer-visible tag, or an SMS template variable downstream in BIS.

**How to avoid:**
- **Deterministic idempotency key: `siteless:{lead_id}`,** sent both as an `Idempotency-Key` header and in the body. BIS upserts on a **unique index over `(account_id, external_source, external_id)`**. Never on phone, never on name, never on a fuzzy match.
- **Store the returned BIS contact id on the lead** and make the push a hard no-op if it's present. Two guards, client-side and server-side.
- **Sign the raw body.** HMAC-SHA256 over `{timestamp}.{rawBody}`; `crypto.timingSafeEqual`; 5-minute skew window; nonce table with a TTL. Write one test that mutates a single byte of the body and asserts rejection, and one that replays a valid request twice and asserts the second is refused.
- **Tag allowlist.** The outbound payload's tag array is built from a **fixed allowlist** (`source:siteless`, `industry:*`, `city:*`, `score:*`) — never from a free-text field a user can edit. Add a **sentinel test that scans every outbound payload for any internal-label field** and fails if one appears. This is exactly the structural fix BIS landed after the third escape; inherit it rather than re-earning it.
- **Ack fast, work async.** The BIS endpoint returns 202 immediately and processes on a queue, so retries never overlap real work.
- **Contract test both sides.** A committed fixture of the exact payload Siteless sends, consumed by a BIS-side test. Otherwise the two repos drift and the failure surfaces in production as a 400 nobody reads.

**Warning signs:**
- Two BIS contacts with the same phone and a `source:siteless` tag.
- Any signature verification that calls `req.json()` before `req.text()`.
- A BIS contact whose name or notes contain a preset name, a score, or the word "trial".
- Idempotency implemented with a `SELECT ... IF NOT EXISTS ... INSERT` rather than a unique index.

**Phase to address:** BIS-integration phase (P8), with `/gsd-secure-phase`. The idempotency key format is agreed in P6 (where the offline queue is built). The BIS-side unique index is a **BIS repo prerequisite** — flag it as a cross-repo dependency in the roadmap so it isn't discovered on the day of integration.

---

### Pitfall 16: Compliance debt accrued in a milestone that "doesn't send anything"

**What goes wrong:**
v1 sends nothing, so compliance feels like a later-milestone concern. Three things make that wrong:

1. **A suppression list built after you already have leads is built too late.** Once the nightly crawl runs, a business that asks not to be contacted will be **re-discovered and re-queued every sweep**. Without a suppression table keyed independently of `place_id`, "we already told you no" becomes a recurring complaint in a market where danlo's reputation is the business. The table must survive re-discovery — key on normalized phone **and** normalized name+city **and** domain, and check it *before* a candidate enters the triage queue.
2. **Texas's mini-TCPA got harder on 2025-09-01.** Tex. Bus. & Com. Code Ch. 302's definition of "telephone solicitation" was amended to include **text and image messages**, so sellers texting to or from Texas need a Secretary of State registration certificate unless an exemption applies; and violations of Ch. 304/305 are now actionable under the **DTPA**, letting plaintiffs sue directly. BIS already sends SMS via Telnyx. If accepted Siteless leads get texted from BIS, **that is a registration question for BIS, today** — not a Siteless milestone-2 question. Escalate it as a business decision; it is not a code change.
3. **B2B is not a free pass, but it's not nothing either.** Texas exempts B2B calls from the Ch. 304 no-call list *unless the called business has made a do-not-call request to the calling business* — which is precisely what item 1's suppression table exists to record. Federally, the FCC's one-to-one consent rule was **vacated by the Eleventh Circuit in January 2025** (reverting lead-gen consent to prior express written consent without the one-to-one constraint), while the **consent-revocation rules took effect 2025-04-11** (honor revocation by any reasonable method, process within 10 business days). **CAN-SPAM has no B2B exemption** — any future email needs a physical postal address, a working opt-out honored within 10 business days, and accurate headers.

**Personal data of sole proprietors:** a sole proprietor's business cell and home-based business address are personal data in substance even where a statute's "commercial context" carve-out applies. The engineering answer is the same regardless of which way the legal one lands: **per-field provenance.** Every stored field carries where it came from and when. Without it you cannot honor a deletion request, cannot prove you didn't scrape, and cannot answer "where did you get my number?" on a call — which is the question a cold-called business owner actually asks.

**How to avoid:**
- **Build the `suppressions` table in P0.** Columns: normalized phone, normalized name+city key, domain, `place_id`, reason, `suppressed_at`, `org_id`. Check it in the candidate→lead promotion path. One test: suppress a business, re-run discovery, assert it does not re-enter the queue.
- **Per-field provenance from the first migration** — `source`, `source_url`, `fetched_at` on every enriched field, or a `field_provenance` side table. This is also what makes the "receipts" feature (the product's core value) real rather than cosmetic.
- **A `do_not_contact` boolean on the lead, honored by the triage UI** (no tap-to-call button) and by the outbound BIS payload (refuses to push). Manual calling in v1 is low-risk, but the flag has to exist before the first call, not after the first complaint.
- **Write `docs/compliance.md` in P0** listing: the Yelp 24-hour rule, the Google caching/attribution rules, the Texas Ch. 302 registration question, CAN-SPAM requirements, and the TCPA revocation timeline — each with a citation and an owner. It's a one-hour document that prevents the outreach milestone from starting with a research project.
- **Get counsel before the outreach milestone.** Statute text is verifiable; its application to this product is not something to settle from documentation summaries.

**Warning signs:**
- A business appearing in the triage queue twice in two months after being rejected.
- Any enriched field with no recorded source.
- Planning that treats outreach compliance as a milestone-2 discovery task.

**Phase to address:** Foundations (P0) for the suppression table, provenance columns, and `do_not_contact`. Triage (P6) for honoring the flag. The Texas Ch. 302 question is a **danlo/BIS business action, not a phase** — surface it in the roadmap as an external dependency.

---

### Pitfall 17: Stale verdicts, closed businesses, and review-count gaming

**What goes wrong:**
- **Verdict decay.** A business that got a website last week still shows no `websiteUri` for months, and your verdict still says "no website." The lead is stale and the call opens with a wrong premise — the exact credibility burn PROJECT.md is built to prevent. Google's data also lags reality in the other direction (businesses that closed).
- **Closed businesses.** `businessStatus` (Pro tier — free at the margin since you're already paying Enterprise) distinguishes `OPERATIONAL` / `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY`. Omitting it from the field mask fills the queue with closed businesses. Google is also slow to mark closures, so `businessStatus == OPERATIONAL` is a weak positive. `consumerAlert` (Essentials IDs-only tier, effectively free) flags listings Google itself considers suspicious — include it.
- **Review-count gaming.** `userRatingCount` is the most-gamed number in local search. Review swaps, purchased reviews, and review-gating are widespread; the FTC's Consumer Reviews and Testimonials Rule took effect **2024-10-21** with penalties up to ~$51,744 per violation, and the FTC issued its first warning letters in December 2025. A score that weights raw review count linearly systematically over-ranks the businesses most willing to game — which are not the businesses most likely to buy a website.
- **Score inflation across the board.** Any linear weighting on an unbounded count means the top of the queue is always the same handful of businesses, and the long tail never surfaces.

**How to avoid:**
- **Show verdict age on the triage card** ("verified 3 days ago"). Non-negotiable — it's the honest version of the product's core claim.
- **Re-verify before calling, not on a fixed global schedule.** TTL by verdict class: `real site` can last 90 days (it won't un-exist); `no presence` should be < 14 days old before it reaches the queue; `unverifiable` retries sooner. Cheap trick: hash `(place_id, websiteUri, displayName, phone)` and skip re-verification entirely when the hash is unchanged and the TTL hasn't expired — this is the single biggest lever on the verification budget.
- **Include `businessStatus` and `consumerAlert` in the field mask; filter `CLOSED_PERMANENTLY` out of the queue** and flag `CLOSED_TEMPORARILY` on the card rather than hiding it (a temporarily-closed business may still want a site).
- **Log-scale and cap the review-count contribution.** `min(log10(1 + userRatingCount) / log10(1 + 200), 1)` caps the benefit at ~200 reviews. Gaming past that buys nothing.
- **Treat suspiciously-perfect profiles as neutral, not positive:** rating ≥ 4.9 with 20–60 reviews is the classic purchased-review shape. Don't try to detect it properly — that needs the `reviews` field, which is Enterprise + **Atmosphere**, the most expensive SKU on the platform, and is not worth it. Cap the score instead.
- **Make the score explainable on the card.** Four labeled contributions summing to the total. An unexplainable score is one danlo will stop trusting after the third bad lead, and then the whole ranking is dead weight.

**Warning signs:**
- A lead marked "no website" whose verdict is older than the last sweep of its tile.
- Calls that reach a disconnected number more than occasionally.
- The top 20 of the queue unchanged week over week.
- A scoring function with no cap on any input.

**Phase to address:** Scoring phase (P4) for the weighting; Verification (P2) for TTLs and the input hash; Discovery (P1) for the `businessStatus`/`consumerAlert` field-mask inclusion; Triage (P6) for verdict age and score explainability.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip verification; ship Places-only "no website" leads | A working demo in a day | The product's entire differentiator is gone; the first 20 calls destroy credibility and there's no measurement to prove it | **Never** — this is the product |
| Store Places fields directly on `leads` | Simple schema, one table | Violates the caching license, makes the TTL sweep a rewrite, makes a lead die when its `place_id` does | **Never** — P0 schema decision |
| Use `place_id` as the lead primary key | Free natural key, easy dedupe | Google merges/splits listings; leads vanish or duplicate; triage history is orphaned | **Never** |
| `SELECT sum() then INSERT` for the budget cap | Readable, obvious | Races under Vercel's at-least-once cron; the "hard cap" isn't one | Never for money; fine for a display-only projection |
| Yelp Fusion for ratings and review counts | More signal per lead | 24-hour cache ceiling, no-database clause, no-blending clause — a takedown risk against the core table | Only with written Yelp consent and a fetch-at-view design |
| Facebook Graph API page search | "Official" social detection | Requires Business Verification + App Review you can't schedule; PPMA is superseded by PPCA | Post-v1, if social detection via search proves insufficient |
| `*` field mask in dev | Fast iteration | Ships; bills at Enterprise+Atmosphere; Google explicitly warns against it | Dev only, behind a type-level ban on the production path |
| Nearby Search instead of Text Search | Simpler request shape | No pagination, no saturation signal, unprovable coverage | Only for a genuinely small radius where < 20 results is known |
| Single wide `leads` table with no candidate state | Fewer joins | Unverified candidates leak into the queue; the FP rate becomes unmeasurable | Never — the state separation *is* the quality control |
| Fixed nightly full sweep | Matches the stated requirement literally | Blows the $50 cap in week two and stops producing leads | Never — replace with rotating partitions before P5 |
| Skipping the `unverifiable` verdict class | One less branch | Bot walls become false positives; enum change later is a cross-cutting migration | Never — it's a P0 enum value |
| `serviceDb` for RLS tests | Tests pass immediately | Proves nothing; the policies have never executed | Never (recorded BIS lesson) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Google Places (New)** | Search for IDs, then Place Details per place for `websiteUri` | Put the Enterprise field mask on the **search**; ~11× cheaper ($0.00175/place vs $0.02/place) |
| **Google Places (New)** | Field mask assembled per call site | One typed constant + `skuForFieldMask()` + a unit test per field |
| **Google Places (New)** | Omitting `includePureServiceAreaBusinesses: true` | Set it always; the trades cluster depends on it |
| **Google Places (New)** | Nearby Search for enumeration | Text Search + rectangle `locationRestriction` + `nextPageToken`; subdivide at 60 |
| **Google Places (New)** | Assuming a Cloud **budget** caps spend | Budgets only alert. Set a **per-API daily quota cap** in the console; Maps is not covered by Cloud spend caps |
| **Google Places (New)** | Persisting Places fields indefinitely | Place IDs indefinite (refresh > 12 mo, free); lat/lng ≤ 30 days; everything else in a TTL'd cache table |
| **Google Places (New)** | Displaying ratings with no attribution | "Google Maps" or the Google logo, unmodified; author credit + link for photos/reviews |
| **Google Places (New)** | `Promise.all` over 200 tiles | Rate limits are **per method per project**, per minute. Concurrency limiter (5–10) + token bucket + 429 backoff. Measure the actual QPM on day 1 — the default isn't published |
| **Yelp Fusion** | Storing ratings/listings in the leads DB | Don't use the API in v1. Detect a `yelp.com/biz/` URL from web search; store the URL only |
| **Meta Graph API** | Planning on Pages Search for v1 | Requires Business Verification + App Review; detect via web search results instead |
| **Firecrawl** | Calling `crawl` on a business domain | `scrape` with an explicit page limit, or `search`. Budget: search 2 cr/10 results, scrape 1 cr/page, **stealth 5 cr/page**. Hobby = 5,000 cr ≈ 1,000 candidates/mo |
| **Vercel Cron** | Assuming exactly-once, on-time delivery | At-least-once and drifts within the hour; **Hobby = once/day only**. Advisory lock + deterministic `run_key` |
| **Vercel Cron** | Local-time cron expression | Expressions are UTC. Pick a UTC hour safe in both CST and CDT (e.g. `0 8 * * *`) |
| **Supabase + Clerk** | Copying BIS's JWT-template integration | The JWT template was deprecated 2025-04-01; use native Third-Party Auth. `auth.uid()` is unusable (UUID vs Clerk string ID) |
| **Supabase** | Service-role client anywhere near user data | `import 'server-only'`, one file, CI grep. Every user request via the anon/authenticated client |
| **BIS inbound-lead endpoint** | Dedupe on phone or name | Unique index on `(account_id, external_source, external_id)`; idempotency key `siteless:{lead_id}` |
| **BIS webhook** | HMAC over the parsed body | `await req.text()` first, sign `{timestamp}.{rawBody}`, `timingSafeEqual`, 5-min skew, nonce table |
| **OSM / Overture** | Assuming one license covers both | Overture **Places** is CDLA-Permissive-2.0 + Apache-2.0 and carries **no** ODbL share-alike. Raw **OSM** is ODbL — joining it can make your derived database ODbL. Keep OSM-derived data in a separate, attributed table or skip it |
| **TX Comptroller** | Treating the address as a business location | It's a taxpayer/mailing address (often a CPA or registered agent). No phone, no website. Use for **corroboration of existence**, never as a location or contact source |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| RLS policy re-evaluating `auth.jwt()` per row | Lead list query time grows linearly with table size | `(select auth.jwt())` to force an InitPlan; index `org_id` | ~10k leads |
| Trigram similarity dedupe as O(n²) over all leads | Nightly run time grows quadratically; eventually exceeds the function timeout | Blocking key (normalized first token + city) + GIN trigram index; compare only within blocks | ~20k leads |
| Unbounded concurrency on Places tiles | Sudden 429 `RESOURCE_EXHAUSTED` bursts, partial sweeps | Concurrency limiter + token bucket + jittered backoff | First large sweep |
| Verification without an input hash | Firecrawl credits exhausted mid-month; verification stops | Skip when `(place_id, websiteUri, name, phone)` hash is unchanged and TTL is live | Month 2 |
| Receipts stored as unbounded JSONB with full page bodies | Table bloat, slow triage queries, Supabase storage cost | Store URLs, matched snippets (≤500 chars), and signal names — never full HTML | ~5k verified leads |
| Serverless function timeout on a full sweep | Runs truncate silently; watermark advances anyway | Tile-level work queue with per-invocation budget; watermark advances only on completion | First county-scale sweep |
| Service worker precaching the whole lead list | Install time and device storage grow with the queue | Precache the shell only; lead data via network with a small runtime cache | ~200 queued leads |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Service-role key reachable from a client bundle | Full database read/write, all orgs, bypassing RLS | `import 'server-only'`; CI grep for the env var outside `lib/db/service.ts`; never `NEXT_PUBLIC_` |
| RLS policies never exercised because v1 has one org | Multi-tenant leak on the first real second tenant | Seed a second org in the test DB; every RLS test asserts cross-org denial; watch it fail first |
| Ingest writes with a wrong or null `org_id` under service role | Orphaned or cross-org rows, invisible with one org | `org_id NOT NULL` with no default; explicit on every insert |
| BIS webhook verified against a re-serialized body, or with `===` | Forged lead injection into the CRM | Raw-body HMAC, `timingSafeEqual`, signed timestamp, nonce replay table |
| Places API key unrestricted | Key harvested from logs/config → someone else's bill on your card | Restrict by API **and** by IP/referrer; separate keys per environment; per-API daily quota cap as the blast-radius limiter |
| Receipts storing full scraped page bodies | Storing third-party content you have no license to retain; PII in a blob | Store URLs + matched snippets + signal names only |
| Service worker caching authenticated documents/RSC payloads | One user's data served to another on a shared device | NetworkOnly default; explicit exclusions for `/api/*`, `_rsc`, Clerk routes |
| No suppression check before queueing | Re-contacting a business that said no; DTPA/reputation exposure in Texas | `suppressions` check in the candidate→lead promotion path, keyed on phone + name/city + domain |
| Internal preset labels in the outbound BIS payload | Internal naming reaching a customer record (3× in BIS already) | Tag allowlist + a sentinel test scanning every outbound payload |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Verdict with no receipt, or receipts more than one tap away | Danlo can't justify the claim mid-call; stops trusting the queue | Receipts one tap from the card (already in PROJECT.md) — hold the line on it |
| No verdict age on the card | Calls open on a stale premise | "Verified 3 days ago" on every card; visually degrade past the TTL |
| Silent offline queue | Actions vanish; the user re-taps; duplicates in the CRM | Visible "N pending sync" chip + per-action state |
| Opaque score | The ranking is ignored and the queue is worked top-to-bottom anyway | Four labeled contributions summing to the total, on the card |
| Tap-to-call firing on swipe | Accidental calls to strangers — the worst possible failure on a sales tool | Pointer-movement threshold before treating a release as a tap; confirm step for calls |
| `unverifiable` leads mixed into the queue | Bot-walled sites presented as "no website"; false positives on calls | Separate bucket, separate UI, never in the main queue |
| Chains in the queue | Wasted calls to franchisees who can't buy | Suppress chain clusters before triage; show a "chain?" badge on anything borderline |
| No "why was this surfaced" on a rejected lead | The FP rate is a number with no diagnosis | On "actually has a site," capture the URL the user found — that's the training data for improving verification |
| Desk view that's just the mobile view widened | Deep dives and setup are unusable | Genuinely different layout; `/gsd-ui-phase` on both |

## "Looks Done But Isn't" Checklist

- [ ] **Places client:** field mask is a single typed constant, `skuForFieldMask()` has a test per field, `*` is unreachable from production, `includePureServiceAreaBusinesses: true` is set — verify by grepping for `X-Goog-FieldMask` and finding exactly one occurrence.
- [ ] **Tiling:** every tile row has `saturated` computed, and **no tile has `result_count == 60 && subdivided == false`** — verify with a SQL assertion after the first sweep.
- [ ] **Coverage:** one pilot city × one cluster has been compared against an independent count (Comptroller or Overture) and the ratio recorded — verify the number exists in `.planning/`.
- [ ] **Verification:** the `unverifiable` class exists in the enum, fires in real runs, and is excluded from the queue — verify by counting rows per class after a sweep.
- [ ] **Verification:** `*.business.site` resolves to `dead`, not `real site` — verify with a named test.
- [ ] **Parked detection:** the soft-404 probe is implemented (random path vs. homepage) and its result appears in receipts — verify on a known parked domain.
- [ ] **Dedupe:** `needs_review` merge queue is non-empty and non-dominant; no merge exists across > 25 km; no merge exists on phone alone — verify with SQL.
- [ ] **Budget cap:** a test runs two concurrent reservations against a cap that fits one and asserts exactly one succeeds — verify the test fails when the `UPDATE ... WHERE ... RETURNING` is replaced with read-then-write.
- [ ] **Budget cap:** the Google Cloud **per-API daily quota cap** is set in the console and recorded in the runbook — verify in the console, not from memory.
- [ ] **Scheduler:** duplicate invocation of the same `run_key` is a no-op — verify by invoking the cron route twice and asserting one `runs` row and one set of charges.
- [ ] **Timezone:** tests exist at 2026-03-08T02:30 and 2026-11-01T01:30 America/Chicago; day-bucket queries use `AT TIME ZONE`; the cron UTC hour is DST-safe and the reason is documented.
- [ ] **RLS:** a second org exists in the test DB and every policy test asserts cross-org denial through the **user** client; each was seen red before green; SQLSTATEs are pinned.
- [ ] **Retention:** the `places_cache` TTL sweep exists, is scheduled, and has deleted rows in a real run — verify by row count over time, not by reading the job.
- [ ] **Attribution:** Google attribution renders on every surface showing Places content, unmodified — verify by screenshotting the built app in both themes, not the styleguide.
- [ ] **PWA:** sign-in works from an **installed Home Screen icon on a real iPhone**; no cache rule matches `_rsc` or `/api/*`; a kill-switch unregister route exists.
- [ ] **Offline:** accept → airplane mode → reconnect produces **exactly one** BIS contact — verify end to end on a device.
- [ ] **BIS handoff:** the unique index on `(account_id, external_source, external_id)` exists **in the BIS repo**; a replayed webhook is refused; a single-byte body mutation is refused.
- [ ] **Compliance:** `suppressions` is checked before queueing and survives re-discovery; every enriched field has provenance; `do_not_contact` suppresses the call button.
- [ ] **FP rate:** the metric is computed and displayed from the first accepted lead, not from a later dashboard phase.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Budget blown mid-month | LOW | Cloud Console daily quota cap stops the bleeding immediately; ledger reconciliation finds the leak; pause the schedule and re-run the cost model |
| Wildcard/over-broad field mask shipped | LOW | One-line fix + the SKU test that should have caught it; the bill is the only lasting cost |
| Coverage holes from unsubdivided tiles | MEDIUM | Tile table makes it a re-run of specific tiles, not a full sweep — but only if the tile grid was persisted. Without it, full re-sweep at full cost |
| Wrong merges in production | MEDIUM | Recoverable only if merges are recorded as an append-only `merge_events` log with the deciding signals. Without it, unmergeable. **Log merges from day 1** |
| Places content persisted past the license window | MEDIUM | Add the TTL sweep, backfill-delete, document the remediation. Cheap technically; the exposure is the point |
| Yelp/Meta data in the leads table | MEDIUM | Drop the columns, purge, re-derive from URLs only. Painful if the score depends on them |
| Duplicate BIS contacts | MEDIUM | Merge in BIS by hand (small volumes) and add the unique index. If BIS automations already fired on the duplicates (reminders, review requests), the customer-facing damage is done |
| Multi-tenant leak discovered with a real second tenant | HIGH | Incident response, notification, full policy audit. This is why the second test org exists in P0 |
| A business re-contacted after saying no | HIGH | Unrecoverable reputationally in a market this size. Suppression table in P0 is the only prevention |
| False positives burning calls | HIGH | No technical recovery — credibility with a prospect is spent once. The FP metric exists to catch the trend before it's a pattern |

## Pitfall-to-Phase Mapping

Phase labels below are **suggested** — map them to whatever the roadmap names.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Field mask → SKU | P1 Discovery | Unit test per field; mutation test raises the tier; one grep hit for `X-Goog-FieldMask` |
| 2. Budget doesn't fit nightly | **Cost model in P1**, enforcement in P5 | Committed test asserting modelled monthly cost ≤ cap for the real cell list |
| 3. Absent `websiteUri` ≠ no site | Schema in P0, logic in P2 | FP rate measured from lead #1; candidate/lead states enforced by constraint |
| 4. Present `websiteUri` ≠ has site | P2 Verification | Named test: `*.business.site` → `dead`; host-pattern table has non-zero hits per class |
| 5. Missing `unverifiable` class | **Enum in P0**, logic in P2 | Non-zero `unverifiable` count after a real sweep; excluded from queue by policy |
| 6. Bilingual entity resolution | Schema (two name fields, lead UUID) in P0; algorithm in P3 | SQL assertions: no phone-only merges, none > 25 km, `needs_review` non-empty |
| 7. Tiling coverage + double-count | Tile table in P0, loop in P1 | No `result_count == 60 && !subdivided`; independent coverage comparison recorded |
| 8. Service-area businesses excluded | P1 Discovery; branched rules in P3/P4 | Named test with a known RGV service-area business, flag on and off |
| 9. Cap races / retries / duplicate crons | `budget_period` + `runs` in P0; enforcement in P5 | Concurrent-reservation test; double cron invocation → one run, one charge set |
| 10. Yelp/Meta ToS | **Roadmap decision before planning**; P2/P4 | No Yelp/Meta content columns in any migration; score has one rating source |
| 11. Places caching/attribution | Schema split in P0; TTL sweep in P5; attribution in P6 | TTL job has deleted rows; attribution visible in built-app screenshots, both themes |
| 12. Timezone / watermarks | `timestamptz` + `APP_TZ` in P0; watermark + cron hour in P5 | DST-boundary tests; failed run does not advance the watermark |
| 13. Supabase RLS | P0 Foundations + `/gsd-secure-phase` | Second test org; cross-org denial through the user client; pinned SQLSTATEs |
| 14. PWA cache / offline / tap-to-call | P6 Mobile Triage + `/gsd-ui-phase` | Real-iPhone installed-icon sign-in; airplane-mode replay → one contact |
| 15. CRM duplicates / webhook auth | P8 BIS Integration + `/gsd-secure-phase`; key format agreed in P6 | Replay refused; byte-mutation refused; unique index exists in the BIS repo |
| 16. Compliance debt | P0 (suppressions, provenance, `do_not_contact`); external action for Ch. 302 | Suppress → re-run discovery → assert not re-queued; `docs/compliance.md` exists |
| 17. Stale verdicts / closures / review gaming | P1 (`businessStatus`), P2 (TTL + input hash), P4 (log-scale cap), P6 (verdict age) | No queued lead with a verdict older than its TTL; score caps proven by test |

**Ordering consequences for the roadmap:**

- **P0 carries unusually heavy load here.** Nine of seventeen pitfalls are prevented by schema decisions: candidate-vs-lead states, the six-value verdict enum, two name fields, lead-UUID vs `place_id`, `places_cache` vs `leads`, `suppressions`, `do_not_contact`, per-field provenance, `budget_period`, `runs`, the tile grid, `timestamptz` everywhere, `org_id NOT NULL`. Each is cheap now and a cross-cutting migration later. **Resist the urge to make P0 small.**
- **The cost model must precede the scheduler design**, and it may invalidate the "nightly" requirement in PROJECT.md. That's a PROJECT.md amendment at the P1→P2 transition, not a P5 surprise.
- **The Yelp/Meta decision should be made before the roadmap is written**, because it changes the data-source list and the scoring inputs.
- **Two phases warrant `/gsd-secure-phase`:** P0 (RLS, service-role boundary, key restrictions) and P8 (webhook auth, cross-repo idempotency). PROJECT.md currently names the crawler/ingest and BIS phases — add P0.
- **The BIS-side unique index is a cross-repo prerequisite.** Surface it as an external dependency at roadmap time so P8 doesn't start blocked.

## Sources

**Google Maps Platform (HIGH confidence — official documentation and terms, fetched 2026-09-20):**
- Places API usage and billing, incl. "billed at the highest SKU applicable" — https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Place Data Fields (New), full SKU-to-field tier tables — https://developers.google.com/maps/documentation/places/web-service/data-fields
- Core services pricing list (per-1,000 prices, per-SKU monthly free caps) — https://developers.google.com/maps/billing-and-pricing/pricing
- March 2025 pricing changes (free caps replace the $200 credit; 10,000/5,000/1,000 per SKU) — https://developers.google.com/maps/billing-and-pricing/march-2025
- Text Search (New): `pageSize` ≤ 20, 60-result cap, `locationRestriction` rectangle-only — https://developers.google.com/maps/documentation/places/web-service/text-search
- Nearby Search (New): `maxResultCount` ≤ 20, no pagination, 50,000 m radius cap — https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Choose fields / wildcard warning — https://developers.google.com/maps/documentation/places/web-service/choose-fields
- Places policies: attribution, photo/review credit, prohibited practices — https://developers.google.com/maps/documentation/places/web-service/policies
- Place IDs: §3.2.3(b) caching exemption, 12-month refresh, free ID-only refresh — https://developers.google.com/maps/documentation/places/web-service/place-id
- Manage costs: budgets alert but do not cap; quota limits do stop requests — https://developers.google.com/maps/billing-and-pricing/manage-costs
- Cloud spend caps (Maps not covered) — https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps
- Maps Platform Service Specific Terms — https://cloud.google.com/maps-platform/terms/maps-service-terms *(§3.2.3/3.2.4 text retrieved indirectly via the Place IDs doc; the page truncated on direct fetch — MEDIUM confidence on the exact scope of the 30-day exception beyond lat/lng)*
- `pureServiceAreaBusiness` / `includePureServiceAreaBusinesses` — https://developers.google.com/maps/documentation/places/web-service/release-notes
- Google Business Profile websites shut down 2024-03-05, redirects ended 2024-06-10 (`*.business.site` now 404) — https://www.searchenginejournal.com/websites-created-with-google-business-profiles-to-shut-down-in-march/509794/ and https://www.seroundtable.com/google-business-profiles-websites-now-shut-down-36999.html

**Yelp / Meta (HIGH confidence — official terms and docs):**
- Yelp API Terms of Use (2025-01-13): 24-hour cache, no-database, no-blending, no-commercial-use clauses — https://terms.yelp.com/developers/api_terms/20250113_en_us/
- Yelp display requirements — https://terms.yelp.com/developers/display_requirements/
- Meta Page Public Metadata Access (business verification + App Review; superseded by PPCA) — https://developers.facebook.com/docs/features-reference/page-public-metadata-access/
- Meta Pages API Search Pages — https://developers.facebook.com/docs/pages-api/search-pages/

**Platform behavior (HIGH/MEDIUM):**
- Vercel cron: at-least-once delivery, timing drift, Hobby once/day — https://vercel.com/docs/cron-jobs/manage-cron-jobs and https://vercel.com/docs/limits
- Firecrawl pricing / credit model (Hobby $19 = 5,000 credits; search 2 cr/10 results; stealth 5 cr/page) — https://www.firecrawl.dev/pricing
- Supabase + Clerk third-party auth (JWT template deprecated 2025-04-01; `auth.uid()` unusable with Clerk) — https://supabase.com/docs/guides/auth/third-party/clerk and https://clerk.com/changelog/2025-03-31-supabase-integration
- Supabase service-role / RLS troubleshooting — https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z
- Overture Places licensing (CDLA-Permissive-2.0 + Apache-2.0, no ODbL share-alike; joining OSM can trigger ODbL) — https://docs.overturemaps.org/guides/places/ and https://overturemaps.org/about/faq/

**Compliance (MEDIUM — statutes and firm analyses verified; application needs counsel):**
- Texas mini-TCPA amendments effective 2025-09-01 (text/image messages = telephone solicitation; Ch. 304/305 violations actionable under DTPA) — https://www.rothjackson.com/blog/2025/06/amendments-to-texas-mini-tcpa-take-effect-on-september-1-2025/
- Tex. Bus. & Com. Code Ch. 302 registration and exemptions — https://statutes.capitol.texas.gov/docs/BC/htm/BC.302.htm and https://www.sos.state.tx.us/statdoc/faqs3400.shtml
- Eleventh Circuit vacated the FCC one-to-one consent rule (Jan 2025) — https://www.mcguirewoods.com/client-resources/alerts/2025/1/delayed-one-to-one-consent-rule-gives-companies-reprieve-plus-other-tcpa-updates/
- TCPA revocation rules effective 2025-04-11 — https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025.html
- FTC Consumer Reviews and Testimonials Rule, effective 2024-10-21 — https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials

**Technique (MEDIUM — research literature and practitioner sources, synthesized):**
- "Parking Sensors: Analyzing and Detecting Parked Domains" (NDSS) — https://www.ndss-symposium.org/wp-content/uploads/2017/09/01_2_2.pdf
- Detecting parked domains — false-positive rates of naive methods — https://w-shadow.com/blog/2009/11/13/detecting-parked-domains/
- Entity resolution needs and challenges (same-name/different-location, shared addresses, PO boxes) — https://towardsdatascience.com/an-introduction-to-entity-resolution-needs-and-challenges-97fba052dde5/
- Places tiling/subdivision practice — https://blog.apify.com/google-places-api-limits/

**Carried over from BIS (HIGH — danlo's own recorded post-mortems; see `reference_hard_lessons.md`):**
- Internal labels escaping to customers (`accounts.name`, 3 occurrences) → two-name-field rule and the outbound sentinel test
- `serviceDb` fixtures blind to grants; pin SQLSTATE; one refused statement per `withRollback`
- Timezone tests must discriminate — spy the constructor, pin zone **and** locale, one instant / two zones / opposite verdicts
- Painted values not CSS custom properties; Tailwind v4 `[var(--x)]`; `"use client"` exports are client references in a server component
- `delivered`/`notified_at` is an attempt, never receipt; a state mirror that quietly doesn't fire is invisible to classification
- Verify on device before iterating; screenshot the real screens in both themes on the built app

---
*Pitfalls research for: no-website local-business lead discovery (Places API + verification + budgeted scheduling + mobile triage + CRM handoff)*
*Researched: 2026-09-20*
