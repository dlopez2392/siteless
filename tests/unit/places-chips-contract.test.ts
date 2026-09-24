/**
 * The producer→consumer contract between the Places matcher (04-06, `src/lib/places/match.ts`)
 * and the review card's chip band (04-07, `placesChips` in `src/lib/ui/places-format.ts`).
 *
 * The two were written by separate plans against a shared `PlaceFeatures` type. A typed shape
 * does not prove the NAMES line up at runtime, because `placesChips` reads stored jsonb as
 * `unknown`: rename `listingLocation` in the matcher and the chip silently disappears, with
 * tsc, lint and both plans' own tests green. This test feeds the matcher's REAL output into the
 * formatter, so a renamed or re-typed key goes red here.
 *
 * The listing is a SENTINEL service-area listing (D-07: no storefront, so no location) scored
 * against the "Valley Locksmith" spine record in the city the run queried.
 */
import { describe, expect, it } from 'vitest';

import {
  decide,
  scoreSab,
  toPlaceForMatch,
  type BusinessCandidate,
  type MatchDecision,
  type PlacesResultLike,
} from '@/lib/places/match';
import { toPageRecord } from '@/lib/places/page-record';
import { placesChips } from '@/lib/ui/places-format';

const SENTINEL_SAB: PlacesResultLike = {
  id: 'places/ChIJ-sentinel-sab',
  displayName: { text: 'SENTINEL Valley Locksmith' },
  // A service area's address has no street; its pin is not a storefront (toPlaceForMatch).
  formattedAddress: 'McAllen, TX 78501, USA',
  location: { latitude: 26.2, longitude: -98.23 },
  // A parseable number (a 555-01xx fiction parses to no E.164, which would read "no phone").
  nationalPhoneNumber: '(956) 631-0042',
  pureServiceAreaBusiness: true,
};

const VALLEY_LOCKSMITH: BusinessCandidate = {
  id: 'b-valley-locksmith',
  source: 'tx_comptroller',
  nameNorm: 'valley locksmith',
  // A different number from the listing's, so no phone+city lift: the band is the fallback.
  phoneE164: '+19566821234',
  phoneBlockable: true,
  streetNum: '2100',
  streetNorm: 'n 23rd st',
  unit: null,
  postal: '78501',
  lat: 26.22,
  lng: -98.24,
  locationMatchType: 'overture',
  clusterKey: 'home_services',
  chainKey: null,
  city: 'McAllen',
};

describe('places chips contract', () => {
  it("the matcher's features render as chips", () => {
    const place = toPlaceForMatch(SENTINEL_SAB, {
      clusterKey: 'home_services',
      queriedCity: 'McAllen',
    });
    const result = scoreSab(place, VALLEY_LOCKSMITH, 0.93);

    const chips = placesChips(result.features);
    const labels = chips.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining(['service-area business', 'city match', 'no location on the listing']),
    );
    // The resolver's own vector reaches the band through the same keys (0.93 ≥ 0.85: the name
    // signal — named as a band, since the similarity itself is never persisted).
    expect(labels).toContain('name match');
    expect(labels).toContain('same cluster');
    // The listing HAS a phone: the absence chip must not fire on a present value.
    expect(labels).not.toContain('no phone on the listing');
    // Nothing Google-authored is in the features, so nothing Google-authored can be a chip.
    expect(JSON.stringify(chips)).not.toContain('SENTINEL');

    // The same features, carried through the writer's record (toPageRecord, which drops
    // nameSim / distanceM), give the same chips. This fallback band scores below the review
    // floor, so `decide` would carry no match; the record is built as if it were tentative —
    // the features are what is under test, not the band.
    expect(decide(place, [result]).matches).toEqual([]);
    const decision: MatchDecision = {
      placeId: place.placeId,
      outcome: 'tentative',
      matches: [
        {
          businessId: VALLEY_LOCKSMITH.id,
          score: result.score,
          status: 'tentative',
          reason: 'score',
          tieBusinessId: null,
          features: result.features,
        },
      ],
    };
    const record = toPageRecord({
      page: 1,
      sku: 'ts_enterprise',
      resultsSoFar: 1,
      items: [
        { decision, pureSab: true, hadWebsiteUri: false, hostClass: 'none', lat: null, lng: null },
      ],
    });
    const persisted = record.places[0]?.matches[0]?.features;
    expect(persisted).toBeDefined();
    expect(persisted).not.toHaveProperty('nameSim');
    // Round-trip through JSON: the stored jsonb is what the queue reads back.
    expect(placesChips(JSON.parse(JSON.stringify(persisted)))).toEqual(chips);
  });
});
