/**
 * The Census Geocoder, replayed from the four recorded payloads in `./fixtures/`.
 *
 * 🔴 CI MUST NEVER REACH THE NETWORK. `onUnhandledRequest: 'error'` is set inside
 * `startCensusServer()` rather than at each call site precisely so no test can weaken it
 * by forgetting it: a request that slips past the handler fails the test instead of
 * silently going out to a third party whose uptime would then decide whether CI is green.
 * The geocoder is free, so the risk here is flakiness and a supply-chain read rather than
 * spend — but the same harness is what Places and Firecrawl will use in Phase 4, where it
 * IS spend.
 *
 * 🔴 DISPATCH IS BY THE RECORDED ADDRESS, READ OUT OF THE FIXTURE. Nothing below restates
 * an address string. A substring rule would be worse than wrong: the no-match fixture was
 * recorded for "Joe's Taqueria, McAllen, TX", so any rule that keys on "mcallen" would
 * serve it the McAllen hit and the no-match test would prove nothing.
 *
 * 🔴 `census-503.json` IS AN ENVELOPE, NOT A BODY. The live service will not produce a 503
 * on demand, so it is hand-written `{ status, body }` while its three neighbours are
 * verbatim 200 bodies. Replaying one as the other is the mistake the fixtures' README
 * warns about, so this module asserts the shape at load rather than trusting it.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';

import mcallen from './fixtures/census-mcallen.json';
import noMatch from './fixtures/census-no-match.json';
import rioGrandeCity from './fixtures/census-rio-grande-city.json';
import serviceUnavailable from './fixtures/census-503.json';

export const CENSUS_ORIGIN = 'https://geocoding.geo.census.gov';
export const CENSUS_PATHNAME = '/geocoder/geographies/onelineaddress';
export const CENSUS_ENDPOINT = `${CENSUS_ORIGIN}${CENSUS_PATHNAME}`;

/** The exact strings the fixtures were recorded against, read from the fixtures. A test
 *  that typed one of these by hand could drift from the payload it expects back. */
export const RECORDED_ADDRESS = {
  mcallen: mcallen.result.input.address.address,
  rioGrandeCity: rioGrandeCity.result.input.address.address,
  noMatch: noMatch.result.input.address.address,
} as const;

const BY_ADDRESS = new Map<string, JsonBodyType>([
  [RECORDED_ADDRESS.mcallen.toLowerCase(), mcallen],
  [RECORDED_ADDRESS.rioGrandeCity.toLowerCase(), rioGrandeCity],
  [RECORDED_ADDRESS.noMatch.toLowerCase(), noMatch],
]);

// Load-time envelope check. If someone re-records this file as a 200 body, every 503 test
// would quietly start asserting against a geocoder payload.
if (
  typeof serviceUnavailable.status !== 'number' ||
  typeof serviceUnavailable.body !== 'string'
) {
  throw new Error(
    'tests/unit/msw/server.ts: census-503.json is not a { status, body } envelope. ' +
      'See tests/unit/msw/fixtures/README.md - the other three files are verbatim 200 ' +
      'bodies and this one is deliberately not.',
  );
}

/** Every outbound request the handler saw, in order. The T-2-13 test reads this to assert
 *  where the caller's string ended up. */
export const censusRequests: URL[] = [];

type OneShot = { kind: 'unavailable' } | { kind: 'json'; body: JsonBodyType };

let oneShot: OneShot | null = null;

/** Make the NEXT request replay the hand-written 503 envelope. One call only — a sticky
 *  failure would leak into whichever test ran next. */
export function failNextWithServiceUnavailable(): void {
  oneShot = { kind: 'unavailable' };
}

/** Make the NEXT request return an arbitrary 200 body. Used to serve a deliberately
 *  mutated copy of a recorded payload (a non-Texas STATE) without editing the fixture. */
export function respondNextWithJson(body: JsonBodyType): void {
  oneShot = { kind: 'json', body };
}

/** Clear the request log and any pending one-shot. Call in `afterEach`. */
export function resetCensus(): void {
  censusRequests.length = 0;
  oneShot = null;
}

export const censusHandler = http.get(CENSUS_ENDPOINT, ({ request }) => {
  censusRequests.push(new URL(request.url));

  if (oneShot) {
    const pending = oneShot;
    oneShot = null;
    if (pending.kind === 'unavailable') {
      return new HttpResponse(serviceUnavailable.body, { status: serviceUnavailable.status });
    }
    return HttpResponse.json(pending.body);
  }

  const address = (new URL(request.url).searchParams.get('address') ?? '').toLowerCase();
  // An unrecorded address falls through to the empty-match payload, which is exactly what
  // the live service does for anything it cannot resolve.
  return HttpResponse.json(BY_ADDRESS.get(address) ?? noMatch);
});

export const server = setupServer(censusHandler);

/**
 * Start the replay server. 🔴 The `onUnhandledRequest` setting lives here, once, so it
 * cannot be relaxed per test file.
 */
export function startCensusServer(): void {
  server.listen({ onUnhandledRequest: 'error' });
}
