import { OctagonX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { CopyCommandButton } from '@/components/sources/copy-command-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatLocal } from '@/lib/time';
import {
  INGEST_COMMAND,
  INGEST_RUN_FAILED,
  INGEST_RUN_STOPPED,
  SOURCE_NAME,
  SOURCES_COLUMN,
  SOURCES_NEVER_RUN,
} from '@/lib/ui/copy';
import {
  INGEST_RUN_LABEL,
  INGEST_RUN_TONE,
  type BadgeTone,
  type IngestRunStatus,
} from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';
import type { SourceKey, SourceLedgerRow } from '@/server/queries/sources';

/**
 * `/sources` — the run ledger (03-UI-SPEC § 2, D-06 / D-17). "It reads like a ledger."
 *
 * 🔴 FOUR ROWS, ALWAYS (Executor Rule 27). The rows are driven by `LEDGER_SOURCES` below —
 * static structure — and the query's rows are LOOKED UP by key, never iterated. A source
 * the query did not return still renders, as "Never run" with zeroed counts, so the screen
 * can say that an ingest has not run rather than showing nothing until one has.
 *
 * 🔴 THE FOCAL POINT IS THE FOUR COUNT COLUMNS AS A BLOCK. They are the only `tabular-nums`
 * figures in the row, right-aligned on desk so the digits line up into columns that read
 * down as well as across. Each carries `data-count={n}` so an e2e test pins the NUMBER, not
 * the rendered phrase ("35,270" is a formatting decision; 35270 is the fact).
 *
 * 🔴 NOTHING HERE IS ACCENT. `INGEST_RUN_TONE.running` is `accent-outline` — the shared tone
 * vocabulary — but 03-UI-SPEC § Color lists "the /sources ledger" among the places accent
 * does NOT appear, so on this screen that tone paints as a neutral outline. The WORD
 * ("Running") still distinguishes it; colour is never the only signal.
 *
 * 🔴 DATES GO THROUGH `formatLocal`, COUNTS THROUGH `formatCount` — zone and locale pinned
 * in `src/lib/time.ts`. No component in this directory calls `Intl` (Rule 26).
 *
 * 🔴 DESK AND PHONE CARRY DIFFERENT TESTIDS. Both trees are in the DOM and CSS hides one;
 * one hook on two elements is the silent `.first()` match 02-10 recorded. Desk:
 * `sources-table` / `sources-row-{key}` / `sources-count-{key}-{kind}`. Phone:
 * `sources-cards` / `sources-card-{key}` / `sources-card-count-{key}-{kind}`.
 *
 * T-3-11: counts, versions, a status and a run's error text — never a business row.
 * T-3-03: `error` is third-party text and renders as a React text node, never as markup.
 */

/** The four sources, in ledger order, with what is static about each: the dataset id the
 *  spec names on the row, and the desk script whose run writes it (the census geocode and
 *  the closure feed are passes of the Comptroller script). */
export const LEDGER_SOURCES: readonly {
  key: SourceKey;
  datasetId: string | null;
  command: string;
}[] = [
  { key: 'tx_comptroller', datasetId: 'jrea-zgmq', command: INGEST_COMMAND.comptroller },
  { key: 'tx_comptroller_closures', datasetId: '3kx8-uryv', command: INGEST_COMMAND.comptroller },
  { key: 'overture', datasetId: null, command: INGEST_COMMAND.overture },
  { key: 'census_geocoder', datasetId: null, command: INGEST_COMMAND.comptroller },
];

export const COUNT_KINDS = ['added', 'changed', 'unchanged', 'gone'] as const;
type CountKind = (typeof COUNT_KINDS)[number];

function neverRun(key: SourceKey): SourceLedgerRow {
  return {
    sourceKey: key,
    datasetId: null,
    sourceVersion: null,
    lastRunAt: null,
    finishedAt: null,
    status: null,
    added: 0,
    changed: 0,
    unchanged: 0,
    gone: 0,
    totalSeen: 0,
    error: null,
    confidenceBands: null,
  };
}

/** `rows` looked up by key — a missing source is a never-run row, never a missing row. */
export function ledgerRows(rows: readonly SourceLedgerRow[]) {
  return LEDGER_SOURCES.map((source) => ({
    source,
    row: rows.find((r) => r.sourceKey === source.key) ?? neverRun(source.key),
  }));
}

/** T-3-03: a malformed count (negative, NaN, non-number) renders as 0, never as garbage. */
function safeCount(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  'neutral-outline': '',
  // Painted neutral here on purpose — see the header. No accent on the /sources ledger.
  'accent-outline': '',
  'neutral-solid': '',
  warning: 'border-warning/40 bg-warning-surface text-warning-surface-foreground',
  destructive: '',
};

const TONE_VARIANT: Record<BadgeTone, 'outline' | 'secondary' | 'destructive'> = {
  'neutral-outline': 'outline',
  'accent-outline': 'outline',
  'neutral-solid': 'secondary',
  warning: 'outline',
  destructive: 'destructive',
};

function IngestStatusBadge({ status, testId }: { status: IngestRunStatus; testId: string }) {
  const tone = INGEST_RUN_TONE[status];
  // A status the map has never heard of still renders its own word, never an empty pill.
  const label = INGEST_RUN_LABEL[status] ?? status;
  return (
    <Badge
      data-testid={testId}
      data-status={status}
      variant={tone ? TONE_VARIANT[tone] : 'outline'}
      className={cn(tone ? TONE_CLASS[tone] : '', 'text-sm font-semibold')}
    >
      {label}
    </Badge>
  );
}

/** A Socrata version is `rowsUpdatedAt` as an ISO instant; it renders as a Chicago date. An
 *  Overture release ("2026-08-19.0") or the geocoder benchmark name renders verbatim. */
function versionLabel(version: string | null): string {
  if (!version) return '—';
  if (/^\d{4}-\d{2}-\d{2}T/.test(version)) {
    const instant = new Date(version);
    if (!Number.isNaN(instant.getTime())) {
      return formatLocal(instant, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  return version;
}

function lastRunLabel(lastRunAt: Date | null): string {
  if (!lastRunAt) return SOURCES_NEVER_RUN;
  return formatLocal(lastRunAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A `failed` run's destructive Alert or a `stopped` run's warning Alert, inside that
 * source's row, with the named script as the way out. Nothing for any other status.
 */
function RunAlert({
  row,
  command,
  testIdPrefix,
}: {
  row: SourceLedgerRow;
  command: string;
  testIdPrefix: string;
}) {
  const name = SOURCE_NAME[row.sourceKey];
  const rows = formatCount(safeCount(row.totalSeen));

  if (row.status === 'failed') {
    return (
      <Alert
        data-testid={`${testIdPrefix}-failed-${row.sourceKey}`}
        className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
      >
        <OctagonX aria-hidden="true" className="size-4" />
        <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
          <p className="text-sm font-normal whitespace-normal">
            {INGEST_RUN_FAILED(name, rows, row.error ?? UNRECORDED_ERROR, command)}
          </p>
          <CopyCommandButton command={command} testId={`${testIdPrefix}-copy-${row.sourceKey}`} />
        </AlertDescription>
      </Alert>
    );
  }

  if (row.status === 'stopped') {
    return (
      <Alert
        role="status"
        data-testid={`${testIdPrefix}-stopped-${row.sourceKey}`}
        className="border-warning/40 bg-warning-surface text-warning-surface-foreground"
      >
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
          <p className="text-sm font-normal whitespace-normal">{INGEST_RUN_STOPPED(name, rows)}</p>
          <CopyCommandButton command={command} testId={`${testIdPrefix}-copy-${row.sourceKey}`} />
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

/** A failed run with no recorded error text. Not in 03-UI-SPEC § Copy Table — recorded as a
 *  copy gap in 03-17's summary; `copy.ts` is not this plan's to edit. */
const UNRECORDED_ERROR = 'no error text was recorded';

const COUNT_HEADER: Record<CountKind, string> = {
  added: SOURCES_COLUMN.added,
  changed: SOURCES_COLUMN.changed,
  unchanged: SOURCES_COLUMN.unchanged,
  gone: SOURCES_COLUMN.gone,
};

export function SourceLedger({
  rows,
  overtureDetail,
  overtureDetailMobile,
}: {
  rows: readonly SourceLedgerRow[];
  /** The Overture row's expansion (the confidence distribution), desk and phone copies —
   *  rendered by the page so each carries its own testid. */
  overtureDetail?: ReactNode;
  overtureDetailMobile?: ReactNode;
}) {
  const ledger = ledgerRows(rows);

  return (
    <>
      {/* Desk (≥640px): one Table on the card surface. */}
      <Card data-testid="sources-table" className="hidden gap-0 py-0 sm:flex">
        <Table>
          <TableHeader>
            <TableRow className="bg-sidebar hover:bg-sidebar">
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.source}</TableHead>
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.version}</TableHead>
              <TableHead className="px-4 text-sm font-semibold">{SOURCES_COLUMN.lastRun}</TableHead>
              {COUNT_KINDS.map((kind) => (
                <TableHead key={kind} className="px-4 text-right text-sm font-semibold">
                  {COUNT_HEADER[kind]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.map(({ source, row }) => {
              const detail = source.key === 'overture' ? overtureDetail : null;
              const alert = <RunAlert row={row} command={source.command} testIdPrefix="sources-run" />;
              const hasAlert = row.status === 'failed' || row.status === 'stopped';
              const ran = row.lastRunAt !== null;
              return (
                <SourceTableRows
                  key={source.key}
                  sourceKey={source.key}
                  datasetId={row.datasetId ?? source.datasetId}
                  row={row}
                  ran={ran}
                  alert={hasAlert ? alert : null}
                  detail={detail}
                />
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Phone (<640px): one Item per source. Counts as a 2×2 label/value grid at Body
          16/600 tabular, so no digit shrinks to fit a table. */}
      <ItemGroup data-testid="sources-cards" className="gap-4 sm:hidden">
        {ledger.map(({ source, row }) => {
          const datasetId = row.datasetId ?? source.datasetId;
          const ran = row.lastRunAt !== null;
          return (
            <Item
              key={source.key}
              variant="outline"
              data-testid={`sources-card-${source.key}`}
              className="flex-col items-stretch gap-4 bg-card p-4"
            >
              <ItemContent className="gap-1">
                <ItemTitle className="text-xl font-semibold leading-tight">
                  {SOURCE_NAME[source.key]}
                </ItemTitle>
                {datasetId ? (
                  <p className="text-sm font-normal text-muted-foreground">{datasetId}</p>
                ) : null}
                {row.status ? (
                  <div className="pt-1">
                    <IngestStatusBadge
                      status={row.status}
                      testId={`sources-card-status-${source.key}`}
                    />
                  </div>
                ) : null}
              </ItemContent>

              <dl className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-normal text-muted-foreground">
                    {SOURCES_COLUMN.version}
                  </dt>
                  <dd className="text-base font-normal tabular-nums">
                    {versionLabel(row.sourceVersion)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm font-normal text-muted-foreground">
                    {SOURCES_COLUMN.lastRun}
                  </dt>
                  <dd
                    className={cn(
                      'text-base font-normal tabular-nums',
                      ran ? '' : 'text-muted-foreground',
                    )}
                  >
                    {lastRunLabel(row.lastRunAt)}
                  </dd>
                </div>
              </dl>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {COUNT_KINDS.map((kind) => {
                  const n = safeCount(row[kind]);
                  return (
                    <div key={kind} className="flex flex-col">
                      <dt className="text-sm font-normal text-muted-foreground">
                        {COUNT_HEADER[kind]}
                      </dt>
                      <dd
                        data-testid={`sources-card-count-${source.key}-${kind}`}
                        data-count={n}
                        className={cn(
                          'text-base font-semibold tabular-nums',
                          ran ? '' : 'text-muted-foreground',
                        )}
                      >
                        {formatCount(n)}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <RunAlert row={row} command={source.command} testIdPrefix="sources-card-run" />
              {source.key === 'overture' ? overtureDetailMobile : null}
            </Item>
          );
        })}
      </ItemGroup>
    </>
  );
}

/** One source's desk row, plus the full-width rows beneath it for an alert and (Overture
 *  only) the confidence distribution. */
function SourceTableRows({
  sourceKey,
  datasetId,
  row,
  ran,
  alert,
  detail,
}: {
  sourceKey: SourceKey;
  datasetId: string | null;
  row: SourceLedgerRow;
  ran: boolean;
  alert: ReactNode;
  detail: ReactNode;
}) {
  const hasBelow = Boolean(alert) || Boolean(detail);
  return (
    <>
      <TableRow
        data-testid={`sources-row-${sourceKey}`}
        className={cn('align-top hover:bg-transparent', hasBelow ? 'border-b-0' : '')}
      >
        <TableCell className="px-4 py-4 whitespace-normal">
          <div className="flex flex-col items-start gap-1">
            <span className="text-base font-semibold">{SOURCE_NAME[sourceKey]}</span>
            {datasetId ? (
              <span className="text-sm font-normal text-muted-foreground">{datasetId}</span>
            ) : null}
            {row.status ? (
              <IngestStatusBadge status={row.status} testId={`sources-status-${sourceKey}`} />
            ) : null}
          </div>
        </TableCell>
        <TableCell className="px-4 py-4 text-sm font-normal tabular-nums">
          {versionLabel(row.sourceVersion)}
        </TableCell>
        <TableCell
          className={cn(
            'px-4 py-4 text-sm font-normal tabular-nums',
            ran ? '' : 'text-muted-foreground',
          )}
        >
          {lastRunLabel(row.lastRunAt)}
        </TableCell>
        {COUNT_KINDS.map((kind) => {
          const n = safeCount(row[kind]);
          return (
            <TableCell
              key={kind}
              data-testid={`sources-count-${sourceKey}-${kind}`}
              data-count={n}
              className={cn(
                'px-4 py-4 text-right text-sm font-normal tabular-nums',
                ran ? '' : 'text-muted-foreground',
              )}
            >
              {formatCount(n)}
            </TableCell>
          );
        })}
      </TableRow>
      {alert ? (
        <TableRow className={cn('hover:bg-transparent', detail ? 'border-b-0' : '')}>
          <TableCell colSpan={7} className="px-4 pt-0 pb-4 whitespace-normal">
            {alert}
          </TableCell>
        </TableRow>
      ) : null}
      {detail ? (
        // The table primitive greys any row holding an expanded control; here that split the
        // Overture line (white) from its own distribution (grey). Kept on the card surface.
        <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
          <TableCell colSpan={7} className="px-4 pt-0 pb-4 whitespace-normal">
            {detail}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
