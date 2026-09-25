/**
 * D-16. Pure set diff. The DB write (members inserted, `gone_at` set, tile `changed_at`) is 04-15's.
 *
 * A leaf tile's stored `place_id` set is diffed against a fresh IDs-only listing (the free
 * Text Search Essentials SKU). The verdict decides whether the tile is a candidate for the
 * next paid sweep; `added`/`gone` are what the writer records. A place missing from the
 * listing is `gone` — history, never a deletion.
 *
 * Precedence, in order:
 *   1. `saturated` — the listing hit the Text Search cap of 60 (or reached its third page,
 *      B-WR-01), so it may be hiding more and
 *      the leaf needs a paid re-sweep and subdivision. That holds whatever the diff says and
 *      whether or not the tile was ever checked, so it wins over `baseline` too.
 *   2. `baseline` — never checked: nothing to diff against, every seen id is `added`.
 *   3. `unchanged` | `new` | `gone` | `both` from the set difference.
 * `added` and `gone` are de-duplicated and sorted. `gone` is always EMPTY on a saturated
 * listing: a listing capped at 60 cannot prove a member absent (B-WR-03).
 *
 * No client directive, no server-only import, no I/O. Place ids only — no Places content
 * passes through here.
 */

/** Text Search returns at most 60 results across its three pages. */
export const IDS_ONLY_SATURATION = 60;
/** Its three pages: a listing that reached page 3 hit the cap (B-WR-01). */
export const IDS_ONLY_MAX_PAGES = 3;

export type ChangeVerdict = 'baseline' | 'unchanged' | 'new' | 'gone' | 'both' | 'saturated';

export function diffTile(
  stored: ReadonlySet<string>,
  seen: readonly string[],
  opts: { hasBaseline: boolean; pagesServed?: number },
): { verdict: ChangeVerdict; added: string[]; gone: string[] } {
  const seenSet = new Set(seen);
  // B-WR-01: reaching the third page is the cap even when fewer than 60 ids came back.
  const saturated =
    seen.length >= IDS_ONLY_SATURATION || (opts.pagesServed ?? 0) >= IDS_ONLY_MAX_PAGES;

  if (!opts.hasBaseline) {
    const added = [...seenSet].sort();
    return { verdict: saturated ? 'saturated' : 'baseline', added, gone: [] };
  }

  const added = [...seenSet].filter((id) => !stored.has(id)).sort();
  // B-WR-03: a capped listing is Google's top 60, not the tile — a member missing from it may
  // simply rank below the cap. Absence proves nothing on a saturated listing, so nothing is
  // `gone` (the writer, app.record_change_check, holds the same line — A-WR-02).
  const gone = saturated ? [] : [...stored].filter((id) => !seenSet.has(id)).sort();

  let verdict: ChangeVerdict;
  if (saturated) verdict = 'saturated';
  else if (added.length > 0 && gone.length > 0) verdict = 'both';
  else if (added.length > 0) verdict = 'new';
  else if (gone.length > 0) verdict = 'gone';
  else verdict = 'unchanged';

  return { verdict, added, gone };
}
