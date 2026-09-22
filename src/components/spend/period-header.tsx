import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BudgetGauge } from '@/components/spend/budget-gauge';
import { formatUsd } from '@/lib/budget/money';
import { periodLabel, periodResetInstant } from '@/lib/budget/period';
import { APP_TZ, formatLocal } from '@/lib/time';
import { periodWindow, type BudgetPeriodRow } from '@/server/queries/budget';

/**
 * The spend view's header card: the five stacked elements UI-SPEC § Screen Inventory 5
 * fixes, in that order, at both sizes. This screen does not change shape between phone
 * and desk.
 *
 * 🔴 THE ZONE IS NAMED ON SCREEN BECAUSE IT HAS MONEY CONSEQUENCES. Three different things
 * in this product are called "monthly" — Siteless's budget period (America/Chicago),
 * Google's daily quota reset (US/Pacific) and Google's billing month — and no copy in this
 * project may imply they coincide. The label comes from `APP_TZ`, the only place in `src/`
 * that names a zone, so the words on the card and the arithmetic under it are the same
 * fact rather than two that happen to agree today.
 *
 * 🔴 THE MONTH LABEL IS DERIVED FROM THE PERIOD ROW, NOT FROM `new Date()`. The row's
 * `period_start` is a 'YYYY-MM-01' string and `periodWindow(...).from` is local midnight
 * on the 1st of that month — so a request served at 00:30 UTC on the 1st of October reads
 * "September 2026" if the RGV is still in September, which is the month the meter is
 * actually metering. Formatting `now` would print the server's month instead.
 *
 * 🔴 THE FIGURE IS `spent + reserved`, THE SAME NUMBER THE BANNER CALLS "USED". The
 * banner in the shell says "You've used $40.12 of your $50.00 cap"; a spend view that put
 * a different number under the same heading, in the same month, would be the drift this
 * phase is built to prevent. Reservations are money the meter has already committed and
 * will refuse to re-commit, so they belong above the gauge, not hidden behind it. The
 * By provider tab below reports the SETTLED ledger, which is a narrower and separately
 * labelled fact; the one-line note below reconciles them whenever a reservation is open.
 */

/** UI-SPEC § Typography: Display 28/600 is reserved for the numbers that ARE the product,
 *  and there are exactly three places in the whole phase. No custom size utility is
 *  declared for it in `globals.css` — it is deliberately not a fifth step on the scale. */
const DISPLAY_28 = 'text-[28px] font-semibold leading-[34px]';

export function PeriodHeader({
  period,
  figureTestId,
  gaugeTestId,
}: {
  period: BudgetPeriodRow;
  /** Passed in rather than hard-coded: the screen owns its e2e contract, and the same
   *  reasoning keeps `BudgetGauge`'s hook a prop. */
  figureTestId: string;
  gaugeTestId: string;
}) {
  const cap = period.capMicroUsd;
  const committed = period.spentMicroUsd + period.reservedMicroUsd;
  // `bp_not_over` makes committed > cap unreachable, but a clamp costs nothing and a
  // negative "left" would be a worse thing to print than a zero.
  const left = cap > committed ? cap - committed : 0n;

  const monthLabel = periodLabel(periodWindow(period.periodStart).from);
  const reset = periodResetInstant(period.periodStart);
  const resetDate = formatLocal(reset, { month: 'short', day: 'numeric' });
  const resetTime = formatLocal(reset, { hour: 'numeric', minute: '2-digit' });

  return (
    <Card data-testid="spend-period-header">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-normal text-muted-foreground">
            {monthLabel} · {APP_TZ}
          </p>

          {/* Accent on a number, allowed here and in exactly two other places in the
              product (UI-SPEC § Accent reserved for, item 4). */}
          <p
            data-testid={figureTestId}
            className={`${DISPLAY_28} tabular-nums text-primary`}
          >
            {formatUsd(committed)}
          </p>

          <p className="text-base font-normal">
            of {formatUsd(cap)} — {formatUsd(left)} left
          </p>
        </div>

        <BudgetGauge capMicroUsd={cap} committedMicroUsd={committed} testId={gaugeTestId} />

        {/* Only when there is something to reconcile. In Phase 2 nothing reserves budget
            yet — the verifier ships in Phase 4 — so this line is normally absent rather
            than sitting there reading "$0.00 reserved", which would be noise pretending
            to be information. */}
        {period.reservedMicroUsd > 0n ? (
          <p
            data-testid="spend-reserved-note"
            className="text-sm font-normal text-muted-foreground"
          >
            Includes {formatUsd(period.reservedMicroUsd)} reserved by runs in flight and not
            yet settled, so it is not in the ledger totals below.
          </p>
        ) : null}

        <p className="text-sm font-normal text-muted-foreground">
          Resets {resetDate} at {resetTime}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * UI-SPEC § States → Loading: "Header-card skeleton with a 28px block where the figure
 * goes + an 8px gauge track". Never a centred full-page spinner — the shell and the
 * heading are server-rendered and on screen before this ever appears.
 */
export function PeriodHeaderSkeleton() {
  return (
    <Card data-testid="spend-period-header-skeleton">
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-[28px] w-32" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-5 w-40" />
      </CardContent>
    </Card>
  );
}
