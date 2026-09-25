import type { ReviewFilter, ReviewQueue } from '@/server/queries/review-queue';
import {
  REVIEW_CLEAR_HEADING,
  REVIEW_DUPLICATES_EMPTY_HEADING,
  REVIEW_EMPTY_HEADING,
  REVIEW_GOOGLE_EMPTY_HEADING,
  REVIEW_REMAINING,
  REVIEW_REMAINING_ALL,
  REVIEW_REMAINING_GOOGLE,
} from './copy';
import { formatCount } from './review-format';

/**
 * `/review`'s URL state and the lines it drives (04-UI-SPEC § Screen 3, Open Question 3).
 *
 * - `?kind=all|duplicates|google` — the filter. Anything else (missing, repeated, misspelt)
 *   reads as `all`, so a hand-edited or stale link still shows the whole queue.
 * - `?skip=<id>,<id>` — the Google listings skipped THIS SESSION. "Skip" on a listing writes
 *   nothing (04-21; 0029 has no skip column), so the screen remembers the ids in the URL and the
 *   queue sinks them (`readReviewQueue`). The URL, not client memory, because the next item is
 *   a server read: the page must know what was skipped to choose it. A reload keeps the place;
 *   a fresh visit to `/review` starts over, and the skipped listings are still pending.
 *
 * 🔴 NO CLIENT DIRECTIVE, NO I/O. Pure functions, shared by the server page and the client
 * filter and action bar. The review-queue import is TYPE-ONLY (erased), never a runtime edge
 * into a server-only module.
 */

export const REVIEW_KINDS = [
  'all',
  'duplicates',
  'google',
] as const satisfies readonly ReviewFilter[];

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseReviewKind(raw: string | string[] | undefined): ReviewFilter {
  const value = first(raw);
  return (REVIEW_KINDS as readonly string[]).includes(value ?? '')
    ? (value as ReviewFilter)
    : 'all';
}

/** How many skipped ids the URL carries. Past it the OLDEST fall off and resurface in order. */
export const SKIPPED_MAX = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The skipped listing ids, as the query may receive them: uuids only (anything else is dropped,
 * never passed to SQL), de-duplicated, lower-cased, the newest `SKIPPED_MAX` kept.
 */
export function parseSkipped(raw: string | string[] | undefined): string[] {
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim().toLowerCase())
    .filter((v) => UUID.test(v));
  return capSkipped([...new Set(values)]);
}

function capSkipped(ids: readonly string[]): string[] {
  return ids.slice(Math.max(0, ids.length - SKIPPED_MAX));
}

/** The skipped list with one more id, at the newest end. */
export function withSkipped(skipped: readonly string[], id: string): string[] {
  return capSkipped([...skipped.filter((s) => s !== id), id.toLowerCase()]);
}

/** A `/review` link that keeps the session's skipped listings. */
export function reviewHref(kind: ReviewFilter, skipped: readonly string[] = []): string {
  const skip = skipped.length > 0 ? `&skip=${skipped.map(encodeURIComponent).join(',')}` : '';
  return `/review?kind=${kind}${skip}`;
}

type QueueCounts = Pick<ReviewQueue, 'remaining' | 'counts'>;

/** The remaining line (`review-remaining`), per filter (§ Screen 3 → Remaining count). */
export function reviewRemainingText(
  kind: ReviewFilter,
  { remaining, counts }: QueueCounts,
): string {
  if (kind === 'google') return REVIEW_REMAINING_GOOGLE(remaining);
  if (kind === 'duplicates') return REVIEW_REMAINING(remaining, formatCount(remaining));
  return REVIEW_REMAINING_ALL(remaining, counts.pairs, counts.google);
}

export type ReviewEmptyKind = 'nothing-yet' | 'google-clear' | 'duplicates-clear' | 'queue-clear';

/**
 * Which end state an empty queue shows (§ States → Empty). A filtered queue with the OTHER kind
 * still waiting says so and offers it; every other worked queue is "Queue clear"; "Nothing to
 * review yet" only when nothing was ever ingested.
 */
export function reviewEmptyKind(
  kind: ReviewFilter,
  { counts, ingested }: Pick<ReviewQueue, 'counts' | 'ingested'>,
): ReviewEmptyKind {
  if (!ingested) return 'nothing-yet';
  if (kind === 'google' && counts.pairs > 0) return 'google-clear';
  if (kind === 'duplicates' && counts.google > 0) return 'duplicates-clear';
  return 'queue-clear';
}

/** The live region's words for an empty queue — the visible Empty heading, announced. */
export const REVIEW_EMPTY_LIVE: Record<ReviewEmptyKind, string> = {
  'nothing-yet': REVIEW_EMPTY_HEADING,
  'google-clear': REVIEW_GOOGLE_EMPTY_HEADING,
  'duplicates-clear': REVIEW_DUPLICATES_EMPTY_HEADING,
  'queue-clear': REVIEW_CLEAR_HEADING,
};
