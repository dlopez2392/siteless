import { RunAutoRefresh } from '@/components/runs/run-auto-refresh';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatUsd } from '@/lib/budget/money';
import { RUN_CEILING_MULTIPLIER } from '@/lib/estimate/assumptions';
import { formatLocal } from '@/lib/time';
import {
  RUN_ABOVE_ESTIMATE,
  RUN_CHANGE_CHECK_COST_NOTE,
  RUN_ESTIMATE_LINE,
  RUN_REPORT_FINISHED_LINE,
  RUN_REPORT_STARTED,
  RUN_SUMMARY_COMPLETE,
  RUN_SUMMARY_FAILED,
  RUN_SUMMARY_PARTIAL,
  RUN_SUMMARY_QUEUED,
  RUN_SUMMARY_REFUSED,
  RUN_SUMMARY_RUNNING,
} from '@/lib/ui/copy';
import { RUN_KIND_LABEL } from '@/lib/ui/run-tone';
import type { RunReport } from '@/server/queries/run-report';

/**
 * The run report's header card (04-UI-SPEC § Screen 1 → Header card; D-17, D-18). The focal
 * block: the status badge and its one-line summary, then the run's actual cost at Display
 * 28/600, then the estimate and the ceiling it is measured against.
 *
 * 🔴 NO CLIENT-BOUNDARY DIRECTIVE. A server component; the one client island is
 * `RunAutoRefresh`, which receives plain serializable props.
 *
 * 🔴 `RunAutoRefresh` IS MOUNTED IN EVERY STATUS (04-14 handoff). It hides its own live line and
 * "Refresh now" once the run is terminal, but its polite `run-live-status` region must survive
 * the transition, or "Run complete — $x" unmounts at the very moment it should be announced.
 * The "Finished …" line renders NEXT to it, never instead of it.
 *
 * 🔴 THE COST IS FOREGROUND, NOT ACCENT (§ Color: Accent does not appear on "the run cost
 * figure"). Size makes it read first; `text-primary` would spend the one accent on a number.
 *
 * 🔴 THE CEILING IS COMPUTED, NEVER TYPED (inherited Executor Rule 16). The dollar ceiling is
 * `RUN_CEILING_MULTIPLIER × estimate-high`; the request ceiling is `runs.ceiling_requests`, the
 * figure the executor actually enforces (D-18). Both are shown, because inside the free
 * allowance the dollar ceiling alone reads "stops at $0.00".
 */

/** Display 28/600 — the class `period-header.tsx` uses for the other money the product spent. */
const DISPLAY_28 = 'text-[28px] font-semibold leading-[34px]';

const LIVE: ReadonlySet<string> = new Set(['queued', 'running']);

/** "Sep 23, 2:14 PM" in the app's zone — the started line, the finished line, the breadcrumb. */
export function runInstantLabel(ms: number): string {
  return formatLocal(new Date(ms), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Wall-clock duration, "17m 04s" (§ Copy Table → Finished line). Seconds are zero-padded under
 * a minute count so the column does not jitter between "17m 4s" and "17m 14s".
 */
export function runDurationLabel(fromMs: number, toMs: number): string {
  const seconds = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** The dollar ceiling in µUSD, or null when the run carries no estimate. */
export function ceilingMicroUsdOf(run: RunReport['run']): number | null {
  return run.estimateMicroUsdHi === null ? null : RUN_CEILING_MULTIPLIER * run.estimateMicroUsdHi;
}

function summaryLine(run: RunReport['run'], tiles: RunReport['tiles']): string {
  const end = run.finishedMs ?? run.startedMs ?? run.createdMs;
  switch (run.status) {
    case 'queued':
      return RUN_SUMMARY_QUEUED;
    case 'running':
      return RUN_SUMMARY_RUNNING(tiles.searched, tiles.total);
    case 'complete':
      return RUN_SUMMARY_COMPLETE(
        tiles.total,
        runDurationLabel(run.startedMs ?? run.createdMs, end),
      );
    case 'partial':
      return RUN_SUMMARY_PARTIAL(tiles.searched, tiles.total);
    case 'refused':
      return RUN_SUMMARY_REFUSED;
    case 'failed':
      return RUN_SUMMARY_FAILED(run.callsCount);
  }
}

export function RunHeader({
  run,
  tiles,
  renderedAtMs,
}: {
  run: RunReport['run'];
  tiles: RunReport['tiles'];
  /** `Date.now()` on the server at render time — the refresh island's proof of a new render. */
  renderedAtMs: number;
}) {
  const live = LIVE.has(run.status);
  const ceiling = ceilingMicroUsdOf(run);
  const isChangeCheck = run.kind === 'change_check';

  const showEstimate =
    !isChangeCheck && run.estimateMicroUsdLo !== null && run.estimateMicroUsdHi !== null;
  // Above the top of the estimate but still under the ceiling: a muted note, not a warning —
  // nothing has stopped. At the ceiling the run stops and the stop alert does the talking.
  const aboveEstimate =
    showEstimate &&
    ceiling !== null &&
    run.estimateMicroUsdHi !== null &&
    run.costMicroUsd > run.estimateMicroUsdHi &&
    run.costMicroUsd < ceiling;

  // A refused run has no "Finished …" line (§ States → Running / terminal: Header extras "—").
  const finished =
    !live && run.status !== 'refused' && run.finishedMs !== null && run.startedMs !== null
      ? RUN_REPORT_FINISHED_LINE(
          runInstantLabel(run.finishedMs),
          runDurationLabel(run.startedMs, run.finishedMs),
        )
      : null;

  return (
    // 16px inner padding on phone, 24px on desk (§ Spacing): the primitive pads by
    // `--card-spacing`, so the variable moves rather than a `p-*` racing the primitive's own.
    <Card data-testid="run-report-header" className="sm:[--card-spacing:--spacing(6)]">
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run.status} />
          <span
            data-testid="run-kind"
            data-kind={run.kind}
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {RUN_KIND_LABEL[run.kind]}
            {run.startedMs !== null
              ? ` · ${RUN_REPORT_STARTED(runInstantLabel(run.startedMs))}`
              : ''}
          </span>
        </div>

        <p data-testid="run-status-line" className="text-base font-semibold tabular-nums">
          {summaryLine(run, tiles)}
        </p>

        <p
          data-testid="run-cost"
          data-micro-usd={run.costMicroUsd}
          className={`${DISPLAY_28} text-foreground tabular-nums`}
        >
          {formatUsd(run.costMicroUsd)}
        </p>

        {showEstimate && ceiling !== null ? (
          <p
            data-testid="run-estimate-line"
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {RUN_ESTIMATE_LINE(
              run.estimateMicroUsdLo ?? 0,
              run.estimateMicroUsdHi ?? 0,
              ceiling,
              run.ceilingRequests,
            )}
          </p>
        ) : null}

        {aboveEstimate && ceiling !== null && run.estimateMicroUsdHi !== null ? (
          <p
            data-testid="run-above-estimate"
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {RUN_ABOVE_ESTIMATE(run.costMicroUsd - run.estimateMicroUsdHi, ceiling)}
          </p>
        ) : null}

        {isChangeCheck ? (
          <p
            data-testid="run-change-check-note"
            className="text-sm font-normal text-muted-foreground"
          >
            {RUN_CHANGE_CHECK_COST_NOTE}
          </p>
        ) : null}

        {finished ? (
          <p
            data-testid="run-finished-line"
            className="text-sm font-normal text-muted-foreground tabular-nums"
          >
            {finished}
          </p>
        ) : null}

        <RunAutoRefresh
          status={run.status}
          renderedAtMs={renderedAtMs}
          truncatedCount={tiles.stillTruncated}
          costMicroUsd={run.costMicroUsd}
          stoppedReason={run.stoppedReason}
        />
      </CardContent>
    </Card>
  );
}
