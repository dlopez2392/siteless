# Recorded third-party payloads

Two providers live here: the **Census Geocoder** (below) and, since plan 03-03, the **Texas
Comptroller's Socrata datasets** (see [Socrata](#socrata--texas-comptroller-datatexasgov)
further down). Since plan 04-10 a third provider, **Google Places (API New)**, has
**synthetic** fixtures here — hand-authored, not recorded; see the Places section at the end.

These files are **replayed by `msw`, never re-fetched**. CI must never touch the network
(D-04, CLAUDE.md): a test that reaches the live geocoder is a test whose verdict depends on
a third party's uptime, and a compromised or changed upstream response could then alter a
CI result. The geocoder is the only external HTTP in Phase 2.

Recorded **2026-09-22**, each with exactly this URL shape:

```
https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress
  ?address=<urlencoded>
  &benchmark=Public_AR_Current
  &vintage=Current_Current
  &layers=Counties
  &format=json
```

🔴 **`layers=Counties` is not optional.** Without it the response carries 11 geography
layers at 5,125 bytes; with it the response is 1,154 bytes and still carries `COUNTY`,
`GEOID`, `NAME` and `STATE` — everything the county resolution needs. The recorded McAllen
payload is 1,154 bytes, which is how you can tell at a glance that it was captured with the
parameter set.

`vintage` is **required** when the return type is `geographies`.

| File                          | `address`                                      | Recorded outcome                                                |
| ----------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `census-mcallen.json`         | `1400 N 10th St, McAllen, TX 78501`            | HTTP 200 · 1 match · Hidalgo County `48215` · 26.2161, −98.2278 |
| `census-rio-grande-city.json` | `101 N Britton Ave, Rio Grande City, TX 78582` | HTTP 200 · 1 match · Starr County `48427` · 26.3791, −98.8207   |
| `census-no-match.json`        | `Joe's Taqueria, McAllen, TX`                  | HTTP 200 · `addressMatches: []`                                 |
| `census-503.json`             | —                                              | **Hand-written envelope**, see below                            |

## The two things that will bite a reader

🔴 **The failure mode is HTTP 200.** Every failing input — a business name, a PO box, a
city on its own, a colonia address, an address in Mexico — returns `200` with an empty
`addressMatches` array. **A status check is not a success check**, and
`addressMatches.length === 0` is not a parse error: it is the documented "no match"
outcome and must be handled as a product state, not thrown as a schema failure.

🔴 **`coordinates` is `{x, y}` where `x` is longitude and `y` is latitude** — not
`(lat, lng)`. Reading them in written order puts every RGV point in the Indian Ocean.

`census-503.json` is the one file here that is **not** a capture. The live service will not
produce a 503 on demand, so it is a hand-written `{ status, body }` envelope that the msw
handler replays as a 503. It is shaped differently from its neighbours on purpose: the
other three are verbatim response **bodies**, so a handler that replayed an envelope as a
body (or the reverse) fails loudly rather than silently feeding `{status: 503}` to the zod
schema.

## Related guards that live elsewhere

- The zod schema and the `STATE === '48'` Texas-only guard land in plan **02-07**, together
  with `tests/unit/msw/server.ts` which replays these files.
- Nothing here needs a credential. The Census Geocoder takes **no API key**, which is
  exactly why D-02 chose it over a Google geocode — and `tests/unit/no-google-credential.test.ts`
  keeps it that way.

## Re-recording

Only if the upstream shape genuinely changes. Re-record all three 200s in one sitting, keep
`layers=Counties`, and update the byte sizes above — then re-read the county assertions in
the tests that consume them, because a silently re-recorded fixture that no longer resolves
to Hidalgo makes Pitfall 7's guard vacuous.

---

## Socrata — Texas Comptroller (data.texas.gov)

Recorded **2026-09-23T01:00:35Z** (the evening of 2026-09-22, America/Chicago) by one
throwaway `node` run outside the repo, plain `fetch`, no app token. Every page request had
this shape, and `$offset=0`:

```
https://data.texas.gov/resource/<dataset>.json?$where=<urlencoded>&$order=<urlencoded>&$limit=50&$offset=0
```

The two pages are **verbatim response bodies** (bare JSON arrays). A Socrata page carries
nowhere to echo its own request, so the same run also wrote **`socrata-recordings.json`**:
the `$where`, `$order`, `$limit`, row count and `rowsUpdatedAt` of each page, from the same
variables that issued the request. `tests/unit/msw/server.ts` exports `RECORDED_WHERE` /
`RECORDED_ORDER` from that sidecar and dispatches on them — never on a predicate typed by
hand. `rowsUpdatedAt` was read from `/api/views/<id>.json` immediately before and after
each page and did not move during the capture.

| File                             | Dataset                                                                          | `rowsUpdatedAt` at capture            | Rows                                     | Bytes  |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- | ------ |
| `socrata-jrea-page.json`         | `jrea-zgmq` Active Sales Tax Permit Holders                                      | 1789805121 → **2026-09-19T08:05:21Z** | 40 (the whole result set: 40 < `$limit`) | 29,733 |
| `socrata-3kx8-page.json`         | `3kx8-uryv` All Permitted Sales Tax Locations and Local Sales Tax Responsibility | 1790005715 → **2026-09-21T15:48:35Z** | 50 (**truncated**: = `$limit`)           | 50,649 |
| `socrata-400-type-mismatch.json` | `jrea-zgmq`                                                                      | —                                     | **envelope**, see below                  | 2,372  |

### `socrata-jrea-page.json`

```
$where = outlet_county_code in ('031','108','214','245') and
         ((taxpayer_number >= '32006170057' and taxpayer_number < '32006310018') or
          (outlet_city = 'RIO GRANDE CY' and taxpayer_number between '32015641171' and '32017397160'))
$order = taxpayer_number,outlet_number
```

🔴 **Why not the plain RGV `$where`.** The first 50 rows of the plain RGV filter in
`taxpayer_number` order carry no Rio Grande City spelling variant and not the verified join
row, and a fixed `$where` + `$order` + `$limit` gets whatever it gets. So the page is two
windows of the real result, stated in the `$where` itself: 38 consecutive rows starting at
the verified join row, plus the two `RIO GRANDE CY` rows in a narrow taxpayer range. It
carries:

- the verified join row **`32006170057-5`**, PATTI ZIMMY HAIR REPLACEMENT SPECIALIST,
  `2426 E TYLER AVE STE 1C` — which is also a **suite** row (7 more carry a unit designator: six `STE`, one `# B`)
- two **`outlet_city = 'RIO GRANDE CY'`** rows (GLITTS & GLAMOUR BEAUTY SALON, ETHEL'S
  BOUQUETS AND TUXEDO RENTAL) that only resolve to Rio Grande City through
  `cities.nameVariants`
- rows whose `taxpayer_address` differs from `outlet_address` (a mailing address, e.g. a PO
  box) — the transform must read `outlet_address` and this page can tell the two apart
- 🔴 **no accented `outlet_name`**: none exists. `outlet_name like '%Ñ%'` / `É` / `Á` / `Í` /
  `Ó` / `ñ` / `é` over all four RGV counties returned **zero rows** on 2026-09-22. The
  Comptroller feed is ASCII-folded; the accent fold matters on the Overture side, not here.
- `outlet_naics_code` arrives as a JSON **string** (`"561311"`) on every row, although the
  Socrata column type is `number`.

### `socrata-3kx8-page.json`

```
$where = loc_county in ('31','108','214','245') and tp_number >= '32006170057' and
         (out_of_business_date IS NOT NULL or (tp_number = '32006170057' and loc_number = '5'))
$order = tp_number,loc_number
```

🔴 **`loc_county` is UNPADDED** — `'31'`, not the zero-padded form `jrea-zgmq` uses.
Padding it returns 0 rows for Cameron; see `src/lib/socrata/closures.ts`.

🔴 **The join row is ACTIVE, so the closure filter alone cannot contain it.** The plan asked
for `(tp_number='32006170057', loc_number='5')` in this page, but that location has **no
`out_of_business_date`** — it is open. Under the production closure filter
(`out_of_business_date IS NOT NULL`) it never appears. The recorded `$where` therefore ORs
it in explicitly, which makes it the page's one row WITHOUT a closure date: the positive
control that `closureRowSchema` refuses an open location, and the proof that
`tp_number-loc_number` equals `jrea-zgmq`'s `taxpayer_number-outlet_number` for the same
business. The other 49 rows are real closures from the RGV, closure months spread across
the year (both CST and CDT dates, which the zone test needs). Socrata omits a null field
rather than sending `null`: 4 rows here carry no `permit_date`.

This page filled its `$limit`, so it is **truncated** — rows exist past it that were never
captured. The msw handler refuses (501) any request reaching past row 50 rather than serve
a short page that would read as "the end".

### `socrata-400-type-mismatch.json` — an envelope, like `census-503.json`

`{ status, body, request, capturedAt }`, where `body` is the **verbatim** response text of
a real HTTP 400, captured by applying SoQL's string-prefix function to `outlet_naics_code`
(`request.where` records the exact predicate). The message reads
`query.soql.type-mismatch; Type mismatch for <the function>, is number`. It is an
envelope because a 400 is a status and a body, not a page; `tests/unit/msw/server.ts`
checks the shape at load (status `400`, a string body naming `query.soql.type-mismatch`)
and replays it only through the one-shot `failNextSocrataWithTypeMismatch()`, reset in
`afterEach`.

### `/api/views/<id>.json`

Not recorded verbatim — the real metadata payload is tens of kilobytes of column
descriptions. The handler answers `{ rowsUpdatedAt }` with the value in
`socrata-recordings.json`, which is the one field the client reads.

### Re-recording (Socrata)

Re-record both pages and the sidecar **in one run** so their `rowsUpdatedAt` and `$where`
stay paired; never hand-edit `socrata-recordings.json`. Keep `loc_county` unpadded. Then
re-read the assertions that name `32006170057-5`, the `RIO GRANDE CY` rows and the closure
dates, because a re-recorded page that lost one of them makes its test vacuous.

---

## Census BATCH geocoder (plan 03-07, D-08)

Recorded **2026-09-22** (America/Chicago; the run's UTC stamps read `2026-09-23T01:21Z`) by
a throwaway `node --input-type=module -e` run from the worktree, output written to the OS
temp dir and copied here byte-for-byte. Plain `fetch`, **no API key** (there is none).

```
POST https://geocoding.geo.census.gov/geocoder/locations/addressbatch
multipart/form-data:
  addressFile = <the CSV below>   (Blob, type text/csv, filename addresses.csv)
  benchmark   = Public_AR_Current
  (no vintage — it is required only for returntype=geographies)
```

The input CSV has **no header row** and exactly five columns, `Unique ID, Street address,
City, State, ZIP`, **every field quoted**, LF line endings, one trailing LF — exactly what
`src/lib/geocode/census-batch.ts` builds, so the recordings also prove the service accepts
that encoding (including a hyphenated Comptroller key as the ID).

Every file is a **verbatim response body**: `text/plain`, LF-terminated, no CR, no NUL, no
BOM (checked at load by `tests/unit/msw/server.ts`).

🔴 **The body is ragged.** `Match` lines have 8 fields; `Tie` lines **3**; and `No_Match`
lines, as recorded here, **also 3**. 03-RESEARCH wrote 4 for `No_Match`; every `No_Match` in
these recordings (three lines across two files) is 3 fields. The parser accepts either — the
property that matters is that neither short shape has a field 6. 🔴 **Line order is not input
order** (see `census-batch-shuffled.txt`). 🔴 **Field 6 is `"longitude,latitude"`** —
longitude first.

The msw handler dispatches on the request's CSV, matched against each file's own echo:
every response line begins with the submitted ID and the input address echoed as
`street, city, state, zip`, so each file carries its own request (the batch analogue of the
one-line payload's `result.input.address`). `RECORDED_BATCH_ROWS` reads the rows back out of
that echo; nothing restates an address by hand.

| File                         | Rows | Bytes | Wall clock | Outcome                                                                                  |
| ---------------------------- | ---- | ----- | ---------- | ---------------------------------------------------------------------------------------- |
| `census-batch-match.txt`     | 1    | 165   | 8,617 ms   | `Match`/`Exact` → `"-97.672649743751,26.189604634647"` (Harlingen)                       |
| `census-batch-non_exact.txt` | 1    | 148   | 7,850 ms   | `Match`/`Non_Exact` — **direction flipped**: `100 E CANO ST` → `100 W CANO ST`           |
| `census-batch-tie.txt`       | 1    | 56    | 655 ms     | `Tie` — **3 fields**                                                                     |
| `census-batch-no_match.txt`  | 2    | 97    | 299 ms     | `No_Match` ×2 — **3 fields** each; one is a Mexican-side (Reynosa, `TM`) address         |
| `census-batch-shuffled.txt`  | 40   | 6,074 | 543 ms     | 39 `Match` (25 Exact / 14 Non_Exact) · 1 `No_Match` · first line is ID `"22"`, not `"1"` |

The first two calls were the cold ones (~8 s); the same endpoint answered the next three in
under a second. The research's throughput figure (~32 addr/s, linear, measured at n=1,000
and n=3,000) is the planning number, not these.

### `census-batch-match.txt` — input

```
"32006170057-5","2426 E TYLER AVE","HARLINGEN","TX","78550"
```

The ID is the verified Comptroller join key (`taxpayer_number-outlet_number`), street
without its `STE 1C` suite.

### `census-batch-non_exact.txt` — input

```
"1","100 E CANO ST","EDINBURG","TX","78539"
```

### `census-batch-tie.txt` — input

```
"1","2410 EAST EXPRESSWAY 84","MISSION","TX","78572"
```

### `census-batch-no_match.txt` — input

```
"1","PO BOX 764","POTH","TX","78147"
"2","AV HIDALGO 100","REYNOSA","TM","88500"
```

The Reynosa row carries state `TM` (Tamaulipas), which `geocodeBatch` never sends — it
hard-codes `TX`. So this file is reachable through the handler only by a caller that
submits exactly these two rows; the tests read its lines directly with `parseBatchLine`.

### `census-batch-shuffled.txt` — input

The 40 real Comptroller rows of `socrata-jrea-page.json`, **in that file's order**, ID =
1-based position, `street = outlet_address`, `city = outlet_city`, `zip =
outlet_zip_code.slice(0, 5)`, state `TX`:

```
"1","2426 E TYLER AVE STE 1C","HARLINGEN","TX","78550"
"2","35 SAN MIGUEL DR","BROWNSVILLE","TX","78521"
"3","1300 S MAIN ST","MCALLEN","TX","78501"
"4","1200 S 16TH ST","MCALLEN","TX","78501"
"5","301 W WASHINGTON AVE","HARLINGEN","TX","78550"
"6","935 W BUSINESS HIGHWAY 83","DONNA","TX","78537"
"7","1701 W DOVE AVE STE E","MCALLEN","TX","78504"
"8","4309 N RAUL LONGORIA RD","SAN JUAN","TX","78589"
"9","518 S STANDARD AVE","SAN JUAN","TX","78589"
"10","204 BEACH BLVD","LAGUNA VISTA","TX","78578"
"11","115 S VIRGINIA AVE","MERCEDES","TX","78570"
"12","2112 W UNIVERSITY DR","EDINBURG","TX","78539"
"13","212 S MAIN ST","MCALLEN","TX","78501"
"14","211 N CAGE BLVD","PHARR","TX","78577"
"15","3049 E 23RD ST","WESLACO","TX","78596"
"16","1 3/4 MI NO RAUL LONGORIA","SAN JUAN","TX","78589"
"17","2310 ARTHUR AVE","EDINBURG","TX","78542"
"18","116 S MAIN ST STE B3","DONNA","TX","78537"
"19","2610 W MILE 10 N","WESLACO","TX","78599"
"20","34389 OLD ALICE RD","LOS FRESNOS","TX","78566"
"21","2202 SUGAR SWEET STE A","WESLACO","TX","78599"
"22","6605 SIMON PL","BROWNSVILLE","TX","78526"
"23","1418 N CONWAY AVE # B","MISSION","TX","78572"
"24","922 N HOLLAND AVE","MISSION","TX","78572"
"25","922A N HOLLAND AVE","MISSION","TX","78572"
"26","2720 E MILE 14 N","MERCEDES","TX","78570"
"27","417 S MAIN ST","MCALLEN","TX","78501"
"28","420 N 10TH ST STE 3","MCALLEN","TX","78501"
"29","105 W JACKSON ST","HARLINGEN","TX","78550"
"30","602 N VICTORIA RD LOT 2102","DONNA","TX","78537"
"31","104 W JACKSON ST","HARLINGEN","TX","78550"
"32","2701 GUMWOOD AVE","MCALLEN","TX","78501"
"33","407 S TEXAS BLVD STE B","WESLACO","TX","78596"
"34","802 WEST DEL ORO LN","PHARR","TX","78577"
"35","814 MAIN GROVE ST","DONNA","TX","78537"
"36","503 W 16TH ST","WESLACO","TX","78596"
"37","1901 BAYLOR AVE","MCALLEN","TX","78504"
"38","3775 BOCA CHICA BLVD APT 1006","BROWNSVILLE","TX","78521"
"39","3400 W US HIGHWAY 83 STE A","RIO GRANDE CY","TX","78582"
"40","306 E 2ND ST","RIO GRANDE CY","TX","78582"
```

**Not hand-shuffled.** The live service returned these 40 lines in the order recorded —
`22, 23, … 31, 10, 32, 11, …, 1, 2, …, 9, 40, 20, 21` — on the first and only submission;
the file is untouched. Two more measured facts ride in it for free:

- a **second direction flip** in the wild: ID 12, `2112 W UNIVERSITY DR` → `2112 E
UNIVERSITY DR` (`Non_Exact`), beside the `E CANO` → `W CANO` fixture above;
- suites and lots are **dropped** from the matched address even on `Exact` (ID 1 `STE 1C`,
  ID 28 `STE 3`, ID 30 `LOT 2102`), which is why `matchedAddress` is for display and is not a
  unit-level identity.

### Re-recording (batch)

Only if the upstream shape changes. Re-record all five in one sitting with the same CSV
encoding, update the byte counts above, and re-read the assertions that pin the Harlingen
coordinates, the `W CANO` flip and the shuffled first line — a re-recording that came back
in input order would make the rejoin test vacuous (the test guards that at load).

---

## Google Places (API New) — synthetic (plan 04-10, D-01, D-20)

🔴 **Nothing in the `places-*.json` files was recorded.** They were hand-authored on
**2026-09-23**, before the D-01 legal gate, and `places-recordings.json` says so:
`"synthetic": true`, `"anonymized": false`, `"recordedFrom": null`. No Places request has
ever been made from this repo; CI never spends (D-01, Phase 2 D-04).

🔴 **D-20: no Google-authored text is ever committed.** Real recordings, when they come, are
anonymized **in memory** by `scripts/record-places-fixtures.ts` (plan 04-19) before anything
is written: it keeps structure, pagination, counts, `place_id`s, SAB flags and host classes,
and synthesizes names, addresses, phones and URL hosts. Those files are marked
`"anonymized": true` in the sidecar. A raw capture must never reach git, not even for one
commit — git history is forever.

`tests/unit/msw/places.ts` replays these files. Every request the code under test makes has
this shape:

```
POST https://places.googleapis.com/v1/places:searchText
X-Goog-Api-Key:   <key>
X-Goog-FieldMask: places.id,places.displayName,…,nextPageToken   (comma-joined)

{ "textQuery", "includedType", "strictTypeFiltering": true,
  "locationRestriction": { "rectangle": { "low": { "latitude", "longitude" },
                                          "high": { "latitude", "longitude" } } },
  "includePureServiceAreaBusinesses": true, "pageSize": 20,
  "regionCode": "US", "languageCode": "en", "pageToken"? }
```

The handler is registered on a **RegExp**, never the string path: msw parses the string
`…/places:searchText` as `places` + a route param `:searchText`, which also matches
`/v1/placesXYZ` (04-RESEARCH Pitfall 8, measured). It answers **501** — never a page — when
the `X-Goog-FieldMask` header, the `X-Goog-Api-Key` header or
`includePureServiceAreaBusinesses: true` is missing, so a request-builder regression is red
instead of silently served (PLACE-05, M26). It serves **only the fields the mask names**
(`places.<field>` → `<field>`; `nextPageToken` only when masked), so an IDs-only request can
never receive a `websiteUri`.

Construction rules every file follows: ids start `synthetic-`; every name contains
`Synthetic` except on the match page (whose names must equal the spine's); every filler phone
is `(956) 555-01NN` (a fictional exchange that can never phone-match the spine); every filler
URL is on the reserved `.example` TLD, or on a host-table domain (`business.site`,
`facebook.com`, `wixsite.com`) with a `synthetic-` path or subdomain.

| File                       | Places | `nextPageToken` | Purpose                                                                                     |
| -------------------------- | ------ | --------------- | ------------------------------------------------------------------------------------------- |
| `places-saturated-p1.json` | 20     | `saturated:p2`  | Saturated plumber search, page 1 of 3; ids `synthetic-sat-001…020`, inside McAllen's bbox   |
| `places-saturated-p2.json` | 20     | `saturated:p3`  | Page 2 (`synthetic-sat-021…040`)                                                            |
| `places-saturated-p3.json` | 20     | —               | Page 3 (`synthetic-sat-041…060`): exactly 60 in total, the Text Search cap                  |
| `places-child-12.json`     | 12     | —               | A child tile after a subdivide; phones `555-0161…0172` so they never collide with the above |
| `places-empty.json`        | 0      | —               | `{}` — a zero-result search has no `places` key (research A5); served when no route claims  |
| `places-match-page.json`   | 7      | —               | The matching contract with `PLACES_SPINE` (below)                                           |
| `places-ids-only.json`     | 10     | —               | An IDs-only (Essentials) response: `{ id }` only                                            |
| `places-429-daily.json`    | —      | —               | **Envelope**: 429 `RESOURCE_EXHAUSTED`, `quota_limit: SearchTextRequestsPerDayPerProject`   |
| `places-429-minute.json`   | —      | —               | **Envelope**: 429, `quota_limit: SearchTextRequestsPerMinutePerProject`                     |
| `places-400-invalid.json`  | —      | —               | **Envelope**: 400 `INVALID_ARGUMENT`                                                        |
| `places-503.json`          | —      | —               | **Envelope**: 503 `UNAVAILABLE`                                                             |
| `places-recordings.json`   | —      | —               | The sidecar: `synthetic` / `anonymized` markers and a per-file place count, checked at load |

The four error files are `{ status, body }` envelopes like `census-503.json`, where `body`
is Google's documented error shape `{ error: { code, message, status, details? } }` with a
`Synthetic:` message. `places.ts` checks at load that every envelope's `status` equals its
`body.error.code`, that every `places-*.json` on disk is listed in the sidecar with the right
place count, and — per file since 04-19 — that every id in a hand-authored file starts
`synthetic-`, while a file whose sidecar entry says `"anonymized": true` (and
`"synthetic": false`) has exactly the anonymized shape: `assertAnonymizedPage`
(`scripts/lib/anonymize-places.ts`) — only known keys, every name, address, phone and URL one
of the synthetic forms, ratings the fixed 4 / 10, coordinates at 4 decimals. A raw capture
dropped in beside them fails one rule or the other at load.

### The spine contract (with `tests/db/_places-fixtures.ts` `PLACES_SPINE`, plan 04-09)

`places-match-page.json` uses exactly the spine's names, street addresses and phones, so the
matcher has something real to find. Change one side and the other must change with it.

| Place id                    | Serves as                                                                                                           | Expected against the spine                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `synthetic-match-ortiz`     | `Ortiz Plumbing`, `1200 N 10th St, McAllen, TX 78501, USA`, 26.2159/−98.2336, `(956) 631-0001`, no site             | ortiz — exact; host class `none`                           |
| `synthetic-match-garza`     | `Garza Electric LLC`, `4100 N 23rd St, McAllen, TX 78504, USA`, 26.2490/−98.2389, `(956) 631-0002`, `business.site` | garza — `dead` site                                        |
| `synthetic-match-rio`       | `Rio Roofing`, **pure SAB** (no address, no location), `(956) 631-0003`, facebook                                   | ties rio and rioCo (same phone) — `social`                 |
| `synthetic-match-valley`    | `Valley Locksmith`, **pure SAB**, `(956) 631-0004`, `.example`                                                      | valley — the SAB phone+city path; `other`                  |
| `synthetic-match-tentative` | `Ortiz Plumbing TX`, `… Ste 5`, 26.2161/−98.2335, `(956) 555-0199`                                                  | a near-miss of ortiz: **82** (pinned by 04-18 — see below) |
| `synthetic-match-nothing`   | `Synthetic Nobody Services`, `9 Synthetic Rd`, no phone                                                             | matches nothing                                            |
| `synthetic-match-mexico`    | `Synthetic Taller`, Reynosa, Tamps., 26.07/−98.29                                                                   | outside Texas                                              |

**The one adjustment (04-18).** `synthetic-match-tentative` was first `Ortiz Plumbing and Drain`.
`nameNorm` drops the `and`, and pg_trgm puts `ortiz plumbing drain` at 0.714 against
`ortiz plumbing`: name 24 + address 30 (the suite is on one side only, so no unit conflict) +
distance 15 (24 m) + cluster 5 = **74**, below the review band, so it came back `unmatched`. Renamed
to `Ortiz Plumbing TX` (similarity 0.833 — below the 0.85 name-signal bar, so still two signals):
name 32 + 30 + 15 + 5 = **82**. Everything else about the record is unchanged. The score is pinned
in `tests/db/places-search-tile.test.ts`.

`PLACES_SENTINELS` (exported by `places.ts`) is every `displayName.text`, `formattedAddress`,
`nationalPhoneNumber` and `websiteUri` these files serve, read out of the files at load. The
"no Places text reaches the database" and "no step returns Places content" scans search for
them.

### Re-recording (Places)

Not until the D-01 legal checkpoint (plan 04-29) has passed, and only through
`scripts/record-places-fixtures.ts`, which anonymizes in memory. Never hand-edit a recorded
file into shape and never commit a raw response. The recorder writes
`places-recorded-<out>-p<N>.json` and sets the sidecar itself (`"anonymized": true` at the top,
and `"synthetic": false, "anonymized": true, recordedAt, requests` on each recorded file); keep
the match page's spine contract intact, and re-read every assertion that names a `synthetic-` id.
Invocation, guards and the ledger it writes: the header of `scripts/record-places-fixtures.ts`.
