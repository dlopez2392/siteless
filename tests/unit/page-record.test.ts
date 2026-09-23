/**
 * Phase 4 plan 15. The step→writer contract (src/lib/places/page-record.ts), pinned.
 *
 * `toPageRecord` is the last TypeScript hand a Places page passes through before
 * `app.record_places_page` writes it. Everything it emits reaches the database, so:
 *
 *   * T-4-05 / T-3-11 — a record built from a real (synthetic) Places page serializes with
 *     NONE of the Google text it was built from (`PLACES_SENTINELS`, plus a `SENTINEL` name).
 *   * M36 — a feature key outside the allow-list, or a non-numeric value under a numeric key,
 *     is REFUSED with an error naming the key. A silent drop would leave the table-level CHECK
 *     (`pa_features_numeric`, drizzle/0029) as the only wall, and would make a regression here
 *     invisible to every test.
 *   * The jsonb contract's key set is exact, so the definer never reads a key that is not
 *     there and a new key cannot ride along unnoticed.
 */
import { describe, expect, it } from 'vitest';

import { hostClass } from '@/lib/places/host-class';
import {
  decide,
  scoreLocated,
  scoreSab,
  toPlaceForMatch,
  type BusinessCandidate,
  type MatchDecision,
  type PlacesResultLike,
} from '@/lib/places/match';
import { FEATURE_KEYS, toPageRecord, type PageRecordPlace } from '@/lib/places/page-record';

import matchPage from './msw/fixtures/places-match-page.json';
import { PLACES_SENTINELS } from './msw/places';

const CTX = { clusterKey: 'home_services', queriedCity: 'McAllen' };

/** The spine as candidate businesses (tests/db/_places-fixtures.ts PLACES_SPINE, keyed). */
const SPINE: BusinessCandidate[] = [
  {
    id: 'b-ortiz',
    source: 'overture',
    nameNorm: 'ortiz plumbing',
    phoneE164: '+19566310001',
    phoneBlockable: true,
    streetNum: '1200',
    streetNorm: 'n 10th st',
    unit: null,
    postal: '78501',
    lat: 26.2159,
    lng: -98.2336,
    locationMatchType: 'overture',
    clusterKey: 'home_services',
    chainKey: null,
    city: 'McAllen',
  },
  {
    id: 'b-rio',
    source: 'overture',
    nameNorm: 'rio roofing',
    phoneE164: '+19566310003',
    phoneBlockable: true,
    streetNum: '900',
    streetNorm: 's main st',
    unit: null,
    postal: '78501',
    lat: 26.196,
    lng: -98.23,
    locationMatchType: 'overture',
    clusterKey: 'home_services',
    chainKey: null,
    city: 'McAllen',
  },
];

/** A located listing whose display name is a sentinel no fixture carries. */
const SENTINEL_PLACE: PlacesResultLike & { websiteUri?: string } = {
  id: 'places/ChIJ-sentinel',
  displayName: { text: 'SENTINEL Ortiz Plumbing' },
  formattedAddress: '1200 N 10th St, McAllen, TX 78501, USA',
  location: { latitude: 26.2159, longitude: -98.2336 },
  nationalPhoneNumber: '(956) 631-0001',
  websiteUri: 'https://sentinel-ortiz.example/SENTINEL',
};

type Raw = PlacesResultLike & { websiteUri?: string };

/** Runs one raw Places result through the matcher exactly as the step will. */
function item(raw: Raw) {
  const p = toPlaceForMatch(raw, CTX);
  const scored = SPINE.map((b) =>
    p.pureSab
      ? scoreSab(p, b, b.nameNorm === p.nameNorm ? 1 : 0.2)
      : scoreLocated(p, b, b.nameNorm === p.nameNorm ? 1 : 0.2),
  );
  return {
    decision: decide(p, scored),
    pureSab: p.pureSab,
    hadWebsiteUri: raw.websiteUri !== undefined,
    hostClass: hostClass(raw.websiteUri),
    lat: p.lat,
    lng: p.lng,
  };
}

function oneMatch(features: Record<string, unknown>): MatchDecision {
  return {
    placeId: 'places/ChIJ-x',
    outcome: 'attached',
    matches: [
      {
        businessId: 'b-ortiz',
        score: 97,
        status: 'attached',
        reason: 'score',
        tieBusinessId: null,
        features: features as MatchDecision['matches'][number]['features'],
      },
    ],
  };
}

function withFeatures(features: Record<string, unknown>) {
  return toPageRecord({
    page: 1,
    sku: 'ts_enterprise',
    resultsSoFar: 1,
    items: [
      {
        decision: oneMatch(features),
        pureSab: false,
        hadWebsiteUri: false,
        hostClass: 'none',
        lat: 26.2,
        lng: -98.2,
      },
    ],
  });
}

const GOOD_FEATURES = {
  name: 30,
  phone: 40,
  address: 25,
  distance: 0,
  cluster: 5,
  nameSim: 1,
  distanceM: 12,
  signals: ['name', 'phone', 'address'],
};

describe('page record', () => {
  it('page record carries no Places text', () => {
    const raws = [...(matchPage.places as Raw[]), SENTINEL_PLACE];
    const record = toPageRecord({
      page: 1,
      sku: 'ts_enterprise',
      resultsSoFar: raws.length,
      items: raws.map(item),
    });
    // The control: the record is not trivially empty — the sentinel listing matched, with
    // its features and coordinates carried.
    const sentinel = record.places.find((pl) => pl.placeId === 'places/ChIJ-sentinel');
    expect(sentinel?.matches).toHaveLength(1);
    expect(Object.keys(sentinel?.matches[0]?.features ?? {}).length).toBeGreaterThan(0);
    expect(sentinel?.hadWebsiteUri).toBe(true);
    expect(sentinel?.hostClass).toBe('other');
    expect(sentinel?.lat).toBe(26.2159);

    const json = JSON.stringify(record);
    expect(PLACES_SENTINELS.length).toBeGreaterThan(0);
    for (const s of [...PLACES_SENTINELS, 'SENTINEL', 'sentinel-ortiz.example']) {
      expect(json, `record leaks "${s}"`).not.toContain(s);
    }
  });

  it('page record drops feature keys outside the allow-list', () => {
    expect(() => withFeatures({ ...GOOD_FEATURES, displayName: 'x' })).toThrow(
      new Error('toPageRecord: feature displayName is not allow-listed'),
    );
    // Positive control: the same record without the extra key is accepted as-is.
    expect(withFeatures(GOOD_FEATURES).places[0]?.matches[0]?.features).toEqual(GOOD_FEATURES);
  });

  it('page record refuses a non-numeric feature value', () => {
    expect(() => withFeatures({ ...GOOD_FEATURES, name: 'Ortiz' })).toThrow(/feature name\b/);
    expect(() => withFeatures({ ...GOOD_FEATURES, nameSim: Number.NaN })).toThrow(
      /feature nameSim\b/,
    );
    expect(() => withFeatures({ ...GOOD_FEATURES, distanceM: '12' })).toThrow(
      /feature distanceM\b/,
    );
    expect(() => withFeatures({ ...GOOD_FEATURES, signals: ['name', 'Ortiz'] })).toThrow(
      /feature signals\b/,
    );
    expect(() => withFeatures({ ...GOOD_FEATURES, rule: 'Ortiz Plumbing' })).toThrow(
      /feature rule\b/,
    );
    expect(() => withFeatures({ ...GOOD_FEATURES, city: 2 })).toThrow(/feature city\b/);
    // distanceM may be null (no location on one side); a valid rule and 0|1 flags pass.
    expect(() =>
      withFeatures({
        ...GOOD_FEATURES,
        distanceM: null,
        rule: 'sab_phone_city',
        city: 1,
        sab: 1,
        listingPhone: 0,
        listingLocation: 0,
      }),
    ).not.toThrow();
  });

  it('page record keeps the contract keys', () => {
    const record = toPageRecord({
      page: 2,
      sku: 'ts_enterprise',
      resultsSoFar: 7,
      items: [item(SENTINEL_PLACE), item(matchPage.places[5] as Raw)],
    });
    expect(Object.keys(record).sort()).toEqual(['page', 'places', 'resultsSoFar', 'sku']);
    const expected: Array<keyof PageRecordPlace> = [
      'placeId',
      'outOfArea',
      'pureSab',
      'hadWebsiteUri',
      'hostClass',
      'lat',
      'lng',
      'matches',
    ];
    for (const pl of record.places) {
      expect(Object.keys(pl).sort()).toEqual([...expected].sort());
      for (const m of pl.matches) {
        expect(Object.keys(m).sort()).toEqual(
          ['businessId', 'features', 'reason', 'score', 'status', 'tieBusinessId'].sort(),
        );
        for (const k of Object.keys(m.features)) {
          expect(FEATURE_KEYS as readonly string[]).toContain(k);
        }
      }
    }
    // lat/lng travel together or not at all.
    expect(
      toPageRecord({
        page: 1,
        sku: 'ts_essentials',
        resultsSoFar: 1,
        items: [{ ...item(SENTINEL_PLACE), lat: 26.2, lng: null }],
      }).places[0],
    ).toMatchObject({ lat: null, lng: null });
  });
});
