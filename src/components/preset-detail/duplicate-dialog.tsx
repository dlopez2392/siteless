'use client';

import { OctagonX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Alert, AlertTitle } from '@/components/ui/alert';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { duplicatePreset } from '@/server/actions/duplicate-preset';
import { useIsDesk } from './run-drawer';

/**
 * D-17: duplicate creates a NEW preset at version 1, copied from ANY chosen version and
 * pre-named "Copy of {name}".
 *
 * 🔴 THE DEFAULT NAME IS THE SERVER'S, AND THIS DIALOG GIVES IT BACK UNTOUCHED. The action
 * computes `Copy of {source}` from the source row when `displayName` is absent, precisely
 * so a copy made from any other surface is named the same thing. So when the reader has
 * not edited the field, the field is omitted from the payload rather than echoed — the
 * default stays owned in one place instead of being re-typed by every caller that happens
 * to render it.
 *
 * 🔴 A TOAST IS CORRECT HERE, and it is the one place on this screen it is. Duplication is
 * a reversible success (UI-SPEC § States): the copy is a new preset sitting on /presets,
 * and the reader is navigated straight to it. Contrast the run drawer, where a refusal is
 * a standing condition about money and gets a persistent Alert instead.
 *
 * 🔴 NO `<form action>` — React resets a form even when the action FAILED, which on this
 * dialog would silently restore the pre-filled name over whatever the reader had typed,
 * exactly when they need to read their own input to retry.
 *
 * 🔴 THE ESTIMATE SHOWN IS THE SOURCE VERSION'S, RECOMPUTED. `duplicate-preset.ts`
 * deliberately does NOT carry `estimate_snapshot` across, because a snapshot is what
 * somebody was quoted at a moment, against a free allowance since consumed. The figure
 * here comes from the page's fresh estimate for that version, so what the reader is shown
 * before copying is a price that is actually on offer.
 */
export function DuplicateDialog({
  fromVersionId,
  fromVersion,
  defaultName,
  estimateLabel,
  children,
}: {
  fromVersionId: string;
  fromVersion: number;
  /** `Copy of {name}`, computed server-side from the source preset. */
  defaultName: string;
  estimateLabel: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDesk = useIsDesk();

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setName(defaultName);
        setError(null);
      }
    },
    [defaultName],
  );

  const confirm = useCallback(() => {
    setError(null);
    const trimmed = name.trim();
    startTransition(async () => {
      const result = await duplicatePreset({
        fromVersionId,
        // Unchanged means "use the default", and the default is the server's to compute.
        ...(trimmed === defaultName.trim() ? {} : { displayName: trimmed }),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      toast(`Preset duplicated as “${trimmed}”`);
      setOpen(false);
      router.push(`/presets/${result.data.searchId}`);
    });
  }, [defaultName, fromVersionId, name, router]);

  const title = `Duplicate from version ${fromVersion}`;

  const body = (
    <div className="flex flex-col gap-4 px-4 sm:px-0">
      <Field>
        <FieldLabel htmlFor="duplicate-name">Name for the copy</FieldLabel>
        <Input
          id="duplicate-name"
          data-testid="duplicate-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11"
          maxLength={120}
        />
      </Field>

      {estimateLabel ? (
        <p data-testid="duplicate-estimate" className="text-sm font-normal text-muted-foreground">
          {/* What the copy will cost to run, before it exists — the reason the estimate is
              in this dialog at all rather than only on the new preset's own page. */}
          Version {fromVersion} is estimated at{' '}
          <span className="font-semibold tabular-nums">{estimateLabel}</span> to run.
        </p>
      ) : null}

      {error ? (
        <Alert
          role="alert"
          data-testid="duplicate-error"
          className="border-destructive/40 bg-destructive-surface text-destructive-surface-foreground"
        >
          <OctagonX data-icon="octagon-x" aria-hidden="true" className="size-5" />
          <AlertTitle className="text-base font-semibold text-balance">{error}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex w-full flex-col gap-3">
      <Button
        variant="outline"
        className="h-12 w-full sm:h-10"
        onClick={confirm}
        disabled={isPending}
        data-testid="duplicate-confirm"
      >
        {isPending ? <Spinner /> : null}
        Create the copy
      </Button>

      {/* 🔴 A DISMISS BUTTON SAYS WHAT HAPPENS IF YOU PRESS IT. UI-SPEC § Copywriting
          allows no generic labels anywhere in this product, and what happens here is that
          this preset is left exactly as it was — so that is what the button reads. */}
      <Button
        variant="ghost"
        className="h-11 w-full sm:h-9"
        onClick={() => setOpen(false)}
        data-testid="duplicate-dismiss"
      >
        Keep this preset as is
      </Button>
    </div>
  );

  const description =
    'The copy starts at version 1 with this version’s clusters and geography. ' +
    'Nothing about this preset changes.';

  if (isDesk) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent data-testid="duplicate-dialog" className="sm:max-w-lg">
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
      <DrawerContent data-testid="duplicate-dialog">
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
