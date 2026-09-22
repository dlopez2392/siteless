import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUsd } from '@/lib/budget/money';
import { formatLocal } from '@/lib/time';
import { RUN_LABEL, RUN_TONE, type BadgeTone, type RunStatus } from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';
import type { RunSpend } from '@/server/queries/budget';

/**
 * D-14's "by run" tab: every run started in this budget month with what it actually cost.
 *
 * 🔴 THE STATUS RENDERS AS A WORD, NOT AS A COLOUR. `RUN_TONE` and `RUN_LABEL` ship
 * together from `src/lib/ui/run-tone.ts` and are read here as a pair — `refused` and
 * `failed` share the destructive tone and mean opposite things (the governor working
 * versus the pipeline breaking), so the label is the only thing that distinguishes them.
 * That module deliberately carries no client-boundary directive: its exports are read by
 * this server component, and a client module's exports arrive `undefined` inside one with
 * every gate green (UI-SPEC Executor Rule 5, two recorded BIS 500s).
 *
 * 🔴 A STATUS THE MAP HAS NEVER HEARD OF STILL RENDERS ITS OWN WORD. The column is
 * `text` in the database behind a CHECK constraint, so the type here is `string`; falling
 * back to the raw value means a seventh status shows as itself rather than as an empty
 * badge. `tests/unit/ui-maps.test.ts` is what keeps the two lists from drifting in the
 * first place.
 *
 * 🔴 `presetDisplayName`, NEVER an internal label (CONVENTIONS § Naming). BIS's single
 * `accounts.name` — the agency's own "Rio Roofing — trial" string — escaped to customers
 * three times; the query selects `searches.display_name` for exactly that reason and this
 * component has no access to anything else.
 *
 * Desk renders a `Table`, phone renders a card list, and CSS decides which. The two carry
 * DIFFERENT testids: one hook on two elements that are both in the DOM is the silent
 * `.first()` match 02-10 recorded as deviation 3.
 */

const TONE_CLASS: Record<BadgeTone, string> = {
  'neutral-outline': '',
  // UI-SPEC § Screen Inventory 5 assigns `running` an accent outline, while § Accent
  // reserved for item 7 calls the version badge "the only badge that carries accent".
  // `src/lib/ui/run-tone.ts` shipped in plan 02-07 with `running: 'accent-outline'` and
  // is the contract this component consumes, so the tone map wins and the contradiction
  // is recorded in the plan summary rather than resolved silently here.
  'accent-outline': 'border-primary text-primary',
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

function RunStatusBadge({ status }: { status: string }) {
  const known = status as RunStatus;
  const tone = RUN_TONE[known];
  const label = RUN_LABEL[known] ?? status;
  const variant = tone ? TONE_VARIANT[tone] : 'outline';
  return (
    <Badge variant={variant} className={cn(tone ? TONE_CLASS[tone] : '', 'text-xs font-semibold')}>
      {label}
    </Badge>
  );
}

/** "Sep 22, 3:04 PM", in the app's zone with the locale pinned. A bare `Date` formatter
 *  would resolve the SYSTEM zone, which on Vercel is UTC — the same run rendering on two
 *  different days depending on who asked. */
function startedLabel(startedAt: Date | null): string {
  if (!startedAt) return '—';
  return formatLocal(startedAt, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Wall-clock duration of a FINISHED run. A run that has started and not finished reads
 * "—" rather than a figure measured against the server's render time: that number would
 * change on every refresh and would keep growing for a run that had already crashed.
 */
function durationLabel(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt || !finishedAt) return '—';
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function runName(run: RunSpend): string {
  return `${run.presetDisplayName} · version ${run.version}`;
}

/** The `partial` reason, as the run itself recorded it. Never composed here: the sentence
 *  belongs to the run that stopped, and inventing one would be a claim about money. */
function stoppedReasonOf(run: RunSpend): string | null {
  return run.status === 'partial' && run.stoppedReason ? run.stoppedReason : null;
}

export function ByRun({ runs }: { runs: RunSpend[] }) {
  return (
    <>
      {/* Desk: a table. */}
      <div data-testid="spend-by-run-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-sm font-semibold">Run</TableHead>
              <TableHead className="text-sm font-semibold">Started</TableHead>
              <TableHead className="text-right text-sm font-semibold">Duration</TableHead>
              <TableHead className="text-right text-sm font-semibold">Calls</TableHead>
              <TableHead className="text-right text-sm font-semibold">Cost</TableHead>
              <TableHead className="text-sm font-semibold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.runId} data-testid="spend-run-row" className="align-top">
                <TableCell className="text-sm font-normal">{runName(run)}</TableCell>
                <TableCell className="text-sm font-normal tabular-nums">
                  {startedLabel(run.startedAt)}
                </TableCell>
                <TableCell className="text-right text-sm font-normal tabular-nums">
                  {durationLabel(run.startedAt, run.finishedAt)}
                </TableCell>
                <TableCell className="text-right text-sm font-normal tabular-nums">
                  {run.calls}
                </TableCell>
                <TableCell className="text-right text-sm font-semibold tabular-nums">
                  {formatUsd(run.microUsd)}
                </TableCell>
                {/* `TableCell` is `whitespace-nowrap` by default, which pushed the
                    `partial` reason off the right edge of the table — the first capture
                    of this screen showed it clipped mid-sentence at "412 of ~1,10". The
                    reason is the sentence that explains why a month stopped early, so it
                    wraps inside a reading measure rather than being cropped. */}
                <TableCell className="align-top whitespace-normal">
                  <div className="flex max-w-[40ch] flex-col gap-1">
                    <RunStatusBadge status={run.status} />
                    {stoppedReasonOf(run) ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {stoppedReasonOf(run)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone: one card per run, preset name as the heading. */}
      <ItemGroup data-testid="spend-by-run-cards" className="sm:hidden">
        {runs.map((run, index) => (
          <div key={run.runId}>
            {index > 0 ? <ItemSeparator /> : null}
            <Item data-testid="spend-run-card" className="flex-col items-stretch gap-2">
              <ItemContent className="gap-2">
                <ItemTitle className="text-xl font-semibold leading-tight">
                  {runName(run)}
                </ItemTitle>
                <dl className="flex flex-col gap-1">
                  {[
                    ['Started', startedLabel(run.startedAt)],
                    ['Duration', durationLabel(run.startedAt, run.finishedAt)],
                    ['Calls', String(run.calls)],
                    ['Cost', formatUsd(run.microUsd)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm font-normal text-muted-foreground">{label}</dt>
                      <dd className="text-sm font-normal tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </ItemContent>
              <ItemActions className="justify-start">
                <div className="flex flex-col items-start gap-1">
                  <RunStatusBadge status={run.status} />
                  {stoppedReasonOf(run) ? (
                    <span className="text-sm font-normal text-muted-foreground">
                      {stoppedReasonOf(run)}
                    </span>
                  ) : null}
                </div>
              </ItemActions>
            </Item>
          </div>
        ))}
      </ItemGroup>
    </>
  );
}
