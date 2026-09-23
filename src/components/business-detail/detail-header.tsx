import Link from 'next/link';
import { ClosedBadge } from '@/components/flags/closed-badge';
import { ChainBadge, MergedAwayBadge } from '@/components/flags/flag-badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatLocal } from '@/lib/time';
import { FLAG_CLOSED, LEAD_KEY_LABEL, MERGE_ROW } from '@/lib/ui/copy';
import type { BusinessStatusView } from '@/server/queries/businesses';
import { CopyLeadKeyButton } from './copy-lead-key';

/**
 * The header card of `/businesses/[id]` (03-UI-SPEC § 4, section 1).
 *
 * Focal point: `display_name`, Heading 20/600, VERBATIM — accents intact, never the
 * normalized match key (D-12, Executor Rule 17).
 *
 * 🔴 THE LEAD KEY IS THE ONLY ACCENT ON THIS SCREEN (§ Color, accent list item 9). It is the
 * number that *is* the product here — the string danlo reads aloud on a call and types into a
 * CSV filter — the same justification the Phase 2 dollar figure rests on. It is accent TEXT,
 * not an action, so it does not break "one accent action per screen". It is display-only:
 * never a route parameter, never a foreign key (D-19).
 *
 * Status badges — each only when set — sit to the right on desk and wrap beneath on phone:
 * `Closed {date}` on the destructive surface (a closed business is a hard stop; calling one
 * is this product's most embarrassing failure), `Chain · {n} in Texas` / `… in the RGV`
 * outline (a chain is a fact, not a fault — D-11), `Merged away` secondary. Colour is never the
 * only signal: every badge carries its word. All three share `FLAG_BADGE_SIZING` (14/600) —
 * the Badge default 12/500 is below the type scale (C-WR-03).
 *
 * A server component; the copy button is the one client island.
 */
export function DetailHeader({
  displayName,
  leadKey,
  status,
  closedAt,
  chain,
  mergedInto,
}: {
  displayName: string;
  leadKey: string;
  status: BusinessStatusView;
  closedAt: Date | null;
  /** The chain flag's facts; `ChainBadge` words it through the one formatter (C-WR-02). */
  chain: { members: number; statewide: boolean } | null;
  mergedInto: { id: string; displayName: string } | null;
}) {
  const closed = closedAt !== null;
  const mergedAway = status === 'merged_away';
  const hasBadges = closed || chain !== null || mergedAway;

  return (
    <Card data-testid="business-header">
      <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            data-testid="business-display-name"
            className="text-xl font-semibold leading-tight break-words"
          >
            {displayName}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-normal">
              <span className="text-muted-foreground">{LEAD_KEY_LABEL}</span>{' '}
              <span
                data-testid="business-lead-key"
                className="font-semibold tabular-nums text-primary select-all"
              >
                {leadKey}
              </span>
            </p>
            <CopyLeadKeyButton leadKey={leadKey} />
          </div>

          {/* A merged-away record says where it went, as an inline text link to the survivor
              — the lead key still resolves there, so this is where the reader wants to be. */}
          {mergedAway && mergedInto ? (
            <p data-testid="business-merged-into" className="text-sm font-normal text-muted-foreground">
              <Link
                href={`/businesses/${mergedInto.id}`}
                className="text-primary underline underline-offset-4"
              >
                {MERGE_ROW(displayName, mergedInto.displayName)}
              </Link>
            </p>
          ) : null}
        </div>

        {hasBadges ? (
          <div data-testid="business-status-badges" className="flex flex-wrap items-center gap-2">
            {closed ? (
              <ClosedBadge
                data-testid="business-badge-closed"
                label={FLAG_CLOSED(formatLocal(closedAt, { month: 'short', day: 'numeric', year: 'numeric' }))}
              />
            ) : null}
            {chain !== null ? <ChainBadge data-testid="business-badge-chain" chain={chain} /> : null}
            {mergedAway ? <MergedAwayBadge data-testid="business-badge-merged-away" /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
