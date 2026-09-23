import Link from 'next/link';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
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
import { STOPPED_REASON } from '@/lib/ui/copy';
import { RUN_KIND_LABEL } from '@/lib/ui/run-tone';
import type { RunSpend } from '@/server/queries/budget';

/**
 * D-14's "by run" tab: every run started in this budget month with what it actually cost.
 *
 * 🔴 THE STATUS IS THE SHARED `RunStatusBadge` (04-UI-SPEC § Reused, Rule 41) — a word,
 * not a colour, at `FLAG_BADGE_SIZING`. It lived here until Phase 4 and was lifted to
 * `src/components/runs/run-status-badge.tsx` so the run report and the preset's recent runs
 * render the same badge rather than two more copies of it.
 *
 * 🔴 A STOPPED REASON IS A MACHINE KEY IN THE DATABASE AND A SENTENCE ON SCREEN (Executor
 * Rule 35, threat T-4-05). `stoppedReasonOf` maps it through `STOPPED_REASON`; a key the map
 * has never heard of renders NOTHING, never itself. Until Phase 4 this printed the stored
 * key verbatim — `exceeded_estimate` on the spend screen.
 *
 * Every run links to its report at `/runs/{id}` through `spend-run-link-{runId}`: the name
 * cell on desk, the whole card on phone — exactly one element per testid per layout.
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

/** The `partial` reason, as the run itself recorded it, in its `STOPPED_REASON` sentence.
 *  Never composed here: the sentence belongs to the run that stopped, and inventing one would
 *  be a claim about money. An unknown key renders nothing rather than the raw key (Rule 35):
 *  there is deliberately no `?? run.stoppedReason` fallback — that fallback IS the leak, and
 *  `run-chrome.test.tsx` was watched red against it. */
function stoppedReasonOf(run: RunSpend): string | null {
  if (run.status !== 'partial' || !run.stoppedReason) return null;
  return STOPPED_REASON[run.stoppedReason] ?? null;
}

function runHref(run: RunSpend): string {
  return `/runs/${run.runId}`;
}

/** "Full sweep" / "This week's partition" / "Change check" — the same words the run report
 *  and the preset's recent runs use. An unknown kind renders nothing, never its key. */
function kindLabel(run: RunSpend): string | null {
  return RUN_KIND_LABEL[run.kind] ?? null;
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
                <TableCell className="text-sm font-normal whitespace-normal">
                  <div className="flex flex-col gap-1">
                    <Link
                      href={runHref(run)}
                      data-testid={`spend-run-link-${run.runId}`}
                      className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {runName(run)}
                    </Link>
                    {kindLabel(run) ? (
                      <span
                        data-kind={run.kind}
                        className="text-sm font-normal text-muted-foreground"
                      >
                        {kindLabel(run)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
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
            {/* The whole card is the link on phone — one ≥44px target, one testid. The link
                WRAPS the item rather than being slotted into it: `Item asChild` would merge
                the two `data-testid`s and the link's would silently replace `spend-run-card`. */}
            <Link
              href={runHref(run)}
              data-testid={`spend-run-link-${run.runId}`}
              className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Item data-testid="spend-run-card" className="flex-col items-stretch gap-2">
                <ItemContent className="gap-2">
                  <ItemTitle className="text-xl font-semibold leading-tight">
                    {runName(run)}
                  </ItemTitle>
                  {kindLabel(run) ? (
                    <span
                      data-kind={run.kind}
                      className="text-sm font-normal text-muted-foreground"
                    >
                      {kindLabel(run)}
                    </span>
                  ) : null}
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
            </Link>
          </div>
        ))}
      </ItemGroup>
    </>
  );
}
