'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BUSINESS_GOOGLE_HISTORY_HIDE, BUSINESS_GOOGLE_HISTORY_SHOW } from '@/lib/ui/copy';

/**
 * The "Google Maps check" card's check history toggle (04-UI-SPEC § Screen 5, Open Question 11):
 * a `Collapsible`, CLOSED BY DEFAULT, trigger "Show {n} earlier checks" / "Hide earlier checks".
 *
 * 🔴 A CLIENT ISLAND WITH NO DATA OF ITS OWN. The rows are rendered on the server by
 * `google-check.tsx` and arrive as `children`; this file only owns the open state. It imports
 * no Places formatter and renders no Places value, so the attribution rule (Rule 28) is the
 * rows' business, not this wrapper's. It exports one component and nothing else — a client
 * module's exports are client REFERENCES inside a server component.
 *
 * Radix owns the height transition (switched off under reduced motion); nothing here wraps it in
 * the gesture library — one animation system per element.
 */
export function GoogleCheckHistory({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-testid="business-google-history-toggle"
          className="h-11 w-fit gap-2 px-4 text-base font-normal [&[data-state=open]>svg]:rotate-180"
        >
          {open ? BUSINESS_GOOGLE_HISTORY_HIDE : BUSINESS_GOOGLE_HISTORY_SHOW(count)}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
