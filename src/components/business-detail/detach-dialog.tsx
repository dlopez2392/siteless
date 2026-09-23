'use client';

import { OctagonX, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition, type ReactNode } from 'react';
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
  DETACH_ALREADY_DECIDED,
  DETACH_BODY,
  DETACH_BUSY,
  DETACH_CONFIRM,
  DETACH_DISMISS,
  DETACH_FAILED,
  DETACH_TITLE,
  PLACES_ACTION,
  TOAST_DETACHED,
} from '@/lib/ui/copy';
import { detachListing } from '@/server/actions/detach-listing';

/**
 * The detach confirmation (04-UI-SPEC § Screen 5, Open Question 6; Executor Rule 42). "Detach
 * this listing" is the human reversal path for a wrong auto-attach or a wrong "Same business":
 * the listing becomes `rejected` / `detached` and never attaches to this business again. It
 * ALWAYS opens this dialog; there is no path from the row's trigger to `detachListing` that
 * skips the confirm.
 *
 * Structure copied from `unmerge-dialog.tsx` on purpose — one destructive-confirmation grammar
 * in the app: `Dialog` on desk, `Drawer` on phone through the shared `useIsDesk()`; the body in a
 * destructive `Alert`; a destructive FILLED confirm and a named dismiss ("Keep it attached",
 * never "Cancel"); no corner ×.
 *
 * 🔴 NOT THE CONTROL (T-4-06). `detachListing` calls `requireOrg()` first and re-reads the
 * attachment under the org through `app.decide_place_attachment`; `decided_by` comes from the
 * claims. This dialog sends only the attachment id.
 *
 * 🔴 `onClick` INSIDE `useTransition`, NEVER A FORM ACTION. React resets a form even when the
 * action FAILED, and a Radix control driven by that reset walks its state backwards. It closes,
 * toasts and refreshes on `ok: true` only.
 *
 * 🔴 MODAL UNTIL THE SERVER ANSWERS. Escape, an outside click and the dismiss are refused while
 * detaching: a dialog that closes mid-write leaves the reader not knowing whether the signal
 * still counts.
 *
 * 🔴 THE REFUSAL SENTENCE MUST BE TRUE (04-21 handoff). The action answers `conflict` /
 * `already_decided` with DETACH_FAILED, whose "still attached exactly as it was" is FALSE when
 * someone else already detached (or never confirmed) the listing. That branch shows
 * DETACH_ALREADY_DECIDED and offers only "Reload this business" — a retry would meet the same
 * refusal forever. `not_found` / `validation` are the same kind: only the reload. `unexpected`
 * and a request that never reached the server keep DETACH_FAILED with "Try again".
 */
type Refusal = { message: string; retryable: boolean };

function refusalOf(result: {
  code: string;
  message: string;
  detail?: Record<string, string | number>;
}): Refusal {
  if (result.code === 'conflict' && result.detail?.reason === 'already_decided') {
    return { message: DETACH_ALREADY_DECIDED, retryable: false };
  }
  if (result.code === 'unexpected') return { message: DETACH_FAILED, retryable: true };
  // not_found / validation / any other refusal: the action chose the sentence; a retry sends the
  // same request and meets the same answer.
  return { message: result.message, retryable: false };
}

export function DetachDialog({
  attachmentId,
  businessName,
  children,
}: {
  attachmentId: string;
  /** The spine `display_name` — never Google text (Rule 30). */
  businessName: string;
  /** The row's "Detach this listing" button — the trigger. */
  children: ReactNode;
}) {
  const router = useRouter();
  const isDesk = useIsDesk();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Refusal | null>(null);
  const [isPending, startTransition] = useTransition();

  const onOpenChange = useCallback(
    (next: boolean) => {
      // Modal until the server answers.
      if (!next && isPending) return;
      setOpen(next);
      if (next) setError(null);
      // Closing after a refusal no retry can fix re-reads the page, whichever way it was closed,
      // so the row stops offering a detach that can never succeed.
      if (!next && error !== null && !error.retryable) router.refresh();
    },
    [isPending, error, router],
  );

  /** "Reload this business": close and re-read, whatever the refusal was. */
  const reload = useCallback(() => {
    setOpen(false);
    setError(null);
    router.refresh();
  }, [router]);

  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof detachListing>>;
      try {
        result = await detachListing({ attachmentId });
      } catch {
        // The REQUEST failed (no signal, a 5xx, a retired action id). `app.decide_place_attachment`
        // runs in one transaction, so the listing is exactly as it was.
        setError({ message: DETACH_FAILED, retryable: true });
        return;
      }
      if (!result.ok) {
        setError(refusalOf(result));
        return;
      }
      toast(TOAST_DETACHED(result.data.businessName || businessName));
      setOpen(false);
      router.refresh();
    });
  }, [attachmentId, businessName, router]);

  const Description = isDesk ? DialogDescription : DrawerDescription;

  const content = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <Alert
        role="note"
        data-testid="business-google-detach-consequences"
        className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
      >
        <TriangleAlert aria-hidden="true" className="size-5" />
        <Description asChild>
          <AlertDescription className="text-base font-normal text-destructive-surface-foreground">
            {DETACH_BODY(businessName)}
          </AlertDescription>
        </Description>
      </Alert>

      {error ? (
        <Alert
          data-testid="business-google-detach-error"
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
                data-testid="business-google-detach-retry"
              >
                {PLACES_ACTION.tryAgain}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={error.retryable ? 'ghost' : 'outline'}
              className="h-11 sm:h-9"
              onClick={reload}
              disabled={isPending}
              data-testid="business-google-detach-reload"
            >
              {PLACES_ACTION.reloadBusiness}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-2">
      {/* Destructive FILLED; 48px on phone (a confirmation action, 04-UI-SPEC § Accessibility). */}
      <Button
        type="button"
        className="h-12 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-10"
        onClick={confirm}
        disabled={isPending}
        aria-busy={isPending}
        data-testid="business-google-detach-confirm"
      >
        {isPending ? (
          <>
            <Spinner />
            {DETACH_BUSY}
          </>
        ) : (
          DETACH_CONFIRM
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full sm:h-10"
        onClick={() => onOpenChange(false)}
        disabled={isPending}
        data-testid="business-google-detach-dismiss"
      >
        {DETACH_DISMISS}
      </Button>
    </div>
  );

  const title = DETACH_TITLE(businessName);

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent
          data-testid="business-google-detach-dialog"
          className="sm:max-w-lg"
          showCloseButton={false}
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
      <DrawerContent data-testid="business-google-detach-dialog">
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
        </DrawerHeader>
        {content}
        <DrawerFooter>{footer}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
