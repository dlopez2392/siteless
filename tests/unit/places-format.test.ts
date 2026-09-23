/**
 * `src/lib/ui/places-format.ts` — the Places-derived values' one formatter each (04-07 Task 3).
 *
 * Host classes are words, never colours (D-09); the chips read the matcher's numeric feature
 * keys defensively, because `features` arrives as stored jsonb; the Maps link is built from the
 * stored place id and the SPINE's own name and city only (Executor Rule 30, T-4-11).
 */
import { describe, expect, it } from 'vitest';

import { HOST_CLASSES } from '@/lib/places/host-class';
import type { PlaceFeatures } from '@/lib/places/match';
import {
  HOST_CLASS_ORDER,
  hostClassLabel,
  mapsUrlFor,
  placesChips,
  signalSentence,
} from '@/lib/ui/places-format';

describe('places-format', () => {
  it('signal sentence for every host class', () => {
    expect(signalSentence('none')).toBe('No website listed');
    expect(signalSentence('business_site_dead')).toBe(
      'Website listed — a dead Google site (business.site)',
    );
    expect(signalSentence('social')).toBe('Website listed — a social page, not a website');
    expect(signalSentence('directory')).toBe('Website listed — a directory page, not a website');
    expect(signalSentence('platform_subdomain')).toBe('Website listed — a site-builder subdomain');
    expect(signalSentence('other')).toBe('Website listed — own domain, not checked yet');

    // One map over ALL six classes: a seventh class in host-class.ts with no sentence here
    // would render `undefined` on the business card.
    for (const hc of HOST_CLASSES) {
      expect(signalSentence(hc), `${hc} has no sentence`).toMatch(/^(No website|Website listed)/);
      expect(signalSentence(hc)).not.toContain('_');
    }
  });

  it('host class labels are fixed and ordered', () => {
    // Fixed order, never sorted by count, so the run report's rows stay put run to run.
    expect([...HOST_CLASS_ORDER]).toEqual([
      'other',
      'social',
      'directory',
      'platform_subdomain',
      'business_site_dead',
    ]);
    expect(HOST_CLASS_ORDER.map(hostClassLabel)).toEqual([
      'Own website (not yet checked)',
      'Social page',
      'Directory page',
      'Site-builder subdomain',
      'Dead Google site (business.site)',
    ]);
    // The order plus `none` is every class, once.
    expect([...HOST_CLASS_ORDER, 'none'].sort()).toEqual([...HOST_CLASSES].sort());
    expect(hostClassLabel('none')).toBe('No website listed');
  });

  it('google chips read the numeric features', () => {
    const features = {
      sab: 1,
      city: 1,
      listingPhone: 0,
      listingLocation: 0,
      nameSim: 0.84,
      name: 32,
      phone: 0,
    };
    const labels = placesChips(features).map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'service-area business',
        'city match',
        'no phone on the listing',
        'no location on the listing',
        'name 0.84',
      ]),
    );
    expect(labels).toHaveLength(5);
    // No phone points → no "phone exact"; no listing location → no inherited "no location on
    // one side" beside the listing-specific chip (one fact, one chip).
    expect(labels).not.toContain('phone exact');
    expect(labels).not.toContain('no location on one side');

    const byKey = Object.fromEntries(placesChips(features).map((c) => [c.key, c]));
    expect(byKey.city?.agrees).toBe(true);
    expect(byKey.name?.agrees).toBe(true);
    expect(byKey.no_listing_phone?.agrees).toBe(false);
    expect(byKey.no_listing_location?.agrees).toBe(false);

    // A full located match, shaped exactly like the matcher's output (PlaceFeatures), reads
    // the inherited chips too.
    const located: PlaceFeatures = {
      name: 32,
      phone: 40,
      address: 0,
      distance: 10,
      cluster: 5,
      nameSim: 0.91,
      distanceM: 140,
      signals: ['name', 'phone', 'distance'],
      listingPhone: 1,
      listingLocation: 1,
    };
    expect(placesChips(located).map((c) => c.label)).toEqual([
      'phone exact',
      'name 0.91',
      '140 m apart',
      'same cluster',
    ]);
    // city: 0 is a measured non-match with no chip wording — it renders nothing, not a guess.
    expect(placesChips({ ...located, city: 0 }).map((c) => c.key)).not.toContain('city');

    // Malformed stored jsonb never throws and never renders a bad chip.
    expect(placesChips('features')).toEqual([]);
    expect(placesChips(null)).toEqual([]);
    expect(placesChips(undefined)).toEqual([]);
    expect(placesChips([1, 2])).toEqual([]);
    expect(placesChips({ nameSim: 'x' })).toEqual([]);
    expect(placesChips({ nameSim: Number.NaN, city: '1', sab: true, listingPhone: '0' })).toEqual(
      [],
    );
  });

  it('the maps link is built from the place id and our own names only', () => {
    expect(mapsUrlFor('ChIJabc', 'Ortiz & Sons', 'McAllen')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Ortiz%20%26%20Sons%2C%20McAllen&query_place_id=ChIJabc',
    );
    // T-4-11: every component is encoded — a hostile place id cannot add a parameter or leave
    // the fixed origin.
    const hostile = mapsUrlFor('x&api=2#frag', 'A/B?c=d', 'Edinburg');
    const url = new URL(hostile);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()]).toEqual(['api', 'query', 'query_place_id']);
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('A/B?c=d, Edinburg');
    expect(url.searchParams.get('query_place_id')).toBe('x&api=2#frag');
    // No city on the spine → the name alone, never a dangling comma.
    expect(mapsUrlFor('ChIJabc', 'Ortiz & Sons', null)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Ortiz%20%26%20Sons&query_place_id=ChIJabc',
    );
  });
});
