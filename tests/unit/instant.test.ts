/**
 * `instantOf` / `requireInstant` (src/lib/instant.ts): epoch milliseconds read back through a
 * raw SQL executor → `Date`.
 *
 * B-WR-06: `Number('')` and `Number('   ')` are 0, which is finite, so an empty string used to
 * come back as 1970-01-01 — the exact silent epoch `requireInstant` documents refusing.
 *
 * Mutation: drop the empty-string guard → 'instantOf B-WR-06: an empty string is refused, not
 * the epoch' goes red, and only that test.
 */
import { describe, expect, it } from 'vitest';
import { instantOf, requireInstant } from '@/lib/instant';

describe('instantOf', () => {
  it('instantOf converts epoch milliseconds and passes null through', () => {
    expect(instantOf('1758585600000')?.toISOString()).toBe('2025-09-23T00:00:00.000Z');
    expect(instantOf(null)).toBeNull();
    expect(() => instantOf('not a number')).toThrow(/epoch milliseconds/);
  });

  it('instantOf B-WR-06: an empty string is refused, not the epoch', () => {
    expect(() => instantOf('')).toThrow(/empty/);
    expect(() => instantOf('   ')).toThrow(/empty/);
    expect(() => requireInstant('', 'businesses.created_at')).toThrow(/empty/);
    // A real zero is still the epoch: only the missing text is refused.
    expect(instantOf('0')?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});
