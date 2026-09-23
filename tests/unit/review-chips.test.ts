import { describe, expect, it } from 'vitest';
import { displayPhone, formatCount, formatDistance, reviewChips } from '@/lib/ui/review-format';

/**
 * `/review`'s chip band — the component vector, never a bare score (03-UI-SPEC § 1).
 *
 * The features are shaped exactly as `src/lib/resolve/score.ts` writes them into
 * `merge_candidates.features`: integer points per component, `nameSim`, `distanceM` (null when a
 * side has no location), `signals`. Each test names one fact the band must state or refuse.
 */

const NONE = { phoneE164: null, postal: null };

describe('review chips', () => {
  it('renders the spec example as the component vector, in order', () => {
    const chips = reviewChips(
      { name: 31, phone: 30, address: 5, distance: 10, cluster: -10, nameSim: 0.81, distanceM: 140 },
      { phoneE164: '+19566821234', postal: '78501' },
      { phoneE164: '+19566821234', postal: '78501' },
    );
    expect(chips.map((c) => c.label)).toEqual([
      'phone exact',
      'name 0.81',
      '140 m apart',
      'same ZIP',
      'different cluster',
    ]);
    expect(chips.map((c) => c.agrees)).toEqual([true, true, true, true, false]);
  });

  it('says what is absent rather than dropping it', () => {
    const chips = reviewChips({ name: 0, phone: 0, nameSim: 0.3, distanceM: null, cluster: 0 }, NONE, NONE);
    expect(chips.map((c) => c.label)).toEqual([
      'no phone on either side',
      'name 0.30',
      'no location on one side',
    ]);
    // Disagreement and absence are outline chips — the words carry it, the variant repeats it.
    expect(chips.every((c) => !c.agrees)).toBe(true);
  });

  it('a far distance scores nothing and reads as disagreement', () => {
    const [chip] = reviewChips({ distance: 0, distanceM: 3140 }, NONE, NONE).filter(
      (c) => c.key === 'distance',
    );
    expect(chip).toEqual({ key: 'distance', label: '3.1 km apart', agrees: false });
  });

  it('two different phones and two different ZIPs have no chip wording, so no chip', () => {
    const chips = reviewChips(
      { phone: 0, cluster: 5 },
      { phoneE164: '+19566821234', postal: '78501' },
      { phoneE164: '+19566829999', postal: '78504' },
    );
    expect(chips.map((c) => c.label)).toEqual(['same cluster']);
  });

  it('a malformed vector drops chips, it never throws', () => {
    expect(reviewChips({ phone: '30', nameSim: 'x', cluster: Number.NaN }, NONE, NONE)).toEqual([
      { key: 'phone', label: 'no phone on either side', agrees: false },
    ]);
  });

  it('never carries a key the vector did not supply', () => {
    // T-3-11: nothing in the band could render a normalized name — the chips are labels built
    // from copy.ts and numbers, and an extra field on the vector renders nowhere.
    const chips = reviewChips({ nameNorm: 'riverside stone', nameSim: 0.9, name: 38 }, NONE, NONE);
    expect(JSON.stringify(chips)).not.toContain('riverside');
  });
});

describe('review formatters', () => {
  it('distance: metres under a kilometre, one decimal of km from one up', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(140.4)).toBe('140 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(999.6)).toBe('1.0 km');
    expect(formatDistance(24_950)).toBe('25.0 km');
  });

  it('phone: national format from E.164, unparseable shown as stored', () => {
    expect(displayPhone('+19566821234')).toBe('(956) 682-1234');
    expect(displayPhone('not a phone')).toBe('not a phone');
  });

  it('count: grouped in the pinned locale', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(1)).toBe('1');
  });
});
