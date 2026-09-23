import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { REVIEW_CHIP_GROUP_LABEL } from '@/lib/ui/copy';
import { reviewChips, type ChipSide } from '@/lib/ui/review-format';

/**
 * The chip band (03-UI-SPEC § 1): WHY these two scored what they did, as the component
 * vector — `phone exact · name 0.81 · 140 m apart · same ZIP · different cluster` — never a
 * bare score. The derivation is `reviewChips()` (src/lib/ui/review-format.ts, unit-tested).
 *
 * 🔴 STATIC TEXT, NOT CONTROLS. No hover, no tap, no tab stop and no 44px obligation. The band
 * is one `role="group"` labelled "Why these two scored {n}", so a screen reader meets the
 * whole vector as a set rather than as loose fragments.
 *
 * 🔴 THE WORDS CARRY THE MEANING. Agreement chips are `secondary`; disagreement and absence
 * chips are `outline` in `--muted-foreground` — but "different" and "no" already say it, so
 * colour is never the only signal. Chips never take the accent.
 *
 * No client directive: a server component rendered inside the pair.
 */
export function SignalChips({
  score,
  features,
  a,
  b,
  className,
}: {
  score: number;
  features: Record<string, unknown>;
  a: ChipSide;
  b: ChipSide;
  className?: string;
}) {
  const chips = reviewChips(features, a, b);
  return (
    <div
      role="group"
      aria-label={REVIEW_CHIP_GROUP_LABEL(score)}
      data-testid="review-chips"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant={chip.agrees ? 'secondary' : 'outline'}
          data-chip={chip.key}
          data-agrees={chip.agrees ? 'true' : 'false'}
          className={cn(
            'h-auto px-2 py-1 text-sm font-semibold tabular-nums',
            !chip.agrees && 'text-muted-foreground',
          )}
        >
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}
