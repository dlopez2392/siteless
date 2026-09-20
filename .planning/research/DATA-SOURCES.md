---
title: Data Sources & Legality — Siteless
date: 2026-09-20
dimension: data-sources
confidence: HIGH
---

# Data Sources & Legality — Siteless

> All prices below were read from official pricing pages on **2026-09-20**. Google's Places
> pricing was extracted from the raw HTML of the official price list (SKU IDs included) rather
> than a summarizer, because the whole budget design rests on it. Third-party sources are
> labelled inline.

## Summary

Three findings reorder the plan in `PROJECT.md`.

**1. The Google Maps Platform Terms of Service forbid the thing Siteless was designed to do
with Places data.** Not the calling — the *storing*. §3.2.3(a) lists "copy and save business
names, addresses, or user reviews" as an example of prohibited scraping; §3.2.3(d)(iii)
forbids using the Core Services "in a listings or directory service"; and the only caching
permission granted for Places in the Maps Service Specific Terms (§B.14.3) is **latitude and
longitude for 30 days**, plus `place_id` indefinitely under §A.3. There is no permission to
persist `websiteUri`, `displayName`, `formattedAddress`, `nationalPhoneNumber`, `rating`, or
`userRatingCount`. Internal-only use is not a carve-out: the licence is to use the Services "in
Customer Application(s)", and "Google Maps Content" is defined to include "places data
(including business listings)". This is the single highest-consequence decision in the project
and it needs danlo's own legal call — but the architecture should be built so the answer can be
"no" without a rewrite.

**2. The free public data is better than expected, and it is legally clean.** Two sources
were tested empirically rather than assumed:

- **Overture Maps places**, queried live against the `2026-08-19.0` release via DuckDB over S3:
  **57,494 places in the four RGV counties on the Texas side**, of which **19,414 have no
  website** and **16,882 have a Facebook page but no website** — the exact "social-only" class
  that `IDEA.md` calls the hottest lead. Licence is CDLA-Permissive-2.0 / Apache-2.0 / CC0:
  commercial use, storage and redistribution all permitted, no share-alike.
- **Texas Comptroller Active Sales Tax Permit Holders**, queried live via the Socrata API:
  **34,928 RGV outlets**, refreshed **2026-09-19** (yesterday), licence **Public Domain**, and
  it carries `outlet_name` (the DBA), `outlet_address`, `outlet_county_code` and
  `outlet_naics_code`. **38% of RGV records are sole proprietors** (`organization_type = IS`),
  which answers the enumeration question in the brief: the *sales tax* list reaches
  sole proprietors even though the *franchise tax* list cannot.

**3. The $50 budget is not the constraint anyone thought it was.** `websiteUri` is an
**Enterprise**-tier field, which sounds expensive — but Text Search bills **per request**, not
per result, and returns up to 20 places per request. That makes the true cost
**$1.75 per 1,000 businesses surfaced**, and Google's free cap of 1,000 Text Search Enterprise
requests/month covers roughly **15,000–20,000 businesses per month at $0**. The entire RGV
four-cluster universe fits inside the free tier. Meanwhile **Text Search Essentials (IDs Only)
is free and unlimited**, which makes nightly change-detection cost literally nothing. The real
recurring spend is Firecrawl at **$16–19/month**. Projected steady state: **~$21–24/month**.

The recommended shape is therefore the inverse of the brief's: **Overture + Comptroller are the
primary enumerators** (free, storable, commercially licensed), **Places is the authoritative
verifier** whose output is consumed and discarded rather than stored, and **Firecrawl is the
receipts layer**. Yelp, Meta, SerpApi, Apify and OSM are all skips for v1, each for a different
and specific reason.

| Source | Role | $/1,000 businesses | Storable? | Confidence |
|---|---|---|---|---|
| Google Places (Text Search Enterprise) | Verification | **$1.75** (first ~15–20k/mo free) | ❌ place_id + latlng only | HIGH |
| Google Places (Text Search IDs Only) | Change detection | **$0.00** unlimited | ✅ place_id indefinitely | HIGH |
| Overture Maps Places | **Primary enumerator** | **$0.00** | ✅ commercial, no share-alike | HIGH |
| TX Comptroller sales tax permits | **Primary enumerator** | **$0.00** | ✅ public domain | HIGH |
| Firecrawl | Verification receipts | ~$9.60/1,000 candidates | ✅ (customer indemnity) | HIGH |
| Domain probing (self-hosted) | Verification | $0.00 | ✅ own observations | MEDIUM |
| County DBA filings | Gap-fill, manual | $0.00 + labour | ✅ public records | MEDIUM |
| TX SOS bulk | — | $1,350–1,750/snapshot | ✅ | MEDIUM |
| OSM / Overpass | — | $0.00 | ⚠️ ODbL | HIGH — **skip** |
| Yelp Fusion | — | $229/mo floor | ⚠️ display terms | HIGH — **skip** |
| Meta Graph API | — | n/a | n/a | HIGH — **skip** |
| SerpApi | — | ~$0.75 + $75/mo floor | ⚠️ derived from Google | MEDIUM — **skip** |
| Apify Google Maps | — | $1.50 | ⚠️ derived from Google | HIGH — **skip** |

---

## Source-by-source

### (a) Google Places API (New)

#### Endpoint choice

| Endpoint | Max results | Pagination | Billing unit | Verdict |
|---|---|---|---|---|
| **Text Search** | 20/page, **60 total across 3 pages** | `nextPageToken` → `pageToken` | per request | **Use this** |
| Nearby Search | `maxResultCount` 1–20, **no pagination** | none | per request | Corner cases only |
| Place Details | 1 place | n/a | per request | Single-place re-check only |

Text Search is the only endpoint that enumerates: "Text Search (New) returns a maximum of 60
results across all pages, although this limit is subject to change." Nearby Search (New) caps
at 20 with no `nextPageToken` at all, so it can never see business 21 in a dense McAllen
commercial strip. That makes Nearby Search useless as a primary sweep in exactly the places
Siteless cares about most.

Geography parameters differ in a way that affects the saved-search design:

- `locationBias` accepts a **circle (radius 0–50,000 m)** or a rectangle, and is a *bias* —
  results may fall outside it.
- `locationRestriction` on Text Search accepts a **rectangle only** and is a hard constraint.

So "radius around a point" (a requirement in `PROJECT.md`) can only be a *bias* on Text Search,
not a restriction. Results must be re-filtered client-side against the true radius, and against
the county/state, or the sweep will bleed across the border — see the Overture section for how
badly that bites in the RGV.

`rankPreference` is `RELEVANCE` (default for categorical queries) or `DISTANCE`. `includedType`
biases to a **single** type from Table A; Nearby Search allows up to 50 types per category.

#### Field-mask → SKU mapping (the load-bearing table)

Billing is driven entirely by the field mask: *"You are then billed at the highest SKU
applicable to your request."* From the official data-fields reference:

| Field Siteless wants | SKU tier |
|---|---|
| `id` | Essentials (IDs Only) |
| `formattedAddress`, `location`, `types`, `addressComponents` | Essentials |
| `displayName`, `businessStatus`, `primaryType`, `primaryTypeDisplayName`, `googleMapsUri` | **Pro** |
| **`websiteUri`** | **Enterprise** |
| **`nationalPhoneNumber`**, `internationalPhoneNumber` | **Enterprise** |
| **`rating`**, **`userRatingCount`** | **Enterprise** |
| `regularOpeningHours`, `priceLevel` | Enterprise |
| `reviews`, `editorialSummary`, `generativeSummary` | Enterprise + Atmosphere |

**Every single field Siteless's detector and scorer need — website, phone, rating, review count
— is Enterprise.** `businessStatus` and `primaryType` are Pro, which is free-riding under
Enterprise. Nothing Siteless needs is Atmosphere, so the mask must be policed in code to never
accidentally include `reviews` or `editorialSummary` — that one slip moves every request from
$35 to $40/1,000 (+14%).

#### Prices (official global price list, read 2026-09-20; page last-updated 2026-09-17)

Free caps are **monthly, per SKU**, aggregated across all projects on the billing account.

| SKU | SKU ID | Free cap/mo | Cap–100k | 100k–500k | 500k–1M | 1M–5M | 5M+ |
|---|---|---|---|---|---|---|---|
| Text Search Essentials (IDs Only) | `635D-A9DD-C520` | **Unlimited** | — | — | — | — | — |
| Place Details Essentials (IDs Only) | `5C36-E272-E88F` | **Unlimited** | — | — | — | — | — |
| Place Details Essentials | `6E05-E1C3-8D85` | 10,000 | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Place Details Pro | `4ED6-464A-2AFC` | 5,000 | $17.00 | $13.60 | $10.20 | $5.10 | $1.28 |
| Text Search Pro | `4FDA-34B1-A910` | 5,000 | $32.00 | $25.60 | $19.20 | $9.60 | $2.40 |
| Nearby Search Pro | `99F9-A108-83A6` | 5,000 | $32.00 | $25.60 | $19.20 | $9.60 | $2.40 |
| Place Details Enterprise | `2D9A-3DE0-3766` | 1,000 | $20.00 | $16.00 | $12.00 | $6.00 | $1.51 |
| **Text Search Enterprise** | `E967-44BC-B44D` | **1,000** | **$35.00** | $28.00 | $21.00 | $10.50 | $2.63 |
| Nearby Search Enterprise | `772E-9975-BE34` | 1,000 | $35.00 | $28.00 | $21.00 | $10.50 | $2.63 |
| Place Details Enterprise + Atmosphere | `EB23-5ECC-F753` | 1,000 | $25.00 | $20.00 | $15.00 | $7.50 | $2.28 |
| Text Search Enterprise + Atmosphere | `120C-BEC3-B48F` | 1,000 | $40.00 | $32.00 | $24.00 | $12.00 | $3.40 |
| Nearby Search Ent. + Atmosphere | `F20E-7034-0EF7` | 1,000 | $40.00 | $32.00 | $24.00 | $12.00 | $3.40 |
| Place Details Photos | `DCD1-FE97-8C71` | 1,000 | $7.00 | $5.60 | $4.20 | $2.10 | $0.53 |

**The $200 credit is gone — confirmed.** Effective **1 March 2025**, Google "replaced the USD
$200 monthly recurring credit with a free monthly usage threshold for each Core Services SKU."
The caps above (10,000 Essentials / 5,000 Pro / 1,000 Enterprise) are the replacement. Nothing
in the docs says unused free usage rolls over; assume it does not.

#### Cost per 1,000 businesses surfaced — showing the arithmetic

Text Search bills **per request** and returns **up to 20 places per request**. So:

```
cost_per_1000_businesses = (1000 / results_per_request) × (price_per_1000_requests / 1000)
```

| Path | Requests per 1,000 businesses | Arithmetic | **$/1,000 businesses** |
|---|---|---|---|
| Text Search Essentials (IDs Only) | 50 | 50 × $0.000 | **$0.00** |
| Text Search Pro | 50 | 50 × $0.032 | **$1.60** |
| **Text Search Enterprise @ 20/req** | **50** | **50 × $0.035** | **$1.75** |
| Text Search Enterprise @ 15/req (realistic) | 66.7 | 66.7 × $0.035 | **$2.33** |
| Text Search Enterprise + Atmosphere | 50 | 50 × $0.040 | **$2.00** |
| Nearby Search Enterprise | 50 | 50 × $0.035 | **$1.75** |
| Place Details Essentials | 1,000 | 1,000 × $0.005 | **$5.00** |
| Place Details Pro | 1,000 | 1,000 × $0.017 | **$17.00** |
| **Place Details Enterprise** | **1,000** | **1,000 × $0.020** | **$20.00** |
| Place Details Enterprise + Atmosphere | 1,000 | 1,000 × $0.025 | **$25.00** |

Use 15 results/request as the planning number, not 20 — the last page of every query is
partial, and RGV type-queries in small towns (Roma, Raymondville, La Feria) will return far
fewer than 20.

**Text Search Enterprise is 11.4× cheaper per business than Place Details Enterprise.** Never
enumerate with Place Details. Reserve it for "re-check this one specific lead".

**Free-tier headroom:** 1,000 Text Search Enterprise requests/month × 15 results =
**~15,000 businesses/month at $0**. That is the whole RGV four-cluster universe.

#### Caching, storage and attribution — the part that changes the architecture

Quoted verbatim from the **Google Maps Platform Terms of Service** (read 2026-09-20):

> **3.2.3 Restrictions Against Misusing the Services.**
> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content
> for use outside the Services. For example, Customer will not: (i) pre-fetch, index, store,
> reshare, or rehost Google Maps Content outside the services; (ii) bulk download Google Maps
> tiles, Street View images, geocodes, directions, distance matrix results, roads information,
> **places information**, elevation values, and time zone details; (iii) **copy and save business
> names, addresses, or user reviews**; or (iv) use Google Maps Content with text-to-speech services.
>
> **(b) No Caching.** Customer will not cache Google Maps Content except as expressly permitted
> under the Maps Service Specific Terms.
>
> **(c) No Creating Content From Google Maps Content.** Customer will not create content based on
> Google Maps Content. … (vii) use Google Maps Content to improve machine learning and artificial
> intelligence models…
>
> **(d) No Re-Creating Google Products or Features.** … For example, Customer will not: … (iii)
> **use the Google Maps Core Services in a listings or directory service** or to create or augment
> an advertising product…
>
> **(e) No Use With Non-Google Maps.** … Customer will not (i) **display or use Places content on
> a non-Google Map**…

And the definition that closes the escape hatch:

> **"Google Maps Content"** means any content provided through the Services (whether created by
> Google or its third-party licensors), including map and terrain data, imagery, traffic data, and
> **places data (including business listings)**.

The only caching permissions, from the **Maps Service Specific Terms**:

> **A.3 Google ID Caching.** Customer may cache the Google ID values from the Services that return
> such field and allow caching, in accordance with its Documentation. For example, Customer may
> cache (a) **place_id** from Places API, Directions API, Geolocation API and Routes API…
>
> **B.14 Places API (Legacy and New).**
> **14.1 Use without a Google Map.** Customer may use Google Maps Content from the Places API in
> Customer Applications without a corresponding Google Map.
> **14.2 No use with a non-Google map.** Customer must not use Google Maps Content from the Places
> API in conjunction with a non-Google map.
> **14.3 Caching.** Customer may temporarily cache **latitude and longitude values** from the
> Places API for up to **30 consecutive calendar days**, after which Customer must delete the
> cached latitude and longitude values.

**That is the complete list.** `place_id` forever; lat/lng for 30 days; nothing else. The Places
API Policies page adds the attribution rule: attribution "should take the form of the Google
Maps logo whenever possible. In cases where space is limited, the text **Google Maps** is
acceptable."

One relief: **14.1 explicitly permits using Places content without a Google Map**, so Siteless
does not have to render a map. But **14.2 / 3.2.3(e)** mean that if a lead-detail screen ever
shows a Mapbox or Leaflet/OSM map next to Places-derived content, that is a direct violation.

**What this means concretely.** The `PROJECT.md` requirement *"System ingests businesses for a
search from Google Places API (New) and flags those with no `websiteUri` as candidates"* is
compliant only if "ingests" means "reads and discards". A `leads` table holding
`name, address, phone, rating, review_count` sourced from Places is squarely within the
3.2.3(a)(iii) example. The `no-website` verdict itself is arguably "content based on Google Maps
Content" under 3.2.3(c).

The design that survives:

- Store **`place_id`** (permitted indefinitely) as the join key and dedupe anchor.
- Store **lat/lng** only if a 30-day TTL delete job exists — or just take coordinates from
  Overture instead and sidestep it entirely. **Prefer Overture.**
- Take **name, address, phone, category** from **Overture or the Comptroller**, which permit
  storage. Never from Places.
- Treat the Places response as a **transient signal**: read `websiteUri`, write only a derived
  observation (`checked_at`, `had_website_uri: bool`, `source: places`) keyed to `place_id`.
  Even this is a judgement call under 3.2.3(c); it is the minimum-exposure version.
- Never render Places content beside a non-Google map.
- Show "Google Maps" attribution wherever a Places-derived signal is displayed.

**Rate limits:** *"The rate limit per minute is per API method per project. In other words, each
API method has a separate quota."* Google does not publish the default QPM number in the docs —
read it from Cloud Console → Google Maps Platform → Quotas once the project exists. Community
reports put it in the hundreds of QPS (LOW confidence, third-party). Not a v1 constraint at
these volumes, but the scheduler should hold a token bucket anyway.

**Recommendation: PRIMARY — but verification-only, not a storage source.** Use Text Search with
a strict Enterprise-and-below field mask as the authoritative `websiteUri` oracle. Use Text
Search Essentials (IDs Only) — free, unlimited — for nightly change detection. Persist nothing
but `place_id` and derived observations. Build the ingestion layer behind an interface so that
if danlo's lawyer says "don't touch it", swapping Places for the Overture+probe path is a
config change, not a rewrite.
**Confidence: HIGH** — prices and SKU IDs pulled from the official price list HTML; ToS and
Service Specific Terms quoted verbatim from `cloud.google.com/maps-platform/terms`.

---

### (b) Texas Comptroller & Texas Secretary of State

#### Active Sales Tax Permit Holders — the one that matters

Socrata dataset `jrea-zgmq` on `data.texas.gov`. Verified live via the Socrata API on
2026-09-20:

- **Licence: `PUBLIC_DOMAIN`** (`license: {"name":"Public Domain"}`), attribution "Texas
  Comptroller of Public Accounts". No restriction on commercial use or storage.
- **`rowsUpdatedAt`: 2026-09-19** — refreshed the day before this research. Cadence appears
  daily-to-weekly; treat as "check `rowsUpdatedAt`, re-pull on change" rather than assuming.
- **887,244 rows statewide.**
- Access: Socrata SoQL over HTTPS, no key needed for modest volume (register an app token to
  avoid throttling). CSV/JSON export also available.

Fields: `taxpayer_number, taxpayer_name, taxpayer_address, taxpayer_city, taxpayer_state,
taxpayer_zip_code, taxpayer_county_code, taxpayer_organization_type, outlet_number,
**outlet_name**, **outlet_address**, outlet_city, outlet_state, outlet_zip_code,
**outlet_county_code**, **outlet_naics_code**, outlet_inside_outside_city_limits_indicator,
outlet_permit_issue_date, outlet_first_sales_date`.

`outlet_name` is the **trade name / DBA at the physical location** — precisely the name a
customer would search for, and precisely what Siteless needs to match against Places and
Overture. `outlet_naics_code` gives clean industry-cluster filtering for free.

**RGV coverage, measured.** County codes confirmed by query: **Cameron 031, Hidalgo 108,
Starr 214, Willacy 245**.

| County | Outlets |
|---|---|
| Hidalgo (108) | 21,062 |
| Cameron (031) | 12,313 |
| Starr (214) | 1,226 |
| Willacy (245) | 327 |
| **RGV total** | **34,928** |

By the four target clusters (NAICS ranges, RGV only):

| Cluster | NAICS | Outlets |
|---|---|---|
| Home services & trades | 23xxxx (238xxx = 919) | 1,452 |
| Food & hospitality | 721xxx + 722xxx | 5,572 |
| Personal care & health | 8121xx (767) + 621xxx (210) | 977 |
| Auto & retail | 8111xx (933) + 44–45xxxx (15,044) | 15,977 |
| **Total** | | **~23,978** |

**Sole proprietors are in this dataset.** RGV `taxpayer_organization_type` distribution:
`CL` (LLC) 13,303 · **`IS` (individual/sole proprietor) 13,209** · `CT` (TX corporation) 3,488 ·
`CF` 1,436 · `CI` 1,358 · `PI` 668 · `PL` 565. **38% of RGV records are sole proprietors** — the
segment the brief worried was invisible.

**The caveat that matters:** a sales tax permit exists only if the business sells taxable goods
or services. Texas does not tax most personal services, which is exactly why **personal care
shows only 767 RGV outlets** — a barbershop that sells no product never appears. So this list
under-counts pure-service businesses (barbers, house cleaners, some trades) and over-counts
retail. It is a strong *corroborator* and a strong enumerator for food/retail/auto, and a weak
one for personal care. Pair it with Overture, which has the opposite bias.

#### All Permitted Sales Tax Locations (`3kx8-uryv`)

Licence `PUBLIC_DOMAIN`, updated 2026-09-14. Four years of history including
**`out_of_business_date`** — the only free source that tells you a business *closed*. Worth
ingesting purely as a suppression signal so Siteless never calls a dead business.

#### Active Franchise Taxpayers (`9cir-efmm`)

Updated 2026-09-19. Fields: `taxpayer_number, taxpayer_name, taxpayer_address, taxpayer_city,
taxpayer_state, taxpayer_zip, taxpayer_county_code, taxpayer_organizational_type,
record_type_code, responsibility_beginning_date, secretary_of_state_sos_or_coa_file_number,
sos_charter_date, sos_status_date, sos_status_code, right_to_transact_business_code,
current_exempt_reason_code, exempt_begin_date`.

**No NAICS. No DBA/outlet name. No physical location — only the mailing address.** And by
construction franchise tax under Tax Code Ch. 171 applies to entities registered with the SOS,
so **sole proprietors and general partnerships are absent**. The brief's hypothesis is
**confirmed: the franchise tax list cannot enumerate unregistered DBAs or sole proprietors.**
It is near-useless for Siteless. Use the sales tax list instead.

#### Texas Secretary of State

SOSDirect charges a **$1.00 statutorily authorised fee per search** — unusable for bulk.
Bulk data products run **$1,350–$1,750 per snapshot** (Master Unload, daily/weekly updates;
fixed-record .txt and CSV) — 27× the entire monthly budget for one snapshot, and it still
carries no NAICS and no DBA trade names. *(Pricing figures are third-party summaries of the
SOSDirect bulk-order help page; treat as MEDIUM.)*

**Recommendation: Active Sales Tax Permit Holders — PRIMARY enumerator and corroborator.**
Ingest the RGV slice (34,928 rows, ~24k in target clusters) on a `rowsUpdatedAt` watch. Ingest
`3kx8-uryv` for `out_of_business_date` as a suppression list. **Skip Active Franchise Taxpayers**
(no NAICS, no DBA, no sole props). **Skip Texas SOS entirely** (cost, and it adds nothing).
**Confidence: HIGH** for the sales-tax and franchise datasets (queried live, licence and schema
read from the Socrata metadata API). **MEDIUM** for SOS bulk pricing (third-party).

---

### (c) Overture Maps — Places theme

#### Access

Free, no account, no key. Current release **`2026-08-19.0`** (confirmed via the STAC catalog at
`https://stac.overturemaps.org/catalog.json`, whose `latest: true` child points at it).

```sql
INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;
SET s3_region='us-west-2';
SELECT id, names.primary, websites, socials, phones, confidence,
       addresses[1].locality, addresses[1].region, basic_category
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*',
  hive_partitioning=1)
WHERE bbox.xmin BETWEEN -99.30 AND -97.00
  AND bbox.ymin BETWEEN  25.78 AND  26.98;
```

Alternatives: the `overturemaps` Python CLI (`pip install overturemaps`, `overturemaps download
--bbox=... --type=place`), the browser Explorer, and Azure blob mirrors. **Release cadence is
monthly**, published on the calendar — next is `2026-09-23.0`.

🔴 **`2026-09-23.0` is three days away and is a quarterly *major breaking change* release.** The
places guide states the deprecated **`categories` property will be removed in September 2026**,
replaced by `taxonomy` and `basic_category`. Build against `basic_category` from day one — it is
already populated for **56,255 of 57,494** RGV rows (97.8%), so there is no reason to touch the
legacy field.

#### Schema

`id`, `names`, `addresses`, **`websites`** (string[]), **`socials`** (string[]), **`phones`**
(string[]), `emails`, `brand`, `categories` (deprecated), `taxonomy`, `basic_category`,
**`confidence`** (0–1 existence score), `sources`, `geometry`.

`confidence` is "a value between 0 and 1 representing the likelihood that the place exists";
records ≤0.2 are filtered out upstream, and Overture advises treating it as "a relative
filtering tool rather than a precise probability."

#### RGV coverage — measured, not estimated

Full bbox (`-99.30..-97.00`, `25.78..26.98`): **99,782 places**. Filtered to
`country='US' AND region='TX'`: **57,494**.

🔴 **The bbox pitfall is severe.** Unfiltered, the two largest "RGV cities" are **Reynosa
(20,297)** and **Matamoros (15,096)**, with Río Bravo (3,317) fourth. **42% of a naive RGV bbox
is Mexico.** Any geography preset built on a lat/lng box — including the "radius around a point"
requirement — must filter on `region='TX'`/`country='US'` or clip to county polygons, or nearly
half of every sweep is unreachable leads across an international border. This applies equally to
the Places API `locationBias` circle.

Texas-side RGV, n = 57,494:

| Metric | Count | % |
|---|---|---|
| Has website | 38,080 | 66.2% |
| **No website** | **19,414** | **33.8%** |
| Has social | 44,170 | 76.8% |
| Has phone | 51,838 | 90.2% |
| **Social-only (social, no website)** | **16,882** | **29.4%** |
| Confidence ≥ 0.5 | 51,269 | 89.2% |

Highest-value categories (Texas-only, confidence ≥ 0.5):

| Category | Total | No website | % |
|---|---|---|---|
| health_and_medical | 993 | 693 | 69.8% |
| mexican_restaurant | 1,307 | 624 | 47.7% |
| beauty_salon | 976 | 593 | 60.8% |
| restaurant | 1,013 | 537 | 53.0% |
| automotive_repair | 773 | 475 | 61.4% |
| barber | 536 | 330 | 61.6% |
| party_and_event_planning | 599 | 352 | 58.8% |
| day_care_preschool | 290 | 174 | 60.0% |
| home_service | 306 | 165 | 53.9% |
| bar | 276 | 163 | 59.1% |
| tire_dealer_and_repair | 278 | 145 | 52.2% |

Source mix (Texas-only): `meta` 42,669 · `Overture-signals` 35,483 · `Microsoft` 6,136 ·
`BrightQuery` 5,192 · `Foursquare` 2,160 · `AllThePlaces` 762 · `DAC` 570 · `RenderSEO` 5.
Overture's places theme **does not include OpenStreetMap data**.

⚠️ **Interpret `socials` carefully.** Of ~45,700 RGV social URLs, **43,979 are facebook.com** —
Twitter 795, Instagram 405, TikTok 325. That is an artifact of Meta contributing 74% of records,
each with its Facebook page ID attached. So "has a Facebook page" is near-universal in Overture
and is **not** by itself evidence of a deliberate social-only strategy. What it *is*: a free,
storable, directly-linkable **receipt** — the actual Facebook URL to show on the lead card. The
social-only *classification* should still come from the Firecrawl/probe pass; Overture supplies
the URL, not the verdict.

#### Licence

Places is multi-licensed by source: **CDLA-Permissive-2.0** (Meta, Microsoft, PinMeTo, Krick,
RenderSEO, DAC, BrightQuery), **Apache-2.0** (Foursquare), **CC0-1.0** (AllThePlaces). All three
permit commercial use, storage, modification and redistribution. CDLA-Permissive-2.0 has **no
share-alike**: *"This agreement does not impose any restriction or obligations with respect to …
Results"* (§3.1), and the only obligation on sharing is to *"make available the text of this
agreement with the shared Data"* (§2.1). Foursquare requires the notice "Copyright 2024
Foursquare Labs, Inc. All rights reserved."

Practical obligation for Siteless: an attribution block listing Overture and its providers, and
— if data is ever exported to a customer — the CDLA text alongside. Nothing blocks the product.

**Recommendation: PRIMARY enumerator.** It is free, monthly-fresh, commercially licensed,
storable without share-alike, and it has **1.6× more RGV businesses than the Comptroller list
and 21× more than OSM**. It supplies the storable name/address/phone/category/social-URL spine
that Places legally cannot. Ingest the TX-filtered RGV extract monthly into Supabase; key on
Overture `id`; join to `place_id` opportunistically.
**Confidence: HIGH** — all coverage figures produced by direct DuckDB queries against the
official S3 release on 2026-09-20; licence read from the official attribution page and the CDLA
text.

---

### (d) OpenStreetMap via Overpass

Tested live against `overpass-api.de` on 2026-09-20, querying the four RGV county admin
boundaries for `shop=*`, `craft=*`, `office=*`, business-type `amenity=*`, and
`leisure=fitness_centre`.

**Result: 2,674 business features in all four counties.** 2,416 carry a `name`.

| Metric | Count | % |
|---|---|---|
| `website` tag | 904 | 33.8% |
| `contact:website` tag | 7 | 0.3% |
| **Any website** | **911** | **34.1%** |
| **No website** | **1,763** | 65.9% |
| `phone`/`contact:phone` | 1,082 | 40.5% |
| `contact:facebook` | **57** | 2.1% |
| `contact:instagram` | **24** | 0.9% |

Top tags: `amenity=fast_food` 335 · `amenity=restaurant` 294 · `amenity=fuel` 259 ·
`shop=convenience` 172 · `shop=clothes` 106 · `amenity=bank` 81 · `shop=supermarket` 76.

**OSM's RGV coverage is 4.6% of Overture's** (2,674 vs 57,494), and what it does have is
dominated by exactly the wrong businesses — national fast-food, fuel stations, banks and
supermarkets, all of which have corporate websites. The `contact:facebook` tag, which is the one
thing OSM could uniquely contribute, appears **57 times in four counties**. The RGV is simply
not a well-mapped-for-POIs region.

**ODbL is a real complication for marginal value.** The OSMF geocoding guideline says individual
results are "insubstantial database extracts" that "may be stored and used together with other
proprietary or third party data without having a share-alike impact on such other data" — but it
also says that *systematically* aggregating "substantially all features of a given type" across
"city-sized or larger areas" creates a Derivative Database and triggers share-alike. A nightly
sweep of every shop/craft/office in four counties is, on its face, the systematic-aggregation
case, not the individual-lookup case. Doing it would put an ODbL share-alike argument over a
commercial lead database — to gain 57 Facebook URLs.

**Recommendation: SKIP for v1.** Cost of ingestion (Overpass rate limits, tag normalisation,
county-polygon handling) plus a live ODbL share-alike question, in exchange for a rounding error
of incremental coverage. Revisit only if Siteless expands to a metro where OSM POI density is
actually good (Austin, Dallas) — and even then, prefer Overture.
**Confidence: HIGH** — coverage measured directly via Overpass; ODbL position read from the
OSMF community guideline.

---

### (e) County assumed-name (DBA) filings

Filed with the **county clerk**, not the state. Texas assumed-name certificates are valid up to
**10 years** from filing. All four RGV counties accept filings in person or by mail; the form is
a PDF.

Online searchability, probed directly on 2026-09-20:

| County | Portal | HTTP | Assumed names indexed? |
|---|---|---|---|
| Hidalgo | `hidalgo.tx.publicsearch.us` | **200** | Yes (official records search) |
| Cameron | `cameron.tx.publicsearch.us` | **200** | Yes — the county lists "Assumed Names" among indexed record types |
| Starr | `starr.tx.publicsearch.us` | **200** | Yes |
| **Willacy** | `willacy.tx.publicsearch.us` | **DNS failure** | **No portal found** |

Three of four counties use the same **PublicSearch** (Kofile) platform, which is good news for
uniformity and bad news for automation: it is a human-facing search UI with **no documented
public API and no bulk export**. Retrieval is per-document, images are typically paywalled per
page, and scraping it is a ToS question of its own. Willacy — the smallest county, 327 sales-tax
outlets — appears to have no online index at all.

There is also no NAICS, no phone, and no website field on an assumed-name certificate. It gives
you: assumed name, owner name(s), owner address, filing date. Its unique value is the **one
business type nothing else catches — the unincorporated sole proprietor with no sales tax
permit**, e.g. a lawn-care operator or a house cleaner.

**Recommendation: SKIP for automated v1; keep as a documented manual play.** The automation cost
(three scraped portals with no API, one county with nothing, per-page fees) is disproportionate
to a segment that also tends to have no reviews and no Google presence — i.e. low-scoring leads
under Siteless's own scoring model. Better: let the 13,209 RGV sole proprietors already in the
Comptroller sales-tax list cover this need, and add a manual "look up a DBA" link on the lead
detail screen pointing at the county portal.
**Confidence: MEDIUM** — portal existence probed directly (HIGH); the absence of an API/bulk
export is inferred from the platform's public surface, not from a vendor statement.

---

### (f) Yelp Fusion API

**Pricing (official Yelp Data Licensing pricing page, read 2026-09-20):**

| Plan | Monthly | Overage per 1,000 calls | Included |
|---|---|---|---|
| Base | **$229/month** | $5.91 | Base attributes (15), no photos, no review excerpts |
| Enhanced | **$299/month** | $6.57 | 23 attributes, ≤3 photos, ≤3 review excerpts |
| Premium | **$643/month** | $14.13 | 66 attributes, ≤12 photos, Review Highlights, AI API early access |

All plans include **5,000 free calls during a 30-day trial**. Above 150,000 monthly calls you
must contact sales. *(Third-party reporting adds a 30,000-calls/month default with a 5,000/day
cap and 3–15 QPS by tier — LOW confidence, not found on Yelp's own pages.)*

**The entry price is 4.6× the entire monthly data budget.**

**There is no business-website field — confirmed.** The `url` field is documented as *"URL for
business page on Yelp"* — the Yelp profile, not the business's own site. The documented business
object is `id, alias, name, image_url, is_closed, url, review_count, categories, rating,
coordinates, transactions, price, location, phone, display_phone, attributes`. Yelp's own GitHub
issue tracker carries long-running requests for a website field (#103, #622) that were never
satisfied; the community read is that Yelp deliberately returns its own pages. So Yelp **cannot
detect a website at all** — it can only tell you a business exists on Yelp.

That is not nothing conceptually — "on Yelp, not on the web" is the `directory-only` class in
`PROJECT.md`. But Overture already tells you the business exists, and Firecrawl already tells
you whether a Yelp page is the only thing that surfaces for it, for pennies.

**Recommendation: SKIP.** $229/month minimum for a source that structurally cannot answer the
product's core question. The `directory-only` classification is better and far more cheaply
served by the Firecrawl verification pass noticing that every result for "Taquería X McAllen" is
a `yelp.com/biz/...` URL. `PROJECT.md` already lists the Yelp paid tier as out of scope "only if
research shows they add coverage worth the budget" — research says no.
**Confidence: HIGH** — pricing from Yelp's official pricing page; field list from Yelp's own
OpenAPI reference.

---

### (g) Meta Graph API / Facebook Pages

**There is effectively no consent-free discovery path, and this is settled.**

- `GET /search?type=place` was **deprecated in v8.0 and removed across all versions on
  2 November 2020**.
- The general Graph search endpoints were deprecated in 2019; there is no public page-search
  replacement.
- The Pages API operates on pages **you have a token for** — i.e. pages whose owner granted your
  app access. That is consent by definition, and Siteless's whole premise is discovering
  businesses that have not heard of it.
- Page Public Content Access exists but requires App Review with a qualifying business use case,
  and is not granted for lead generation / prospecting.

**The practical alternative is the one the brief already guessed:** a web search for
`"<business name>" <city> facebook`, which is a Firecrawl `search` call costing **2 credits
(~$0.0064 at Hobby rates)**. Plus — and this is the better answer — **Overture already ships the
Facebook URL**: 43,979 facebook.com URLs across RGV-Texas, free and storable. Meta is not
needed to find Facebook pages; Overture hands them over.

**Recommendation: SKIP entirely.** Do not build a Meta integration, do not create a Meta app.
Get Facebook URLs from Overture (free, storable, 43,979 of them in RGV) and confirm liveness
with a plain HTTP probe of the URL. Fall back to Firecrawl search only when Overture has no
social for a candidate.
**Confidence: HIGH** — deprecation dates from Meta's own developer documentation and the
Graph API changelog; the Overture figure is measured.

---

### (h) Firecrawl

**Pricing (official pricing page, read 2026-09-20 — prices shown are per month, billed
annually):**

| Plan | Price | Credits/month | Equivalent | Concurrency | Scrape/Map/Search rate limit |
|---|---|---|---|---|---|
| Free | $0 | 1,000 | 500 searches or 1,000 pages | 2 | 10/min |
| **Hobby** | **$16/mo billed yearly** (~$19 monthly; "Save $38"/yr) | **5,000** | **2,500 searches** or 5,000 pages | 5 | 100/min |
| Standard | $83/mo billed yearly | 100,000 | 50,000 searches | 25 | 500/min |
| Growth | $333/mo billed yearly | 500,000 | — | — | 5,000/min |
| Scale | $599/mo billed yearly | 1,000,000 | — | — | 10,000/min |

Hobby and Standard sell top-ups: **1,000 extra credits per $5** (Hobby), 2,000 per $5
(Standard). That top-up is the cleanest way to implement a soft budget valve.

**Credit costs:**
- **Search: 2 credits per 10 results, rounded up** — "1–10 results = 2 credits, 11–20 = 4
  credits, and so on."
- **Scrape / Crawl / Map: 1 credit per page.**
- With `scrapeOptions` on a search, "the standard scraping costs apply to each search result" —
  so scraping all 10 results of a search costs 2 + 10 = 12 credits. **Scrape selectively.**
- JSON/extract mode adds ~4 credits per page.

**The `/search` endpoint** takes `query`, `limit`, `sources` (`web`/`news`/`images`),
`categories`, `scrapeOptions`, **`location`** (geographic result customisation — set this to
Texas), and `tbs` (time filter). Each result returns `url`, `title`, `description`, `category`,
and `markdown` when scraping is on. This is exactly the shape Siteless's receipts need: the
query string, the result URLs, and the timestamp all become the audit trail.

**Verification recipe and unit cost:**

```
1 search  ("<name>" <city> TX, limit=10)                     = 2 credits
1 scrape  (best non-directory candidate URL, when one exists) = 1 credit
                                                        total ≈ 3 credits/candidate
```

At Hobby ($16 / 5,000 credits = **$0.0032/credit**): **$0.0096 per candidate**, or
**$9.60 per 1,000 candidates verified**. Free tier covers ~333 candidates/month; Hobby covers
~1,666.

**Terms.** Firecrawl's ToS is silent on ownership of scraped output and does not authorise
commercial use of results in so many words — it says "The Services are only for the uses
specified in this Agreement". Users warrant compliance with "all applicable laws and
regulations" and with "applicable data privacy and security laws, including the GDPR or CCPA",
and give Firecrawl a broad indemnity for "any and all third-party claims … arising from … your
use of Services". Net: **Firecrawl pushes compliance risk onto the customer.** Siteless is
responsible for what it searches for and what it stores. Since Siteless stores *its own
observations* about public web pages (URL seen, at what time, classified how) rather than
republishing page content, this is a low-risk posture — but do not cache scraped page bodies
long-term; store the URL, the classification, and a short excerpt.

**Recommendation: PRIMARY verification layer — start on Free, move to Hobby.** This is the
differentiator in `IDEA.md` ("verification is the product, not the crawl") and it is the only
genuinely recurring line item. Start on Free (1,000 credits) during development; move to Hobby
($16–19) the moment nightly triage starts. Use `location` pinned to Texas. Never enable
`scrapeOptions` across a whole result set — search first, pick one URL, scrape that.
**Confidence: HIGH** — plans, credits and rate limits from the official pricing page; credit
costs quoted from the official `/search` documentation.

---

### (i) SerpApi and Apify Google Maps actors

**SerpApi.** Free 250 searches/month (50/hour throughput); Developer $75/month for 5,000
searches ≈ **$0.015/search**; 54 tiers up to $106,050/month. Google Maps engine returns
`local_results` with name, address, phone, GPS, rating, reviews, hours, type, `place_id` — and
the documented field list **does not include the business website**, which is the one field
Siteless actually needs. Pagination is offset-based (`start`, +20/page, recommended max offset
100 ≈ 6 pages). SerpApi advertises a **"U.S. Legal Shield … up to $2 million in coverage for the
scraping and parsing of search engine data"**, which is a meaningful signal about where the risk
sits but is a commercial indemnity, not a licence from Google. At 20 results/search that is
~$0.75/1,000 businesses on top of a $75/month floor.

**Apify `compass/crawler-google-places`.** **$1.50 per 1,000 scraped places**, pay-per-event,
and it **does** return the website field, plus optional paid enrichments (social profiles,
contacts, emails). Apify platform: Free $0 with **$5/month** included usage; Starter $19/month
with $19 included; Scale $199. Pay-per-event draws from those credits. The actor's own page
says "Web scraping is legal if you are extracting publicly available data, which is most data on
Google Maps" and recommends consulting counsel — i.e. the actor disclaims, it does not indemnify.

**Neither adds anything Places API (New) doesn't — and the price argument evaporates.**

| Path | $/1,000 businesses with website | Source of authority |
|---|---|---|
| Places Text Search Enterprise | **$1.75** | Google, licensed |
| Apify Google Maps actor | **$1.50** | Scraped from Google |
| SerpApi Google Maps | ~$0.75 + $75/mo floor | Scraped from Google, no website field |

Apify is **17 cents per 1,000 businesses cheaper** than the licensed first-party API, and that
comparison ignores Google's 1,000-request/month free cap, which makes Places **$0** at RGV
scale. Paying a scraper a rounding error to assume Google's ToS risk — when `PROJECT.md`'s own
constraint reads *"no direct Google Maps scraping"* and *"scraping services are secondary /
verification only"* — is a bad trade with no upside.

There is also a subtler problem: both services derive their data from Google, so using them to
"verify" a Places result is not independent verification. It is the same source laundered. The
verification pass must reach the **open web** (Firecrawl) and the **domain itself** (DNS/HTTP)
to be worth anything.

**Recommendation: SKIP both.** No coverage gain, no meaningful cost gain, no independence, and
material ToS exposure that the project has already decided not to take. Revisit only if Google
changes Places pricing or removes `websiteUri` from a reachable SKU.
**Confidence: MEDIUM** — SerpApi and Apify pricing from their official pages (HIGH); the claim
that neither adds coverage rests on published field lists rather than a side-by-side run
(MEDIUM). The ToS-risk judgement is a judgement, not a finding.

---

### (j) Domain liveness and parked-page detection

This is the layer that turns "Places had no `websiteUri`" into a verdict with receipts, and the
layer that catches the *opposite* error — Places *had* a URL but it points at something dead.
It costs $0 (self-hosted HTTP), so it should run on every candidate.

#### The probe ladder

Run in order, short-circuit on a verdict, record every step as a receipt.

**1. DNS.** Resolve A/AAAA/CNAME.
- `NXDOMAIN` → **dead**. Strongest possible signal.
- `SERVFAIL` / no A record → **dead**.
- Presence of **MX** records is a useful secondary "this is a real operating business" signal.

**2. Parking nameservers — check this before fetching anything.** NS records are far more
reliable than HTML heuristics and cost one DNS lookup. Known parking/for-sale operators:
`sedoparking.com`, `bodis.com`, `parkingcrew.net`, `above.com`, `dan.com`,
`undeveloped.com`, `parklogic.com`, `namefind.com` (GoDaddy's own parking brand),
`afternic.com`, `registrar-servers.com` (Namecheap parking). A match here is a **parked**
verdict without an HTTP request.

**3. HTTP(S) fetch with redirect chain capture.** Record every hop, the final URL, and the final
status. The chain is the receipt.
- Final status 4xx/5xx → **dead**.
- Connection refused / timeout → **dead**.

**4. Final-host classification.** Where the chain *lands* is usually the whole answer:

| Final host pattern | Verdict |
|---|---|
| `*.business.site` | **dead** — see below |
| `facebook.com`, `instagram.com`, `m.me` | **social-only** |
| `linktr.ee`, `beacons.ai`, `bio.link`, `allmylinks.com`, `linkin.bio` | **social-only** (link-in-bio) |
| `yelp.com`, `yellowpages.com`, `mapquest.com`, `bbb.org`, `nextdoor.com` | **directory-only** |
| `*.wixsite.com`, `*.godaddysites.com`, `*.square.site`, `*.weebly.com`, `*.myshopify.com` (default subdomain) | **builder subdomain** — real content possible, but no custom domain; score as weak presence |
| Registrar/marketplace landing (`sedo.com`, `afternic.com`, `dan.com`) | **parked** |
| Anything else with substantive content | **real site** |

🔴 **`*.business.site` is a gift.** Google shut down Business-Profile-built websites in **March
2024**, redirected them to the GBP listing until **10 June 2024**, and after that they return
"page not found". An estimated 20M+ free sites went dark. **Any `websiteUri` still pointing at
`business.site` is a guaranteed dead site attached to a business that demonstrably wanted a web
presence and lost it.** That is the single hottest lead signature in the RGV, it is trivially
detectable by string match, and it requires no fetch at all.

**5. TLS.** Expired certificate, hostname mismatch, or HTTPS refused while HTTP works → strong
**neglected** signal. Not fatal alone (small businesses do run plain HTTP), but a good scoring
input.

**6. Content heuristics — last, and lowest trust.** The literature is explicit that these are
weak on their own: regex matching on known parking HTML patterns (Szurdi et al. 2014) achieves
only **~26% recall**, while a trained classifier on HTML/HTTP features exceeds **90%**. The
reference implementation is `flaiming/Domain-Parking-Sensors` (archived Oct 2025), which
implements **Vissers, Nikiforakis & Joosen, "Parking Sensors: Analyzing and Detecting Parked
Domains" (NDSS 2015)** and extracts 20+ features including link-location lengths, quantity of
text content, and third-party request ratio.

For Siteless a full classifier is overkill. A pragmatic scoring blend:
- **Rendered text length** below ~200 characters → likely placeholder.
- **Phrase matches** (case-insensitive): "this domain", "is for sale", "buy this domain",
  "coming soon", "under construction", "website coming soon", "future home of", "parked free",
  "this site is temporarily unavailable", "default web page".
- **Third-party request ratio** near 1.0 with near-zero first-party assets.
- **No match** between page content and the business's own name/phone/address → the domain may
  be real but belongs to someone else (a common false positive when a name is guessed).

⚠️ **Careful with builder branding.** "Powered by GoDaddy Website Builder" or a Wix footer on a
page with real content, a real phone number and real hours is a **real site**, not a placeholder.
Only treat builder domains as weak presence when content heuristics *also* fire.

#### Receipts schema this implies

Every probe should persist: `probed_at`, `input_url`, `dns_result`, `nameservers`,
`redirect_chain[]`, `final_url`, `final_status`, `tls_valid`, `text_length`, `matched_phrases[]`,
`verdict`, `verdict_reason`. These are **Siteless's own observations of the public web** — fully
storable, and the thing that makes a verdict defensible on a phone call.

**Recommendation: PRIMARY verification layer, build in-house.** Zero marginal cost, no third
party, no ToS question, and it produces the receipts that are the product's core value. Order
matters: DNS → nameservers → redirect chain → final-host classification → TLS → content. Ship
the `business.site` check and the final-host table in the first verification phase; defer the
trained classifier indefinitely.
**Confidence: MEDIUM** — the `business.site` shutdown and the parked-detection research are well
sourced (HIGH), but the specific phrase lists, the 200-character threshold and the parking-NS
list are engineering heuristics assembled here, not a cited canonical list. They need to be
tuned against real RGV data and measured by the false-positive rate `PROJECT.md` already
requires.

---

### (k) Legal notes on storing and displaying the assembled data

#### Texas Data Privacy and Security Act (TDPSA), Tex. Bus. & Com. Code ch. 541

Quoted verbatim from the Texas Legislature's statute text:

> **§541.001(7)** "Consumer" means an individual who is a resident of this state acting only in
> an individual or household context. **The term does not include an individual acting in a
> commercial or employment context.**
>
> **§541.001(19)** "Personal data" means any information, including sensitive data, that is
> linked or reasonably linkable to an identified or identifiable individual. … The term does not
> include deidentified data or **publicly available** information.
>
> **§541.001(27)** "Publicly available information" means information that is **lawfully made
> available through government records**, or information that a business has a reasonable basis
> to believe is lawfully made available to the general public through widely distributed media…
>
> **§541.002(a)** This chapter applies only to a person that: (1) conducts business in this state
> …; (2) processes or engages in the sale of personal data; and (3) **is not a small business as
> defined by the United States Small Business Administration**, except to the extent that Section
> 541.107 applies…

**Three independent grounds put Siteless outside the TDPSA**, which is unusually comfortable:
the small-business exemption in §541.002(a)(3); the commercial-context exclusion from "Consumer"
in §541.001(7) — a business owner's business name, business address and business phone are
commercial-context data; and the publicly-available-information carve-out in §541.001(27), which
directly covers the Comptroller data ("lawfully made available through government records").

**The one residual obligation:** §541.107 still binds small businesses — *"A person described by
Section 541.002(a)(3) may not engage in the sale of personal data that is sensitive data without
receiving prior consent from the consumer."* Siteless collects no sensitive data (no race,
religion, health, precise geolocation of a person, biometrics, citizenship status), so this does
not bite — but it becomes live the day Siteless resells its database to other agencies, which is
an explicit future direction in `PROJECT.md` ("standalone product … sellable on its own").
**Do not let sensitive data into the schema, ever.** Enforcement is exclusively the Texas AG
(§541.151).

#### The sole-proprietor blur

38% of RGV Comptroller records are sole proprietors, where `taxpayer_name` is frequently a
**person's legal name** and `taxpayer_address` is frequently a **home address**. This is the one
genuinely sensitive corner of the dataset. Mitigations, all cheap:

- **Prefer `outlet_name` over `taxpayer_name`** for display. The outlet name is the trade name;
  the taxpayer name is the human. This mirrors the hard-won BIS lesson that
  `accounts.name` is an internal label that escaped to customers three times — carry
  `legal_name` and `display_name` as separate columns from the **first migration**, and make
  every UI and every outreach payload read `display_name`.
- **Flag home-address records** (`outlet_address` = `taxpayer_address` and
  `organization_type = 'IS'`) so a future outreach milestone can suppress or handle them
  differently.
- **Never display `taxpayer_name`** on the triage card.

#### Google attribution, and the non-Google-map trap

Wherever a Places-derived signal is shown, display **"Google Maps"** attribution (logo
preferred; the text "Google Maps" is acceptable where space is limited). And per §3.2.3(e) /
§B.14.2: **never render a non-Google map on a screen showing Places content.** §B.14.1 permits
using Places content with *no* map at all — which, for a phone triage card, is the right design
anyway.

#### Overture / CDLA attribution

Ship an attribution block naming Overture Maps and its providers, plus the Foursquare notice
"Copyright 2024 Foursquare Labs, Inc. All rights reserved." If data is ever exported to a
customer, include the CDLA-Permissive-2.0 text with it (§2.1).

#### Do-not-contact readiness (for the future outreach milestone)

`PROJECT.md` correctly keeps sending out of v1. The schema should nonetheless be built so that
milestone is a feature, not a migration:

- `suppressions` table keyed on **normalised E.164 phone**, **normalised domain**, and
  **`place_id`** — suppression must survive dedupe, re-ingestion, and a business changing its
  name. Include `reason`, `source`, `created_at`, and never hard-delete rows.
- `do_not_contact boolean` on the lead, derived from `suppressions`, plus a manual override.
- **Wire `out_of_business_date`** from Comptroller dataset `3kx8-uryv` into suppression now.
  Calling a closed business is the most credibility-destroying call there is, and this is free.
- Record **provenance per field** (`value`, `source`, `observed_at`) so a future
  consent/suppression audit can answer "where did this phone number come from?" — and so the
  30-day Google lat/lng TTL can be enforced by a job that targets `source = 'places'`.
- Store **`org_id`** on `suppressions` like everything else, but plan for a **global**
  suppression scope too: a business that says "never contact me" should not be re-surfaced to a
  different tenant.
- TCPA/CAN-SPAM/Texas no-call obligations attach at send time, which happens in BIS, not
  Siteless. The handoff payload should carry `do_not_contact` and the provenance so BIS's
  existing channels can honour it.

**Recommendation: build the compliance schema in the first migration.** `legal_name` vs
`display_name`, per-field provenance, a `suppressions` table, and a `source='places'` TTL job.
All four are nearly free now and expensive to retrofit — exactly the argument `PROJECT.md`
already makes for `org_id`.
**Confidence: HIGH** on the statutory text (quoted verbatim from the Texas Legislature's own
statute site). **MEDIUM** on the application of it to Siteless — this is legal analysis, not a
legal opinion, and the Google ToS question in particular warrants a real lawyer.

---

## Layering strategy

The brief's ordering — Places primary, free data as cross-reference — inverts once the ToS and
the measured coverage are on the table. The recommended layering:

```
LAYER 0  ENUMERATE (free, storable, commercially licensed)
  Overture Places, TX-filtered RGV          57,494 places   monthly refresh
  TX Comptroller sales tax permits          34,928 outlets  rowsUpdatedAt watch
  TX Comptroller all-locations (closures)   suppression     weekly
  → resolve to ONE lead per business (name + address + phone fuzzy match)
  → this table is Siteless's own data. Everything downstream hangs off it.

LAYER 1  DETECT (free, unlimited)
  Text Search Essentials (IDs Only)          $0.00/mo, unlimited
  → nightly per (cluster × city) cell; diff place_id sets against stored place_ids
  → answers "what is new or gone tonight?" at zero cost
  → place_id is the ONE Google field you may store forever

LAYER 2  VERIFY — GOOGLE (authoritative, transient)
  Text Search Enterprise, mask capped at Enterprise   ~$1.75/1,000 businesses
  → weekly over the candidate set, not nightly
  → read websiteUri / phone / rating / userRatingCount
  → WRITE ONLY: place_id, checked_at, had_website_uri, observed website host
  → DISCARD name/address/phone/rating. They already exist in Layer 0, legally.

LAYER 3  VERIFY — INDEPENDENT (the differentiator)
  Domain probe (self-hosted)                 $0.00
    DNS → parking NS → redirect chain → final host → TLS → content
    business.site check first; it is free and it is the hottest signal
  Firecrawl /search                          ~$0.0096/candidate
    only when the domain probe is inconclusive or no URL exists at all
  → produces the receipts: query, URLs, chain, timestamps

LAYER 4  CLASSIFY & SCORE
  no presence / social-only / directory-only / real site / dead-or-parked
  score = rating × userRatingCount (Layer 2, transient read)
        + social-only bonus (Layer 0 Facebook URL + Layer 3 confirmation)
        + NAICS ticket size (Layer 0, Comptroller)
        + phone reachability (Layer 0)
```

**Why this ordering wins.**

1. **It is legal by construction.** Everything persisted comes from a source that permits
   persistence. Google contributes `place_id` and a boolean.
2. **It is cheaper.** Nightly detection is free (IDs Only, unlimited). Expensive Enterprise
   calls run weekly over a shortlist, not nightly over everything.
3. **It is more complete.** Overture has 57,494 RGV places; Places Text Search can return at
   most 60 per query and would need hundreds of well-chosen queries to approach that.
4. **The verification is actually independent.** Layer 3 reaches the open web and the domain
   itself — not another mirror of Google.
5. **It degrades gracefully.** If the Google ToS answer comes back "don't", delete Layer 2. The
   product still works on Layers 0/1/3, just with a higher false-positive rate — and
   `PROJECT.md` already requires measuring that rate.

**Dedupe keys**, in priority order: `place_id` → normalised phone (E.164) → normalised
(name, street number, zip) trigram → Overture `id` → Comptroller `(taxpayer_number,
outlet_number)`. Store all of them; they are all free to store.

🔴 **Every geography filter must clip to Texas.** 42% of a naive RGV bounding box is Reynosa and
Matamoros. Apply `region='TX'` on Overture, county-code filters on Comptroller, and a
post-filter on Places `locationBias` results (which is a bias, not a restriction, and will bleed
across the river).

---

## Monthly cost model

**Scenario:** 4 industry clusters × RGV (Hidalgo, Cameron, Starr, Willacy), nightly refresh.
**Grid:** 4 clusters × 22 RGV cities = **88 (cluster, city) cells**. Each cell = 1 Text Search
seed, paged to 3 pages (60 results max) = **264 requests per full sweep**.

### Layer 1 — nightly detection (Text Search Essentials, IDs Only)

```
264 requests/night × 30 nights          = 7,920 requests/month
SKU 635D-A9DD-C520, free cap            = Unlimited
                                        = $0.00
```

### Layer 2 — weekly enrichment (Text Search Enterprise)

```
264 requests/sweep × 4.3 sweeps/month   = 1,135 requests/month
free cap (SKU E967-44BC-B44D)           = 1,000 requests
billable                                = 135 requests
135 × ($35.00 / 1,000)                  = $4.73
```

### Layer 2b — new-place top-ups (Place Details Enterprise)

```
~400 new/changed place_ids per month
free cap (SKU 2D9A-3DE0-3766)           = 1,000 requests
billable                                = 0
                                        = $0.00
```

### Layer 3 — Firecrawl verification

```
candidates verified/month               ≈ 1,300
credits per candidate (1 search + 1 scrape) = 3
total credits                           = 3,900/month
Free plan (1,000)                       insufficient
Hobby plan (5,000 credits)              = $16.00 (billed yearly) / ~$19.00 (monthly)
```

### Layer 3b — domain probing

```
self-hosted DNS + HTTP on Vercel functions = $0.00
```

### Layer 0 — free data

```
Overture (AWS Open Data S3, monthly pull)  = $0.00
TX Comptroller Socrata (daily watch)       = $0.00
```

### Total

| Line | Annual billing | Monthly billing |
|---|---|---|
| Places — Text Search IDs Only (nightly) | $0.00 | $0.00 |
| Places — Text Search Enterprise (weekly) | $4.73 | $4.73 |
| Places — Place Details Enterprise | $0.00 | $0.00 |
| Firecrawl Hobby | $16.00 | $19.00 |
| Domain probing | $0.00 | $0.00 |
| Overture + Comptroller | $0.00 | $0.00 |
| **Total** | **$20.73** | **$23.73** |
| **Budget** | **$50.00** | **$50.00** |
| **Headroom** | **$29.27** | **$26.27** |

### Sensitivity — what breaks the budget

| Change | New monthly total | Verdict |
|---|---|---|
| Baseline | $23.73 | ✅ |
| Layer 2 run **nightly** instead of weekly (7,920 req) | 6,920 × $0.035 + $19 = **$261** | ❌ **this is the trap** |
| Enterprise **+ Atmosphere** leaks into the field mask | $4.73 → $5.40; +14% on all Places | ⚠️ policy-check the mask in code |
| Enrichment via **Place Details** instead of Text Search | 5,000 candidates − 1,000 free = 4,000 × $0.02 = **$80** + $19 = $99 | ❌ never enumerate with Details |
| Firecrawl to 3,000 candidates/mo (9,000 credits) | $19 + $20 top-up = **$39** | ✅ fits headroom |
| Texas-wide, 4 clusters (~300,000 businesses) | 20,000 Text Search Ent. req → 19,000 × $0.035 = **$665** | ❌ needs a different design |

**Three cap rules the scheduler must enforce in code, not as warnings:**

1. **Enterprise SKUs run on a weekly cadence; only IDs-Only runs nightly.** This one rule is the
   difference between $24/month and $261/month. It should be structurally impossible to schedule
   an Enterprise sweep nightly.
2. **Count billable events per SKU against the published free cap before spending.** Maintain a
   `sku_usage` ledger (`sku_id`, `month`, `count`) and refuse the call when
   `projected_spend > remaining_budget`. Google's free caps are per SKU per month per billing
   account, and they do not roll over — the ledger must reset monthly on the billing-account
   boundary, not on a rolling 30 days.
3. **Field masks are allow-lists, not deny-lists.** Hard-code the permitted mask and reject any
   request containing an Atmosphere field. A stray `places.reviews` is a silent 14% cost
   increase that no test would catch.

**On Texas-wide scaling:** the answer is *not* more Places budget. At 300,000 businesses,
Overture is still $0 and still has the data. Texas-wide should enumerate entirely from Overture
+ Comptroller (887,244 statewide outlets, free), score offline, and spend the Enterprise budget
only on the scored shortlist — a few thousand businesses, not a few hundred thousand. That keeps
Texas-wide inside the same $50.

---

## Storage & compliance rules

A checklist for the schema and ingestion phases. Each line is traceable to a quoted source above.

### Must store (and may store forever)

| Field | Source | Basis |
|---|---|---|
| `place_id` | Google Places | Maps Service Specific Terms §A.3 — Google ID Caching |
| name, address, phone, category, socials, websites | **Overture** | CDLA-Permissive-2.0 §1.1, §2.1 — no share-alike |
| `outlet_name`, `outlet_address`, NAICS, county, org type | **TX Comptroller** | `licenseId: PUBLIC_DOMAIN` |
| `out_of_business_date` | TX Comptroller `3kx8-uryv` | Public domain |
| DNS results, redirect chains, HTTP status, TLS state, verdicts | **own probes** | Siteless's own observations |
| Firecrawl query strings, result URLs, timestamps, classifications | **own searches** | Own observations; customer bears compliance |

### Must NOT store

| Field | Why |
|---|---|
| `displayName`, `formattedAddress`, `nationalPhoneNumber`, `rating`, `userRatingCount`, `websiteUri` **from Places** | ToS §3.2.3(a)(iii) "copy and save business names, addresses, or user reviews"; no caching permission in Service Specific Terms §B.14.3 |
| Places `reviews`, photos, editorial/generative summaries | Same, plus Atmosphere cost |
| Places lat/lng beyond **30 consecutive calendar days** | §B.14.3 — take coordinates from Overture instead and avoid the TTL entirely |
| Long-lived copies of scraped page bodies | Firecrawl ToS pushes compliance to the customer; store URL + classification + short excerpt |
| Any TDPSA "sensitive data" | §541.107 binds small businesses on sale of sensitive data |

### Must do

- **`legal_name` and `display_name` as separate columns in the first migration.** Default every
  UI and every outreach payload to `display_name` (= Comptroller `outlet_name` / Overture
  `names.primary`). This is the BIS `accounts.name` lesson, which escaped to customers three
  times.
- **Per-field provenance** (`value`, `source`, `observed_at`) so the 30-day Google TTL job can
  target `source = 'places'`, and so a future consent audit can answer "where did this come
  from?".
- **A `sku_usage` ledger** keyed `(sku_id, billing_month)` — the hard budget cap depends on it.
- **A `suppressions` table** keyed on normalised E.164 phone, normalised domain, and `place_id`;
  soft-delete only; seeded from `out_of_business_date`.
- **Flag sole-proprietor home addresses** (`organization_type='IS'` and outlet address =
  taxpayer address).
- **Display "Google Maps" attribution** wherever a Places-derived signal appears, and **never
  render a non-Google map on that screen** (ToS §3.2.3(e), Service Specific Terms §B.14.2).
  §B.14.1 permits no map at all — take that option.
- **Display Overture attribution** plus the Foursquare copyright notice.
- **Filter every geography to Texas** before it reaches a query or a UI.
- **Build against Overture `basic_category`, not `categories`** — the latter is removed in the
  `2026-09-23.0` release, three days out.

### Open question for danlo — needs a lawyer, not a researcher

Google's ToS §3.2.3(d)(iii) forbids using the Core Services "in a listings or directory
service", and §3.2.3(c) forbids creating content based on Google Maps Content. A defensible
reading is that Siteless is a *prospecting tool*, not a listings or directory service, and that a
transient boolean read is not "creating content". A hostile reading is that a lead database built
on `place_id`s and website-absence signals is exactly the prohibited thing. **Get a written view
before the first Places call in production**, and keep the ingestion behind an interface so the
answer "no" costs a config change rather than a rewrite. Everything else in this document works
without Google.

---

## Sources

All URLs retrieved **2026-09-20** unless noted.

**Google Maps Platform**
- Places API usage and billing (page last-updated 2026-09-17) — https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- **Core services pricing list (global)** — SKU IDs, free caps and all volume bands extracted from page HTML — https://developers.google.com/maps/billing-and-pricing/pricing
- March 2025 billing changes ($200 credit → per-SKU free thresholds, effective 2025-03-01) — https://developers.google.com/maps/billing-and-pricing/march-2025
- Place Details data fields → SKU tier mapping — https://developers.google.com/maps/documentation/places/web-service/data-fields
- Text Search (New) — pageSize, 60-result cap, locationBias/locationRestriction, rankPreference — https://developers.google.com/maps/documentation/places/web-service/text-search
- Nearby Search (New) — maxResultCount 20, no pagination, radius limits — https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Places API policies — attribution, place ID caching exemption — https://developers.google.com/maps/documentation/places/web-service/policies
- **Google Maps Platform Terms of Service** — §3.2.3 quoted verbatim; "Google Maps Content" definition — https://cloud.google.com/maps-platform/terms
- **Maps Service Specific Terms** — §A.3 Google ID Caching; §B.14 Places API caching — https://cloud.google.com/maps-platform/terms/maps-service-terms

**Texas public data**
- Active Sales Tax Permit Holders — metadata, licence and schema via Socrata API `data.texas.gov/api/views/jrea-zgmq.json`; RGV counts via SoQL — https://data.texas.gov/Government-and-Taxes/Active-Sales-Tax-Permit-Holders/jrea-zgmq
- All Permitted Sales Tax Locations (`out_of_business_date`) — https://data.texas.gov/Government-and-Taxes/All-Permitted-Sales-Tax-Locations-and-Local-Sales-/3kx8-uryv
- Active Franchise Taxpayers — https://data.texas.gov/Government-and-Taxes/Active-Franchise-Tax-Permit-Holders/9cir-efmm
- Comptroller open data index — https://comptroller.texas.gov/transparency/open-data/search-datasets/
- SOSDirect bulk orders — https://direct.sos.state.tx.us/help/help-corp.asp?pg=bulk *(pricing figures are third-party summaries — MEDIUM)*
- **Tex. Bus. & Com. Code ch. 541 (TDPSA)** — §541.001(7)(19)(27), §541.002, §541.107, §541.151 quoted verbatim — https://tcss.legis.texas.gov/resources/BC/htm/BC.541.htm

**Overture Maps**
- Places theme guide — schema, sources, confidence, `categories` removal Sept 2026 — https://docs.overturemaps.org/guides/places/
- Getting data — S3 paths, DuckDB, CLI, STAC — https://docs.overturemaps.org/getting-data/
- Release calendar — monthly cadence, `2026-09-23.0` quarterly breaking release — https://docs.overturemaps.org/release-calendar/
- Attribution & licensing per theme — https://docs.overturemaps.org/attribution/
- CDLA-Permissive-2.0 text — https://cdla.dev/permissive-2-0/
- STAC catalog (latest release = `2026-08-19.0`) — https://stac.overturemaps.org/catalog.json
- **Coverage figures measured by direct DuckDB query against `s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*` on 2026-09-20.**

**OpenStreetMap**
- OSMF Geocoding community guideline (ODbL share-alike boundary) — https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline
- **Coverage figures measured by direct Overpass query against `overpass-api.de` on 2026-09-20** (four RGV county admin areas).

**County records**
- Hidalgo County Clerk official records — https://hidalgo.tx.publicsearch.us/ (HTTP 200, probed)
- Cameron County Clerk official records — https://cameron.tx.publicsearch.us/ (HTTP 200, probed)
- Starr County Clerk official records — https://starr.tx.publicsearch.us/ (HTTP 200, probed)
- Willacy County — no portal resolved (DNS failure, probed)
- Hidalgo County Clerk forms — https://www.hidalgocounty.us/1388/Forms

**Yelp**
- Data Licensing pricing (Base $229 / Enhanced $299 / Premium $643 per month) — https://business.yelp.com/data/resources/pricing/
- Plan feature comparison — https://docs.developer.yelp.com/docs/plans
- Business Search API reference (`url` = Yelp page; no website field) — https://docs.developer.yelp.com/reference/v3_business_search
- Community confirmation of the missing website field — https://github.com/Yelp/yelp-fusion/issues/622 and /issues/103 *(third-party)*

**Meta**
- Search Pages / Pages API — https://developers.facebook.com/docs/pages-api/search-pages/
- Place Search deprecation thread (removed all versions 2020-11-02) — https://developers.facebook.com/community/threads/210137347070924

**Scraping / verification services**
- Firecrawl pricing (Free 1,000 / Hobby $16 yr / Standard $83 yr; rate limits) — https://www.firecrawl.dev/pricing
- Firecrawl `/search` docs (2 credits per 10 results) — https://docs.firecrawl.dev/features/search
- Firecrawl Terms of Service — https://www.firecrawl.dev/terms-of-service
- SerpApi pricing (Free 250/mo; Developer $75/5,000; U.S. Legal Shield) — https://serpapi.com/pricing
- SerpApi Google Maps API fields & pagination — https://serpapi.com/google-maps-api
- Apify `compass/crawler-google-places` ($1.50/1,000 places) — https://apify.com/compass/crawler-google-places
- Apify platform plans (Free $5 credit; Starter $19) — https://apify.com/pricing

**Parked-domain detection**
- Vissers, Nikiforakis & Joosen, "Parking Sensors: Analyzing and Detecting Parked Domains", NDSS 2015 — https://www.ndss-symposium.org/wp-content/uploads/2017/09/01_2_2.pdf
- Reference implementation (archived Oct 2025) — https://github.com/flaiming/Domain-Parking-Sensors
- Regex-vs-classifier recall comparison — https://github.com/CASOS-IDeaS-CMU/Detection-and-Discovery-of-Misinformation-Sources
- Google Business Profile websites shut down March 2024, redirects ended 2024-06-10 — https://searchengineland.com/google-shutting-down-websites-business-profiles-436393 and https://www.searchenginejournal.com/websites-created-with-google-business-profiles-to-shut-down-in-march/509794/ *(third-party trade press; consistent across multiple outlets)*

**Texas privacy (secondary, used only to orient before reading the statute)**
- Texas AG, TDPSA overview — https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act
- Davis Wright Tremaine, TDPSA overview — https://www.dwt.com/blogs/privacy--security-law-blog/2023/07/texas-data-privacy-and-security-act-overview
