'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BUSINESSES_COLUMN,
  BUSINESSES_SHOW_MORE,
  BUSINESSES_SHOW_MORE_BUSY,
  FIELD_NOT_STORED,
} from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { BusinessListRow } from '@/server/queries/businesses';
import { BusinessStatusBadge, clusterLabel, sourcesLine } from './business-cards';

/**
 * `/businesses` on desk (≥640px) — a shadcn `Table` (03-UI-SPEC § 3), plus the append pager
 * both breakpoints share.
 *
 * Columns: Name · City · Cluster · Sources · Status.
 *
 * 🔴 THE NAME CELL IS THE LINK; THE ROW IS NOT. A row is not a link (a row with a control in
 * it cannot be), and nothing on this screen is an icon-only action. The href carries the
 * INTERNAL uuid — the external lead key is never a route parameter, a foreign key or a query
 * key (Executor Rule 18, T-3-13).
 *
 * 🔴 `Sources` IS PLAIN MUTED TEXT joined with `·`, never badges (Executor Rule 22: source
 * tags are text; badges are state). The only badge in a row is the status, and only when it
 * is not Active.
 *
 * 🔴 AN UNMAPPED CLUSTER IS VISIBLE: "No cluster mapped" in `--muted-foreground`. D-02 keeps
 * those rows out of the funnel, not out of sight — a record that exists but is invisible is
 * how a data bug survives a quarter.
 *
 * WHY A CLIENT MODULE: `BusinessesShowMore` needs the router and a transition. The table
 * itself is presentational; its helpers come from the server-safe `business-cards.tsx`, and
 * this module exports components only — never data (Executor Rule 5).
 *
 * Desk and phone carry DIFFERENT testids (`businesses-row-{id}` here, `businesses-card-{id}`
 * on the card): both lists are in the DOM with CSS choosing one, and one hook on two
 * elements is the silent `.first()` match 02-10 recorded.
 */

/** Name cell link: foreground text with a quiet underline — accent is reserved for inline
 *  links inside body copy (03-UI-SPEC § Accent, item 6), and this is a table cell. */
const NAME_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-sm font-normal text-foreground underline ' +
  'decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background';

export function BusinessTable({ rows }: { rows: BusinessListRow[] }) {
  return (
    <div data-testid="businesses-table" className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-sm font-semibold">{BUSINESSES_COLUMN.name}</TableHead>
            <TableHead className="text-sm font-semibold">{BUSINESSES_COLUMN.city}</TableHead>
            <TableHead className="text-sm font-semibold">{BUSINESSES_COLUMN.cluster}</TableHead>
            <TableHead className="text-sm font-semibold">{BUSINESSES_COLUMN.sources}</TableHead>
            <TableHead className="text-sm font-semibold">{BUSINESSES_COLUMN.status}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid={`businesses-row-${row.id}`}>
              <TableCell className="min-w-64 whitespace-normal">
                <Link href={`/businesses/${row.id}`} className={NAME_LINK}>
                  {row.displayName}
                </Link>
              </TableCell>
              <TableCell
                className={cn('text-sm font-normal', row.city === null && 'text-muted-foreground')}
              >
                {row.city ?? FIELD_NOT_STORED}
              </TableCell>
              <TableCell
                className={cn(
                  'text-sm font-normal',
                  row.clusterName === null && 'text-muted-foreground',
                )}
              >
                {clusterLabel(row)}
              </TableCell>
              <TableCell className="text-sm font-normal text-muted-foreground">
                {sourcesLine(row.sources)}
              </TableCell>
              <TableCell>
                <BusinessStatusBadge row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * "Show 50 more" — the append pager, one control for both breakpoints (03-UI-SPEC § 3). No
 * `pagination` component is installed and none is added.
 *
 * 🔴 THE ROWS ON SCREEN NEVER MOVE OR BLANK. This writes `limit` to the URL inside a
 * transition; the page's rows boundary is keyed on the search and the filters but NOT on
 * `limit`, so React keeps the revealed rows exactly where they are until the longer page
 * arrives, and the order (`display_name, id`) is total, so the first 50 come back as the
 * same 50. While it waits the button shows `Spinner` + "Loading…" at the same size.
 * `scroll: false` keeps the reader at the foot of the list.
 */
export function BusinessesShowMore({ nextLimit }: { nextLimit: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function showMore() {
    if (isPending) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('limit', String(nextLimit));
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <Button
      type="button"
      variant="outline"
      data-testid="businesses-show-more"
      aria-disabled={isPending}
      onClick={showMore}
      className="h-11 w-full min-w-44 text-base font-normal sm:w-auto"
    >
      {isPending ? (
        <>
          <Spinner className="size-4" aria-hidden="true" />
          {BUSINESSES_SHOW_MORE_BUSY}
        </>
      ) : (
        BUSINESSES_SHOW_MORE
      )}
    </Button>
  );
}
