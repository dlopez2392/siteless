import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUsd } from '@/lib/budget/money';
import { formatLocal } from '@/lib/time';
import type { PresetCard as PresetCardData } from '@/server/queries/preset-cards';

/**
 * UI-SPEC § Screen Inventory 1 — the card's five-line anatomy, top to bottom:
 *
 *   Hidalgo — home services                                     <- Heading 20/600
 *   Home services & trades · Auto & retail                      <- Label 14/400 muted
 *   County · Hidalgo                                            <- Label 14/400 muted
 *   ──────────────────────────────────────────────  Separator
 *   Version 3     Last run Sep 18, 2:14 PM     Est. ~$2.40      <- 14/600 · 14/400 · 16/600
 *
 * 🔴 NO CLIENT DIRECTIVE. This renders inside a server component and every value it shows
 * arrives as a prop, so there is no client reference to resolve to `undefined` at runtime
 * (UI-SPEC Executor Rule 5, two recorded BIS 500s).
 *
 * 🔴 THE WHOLE CARD IS THE LINK and there are no icon-only actions on it. One target, one
 * destination, and nothing on a phone that needs a 24px tap inside a 24px icon.
 *
 * 🔴 NO `Intl` CALL IN THIS DIRECTORY. Money goes through `formatUsd` and the timestamp
 * through `formatLocal`, which pin the locale AND the zone. `Intl` formats in the SYSTEM
 * zone otherwise, so the same run renders a different day on Vercel (UTC) than it does on a
 * Chicago laptop, and an unpinned locale is a recorded BIS SSR hydration mismatch.
 */

/** UI-SPEC § Copy Table → "Last run {date}" / "Never run". */
function lastRunLabel(lastRunAt: Date | null): string {
  if (lastRunAt === null) return 'Never run';
  return `Last run ${formatLocal(lastRunAt, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function PresetCard({ preset }: { preset: PresetCardData }) {
  return (
    <Link
      href={`/presets/${preset.id}`}
      data-testid={`preset-card-${preset.id}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full transition-colors hover:border-ring/40">
        <CardContent className="flex flex-col gap-2 p-4 lg:p-6">
          <h2 className="text-xl font-semibold leading-tight">{preset.displayName}</h2>

          <p className="text-sm font-normal text-muted-foreground">
            {preset.clusterNames.length > 0
              ? preset.clusterNames.join(' · ')
              : 'No clusters saved'}
          </p>
          <p className="text-sm font-normal text-muted-foreground">{preset.geographyLabel}</p>

          <Separator className="my-2" />

          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-semibold tabular-nums">
              {preset.version === null ? 'No version saved' : `Version ${preset.version}`}
            </span>
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {lastRunLabel(preset.lastRunAt)}
            </span>
            {/* 🔴 A MISSING ESTIMATE IS NOT `$0.00`. An early-month preset inside the free
                allowance genuinely costs $0.00 (02-07), so rendering that for "we have no
                snapshot" would be a quote nobody made. */}
            <span className="text-base font-semibold tabular-nums">
              {preset.estimateMicroUsdHi === null
                ? 'No estimate saved'
                : `Est. ~${formatUsd(preset.estimateMicroUsdHi)}`}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * UI-SPEC § States → Loading: "3 Skeleton cards matching the real card's height and internal
 * rhythm (title bar 20px, two meta lines 14px, separator, footer row). Never a centred
 * spinner on a full page."
 *
 * It lives beside the real card deliberately — a skeleton in another file drifts out of
 * agreement with the thing it is standing in for, and then the page jumps on load.
 */
export function PresetCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-2 p-4 lg:p-6">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Separator className="my-2" />
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}
