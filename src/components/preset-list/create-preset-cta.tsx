import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * The ONE filled accent action on `/presets` (UI-SPEC Executor Rule 10), defined once and
 * rendered in two breakpoint slots: the desk page header and the phone sticky action bar.
 *
 * 🔴 ONE DEFINITION, TWO SLOTS, TWO HOOKS. Plan 02-10's deviation 3 is what happens
 * otherwise: `ThemeSwitch` rendered twice with one testid resolved to two visible elements
 * and reddened four specs, and the reflex fix — `.first()` — would have gone green while
 * silently measuring whichever copy came first in the DOM. So the mobile slot carries its
 * own `-mobile` suffix and each hook resolves to exactly one element at its own breakpoint.
 *
 * The Button's filled accent variant is named here and in the empty state — which are
 * mutually exclusive screens — and nowhere else. A second filled accent button on ONE
 * rendered screen is a spec violation, not a preference. (Spelled in prose rather than as
 * the literal prop so the Rule 10 grep counts rendered buttons and not comments about
 * them; same friction recorded in 02-09 deviation 10.)
 */
export function CreatePresetCta({
  label,
  className,
  'data-testid': testId,
}: {
  label: string;
  className?: string;
  /** Spelled as the rendered attribute rather than as a `testId` prop, so the hook a spec
   *  looks for is greppable at the CALL SITE — which is the file a reader opens when a
   *  testid goes missing (UI-SPEC Executor Rule 7). */
  'data-testid': string;
}) {
  return (
    <Button asChild variant="default" className={className}>
      <Link href="/presets/new" data-testid={testId}>
        {label}
      </Link>
    </Button>
  );
}
