import { RUN_CARD_CLASS, RunCardTitle } from '@/components/runs/tiles-card';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUsd } from '@/lib/budget/money';
import { formatCount } from '@/lib/time';
import {
  RUN_REPORT_CARD,
  RUN_REQUESTS_COLUMN,
  RUN_REQUESTS_FOOTNOTE,
  RUN_SKU_NAME,
} from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { RunReport } from '@/server/queries/run-report';

/**
 * The run report's Requests card (04-UI-SPEC § Screen 1 → Requests; D-17): this run's requests
 * by Text Search SKU, the free-allowance share, and the cost — read from OUR ledger.
 *
 * 🔴 NO GOOGLE MAPS TAG HERE (D-11, PLACE-06, Rule 28). These rows are Siteless's own cost
 * ledger — how many requests left and what they cost — not a value computed from a Places
 * response. Tagging them would teach that the tag means "Google was involved" rather than "this
 * is Google's content", and the test pins its absence.
 *
 * 🔴 STATIC STRUCTURE (the `/sources` rows): both SKU rows render even at zero, from the read's
 * always-two-rows list. "Refused by the meter" renders only when it is above zero — it is the
 * request the monthly cap stopped before it left, and the Total row counts it (04-20).
 *
 * 🔴 DESK AND PHONE ARE TWO TREES WITH DISTINCT TESTIDS (`run-sku-row-*` in the table,
 * `run-sku-card-*` in the phone blocks). CSS hides one; a shared testid would make every e2e
 * lookup ambiguous.
 *
 * No client-boundary directive: a server component.
 */

type Row = {
  key: 'ts_enterprise' | 'ts_essentials' | 'refused' | 'total';
  name: string;
  requests: number;
  /** null → "—" (the refused request never reached a SKU); undefined → blank (Total). */
  free: number | null | undefined;
  costMicroUsd: number;
};

const DASH = '—';

function rowsOf(requests: RunReport['requests']): Row[] {
  const rows: Row[] = requests.rows.map((r) => ({
    key: r.sku,
    name: RUN_SKU_NAME[r.sku],
    requests: r.requests,
    free: r.freeThisMonth,
    costMicroUsd: r.costMicroUsd,
  }));
  if (requests.refusedByMeter > 0) {
    rows.push({
      key: 'refused',
      name: RUN_SKU_NAME.refused,
      requests: requests.refusedByMeter,
      free: null,
      costMicroUsd: 0,
    });
  }
  rows.push({
    key: 'total',
    name: RUN_SKU_NAME.total,
    requests: requests.totalRequests,
    free: undefined,
    costMicroUsd: requests.totalMicroUsd,
  });
  return rows;
}

function freeLabel(free: Row['free']): string {
  if (free === undefined) return '';
  if (free === null) return DASH;
  return formatCount(free);
}

export function RequestsCard({ requests }: { requests: RunReport['requests'] }) {
  const rows = rowsOf(requests);
  return (
    <Card data-testid="run-requests" className={RUN_CARD_CLASS}>
      <CardHeader>
        <RunCardTitle>{RUN_REPORT_CARD.requests}</RunCardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Desk: SKU · Requests · Free this month · Cost, counts and money right-aligned. */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-sm font-semibold">{RUN_REQUESTS_COLUMN.sku}</TableHead>
                <TableHead className="text-right text-sm font-semibold">
                  {RUN_REQUESTS_COLUMN.requests}
                </TableHead>
                <TableHead className="text-right text-sm font-semibold">
                  {RUN_REQUESTS_COLUMN.freeThisMonth}
                </TableHead>
                <TableHead className="text-right text-sm font-semibold">
                  {RUN_REQUESTS_COLUMN.cost}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const total = row.key === 'total';
                // The Total row is Label 14/600; the SKU names are Body 16/400.
                const cell = cn(
                  'text-right text-sm tabular-nums',
                  total ? 'font-semibold' : 'font-normal',
                );
                return (
                  <TableRow
                    key={row.key}
                    data-testid={`run-sku-row-${row.key}`}
                    data-requests={row.requests}
                  >
                    <TableCell
                      className={cn(
                        'whitespace-normal',
                        total ? 'text-sm font-semibold' : 'text-base font-normal',
                      )}
                    >
                      {row.name}
                    </TableCell>
                    <TableCell className={cell}>{formatCount(row.requests)}</TableCell>
                    <TableCell className={cell}>{freeLabel(row.free)}</TableCell>
                    <TableCell className={cell}>{formatUsd(row.costMicroUsd)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Phone: one label/value block per SKU. */}
        <div className="flex flex-col gap-4 sm:hidden">
          {rows.map((row) => (
            <div
              key={row.key}
              data-testid={`run-sku-card-${row.key}`}
              data-requests={row.requests}
              className="flex flex-col gap-1"
            >
              <p
                className={row.key === 'total' ? 'text-sm font-semibold' : 'text-base font-normal'}
              >
                {row.name}
              </p>
              <dl className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-normal text-muted-foreground">
                    {RUN_REQUESTS_COLUMN.requests}
                  </dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {formatCount(row.requests)}
                  </dd>
                </div>
                {row.free !== undefined ? (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm font-normal text-muted-foreground">
                      {RUN_REQUESTS_COLUMN.freeThisMonth}
                    </dt>
                    <dd className="text-base font-semibold tabular-nums">{freeLabel(row.free)}</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-normal text-muted-foreground">
                    {RUN_REQUESTS_COLUMN.cost}
                  </dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {formatUsd(row.costMicroUsd)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <p className="max-w-[70ch] text-sm font-normal text-muted-foreground">
          {RUN_REQUESTS_FOOTNOTE}
        </p>
      </CardContent>
    </Card>
  );
}
