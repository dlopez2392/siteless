/**
 * PLACE-01 / PLACE-05 — the ONE place a Places Text Search request is shaped.
 *
 * Gate mutations, one named test each:
 *   - M26: the builder drops `includePureServiceAreaBusinesses`
 *       → 'every places request carries includePureServiceAreaBusinesses'
 *   - M49: page 2 rebuilds its body (e.g. drops `strictTypeFiltering`) instead of repeating
 *       page 1's → "a page request repeats the first request's body". Google answers a page
 *       request whose parameters differ from the first request's with INVALID_ARGUMENT.
 *
 * Pure: no msw, no network. The client that SENDS these is tested in places-client.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  PLACES_IDS_ONLY_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
} from '@/lib/budget/field-mask-tier';
import { buildFirstPage, buildNextPage } from '@/lib/places/request';
import type { Rect } from '@/lib/places/tiling';

/** McAllen-ish. Every coordinate distinct, so a swapped axis cannot pass by coincidence. */
const RECT: Rect = { south: 26.1019, west: -98.3183, north: 26.4667, east: -98.1954 };

describe('the Places request builder (PLACE-01, PLACE-05)', () => {
  it('every places request carries includePureServiceAreaBusinesses', () => {
    const enterprise = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });
    const idsOnly = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'ids_only' });

    expect(enterprise.body.includePureServiceAreaBusinesses).toBe(true);
    expect(idsOnly.body.includePureServiceAreaBusinesses).toBe(true);
    // Every later page, too — built from page 1, so it cannot lose the flag.
    expect(buildNextPage(enterprise, 't').body.includePureServiceAreaBusinesses).toBe(true);
    expect(buildNextPage(idsOnly, 't').body.includePureServiceAreaBusinesses).toBe(true);

    // The rest of the invariant body, which no call site may vary.
    for (const req of [enterprise, idsOnly]) {
      expect(req.body.strictTypeFiltering).toBe(true);
      expect(req.body.pageSize).toBe(20);
      expect(req.body.regionCode).toBe('US');
      expect(req.body.languageCode).toBe('en');
      expect(req.body.includedType).toBe('plumber');
      // A first page carries no token at all (not even an undefined key that serializes away
      // on one runtime and not another).
      expect(Object.keys(req.body)).not.toContain('pageToken');
    }
  });

  it('the builder picks the mask and its sku from the mode', () => {
    const enterprise = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });
    const idsOnly = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'ids_only' });

    expect(enterprise.mask).toEqual(PLACES_TEXT_SEARCH_FIELD_MASK);
    expect(enterprise.sku).toBe('ts_enterprise');
    expect(idsOnly.mask).toEqual(PLACES_IDS_ONLY_FIELD_MASK);
    expect(idsOnly.sku).toBe('ts_essentials');
  });

  it("a page request repeats the first request's body", () => {
    const first = buildFirstPage({
      placesType: 'roofing_contractor',
      rect: RECT,
      mode: 'enterprise',
    });
    const second = buildNextPage(first, 'tok');

    expect(second.body).toEqual({ ...first.body, pageToken: 'tok' });
    expect(second.mask).toEqual(first.mask);
    expect(second.sku).toBe(first.sku);

    // Page 3 is page 1's body with page 3's token — built from page 2 it still carries
    // nothing page 1 did not, and it does not keep page 2's token.
    const third = buildNextPage(second, 'tok3');
    expect(third.body).toEqual({ ...first.body, pageToken: 'tok3' });

    // Page 1 is not mutated by building page 2 from it.
    expect(Object.keys(first.body)).not.toContain('pageToken');
  });

  it('the builder refuses a page token that is empty', () => {
    const first = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });
    expect(() => buildNextPage(first, '')).toThrow(/page token/);
  });

  it('the builder refuses a type Google does not accept', () => {
    // general_contractor is Table B only: a response type, never a request type.
    expect(() =>
      buildFirstPage({ placesType: 'general_contractor', rect: RECT, mode: 'enterprise' }),
    ).toThrow(/general_contractor/);
    // Positive control: a Table A type builds.
    expect(
      buildFirstPage({ placesType: 'roofing_contractor', rect: RECT, mode: 'enterprise' }).body
        .includedType,
    ).toBe('roofing_contractor');
  });

  it('the builder sends a rectangle south-west low and north-east high', () => {
    const { body } = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });

    expect(body.locationRestriction).toEqual({
      rectangle: {
        low: { latitude: RECT.south, longitude: RECT.west },
        high: { latitude: RECT.north, longitude: RECT.east },
      },
    });
    // An inverted rectangle would not be refused by Google: an inverted longitude range means
    // "crosses the antimeridian" and searches most of the planet. Refused here instead.
    expect(() =>
      buildFirstPage({
        placesType: 'plumber',
        rect: { ...RECT, west: RECT.east, east: RECT.west },
        mode: 'enterprise',
      }),
    ).toThrow(/rectangle/);
    expect(() =>
      buildFirstPage({
        placesType: 'plumber',
        rect: { ...RECT, south: RECT.north, north: RECT.south },
        mode: 'enterprise',
      }),
    ).toThrow(/rectangle/);
    expect(() =>
      buildFirstPage({
        placesType: 'plumber',
        rect: { ...RECT, north: Number.NaN },
        mode: 'enterprise',
      }),
    ).toThrow(/rectangle/);
  });

  it('the builder derives textQuery from the type', () => {
    expect(
      buildFirstPage({ placesType: 'roofing_contractor', rect: RECT, mode: 'enterprise' }).body
        .textQuery,
    ).toBe('roofing contractor');
    expect(
      buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'ids_only' }).body.textQuery,
    ).toBe('plumber');
  });

  it('a built request cannot be edited after the fact', () => {
    const first = buildFirstPage({ placesType: 'plumber', rect: RECT, mode: 'enterprise' });
    // Frozen, so a caller cannot "just this once" flip a constant on a built request.
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.body)).toBe(true);
    expect(Object.isFrozen(first.mask)).toBe(true);
  });
});
