# Recorded Census Geocoder payloads

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

| File | `address` | Recorded outcome |
| --- | --- | --- |
| `census-mcallen.json` | `1400 N 10th St, McAllen, TX 78501` | HTTP 200 · 1 match · Hidalgo County `48215` · 26.2161, −98.2278 |
| `census-rio-grande-city.json` | `101 N Britton Ave, Rio Grande City, TX 78582` | HTTP 200 · 1 match · Starr County `48427` · 26.3791, −98.8207 |
| `census-no-match.json` | `Joe's Taqueria, McAllen, TX` | HTTP 200 · `addressMatches: []` |
| `census-503.json` | — | **Hand-written envelope**, see below |

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
