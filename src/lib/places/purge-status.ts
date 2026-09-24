/**
 * The Google Places transient figures and the purge-overdue rule (D-12; 04-UI-SPEC § Screen 4,
 * Color → Warning item 14).
 *
 * PURE: no I/O, no clock, no `Intl`. `nowMs` is a parameter so the rule is testable at an exact
 * instant and the page decides what "now" is. Imported by the server query module, the server
 * card and its unit test alike — no `server-only`, no `"use client"`.
 */

/** What Siteless holds from Google Places for one org — `app.places_transient_stats()`,
 *  converted from its bigint/epoch-ms text columns. Counts only; never a coordinate. */
export type TransientStats = {
  /** Distinct place ids across tile members and attachments. */
  placeIdsHeld: number;
  /** Coordinate rows NOT yet expired (`expires_at > now()`). */
  coordinatesHeld: number;
  /** When the oldest HELD coordinate was observed; null when none is held. */
  oldestCoordinateMs: number | null;
  /** Expired coordinate rows the purge has not removed yet — never counted as held. */
  expiredAwaitingPurge: number;
  /** When the longest-waiting of those expired (min `expires_at`, drizzle/0031); null when
   *  none is expired. */
  oldestExpiredMs: number | null;
  /** The org's last `place_purge_runs.ran_at`; null when it has never been purged. */
  lastPurgeMs: number | null;
  /** That purge's row count; null when never purged. */
  lastRowsPurged: number | null;
};

/** The daily cron runs every 24 h; 36 h allows one skipped or late Vercel delivery's slack
 *  before the warning shows (Vercel Cron is best-effort, Pattern 10). */
export const PURGE_OVERDUE_HOURS = 36;

const HOUR_MS = 3_600_000;
const OVERDUE_MS = PURGE_OVERDUE_HOURS * HOUR_MS;

/** The desk fallback the overdue alert copies (`scripts/purge-places.ts`, docs/runbooks/places.md). */
export const PURGE_PLACES_COMMAND = 'pnpm purge:places --target=prod';

/**
 * True when the purge is behind:
 *   - a row has been EXPIRED for more than 36 hours (whatever the last purge time — a purge
 *     since then should have removed it). C-WR-10: a row expired for less than that is the
 *     normal state between daily purges — coordinates expire continuously, the purge runs once
 *     a day — and is not a warning; or
 *   - the last purge is more than 36 hours old, or
 *   - the purge has NEVER run and a coordinate is already older than 36 hours: a held one, or
 *     any expired one (observed 30 days ago). The cron had its chance and did not take it —
 *     e.g. `CRON_SECRET` was never set.
 * Before any Places call (nothing held, never purged) it is false.
 */
export function purgeOverdue(s: TransientStats, nowMs: number): boolean {
  if (s.oldestExpiredMs !== null && nowMs - s.oldestExpiredMs > OVERDUE_MS) return true;
  if (s.lastPurgeMs !== null) return nowMs - s.lastPurgeMs > OVERDUE_MS;
  if (s.expiredAwaitingPurge > 0) return true;
  return (
    s.coordinatesHeld > 0 && s.oldestCoordinateMs !== null && nowMs - s.oldestCoordinateMs > OVERDUE_MS
  );
}

/** Whole hours from `fromMs` to `nowMs`, never negative (clock skew between app and DB). */
export function wholeHoursSince(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / HOUR_MS));
}

/** Whole days from `fromMs` to `nowMs`, never negative. */
export function wholeDaysSince(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / (24 * HOUR_MS)));
}
