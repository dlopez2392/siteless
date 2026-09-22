import { ChevronDown, OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { periodResetInstant } from '@/lib/budget/period';
import { formatLocal } from '@/lib/time';
import { BUDGET_100_BANNER, BUDGET_80_BANNER } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { BudgetPeriodRow } from '@/server/queries/budget';

/**
 * D-12's money states: the only place in Siteless where the meter reaches danlo before
 * he asks for it.
 *
 * 🔴 A SERVER COMPONENT, FED BY THE LAYOUT'S SINGLE READ. `src/app/(app)/layout.tsx`
 * calls `getCurrentPeriod` once per request and hands the row down. This banner never
 * queries: one read per request, not one per banner, and — because it is server-rendered
 * — it is on screen at first paint and survives a client-side crash. A threshold the UI
 * can fail to show is a threshold that does not exist.
 *
 * 🔴 NOT REMOVABLE BY THE READER, AND NOT A TRANSIENT NOTIFICATION (D-12). There is no
 * close affordance and no `sonner` call on this path. UI-SPEC reserves the transient kind
 * for reversible successes; one that has been cleared is indistinguishable from one that
 * never fired, which is the wrong property for a standing condition about money.
 *
 * 🔴 COLOUR IS NEVER THE ONLY SIGNAL. Each state ships an icon, a word, and the figures
 * spelled out — `triangle-alert` at 80%, `octagon-x` at 100%.
 *
 * 🔴 THE ZONE IN THE PROSE AND THE ZONE IN THE ARITHMETIC ARE THE SAME ONE. The 100%
 * sentence ends "... at 12:00 AM America/Chicago" (the literal lives in
 * `src/lib/ui/copy.ts`), and the date interpolated into it is produced here by
 * `formatLocal`, which resolves `APP_TZ` from `src/lib/time.ts` — the only file in `src/`
 * that names a zone for a machine. There are THREE monthlies in this product — Siteless's
 * Chicago budget period, Google's US/Pacific daily quota reset, and Google's billing
 * month — and no copy may imply they coincide.
 */

/**
 * UI-SPEC § States → Threshold renders the banner in two type tiers: a Body 16/600 first
 * line and a Label 14/400 detail. The copy constants are single sentences-plus-remainder,
 * so the split is taken at the first sentence boundary rather than by retyping any of it
 * — `lede + ' ' + detail` reassembles the constant exactly, so no word can be dropped by
 * a copy change upstream.
 */
function splitLede(text: string): { lede: string; detail: string } {
  const at = text.indexOf('. ');
  if (at === -1) return { lede: text, detail: '' };
  return { lede: text.slice(0, at + 1), detail: text.slice(at + 2) };
}

/** Inline text link inside body copy — accent, per § Color's accent list item 6. The 44px
 *  floor is MOB-01: these are the banner's only actions and they are tapped on a phone. */
const ACTION_LINK =
  'inline-flex h-11 items-center text-sm font-normal text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** First mount only, 200ms, and under reduced motion the animation is dropped while the
 *  banner still renders — the recorded 956 Woodworks defect was a reduced-motion rule
 *  that blanked the content instead of the movement. The shell's layout persists across
 *  navigations, so React reconciles this node rather than remounting it and it does not
 *  re-animate when you move between routes. */
const BANNER_MOTION =
  'animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none';

export function BudgetBanner({
  period,
  isAdmin,
}: {
  period: BudgetPeriodRow;
  isAdmin: boolean;
}) {
  const cap = period.capMicroUsd;
  const committed = period.spentMicroUsd + period.reservedMicroUsd;

  /**
   * 🔴 THE TWO TIERS ARE COMPARED THE WAY THE SQL COMPARES THEM: as a cross-multiplied
   * integer product, never as a percentage computed by division. `app.reserve_budget`
   * refuses at `spent + reserved > cap`, and a TypeScript tier that divided first would
   * round somewhere the database does not — so the banner would claim "nothing is blocked
   * yet" on a request the meter had already refused. A zero cap cannot be set through
   * `app.set_budget_cap` but the column permits one, and every division by it throws, so
   * it is answered before any arithmetic happens.
   */
  const at100 = cap <= 0n ? committed > 0n : committed >= cap;
  const at80 = cap <= 0n ? committed > 0n : committed * 100n >= cap * 80n;

  // Under 80% there is no banner at all — no empty slot, no placeholder, nothing that
  // reserves height. The gauge on /spend is where the under-threshold reading lives.
  if (!at80) return null;

  if (at100) {
    const resetDate = formatLocal(periodResetInstant(period.periodStart), {
      month: 'short',
      day: 'numeric',
    });
    const { lede, detail } = splitLede(BUDGET_100_BANNER(cap, resetDate));
    return (
      <Alert
        role="alert"
        data-testid="budget-banner-100"
        className={cn(
          'rounded-none border-x-0 border-t-0 border-destructive/40',
          'bg-destructive-surface text-destructive-surface-foreground',
          BANNER_MOTION,
        )}
      >
        <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
        <AlertTitle className="text-base font-semibold text-balance">{lede}</AlertTitle>
        <AlertDescription className="text-inherit">
          <p className="text-sm font-normal">{detail}</p>
          <div className="flex flex-wrap items-center gap-4">
            {isAdmin ? (
              <Link href="/settings/budget" data-testid="budget-banner-raise-cap" className={ACTION_LINK}>
                Raise the monthly cap
              </Link>
            ) : (
              <Link
                href="/settings/organization"
                data-testid="budget-banner-ask-admin"
                className={ACTION_LINK}
              >
                Ask an admin to raise the cap
              </Link>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const { lede, detail } = splitLede(BUDGET_80_BANNER(committed, cap));
  return (
    <Alert
      role="status"
      data-testid="budget-banner-80"
      className={cn(
        'rounded-none border-x-0 border-t-0 border-warning/40',
        'bg-warning-surface text-warning-surface-foreground',
        BANNER_MOTION,
      )}
    >
      <TriangleAlert data-icon="triangle-alert" aria-hidden="true" className="size-5" />
      <AlertTitle className="text-base font-semibold text-balance">{lede}</AlertTitle>
      <AlertDescription className="text-inherit">
        {/* On a phone the warning collapses to its first line plus a chevron; from 640px
            up it is always open. `forceMount` keeps the detail in the DOM either way, so
            the wider viewport can reveal it with CSS alone and the closed state is a
            presentation choice rather than missing content. */}
        <Collapsible className="w-full">
          <CollapsibleContent
            forceMount
            className="data-[state=closed]:hidden sm:data-[state=closed]:block"
          >
            <p className="text-sm font-normal">{detail}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/spend" data-testid="budget-banner-see-spend" className={ACTION_LINK}>
                See spend by provider
              </Link>
              {isAdmin ? (
                <Link
                  href="/settings/budget"
                  data-testid="budget-banner-raise-cap"
                  className={ACTION_LINK}
                >
                  Raise the monthly cap
                </Link>
              ) : null}
            </div>
          </CollapsibleContent>
          <CollapsibleTrigger
            data-testid="budget-banner-expand"
            className="inline-flex h-11 items-center gap-1 text-sm font-normal underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden [&[data-state=open]>svg]:rotate-180"
          >
            What this means
            <ChevronDown data-icon="chevron-down" aria-hidden="true" className="size-4 transition-transform" />
          </CollapsibleTrigger>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}
