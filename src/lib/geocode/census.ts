import 'server-only';
import { z } from 'zod';

/**
 * The US Census Geocoder. D-02: free, federal, no API key, Texas is all we need.
 *
 * 🔴 THIS IS THE ONLY EXTERNAL HTTP CALL IN PHASE 2. Everything else the estimator needs
 * is seeded. That is not an accident — a geocode is the one thing that cannot be
 * precomputed, because the address comes from the user.
 *
 * WHY NOT THE PAID PATH. A Places geocode would need the credential that does not exist
 * yet (PROJECT.md § Dependencies not yet created) and would spend from the $50 cap on a
 * lookup the federal government gives away. `tests/unit/no-google-credential.test.ts` is
 * the standing guard that keeps it that way — and this file deliberately does not spell
 * the vendor's name in the shape that guard hunts for, the same arrangement
 * `src/lib/time.ts` uses for its own zone grep.
 *
 * 🔴 THE FAILURE MODE IS HTTP 200. Every failing input — a business name, a PO box, a bare
 * city, an address in Mexico — comes back `200` with `addressMatches: []`. A status check
 * is NOT a success check. `addressMatches.length === 0` is the documented no-match
 * outcome and is a product state, not a parse error.
 *
 * 🔴 A BAD ZIP IS SILENTLY CORRECTED. Query `99999` for a McAllen street and the service
 * returns `78501`. So the address a caller shows the user must be `matchedAddress` — what
 * the service resolved — and never the string the user typed. UI-SPEC's
 * "Matched: {address} · {county} County" depends on that.
 *
 * Persist only `{lat, lng, countyFips, countyName, matchedAddress}` on the version row.
 * Never the raw payload: it carries TIGER line ids and address components that are not
 * ours to keep and that nothing downstream reads.
 *
 * Verified shape and latency: 02-RESEARCH.md § The Census Geocoder, recorded 2026-09-22.
 * The four recorded payloads live in tests/unit/msw/fixtures/ and are replayed in CI.
 */

/** Hard-coded. T-2-13: no caller-supplied value ever reaches the host or the path. */
const CENSUS_HOST = 'https://geocoding.geo.census.gov';
const CENSUS_PATH = '/geocoder/geographies/onelineaddress';

/**
 * Fixed query parameters, exactly as the recorded fixtures carry them.
 *
 * 🔴 `layers=Counties` is load-bearing. Without it the response carries 11 geography
 * layers at 5,125 bytes; with it the response is 1,154 bytes and still carries `COUNTY`,
 * `GEOID`, `NAME` and `STATE` — everything the county resolution needs. `vintage` is
 * REQUIRED whenever the return type is `geographies`.
 */
const CENSUS_FIXED_QUERY =
  'benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json';

/** Texas. DATA-SOURCES records that a naive RGV bounding box is 42 % Mexico; the
 *  Texas-side clip costs nothing here because the payload already carries the state. */
const TEXAS_STATE_FIPS = '48';

/** Measured latency is 138–550 ms, so eight seconds is generous and, more importantly,
 *  BOUNDED. An unbounded fetch inside a server action is a hung request the user sees as
 *  a spinner that never resolves. */
const TIMEOUT_MS = 8000;

/**
 * T-2-13, the input half. Length-bounded (3–200) and charset-bounded before the URL is
 * built.
 *
 * The charset rule is a deny-list of C0/C1 control characters rather than an allow-list of
 * "address-looking" characters, and that is deliberate on both sides. Control characters
 * are the only class that can actually corrupt an HTTP request (CRLF splitting), so they
 * are refused outright. Everything else — including an input that looks like a URL or a
 * path traversal — is permitted and made harmless by POSITION: it can only ever become the
 * value of the `address` query parameter of a constant host and a constant path, percent-
 * encoded by `URLSearchParams`. An allow-list that rejected `:` or `/` would look stricter
 * while protecting nothing, and it would reject real addresses. The named test asserts the
 * position, which is the property that matters.
 */
const addressSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine((s) => !/[\u0000-\u001F\u007F-\u009F]/.test(s), {
    message: 'address contains a control character',
  });

/**
 * Exactly the fields the county resolution reads. zod strips everything else, so the TIGER
 * ids and address components in the real payload never become ours by accident.
 */
const countyGeographySchema = z.object({
  GEOID: z.string(),
  COUNTY: z.string(),
  NAME: z.string(),
  STATE: z.string(),
});

const addressMatchSchema = z.object({
  matchedAddress: z.string(),
  // 🔴 `x` is LONGITUDE and `y` is LATITUDE. The Census Geocoder does NOT return
  // `(lat, lng)`, and reading these in written order puts every RGV point in the Indian
  // Ocean. `census.test.ts` pins the axis order with a sign assertion, because that is the
  // one defect a `toBeDefined` would sail straight past.
  coordinates: z.object({ x: z.number(), y: z.number() }),
  geographies: z.object({ Counties: z.array(countyGeographySchema) }),
});

const censusResponseSchema = z.object({
  result: z.object({ addressMatches: z.array(addressMatchSchema) }),
});

export type GeocodeFailureReason = 'no_match' | 'not_texas' | 'unreachable' | 'bad_shape';

export type GeocodeResult =
  | {
      ok: true;
      lat: number;
      lng: number;
      countyFips: string;
      countyName: string;
      matchedAddress: string;
    }
  | { ok: false; reason: GeocodeFailureReason };

/**
 * Geocode one address. Never throws: every outcome is a named reason the caller can render.
 *
 * A thrown geocoder inside a server action becomes a 500 and UI-SPEC has no copy for a
 * 500 — it has copy for "we couldn't find that" and for "the service didn't answer", which
 * are the two states a user can actually do something about.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const validated = addressSchema.safeParse(address);
  if (!validated.success) {
    // Refused before any request is built, so nothing reaches the network. Reported as
    // `no_match` rather than a fifth reason: to the user an unusable address IS an address
    // the geocoder could not find, and UI-SPEC's no-match copy ("Try a street address with
    // a city and ZIP") is exactly the right instruction for it.
    return { ok: false, reason: 'no_match' };
  }

  const url = new URL(`${CENSUS_HOST}${CENSUS_PATH}?${CENSUS_FIXED_QUERY}`);
  // The ONLY place caller input enters the request, and it is a value, never a key, never
  // part of the path, never a header.
  url.searchParams.set('address', validated.data);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch {
    // A timeout, a DNS failure, a reset connection. It is a free federal service and it
    // does go down; nothing was charged and nothing was lost.
    return { ok: false, reason: 'unreachable' };
  }

  if (!response.ok) return { ok: false, reason: 'unreachable' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'bad_shape' };
  }

  const parsed = censusResponseSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'bad_shape' };

  const match = parsed.data.result.addressMatches[0];
  // 🔴 NOT an error. See the header: this is the documented no-match outcome, arriving
  // with HTTP 200 like every other outcome.
  if (!match) return { ok: false, reason: 'no_match' };

  const county = match.geographies.Counties[0];
  // A match with no county layer means the request went out without `layers=Counties`, or
  // the upstream shape changed. Either way the county resolution cannot be done.
  if (!county) return { ok: false, reason: 'bad_shape' };

  if (county.STATE !== TEXAS_STATE_FIPS) return { ok: false, reason: 'not_texas' };

  return {
    ok: true,
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    countyFips: county.GEOID,
    countyName: county.NAME,
    matchedAddress: match.matchedAddress,
  };
}
