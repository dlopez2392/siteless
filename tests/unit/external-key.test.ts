/**
 * D-19 / DEDUP-03: the read-aloud lead key.
 *
 * The draw is random, so every assertion here runs over 10,000 keys: the shape and the
 * forbidden glyphs over every one of them, and alphabet coverage over the whole set. The
 * coverage test is what catches a stuck or narrowed draw (a `% 16`, a 31-symbol alphabet
 * after someone "tidies" the literal) — the shape test alone passes on `SL-000000` forever.
 *
 * With 60,000 uniform draws over 32 symbols the chance that any one symbol is never drawn is
 * 32 × (31/32)^60000 ≈ 1e-826. The coverage test cannot flake.
 */
import { describe, expect, it } from 'vitest';

import { EXTERNAL_KEY_PATTERN, newExternalKey } from '@/lib/ids/external-key';

const DRAWS = 10_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function draw(n: number): string[] {
  return Array.from({ length: n }, () => newExternalKey());
}

describe('newExternalKey', () => {
  it('external key matches the Crockford shape', () => {
    const keys = draw(DRAWS);
    const bad = keys.filter((k) => !EXTERNAL_KEY_PATTERN.test(k));
    expect(bad).toEqual([]);
    // Two-sided: the pattern must refuse the shapes a regression would produce, or a pattern
    // loosened to `.{6}` would pass the line above on anything.
    for (const wrong of ['SL-ABCDE', 'SL-ABCDEFG', 'SL-ABCDEI', 'sl-abcdef', 'SL-ABCDEL', 'XSL-ABCDEF']) {
      expect(EXTERNAL_KEY_PATTERN.test(wrong)).toBe(false);
    }
    expect(keys.every((k) => k.length === 9)).toBe(true);
  });

  it('external key never contains I L O or U', () => {
    const keys = draw(DRAWS);
    const offenders = keys.filter((k) => /[ILOU]/.test(k.slice(3)));
    expect(offenders).toEqual([]);
  });

  it('external key draws the whole alphabet', () => {
    const seen = new Set<string>();
    for (const k of draw(DRAWS)) for (const ch of k.slice(3)) seen.add(ch);
    expect([...seen].sort().join('')).toBe([...CROCKFORD].sort().join(''));
    expect(seen.size).toBe(32);
  });
});
