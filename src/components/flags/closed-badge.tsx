import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * The `Closed` badge (03-UI-SPEC § Color → New Phase 3 elements): the destructive SURFACE with
 * its foreground, Label 14/600 tabular, carrying the word AND the date so colour is never the
 * only signal. A closed business is a hard stop, so this is a badge, never a button.
 *
 * 🔴 ONE COMPONENT, EVERY SCREEN. It was three hand-written copies (review card, `/businesses`
 * list, detail header), and the detail header's had drifted to the Badge default 12/500, below
 * the type scale (03-22 screen review). `tests/unit/closed-badge.test.tsx` pins that every
 * call site renders the same classes.
 *
 * `label` is pre-rendered by the caller (`FLAG_CLOSED(formatLocal(...))`), so this module
 * names no zone and formats no date. No client directive: it renders in server and client
 * trees alike.
 */
export function ClosedBadge({
  label,
  className,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Badge>, 'children' | 'variant'>) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-auto bg-destructive-surface px-2 py-1 text-sm font-semibold text-destructive-surface-foreground tabular-nums',
        className,
      )}
      {...props}
    >
      {label}
    </Badge>
  );
}
