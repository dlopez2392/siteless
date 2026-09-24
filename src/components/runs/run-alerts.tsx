import { ChevronDown, Clock, OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ceilingMicroUsdOf } from '@/components/runs/run-header';
import { CopyCommandButton } from '@/components/sources/copy-command-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GOOGLE_QUOTA_REQUESTS_PER_DAY } from '@/lib/budget/second-wall';
import { formatLocal } from '@/lib/time';
import {
  PLACES_ACTION,
  RUN_ABANDONED,
  RUN_FAILED,
  RUN_FAILED_ERROR,
  RUN_NEVER_STARTED,
  RUN_OPEN_PRESET,
  RUN_QUEUED_LONG,
  RUN_REFUSED,
  RUN_STOP_ACTION,
  RUN_STOP_CAP,
  RUN_STOP_DAILY_QUOTA,
  RUN_STOP_ESTIMATE,
  RUN_TILE_ROW,
  RUN_TRUNCATION_BODY,
  RUN_TRUNCATION_COPY,
  RUN_TRUNCATION_HEADING,
  RUN_TRUNCATION_HIDE,
  RUN_TRUNCATION_SHOW,
  STOPPED_REASON,
  TOAST_TILE_LIST_COPIED,
} from '@/lib/ui/copy';
import type { StoppedReason } from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';
import type { RunReport } from '@/server/queries/run-report';

/**
 * The alerts directly below the run report's header (04-UI-SPEC § Screen 1 → Stop / refusal /
 * failure alerts, Truncation warning; Amendment 1; criterion 3). They stack: the stop alert
 * first, then the truncation warning.
 *
 * 🔴 A STOPPED REASON IS A MACHINE KEY IN THE DATABASE AND A SENTENCE ON SCREEN (Executor Rule
 * 35, T-4-05). Every branch below renders copy from `copy.ts`; the key itself only ever reaches
 * `data-reason`. A key with no long-form alert for its status falls back to its SHORT
 * `STOPPED_REASON` sentence — never to itself.
 *
 * 🔴 THE TRUNCATION WARNING RENDERS IN EVERY STATUS, `complete` INCLUDED (criterion 3). A
 * complete run with truncated tiles is still complete, and it is never a silent partial. It is
 * warning (the searched tiles are correct), never destructive and never accent, and it carries
 * `role="status"` — nothing needs an interrupt.
 *
 * 🔴 THE STOP ALERTS ARE NOT LIVE REGIONS (§ Accessibility). They render once, on load or on
 * transition, and the transition is what `RunAutoRefresh`'s one polite region announces. The
 * `Alert` primitive defaults to `role="alert"`; it is removed here, or the same stop would be
 * announced twice.
 *
 * 🔴 NO CLIENT-BOUNDARY DIRECTIVE. `Collapsible` and `CopyCommandButton` are client islands that
 * receive plain strings; the Show/Hide label switch is CSS on Radix's `data-state`, so no state
 * lives here and a refresh cannot close a list the user opened.
 */

/** A run that has waited this long in `queued` gets the muted "still waiting" alert. */
const QUEUED_LONG_MS = 2 * 60 * 1000;

const PLACES_FAIL_KEYS = [
  'places_request_rejected',
  'places_unavailable',
  'places_key_missing',
] as const;
type PlacesFailKey = (typeof PLACES_FAIL_KEYS)[number];

function isPlacesFail(reason: StoppedReason | null): reason is PlacesFailKey {
  return reason !== null && (PLACES_FAIL_KEYS as readonly string[]).includes(reason);
}

type Tone = 'warning' | 'destructive' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  warning: 'border-warning/40 bg-warning-surface text-warning-surface-foreground',
  destructive: 'border-destructive/40 bg-destructive-surface text-destructive-surface-foreground',
  muted: 'border-border bg-muted text-foreground',
};

const TONE_ICON: Record<Tone, { Icon: typeof TriangleAlert; name: string }> = {
  warning: { Icon: TriangleAlert, name: 'triangle-alert' },
  destructive: { Icon: OctagonX, name: 'octagon-x' },
  muted: { Icon: Clock, name: 'clock' },
};

/** Outline, 44px, text label — every way out on this screen (none is a primary CTA). */
const ACTION = 'h-11 px-4 text-base font-normal';

/** The first sentence at Body 16/600, the rest at Body 16/400 (§ Screen 1 alerts table). */
function splitLede(text: string): { lede: string; rest: string } {
  const at = text.indexOf('. ');
  if (at < 0) return { lede: text, rest: '' };
  return { lede: text.slice(0, at + 1), rest: text.slice(at + 2) };
}

function RunAlert({
  tone,
  testId,
  data,
  role,
  text,
  children,
}: {
  tone: Tone;
  testId: string;
  data?: Record<string, string>;
  role?: 'status';
  text: string;
  children?: ReactNode;
}) {
  const { Icon, name } = TONE_ICON[tone];
  const { lede, rest } = splitLede(text);
  return (
    <Alert
      // `undefined` overrides the primitive's `role="alert"` (see the header note).
      role={role}
      data-testid={testId}
      {...data}
      className={TONE_CLASS[tone]}
    >
      <Icon data-icon={name} aria-hidden="true" className="size-5" />
      <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
        <p className="max-w-[70ch] text-base text-pretty">
          <span className="font-semibold">{lede}</span>
          {rest ? <span className="font-normal"> {rest}</span> : null}
        </p>
        {children}
      </AlertDescription>
    </Alert>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function LinkAction({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="outline" className={ACTION}>
      <Link href={href} data-testid={testId}>
        {children}
      </Link>
    </Button>
  );
}

/** "Raise the monthly cap" for an admin; "Ask an admin to raise the cap" for a member. The
 *  check is affordance only — `app.set_budget_cap` re-checks the role in SQL (T-2-02). */
function CapAction({ canRaiseCap }: { canRaiseCap: boolean }) {
  return canRaiseCap ? (
    <LinkAction href="/settings/budget" testId="run-stop-raise-cap">
      {RUN_STOP_ACTION.raiseCap}
    </LinkAction>
  ) : (
    <LinkAction href="/settings/organization" testId="run-stop-ask-admin">
      {RUN_STOP_ACTION.askAdmin}
    </LinkAction>
  );
}

function SpendAction() {
  return (
    <LinkAction href="/spend" testId="run-stop-open-spend">
      {RUN_STOP_ACTION.openSpend}
    </LinkAction>
  );
}

function PresetAction({ run }: { run: RunReport['run'] }) {
  return (
    <LinkAction href={`/presets/${run.presetId}`} testId="run-stop-open-preset">
      {RUN_OPEN_PRESET(run.presetName)}
    </LinkAction>
  );
}

function resetDateLabel(ms: number): string {
  return formatLocal(new Date(ms), { month: 'short', day: 'numeric' });
}

/** The stop / refusal / failure alert for this run, or null when its status has none. */
function stopAlertOf({
  run,
  tiles,
  canRaiseCap,
}: {
  run: RunReport['run'];
  tiles: RunReport['tiles'];
  canRaiseCap: boolean;
}) {
  const reason = run.stoppedReason;
  const data = { 'data-reason': reason ?? '' };
  const notSearched = Math.max(0, tiles.total - tiles.searched);

  if (run.status === 'refused') {
    return (
      <RunAlert
        tone="destructive"
        testId="run-stop-alert"
        data={data}
        text={RUN_REFUSED(run.capMicroUsd)}
      >
        <Actions>
          <CapAction canRaiseCap={canRaiseCap} />
        </Actions>
      </RunAlert>
    );
  }

  if (run.status === 'partial') {
    if (reason === 'budget_cap_reached') {
      return (
        <RunAlert
          tone="warning"
          testId="run-stop-alert"
          data={data}
          text={RUN_STOP_CAP(
            run.capMicroUsd,
            run.costMicroUsd,
            tiles.searched,
            notSearched,
            resetDateLabel(run.capResetMs),
          )}
        >
          <Actions>
            <CapAction canRaiseCap={canRaiseCap} />
            <SpendAction />
          </Actions>
        </RunAlert>
      );
    }
    if (reason === 'exceeded_estimate') {
      const hi = run.estimateMicroUsdHi ?? 0;
      return (
        <RunAlert
          tone="warning"
          testId="run-stop-alert"
          data={data}
          text={RUN_STOP_ESTIMATE(
            run.estimateMicroUsdLo ?? 0,
            hi,
            ceilingMicroUsdOf(run) ?? 0,
            tiles.stillSubdividing.length,
          )}
        >
          <Actions>
            {/* The list lives in the Tiles card below, open on an exceeded-estimate run; this
                takes the reader to it (a plain in-page link, no shared client state). */}
            <Button asChild variant="outline" className={ACTION}>
              <a href="#run-tiles-subdividing" data-testid="run-stop-show-subdividing">
                {RUN_STOP_ACTION.showSubdividing}
              </a>
            </Button>
          </Actions>
        </RunAlert>
      );
    }
    if (reason === 'google_daily_quota') {
      return (
        <RunAlert
          tone="warning"
          testId="run-stop-alert"
          data={data}
          // The value the runbook sets (D-19) — Siteless does not read the quota back from
          // Google. ONE constant, shared with the second-wall card (04-31), so the number a
          // stopped run names and the number /settings/budget names cannot drift apart.
          text={RUN_STOP_DAILY_QUOTA(GOOGLE_QUOTA_REQUESTS_PER_DAY, tiles.searched, notSearched)}
        >
          <Actions>
            <SpendAction />
          </Actions>
        </RunAlert>
      );
    }
  }

  if (run.status === 'failed') {
    const text =
      reason === 'never_started'
        ? RUN_NEVER_STARTED
        : reason === 'abandoned'
          ? RUN_ABANDONED(run.costMicroUsd)
          : isPlacesFail(reason)
            ? RUN_FAILED(run.callsCount, RUN_FAILED_ERROR[reason], run.costMicroUsd)
            : reason !== null
              ? STOPPED_REASON[reason]
              : null;
    if (text === null) return null;
    return (
      <RunAlert tone="destructive" testId="run-stop-alert" data={data} text={text}>
        <Actions>
          <PresetAction run={run} />
        </Actions>
      </RunAlert>
    );
  }

  // A terminal run whose key has no long-form alert for its status still says what stopped
  // it, in its short sentence — never the key, and never nothing.
  if (run.status === 'partial' && reason !== null) {
    return (
      <RunAlert tone="warning" testId="run-stop-alert" data={data} text={STOPPED_REASON[reason]}>
        <Actions>
          <SpendAction />
        </Actions>
      </RunAlert>
    );
  }

  return null;
}

/** "{geography} · {Places type} · tile {id}" from the stored tile key
 *  (`{unitKind}:{unitId}|{placesType}|{quadPath}`, `src/lib/places/tiling.ts` `tileKeyOf`). A
 *  key of another shape still renders, whole, rather than being dropped (criterion 3). */
export function tileRowText(tile: { tileKey: string; placesType: string }): string {
  const parts = tile.tileKey.split('|');
  if (parts.length >= 3) {
    return RUN_TILE_ROW(parts[0] ?? '', tile.placesType, parts[parts.length - 1] ?? '');
  }
  return RUN_TILE_ROW(tile.tileKey, tile.placesType, tile.tileKey);
}

/** The criterion-3 warning. Rendered only when `stillTruncated > 0`, in any status. */
function TruncationWarning({ tiles }: { tiles: RunReport['tiles'] }) {
  const n = tiles.stillTruncated;
  const lines = tiles.truncated.map(tileRowText);
  return (
    <Alert
      role="status"
      data-testid="run-truncation-warning"
      data-count={n}
      className={TONE_CLASS.warning}
    >
      <TriangleAlert data-icon="triangle-alert" aria-hidden="true" className="size-5" />
      <AlertDescription className="flex flex-col items-start gap-2 text-inherit">
        <p className="max-w-[70ch] text-base font-semibold text-pretty tabular-nums">
          {RUN_TRUNCATION_HEADING(n)}
        </p>
        <p className="max-w-[70ch] text-base font-normal text-pretty">{RUN_TRUNCATION_BODY}</p>
        <Collapsible className="flex w-full flex-col gap-2">
          <Actions>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                data-testid="run-truncation-toggle"
                className={cn(ACTION, 'group gap-2')}
              >
                <span className="group-data-[state=open]:hidden">{RUN_TRUNCATION_SHOW(n)}</span>
                <span className="hidden group-data-[state=open]:inline">{RUN_TRUNCATION_HIDE}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 group-data-[state=open]:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
            <CopyCommandButton
              command={lines.join('\n')}
              testId="run-truncation-copy"
              label={RUN_TRUNCATION_COPY}
              copiedMessage={TOAST_TILE_LIST_COPIED}
            />
          </Actions>
          <CollapsibleContent>
            <ul data-testid="run-truncation-list" className="flex flex-col gap-1">
              {tiles.truncated.map((tile, i) => (
                <li
                  key={tile.tileKey}
                  data-testid="run-truncation-tile"
                  data-why={tile.why ?? ''}
                  className="text-sm font-normal tabular-nums"
                >
                  {lines[i]}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}

export function RunAlerts({
  run,
  tiles,
  canRaiseCap,
  renderedAtMs,
}: {
  run: RunReport['run'];
  tiles: RunReport['tiles'];
  /** The viewer is an org admin (affordance only; see `CapAction`). */
  canRaiseCap: boolean;
  /** Server render time, for the queued-too-long check — never the browser's clock. */
  renderedAtMs: number;
}) {
  const waitedMs = renderedAtMs - run.createdMs;
  const queuedLong = run.status === 'queued' && waitedMs > QUEUED_LONG_MS;
  const stop = stopAlertOf({ run, tiles, canRaiseCap });
  const truncated = tiles.stillTruncated > 0;

  if (!stop && !queuedLong && !truncated) return null;

  return (
    <div data-testid="run-alerts" className="flex flex-col gap-4">
      {stop}
      {queuedLong ? (
        <RunAlert
          tone="muted"
          testId="run-queued-long"
          text={RUN_QUEUED_LONG(Math.floor(waitedMs / 60_000))}
        >
          <Actions>
            <LinkAction href="/spend" testId="run-queued-open-spend">
              {PLACES_ACTION.openSpend}
            </LinkAction>
          </Actions>
        </RunAlert>
      ) : null}
      {truncated ? <TruncationWarning tiles={tiles} /> : null}
    </div>
  );
}
