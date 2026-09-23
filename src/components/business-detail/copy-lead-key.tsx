'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { COPY_LEAD_KEY, LEAD_KEY_COPIED } from '@/lib/ui/copy';

/**
 * "Copy lead key" — a TEXT button, never an icon-only copy glyph (03-UI-SPEC § Accessibility:
 * no icon-only actions anywhere in this phase).
 *
 * The one client island in the header. It takes the key as a prop and imports its strings
 * from `src/lib/ui/copy.ts`, a server-safe module; it exports nothing but the component, so a
 * server component importing it gets a client reference to a component and nothing that
 * could arrive `undefined` (Executor Rule 5).
 *
 * The toast is on success only. If the clipboard refuses (an insecure origin, a denied
 * permission) nothing is claimed — the key is on screen as selectable text beside the button,
 * and a "copied" toast for a copy that did not happen is worse than none.
 */
export function CopyLeadKeyButton({ leadKey }: { leadKey: string }) {
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(leadKey);
      toast(LEAD_KEY_COPIED(leadKey));
    } catch {
      // Nothing to claim; see above.
    }
  }, [leadKey]);

  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 sm:h-9"
      onClick={copy}
      data-testid="business-lead-key-copy"
    >
      {COPY_LEAD_KEY}
    </Button>
  );
}
