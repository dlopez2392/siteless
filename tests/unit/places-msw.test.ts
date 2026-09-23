/**
 * The Places replay harness itself (plan 04-10, PLACE-05, PLACE-01, D-01, D-20).
 *
 * Every later Places test — unit, DB and workflow lane — is only as strict as this handler.
 * So this file pins the handler's refusals, not just its happy path:
 *   - a request missing the field mask, the key, or `includePureServiceAreaBusinesses: true`
 *     gets a 501, never a page (M26 support: a builder regression goes red);
 *   - the handler is a RegExp, so a look-alike path is UNHANDLED (Pitfall 8, measured);
 *   - the served body carries only the fields the mask names, so an IDs-only request can
 *     never be handed a `websiteUri`.
 *
 * 🔴 No URL in this file spells the Places host. It is built from `PLACES_ORIGIN`, which lives
 * under `tests/unit/msw/` — the one prefix `no-network.test.ts` allows to name a host.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import dailyEnvelope from './msw/fixtures/places-429-daily.json';
import minuteEnvelope from './msw/fixtures/places-429-minute.json';
import invalidEnvelope from './msw/fixtures/places-400-invalid.json';
import unavailableEnvelope from './msw/fixtures/places-503.json';
import {
  onPlacesRequest,
  PLACES_ORIGIN,
  PLACES_PAGES,
  PLACES_SENTINELS,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
} from './msw/places';
import { server, startReplayServer } from './msw/server';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetPlaces();
});
afterAll(() => {
  server.close();
});

const SEARCH_URL = `${PLACES_ORIGIN}/v1/places:searchText`;

/** The body the request builder (04-12) sends. Hand-written here on purpose: this file tests
 *  the harness, and must not agree with the builder's bugs by importing it. */
const VALID_BODY: Record<string, unknown> = {
  textQuery: 'plumber',
  includedType: 'plumber',
  strictTypeFiltering: true,
  locationRestriction: {
    rectangle: {
      low: { latitude: 26.15, longitude: -98.3 },
      high: { latitude: 26.3, longitude: -98.2 },
    },
  },
  includePureServiceAreaBusinesses: true,
  pageSize: 20,
  regionCode: 'US',
  languageCode: 'en',
};

const FULL_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.businessStatus',
  'places.pureServiceAreaBusiness',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'nextPageToken',
].join(',');

const KEY_HEADER = 'X-Goog-Api-Key';
const MASK_HEADER = 'X-Goog-FieldMask';

function search(
  body: Record<string, unknown>,
  headers: Record<string, string> = { [KEY_HEADER]: 'test-key', [MASK_HEADER]: FULL_MASK },
  url: string = SEARCH_URL,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type Served = { places?: Array<Record<string, unknown>>; nextPageToken?: string };

const plumbers = (body: Record<string, unknown>) => body.includedType === 'plumber';

describe('the Places replay harness (plan 04-10)', () => {
  it('the places handler refuses a request without the field mask header', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);

    const refused = await search(VALID_BODY, { [KEY_HEADER]: 'test-key' });
    expect(refused.status).toBe(501);
    expect(await refused.text()).toMatch(/X-Goog-FieldMask/);

    // Positive control: the same request WITH the mask is served a page.
    const served = await search(VALID_BODY);
    expect(served.status).toBe(200);
    expect(((await served.json()) as Served).places).toHaveLength(20);
  });

  it('the places handler refuses a request without the api key header', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);

    const refused = await search(VALID_BODY, { [MASK_HEADER]: FULL_MASK });
    expect(refused.status).toBe(501);
    expect(await refused.text()).toMatch(/X-Goog-Api-Key/);

    const empty = await search(VALID_BODY, { [KEY_HEADER]: '', [MASK_HEADER]: FULL_MASK });
    expect(empty.status).toBe(501);
  });

  it('the places handler refuses a request without includePureServiceAreaBusinesses', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);

    const { includePureServiceAreaBusinesses: _dropped, ...withoutFlag } = VALID_BODY;
    const missing = await search(withoutFlag);
    expect(missing.status).toBe(501);
    expect(await missing.text()).toMatch(/includePureServiceAreaBusinesses/);

    // `false` is as wrong as absent: a pure service-area business would be dropped silently.
    const falsy = await search({ ...VALID_BODY, includePureServiceAreaBusinesses: false });
    expect(falsy.status).toBe(501);
    expect(await falsy.text()).toMatch(/includePureServiceAreaBusinesses/);

    // A refused request is never logged as served.
    expect(placesRequests).toHaveLength(0);
  });

  it('the places handler never matches a look-alike path', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);

    // `onUnhandledRequest: 'error'` makes an unmatched request reject, not reach the network.
    await expect(search(VALID_BODY, undefined, `${PLACES_ORIGIN}/v1/placesXYZ`)).rejects.toThrow();
    await expect(
      search(VALID_BODY, undefined, `${PLACES_ORIGIN}/v1/places:searchTextXYZ`),
    ).rejects.toThrow();
    expect(placesRequests).toHaveLength(0);

    // Positive control: the exact path IS handled, and is logged.
    const served = await search(VALID_BODY);
    expect(served.status).toBe(200);
    expect(placesRequests).toHaveLength(1);
  });

  it('the places handler serves only the masked fields', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);

    const idsOnly = (await (
      await search(VALID_BODY, {
        [KEY_HEADER]: 'test-key',
        [MASK_HEADER]: 'places.id,nextPageToken',
      })
    ).json()) as Served;
    expect(idsOnly.places).toHaveLength(20);
    for (const place of idsOnly.places ?? []) {
      expect(Object.keys(place)).toEqual(['id']);
    }
    expect(idsOnly.nextPageToken).toBe('saturated:p2');

    // `nextPageToken` is served only when masked.
    const noToken = (await (
      await search(VALID_BODY, { [KEY_HEADER]: 'test-key', [MASK_HEADER]: 'places.id' })
    ).json()) as Served;
    expect(noToken.nextPageToken).toBeUndefined();

    // Positive control: the full mask does carry the website (so the filter is not simply
    // stripping everything).
    const full = (await (await search(VALID_BODY)).json()) as Served;
    expect((full.places ?? []).some((p) => typeof p.websiteUri === 'string')).toBe(true);

    // The log records the mask and the key's presence as they arrived.
    expect(placesRequests.map((r) => r.mask)).toEqual([
      'places.id,nextPageToken',
      'places.id',
      FULL_MASK,
    ]);
    expect(placesRequests.every((r) => r.hasKey)).toBe(true);
  });

  it('the places handler pages by token', async () => {
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);
    const hooked: Array<Record<string, unknown>> = [];
    onPlacesRequest(({ body }) => {
      hooked.push(body);
    });

    const ids: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const res = await search(token ? { ...VALID_BODY, pageToken: token } : VALID_BODY);
      expect(res.status).toBe(200);
      const page = (await res.json()) as Served;
      ids.push(...(page.places ?? []).map((p) => String(p.id)));
      token = page.nextPageToken;
      pages += 1;
    } while (token && pages < 5);

    expect(pages).toBe(3);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(ids[0]).toBe('synthetic-sat-001');
    expect(ids[59]).toBe('synthetic-sat-060');
    expect(hooked.map((b) => b.pageToken)).toEqual([undefined, 'saturated:p2', 'saturated:p3']);

    // A page past the recording is refused, never served short.
    const past = await search({ ...VALID_BODY, pageToken: 'saturated:p4' });
    expect(past.status).toBe(501);

    // A request no route claims is served the zero-result body `{}`.
    const unrouted = await search({ ...VALID_BODY, includedType: 'florist' });
    expect(unrouted.status).toBe(200);
    expect(await unrouted.json()).toEqual({});
  });

  it('the places handler serves the error envelopes', async () => {
    setPlacesRoutes([
      { name: 'daily', when: (b) => b.includedType === 'plumber', error: 'daily' },
      { name: 'minute', when: (b) => b.includedType === 'electrician', error: 'minute' },
      { name: 'invalid', when: (b) => b.includedType === 'locksmith', error: 'invalid' },
      {
        name: 'unavailable',
        when: (b) => b.includedType === 'roofing_contractor',
        error: 'unavailable',
      },
    ]);

    const daily = await search(VALID_BODY);
    expect(daily.status).toBe(429);
    expect(await daily.json()).toEqual(dailyEnvelope.body);

    // `times` defaults to 1: the second identical request falls through (here, to `{}`).
    const after = await search(VALID_BODY);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({});

    const minute = await search({ ...VALID_BODY, includedType: 'electrician' });
    expect(minute.status).toBe(429);
    expect(await minute.json()).toEqual(minuteEnvelope.body);

    const invalid = await search({ ...VALID_BODY, includedType: 'locksmith' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(invalidEnvelope.body);

    const unavailable = await search({ ...VALID_BODY, includedType: 'roofing_contractor' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual(unavailableEnvelope.body);
  });

  it('the places sentinels cover every google string in the fixtures', () => {
    expect(PLACES_SENTINELS).toContain('Ortiz Plumbing');
    expect(PLACES_SENTINELS).toContain('1200 N 10th St, McAllen, TX 78501, USA');
    expect(PLACES_SENTINELS).toContain('(956) 631-0001');
    expect(PLACES_SENTINELS).toContain('https://garza-electric-synthetic.business.site');
    // Every page's strings, not just the match page's.
    expect(PLACES_SENTINELS).toContain('Synthetic Plumber 060');
    expect(PLACES_SENTINELS).toContain('Synthetic Child Plumber 12');
    expect(PLACES_SENTINELS.length).toBeGreaterThanOrEqual(150);
    // No empty or duplicate sentinel: an empty string would match every scanned text.
    expect(PLACES_SENTINELS.every((s) => s.length > 0)).toBe(true);
    expect(new Set(PLACES_SENTINELS).size).toBe(PLACES_SENTINELS.length);
  });
});
