'use client';

import { OctagonX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
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
import { PHASE4_RUN_NOTICE } from '@/lib/ui/copy';
import { queueRun } from '@/server/actions/queue-run';

/**
 * BUDG-02 / success criterion 5, as a screen.
 *
 * 🔴 THIS BUTTON SPENDS. `queueRun` inserts a `runs` row in status `queued` and takes a
 * REAL reservation against `app.reserve_budget` — nothing here is a preview. That is the
 * settled decision (UI-SPEC § Screen Inventory 3 → Run, Open Question 7): Phase 2 owns the
 * preset, the version, the estimate and the RESERVATION; Phase 4 owns actually calling
 * Places and consumes `queued` runs. Queuing a row and reserving nothing would have left
 * criterion 5's refusal existing only in a test, so the first person to meet it would meet
 * it in production with real money already spent.
 *
 * 🔴 A REFUSAL IS A PERSISTENT `Alert` INSIDE THIS DRAWER, NEVER A TOAST (D-12, UI-SPEC §
 * States → "Refused reservation"). A toast that has been dismissed is indistinguishable
 * from one that never fired, and this particular sentence has to carry a solution. The one
 * `toast(` call in this file is on the SUCCESS branch, where the thing being announced is
 * reversible and already visible on /spend.
 *
 * 🔴 NO `<form action>`. React resets a form's fields even when the action FAILED, and a
 * Radix control driven by that reset walks its own state backwards — a recorded BIS defect.
 * Confirmation is an `onClick` inside `useTransition`, so a refusal leaves the chosen
 * version exactly where the user left it and the Alert can sit beside it.
 *
 * 🔴 NO `motion` WRAPPER. vaul and Radix own these animations. Two animation systems on
 * one element is how a drawer ends up fighting itself, and the drawer's spring is the part
 * that makes a bottom sheet feel like a sheet.
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
 * Only the trigger renders before hydration, and the trigger is identical either way, so
 * there is nothing for the client to correct visibly.
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
  | { kind: 'error'; message: string }
  | null;

export function RunDrawer({
  presetName,
  versions,
  initialVersionId,
  pickable,
  remainingLabel,
  isAdmin,
  children,
}: {
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
  children: ReactNode;
}) {
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
      const result = await queueRun({ searchVersionId: selectedId });

      if (result.ok) {
        // Reversible success, already visible on /spend — UI-SPEC reserves the transient
        // notification for exactly this case.
        toast(`Run queued for ${presetName}`);
        setOpen(false);
        // The meter moved: the shell's banner, the summary card's last-run line and the
        // version counts are all server-rendered from it.
        router.refresh();
        return;
      }

      if (result.code === 'budget_refused') {
        // `result.message` IS `RUN_REFUSED(cap)`, built by the action from the cap the
        // database actually refused against. Re-deriving the sentence here would mean the
        // drawer quoting a cap it only believes it knows.
        setOutcome({ kind: 'refused', message: result.message });
        return;
      }

      setOutcome({ kind: 'error', message: result.message });
    });
  }, [presetName, router, selectedId]);

  const title = selected
    ? `Run ${presetName} · version ${selected.version}`
    : `Run ${presetName}`;

  const refused = outcome?.kind === 'refused';

  const body = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <dl className="flex flex-col gap-1 text-sm font-normal">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Estimated cost</dt>
          <dd data-testid="run-estimate" className="font-semibold tabular-nums">
            {selected?.costRange ?? 'Not priced'}
          </dd>
        </div>
        {selected?.requests ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="tabular-nums">{selected.requests}</dd>
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
          <legend className="pb-2 text-sm font-semibold">
            Which version do you want to run?
          </legend>
          <RadioGroup
            value={selectedId}
            onValueChange={setSelectedId}
            data-testid="run-version-picker"
          >
            {versions.map((v) => (
              <div key={v.id} className="flex min-h-11 items-center gap-3">
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

      {refused ? (
        <Alert
          role="alert"
          data-testid="run-refused"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
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

      {outcome?.kind === 'error' ? (
        <Alert
          role="alert"
          data-testid="run-error"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
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
                Try again
              </Button>
              <Button asChild variant="ghost" className="h-11">
                <Link href="/spend" data-testid="run-error-spend">
                  Open spend view
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-3">
      {/* 🔴 THE CONFIRM BUTTON IS REPLACED BY THE REFUSAL, not disabled beside it. A
          greyed control with a red message above it invites a second click at a cap that
          has not moved. */}
      {refused ? null : (
        <Button
          variant="default"
          className="h-12 w-full sm:h-10"
          onClick={confirm}
          disabled={isPending}
          data-testid="run-confirm"
        >
          {isPending ? <Spinner /> : null}
          Reserve budget &amp; queue this run
        </Button>
      )}

      {/* 🔴 ALWAYS VISIBLE, DIRECTLY BENEATH THE CONFIRM BUTTON — never a tooltip and
          never a mystery-disabled control. Phase 2 saves and reserves; it does not run.
          Saying so on the screen is the difference between "not built yet" and "broken". */}
      <p data-testid="run-phase4-notice" className="text-sm font-normal text-muted-foreground">
        {PHASE4_RUN_NOTICE}
      </p>

      <Button
        variant="ghost"
        className="h-11 w-full sm:h-9"
        onClick={() => setOpen(false)}
        data-testid="run-dismiss"
      >
        Not now
      </Button>
    </div>
  );

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent data-testid="run-drawer" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
            <DialogDescription className="text-sm font-normal">
              Siteless reserves the top of the estimate before anything runs, and settles
              the difference afterwards.
            </DialogDescription>
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
      <DrawerContent data-testid="run-drawer">
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
          <DrawerDescription className="text-sm font-normal">
            Siteless reserves the top of the estimate before anything runs, and settles the
            difference afterwards.
          </DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>{footer}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
