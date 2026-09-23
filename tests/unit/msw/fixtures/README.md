# Recorded third-party payloads

Two providers live here: the **Census Geocoder** (below) and, since plan 03-03, the **Texas
Comptroller's Socrata datasets** (see [Socrata](#socrata--texas-comptroller-datatexasgov)
further down).

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
