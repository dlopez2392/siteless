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
 *   - expired rows await purge (whatever the last purge time — a row past 30 days is on disk
 *     now), or
 *   - the last purge is more than 36 hours old, or
 *   - the purge has NEVER run and a held coordinate is already older than 36 hours (the cron
 *     had its chance and did not take it — e.g. `CRON_SECRET` was never set).
 * Before any Places call (nothing held, never purged) it is false.
 */
export function purgeOverdue(s: TransientStats, nowMs: number): boolean {
  if (s.expiredAwaitingPurge > 0) return true;
  if (s.lastPurgeMs !== null) return nowMs - s.lastPurgeMs > OVERDUE_MS;
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
