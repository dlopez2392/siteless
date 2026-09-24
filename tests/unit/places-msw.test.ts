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

/** VALID_BODY for another Table A type — the textQuery follows the type, as the builder spells it. */
const typed = (t: string): Record<string, unknown> => ({
  ...VALID_BODY,
  includedType: t,
  textQuery: t.replaceAll('_', ' '),
});

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

    const withoutFlag = { ...VALID_BODY };
    delete withoutFlag.includePureServiceAreaBusinesses;
    expect(withoutFlag).not.toHaveProperty('includePureServiceAreaBusinesses');
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

    // A token the harness never issued is refused, never served (B-WR-10).
    const past = await search({ ...VALID_BODY, pageToken: 'saturated:p4' });
    expect(past.status).toBe(501);
  });

  it('the places handler refuses a request no route claims', async () => {
    // B-WR-10: an empty 200 for an unrecognised request would let a builder regression (a wrong
    // rectangle, type or page body) complete green with no results. A test that wants an empty
    // page routes to PLACES_PAGES.empty explicitly.
    setPlacesRoutes([{ name: 'saturated', when: plumbers, pages: PLACES_PAGES.saturated }]);
    const unrouted = await search(typed('florist'));
    expect(unrouted.status).toBe(501);
    expect(await unrouted.text()).toMatch(/no route/);
    expect(placesRequests).toHaveLength(0);

    // Positive control: routed explicitly, the same request is the zero-result body `{}`.
    setPlacesRoutes([{ name: 'empty', when: () => true, pages: PLACES_PAGES.empty }]);
    const empty = await search(typed('florist'));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({});
  });

  it('the places handler refuses a body the builder would never send', async () => {
    // B-WR-10: every invariant request.ts fixes, not only the service-area flag.
    setPlacesRoutes([{ name: 'any', when: () => true, pages: PLACES_PAGES.saturated }]);
    const bad: Array<[string, Record<string, unknown>]> = [
      ['strictTypeFiltering', { ...VALID_BODY, strictTypeFiltering: false }],
      ['pageSize', { ...VALID_BODY, pageSize: 10 }],
      ['regionCode', { ...VALID_BODY, regionCode: 'MX' }],
      ['languageCode', { ...VALID_BODY, languageCode: 'es' }],
      ['includedType', { ...VALID_BODY, includedType: 'general_contractor' }],
      ['textQuery', { ...VALID_BODY, textQuery: 'plumbers near me' }],
      [
        'rectangle',
        {
          ...VALID_BODY,
          locationRestriction: {
            rectangle: {
              low: { latitude: 26.3, longitude: -98.2 },
              high: { latitude: 26.15, longitude: -98.3 },
            },
          },
        },
      ],
      ['unknown key', { ...VALID_BODY, locationBias: {} }],
    ];
    for (const [what, body] of bad) {
      const res = await search(body);
      expect(res.status, what).toBe(501);
    }
    const strict = { ...VALID_BODY };
    delete strict.strictTypeFiltering;
    expect((await search(strict)).status, 'strictTypeFiltering absent').toBe(501);
    // A mask field the product never requests (types, businessStatus) is refused too.
    const typed = await search(VALID_BODY, {
      [KEY_HEADER]: 'test-key',
      [MASK_HEADER]: 'places.id,places.types',
    });
    expect(typed.status).toBe(501);
    expect(placesRequests).toHaveLength(0);

    // Positive control.
    expect((await search(VALID_BODY)).status).toBe(200);
  });

  it('the places handler refuses a later page whose body differs from page 1', async () => {
    // B-WR-10 / M49: Google answers INVALID_ARGUMENT when a page-2/3 body differs from page 1
    // in anything but pageToken / pageSize / maxResultCount.
    setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
    const first = (await (await search(VALID_BODY)).json()) as Served;
    expect(first.nextPageToken).toBe('saturated:p2');

    const moved = {
      ...VALID_BODY,
      locationRestriction: {
        rectangle: {
          low: { latitude: 26.16, longitude: -98.3 },
          high: { latitude: 26.3, longitude: -98.2 },
        },
      },
      pageToken: first.nextPageToken,
    };
    expect((await search(moved)).status).toBe(501);
    // Positive control: page 1's body plus the token is served.
    expect((await search({ ...VALID_BODY, pageToken: first.nextPageToken })).status).toBe(200);
  });

  it('the places handler omits the US country the way regionCode US does', async () => {
    // B-WR-10 / B-CR-01: with regionCode US, Google leaves the country off a US address. A
    // fixture that still carries ", USA" is served the way Google would serve it.
    setPlacesRoutes([
      {
        name: 'suffixed',
        when: () => true,
        pages: [
          {
            places: [
              { id: 'synthetic-suffix-1', formattedAddress: '1 Synthetic St, McAllen, TX 78501, USA' },
              { id: 'synthetic-suffix-2', formattedAddress: 'Calle 1, Reynosa, Tamps., Mexico' },
            ],
          },
        ],
      },
    ]);
    const page = (await (await search(VALID_BODY)).json()) as Served;
    expect(page.places?.map((p) => p.formattedAddress)).toEqual([
      '1 Synthetic St, McAllen, TX 78501',
      'Calle 1, Reynosa, Tamps., Mexico',
    ]);
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

    // `times` defaults to 1: the second identical request falls through — here to no route at
    // all, which is refused (B-WR-10), never an empty page.
    const after = await search(VALID_BODY);
    expect(after.status).toBe(501);

    const minute = await search(typed('electrician'));
    expect(minute.status).toBe(429);
    expect(await minute.json()).toEqual(minuteEnvelope.body);

    const invalid = await search(typed('locksmith'));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(invalidEnvelope.body);

    const unavailable = await search(typed('roofing_contractor'));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual(unavailableEnvelope.body);
  });

  it('the places sentinels cover every google string in the fixtures', () => {
    expect(PLACES_SENTINELS).toContain('Ortiz Plumbing');
    // B-CR-01: the realistic regionCode=US shape, no country suffix.
    expect(PLACES_SENTINELS).toContain('1200 N 10th St, McAllen, TX 78501');
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
