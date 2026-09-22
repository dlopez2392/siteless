import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * The budget gauge. One component, two screens: the spend view's header card and the
 * budget settings Current period card (UI-SPEC § Screen Inventory 4 and 5).
 *
 * 🔴 NO CHART LIBRARY ENTERS THE BUNDLE IN THIS PHASE. This is a shadcn `Progress` with
 * its indicator repainted, and the per-provider share bars beside it are painted divs — a
 * 500 kB dependency to draw one rectangle is not a trade, and the spend/false-positive
 * dashboard that might one day justify one is Phase 9's. The criterion that enforces this
 * is a BARE TOKEN GREP over `src/` and `package.json`, so this comment deliberately does
 * not spell the library's name: a file inside a guarded tree must not write the string the
 * guard hunts for, or the guard reports its own warning as the violation. `src/lib/time.ts`
 * and `src/lib/ui/run-tone.ts` use the same arrangement for the zone and the client
 * directive respectively.
 *
 * 🔴 THE THRESHOLDS ARE CROSS-MULTIPLIED bigint COMPARISONS, NEVER A DIVIDED PERCENTAGE.
 * `app.reserve_budget` refuses at `spent + reserved > cap`, and `budget-banner.tsx`
 * decides the 80% tier with `committed * 100n >= cap * 80n`. A gauge that computed
 * `committed / cap` in floating point and compared to `0.8` would round somewhere neither
 * of the other two does, and the screen would show an accent gauge on a month the banner
 * had already turned amber. Three readings of one meter, and they cannot be allowed to
 * drift — so the arithmetic here is character-for-character the banner's.
 *
 * 🔴 COLOUR IS NEVER THE ONLY SIGNAL (UI-SPEC § Accessibility). The numeric label renders
 * beside the bar unconditionally; there is no variant of this component without it.
 *
 * 🔴 THE LABEL IS TRUNCATED, NOT ROUNDED, AND FOR THE SAME NO-DRIFT REASON. A committed
 * total at 79.96% of the cap rounds to "80.0%" and would sit beside an accent bar, which
 * reads as a bug. Truncating to tenths means the label crosses 80.0 exactly when the tone
 * does. It is also why the tenths come out of `bigint` arithmetic rather than `formatPct`,
 * which takes a float and would reintroduce the rounding this avoids.
 */

export type GaugeTone = 'accent' | 'warning' | 'destructive';

/**
 * 🔴 `cap <= 0` IS ANSWERED BEFORE ANY ARITHMETIC. `app.set_budget_cap` raises `22023` on
 * a non-positive cap so it cannot be reached through the product, but the column permits
 * one — and `bigint` division by zero throws a RangeError rather than yielding Infinity.
 * A 500 on the spend page produced by a valid row would be a real outage, so a zero cap
 * answers "everything committed" when anything is and "nothing" when nothing is, matching
 * `pctUsedOf` in `src/server/queries/budget.ts`.
 */
export function gaugeTone(capMicroUsd: bigint, committedMicroUsd: bigint): GaugeTone {
  if (capMicroUsd <= 0n) return committedMicroUsd > 0n ? 'destructive' : 'accent';
  if (committedMicroUsd >= capMicroUsd) return 'destructive';
  if (committedMicroUsd * 100n >= capMicroUsd * 80n) return 'warning';
  return 'accent';
}

/** Tenths of a percent, 0–1000, truncated. Clamped at the top so a row that somehow held
 *  more than its cap cannot paint a bar wider than its track. */
export function gaugeTenths(capMicroUsd: bigint, committedMicroUsd: bigint): number {
  if (capMicroUsd <= 0n) return committedMicroUsd > 0n ? 1000 : 0;
  if (committedMicroUsd <= 0n) return 0;
  const tenths = (committedMicroUsd * 1000n) / capMicroUsd;
  return Number(tenths > 1000n ? 1000n : tenths);
}

/** "79.9%" — one decimal, matching UI-SPEC § Typography, without touching `Intl`. */
export function formatGaugeLabel(tenths: number): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/**
 * The indicator is repainted through the primitive's own `data-slot`, not by forking the
 * component: one `Progress` in the codebase, three tones on it (UI-SPEC Executor Rule 6).
 *
 * Tailwind v4 arbitrary variants, and every custom property wrapped in `var()` — the bare
 * shorthand v4 dropped emits invalid CSS silently (Executor Rule 1), so it appears nowhere.
 */
const TONE_FILL: Record<GaugeTone, string> = {
  accent: '[&_[data-slot=progress-indicator]]:bg-primary',
  warning: '[&_[data-slot=progress-indicator]]:bg-warning',
  destructive: '[&_[data-slot=progress-indicator]]:bg-destructive',
};

/**
 * 300ms ease-out on a width change (UI-SPEC § Motion), dropped under reduced motion.
 *
 * 🔴 THE ANIMATION IS DISABLED, NEVER THE CONTENT. The indicator's position is an inline
 * transform written by the primitive, so removing the transition changes only how it gets
 * there. There is no code path in which a reduced-motion reader sees an empty gauge — the
 * recorded 956 Woodworks defect was a reduced-motion rule that blanked the thing itself.
 */
const GAUGE_MOTION = cn(
  '[&_[data-slot=progress-indicator]]:duration-300 [&_[data-slot=progress-indicator]]:ease-out',
  'motion-reduce:[&_[data-slot=progress-indicator]]:transition-none',
);

export function BudgetGauge({
  capMicroUsd,
  committedMicroUsd,
  testId,
  className,
}: {
  capMicroUsd: bigint;
  committedMicroUsd: bigint;
  /** The SCREEN owns its e2e contract, so the hook is passed in: this gauge renders on
   *  /spend as `spend-gauge` and on /settings/budget as `budget-period-gauge`, and two
   *  elements sharing one testid is the silent-`.first()` failure 02-10 recorded. */
  testId: string;
  className?: string;
}) {
  const tone = gaugeTone(capMicroUsd, committedMicroUsd);
  const tenths = gaugeTenths(capMicroUsd, committedMicroUsd);
  const label = formatGaugeLabel(tenths);

  return (
    <div data-testid={testId} data-tone={tone} className={cn('flex items-center gap-4', className)}>
      <Progress
        value={tenths / 10}
        aria-label={`${label} of the monthly cap used`}
        className={cn('h-2 w-full bg-muted', TONE_FILL[tone], GAUGE_MOTION)}
      />
      {/* Never optional. UI-SPEC § Color: "The gauge always renders its numeric label
          beside it" — colour on its own is not a reading. */}
      <span
        data-testid={`${testId}-label`}
        className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground"
      >
        {label}
      </span>
    </div>
  );
}
