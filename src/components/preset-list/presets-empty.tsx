import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { PRESETS_EMPTY_BODY, PRESETS_EMPTY_CTA, PRESETS_EMPTY_HEADING } from '@/lib/ui/copy';

/**
 * UI-SPEC § States → Empty, the preset-list row. The first screen a new tenant sees.
 *
 * The three strings are IMPORTED, never retyped: `PRESETS_EMPTY_HEADING` renders
 * "No search presets yet", `PRESETS_EMPTY_BODY` explains what a preset IS, and
 * `PRESETS_EMPTY_CTA` renders "Create your first preset". Naming them here rather than
 * spelling them in the JSX is the whole point of `src/lib/ui/copy.ts` — a paraphrase in a
 * component is invisible to review and permanent. (Same grep-versus-constant friction
 * recorded in 02-09 deviation 10 and 02-10 deviation 9.)
 *
 * 🔴 NO SCREEN IN THIS PRODUCT EVER SHOWS "No data". The body teaches what a preset is,
 * because "No presets" teaches nothing to the one person who has never made one.
 *
 * 🔴 THIS IS THE SCREEN'S ONE FILLED ACCENT BUTTON when the list is empty — the page
 * deliberately does NOT also render its header CTA in that state. UI-SPEC names this the
 * empty screen's focal point, and a second filled accent button beside it would be the
 * Rule 10 violation.
 */
export function PresetsEmpty() {
  return (
    <Empty className="border border-dashed py-12">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="size-12 rounded-full bg-muted text-muted-foreground"
        >
          <ListChecks className="size-6" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-xl font-semibold leading-tight">
          {PRESETS_EMPTY_HEADING}
        </EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal text-muted-foreground">
          {PRESETS_EMPTY_BODY}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="default" className="h-12 w-full sm:w-auto">
          <Link href="/presets/new" data-testid="presets-empty-cta">
            {PRESETS_EMPTY_CTA}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
