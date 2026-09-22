/**
 * The US Census Geocoder client, replayed from recorded payloads. D-02, SRCH-01, T-2-13.
 *
 * Every request in this file is served by `./msw/server.ts` from a file on disk. Nothing
 * here touches the network, and `onUnhandledRequest: 'error'` turns an accidental live
 * call into a failure rather than a flake.
 *
 * 🔴 The two defects these tests exist to catch are both invisible to a `toBeDefined`:
 *   1. reading `coordinates` in written order, because `x` is LONGITUDE and `y` is
 *      LATITUDE - a swap still yields two finite numbers and a green shape check, and
 *      puts the RGV in the Indian Ocean. Pinned with a SIGN assertion and against the
 *      payload's own axes.
 *   2. treating HTTP 200 as success, because every failing input returns 200 with an
 *      empty `addressMatches`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { geocodeAddress } from '@/lib/geocode/census';
import mcallenFixture from './msw/fixtures/census-mcallen.json';
import rioGrandeCityFixture from './msw/fixtures/census-rio-grande-city.json';
import {
  CENSUS_ORIGIN,
  CENSUS_PATHNAME,
  censusRequests,
  failNextWithServiceUnavailable,
  RECORDED_ADDRESS,
  resetCensus,
  respondNextWithJson,
  server,
  startCensusServer,
} from './msw/server';

beforeAll(() => {
  startCensusServer();
});
afterEach(() => {
  server.resetHandlers();
  resetCensus();
});
afterAll(() => {
  server.close();
});

const mcallenMatch = mcallenFixture.result.addressMatches[0];
const rioGrandeCityMatch = rioGrandeCityFixture.result.addressMatches[0];
if (!mcallenMatch || !rioGrandeCityMatch) {
  throw new Error('tests/unit/census.test.ts: a recorded 200 fixture carries no addressMatch');
}

describe('the US Census Geocoder (D-02, SRCH-01)', () => {
  it('census: a McAllen street address resolves to Hidalgo County', async () => {
    const result = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    if (!result.ok) throw new Error(`expected a match, got reason "${result.reason}"`);

    // Pitfall 7: the Census GEOID, not the Comptroller code. Hidalgo is 48215 here and
    // 108 in the sales-tax dataset, and confusing them makes every radius estimate zero.
    expect(result.countyFips).toBe('48215');
    expect(result.countyName).toContain('Hidalgo');

    // 🔴 AXIS ORDER, asserted three ways. The RGV is north of the equator and west of
    // Greenwich, so a swap flips both signs at once.
    expect(result.lat).toBeGreaterThan(0);
    expect(result.lng).toBeLessThan(0);
    expect(result.lat).toBeCloseTo(26.2161, 3);
    expect(result.lng).toBeCloseTo(-98.2278, 3);
    // Straight against the payload's own axes: `y` is latitude, `x` is longitude.
    expect(result.lat).toBe(mcallenMatch.coordinates.y);
    expect(result.lng).toBe(mcallenMatch.coordinates.x);

    // 🔴 The SERVICE's spelling, not the user's. A bad ZIP is silently corrected upstream,
    // so the string the UI shows must be the one that came back.
    expect(result.matchedAddress).toBe(mcallenMatch.matchedAddress);
    expect(result.matchedAddress).not.toBe(RECORDED_ADDRESS.mcallen);
  });

  it('census: a Rio Grande City address resolves to Starr County', async () => {
    const result = await geocodeAddress(RECORDED_ADDRESS.rioGrandeCity);
    if (!result.ok) throw new Error(`expected a match, got reason "${result.reason}"`);

    expect(result.countyFips).toBe('48427');
    expect(result.countyName).toContain('Starr');
    expect(result.lat).toBe(rioGrandeCityMatch.coordinates.y);
    expect(result.lng).toBe(rioGrandeCityMatch.coordinates.x);
    expect(result.lat).toBeGreaterThan(0);
    expect(result.lng).toBeLessThan(0);
  });

  it('census: an empty addressMatches is a no_match, not an error', async () => {
    // The fixture is a real HTTP 200 whose `addressMatches` is `[]` - the recorded
    // response to a business name. Awaiting without a rejection IS the "nothing threw"
    // assertion; a throw here would fail the test rather than be swallowed.
    const result = await geocodeAddress(RECORDED_ADDRESS.noMatch);

    expect(result).toEqual({ ok: false, reason: 'no_match' });
    // And it really did go out and come back 200 - this is not the input guard firing.
    expect(censusRequests).toHaveLength(1);
  });

  it('census: a 503 is unreachable', async () => {
    failNextWithServiceUnavailable();
    const result = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    expect(result).toEqual({ ok: false, reason: 'unreachable' });

    // Positive control: the same address on the next call succeeds, so the assertion
    // above was about the 503 and not about the address being unresolvable.
    const afterOutage = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    expect(afterOutage.ok).toBe(true);
  });

  it('census texas only: a non-Texas match is rejected', async () => {
    // The McAllen payload with one field changed: STATE 48 (Texas) -> 22 (Louisiana).
    // Everything else, including the Texas-looking coordinates and county name, is
    // untouched, so only the guard can produce the right verdict.
    const louisiana = structuredClone(mcallenFixture);
    const county = louisiana.result.addressMatches[0]?.geographies.Counties[0];
    if (!county) throw new Error('the cloned fixture lost its county layer');
    county.STATE = '22';

    respondNextWithJson(louisiana);
    const rejected = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    expect(rejected).toEqual({ ok: false, reason: 'not_texas' });

    // Positive control, beside it: the unmodified fixture still resolves.
    const accepted = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    expect(accepted.ok).toBe(true);
  });

  it('census: the address is only ever a query parameter', async () => {
    // T-2-13. Neither of these is refused by the input guard - they are legal strings -
    // so each one really is sent, and the assertion is about WHERE it lands.
    for (const adversarial of ['../../evil?x=', 'https://evil.example/']) {
      resetCensus();
      await geocodeAddress(adversarial);

      expect(censusRequests).toHaveLength(1);
      const url = censusRequests[0];
      if (!url) throw new Error('no request was recorded');

      expect(url.origin).toBe(CENSUS_ORIGIN);
      expect(url.pathname).toBe(CENSUS_PATHNAME);
      // Percent-encoded into the value slot: the `?x=` did not become a second parameter
      // and the `../..` did not become path segments.
      expect(url.searchParams.get('address')).toBe(adversarial);
      expect(url.searchParams.get('x')).toBeNull();

      // The fixed parameters are still exactly what the fixtures were recorded with.
      expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
      expect(url.searchParams.get('vintage')).toBe('Current_Current');
      expect(url.searchParams.get('layers')).toBe('Counties');
      expect(url.searchParams.get('format')).toBe('json');
    }
  });

  it('census: an over-long or empty address is refused before any request', async () => {
    const refusals = [
      'a'.repeat(500),
      '',
      '  ',
      // CRLF, the one class that could corrupt the request rather than just ride in it.
      '1400 N 10th St\r\nHost: evil.example',
    ];

    for (const input of refusals) {
      const result = await geocodeAddress(input);
      expect(result).toEqual({ ok: false, reason: 'no_match' });
    }
    // The msw request counter never moved: nothing reached the handler, let alone the net.
    expect(censusRequests).toHaveLength(0);

    // Two-sided. A guard that refused everything would pass every assertion above.
    const real = await geocodeAddress(RECORDED_ADDRESS.mcallen);
    expect(real.ok).toBe(true);
    expect(censusRequests).toHaveLength(1);
  });
});
