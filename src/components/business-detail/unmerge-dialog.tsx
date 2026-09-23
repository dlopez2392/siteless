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
  TOAST_UNMERGED,
  UNMERGE_BODY,
  UNMERGE_BUSY,
  UNMERGE_CONFIRM,
  UNMERGE_DISMISS,
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
 * out: "Try again" and "Open sources".
 *
 * 🔴 NO ANIMATION-LIBRARY WRAPPER on the Dialog or the Drawer — Radix and vaul own those
 * animations, and two animation systems on one element is how a drawer ends up fighting
 * itself. (The acceptance grep for the gesture library's name over this file must stay empty.)
 */
export function UnmergeDialog({
  mergeId,
  loserName,
  winnerName,
  loserKey,
  winnerKey,
  children,
}: {
  mergeId: string;
  loserName: string;
  winnerName: string;
  loserKey: string;
  winnerKey: string;
  /** The row's "Unmerge {loser}" button — the trigger. */
  children: ReactNode;
}) {
  const router = useRouter();
  const isDesk = useIsDesk();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onOpenChange = useCallback(
    (next: boolean) => {
      // Modal until the server answers: no close while the write is in flight.
      if (!next && isPending) return;
      setOpen(next);
      if (next) setError(null);
    },
    [isPending],
  );

  const confirm = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await unmergeBusiness({ mergeId });
      if (!result.ok) {
        // The dialog stays open, with the sentence the action chose.
        setError(result.message);
        return;
      }
      toast(TOAST_UNMERGED(loserName));
      setOpen(false);
      router.refresh();
    });
  }, [mergeId, loserName, router]);

  const title = UNMERGE_TITLE(loserName, winnerName);
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
          <AlertTitle className="text-base font-semibold text-balance">{error}</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap gap-2">
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
