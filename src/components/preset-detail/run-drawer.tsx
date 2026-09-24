'use client';

import { OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { formatWeekRange } from '@/lib/time';
import {
  PLACES_ACTION,
  RUN_DRAWER_CELLS,
  RUN_DRAWER_CELLS_LABEL,
  RUN_DRAWER_CHECK_COST,
  RUN_DRAWER_CHECK_NOTE,
  RUN_DRAWER_CONFIRM_CHECK,
  RUN_DRAWER_CONFIRM_FULL,
  RUN_DRAWER_CONFIRM_PARTITION,
  RUN_DRAWER_COST_LABEL,
  RUN_DRAWER_DISMISS,
  RUN_DRAWER_STARTING,
  RUN_DRAWER_TITLE_CHECK,
  RUN_DRAWER_TITLE_FULL,
  RUN_DRAWER_TITLE_PARTITION,
  RUN_OPEN_RUNNING,
  RUN_START_UNKNOWN,
  RUN_START_UNKNOWN_ACTION,
} from '@/lib/ui/copy';
import { queueRun } from '@/server/actions/queue-run';

/**
 * BUDG-02 + D-14 / D-16, as a screen — the one drawer every run kind confirms through.
 *
 * 🔴 THIS BUTTON STARTS A RUN. `queueRun` checks the Places mode, admits the run against the
 * meter, and starts the places-sweep workflow on it. Nothing here is a preview. The server
 * action is the boundary (D-02); what this drawer shows is only ever an explanation.
 *
 * 🔴 ON SUCCESS IT NAVIGATES TO `/runs/{runId}`, AND THERE IS NO TOAST (UI-SPEC § Screen 2).
 * The run report is the feedback: it shows the run queued, then running, live. The drawer
 * closes with the navigation.
 *
 * 🔴 A REFUSAL IS A PERSISTENT `Alert` INSIDE THIS DRAWER, NEVER A TOAST (D-12). A dismissed
 * toast is indistinguishable from one that never fired, and every refusal here carries a way
 * out: raise the cap, reload the preset, open the running run, or try again.
 *
 * 🔴 NO `<form action>`. React resets a form's fields even when the action FAILED, and a Radix
 * control driven by that reset walks its own state backwards — a recorded BIS defect.
 * Confirmation is an `onClick` inside `useTransition`.
 *
 * 🔴 NO `motion` WRAPPER. vaul and Radix own these animations.
 */

/** One version the drawer can run, priced on the server. */
export type RunVersionOption = {
  id: string;
  version: number;
  isCurrent: boolean;
  /** `null` when the estimator cannot price this version. The drawer still runs it — the
   *  meter, not the estimate, is what refuses. */
  costRange: string | null;
  requests: string | null;
};

/** The three ways to run (UI-SPEC § Screen 2), as the drawer names them. */
export type RunDrawerKind = 'full' | 'partition' | 'check';

/** The action's run kinds (src/lib/places/plan-run.ts `RunKind`). */
const ACTION_KIND = {
  full: 'full_sweep',
  partition: 'partition',
  check: 'change_check',
} as const satisfies Record<RunDrawerKind, string>;

/** This ISO week's partition, computed on the server (partition.ts `isoWeekOf`). */
export type RunPartition = {
  index: number;
  isoWeek: number;
  mondayIso: string;
  sundayIso: string;
  cells: number;
  totalCells: number;
};

const DESK_QUERY = '(min-width: 640px)';

function subscribeToDesk(onChange: () => void) {
  const mql = window.matchMedia(DESK_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * `Drawer` (vaul bottom sheet) on a phone, `Dialog` on desk — UI-SPEC § Screen Inventory 3.
 *
 * 🔴 ONE OF THE TWO IS MOUNTED, NEVER BOTH HIDDEN BY CSS. Rendering both would put two
 * copies of `run-confirm` in the DOM, and the repo's touch-target rule ("exactly one
 * visible match per hook") exists because that ambiguity is invisible until a test
 * measures the wrong one.
 *
 * The server snapshot is `false` — phone first, matching the product's stated priority.
 *
 * Exported because `duplicate-dialog.tsx` makes the same phone/desk choice for the same
 * reason, and a second copy of this hook is a second place the breakpoint can drift from
 * Tailwind's `sm`.
 */
export function useIsDesk(): boolean {
  return useSyncExternalStore(
    subscribeToDesk,
    () => window.matchMedia(DESK_QUERY).matches,
    () => false,
  );
}

type Outcome =
  | { kind: 'refused'; message: string }
  | { kind: 'mode_refused'; message: string }
  | { kind: 'busy'; message: string; runningRunId: string | null }
  | { kind: 'error'; message: string }
  /** C-CR-01: the request never answered — the run may or may not exist. */
  | { kind: 'unknown' }
  | null;

/** The preset page's Recent runs card (`recent-runs.tsx` carries this id). The drawer only ever
 *  lives on that page, so a hash is the whole address. */
const RECENT_RUNS_ANCHOR = 'preset-recent-runs';

/** The kind-specific half of the props: a partition drawer needs this week's partition. */
type KindProps = { kind: 'partition'; partition: RunPartition } | { kind: 'full' | 'check' };

type RunDrawerProps = KindProps & {
  presetName: string;
  /** Newest first. */
  versions: RunVersionOption[];
  initialVersionId: string;
  /** True when the drawer was opened from a version ROW: the reader already chose a
   *  version and may want to change their mind, so the picker is shown preselected. From
   *  the primary CTA there is nothing to pick — it runs the current version. */
  pickable: boolean;
  remainingLabel: string;
  isAdmin: boolean;
  /** The trigger — rendered by the caller, so each of the three actions keeps its own
   *  testid and variant (UI-SPEC Rules 34, 40). */
  children: ReactNode;
};

const DESTRUCTIVE_ALERT =
  'border-destructive/40 bg-destructive-surface text-destructive-surface-foreground';
const WARNING_ALERT = 'border-warning/40 bg-warning-surface text-warning-surface-foreground';

export function RunDrawer(props: RunDrawerProps) {
  const { presetName, versions, initialVersionId, pickable, remainingLabel, isAdmin, children } =
    props;
  const kind = props.kind;
  const partition = props.kind === 'partition' ? props.partition : null;

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(initialVersionId);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [isPending, startTransition] = useTransition();

  const isDesk = useIsDesk();
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        // A fresh open starts from the version the trigger names and with no stale
        // refusal on screen — the cap may well have been raised since.
        setSelectedId(initialVersionId);
        setOutcome(null);
      }
    },
    [initialVersionId],
  );

  const confirm = useCallback(() => {
    setOutcome(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof queueRun>>;
      try {
        result = await queueRun({ searchVersionId: selectedId, kind: ACTION_KIND[kind] });
      } catch {
        // 🔴 C-CR-01. A rejected action inside a transition goes to the nearest error boundary
        // and takes the whole preset page with it. And the request can die AFTER the server
        // committed the run and started its workflow, so this outcome claims nothing about what
        // was reserved — it sends the reader to where runs are listed.
        setOutcome({ kind: 'unknown' });
        return;
      }

      if (result.ok) {
        // The report is the feedback. The push stays inside the transition, so the confirm
        // button keeps saying "Starting…" until the report replaces this page.
        router.push(`/runs/${result.data.runId}`);
        return;
      }

      if (result.code === 'budget_refused') {
        // `result.message` IS `RUN_REFUSED(cap)`, built by the action from the cap the
        // database actually refused against.
        setOutcome({ kind: 'refused', message: result.message });
        return;
      }

      if (result.code === 'mode_refused') {
        setOutcome({ kind: 'mode_refused', message: result.message });
        return;
      }

      if (result.code === 'conflict' && result.detail?.reason === 'busy') {
        const running = result.detail.runningRunId;
        setOutcome({
          kind: 'busy',
          message: result.message,
          runningRunId: typeof running === 'string' ? running : null,
        });
        return;
      }

      setOutcome({ kind: 'error', message: result.message });
    });
  }, [kind, router, selectedId]);

  const version = selected?.version ?? 0;
  const title =
    kind === 'check'
      ? RUN_DRAWER_TITLE_CHECK(presetName)
      : kind === 'partition' && partition
        ? RUN_DRAWER_TITLE_PARTITION(presetName, version, partition.isoWeek)
        : RUN_DRAWER_TITLE_FULL(presetName, version);

  const description =
    kind === 'check'
      ? RUN_DRAWER_CHECK_NOTE
      : 'Siteless reserves the top of the estimate before anything runs, and settles the ' +
        'difference afterwards.';

  const confirmLabel = isPending
    ? RUN_DRAWER_STARTING
    : kind === 'check'
      ? RUN_DRAWER_CONFIRM_CHECK
      : kind === 'partition' && partition
        ? RUN_DRAWER_CONFIRM_PARTITION(partition.isoWeek)
        : RUN_DRAWER_CONFIRM_FULL;

  // 🔴 A refusal the reader cannot fix by clicking again REPLACES the confirm button rather
  // than disabling it beside the Alert: a greyed control under a red sentence invites a
  // second click at a cap, a mode or a running run that has not moved.
  // An unknown outcome blocks too: a second click could be a second run.
  const blocking =
    outcome?.kind === 'refused' ||
    outcome?.kind === 'mode_refused' ||
    outcome?.kind === 'busy' ||
    outcome?.kind === 'unknown';

  const body = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <dl className="flex flex-col gap-1 text-sm font-normal">
        {kind === 'check' ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{RUN_DRAWER_COST_LABEL}</dt>
            <dd data-testid="run-estimate" className="font-semibold tabular-nums">
              {RUN_DRAWER_CHECK_COST}
            </dd>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd data-testid="run-estimate" className="font-semibold tabular-nums">
              {selected?.costRange ?? 'Not priced'}
            </dd>
          </div>
        )}
        {selected?.requests ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="tabular-nums">{selected.requests}</dd>
          </div>
        ) : null}
        {partition ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{RUN_DRAWER_CELLS_LABEL}</dt>
            <dd data-testid="run-partition-cells" className="tabular-nums">
              {RUN_DRAWER_CELLS(
                partition.cells,
                partition.totalCells,
                partition.isoWeek,
                formatWeekRange(partition.mondayIso, partition.sundayIso),
              )}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Budget left this month</dt>
          <dd data-testid="run-remaining" className="tabular-nums">
            {remainingLabel}
          </dd>
        </div>
      </dl>

      {pickable && versions.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-sm font-semibold">Which version do you want to run?</legend>
          <RadioGroup
            value={selectedId}
            onValueChange={setSelectedId}
            data-testid="run-version-picker"
          >
            {versions.map((v) => (
              <div key={v.id} className="flex min-h-11 items-center gap-2">
                <RadioGroupItem
                  value={v.id}
                  id={`run-version-${v.version}`}
                  data-testid={`run-version-${v.version}`}
                />
                <Label htmlFor={`run-version-${v.version}`} className="text-sm font-normal">
                  Version {v.version}
                  {v.isCurrent ? ' · current' : ''}
                  {v.costRange ? ` · ${v.costRange}` : ''}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}

      {outcome?.kind === 'refused' ? (
        <Alert role="alert" data-testid="run-refused" className={DESTRUCTIVE_ALERT}>
          <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">
            {outcome.message}
          </AlertTitle>
          <AlertDescription className="text-inherit">
            {/* The way out. Admin or not, the sentence ends somewhere the reader can
                actually go — T-2-02 makes this an affordance only: the boundary is
                `app.set_budget_cap` plus the absent UPDATE grant on budget_periods. */}
            <Button asChild variant="outline" className="h-11">
              {isAdmin ? (
                <Link href="/settings/budget" data-testid="run-refused-raise-cap">
                  Raise the monthly cap
                </Link>
              ) : (
                <Link href="/settings/organization" data-testid="run-refused-ask-admin">
                  Ask an admin to raise the cap
                </Link>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {outcome?.kind === 'mode_refused' ? (
        <Alert role="alert" data-testid="run-mode-refused" className={DESTRUCTIVE_ALERT}>
          <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">
            {outcome.message}
          </AlertTitle>
          <AlertDescription className="text-inherit">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setOpen(false);
                router.refresh();
              }}
              data-testid="run-mode-refused-reload"
            >
              {PLACES_ACTION.reloadPreset}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {outcome?.kind === 'busy' ? (
        <Alert role="alert" data-testid="run-already-running" className={WARNING_ALERT}>
          <TriangleAlert data-icon="triangle-alert" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">
            {outcome.message}
          </AlertTitle>
          {outcome.runningRunId ? (
            <AlertDescription className="text-inherit">
              <Button asChild variant="outline" className="h-11">
                <Link href={`/runs/${outcome.runningRunId}`} data-testid="run-already-running-link">
                  {RUN_OPEN_RUNNING}
                </Link>
              </Button>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      {outcome?.kind === 'unknown' ? (
        <Alert role="alert" data-testid="run-start-unknown" className={WARNING_ALERT}>
          <TriangleAlert data-icon="triangle-alert" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">
            {RUN_START_UNKNOWN}
          </AlertTitle>
          <AlertDescription className="text-inherit">
            <div className="flex flex-wrap items-center gap-2">
              {/* Closing the drawer and re-reading the page is what makes a run that WAS
                  created appear in Recent runs; the hash then scrolls to it. */}
              <Button asChild variant="outline" className="h-11">
                <a
                  href={`#${RECENT_RUNS_ANCHOR}`}
                  onClick={() => {
                    setOpen(false);
                    router.refresh();
                  }}
                  data-testid="run-start-unknown-recent"
                >
                  {RUN_START_UNKNOWN_ACTION.recentRuns}
                </a>
              </Button>
              <Button asChild variant="ghost" className="h-11">
                <Link href="/spend" data-testid="run-start-unknown-spend">
                  {RUN_START_UNKNOWN_ACTION.openSpend}
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {outcome?.kind === 'error' ? (
        <Alert role="alert" data-testid="run-error" className={DESTRUCTIVE_ALERT}>
          <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">
            {outcome.message}
          </AlertTitle>
          <AlertDescription className="text-inherit">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-11"
                onClick={confirm}
                disabled={isPending}
                data-testid="run-error-retry"
              >
                {PLACES_ACTION.tryAgain}
              </Button>
              <Button asChild variant="ghost" className="h-11">
                <Link href="/spend" data-testid="run-error-spend">
                  {PLACES_ACTION.openSpend}
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-4">
      {blocking ? null : (
        <Button
          variant="default"
          className="h-12 w-full sm:h-10"
          onClick={confirm}
          disabled={isPending}
          data-testid="run-confirm"
        >
          {isPending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      )}

      <Button
        variant="ghost"
        className="h-11 w-full sm:h-9"
        onClick={() => setOpen(false)}
        data-testid="run-dismiss"
      >
        {RUN_DRAWER_DISMISS}
      </Button>
    </div>
  );

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent data-testid="run-drawer" data-run-kind={kind} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
            <DialogDescription className="text-sm font-normal">{description}</DialogDescription>
          </DialogHeader>
          {body}
          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent data-testid="run-drawer" data-run-kind={kind}>
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
          <DrawerDescription className="text-sm font-normal">{description}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{footer}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
