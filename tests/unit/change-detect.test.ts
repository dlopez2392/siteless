/**
 * D-16. The free IDs-only change check: a leaf tile's stored place_id set against a fresh
 * IDs-only listing, diffed into one of six verdicts.
 *
 * Pure set diff — the DB write (members inserted, `gone_at` set, tile `changed_at`) is
 * 04-15's / 04-19's. A place missing from the listing is `gone`, never deleted.
 */
import { describe, expect, it } from 'vitest';
import { IDS_ONLY_SATURATION, diffTile } from '@/lib/places/change-detect';

const ids = (n: number, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);

describe('change detection', () => {
  it('change detection: baseline', () => {
    // A never-checked tile has nothing to diff against: every seen id becomes a member.
    const result = diffTile(new Set(), ['c', 'a', 'b', 'a'], { hasBaseline: false });
    expect(result).toEqual({ verdict: 'baseline', added: ['a', 'b', 'c'], gone: [] });

    // Even if something is stored, no baseline means no verdict about change.
    expect(diffTile(new Set(['x']), ['a'], { hasBaseline: false })).toEqual({
      verdict: 'baseline',
      added: ['a'],
      gone: [],
    });
  });

  it('change detection: unchanged', () => {
    // Order and duplicates in the listing are not change.
    const result = diffTile(new Set(['a', 'b', 'c']), ['c', 'b', 'a', 'b'], { hasBaseline: true });
    expect(result).toEqual({ verdict: 'unchanged', added: [], gone: [] });

    // An empty tile that is still empty is unchanged, not a baseline.
    expect(diffTile(new Set(), [], { hasBaseline: true })).toEqual({
      verdict: 'unchanged',
      added: [],
      gone: [],
    });
  });

  it('change detection: new', () => {
    const result = diffTile(new Set(['a', 'c']), ['d', 'a', 'c', 'b', 'd'], { hasBaseline: true });
    expect(result).toEqual({ verdict: 'new', added: ['b', 'd'], gone: [] });
  });

  it('change detection: gone', () => {
    // Missing from the listing is `gone` — history, never a deletion.
    const result = diffTile(new Set(['a', 'b', 'c', 'd']), ['c', 'a'], { hasBaseline: true });
    expect(result).toEqual({ verdict: 'gone', added: [], gone: ['b', 'd'] });

    // Every member gone is still `gone`.
    expect(diffTile(new Set(['a']), [], { hasBaseline: true })).toEqual({
      verdict: 'gone',
      added: [],
      gone: ['a'],
    });
  });

  it('change detection: both', () => {
    const result = diffTile(new Set(['a', 'b', 'c']), ['e', 'a', 'd'], { hasBaseline: true });
    expect(result).toEqual({ verdict: 'both', added: ['d', 'e'], gone: ['b', 'c'] });
  });

  it('change detection: saturated', () => {
    expect(IDS_ONLY_SATURATION).toBe(60);

    // Text Search caps at 60 results: a leaf now returning 60 may be hiding more, so it
    // needs a paid re-sweep and subdivision — regardless of what the diff says.
    const sixty = ids(60);
    const stored = new Set([...sixty.slice(0, 58), 'z-old']);
    const result = diffTile(stored, [...sixty].reverse(), { hasBaseline: true });
    expect(result.verdict).toBe('saturated');
    // The additions are still computed, sorted, so the writer can record the new members.
    expect(result.added).toEqual(['p058', 'p059']);

    // Saturated even when the set is otherwise unchanged…
    expect(diffTile(new Set(sixty), sixty, { hasBaseline: true })).toEqual({
      verdict: 'saturated',
      added: [],
      gone: [],
    });
    // …and even on a never-checked tile: a leaf at 60 needs subdivision either way.
    expect(diffTile(new Set(), sixty, { hasBaseline: false })).toEqual({
      verdict: 'saturated',
      added: sixty,
      gone: [],
    });

    // One short of the cap is an ordinary verdict.
    expect(diffTile(new Set(ids(59)), ids(59), { hasBaseline: true }).verdict).toBe('unchanged');
  });

  it('a saturated change check never marks a member gone', () => {
    // B-WR-03 / A-WR-02: a capped listing is Google's top 60, not the tile. A member that simply
    // fell outside the cap is not evidence of absence — marking it `gone` would corrupt the
    // membership the next diff and the novelty rule read.
    const sixty = ids(60);
    const stored = new Set([...sixty.slice(0, 58), 'z-old', 'z-older']);
    const result = diffTile(stored, sixty, { hasBaseline: true });
    expect(result).toEqual({ verdict: 'saturated', added: ['p058', 'p059'], gone: [] });
    // The same listing one short of the cap is an ordinary diff, and absence IS evidence there.
    const fiftyNine = diffTile(new Set([...ids(59), 'z-old']), ids(59), { hasBaseline: true });
    expect(fiftyNine).toEqual({ verdict: 'gone', added: [], gone: ['z-old'] });
  });

  it('a check that reached its last page is saturated even short of 60', () => {
    // B-WR-01: page 3 was asked for because page 2 had a token — the listing hit the cap even if
    // filtering or duplicates left fewer than 60 ids.
    const seen = ids(57);
    expect(diffTile(new Set(seen), seen, { hasBaseline: true, pagesServed: 3 })).toEqual({
      verdict: 'saturated',
      added: [],
      gone: [],
    });
    expect(diffTile(new Set(ids(40)), ids(40), { hasBaseline: true, pagesServed: 2 }).verdict).toBe(
      'unchanged',
    );
  });

  it('change detection: the inputs are not mutated', () => {
    const stored = new Set(['a', 'b']);
    const seen = ['c', 'a', 'c'];
    diffTile(stored, seen, { hasBaseline: true });
    expect([...stored]).toEqual(['a', 'b']);
    expect(seen).toEqual(['c', 'a', 'c']);
  });
});
