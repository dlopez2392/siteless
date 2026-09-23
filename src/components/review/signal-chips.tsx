import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { REVIEW_CHIP_GROUP_LABEL } from '@/lib/ui/copy';
import { reviewChips, type ChipSide } from '@/lib/ui/review-format';

/**
 * The chip band (03-UI-SPEC § 1): WHY these two scored what they did, as the component
 * vector — `phone exact · name 0.81 · 140 m apart · same ZIP · different cluster` — never a
 * bare score. The derivation is `reviewChips()` (src/lib/ui/review-format.ts, unit-tested).
 *
 * 04-UI-SPEC § Screen 3 reuses this band for a Google listing: the caller passes pre-derived
 * `chips` (`placesChips()`), a superset of the pair's vocabulary with the same two variants.
 * The chip type here is STRUCTURAL on purpose: this file does not import the Places formatter,
 * so it never falls under Rule 28's "a Places formatter import brings the tag with it" — the
 * Google card that derives the chips is the one that renders the Google Maps tag.
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

/** One chip, whichever vocabulary derived it (`ReviewChip` or `PlacesChip`). */
export type SignalChip = { key: string; label: string; agrees: boolean };

type SignalChipsProps = { score: number; className?: string } & (
  | {
      /** A duplicate pair: the band derives its own chips from the vector and the two sides. */
      features: Record<string, unknown>;
      a: ChipSide;
      b: ChipSide;
      chips?: never;
    }
  | {
      /** Pre-derived chips (a Google listing's `placesChips()`). */
      chips: readonly SignalChip[];
      features?: never;
      a?: never;
      b?: never;
    }
);

export function SignalChips(props: SignalChipsProps) {
  const { score, className } = props;
  const chips: readonly SignalChip[] =
    props.chips !== undefined ? props.chips : reviewChips(props.features, props.a, props.b);
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
