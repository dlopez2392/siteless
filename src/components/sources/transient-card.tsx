import { OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CopyCommandButton } from '@/components/sources/copy-command-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PURGE_OVERDUE_HOURS,
  PURGE_PLACES_COMMAND,
  purgeOverdue,
  wholeDaysSince,
  wholeHoursSince,
  type TransientStats,
} from '@/lib/places/purge-status';
import { formatCount, formatLocal } from '@/lib/time';
import {
  ERROR_ACTION,
  SOURCES_TRANSIENT_EMPTY_ACTION,
  SOURCES_TRANSIENT_EMPTY_BODY,
  SOURCES_TRANSIENT_EMPTY_HEADING,
  SOURCES_TRANSIENT_LABEL,
  SOURCES_TRANSIENT_LOAD_FAILED,
  SOURCES_TRANSIENT_NEVER_RUN,
  SOURCES_TRANSIENT_NONE_HELD,
  SOURCES_TRANSIENT_OLDEST,
  SOURCES_TRANSIENT_PURGE_AWAITING,
  SOURCES_TRANSIENT_PURGE_COPY,
  SOURCES_TRANSIENT_PURGE_NEVER_RAN,
  SOURCES_TRANSIENT_PURGE_OVERDUE,
  SOURCES_TRANSIENT_SUBTITLE,
  SOURCES_TRANSIENT_TITLE,
  TOAST_PURGE_COMMAND_COPIED,
} from '@/lib/ui/copy';
import { cn } from '@/lib/utils';

/**
 * `/sources` — the "Google Places (transient)" card (04-17, D-12; 04-UI-SPEC § Screen 4).
 * Criterion 2 made visible: what Siteless holds from Google, and when the purge last ran.
 *
 * 🔴 NEVER A FIFTH LEDGER ROW (Executor Rule 37). A separate shadcn `Card` (Rule 6 — not a
 * hand-rolled div) with a 1px DASHED `--border` hairline, below the ledger. Every testid is
 * `sources-transient-*`, never `sources-row-*` / `sources-card-*`: the ledger's columns mean
 * nothing for a verifier, and a row in that table would teach that Google is a source.
 *
 * 🔴 STATIC STRUCTURE (Rule 27). The title, the subtitle and the five labels always render;
 * before any Places call the values are zeros, "None held" and "Never run", with the inline
 * empty state — so the screen can say that nothing has happened.
 *
 * 🔴 ONE TREE FOR BOTH VIEWPORTS. Phone: label/value rows. Desk (`lg`): one row of five
 * right-aligned tabular columns. The same elements re-flow by CSS, so each testid exists once
 * (no hidden twin for a `.first()` to match silently).
 *
 * 🔴 COUNTS CARRY `data-count`, THE OLDEST AGE `data-days` — the number, not the phrase. Dates
 * go through `formatLocal`, counts through `formatCount` (zone and locale pinned, Rule 26).
 *
 * No Google Maps tag and no attribution block: the card shows no Places content — only counts
 * of what Siteless holds and its own timestamps.
 *
 * A SERVER component. The one client island is `CopyCommandButton`, which receives plain
 * strings only.
 */

type Figure = {
  key: keyof typeof SOURCES_TRANSIENT_LABEL;
  testId: string;
  value: string;
  muted: boolean;
  data: Record<string, string>;
};

function lastPurgeLabel(ms: number): string {
  return formatLocal(new Date(ms), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function figuresOf(s: TransientStats, nowMs: number): Figure[] {
  const days = s.oldestCoordinateMs === null ? null : wholeDaysSince(s.oldestCoordinateMs, nowMs);
  const purged = s.lastRowsPurged ?? 0;
  return [
    {
      key: 'placeIds',
      testId: 'sources-transient-place-ids',
      value: formatCount(s.placeIdsHeld),
      muted: s.placeIdsHeld === 0,
      data: { 'data-count': String(s.placeIdsHeld) },
    },
    {
      key: 'coordinates',
      testId: 'sources-transient-coordinates',
      value: formatCount(s.coordinatesHeld),
      muted: s.coordinatesHeld === 0,
      data: { 'data-count': String(s.coordinatesHeld) },
    },
    {
      key: 'oldest',
      testId: 'sources-transient-oldest',
      value: days === null ? SOURCES_TRANSIENT_NONE_HELD : SOURCES_TRANSIENT_OLDEST(days),
      muted: days === null,
      data: days === null ? {} : { 'data-days': String(days) },
    },
    {
      key: 'lastPurge',
      testId: 'sources-transient-last-purge',
      value: s.lastPurgeMs === null ? SOURCES_TRANSIENT_NEVER_RUN : lastPurgeLabel(s.lastPurgeMs),
      muted: s.lastPurgeMs === null,
      data: {},
    },
    {
      key: 'purged',
      testId: 'sources-transient-purged',
      value: formatCount(purged),
      muted: s.lastRowsPurged === null,
      data: { 'data-count': String(purged) },
    },
  ];
}

/** The shell every state shares: the dashed card, its title and subtitle. */
function TransientShell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <Card
      data-testid={testId}
      className="gap-4 border border-dashed border-border px-4 py-4 shadow-none ring-0 sm:px-6 sm:py-6"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold leading-tight">{SOURCES_TRANSIENT_TITLE}</h2>
        <p className="max-w-[70ch] text-sm font-normal text-muted-foreground">
          {SOURCES_TRANSIENT_SUBTITLE}
        </p>
      </header>
      {children}
    </Card>
  );
}

/** The five label/value pairs. `values` null → 14px skeleton blocks (loading). */
function FigureList({ figures }: { figures: Figure[] | null }) {
  const keys = Object.keys(SOURCES_TRANSIENT_LABEL) as (keyof typeof SOURCES_TRANSIENT_LABEL)[];
  return (
    <dl className="flex flex-col gap-2 lg:grid lg:grid-cols-5 lg:gap-4">
      {keys.map((key) => {
        const f = figures?.find((x) => x.key === key) ?? null;
        return (
          <div
            key={key}
            className="flex items-baseline justify-between gap-4 lg:flex-col lg:items-end lg:justify-start lg:gap-1"
          >
            <dt className="text-sm font-normal text-muted-foreground lg:text-right">
              {SOURCES_TRANSIENT_LABEL[key]}
            </dt>
            {f ? (
              <dd
                data-testid={f.testId}
                {...f.data}
                className={cn(
                  'text-right text-base font-semibold tabular-nums',
                  f.muted ? 'text-muted-foreground' : '',
                )}
              >
                {f.value}
              </dd>
            ) : (
              <dd>
                <Skeleton className="h-3.5 w-16" />
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

export function TransientCard({ stats, nowMs }: { stats: TransientStats | null; nowMs: number }) {
  if (stats === null) {
    return (
      <TransientShell testId="sources-transient">
        <Alert
          data-testid="sources-transient-load-failed"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
          <OctagonX aria-hidden="true" className="size-4" />
          <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
            <p className="text-sm font-normal whitespace-normal">{SOURCES_TRANSIENT_LOAD_FAILED}</p>
            <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
              <Link href="/sources" data-testid="sources-transient-load-retry">
                {ERROR_ACTION.tryAgain}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      </TransientShell>
    );
  }

  const nothingHeld =
    stats.placeIdsHeld === 0 && stats.coordinatesHeld === 0 && stats.expiredAwaitingPurge === 0;
  const overdue = purgeOverdue(stats, nowMs);
  const cause = overdueCauseOf(stats, nowMs);

  return (
    <TransientShell testId="sources-transient">
      <FigureList figures={figuresOf(stats, nowMs)} />

      {nothingHeld ? (
        <div data-testid="sources-transient-empty" className="flex flex-col items-start gap-2">
          <p className="text-xl font-semibold leading-tight">{SOURCES_TRANSIENT_EMPTY_HEADING}</p>
          <p className="max-w-[60ch] text-base font-normal text-muted-foreground">
            {SOURCES_TRANSIENT_EMPTY_BODY}
          </p>
          {/* Outline, not accent: /sources has no primary CTA. */}
          <Button asChild variant="outline" className="h-11 px-4 text-base font-normal">
            <Link href="/presets" data-testid="sources-transient-empty-action">
              {SOURCES_TRANSIENT_EMPTY_ACTION}
            </Link>
          </Button>
        </div>
      ) : null}

      {overdue ? (
        <Alert
          role="status"
          data-testid="sources-transient-purge-overdue"
          data-cause={cause}
          className="border-warning/40 bg-warning-surface text-warning-surface-foreground"
        >
          <TriangleAlert aria-hidden="true" className="size-4" />
          <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
            <p className="text-sm font-normal whitespace-normal">
              {overdueSentence(stats, nowMs, cause)}
            </p>
            {/* C-WR-08: the sentence doesn't name the command, so it is printed here — readable
                and selectable whether or not the clipboard lets the button copy it. */}
            <code
              data-testid="sources-transient-purge-command"
              className="rounded-sm bg-background/60 px-1.5 py-0.5 font-mono text-sm break-all"
            >
              {PURGE_PLACES_COMMAND}
            </code>
            <CopyCommandButton
              command={PURGE_PLACES_COMMAND}
              testId="sources-transient-purge-copy"
              label={SOURCES_TRANSIENT_PURGE_COPY}
              copiedMessage={TOAST_PURGE_COMMAND_COPIED}
            />
          </AlertDescription>
        </Alert>
      ) : null}
    </TransientShell>
  );
}

/** Why the overdue alert shows (C-WR-10) — the sentence is chosen by cause, never one template
 *  that contradicts itself ("last ran 3 hours ago" under a warning that means "late"). */
type OverdueCause = 'stale' | 'awaiting' | 'never';

function overdueCauseOf(s: TransientStats, nowMs: number): OverdueCause {
  if (s.lastPurgeMs === null) return 'never';
  // The same threshold `purgeOverdue` applies to the last purge's age.
  return nowMs - s.lastPurgeMs > PURGE_OVERDUE_HOURS * HOUR_MS ? 'stale' : 'awaiting';
}

const HOUR_MS = 3_600_000;

function overdueSentence(s: TransientStats, nowMs: number, cause: OverdueCause): string {
  if (s.lastPurgeMs !== null) {
    const date = lastPurgeLabel(s.lastPurgeMs);
    const hours = wholeHoursSince(s.lastPurgeMs, nowMs);
    // The purge ran on time and rows expired since: normal for up to a day.
    if (cause === 'awaiting') {
      return SOURCES_TRANSIENT_PURGE_AWAITING(date, hours, s.expiredAwaitingPurge);
    }
    return SOURCES_TRANSIENT_PURGE_OVERDUE(date, hours, s.expiredAwaitingPurge);
  }
  // Never purged: there is no "last ran {date}" to name. Overdue then means a held coordinate
  // older than 36 h, or expired rows — the age of the oldest held one is the honest figure.
  const since = s.oldestCoordinateMs ?? nowMs;
  return SOURCES_TRANSIENT_PURGE_NEVER_RAN(wholeHoursSince(since, nowMs), s.expiredAwaitingPurge);
}

/** Loading (04-UI-SPEC § States → Loading): the title and the five labels paint at once —
 *  static structure — and only the values are 14px skeleton blocks. */
export function TransientCardSkeleton() {
  return (
    <TransientShell testId="sources-transient-skeleton">
      <div aria-busy="true" className="contents">
        <FigureList figures={null} />
      </div>
    </TransientShell>
  );
}
