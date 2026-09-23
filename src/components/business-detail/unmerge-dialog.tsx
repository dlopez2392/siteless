'use client';

import { OctagonX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
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
  ERROR_ACTION,
  MERGE_SIDE,
  TOAST_UNMERGED,
  UNMERGE_BODY,
  UNMERGE_BUSY,
  UNMERGE_CONFIRM,
  UNMERGE_DISMISS,
  UNMERGE_FAILED,
  UNMERGE_TITLE,
} from '@/lib/ui/copy';
import { unmergeBusiness } from '@/server/actions/unmerge-business';

/**
 * The unmerge confirmation — THE one destructive action in Phase 3 (D-20, Executor Rule 23).
 * It always opens; there is no path from the row's button to `unmergeBusiness` that skips it.
 *
 * `Dialog` on desk, `Drawer` on phone, through the shared `useIsDesk()` (no second
 * `matchMedia` here). The body sits in a destructive `Alert` and names all four consequences —
 * the loser back to active with its own lead key, the winner keeping its key and losing what
 * came from the loser, the pair recorded as different so nothing re-merges it automatically,
 * and the audit line — from `UNMERGE_BODY` in `src/lib/ui/copy.ts`, a server-safe module.
 *
 * 🔴 NOT THE CONTROL (T-3-10). `unmergeBusiness` calls `requireOrg()` first and re-reads the
 * merge under RLS before it writes; this dialog sends only a merge id, and the actor is stamped
 * by `app.undo_merge` itself (T-3-08). A POST that skips this dialog meets the same checks.
 *
 * 🔴 `onClick` INSIDE `useTransition`, NEVER A FORM ACTION. React resets a form even when the
 * action FAILED, and a Radix control driven by that reset walks its state backwards — so the
 * dialog would close, or re-open, on a refusal. Here it closes and refreshes on `ok: true` only.
 *
 * 🔴 MODAL UNTIL THE SERVER ANSWERS. While unmerging, Escape, an outside click and the dismiss
 * button are all refused: a dialog that closes mid-write leaves the reader not knowing which
 * state the two records are in.
 *
 * 🔴 A REFUSAL IS A PERSISTENT ALERT INSIDE THE DIALOG, NOT A TOAST. It renders
 * `result.message` — the action picks the true sentence: `UNMERGE_LATER_MERGE_FIRST` (a later
 * merge into the winner must be undone first), `UNMERGE_ALREADY_UNDONE`, or `UNMERGE_FAILED`
 * ("still merged exactly as they were — nothing was half-undone"). Every one ends with a way
 * out: "Try again" and "Open sources" when a retry can succeed; "Reload the merge history"
 * (close + `router.refresh()`) when it never can — already undone, a later merge first — so the
 * stale Unmerge button does not invite the same refusal forever (C-WR-05).
 *
 * 🔴 NO ANIMATION-LIBRARY WRAPPER on the Dialog or the Drawer — Radix and vaul own those
 * animations, and two animation systems on one element is how a drawer ends up fighting
 * itself. (The acceptance grep for the gesture library's name over this file must stay empty.)
 */
type Refusal = { message: string; retryable: boolean };

/**
 * Whether sending the same request again can succeed (C-WR-05). Only a bug (`unexpected`) or a
 * serialization loss (`concurrent_merge`) can; `already_undone`, `later_merge_first`,
 * `lead_key_in_use` and `not_found` meet the same refusal every time — for those the way out is
 * to re-read the page, as `review-actions.tsx`'s `isRetryable` does for the queue.
 */
function isRetryable(code: string, reason: string | number | undefined): boolean {
  if (code === 'unexpected') return true;
  return code === 'conflict' && reason === 'concurrent_merge';
}

export function UnmergeDialog({
  mergeId,
  loserName,
  winnerName,
  loserKey,
  winnerKey,
  loserSource,
  winnerSource,
  children,
}: {
  mergeId: string;
  loserName: string;
  winnerName: string;
  loserKey: string;
  winnerKey: string;
  /** Pre-rendered SOURCE_TAG values (or null): with the keys, they tell same-name records apart. */
  loserSource: string | null;
  winnerSource: string | null;
  /** The row's "Unmerge {loser key · source}" button — the trigger. */
  children: ReactNode;
}) {
  const router = useRouter();
  const isDesk = useIsDesk();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Refusal | null>(null);
  const [isPending, startTransition] = useTransition();

  const onOpenChange = useCallback(
    (next: boolean) => {
      // Modal until the server answers: no close while the write is in flight.
      if (!next && isPending) return;
      setOpen(next);
      if (next) setError(null);
      // 🔴 C-WR-05: closing after a refusal no retry can fix re-reads the page, whichever way
      // the dialog was closed — otherwise the row keeps its stale, live Unmerge button and the
      // reader can walk the same loop forever.
      if (!next && error !== null && !error.retryable) router.refresh();
    },
    [isPending, error, router],
  );

  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof unmergeBusiness>>;
      try {
        result = await unmergeBusiness({ mergeId });
      } catch {
        // 🔴 C-CR-01: the REQUEST failed (no signal, a 5xx, a retired action id) — the promise
        // rejected instead of answering `ok: false`. Uncaught inside the transition it reaches
        // the error boundary and takes the page with it. `app.undo_merge` runs in one
        // transaction, so the records are exactly as they were: the dialog stays open and says
        // so, and nothing closes or refreshes.
        setError({ message: UNMERGE_FAILED, retryable: true });
        return;
      }
      if (!result.ok) {
        // The dialog stays open, with the sentence the action chose. It does NOT refresh yet:
        // re-reading now could unmount this very row (an already-undone merge has no button)
        // before the sentence is read.
        setError({
          message: result.message,
          retryable: isRetryable(result.code, result.detail?.reason),
        });
        return;
      }
      toast(TOAST_UNMERGED(loserName, loserKey));
      setOpen(false);
      router.refresh();
    });
  }, [mergeId, loserName, loserKey, router]);

  const title = UNMERGE_TITLE(MERGE_SIDE(loserKey, loserSource), MERGE_SIDE(winnerKey, winnerSource));
  const body = UNMERGE_BODY(loserName, winnerName, loserKey, winnerKey);
  const Description = isDesk ? DialogDescription : DrawerDescription;

  const content = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <Alert
        role="note"
        data-testid="business-unmerge-consequences"
        className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
      >
        <TriangleAlert aria-hidden="true" className="size-5" />
        <Description asChild>
          <AlertDescription className="text-base font-normal text-destructive-surface-foreground">
            {body}
          </AlertDescription>
        </Description>
      </Alert>

      {error ? (
        <Alert
          data-testid="business-unmerge-error"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
          <OctagonX aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">{error.message}</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap gap-2">
            {error.retryable ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 sm:h-9"
                  onClick={confirm}
                  disabled={isPending}
                  data-testid="business-unmerge-retry"
                >
                  {ERROR_ACTION.tryAgain}
                </Button>
                <Button asChild variant="ghost" className="h-11 sm:h-9">
                  <Link href="/sources" data-testid="business-unmerge-open-sources">
                    {ERROR_ACTION.openSources}
                  </Link>
                </Button>
              </>
            ) : (
              // A retry would meet the same refusal: close and re-read, so the row shows the
              // merge as it really stands and the stale Unmerge button goes (C-WR-05).
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => onOpenChange(false)}
                data-testid="business-unmerge-reload"
              >
                {ERROR_ACTION.reloadHistory}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-2">
      {/* Destructive FILLED — the only filled destructive control in the phase. */}
      <Button
        type="button"
        className="h-12 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-10"
        onClick={confirm}
        disabled={isPending}
        aria-busy={isPending}
        data-testid="business-unmerge-confirm"
      >
        {isPending ? (
          <>
            <Spinner />
            {UNMERGE_BUSY}
          </>
        ) : (
          UNMERGE_CONFIRM
        )}
      </Button>
      {/* Says what happens if you press it — never "Cancel". */}
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full sm:h-9"
        onClick={() => onOpenChange(false)}
        disabled={isPending}
        data-testid="business-unmerge-dismiss"
      >
        {UNMERGE_DISMISS}
      </Button>
    </div>
  );

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        {/* No corner ×: the dismiss is a named button, and nothing in this phase is icon-only. */}
        <DialogContent
          data-testid="business-unmerge-dialog"
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
      <DrawerContent data-testid="business-unmerge-dialog">
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
        </DrawerHeader>
        {content}
        <DrawerFooter>{footer}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
