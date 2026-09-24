import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { REVIEW_SCORE_LINE } from '@/lib/ui/copy';

/**
 * The review header's quiet "Score {n} of 100" line (03-UI-SPEC § 1; 04-UI-SPEC § Screen 3).
 *
 * 🔴 C-WR-02 / RULE 28. On a GOOGLE item the score was computed against a Google listing, so it
 * is a Places-derived value, and it sits in the header row — outside `review-google-listing`,
 * whose tag it therefore does not share. The line is its own `[data-places-content]` container
 * with the "Google Maps" tag beside the number. A duplicate pair's score compares two of our own
 * records and carries neither.
 *
 * No client directive: the page (a server component) renders it.
 */
export function ReviewScore({ kind, score }: { kind: 'google' | 'duplicate'; score: number }) {
  const google = kind === 'google';
  return (
    <p
      data-testid="review-score"
      data-score={score}
      data-places-content={google ? '' : undefined}
      className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground"
    >
      {REVIEW_SCORE_LINE(score)}
      {google ? (
        <>
          {' · '}
          <GoogleMapsTag />
        </>
      ) : null}
    </p>
  );
}
