/**
 * D-05 / D-07 / D-08: the in-memory Places matcher (src/lib/places/match.ts), pinned.
 *
 * Every score is exact (`toBe(n)`), for the same reason score.test.ts gives: a range absorbs a
 * re-tune in silence. The arithmetic behind each number is spelled in a comment beside it, so a
 * red test says which weight moved.
 *
 *   M41 tie resolved to the higher score  -> `a place tying two businesses at 95 goes to review`
 *   M42 SAB branch lifts without a phone  -> `service-area listing without an exact phone caps at 94`
 *
 * 🔴 T-3-11 / T-4-05: the decision's `features` is persisted (04-15) and may hold numbers only.
 * `places features carry numbers only` serializes a whole decision and scans it for the Google
 * text it was built from.
 */
import { describe, expect, it } from 'vitest';

import {
  decide,
  placeSide,
  scoreLocated,
  scoreSab,
  toPlaceForMatch,
  type BusinessCandidate,
  type PlaceForMatch,
  type PlacesResultLike,
  type ScoredCandidate,
} from '@/lib/places/match';
import { AUTO_MERGE_SCORE, REVIEW_CEILING, REVIEW_SCORE } from '@/lib/resolve/score';

const CLUSTER = 'home_services';
const CITY_CTX = { clusterKey: CLUSTER, queriedCity: 'McAllen' };

/** A storefront listing: named, addressed, phoned and pinned. */
const LOCATED: PlacesResultLike = {
  id: 'places/ChIJ-located',
  displayName: { text: 'SENTINEL Ortiz Plumbing' },
  formattedAddress: '1200 N 10th St, McAllen, TX 78501, USA',
  location: { latitude: 26.2034, longitude: -98.23 },
  nationalPhoneNumber: '(956) 631-0001',
};

/** A pure service-area listing: no street, a pin Google made up for the area. */
const SAB: PlacesResultLike = {
  id: 'places/ChIJ-sab',
  displayName: { text: 'Ortiz Mobile Plumbing' },
  formattedAddress: 'McAllen, TX 78501, USA',
  nationalPhoneNumber: '(956) 631-0002',
  pureServiceAreaBusiness: true,
};

/** A business that agrees with LOCATED on every key: phone, full address, ~24 m, cluster. */
function business(over: Partial<BusinessCandidate> = {}): BusinessCandidate {
  return {
    id: 'b-1',
    source: 'overture',
    nameNorm: 'ortiz plumbing',
    phoneE164: '+19566310001',
    phoneBlockable: true,
    streetNum: '1200',
    streetNorm: 'n 10th st',
    unit: null,
    postal: '78501',
    lat: 26.2036,
    lng: -98.2301,
    locationMatchType: 'overture',
    clusterKey: CLUSTER,
    chainKey: null,
    city: 'McAllen',
    ...over,
  };
}

const located = (): PlaceForMatch => toPlaceForMatch(LOCATED, CITY_CTX);
const sab = (): PlaceForMatch => toPlaceForMatch(SAB, CITY_CTX);

describe('places match', () => {
  it('places match: a strong located match attaches', () => {
    const p = located();
    // The listing reduced to keys, and the keys agree with the spine's normalizers.
    expect(p.placeId).toBe('places/ChIJ-located');
    expect(p.phone).toEqual({ e164: '+19566310001', blockable: true });
    expect(p.address.streetNum).toBe('1200');
    expect(p.address.postal).toBe('78501');
    expect(p.lat).toBe(26.2034);
    expect(p.pureSab).toBe(false);
    expect(p.outOfArea).toBe(false);
    expect(p.queriedCity).toBe('mcallen');

    const b = business({ streetNorm: p.address.streetNorm });
    const s = scoreLocated(p, b, 0.9);
    // name round(45 × 0.8333) 38 + phone 30 + address 30 + distance 15 + cluster 5 = 118 → 100.
    expect(s.score).toBe(100);
    expect(s.businessId).toBe('b-1');
    expect(s.features.listingPhone).toBe(1);
    expect(s.features.listingLocation).toBe(1);

    const d = decide(p, [s]);
    expect(d.outcome).toBe('attached');
    expect(d.matches).toEqual([
      {
        businessId: 'b-1',
        score: 100,
        status: 'attached',
        reason: 'score',
        tieBusinessId: null,
        features: s.features,
      },
    ]);
  });

  it('places match: 80 to 94 is tentative', () => {
    const p = located();
    // No phone on the business: name round(45 × 0.75) 34 + address 30 + distance 15 + cluster 5 = 84.
    const b = business({
      phoneE164: null,
      phoneBlockable: false,
      streetNorm: p.address.streetNorm,
    });
    const s = scoreLocated(p, b, 0.85);
    expect(s.score).toBe(84);
    expect(s.score).toBeGreaterThanOrEqual(REVIEW_SCORE);

    const d = decide(p, [s]);
    expect(d.outcome).toBe('tentative');
    expect(d.matches).toEqual([
      {
        businessId: 'b-1',
        score: 84,
        status: 'tentative',
        reason: 'score',
        tieBusinessId: null,
        features: s.features,
      },
    ]);
  });

  it('places match: under 80 is unmatched', () => {
    const p = located();
    // name round(45 × 0.25) 11 + postal only 5 + distance ≤ 2 km (~1 km) 4 + cluster 5 = 25.
    const b = business({
      phoneE164: null,
      phoneBlockable: false,
      streetNum: '400',
      streetNorm: 'w nolana ave',
      lat: 26.2124,
      lng: -98.23,
    });
    const s = scoreLocated(p, b, 0.55);
    expect(s.score).toBe(25);

    const d = decide(p, [s]);
    expect(d).toEqual({ placeId: 'places/ChIJ-located', outcome: 'unmatched', matches: [] });
  });

  it('places match: the best of several candidates wins, ties broken by business id', () => {
    const p = located();
    const scored: ScoredCandidate[] = [
      { businessId: 'b-z', score: 82, features: scoreLocated(p, business(), 0.9).features },
      { businessId: 'b-a', score: 88, features: scoreLocated(p, business(), 0.9).features },
      { businessId: 'b-m', score: 88, features: scoreLocated(p, business(), 0.9).features },
    ];
    const d = decide(p, scored);
    expect(d.outcome).toBe('tentative');
    expect(d.matches.map((m) => [m.businessId, m.score])).toEqual([['b-a', 88]]);
  });
});

describe('places match collisions (D-08)', () => {
  it('a place tying two businesses at 95 goes to review', () => {
    const p = located();
    const b1 = business({ id: 'b-1', streetNorm: p.address.streetNorm });
    const b2 = business({ id: 'b-2', streetNorm: p.address.streetNorm });
    // A third, weaker candidate proves the tie is between the top two only.
    const b3 = business({
      id: 'b-0',
      phoneE164: null,
      phoneBlockable: false,
      streetNorm: p.address.streetNorm,
    });
    const tieA = scoreLocated(p, b1, 0.9);
    const tieB = scoreLocated(p, b2, 0.8);
    const weaker = scoreLocated(p, b3, 0.85);
    // b-1 100; b-2 name 30 + 30 + 30 + 15 + 5 = 110 → 100; b-0 84.
    expect([tieA.score, tieB.score, weaker.score]).toEqual([100, 100, 84]);
    expect(tieA.score).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
    expect(tieB.score).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);

    const d = decide(p, [weaker, tieB, tieA]);
    expect(d.outcome).toBe('tentative');
    expect(d.matches).toEqual([
      {
        businessId: 'b-1',
        score: 100,
        status: 'tentative',
        reason: 'tie',
        tieBusinessId: 'b-2',
        features: tieA.features,
      },
      {
        businessId: 'b-2',
        score: 100,
        status: 'tentative',
        reason: 'tie',
        tieBusinessId: 'b-1',
        features: tieB.features,
      },
    ]);
    // Neither side of a tie is ever attached — not even the one that sorts first.
    expect(d.matches.some((m) => m.status === 'attached')).toBe(false);

    // A tie at unequal scores above 95 is still a tie: the higher score does not win it.
    const higher: ScoredCandidate = { ...tieA, score: 100 };
    const lower: ScoredCandidate = { ...tieB, score: AUTO_MERGE_SCORE };
    const d2 = decide(p, [lower, higher]);
    expect(d2.outcome).toBe('tentative');
    expect(d2.matches.map((m) => [m.businessId, m.status, m.reason, m.tieBusinessId])).toEqual([
      ['b-1', 'tentative', 'tie', 'b-2'],
      ['b-2', 'tentative', 'tie', 'b-1'],
    ]);
  });
});

describe('places match: service-area listings (D-07)', () => {
  it('service-area listing with an exact phone, the queried city and name 0.6 scores 95', () => {
    const p = sab();
    expect(p.pureSab).toBe(true);
    expect(p.lat).toBeNull();
    const b = business({ phoneE164: '+19566310002', city: 'MCALLEN' });

    const s = scoreSab(p, b, 0.6);
    expect(s.score).toBe(AUTO_MERGE_SCORE);
    expect(s.features.rule).toBe('sab_phone_city');
    expect(s.features.sab).toBe(1);
    expect(s.features.city).toBe(1);
    expect(s.features.listingPhone).toBe(1);
    expect(s.features.listingLocation).toBe(0);
    expect(decide(p, [s]).outcome).toBe('attached');

    // Just under the name bar: no lift. The fallback is the located scorer with no location:
    // name 14 + phone 30 + postal 5 + cluster 5 = 54, and at 0.59 R4 (phone + same ZIP + a
    // dissimilar name) lifts it to the review floor, 80 — review, never attach.
    const under = scoreSab(p, b, 0.59);
    expect(under.score).toBe(REVIEW_SCORE);
    expect(under.features.rule).toBe('phone_locality_review');
    expect(decide(p, [under]).outcome).toBe('tentative');

    // Exact phone, name 0.95 — but another city: the lift needs the city, so R6 holds it at 94.
    const elsewhere = scoreSab(p, business({ phoneE164: '+19566310002', city: 'Edinburg' }), 0.95);
    expect(elsewhere.score).toBe(REVIEW_CEILING);
    expect(elsewhere.features.rule).not.toBe('sab_phone_city');
    expect(elsewhere.features.city).toBe(0);
  });

  it('service-area listing without an exact phone caps at 94', () => {
    const p = sab();
    // Queried city and a near-identical name, but the business's phone is a different number:
    // name round(45 × 0.9167) 41 + postal 5 + cluster 5 = 51. No lift.
    const other = scoreSab(p, business({ phoneE164: '+19566319999', city: 'McAllen' }), 0.95);
    expect(other.score).toBe(51);
    expect(other.score).toBeLessThanOrEqual(REVIEW_CEILING);
    expect(other.features.rule).toBeUndefined();
    expect(other.features.city).toBe(1);

    // The listing carries no phone at all.
    const bare = toPlaceForMatch({ ...SAB, nationalPhoneNumber: undefined }, CITY_CTX);
    const none = scoreSab(bare, business({ phoneE164: '+19566310002', city: 'McAllen' }), 0.95);
    expect(none.score).toBe(51);
    expect(none.features.listingPhone).toBe(0);

    // The same number on both sides, but toll-free: never a key, so never a lift.
    const tf = toPlaceForMatch({ ...SAB, nationalPhoneNumber: '(800) 631-0002' }, CITY_CTX);
    expect(tf.phone).toEqual({ e164: '+18006310002', blockable: false });
    const shared = scoreSab(
      tf,
      business({ phoneE164: '+18006310002', phoneBlockable: false }),
      0.95,
    );
    expect(shared.score).toBe(51);

    for (const s of [other, none, shared]) {
      expect(decide(p, [s]).outcome).toBe('unmatched');
    }
  });

  it('a service-area listing with a location still takes the service-area branch', () => {
    const p = toPlaceForMatch(
      { ...SAB, location: { latitude: 26.2034, longitude: -98.23 } },
      CITY_CTX,
    );
    // A service area's pin is not a storefront: the location is dropped, the SAB flag kept.
    expect(p.pureSab).toBe(true);
    expect(p.lat).toBeNull();
    expect(p.lng).toBeNull();
    expect(placeSide(p).locationMatchType).toBeNull();

    // So a business standing on that very pin earns no distance and no geo gate from it.
    const b = business({ phoneE164: '+19566310002', lat: 26.2034, lng: -98.23 });
    const s = scoreSab(p, b, 0.6);
    expect(s.score).toBe(AUTO_MERGE_SCORE);
    expect(s.features.sab).toBe(1);
    expect(s.features.distance).toBe(0);
    expect(s.features.distanceM).toBeNull();
    expect(s.features.listingLocation).toBe(0);
  });

  it('a county or radius unit has no queried city, so no service-area listing can reach 95', () => {
    const p = toPlaceForMatch(SAB, { clusterKey: CLUSTER, queriedCity: null });
    expect(p.queriedCity).toBeNull();
    const s = scoreSab(p, business({ phoneE164: '+19566310002' }), 0.95);
    expect(s.score).toBe(REVIEW_CEILING);
    expect(s.features.city).toBe(0);
  });
});

describe('places match: area and chains', () => {
  it('a non-US listing is outside the area', () => {
    const p = toPlaceForMatch(
      { ...LOCATED, formattedAddress: 'Calle Hidalgo 1200, Centro, 88500 Reynosa, Tamps., Mexico' },
      CITY_CTX,
    );
    expect(p.outOfArea).toBe(true);
    // Even a candidate that would attach is not an outcome for a listing outside the area.
    const s: ScoredCandidate = {
      businessId: 'b-1',
      score: 100,
      features: scoreLocated(p, business(), 0.9).features,
    };
    expect(decide(p, [s])).toEqual({
      placeId: 'places/ChIJ-located',
      outcome: 'outside',
      matches: [],
    });

    // A listing with no address at all is not "outside": absence is not evidence.
    expect(toPlaceForMatch({ ...LOCATED, formattedAddress: undefined }, CITY_CTX).outOfArea).toBe(
      false,
    );
  });

  // B-CR-01. request.ts sends `regionCode: 'US'`, and Google then OMITS the country from a
  // US `formattedAddress` ("If the country name … matches the regionCode, the country code is
  // omitted"). The realistic shape of every result a sweep sees is therefore "…, TX 78501".
  it('a US listing without the country suffix is in the area and attaches', () => {
    const p = toPlaceForMatch(
      { ...LOCATED, formattedAddress: '1200 N 10th St, McAllen, TX 78501' },
      CITY_CTX,
    );
    expect(p.outOfArea).toBe(false);
    expect(p.address.postal).toBe('78501');
    const s = scoreLocated(p, business({ streetNorm: p.address.streetNorm }), 0.9);
    expect(decide(p, [s]).outcome).toBe('attached');
  });

  it('a service-area partial address without the country is in the area', () => {
    for (const formattedAddress of ['McAllen, TX', 'McAllen, TX 78501', 'TX 78501']) {
      const p = toPlaceForMatch({ ...SAB, formattedAddress }, CITY_CTX);
      expect(p.outOfArea, formattedAddress).toBe(false);
    }
    // The long form Google uses when the region does NOT match stays domestic too.
    for (const tail of ['USA', 'United States']) {
      const formattedAddress = `1200 N 10th St, McAllen, TX 78501, ${tail}`;
      expect(toPlaceForMatch({ ...LOCATED, formattedAddress }, CITY_CTX).outOfArea, tail).toBe(
        false,
      );
    }
  });

  it('a Mexican listing is outside the area in either spelling', () => {
    for (const country of ['Mexico', 'México', 'MEXICO']) {
      const p = toPlaceForMatch(
        { ...LOCATED, formattedAddress: `Calle Hidalgo 1200, 88500 Reynosa, Tamps., ${country}` },
        CITY_CTX,
      );
      expect(p.outOfArea, country).toBe(true);
    }
  });

  it('chain keys are ignored for Places pairs', () => {
    const p = located();
    expect(placeSide(p).chainKey).toBeNull();
    expect(placeSide(p).source).toBe('google_places');
    // A chain-flagged business that agrees on every key: R2 would cap it at 94 if it saw the key.
    const b = business({ chainKey: 'autozone', streetNorm: p.address.streetNorm });
    const s = scoreLocated(p, b, 0.9);
    expect(s.score).toBe(100);
    expect(decide(p, [s]).outcome).toBe('attached');
  });
});

describe('places match: what may be persisted (T-4-05)', () => {
  it('places features carry numbers only', () => {
    const p = located();
    // The PlaceForMatch holds keys, never the display text.
    expect(JSON.stringify(p)).not.toContain('SENTINEL');

    const b1 = business({ streetNorm: p.address.streetNorm });
    const b2 = business({ id: 'b-2', streetNorm: p.address.streetNorm });
    const b3 = business({
      id: 'b-3',
      phoneE164: null,
      phoneBlockable: false,
      streetNorm: p.address.streetNorm,
    });
    const decisions = [
      decide(p, [scoreLocated(p, b1, 0.9)]),
      decide(p, [scoreLocated(p, b1, 0.9), scoreLocated(p, b2, 0.9)]),
      decide(p, [scoreLocated(p, b3, 0.85)]),
      decide(sab(), [scoreSab(sab(), business({ phoneE164: '+19566310002' }), 0.6)]),
    ];
    expect(decisions.map((d) => d.outcome)).toEqual([
      'attached',
      'tentative',
      'tentative',
      'attached',
    ]);

    for (const d of decisions) {
      const json = JSON.stringify(d);
      for (const forbidden of [
        'SENTINEL',
        'sentinel',
        '10th',
        '631-0001',
        '6310001',
        'McAllen',
        'mcallen',
        'ortiz',
      ]) {
        expect(json).not.toContain(forbidden);
      }
      // Every feature value is a number, null, or one of the scorer's enum strings.
      for (const m of d.matches) {
        for (const [k, v] of Object.entries(m.features)) {
          if (k === 'signals') {
            expect(Array.isArray(v)).toBe(true);
            for (const sig of v as unknown[])
              expect(['name', 'phone', 'address', 'distance']).toContain(sig);
          } else if (k === 'rule') {
            expect([
              'phone_locality_name',
              'phone_locality_review',
              'over_25km',
              'sab_phone_city',
            ]).toContain(v);
          } else {
            expect(v === null || typeof v === 'number').toBe(true);
          }
        }
      }
    }
  });
});
