/**
 * D-16. Pure set diff. The DB write (members inserted, `gone_at` set, tile `changed_at`) is 04-15's.
 *
 * A leaf tile's stored `place_id` set is diffed against a fresh IDs-only listing (the free
 * Text Search Essentials SKU). The verdict decides whether the tile is a candidate for the
 * next paid sweep; `added`/`gone` are what the writer records. A place missing from the
 * listing is `gone` — history, never a deletion.
 *
 * Precedence, in order:
 *   1. `saturated` — the listing hit the Text Search cap of 60, so it may be hiding more and
 *      the leaf needs a paid re-sweep and subdivision. That holds whatever the diff says and
 *      whether or not the tile was ever checked, so it wins over `baseline` too.
 *   2. `baseline` — never checked: nothing to diff against, every seen id is `added`.
 *   3. `unchanged` | `new` | `gone` | `both` from the set difference.
 * `added` and `gone` are always computed, de-duplicated and sorted.
 *
 * No client directive, no server-only import, no I/O. Place ids only — no Places content
 * passes through here.
 */

/** Text Search returns at most 60 results across its three pages. */
export const IDS_ONLY_SATURATION = 60;

export type ChangeVerdict = 'baseline' | 'unchanged' | 'new' | 'gone' | 'both' | 'saturated';

export function diffTile(
  stored: ReadonlySet<string>,
  seen: readonly string[],
  opts: { hasBaseline: boolean },
): { verdict: ChangeVerdict; added: string[]; gone: string[] } {
  const seenSet = new Set(seen);
  const saturated = seen.length >= IDS_ONLY_SATURATION;

  if (!opts.hasBaseline) {
    const added = [...seenSet].sort();
    return { verdict: saturated ? 'saturated' : 'baseline', added, gone: [] };
  }

  const added = [...seenSet].filter((id) => !stored.has(id)).sort();
  const gone = [...stored].filter((id) => !seenSet.has(id)).sort();

  let verdict: ChangeVerdict;
  if (saturated) verdict = 'saturated';
  else if (added.length > 0 && gone.length > 0) verdict = 'both';
  else if (added.length > 0) verdict = 'new';
  else if (gone.length > 0) verdict = 'gone';
  else verdict = 'unchanged';

  return { verdict, added, gone };
}
