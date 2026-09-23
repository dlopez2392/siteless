import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  GOOGLE_MAPS_LINK_SR_SUFFIX,
  REVIEW_GOOGLE_CARD_BODY,
  REVIEW_GOOGLE_CARD_TITLE,
  REVIEW_GOOGLE_COMPARED,
  REVIEW_GOOGLE_OPEN_MAPS,
  REVIEW_GOOGLE_REASON_SCORE,
  REVIEW_GOOGLE_REASON_TIE,
} from '@/lib/ui/copy';
import { mapsUrlFor, placesChips } from '@/lib/ui/places-format';
import type { GoogleListingView } from '@/server/queries/review-queue';
import { SpineRecordCard } from './candidate-pair';
import { SignalChips } from './signal-chips';

/**
 * `/review`'s second item kind: a tentative Google listing (04-UI-SPEC § Screen 3; D-05, D-08).
 *
 * The focal point is the SPINE business's `display_name`. It is the only identity on screen,
 * because Google's name, address and phone are never stored (D-05), and the layout says so
 * instead of pretending to be a pair. The geometry is still the pair's: two equal columns 24px
 * apart from 640px up, stacked 16px apart below.
 *
 * 1. `review-google-side` — the spine record, through Phase 3's card (`SpineRecordCard`), which
 *    also carries the focus hook the queue advance moves focus to.
 * 2. `review-google-listing` — ONE bordered `Card` holding every Places-derived value (the
 *    chips, the reason, the score in it) and exactly one `GoogleMapsTag`, as Google's policy
 *    requires (Rule 28, `data-places-content`).
 *
 * 🔴 RULE 30 / T-4-05: NO GOOGLE TEXT. Everything here is a copy string, the spine's own fields
 * or a number. The Maps link is built from the stored `place_id` plus OUR name and city.
 *
 * 🔴 RULE 31: NO MAP. "Open this listing on Google Maps" is a plain link OUT to Google's own map
 * (a new tab, `noopener noreferrer`). Nothing is embedded, no iframe, no static image.
 *
 * 🔴 NO CLIENT DIRECTIVE. A server component; every value is a prop and every sentence comes
 * from the server-safe copy module, so nothing here is a client reference.
 */
export function GoogleListingCard({ item }: { item: GoogleListingView }) {
  const { business } = item;
  const chips = placesChips(item.features);
  return (
    <div
      data-testid="review-google"
      data-kind="google"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6"
    >
      <SpineRecordCard side={business} which="a" data-testid="review-google-side" />

      <Card data-testid="review-google-listing" data-places-content="" className="h-full">
        <CardContent className="flex h-full flex-col gap-4 p-4 lg:p-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold leading-tight">{REVIEW_GOOGLE_CARD_TITLE}</h2>
            <p className="max-w-[60ch] text-base font-normal">{REVIEW_GOOGLE_CARD_BODY}</p>
          </div>

          <Button asChild variant="outline" className="h-11 w-full text-base font-normal sm:w-fit">
            <a
              data-testid="review-google-open-maps"
              href={mapsUrlFor(item.placeId, business.displayName, business.city)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink data-icon="external-link" aria-hidden="true" />
              {REVIEW_GOOGLE_OPEN_MAPS}{' '}
              <span className="sr-only">{GOOGLE_MAPS_LINK_SR_SUFFIX}</span>
            </a>
          </Button>

          <div className="flex flex-col gap-2">
            {/* Label 14/600 eyebrow. */}
            <p className="text-sm font-semibold">{REVIEW_GOOGLE_COMPARED}</p>
            <SignalChips score={item.score} chips={chips} />
          </div>

          <TentativeReason item={item} />

          {/* The attribution: bottom-left on phone, bottom-right from 640px up. */}
          <div className="mt-auto flex justify-start sm:justify-end">
            <GoogleMapsTag />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Why this listing is waiting for a person (D-08), Label 14/400 muted. A tie names the OTHER
 * business as an inline accent link to its detail (`tie.businessId` is its live root, 04-21).
 * The sentence is the copy module's own; the link is cut out of it around the quoted name, so
 * the words on screen can never drift from `REVIEW_GOOGLE_REASON_TIE`.
 */
function TentativeReason({ item }: { item: GoogleListingView }) {
  const className = 'text-sm font-normal text-muted-foreground';
  const { tie } = item;
  if (item.reason !== 'tie' || tie === null) {
    return (
      <p data-testid="review-tentative-reason" data-reason="score" className={className}>
        {REVIEW_GOOGLE_REASON_SCORE(item.score)}
      </p>
    );
  }

  const sentence = REVIEW_GOOGLE_REASON_TIE(item.score, tie.displayName, tie.score);
  const quoted = `“${tie.displayName}”`;
  const at = sentence.indexOf(quoted);
  return (
    <p data-testid="review-tentative-reason" data-reason="tie" className={className}>
      {at === -1 ? (
        sentence
      ) : (
        <>
          {sentence.slice(0, at + 1)}
          <Link
            href={`/businesses/${tie.businessId}`}
            data-testid="review-tentative-tie-link"
            className="text-primary underline underline-offset-4"
          >
            {tie.displayName}
          </Link>
          {sentence.slice(at + quoted.length - 1)}
        </>
      )}
    </p>
  );
}
