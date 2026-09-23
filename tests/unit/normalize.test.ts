/**
 * DEDUP-04 / D-12. The normalizer is the ONLY implementation of name_norm, phone_e164,
 * street_num, street_norm and postal — SQL never normalizes (see
 * tests/unit/sql-never-normalizes.test.ts for the gate). So every behaviour the blocker and
 * the scorer rely on is pinned here, by name.
 *
 * Mutations, one named test each:
 *   - Replace the token filter with a regex strip-in-place
 *       → 'nameNorm defect 1: no leading or trailing space' and
 *         'nameNorm defect 2: adjacent stopwords are both removed'.
 *   - Drop the trailing phone-run strip
 *       → 'nameNorm defect 3: a trailing phone run is stripped and flagged'.
 *   - Strip ALL digits instead
 *       → 'nameNorm defect 3: digits inside a name are kept'.
 *   - Remove the LIGATURES fold
 *       → 'nameNorm folds ligatures and strokes the way unaccent does'.
 *   - M16: empty TOLL_FREE_NPAS
 *       → 'phoneE164 toll-free parses but is not blockable' AND
 *         'toll-free is not an identifier' — two independent tests, no shared assertion.
 *   - Keep the suite in street_norm → 'suite stripped not lost'.
 */
import { describe, expect, it } from 'vitest';
import {
  addressKey,
  nameNorm,
  nameNormDetail,
  phoneE164,
  TOLL_FREE_NPAS,
  USPS_ABBREVIATIONS,
} from '@/lib/normalize';

describe('nameNorm', () => {
  /**
   * [raw, expected]. A committed table: every row is a real shape from the RGV probe or a
   * named D-12 rule, and every expected value was checked by hand, not generated.
   */
  const TABLE: Array<[string, string | null]> = [
    // Legal suffixes, with and without punctuation.
    ['ZORBA, INC.', 'zorba'],
    ['Rio Roofing L.L.C.', 'rio roofing'],
    ['Valley Tire Co', 'valley tire'],
    ['Acme Corporation', 'acme'],
    ['Sun Plumbing, LLC DBA Sun Pros', 'sun plumbing sun pros'],
    // Accents (Spanish — unaccent and NFD agree here).
    ['Ñandú Café', 'nandu cafe'],
    ['Panadería Méndez', 'mendez'],
    ['Carnicería El Güero', 'guero'],
    // Ligatures and strokes (unaccent and NFD DISAGREE here; the table follows unaccent).
    ['Ølsen Straße', 'olsen strasse'],
    ['Æsop Œuvre', 'aesop oeuvre'],
    ['Łódź Đinh', 'lodz dinh'],
    ['İstanbul Kebab', 'istanbul kebab'],
    // Bilingual stopwords and trade words.
    ['La Taqueria De Guanajuato', 'guanajuato'],
    ['The House of Pies', 'house pies'],
    ['Los Arcos y Las Palmas', 'arcos palmas'],
    // Digits.
    ['Taqueria Las 3 Torres', '3 torres'],
    ['3 Amigos', '3 amigos'],
    ["Loro's Taqueria & Salads 956-263-1462", 'loro s salads'],
    // Everything filtered.
    ['LLC', null],
    ['  ', null],
    ['', null],
  ];

  it.each(TABLE)('nameNorm table: %j → %j', (raw, expected) => {
    expect(nameNorm(raw)).toBe(expected);
  });

  it('nameNorm returns null for null and undefined', () => {
    expect(nameNorm(null)).toBeNull();
    expect(nameNorm(undefined)).toBeNull();
  });

  it('nameNorm defect 1: no leading or trailing space', () => {
    // The SQL prototype produced " taqueria guanajuato" here — a leading space shifts every
    // leading trigram and silently lowers similarity.
    const out = nameNorm('La Taqueria De Guanajuato');
    expect(out).toBe('guanajuato');
    expect(out).not.toMatch(/^\s|\s$/);
    expect(nameNorm('  The  Donut   Hole  ')).toBe('donut hole');
  });

  it('nameNorm defect 2: adjacent stopwords are both removed', () => {
    // A `(^| )(de|la)( |$)` regex consumes the shared space and loses only one of the two.
    expect(nameNorm('Tacos de la Esquina')).toBe('tacos esquina');
    expect(nameNorm('Casa de los del Valle')).toBe('casa valle');
  });

  it('nameNorm defect 3: digits inside a name are kept', () => {
    expect(nameNorm('Taqueria Las 3 Torres')).toBe('3 torres');
    expect(nameNorm('3 Amigos')).toBe('3 amigos');
    expect(nameNorm('Route 66 Diner')).toBe('route 66 diner');
  });

  it('nameNorm defect 3: a trailing phone run is stripped and flagged', () => {
    expect(nameNormDetail("Loro's Taqueria & Salads 956-263-1462")).toEqual({
      norm: 'loro s salads',
      hadStoreNumber: true,
    });
    // One unbroken 10-digit token, and the 11-digit NANP form with the trunk prefix.
    expect(nameNormDetail('Loros 9562631462')).toEqual({ norm: 'loros', hadStoreNumber: true });
    expect(nameNormDetail('Loros 1-956-263-1462')).toEqual({ norm: 'loros', hadStoreNumber: true });
    // A store number ahead of the phone survives; only the phone run goes.
    expect(nameNormDetail('Ollies 475 9562631462')).toEqual({
      norm: 'ollies 475',
      hadStoreNumber: true,
    });
  });

  it('nameNorm keeps a short store number but flags it for the scorer', () => {
    // "SMARTSTYLE 8" vs "Smartstyle": the digit is not thrown away (it might be the name),
    // but the flag lets the scorer forgive it.
    expect(nameNormDetail('SMARTSTYLE 8')).toEqual({ norm: 'smartstyle 8', hadStoreNumber: true });
    expect(nameNormDetail('Smartstyle')).toEqual({ norm: 'smartstyle', hadStoreNumber: false });
    expect(nameNormDetail('Taqueria Las 3 Torres')).toEqual({
      norm: '3 torres',
      hadStoreNumber: false,
    });
  });

  it('nameNorm does not strip a 12-digit trailing run as a phone', () => {
    // Not a NANP length: kept, and flagged as a trailing number.
    expect(nameNormDetail('Shop 123456789012')).toEqual({
      norm: 'shop 123456789012',
      hadStoreNumber: true,
    });
  });

  it('nameNorm B-CR-01: initials are identity, not legal suffixes', () => {
    // `l`, `c` and `co` used to be stripped at EVERY position, so an initial-led trade name
    // collapsed onto the bare trade: "C & L Plumbing" and "Plumbing" shared a key, which fed
    // both a false auto-merge and a false chain badge.
    expect(nameNorm('C & L Plumbing')).toBe('c l plumbing');
    expect(nameNorm('C & L Plumbing')).not.toBe(nameNorm('Plumbing'));
    expect(nameNorm('C&C Auto Repair')).toBe('c c auto repair');
    expect(nameNorm('C&C Auto Repair')).not.toBe(nameNorm('Auto Repair'));
    expect(nameNorm('L & C Tire Shop')).toBe('l c tire shop');
    expect(nameNorm('The L Bar')).toBe('l bar');
    // Two different initial pairs are two different businesses.
    expect(nameNorm('L & C Auto Repair')).not.toBe(nameNorm('C & C Auto Repair'));
  });

  it('nameNorm B-CR-01: co is kept when it is not a trailing legal form', () => {
    expect(nameNorm('Co-Op Feed')).toBe('co op feed');
    expect(nameNorm('Acme Corp of Texas')).toBe('acme corp texas');
  });

  it('nameNorm B-CR-01: a trailing legal run still strips', () => {
    expect(nameNorm('Smith Co')).toBe('smith');
    expect(nameNorm('Smith Co Inc')).toBe('smith');
    expect(nameNorm('Smith Co., Inc.')).toBe('smith');
    expect(nameNorm('Smith L.L.C.')).toBe('smith');
    expect(nameNorm('Smith L L C')).toBe('smith');
    expect(nameNorm('Smith, LLC')).toBe('smith');
    expect(nameNorm('Smith Partners L.P.')).toBe('smith partners');
    expect(nameNorm('Smith Law P.L.L.C.')).toBe('smith law');
    // A legal form ahead of a trailing phone run is still trailing once the phone goes.
    expect(nameNorm('Smith LLC 956-263-1462')).toBe('smith');
    // DBA separates two names; each keeps its own trailing-only strip.
    expect(nameNorm('Smith Co LLC DBA C & L Plumbing')).toBe('smith c l plumbing');
  });

  it('nameNorm folds ligatures and strokes the way unaccent does', () => {
    // NFD + strip-marks leaves every one of these unchanged; unaccent maps them. Each letter
    // sits inside a word, so the assertion is about the fold alone and never about how a
    // lone letter tokenises.
    expect(nameNorm('Ørn Ærø Weiß Œil Łuk Đan Ikra Tıp Øðin Þor')).toBe(
      'orn aero weiss oeil luk dan ikra tip odin thor',
    );
    // The capitals, which the first draft of the table missed ("Þor" → "or"). Expected
    // values are what the SQL dictionary returned for the same string on PostgreSQL 18.6.
    expect(nameNorm('ÐAN ÞOR ẞAL Ħal Ŧam Ŋor Ŀuis')).toBe('dan thor ssal hal tam nor luis');
  });
});

describe('phoneE164', () => {
  it('phoneE164 parses a formatted local number and it is blockable', () => {
    expect(phoneE164('(956) 263-1462')).toEqual({ e164: '+19562631462', blockable: true });
    expect(phoneE164('+1 956 263 1462')).toEqual({ e164: '+19562631462', blockable: true });
  });

  it('phoneE164 toll-free parses but is not blockable', () => {
    expect(phoneE164('8004879643')).toEqual({ e164: '+18004879643', blockable: false });
    expect(phoneE164('+18004879643')).toEqual({ e164: '+18004879643', blockable: false });
  });

  it('phoneE164 rejects the 555 exchange', () => {
    expect(phoneE164('956-555-0100')).toEqual({ e164: null, blockable: false });
  });

  it('phoneE164 rejects a non-US number', () => {
    expect(phoneE164('+52 899 123 4567')).toEqual({ e164: null, blockable: false });
    expect(phoneE164('+44 20 7946 0958')).toEqual({ e164: null, blockable: false });
  });

  it('phoneE164 rejects junk, empty and missing input', () => {
    expect(phoneE164('12345')).toEqual({ e164: null, blockable: false });
    expect(phoneE164('')).toEqual({ e164: null, blockable: false });
    expect(phoneE164(null)).toEqual({ e164: null, blockable: false });
    expect(phoneE164(undefined)).toEqual({ e164: null, blockable: false });
  });
});

it('toll-free is not an identifier', () => {
  // The real number from the Overture measurement: shared by 215 places, in two raw forms
  // (170 rows bare, 45 rows +1). It is stored — danlo may still dial it — but it must never
  // be a blocking key.
  const bare = phoneE164('8004879643');
  const plus = phoneE164('+18004879643');
  expect(bare.e164).toBe(plus.e164);
  expect(bare.e164).not.toBeNull();
  expect(bare.blockable).toBe(false);
  expect(plus.blockable).toBe(false);

  // Every NPA in the set, not only 800.
  expect([...TOLL_FREE_NPAS].sort()).toEqual(['800', '833', '844', '855', '866', '877', '888']);
  for (const npa of TOLL_FREE_NPAS) {
    const r = phoneE164(`${npa}4879643`);
    expect(r.e164, npa).toBe(`+1${npa}4879643`);
    expect(r.blockable, npa).toBe(false);
  }
});

describe('addressKey', () => {
  it('addressKey splits number, street, suite and ZIP', () => {
    expect(addressKey('2426 E TYLER AVE STE 1C', '78550')).toEqual({
      streetNum: '2426',
      streetNorm: 'e tyler ave',
      unit: 'STE 1C',
      postal: '78550',
    });
  });

  it('addressKey folds USPS suffixes and truncates ZIP+4', () => {
    const k = addressKey('500 N CLOSNER BOULEVARD', '78539-1234');
    expect(k.streetNorm).toBe('n closner blvd');
    expect(k.postal).toBe('78539');
    expect(k.streetNum).toBe('500');
    expect(k.unit).toBeNull();
  });

  it('addressKey folds EXPRESSWAY the way the Census geocoder does', () => {
    // Census's own matchedAddress reads "E EXPY 83" for a raw Comptroller "E EXPRESSWAY 83".
    const raw = addressKey('E EXPRESSWAY 83', '78501');
    const census = addressKey('E EXPY 83', '78501');
    expect(raw.streetNorm).toBe('e expy 83');
    expect(raw).toEqual(census);
    expect(raw.streetNum).toBeNull();
  });

  it('addressKey: a PO box has no street number', () => {
    const k = addressKey('PO BOX 764', '78147');
    expect(k.streetNum).toBeNull();
    expect(k.postal).toBe('78147');
    // Periods are deleted, not spaced: "P.O." folds to the same key as "PO".
    expect(addressKey('P.O. Box 764', '78147')).toEqual(k);
  });

  it('addressKey does not mistake a street word for a unit', () => {
    // A designator must be a whole word followed by an identifier, and never the first token.
    expect(addressKey('1200 LOTUS DR', '78501')).toEqual({
      streetNum: '1200',
      streetNorm: 'lotus dr',
      unit: null,
      postal: '78501',
    });
    expect(addressKey('300 FLORIDA AVE', '78501').unit).toBeNull();
    expect(addressKey('300 FLORIDA AVE', '78501').streetNorm).toBe('florida ave');
  });

  it('addressKey folds directions and is case-insensitive', () => {
    expect(addressKey('1200 north 10th street', '78501').streetNorm).toBe('n 10th st');
    expect(addressKey('1200 N 10TH ST', '78501').streetNorm).toBe('n 10th st');
    expect(addressKey('77 Southwest Parkway', '78520').streetNorm).toBe('sw pkwy');
  });

  it('addressKey folds accents in street names', () => {
    expect(addressKey('100 Calle Peñitas', '78576').streetNorm).toBe('calle penitas');
  });

  it('addressKey returns nulls for missing input', () => {
    expect(addressKey(null, null)).toEqual({
      streetNum: null,
      streetNorm: null,
      unit: null,
      postal: null,
    });
    expect(addressKey('123 MAIN ST', 'not a zip').postal).toBeNull();
  });

  it('USPS_ABBREVIATIONS carries the committed minimum table', () => {
    const REQUIRED: Record<string, string> = {
      STREET: 'ST',
      AVENUE: 'AVE',
      BOULEVARD: 'BLVD',
      DRIVE: 'DR',
      ROAD: 'RD',
      HIGHWAY: 'HWY',
      EXPRESSWAY: 'EXPY',
      PARKWAY: 'PKWY',
      LANE: 'LN',
      COURT: 'CT',
      CIRCLE: 'CIR',
      PLACE: 'PL',
      TRAIL: 'TRL',
      NORTH: 'N',
      SOUTH: 'S',
      EAST: 'E',
      WEST: 'W',
      NORTHEAST: 'NE',
      NORTHWEST: 'NW',
      SOUTHEAST: 'SE',
      SOUTHWEST: 'SW',
    };
    for (const [long, short] of Object.entries(REQUIRED)) {
      expect(USPS_ABBREVIATIONS[long], long).toBe(short);
    }
  });
});

it('suite stripped not lost', () => {
  // D-12: the suite leaves the MATCH KEY (a shopping centre produced a 57,568-pair block) and
  // stays on the RECORD (it is the only thing telling two tenants of one building apart).
  const CASES: Array<[string, string, string]> = [
    ['2426 E TYLER AVE STE 1C', 'e tyler ave', 'STE 1C'],
    ['2426 E TYLER AVE SUITE 200', 'e tyler ave', 'SUITE 200'],
    ['2426 E TYLER AVE UNIT B', 'e tyler ave', 'UNIT B'],
    ['2426 E TYLER AVE APT 4', 'e tyler ave', 'APT 4'],
    ['2426 E TYLER AVE # 12', 'e tyler ave', '# 12'],
    ['2426 E TYLER AVE #12', 'e tyler ave', '#12'],
    ['2426 E TYLER AVE BLDG A', 'e tyler ave', 'BLDG A'],
    ['2426 E TYLER AVE RM 3', 'e tyler ave', 'RM 3'],
    ['2426 E TYLER AVE SPC 7', 'e tyler ave', 'SPC 7'],
    ['2426 E TYLER AVE LOT 9', 'e tyler ave', 'LOT 9'],
    ['2426 E TYLER AVE FL 2', 'e tyler ave', 'FL 2'],
    ['2426 E TYLER AVE, STE 1C', 'e tyler ave', 'STE 1C'],
  ];
  for (const [raw, street, unit] of CASES) {
    const k = addressKey(raw, '78550');
    expect(k.streetNorm, raw).toBe(street);
    expect(k.unit, raw).toBe(unit);
    expect(k.streetNorm, raw).not.toMatch(/\b(ste|suite|unit|apt|bldg|rm|spc|lot|fl)\b|#/);
  }
});
