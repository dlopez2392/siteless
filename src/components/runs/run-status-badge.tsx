import { FLAG_BADGE_SIZING } from '@/components/flags/flag-badge';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { RUN_LABEL, RUN_TONE, type BadgeTone, type RunStatus } from '@/lib/ui/run-tone';
import { cn } from '@/lib/utils';

/**
 * THE run status badge — `/spend` By-run, the preset's recent runs and the run report all
 * render this one component (04-UI-SPEC § Reused, Executor Rule 41). It was lifted out of
 * `src/components/spend/by-run.tsx`, where it had been written at the `Badge` primitive's
 * 12px size (12/600) — below the UI-SPEC type scale, and the same drift the flag badges had
 * before `FLAG_BADGE_SIZING` existed. It now takes that class list, so a run status and a
 * `Closed` badge beside it are the same size.
 *
 * 🔴 NO CLIENT-BOUNDARY DIRECTIVE. `/spend` and the run report are server components; the
 * badge renders in both trees as-is.
 *
 * 🔴 THE STATUS RENDERS AS A WORD, NOT AS A COLOUR. `refused` and `failed` share the
 * destructive tone and mean opposite things (the governor working versus the pipeline
 * breaking), so `RUN_LABEL` is what tells them apart. A status the map has never heard of
 * renders its own word rather than an empty badge: the column is `text` behind a CHECK
 * constraint, so the prop is `string`, and `tests/unit/ui-maps.test.ts` keeps the lists from
 * drifting in the first place.
 *
 * `running` carries a 16px `Spinner` that stops under reduced motion (§ Motion: disable the
 * animation, never the content). It is `aria-hidden` — the word "Running" carries the state,
 * and the primitive's own `role="status"` would otherwise add a second, contentless live
 * region inside the badge.
 */

const TONE_CLASS: Record<BadgeTone, string> = {
  'neutral-outline': '',
  // UI-SPEC § Screen Inventory 5 assigns `running` an accent outline, while § Accent
  // reserved for item 7 calls the version badge "the only badge that carries accent".
  // `src/lib/ui/run-tone.ts` shipped in plan 02-07 with `running: 'accent-outline'` and
  // is the contract this component consumes, so the tone map wins and the contradiction
  // is recorded in the 02 plan summary rather than resolved silently here.
  'accent-outline': 'border-primary text-primary',
  'neutral-solid': '',
  warning: 'border-warning/40 bg-warning-surface text-warning-surface-foreground',
  destructive: '',
};

const TONE_VARIANT: Record<BadgeTone, 'outline' | 'secondary' | 'destructive'> = {
  'neutral-outline': 'outline',
  'accent-outline': 'outline',
  'neutral-solid': 'secondary',
  warning: 'outline',
  destructive: 'destructive',
};

export function RunStatusBadge({
  status,
  testId = 'run-status-badge',
  className,
}: {
  status: string;
  /** Defaults to the run report's hook; a list that renders one badge per row may pass its own. */
  testId?: string;
  className?: string;
}) {
  const known = status as RunStatus;
  const tone: BadgeTone | undefined = RUN_TONE[known];
  const label = RUN_LABEL[known] ?? status;
  const variant = tone ? TONE_VARIANT[tone] : 'outline';
  return (
    <Badge
      data-testid={testId}
      data-status={status}
      variant={variant}
      className={cn(FLAG_BADGE_SIZING, tone ? TONE_CLASS[tone] : '', className)}
    >
      {status === 'running' ? (
        <Spinner aria-hidden="true" className="size-4 motion-reduce:animate-none" />
      ) : null}
      {label}
    </Badge>
  );
}
