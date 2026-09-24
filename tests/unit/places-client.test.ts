/**
 * The ONE sanctioned Places client (criterion 1, D-03, D-19, Pitfalls 1d, 3 and 9).
 *
 * Every request here is answered by the msw replay harness (tests/unit/msw/places.ts) from
 * synthetic fixtures; `onUnhandledRequest: 'error'` turns anything else into a failure. The
 * Places host is never spelled in this file — URLs come from the harness's exports, so
 * tests/unit/no-network.test.ts can forbid the host everywhere outside tests/unit/msw/.
 *
 * What these pin, and the defect each one exists for:
 *   - the key and the mask leave on every request, and a page parses;
 *   - a daily-quota 429 is told apart from a per-minute 429 by the error's quota metadata,
 *     and an ambiguous 429 is DAILY (stop — the safe direction; D-19, Pitfall 3);
 *   - 400 / 503 / a transport failure / an unparseable 200 are each a named reason, never a
 *     throw (a thrown message lands in the workflow's step_failed event, Pitfall 1d);
 *   - no outcome ever carries response text;
 *   - no key → nothing is sent;
 *   - the module exports one call, and only the Text Search verb is spelled in it;
 *   - only the meter mints the reservation token the call requires.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import * as client from '@/lib/places/client';
import { placesKeyConfigured, searchText } from '@/lib/places/client';
import { mintReservedCall } from '@/lib/places/reserved-call';
import { buildFirstPage, buildNextPage, type PlacesRequest } from '@/lib/places/request';
import type { Rect } from '@/lib/places/tiling';
import dailyEnvelope from './msw/fixtures/places-429-daily.json';
import minuteEnvelope from './msw/fixtures/places-429-minute.json';
import invalidEnvelope from './msw/fixtures/places-400-invalid.json';
import unavailableEnvelope from './msw/fixtures/places-503.json';
import {
  PLACES_ENDPOINT,
  PLACES_PAGES,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
} from './msw/places';
import { server, startReplayServer } from './msw/server';
import { walk } from './_walk';

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

const RECT: Rect = { south: 26.1019, west: -98.3183, north: 26.4667, east: -98.1954 };
const KEY_VAR = 'GOOGLE_PLACES_API_KEY';

function enterprisePage(): PlacesRequest {
  return buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });
}

/** The token the meter would mint for `req`. Tests may mint; src/ may not (last test). */
function reservedFor(req: PlacesRequest) {
  return mintReservedCall('reservation-under-test', 'request-under-test', req.sku);
}

function routeError(error: 'daily' | 'minute' | 'invalid' | 'unavailable'): void {
  setPlacesRoutes([{ name: error, when: () => true, error }]);
}

/** Serve one hand-made response in front of the harness (cleared by resetHandlers). */
function serveOnce(response: () => Response): void {
  server.use(http.post(PLACES_ENDPOINT, response, { once: true }));
}

describe('the Places client (criterion 1, D-03)', () => {
  it('searchText sends the key and mask headers and parses the page', async () => {
    setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
    const req = enterprisePage();

    const outcome = await searchText(reservedFor(req), req);
    if (!outcome.ok) throw new Error(`expected a page, got ${JSON.stringify(outcome)}`);

    expect(outcome.places).toHaveLength(20);
    expect(outcome.places[0]?.id).toBe('synthetic-sat-001');
    expect(outcome.nextPageToken).toBe('saturated:p2');

    expect(placesRequests).toHaveLength(1);
    expect(placesRequests[0]?.hasKey).toBe(true);
    expect(placesRequests[0]?.mask).toBe(req.mask.join(','));
    // What went on the wire is exactly the builder's body.
    expect(placesRequests[0]?.body).toEqual(JSON.parse(JSON.stringify(req.body)));

    // Page 2 through the same client: the harness pages by token.
    const next = buildNextPage(req, outcome.nextPageToken as string);
    const page2 = await searchText(reservedFor(next), next);
    if (!page2.ok) throw new Error(`expected page 2, got ${JSON.stringify(page2)}`);
    expect(page2.places[0]?.id).toBe('synthetic-sat-021');
    expect(page2.nextPageToken).toBe('saturated:p3');
  });

  it('searchText returns a last page with a null token', async () => {
    setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
    const req = buildNextPage(enterprisePage(), 'saturated:p3');

    const outcome = await searchText(reservedFor(req), req);
    if (!outcome.ok) throw new Error(`expected page 3, got ${JSON.stringify(outcome)}`);
    expect(outcome.places).toHaveLength(20);
    expect(outcome.nextPageToken).toBeNull();
  });

  it('searchText parses an empty search as zero places', async () => {
    // No route → the harness serves places-empty.json, which is `{}`.
    const req = enterprisePage();
    const outcome = await searchText(reservedFor(req), req);
    expect(outcome).toEqual({ ok: true, places: [], nextPageToken: null });
  });

  it('searchText classifies a daily quota 429', async () => {
    routeError('daily');
    const req = enterprisePage();
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'daily_quota',
      status: 429,
    });
  });

  it('searchText classifies a per-minute 429', async () => {
    routeError('minute');
    const req = enterprisePage();
    const outcome = await searchText(reservedFor(req), req);
    expect(outcome).toMatchObject({ ok: false, reason: 'rate_limited', status: 429 });
    if (outcome.ok) throw new Error('unreachable');
    // No Retry-After header on the fixture → the committed default.
    expect(outcome.retryAfterMs).toBe(60_000);

    // A numeric Retry-After (seconds) is honoured.
    serveOnce(() =>
      HttpResponse.json(minuteEnvelope.body, { status: 429, headers: { 'Retry-After': '7' } }),
    );
    const honoured = await searchText(reservedFor(req), req);
    if (honoured.ok) throw new Error('expected a 429');
    expect(honoured.reason).toBe('rate_limited');
    expect(honoured.retryAfterMs).toBe(7_000);
  });

  it('a Retry-After longer than five minutes is clamped', async () => {
    // B-WR-06: an unbounded delta would put the step to sleep for a day, while admission reclaims
    // the run as `abandoned` after 30 minutes.
    const req = enterprisePage();
    serveOnce(() =>
      HttpResponse.json(minuteEnvelope.body, { status: 429, headers: { 'Retry-After': '86400' } }),
    );
    const clamped = await searchText(reservedFor(req), req);
    if (clamped.ok) throw new Error('expected a 429');
    expect(clamped).toMatchObject({ reason: 'rate_limited', retryAfterMs: 300_000 });
  });

  it('searchText classifies 401, 403 and 404 as rejected, never retried', async () => {
    // B-WR-06: a bad or restricted key, Places API (New) not enabled, or billing disabled is a
    // 403 PERMISSION_DENIED — retrying it three times per run only hides the real cause.
    const req = enterprisePage();
    for (const status of [401, 403, 404]) {
      serveOnce(() =>
        HttpResponse.json(
          { error: { code: status, message: 'Synthetic: denied.', status: 'PERMISSION_DENIED' } },
          { status },
        ),
      );
      expect(await searchText(reservedFor(req), req), String(status)).toEqual({
        ok: false,
        reason: 'rejected',
        status,
      });
    }
  });

  it('searchText treats an ambiguous 429 as daily', async () => {
    // A 429 with no quota metadata at all: stopping is the safe direction.
    serveOnce(() =>
      HttpResponse.json(
        { error: { code: 429, message: 'Synthetic: slow down.', status: 'RESOURCE_EXHAUSTED' } },
        { status: 429 },
      ),
    );
    const req = enterprisePage();
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'daily_quota',
      status: 429,
    });

    // ...and a 429 whose body is not JSON at all.
    serveOnce(() => new HttpResponse('not json', { status: 429 }));
    expect(await searchText(reservedFor(req), req)).toMatchObject({ reason: 'daily_quota' });
  });

  it('searchText classifies a 400 as rejected', async () => {
    routeError('invalid');
    const req = enterprisePage();
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'rejected',
      status: 400,
    });
  });

  it('searchText classifies a 503 as unavailable', async () => {
    routeError('unavailable');
    const req = enterprisePage();
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'unavailable',
      status: 503,
    });
  });

  it('searchText classifies a network error as timeout', async () => {
    // Unknown outcome: the request may have reached Google. The caller settles it as charged
    // (Pitfall 9); the client's job is only to say it does not know.
    serveOnce(() => HttpResponse.error());
    const req = enterprisePage();
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'timeout',
      status: null,
    });
  });

  it('searchText classifies an unparseable 200 as bad_shape', async () => {
    const req = enterprisePage();

    serveOnce(() => HttpResponse.json({ places: [{ id: 42 }] }));
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'bad_shape',
      status: 200,
    });

    serveOnce(() => new HttpResponse('<html>not json</html>', { status: 200 }));
    expect(await searchText(reservedFor(req), req)).toEqual({
      ok: false,
      reason: 'bad_shape',
      status: 200,
    });
  });

  it('searchText refuses without a key and sends nothing', async () => {
    setPlacesRoutes([{ name: 'saturated', when: () => true, pages: PLACES_PAGES.saturated }]);
    const saved = process.env[KEY_VAR];
    // Positive control: the lane sets a fake key, so the refusal below is the deletion's doing.
    expect(saved).toBeTruthy();
    expect(placesKeyConfigured()).toBe(true);
    delete process.env[KEY_VAR];
    try {
      expect(placesKeyConfigured()).toBe(false);
      const req = enterprisePage();
      expect(await searchText(reservedFor(req), req)).toEqual({
        ok: false,
        reason: 'no_key',
        status: null,
      });
      expect(placesRequests).toHaveLength(0);

      // An empty string is not a key either (an unset GitHub secret arrives as '').
      process.env[KEY_VAR] = '';
      expect(placesKeyConfigured()).toBe(false);
      expect(await searchText(reservedFor(req), req)).toMatchObject({ reason: 'no_key' });
      expect(placesRequests).toHaveLength(0);
    } finally {
      process.env[KEY_VAR] = saved;
    }
  });

  it('searchText refuses a reservation for a different sku and sends nothing', async () => {
    // A token reserved at the free ids-only price must not carry an Enterprise request.
    const req = enterprisePage();
    const cheap = mintReservedCall('reservation-under-test', 'request-under-test', 'ts_essentials');
    expect(await searchText(cheap, req)).toEqual({ ok: false, reason: 'rejected', status: null });
    expect(placesRequests).toHaveLength(0);
  });

  it("a failed request's outcome never contains response text", async () => {
    const envelopes = {
      daily: dailyEnvelope,
      minute: minuteEnvelope,
      invalid: invalidEnvelope,
      unavailable: unavailableEnvelope,
    } as const;
    const req = enterprisePage();

    for (const [name, envelope] of Object.entries(envelopes) as Array<
      [keyof typeof envelopes, (typeof envelopes)[keyof typeof envelopes]]
    >) {
      routeError(name);
      const outcome = await searchText(reservedFor(req), req);
      // Positive control: it really was a failure served from this fixture.
      expect(outcome.ok, name).toBe(false);
      expect(outcome, name).toMatchObject({ status: envelope.status });

      const text = JSON.stringify(outcome);
      expect(text, name).not.toContain(envelope.body.error.message);
      expect(text, name).not.toContain(envelope.body.error.status);
      expect(text, name).not.toContain('Synthetic');
      resetPlaces();
    }
  });

  it('place details is unreachable', () => {
    // One call, plus the key probe. Types vanish at runtime, so this is the whole surface.
    expect(Object.keys(client).sort()).toEqual(['placesKeyConfigured', 'searchText']);

    const source = nodeFs.readFileSync(nodePath.join('src', 'lib', 'places', 'client.ts'), 'utf8');
    // Positive control: this is the real module (it spells the Text Search verb once).
    expect(source.match(/:searchText/g) ?? []).toHaveLength(1);
    // No other Places verb or resource path is spelled at all.
    expect(source).not.toMatch(/v1\/places\/|places:get|placeDetails|:autocomplete|:searchNearby/);
  });

  it('no module but the meter mints a reserved call', () => {
    const scanned = walk('src', { exts: new Set(['.ts', '.tsx']) }).map((f) =>
      f.split(nodePath.sep).join('/'),
    );
    // Two-sided: the walk found the module that defines the minter, and that module is
    // really where it lives — a scan of nothing would be green forever.
    expect(scanned).toContain('src/lib/places/reserved-call.ts');
    expect(nodeFs.readFileSync('src/lib/places/reserved-call.ts', 'utf8')).toContain(
      'export function mintReservedCall',
    );

    const minters = scanned.filter(
      (f) =>
        f !== 'src/lib/places/reserved-call.ts' &&
        nodeFs.readFileSync(f, 'utf8').includes('mintReservedCall'),
    );
    // An EQUALITY (04-16): the meter is the one minter, and it really does mint. Zero minters
    // would mean no Places call could ever be made; a second one is a path around the meter.
    expect(minters).toEqual(['src/lib/places/meter.ts']);
  });
});
