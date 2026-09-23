'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatLocal } from '@/lib/time';
import {
  RUN_ANNOUNCE_COMPLETE,
  RUN_ANNOUNCE_FAILED,
  RUN_ANNOUNCE_REFUSED,
  RUN_ANNOUNCE_STARTED,
  RUN_ANNOUNCE_STOPPED,
  RUN_ANNOUNCE_TRUNCATED,
  RUN_REPORT_LIVE_LINE,
  RUN_REPORT_REFRESHING,
  RUN_REPORT_REFRESH_FAILED,
  RUN_REPORT_REFRESH_NOW,
  STOPPED_REASON,
} from '@/lib/ui/copy';
import type { StoppedReason } from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';

/**
 * The run report's live-refresh island (04-UI-SPEC § Screen 1 "Live refresh contract", D-17,
 * Executor Rules 11 and 36).
 *
 * 🔴 NO DATA OF ITS OWN. It calls `router.refresh()`, and the SERVER component re-renders the
 * report from the database; the numbers never pass through this file. `router.refresh()`
 * keeps the current tree until the new one arrives, so nothing on the report ever blanks
 * during a refresh (Rule 11) — the only loading treatment anywhere is the "Refreshing…" label
 * on the button the user pressed.
 *
 * 🔴 THE TIMER CONTRACT (Rule 36, threat T-4-02 — one RSC re-render per tick, never more):
 *  - ONE `setTimeout` chain, never an interval. Each refresh bumps `cycle`, which re-arms the
 *    next tick 5 s out — so "Refresh now" at 3 s puts the next tick at 8 s, not 5 s.
 *  - Armed only while the status is `queued` or `running` AND the page is visible. A terminal
 *    status, a hidden page and an unmount each clear it; zero timers survive a terminal
 *    render. (The render that carries the terminal status IS the final refresh.)
 *  - On `visibilitychange` → visible, one immediate refresh, then the 5 s cadence resumes.
 *
 * 🔴 THE WATCHDOG. A refresh that has not produced a new `renderedAtMs` within 10 s keeps the
 * previous numbers and swaps the "Updated …" line for the refresh-failed line. It is armed by
 * the FIRST unanswered refresh and NOT re-armed by the ticks that follow — at a 5 s cadence a
 * per-tick watchdog would be reset forever and never fire. A new `renderedAtMs` is the only
 * proof a refresh landed, and it clears both the watchdog and the failed line.
 *
 * 🔴 THE LIVE REGION IS QUIET (§ Accessibility). One visually hidden polite region announces
 * TRANSITIONS only — the status changing, and the first appearance of a truncation warning.
 * Nothing is announced on load, and the 5-second counts are never in it. It renders in every
 * status so the terminal transition is heard: the report must keep this island MOUNTED after
 * the run finishes (it hides its own live line and button), or the "Run complete" announcement
 * unmounts with it.
 *
 * `renderedAtMs` is `Date.now()` taken by the server at render time. The machine clocks
 * differ, but the watchdog compares it only for CHANGE, never against the browser's clock.
 */

export const REFRESH_MS = 5000;
export const REFRESH_TIMEOUT_MS = 10_000;

const LIVE_STATUSES = new Set(['queued', 'running']);

/** "2:14:05 PM" — the app's zone and pinned locale, never the browser's (Rule 26). */
function clock(ms: number): string {
  return formatLocal(new Date(ms), { timeStyle: 'medium' });
}

function isStoppedReason(reason: string | null): reason is StoppedReason {
  return reason !== null && Object.hasOwn(STOPPED_REASON, reason);
}

/** What the live region says when the status changes TO `status`. Empty for a status that has
 *  no announcement (a return to `queued`, an unknown status, a partial run whose reason key
 *  has no sentence) — a raw key is never announced. */
function announcementFor(
  status: string,
  costMicroUsd: bigint | number,
  stoppedReason: string | null,
): string {
  switch (status) {
    case 'running':
      return RUN_ANNOUNCE_STARTED;
    case 'complete':
      return RUN_ANNOUNCE_COMPLETE(costMicroUsd);
    case 'partial':
      return isStoppedReason(stoppedReason) ? RUN_ANNOUNCE_STOPPED(stoppedReason) : '';
    case 'refused':
      return RUN_ANNOUNCE_REFUSED;
    case 'failed':
      return RUN_ANNOUNCE_FAILED;
    default:
      return '';
  }
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function RunAutoRefresh({
  status,
  renderedAtMs,
  truncatedCount,
  costMicroUsd,
  stoppedReason,
}: {
  /** `runs.status`. Live while `queued` or `running`. */
  status: string;
  /** `Date.now()` on the server at render time. A change is how a refresh proves it landed. */
  renderedAtMs: number;
  /** Tiles still truncated. Its first move above zero is announced once. */
  truncatedCount: number;
  /** The run's cost, µUSD — for the "Run complete — $x" announcement only. */
  costMicroUsd: bigint | number;
  /** `runs.stopped_reason`, a machine key — for the "Run stopped early — …" announcement. */
  stoppedReason: string | null;
}) {
  const router = useRouter();
  const live = LIVE_STATUSES.has(status);

  const [visible, setVisible] = useState(pageVisible);
  /** Bumped by every refresh; re-arms the cadence timer 5 s after the latest one. */
  const [cycle, setCycle] = useState(0);
  /** When the oldest still-unanswered refresh was sent. Null when nothing is outstanding. */
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  /** When the refresh that timed out was sent. Null while refreshes are landing. */
  const [failedAt, setFailedAt] = useState<number | null>(null);
  /** "Refresh now" was pressed and its render has not landed yet. */
  const [manualPending, setManualPending] = useState(false);

  // --- Render-derived transitions (React's "adjust state when a prop changes" pattern) -----
  const [seenRenderedAt, setSeenRenderedAt] = useState(renderedAtMs);
  const [seenStatus, setSeenStatus] = useState(status);
  const [seenTruncated, setSeenTruncated] = useState(truncatedCount);
  const [truncationAnnounced, setTruncationAnnounced] = useState(truncatedCount > 0);
  const [announcement, setAnnouncement] = useState('');

  if (seenRenderedAt !== renderedAtMs) {
    // A refresh landed: the watchdog stands down and the failed line goes.
    setSeenRenderedAt(renderedAtMs);
    setPendingSince(null);
    setFailedAt(null);
    setManualPending(false);
  }

  if (seenStatus !== status || seenTruncated !== truncatedCount) {
    const parts: string[] = [];
    if (seenStatus !== status) {
      const said = announcementFor(status, costMicroUsd, stoppedReason);
      if (said) parts.push(said);
    }
    const firstTruncation = !truncationAnnounced && seenTruncated === 0 && truncatedCount > 0;
    if (firstTruncation) {
      parts.push(RUN_ANNOUNCE_TRUNCATED(truncatedCount));
      setTruncationAnnounced(true);
    }
    setSeenStatus(status);
    setSeenTruncated(truncatedCount);
    if (parts.length > 0) setAnnouncement(parts.join('. '));
  }

  const refreshNow = useCallback(() => {
    const at = Date.now();
    setCycle((c) => c + 1);
    setPendingSince((prev) => prev ?? at);
    try {
      router.refresh();
    } catch {
      // A refresh that throws is a failed refresh: the previous numbers stay, the line says so,
      // and the next tick tries again.
      setFailedAt(at);
      setPendingSince(null);
      setManualPending(false);
    }
  }, [router]);

  // The cadence: one timeout, re-armed after every refresh, only while live and visible.
  useEffect(() => {
    if (!live || !visible) return;
    const timer = setTimeout(refreshNow, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [live, visible, cycle, refreshNow]);

  // The watchdog: armed by the first unanswered refresh, cleared by a landed render (which
  // nulls `pendingSince`), by a terminal status and by unmount.
  useEffect(() => {
    if (!live || pendingSince === null) return;
    const timer = setTimeout(() => {
      setFailedAt(pendingSince);
      setPendingSince(null);
      setManualPending(false);
    }, REFRESH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [live, pendingSince]);

  // Pause while hidden; refresh immediately on return.
  useEffect(() => {
    function onVisibilityChange() {
      const nowVisible = document.visibilityState !== 'hidden';
      setVisible(nowVisible);
      if (nowVisible && live) refreshNow();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [live, refreshNow]);

  const failed = failedAt !== null;

  return (
    <>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            data-testid="run-updated-at"
            data-state={failed ? 'failed' : 'live'}
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {failed
              ? RUN_REPORT_REFRESH_FAILED(clock(failedAt), clock(renderedAtMs))
              : RUN_REPORT_LIVE_LINE(clock(renderedAtMs))}
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="run-refresh-now"
            data-state={manualPending ? 'refreshing' : 'idle'}
            aria-busy={manualPending ? true : undefined}
            onClick={() => {
              setManualPending(true);
              refreshNow();
            }}
            className="h-11 text-base"
          >
            {/* Both labels share one grid cell; the one not showing is `invisible`, so it still
                takes space and the button keeps the wider label's width in both states. */}
            <span className="grid">
              <span
                data-testid="run-refresh-now-idle"
                aria-hidden={manualPending ? true : undefined}
                className={cn(
                  'col-start-1 row-start-1 flex items-center justify-center gap-2',
                  manualPending && 'invisible',
                )}
              >
                {RUN_REPORT_REFRESH_NOW}
              </span>
              <span
                data-testid="run-refresh-now-busy"
                aria-hidden={manualPending ? undefined : true}
                className={cn(
                  'col-start-1 row-start-1 flex items-center justify-center gap-2',
                  !manualPending && 'invisible',
                )}
              >
                <Spinner aria-hidden="true" className="size-4 motion-reduce:animate-none" />
                {RUN_REPORT_REFRESHING}
              </span>
            </span>
          </Button>
        </div>
      ) : null}
      <div
        data-testid="run-live-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </>
  );
}
