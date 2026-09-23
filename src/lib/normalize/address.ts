/**
 * The address match key: street_num / street_norm / unit / postal (DEDUP-04, D-12).
 *
 *   street_num  = the leading integer token, or null         "2426 E TYLER AVE STE 1C" → "2426"
 *   street_norm = the remainder, suite REMOVED, USPS-folded   → "e tyler ave"
 *   unit        = the removed suite, KEPT ON THE RECORD       → "STE 1C" (verbatim)
 *   postal      = the first 5 digits of the ZIP               → "78550"
 *
 * 🔴 THE SUITE IS STRIPPED FROM THE MATCH KEY AND KEPT ON THE RECORD. A shopping-centre
 * address produced a 57,568-pair block in the measurements; the suite in the key would not
 * have helped, and dropping it from the record would lose the only thing that tells two
 * tenants of one building apart on the detail view.
 *
 * USPS folding is a table-driven map, so the key is identical whichever form a source used.
 * The Census geocoder itself folds "E EXPRESSWAY 83" to "E EXPY 83", so the same table
 * reconciles a Census `matchedAddress` against a raw Comptroller `outlet_address`.
 *
 * Owned in-house on purpose: `node-postal` is a native C build that will not deploy on Vercel
 * Functions and `parse-address` is dead since 2022. The field is short enough to own.
 *
 * Pure: no I/O. Diacritics go through the same `foldDiacritics` as the name key.
 */
import { foldDiacritics } from './name';

/** Long form → USPS standard abbreviation (Publication 28, C1 suffixes and directionals). */
export const USPS_ABBREVIATIONS: Readonly<Record<string, string>> = {
  STREET: 'ST',
  AVENUE: 'AVE',
  BOULEVARD: 'BLVD',
  DRIVE: 'DR',
  ROAD: 'RD',
  HIGHWAY: 'HWY',
  EXPRESSWAY: 'EXPY',
  FREEWAY: 'FWY',
  PARKWAY: 'PKWY',
  LANE: 'LN',
  COURT: 'CT',
  CIRCLE: 'CIR',
  PLACE: 'PL',
  TRAIL: 'TRL',
  TERRACE: 'TER',
  PLAZA: 'PLZ',
  CENTER: 'CTR',
  SQUARE: 'SQ',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
};

/**
 * A CANDIDATE secondary-unit designator and its identifier. Designators: STE SUITE UNIT APT
 * BLDG RM SPC LOT FL, or `#`. It must follow whitespace or a comma (never the first token —
 * "LOT" is not the start of a street), and a word designator must be followed by an
 * identifier, so "LOTUS DR" is not a unit. The unit runs from the designator to the end of
 * the string. `isUnit` then decides whether a candidate really is one.
 */
const UNIT_CANDIDATE =
  /[\s,]+(?:(?:STE|SUITE|UNIT|APT|BLDG|RM|SPC|LOT|FL)\.?\s+|#\s*)([A-Z0-9][A-Z0-9-]*)(?=\s|$)/gi;

const LEADING_NUMBER = /^(\d+)(?:\s+|$)/;

const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

/** Street-type suffixes, short and long form ("RD" and "ROAD"). */
const STREET_TYPES = new Set(
  Object.entries(USPS_ABBREVIATIONS)
    .filter(([, short]) => !DIRECTIONALS.has(short))
    .flatMap(([long, short]) => [long, short]),
);

const upperTokens = (s: string): string[] =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0);

/**
 * 🔴 B-WR-02: a designator word can START a street name. `RM` is Texas's Ranch-to-Market
 * prefix ("12345 RM 620 N"), and "100 LOT 5 RD", "1201 W UNIT RD", "500 N APT BLVD" and
 * "6 SPC ST" are streets. Read as units, each lost its street key (null, or a lone `w` that
 * matches every other `W …` street). A candidate is NOT a unit when:
 *   - what precedes it, less the house number, is empty or a lone directional (there would be
 *     no street left), or
 *   - its identifier, or the token right after it, is a street type ("UNIT RD", "LOT 5 RD").
 * `RM` stays a designator: behind a real street ("… TYLER AVE RM 3") it is a room.
 */
function isUnit(before: string, identifier: string, after: string): boolean {
  const street = upperTokens(before.replace(LEADING_NUMBER, ''));
  if (street.length === 0) return false;
  if (street.length === 1 && DIRECTIONALS.has(USPS_ABBREVIATIONS[street[0]!] ?? street[0]!)) {
    return false;
  }
  if (STREET_TYPES.has(identifier.toUpperCase())) return false;
  const next = upperTokens(after)[0];
  return next === undefined || !STREET_TYPES.has(next);
}

export interface AddressKey {
  streetNum: string | null;
  streetNorm: string | null;
  unit: string | null;
  postal: string | null;
}

function postalOf(zip: string | null | undefined): string | null {
  const m = zip?.trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return m?.[1] ?? null;
}

export function addressKey(
  address: string | null | undefined,
  zip: string | null | undefined,
): AddressKey {
  const postal = postalOf(zip);
  const collapsed = (address ?? '').trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return { streetNum: null, streetNorm: null, unit: null, postal };

  let rest = collapsed;
  let unit: string | null = null;
  for (const m of collapsed.matchAll(UNIT_CANDIDATE)) {
    const identifier = m[1];
    if (identifier === undefined) continue;
    const before = collapsed.slice(0, m.index);
    if (!isUnit(before, identifier, collapsed.slice(m.index + m[0].length))) continue;
    unit = collapsed
      .slice(m.index)
      .replace(/^[\s,]+/, '')
      .trim();
    rest = before;
    break;
  }

  let streetNum: string | null = null;
  const numMatch = rest.match(LEADING_NUMBER);
  if (numMatch?.[1] !== undefined) {
    streetNum = numMatch[1];
    rest = rest.slice(numMatch[0].length);
  }

  const tokens = foldDiacritics(rest)
    .toUpperCase()
    .replace(/\./g, '') // "P.O." → "PO", "ST." → "ST", "N.W." → "NW"
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0)
    .map((t) => USPS_ABBREVIATIONS[t] ?? t);

  const streetNorm = tokens.join(' ').toLowerCase();
  return { streetNum, streetNorm: streetNorm.length === 0 ? null : streetNorm, unit, postal };
}
