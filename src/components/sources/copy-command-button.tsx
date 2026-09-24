'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { COPY_FAILED, ERROR_ACTION } from '@/lib/ui/copy';

/**
 * "Copy the command" — the only action on `/sources` (03-UI-SPEC § Copywriting Contract:
 * no primary CTA; ingests are desk scripts, D-01). It copies EXACTLY the string the alert
 * sentence beside it names, because both come from `INGEST_COMMAND` in the copy module and
 * the caller passes that one value to both.
 *
 * A client island, deliberately tiny: the ledger around it stays a server component, and
 * the only thing crossing the boundary is a plain string prop (never an import from this
 * file into a server module — a client module's exports are references there, Rule 5).
 *
 * Outline, never accent: nothing on this screen is accent except the focus ring. 44px tall
 * on every viewport (MOB-01), and a text label, never an icon on its own.
 */

/** The success toast. Not in 03-UI-SPEC § Copy Table — recorded as a copy gap in 03-17's
 *  summary rather than added to `copy.ts`, which this plan does not own. */
function copiedLine(command: string): string {
  return `Copied: ${command}`;
}

/**
 * `label` / `copiedMessage` (04-17): the transient card's purge alert names its own action
 * ("Copy the purge command") and toast ("Purge command copied") per 04-UI-SPEC § Screen 4.
 * Both are plain strings from the copy module, passed by the server caller; omitted, the
 * ledger's labels stand unchanged.
 */
export function CopyCommandButton({
  command,
  testId,
  label = ERROR_ACTION.copyCommand,
  copiedMessage,
  failedMessage,
}: {
  command: string;
  testId: string;
  label?: string;
  copiedMessage?: string;
  /** C-WR-08: what a refused copy says. Default: "Couldn't copy — run: {command}". */
  failedMessage?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(copiedMessage ?? copiedLine(command));
    } catch {
      // 🔴 C-WR-08: NEVER SILENT. A refused clipboard (insecure context, denied permission, some
      // in-app browsers) used to be swallowed on the grounds that the command was printed
      // beside the button — true of the ledger's ingest command, false of the purge command
      // and of the collapsed tile list. The reader taps and must learn it didn't work.
      toast.error(failedMessage ?? COPY_FAILED(command));
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      data-testid={testId}
      onClick={copy}
      className="h-11 gap-2 px-4 text-base font-normal"
    >
      <Copy aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
