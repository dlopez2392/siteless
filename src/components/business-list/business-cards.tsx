import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import { formatLocal } from '@/lib/time';
import {
  BUSINESS_STATUS,
  BUSINESSES_FILTER_OPTION,
  FIELD_NO_DURABLE_SOURCE,
  FLAG_CLOSED,
  NO_CLUSTER_MAPPED,
  SOURCE_TAG,
} from '@/lib/ui/copy';
import type { BusinessListRow } from '@/server/queries/businesses';

/**
 * `/businesses` on a phone (<640px) — one card per business, the WHOLE card the link
 * (03-UI-SPEC § 3):
 *
 *   Taquería La Güera                         <- Heading 20/600, display_name VERBATIM
 *   McAllen · Home services & trades          <- Label 14/400 muted
 *   Comptroller · Overture                    <- Label 14/400 muted — source tags are TEXT
 *   [Closed Sep 3, 2026]                      <- only when the status is not Active
 *
 * This module is ALSO the home of the helpers the desk table renders with, so the two
 * breakpoints cannot drift apart on what a status or a source list says.
 *
 * 🔴 NO CLIENT DIRECTIVE. The page renders these cards on the server; `business-table.tsx`
 * (a client module, because it owns the append pager) imports the helpers below. A client
 * module's exports are client REFERENCES inside a server component (Executor Rule 5), so the
 * shared pieces live here, on the server-safe side of that line.
 *
 * 🔴 WHAT IS NEVER HERE: the normalized match key, the operator annotation, and the lead key
 * in any `href`. The query module does not select the first two (T-3-11); the link carries
 * the internal uuid only (T-3-13, Executor Rule 18). `display_name` is rendered as the
 * source spelled it — an `ñ` on screen is the business's own name (D-12) — and React escapes
 * it; there is no raw-HTML path on this screen (T-3-03).
 */

/** "Comptroller · Overture" — plain muted text, never a badge (Executor Rule 22). */
export function sourcesLine(sources: BusinessListRow['sources']): string {
  if (sources.length === 0) return FIELD_NO_DURABLE_SOURCE;
  return sources.map((key) => SOURCE_TAG[key]).join(' · ');
}

/** The cluster cell's words. Null is the D-02 unmapped state — visible, never blank. */
export function clusterLabel(row: BusinessListRow): string {
  return row.clusterName ?? NO_CLUSTER_MAPPED;
}

/** The closed date, in America/Chicago with the locale pinned — through `formatLocal`,
 *  never a bare `Intl` call, or the same closure renders a different day on Vercel. */
function closedLabel(closedAt: Date | null): string {
  if (closedAt === null) return BUSINESSES_FILTER_OPTION.closed;
  return FLAG_CLOSED(formatLocal(closedAt, { year: 'numeric', month: 'short', day: 'numeric' }));
}

/**
 * The status badge — ONLY when the status is not Active. Active renders its word for a
 * screen reader and nothing visible, because a column of "Active" pills is noise around the
 * two states that matter.
 *
 * `Closed` sits on the destructive SURFACE (03-UI-SPEC § Color): a closed business is a hard
 * stop, and calling a dead one is this product's most embarrassing failure. It is a badge,
 * never a button, and it carries the word and the date — colour is never the only signal.
 */
export function BusinessStatusBadge({ row }: { row: BusinessListRow }) {
  if (row.status === 'active') {
    return <span className="sr-only">{BUSINESS_STATUS.active}</span>;
  }
  if (row.status === 'closed') {
    return (
      <Badge
        variant="secondary"
        className="h-auto bg-destructive-surface text-sm font-semibold text-destructive-surface-foreground tabular-nums"
      >
        {closedLabel(row.closedAt)}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="h-auto text-sm font-semibold"
    >
      {BUSINESS_STATUS.merged_away}
    </Badge>
  );
}

/** "McAllen · Home services & trades"; a record with no city shows its cluster alone. */
function placeLine(row: BusinessListRow): string {
  return row.city === null ? clusterLabel(row) : `${row.city} · ${clusterLabel(row)}`;
}

export function BusinessCards({ rows }: { rows: BusinessListRow[] }) {
  return (
    <ItemGroup data-testid="businesses-cards" className="gap-2 sm:hidden">
      {rows.map((row) => (
        // The list semantics live on this wrapper, not on the link: a `role` on the anchor
        // would replace its link role for a screen reader.
        <div key={row.id} role="listitem">
          <Item asChild variant="outline" className="p-4">
            <Link href={`/businesses/${row.id}`} data-testid={`businesses-card-${row.id}`}>
              <ItemContent className="min-w-0 gap-1">
                <ItemTitle className="line-clamp-2 w-full text-xl font-semibold leading-tight">
                  {row.displayName}
                </ItemTitle>
                <p className="text-sm font-normal text-muted-foreground">{placeLine(row)}</p>
                <p className="text-sm font-normal text-muted-foreground">
                  {sourcesLine(row.sources)}
                </p>
                {row.status === 'active' ? null : (
                  <div className="pt-1">
                    <BusinessStatusBadge row={row} />
                  </div>
                )}
              </ItemContent>
            </Link>
          </Item>
        </div>
      ))}
    </ItemGroup>
  );
}
