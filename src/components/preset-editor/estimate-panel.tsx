'use client';

import { CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { formatPct, formatUsd } from '@/lib/budget/money';
import type { EstimateRange } from '@/lib/estimate/estimate';
import { APP_LOCALE } from '@/lib/time';
import { AssumptionsSurface } from './assumptions-surface';

/**
 * THE FOCAL POINT OF THE EDITOR, and the loudest thing on the screen. D-06's line is what
 * makes the cap legible before a cent is spent.
 *
 * ── 🔴 THIS NUMBER NEVER BLANKS ──────────────────────────────────────────────────────────
 *
 * While a new estimate computes, the previous values STAY on screen at 60 % opacity with an
 * inline spinner beside the dollar figure and `aria-busy="true"` on the region. Never a
 * skeleton, never an empty box. A number that disappears while you type is the single worst
 * thing this screen could do — it is the moment a user stops believing the figure at all
 * (UI-SPEC Executor Rule 11, § States → Loading).
 *
 * ── 🔴 EVERY FIGURE COMES FROM THE ACTION, NONE FROM THIS FILE ───────────────────────────
 *
 * Executor Rule 16: the numbers in UI-SPEC show the FORMAT, not the arithmetic. The dollar
 * value already has the month's free allowance applied, so an early-month preset genuinely
 * reads $0.00 and that is correct rather than broken; the Texas chip carries a computed
 * multiplier; and the percentage is of what is LEFT this month, not of the cap.
 *
 * ── WHY THE HEADLINE IS THE HIGH END ─────────────────────────────────────────────────────
 *
 * `queueRun` reserves `costMicroUsdHi` against the meter, so the high end is the figure the
 * budget will actually be asked for. Leading with the low end would quote a number smaller
 * than the one the cap is tested against — under-quoting in the one direction that matters.
 * Both ends are on the range line directly beneath.
 */

const counts = new Intl.NumberFormat(APP_LOCALE);

/** UI-SPEC § States → Empty, the "Clusters, none selected" row. Inline, not a full empty
 *  state, and deliberately not a zero: `$0.00` is a real and very different answer. */
export const NO_CLUSTER_PROMPT = 'Pick at least one cluster to see an estimate.';

/** Clusters chosen, geography not yet. */
export const NO_GEOGRAPHY_PROMPT = 'Pick a geography to see an estimate.';

export function EstimatePanel({
  estimate,
  error,
  busy,
  hasClusters,
  hasSpec,
  texasMultiplier,
}: {
  estimate: EstimateRange | null;
  error: string | null;
  busy: boolean;
  hasClusters: boolean;
  hasSpec: boolean;
  /** Non-null only when the chosen geography is the built-in Texas row. */
  texasMultiplier: number | null;
}) {
  const prompt = !hasClusters ? NO_CLUSTER_PROMPT : hasSpec ? null : NO_GEOGRAPHY_PROMPT;

  return (
    <section
      data-testid="preset-editor-estimate"
      aria-live="polite"
      aria-busy={busy}
      aria-label="Estimated cost of this preset"
      className="flex flex-col gap-1"
    >
      {estimate === null ? (
        <p className="text-sm font-normal text-muted-foreground">
          {prompt ?? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-4" aria-hidden="true" />
              Estimating this preset…
            </span>
          )}
        </p>
      ) : (
        <div
          className={
            'flex flex-col gap-1 transition-[opacity,transform] duration-150 ' +
            'motion-reduce:duration-0 motion-reduce:transform-none ' +
            (busy ? 'opacity-60 translate-y-0.5' : 'opacity-100 translate-y-0')
          }
        >
          <p className="flex items-center gap-2">
            <span
              data-testid="preset-editor-estimate-dollars"
              className="text-[28px] font-semibold leading-tight tabular-nums text-primary"
            >
              ~{formatUsd(estimate.costMicroUsdHi)}
            </span>
            {busy ? <Spinner className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
          </p>

          {texasMultiplier === null ? null : (
            <p>
              <Badge
                data-testid="preset-editor-estimate-texas"
                className="bg-warning-surface text-warning-surface-foreground tabular-nums"
              >
                ×{texasMultiplier.toFixed(1)} vs RGV
              </Badge>
            </p>
          )}

          <p className="text-sm font-normal tabular-nums text-muted-foreground">
            ~{counts.format(estimate.requestsHi)} requests · ~
            {counts.format(estimate.expectedResults)} businesses
          </p>

          <p className="text-sm font-normal tabular-nums text-muted-foreground">
            {formatPct(estimate.pctOfRemainingHi / 100)} of this month&apos;s remaining{' '}
            {formatUsd(estimate.remainingMicroUsd)}
          </p>

          <p className="text-sm font-normal tabular-nums text-muted-foreground">
            Range {formatUsd(estimate.costMicroUsdLo)}–{formatUsd(estimate.costMicroUsdHi)} ·{' '}
            {counts.format(estimate.requestsLo)}–{counts.format(estimate.requestsHi)} requests
          </p>
        </div>
      )}

      {/* A refusal is a reason the NEW selection has no price. The previous range above it
          stays exactly where it was — Rule 11 again. */}
      {error === null ? null : (
        <p
          data-testid="preset-editor-estimate-error"
          className="flex items-start gap-2 text-sm font-normal text-destructive"
        >
          <CircleAlert
            data-icon="circle-alert"
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </p>
      )}

      <AssumptionsSurface assumptions={estimate?.assumptions ?? null} />
    </section>
  );
}
