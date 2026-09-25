'use client';

import { OctagonX, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useIsDesk } from '@/components/preset-detail/run-drawer';
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
import { Spinner } from '@/components/ui/spinner';
import {
  ERROR_ACTION,
  REJECT_BODY,
  REJECT_BUSY,
  REJECT_CONFIRM,
  REJECT_DISMISS,
  REJECT_FAILED,
  REJECT_TITLE,
  TOAST_REJECTED,
} from '@/lib/ui/copy';
import { recordListingDecision } from '@/server/actions/record-listing-decision';

/**
 * The reject confirmation — "Not this business" on a tentative Google listing (04-UI-SPEC
 * § Screen 3; Executor Rule 42; T-4-06). One of the phase's two irreversible commits: a rejected
 * listing never attaches to this business again, and there is no undo in the app.
 *
 * 🔴 RULE 42: THE TRIGGER ONLY OPENS THIS DIALOG. `recordListingDecision` runs from the confirm
 * button and nowhere else, so no path from "Not this business" skips the question.
 *
 * `Dialog` on desk, `Drawer` on phone, through the shared `useIsDesk()` — the structure of
 * `business-detail/unmerge-dialog.tsx`, the Phase 3 analog. The body is a destructive `Alert`.
 *
 * 🔴 NOT THE CONTROL (T-4-06). The action calls `requireOrg()` first and decides through
 * `app.decide_place_attachment` under RLS; this dialog sends an id and a decision only, and the
 * actor is stamped from the claims. A POST that skips this dialog meets the same checks.
 *
 * 🔴 `onClick` INSIDE `useTransition`, NEVER A FORM ACTION. React resets a form even when the
 * action FAILED, and a Radix control driven by that reset walks its state backwards.
 *
 * 🔴 RULE 20: MODAL UNTIL THE SERVER ANSWERS, AND THE QUEUE MOVES ONLY AFTER. While recording,
 * Escape, an outside click and "Keep it pending" are refused. On `ok: true` it toasts, closes,
 * then calls `onRecorded` so the action bar advances the queue. Focus then belongs to the NEXT
 * item's heading (`ReviewAdvance`), not to this dialog's trigger, which is on its way out — so
 * the dialog does not hand focus back to it.
 *
 * 🔴 A REFUSAL IS A PERSISTENT ALERT INSIDE THE DIALOG, NOT A TOAST. A failure a retry can fix
 * reads the reject-failed sentence ("nothing was marked") with "Try again"; a listing that is
 * gone or already decided elsewhere reads the action's own sentence with "Reload the queue".
 */

type Refusal = { message: string; retryable: boolean };

/** A listing that is gone or already decided cannot be retried — only the queue re-read. */
function isRetryable(code: string): boolean {
  return code !== 'not_found' && code !== 'conflict';
}

export function RejectDialog({
  attachmentId,
  businessName,
  disabled = false,
  onRecorded,
  children,
}: {
  attachmentId: string;
  /** The SPINE display name (never Google's) — the listing is not "this". */
  businessName: string;
  /** The bar is busy with another decision: the trigger opens nothing. */
  disabled?: boolean;
  /** Called after a recorded reject, once the dialog has closed: advance the queue. */
  onRecorded: () => void;
  /** The "Not this business" button — the trigger. */
  children: ReactNode;
}) {
  const router = useRouter();
  const isDesk = useIsDesk();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Refusal | null>(null);
  const [isPending, startTransition] = useTransition();
  const recorded = useRef(false);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next && disabled) return;
      // Modal until the server answers: no close while the write is in flight.
      if (!next && isPending) return;
      setOpen(next);
      if (next) {
        setError(null);
        recorded.current = false;
      }
    },
    [disabled, isPending],
  );

  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof recordListingDecision>>;
      try {
        result = await recordListingDecision({ attachmentId, decision: 'rejected' });
      } catch {
        // The REQUEST failed (no signal, a 5xx, a retired action id): the promise rejected
        // instead of answering. Nothing was marked, so the listing is still pending — say so,
        // keep the dialog open, and never let it reach the error boundary.
        setError({ message: REJECT_FAILED, retryable: true });
        return;
      }
      if (!result.ok) {
        const retryable = isRetryable(result.code);
        setError({ message: retryable ? REJECT_FAILED : result.message, retryable });
        return;
      }
      toast(TOAST_REJECTED(result.data.businessName));
      recorded.current = true;
      setOpen(false);
      onRecorded();
    });
  }, [attachmentId, onRecorded]);

  const reload = useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);

  // After a recorded reject the trigger is leaving with its item: don't hand focus back to it.
  const onCloseAutoFocus = useCallback((event: Event) => {
    if (recorded.current) event.preventDefault();
  }, []);

  const title = REJECT_TITLE(businessName);
  const Description = isDesk ? DialogDescription : DrawerDescription;

  const content = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <Alert
        role="note"
        data-testid="review-reject-consequences"
        className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
      >
        <TriangleAlert aria-hidden="true" className="size-5" />
        <Description asChild>
          <AlertDescription className="text-base font-normal text-destructive-surface-foreground">
            {REJECT_BODY(businessName)}
          </AlertDescription>
        </Description>
      </Alert>

      {error ? (
        <Alert
          role="alert"
          data-testid="review-reject-error"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
          <OctagonX aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">{error.message}</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap gap-2">
            {error.retryable ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                onClick={confirm}
                disabled={isPending}
                data-testid="review-reject-retry"
              >
                {ERROR_ACTION.tryAgain}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                onClick={reload}
                data-testid="review-reject-reload"
              >
                {ERROR_ACTION.reloadQueue}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-2">
      {/* Destructive FILLED, 48px on phone. */}
      <Button
        type="button"
        className="h-12 w-full bg-destructive text-base font-normal text-destructive-foreground hover:bg-destructive/90 sm:h-10"
        onClick={confirm}
        disabled={isPending}
        aria-busy={isPending}
        data-testid="review-reject-confirm"
      >
        {isPending ? (
          <>
            <Spinner aria-hidden="true" />
            {REJECT_BUSY}
          </>
        ) : (
          REJECT_CONFIRM
        )}
      </Button>
      {/* Says what happens if you press it — never "Cancel". */}
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base font-normal sm:h-10"
        onClick={() => onOpenChange(false)}
        disabled={isPending}
        data-testid="review-reject-dismiss"
      >
        {REJECT_DISMISS}
      </Button>
    </div>
  );

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        {/* No corner ×: the dismiss is a named button. */}
        <DialogContent
          data-testid="review-reject-dialog"
          className="sm:max-w-lg"
          showCloseButton={false}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
          </DialogHeader>
          {content}
          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={!isPending}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent data-testid="review-reject-dialog" onCloseAutoFocus={onCloseAutoFocus}>
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
        </DrawerHeader>
        {content}
        <DrawerFooter>{footer}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
