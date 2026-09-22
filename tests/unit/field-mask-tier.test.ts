/**
 * BUDG-01 / T-2-08 / T-2-05. The single most test-worthy function in the codebase: the
 * price of a Places call is whatever its field mask says it is.
 *
 * Mutations, one named test each:
 *   - `fieldMaskTier` returns 'ts_essentials' for an unknown field instead of throwing
 *       → 'fieldMaskTier throws on an unknown field' goes red ALONE; the positive control
 *         beside it stays green, which is what distinguishes a working guard from a
 *         function that refuses everything.
 *   - M11 half 1: append 'places.reviews' to PLACES_TEXT_SEARCH_FIELD_MASK
 *       → 'fieldMaskTier atmosphere: appending places.reviews raises the tier'.
 *         Half 2 lives in price-book.test.ts and shares no assertion with this one —
 *         two independent tests, because a mask that silently re-tiers and a ledger that
 *         silently re-prices are two different failures.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_PLACES_FIELDS,
  fieldMaskTier,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  type PlacesField,
} from '@/lib/budget/field-mask-tier';
import type { TextSearchSku } from '@/lib/budget/price-book';

/** The four Enterprise fields on their own — the mask minus everything cheaper. */
const ENTERPRISE_MASK = [
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
] as const;

/**
 * [field, the tier it IS, the tier it must NOT be]. The third column is the neighbouring
 * tier — the one a broken default or an off-by-one in the "highest wins" comparison would
 * produce — so every row proves the mapping in both directions rather than only that
 * something was returned.
 */
const FIELD_TIERS: ReadonlyArray<readonly [PlacesField, TextSearchSku, TextSearchSku]> = [
  ['places.id', 'ts_essentials', 'ts_pro'],
  ['places.name', 'ts_essentials', 'ts_pro'],
  ['nextPageToken', 'ts_essentials', 'ts_pro'],
  ['places.displayName', 'ts_pro', 'ts_essentials'],
  ['places.formattedAddress', 'ts_pro', 'ts_essentials'],
  ['places.location', 'ts_pro', 'ts_essentials'],
  ['places.types', 'ts_pro', 'ts_essentials'],
  ['places.businessStatus', 'ts_pro', 'ts_essentials'],
  ['places.websiteUri', 'ts_enterprise', 'ts_pro'],
  ['places.nationalPhoneNumber', 'ts_enterprise', 'ts_pro'],
  ['places.rating', 'ts_enterprise', 'ts_pro'],
  ['places.userRatingCount', 'ts_enterprise', 'ts_pro'],
  ['places.reviews', 'ts_enterprise_atmosphere', 'ts_enterprise'],
];

const SRC_DIR = 'src';
const FIELD_MASK_HEADER = 'X-Goog-FieldMask';
const HEADER_MAY_BE_NAMED_IN = new Set(['src/lib/budget/field-mask-tier.ts']);

/** Posix-relative paths so the assertion reads the same on Windows and in CI. */
function walk(dir: string): string[] {
  return nodeFs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = nodePath.posix.join(dir.split(nodePath.sep).join('/'), entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('field mask tiering (BUDG-01)', () => {
  it('fieldMaskTier maps every known field to its tier', () => {
    // A table that drifted out of sync with the module would test a shrinking subset
    // while staying green. Set equality in both directions, first.
    expect([...FIELD_TIERS.map(([field]) => field)].sort()).toEqual([...ALL_PLACES_FIELDS].sort());

    for (const [field, expected, notExpected] of FIELD_TIERS) {
      expect(fieldMaskTier([field]), field).toBe(expected);
      expect(fieldMaskTier([field]), field).not.toBe(notExpected);
    }
  });

  it('fieldMaskTier throws on an unknown field', () => {
    // 'places.priceLevel' is real, and really is a field this module has never priced.
    expect(() => fieldMaskTier(['places.priceLevel' as never])).toThrow(/unknown field/);
    // An unknown field mixed into an otherwise valid mask is the realistic shape of the
    // bug — one field added to a mask nobody re-tiered.
    expect(() =>
      fieldMaskTier([...PLACES_TEXT_SEARCH_FIELD_MASK, 'places.photos' as never]),
    ).toThrow(/unknown field/);
    // Positive control: a function that threw on everything would satisfy the two
    // assertions above and be useless.
    expect(fieldMaskTier(['places.websiteUri'])).toBe('ts_enterprise');
  });

  it('fieldMaskTier throws on an empty mask', () => {
    expect(() => fieldMaskTier([])).toThrow(/empty mask/);
    // Positive control again: one field is enough to price a call.
    expect(fieldMaskTier(['places.id'])).toBe('ts_essentials');
  });

  it('fieldMaskTier: nextPageToken is Essentials and does not raise the tier', () => {
    // The one field a reviewer assumes floats free. It does — it is an IDs-Only field.
    expect(fieldMaskTier(['places.id', 'nextPageToken'])).toBe('ts_essentials');
    // And it does not drag an Enterprise mask anywhere either — paging a $35/1,000 sweep
    // costs $35/1,000, not $40.
    expect(fieldMaskTier([...ENTERPRISE_MASK])).toBe('ts_enterprise');
    expect(fieldMaskTier([...ENTERPRISE_MASK, 'nextPageToken'])).toBe('ts_enterprise');
  });

  it('fieldMaskTier atmosphere: appending places.reviews raises the tier', () => {
    // M11 half 1. The production mask as it stands today.
    expect(fieldMaskTier(PLACES_TEXT_SEARCH_FIELD_MASK)).toBe('ts_enterprise');
    // One field, +$5 per 1,000. This is the whole reason the tier is computed rather
    // than declared.
    expect(fieldMaskTier([...PLACES_TEXT_SEARCH_FIELD_MASK, 'places.reviews'])).toBe(
      'ts_enterprise_atmosphere',
    );
  });

  it('X-Goog-FieldMask is named in at most one module under src', () => {
    const files = walk(SRC_DIR);

    // A wrong cwd throws; a right-but-empty walk would pass vacuously. Pin a file that
    // is known to be there so only a real absence can make this green.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('src/lib/budget/field-mask-tier.ts');

    const contents = files.map((file) => ({ file, text: nodeFs.readFileSync(file, 'utf8') }));
    // Prove the reads actually returned source, not empty strings — otherwise the
    // filter below is scanning nothing and reports "zero violations" forever.
    expect(contents.some(({ text }) => text.includes('PLACES_TEXT_SEARCH_FIELD_MASK'))).toBe(true);

    const namesTheHeader = contents
      .filter(({ text }) => text.includes(FIELD_MASK_HEADER))
      .map(({ file }) => file);

    // Forward-compatible: Phase 2 makes no Places call, so the count is 0 or 1 today and
    // Phase 4's client must import the mask from here rather than spell the header again.
    expect(namesTheHeader.filter((file) => !HEADER_MAY_BE_NAMED_IN.has(file))).toEqual([]);
  });
});
