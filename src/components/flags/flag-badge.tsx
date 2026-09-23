import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatCount } from '@/lib/time';
import { BUSINESS_STATUS, FLAG_CHAIN_LABEL } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';

/**
 * The record-state badges — `Closed`, `Chain`, `Merged away` — at ONE size (C-WR-03).
 *
 * 🔴 WHY. The `Badge` primitive's default is `h-5 text-xs font-medium` (12/500), below the
 * UI-SPEC type scale (badge text is Label 14/600). `ClosedBadge` was created in 03-22 because the
 * detail header had drifted to that default; the header's Chain and Merged away badges then
 * drifted the same way beside it. Every flag badge takes this class list, and
 * `tests/unit/closed-badge.test.tsx` pins it on every call site.
 *
 * No client directive: server and client trees alike.
 */
export const FLAG_BADGE_SIZING = 'h-auto px-2 py-1 text-sm font-semibold tabular-nums';

type BadgeRest = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'>;

/**
 * `Chain · {n} in Texas` / `Chain · {n} in the RGV` (D-11: a fact, not a fault — outline,
 * muted foreground, never accent). The wording comes from the ONE formatter in copy.ts and the
 * count from the pinned-locale `formatCount` (C-WR-02) — the review card and the detail header
 * can no longer disagree about the same business.
 */
export function ChainBadge({
  chain,
  className,
  ...props
}: { chain: { members: number; statewide: boolean } } & BadgeRest) {
  return (
    <Badge
      variant="outline"
      className={cn(FLAG_BADGE_SIZING, 'text-muted-foreground', className)}
      {...props}
    >
      {FLAG_CHAIN_LABEL(chain, formatCount(chain.members))}
    </Badge>
  );
}

/** `Merged away` — the status badge, `secondary` (UI-SPEC § Color). */
export function MergedAwayBadge({ className, ...props }: BadgeRest) {
  return (
    <Badge variant="secondary" className={cn(FLAG_BADGE_SIZING, className)} {...props}>
      {BUSINESS_STATUS.merged_away}
    </Badge>
  );
}
