import { ExternalLink, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FLAG_BADGE_SIZING } from '@/components/flags/flag-badge';
import { GoogleMapsTag } from '@/components/places/google-maps-tag';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { formatLocal } from '@/lib/time';
import {
  BUSINESS_GOOGLE_DETACH,
  BUSINESS_GOOGLE_DETACHED_BY,
  BUSINESS_GOOGLE_EMPTY_ACTION,
  BUSINESS_GOOGLE_EMPTY_BODY,
  BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED,
  BUSINESS_GOOGLE_EMPTY_HEADING,
  BUSINESS_GOOGLE_HISTORY_MARK,
  BUSINESS_GOOGLE_HISTORY_RUN,
  BUSINESS_GOOGLE_LISTING,
  BUSINESS_GOOGLE_LISTING_ATTACHED,
  BUSINESS_GOOGLE_LISTING_NOT_THIS,
  BUSINESS_GOOGLE_ONLY_TENTATIVE,
  BUSINESS_GOOGLE_OPEN_MAPS,
  BUSINESS_GOOGLE_REJECTED_BY,
  BUSINESS_GOOGLE_REVIEW_LINK,
  BUSINESS_GOOGLE_SIGNAL_LABEL,
  BUSINESS_GOOGLE_TENTATIVE_BADGE,
  BUSINESS_GOOGLE_TENTATIVE_ROW,
  BUSINESS_GOOGLE_TITLE,
  GOOGLE_MAPS_LINK_SR_SUFFIX,
  GOOGLE_MAPS_TAG_DATE,
} from '@/lib/ui/copy';
import { mapsUrlFor, signalSentence } from '@/lib/ui/places-format';
import type { GoogleCheckView } from '@/server/queries/businesses';
import { DetachDialog } from './detach-dialog';
import { GoogleCheckHistory } from './google-check-history';

/**
 * "Google Maps check" on `/businesses/[id]` (04-UI-SPEC § Screen 5; D-05, D-08, D-09, D-10,
 * D-11). The Places-derived website signal, with its attribution, as provenance — the treatment
 * Phase 7's triage card inherits.
 *
 * Rows, in order:
 *   1. The BUSINESS-LEVEL signal (`business-google-signal`, D-08: listed if any attached listing's
 *      latest observation lists a website) — label · sentence · "Google Maps · {date}", the
 *      `FieldRow` grammar and grid from `fields-and-sources.tsx`. With no attached listing but a
 *      pending one it reads "No confirmed listing yet — one is pending review." with no tag; with
 *      no listing at all the card is the "Not checked on Google yet" empty state.
 *   2…n. One row per listing, in the read's order (attached → tentative → rejected/detached).
 *      With exactly one attached listing and nothing else, row 1 carries that listing's actions
 *      and there is no second row: one listing never renders twice.
 *   Then the check history (D-10), collapsed, only when there is more than one observation.
 *
 * 🔴 RULE 28 / PLACE-06: every row that shows a Places-derived value (a signal sentence, a
 * listing score, an observation) is a `[data-places-content]` container holding EXACTLY ONE
 * `GoogleMapsTag`. Rows that show no Places value (the only-tentative line, rejected/detached
 * rows) carry no tag and no container. Containers never nest.
 *
 * 🔴 D-05: A TENTATIVE LISTING NEVER SHOWS A WEBSITE SENTENCE — not on its row and not in the
 * history (marked "pending review" there). Showing one would present an unconfirmed signal as
 * a fact.
 *
 * 🔴 RULE 30 / D-09 / D-21: nothing Google-authored is rendered. The inputs are an enum, a
 * boolean, scores, our own ids and times; the website URL was discarded at call time and is
 * never implied. The only link to Google is `mapsUrlFor` — a link OUT to Google's own map, built
 * from the stored place id and OUR name and city (T-4-11), `noopener noreferrer`. No map here.
 *
 * 🔴 RULE 32 / T-4-04: no coordinate is read or rendered; the "Location" field above keeps its
 * durable source. `tests/unit/no-internal-leak.test.ts` walks this directory for the table name.
 *
 * 🔴 A SERVER COMPONENT. The history toggle and the detach dialog are client islands; the rows
 * inside them are rendered here. Times are epoch ms, formatted in America/Chicago with the
 * locale pinned through `formatLocal` (Rule 26) — never `Intl` here.
 */

export type GoogleCheckBusiness = {
  id: string;
  /** The spine `display_name` — the Maps query and the detach dialog's name. */
  displayName: string;
  city: string | null;
  /** The spine's cluster label, or null when no cluster is mapped. */
  cluster: string | null;
};

type Listing = GoogleCheckView['listings'][number];
type ListingKind = 'attached' | 'tentative' | 'rejected' | 'detached';

/** The FieldRow grid (fields-and-sources.tsx): label · value · source; phone stacks three lines. */
const ROW =
  'flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] sm:items-baseline sm:gap-x-6 sm:gap-y-1';
const LABEL = 'text-sm font-semibold';
const VALUE = 'flex min-w-0 flex-col gap-2 text-base font-normal break-words';
const SOURCE = 'text-sm font-normal sm:text-right';
const INLINE_LINK = 'w-fit text-primary underline underline-offset-4';

function kindOf(l: Listing): ListingKind {
  if (l.status === 'rejected') return l.reason === 'detached' ? 'detached' : 'rejected';
  return l.status;
}

/** "Sep 22" — the tag's date and the run link (UI-SPEC § Copy Table). */
function shortDate(ms: number): string {
  return formatLocal(new Date(ms), { month: 'short', day: 'numeric' });
}

/** "Sep 22, 2026" — a decision or a check in the history. */
function longDate(ms: number): string {
  return formatLocal(new Date(ms), { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Google Maps · Sep 22": the tag in its own token and font, the date a SEPARATE muted span. */
function SourceTag({ observedMs, dateTestId }: { observedMs: number | null; dateTestId?: string }) {
  return (
    <span className="whitespace-nowrap">
      <GoogleMapsTag />
      {observedMs === null ? null : (
        <span
          data-testid={dateTestId}
          className="text-sm font-normal text-muted-foreground tabular-nums"
        >
          {GOOGLE_MAPS_TAG_DATE(shortDate(observedMs))}
        </span>
      )}
    </span>
  );
}

/** "Open this listing on Google Maps" + "Detach this listing" for one attached listing. */
function ListingActions({
  listing,
  business,
}: {
  listing: Listing;
  business: GoogleCheckBusiness;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button asChild variant="outline" className="h-11 w-full gap-2 sm:w-fit">
        <a
          href={mapsUrlFor(listing.placeId, business.displayName, business.city)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`business-google-open-maps-${listing.attachmentId}`}
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          {BUSINESS_GOOGLE_OPEN_MAPS} <span className="sr-only">{GOOGLE_MAPS_LINK_SR_SUFFIX}</span>
        </a>
      </Button>
      <DetachDialog attachmentId={listing.attachmentId} businessName={business.displayName}>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-destructive text-destructive hover:bg-destructive-surface hover:text-destructive-surface-foreground sm:w-fit"
          data-testid={`business-google-detach-${listing.attachmentId}`}
        >
          {BUSINESS_GOOGLE_DETACH}
        </Button>
      </DetachDialog>
    </div>
  );
}

function ListingRow({
  listing,
  index,
  business,
  actors,
}: {
  listing: Listing;
  index: number;
  business: GoogleCheckBusiness;
  actors: Readonly<Record<string, string>>;
}) {
  const kind = kindOf(listing);
  const testid = `business-google-listing-${listing.attachmentId}`;
  const score = Math.round(listing.score);

  if (kind === 'rejected' || kind === 'detached') {
    // No Places-derived value is shown here — no score, no sentence — so no tag and no container.
    const actorId = listing.decidedBy ?? '';
    const actor = actors[actorId] ?? actorId;
    const when = listing.decidedMs === null ? '' : longDate(listing.decidedMs);
    return (
      <li data-testid={testid} data-status={kind} className={ROW}>
        <p className="text-sm font-normal text-muted-foreground">
          {BUSINESS_GOOGLE_LISTING_NOT_THIS(index)}
        </p>
        <p className="text-sm font-normal break-words text-muted-foreground tabular-nums">
          {kind === 'detached'
            ? BUSINESS_GOOGLE_DETACHED_BY(actor, when)
            : BUSINESS_GOOGLE_REJECTED_BY(actor, when)}
        </p>
      </li>
    );
  }

  if (kind === 'tentative') {
    // Pending, never a signal (D-05): the score is Places-derived, so the tag is here; the
    // website sentence is not.
    return (
      <li data-testid={testid} data-status="tentative" data-places-content="" className={ROW}>
        <p className={`${LABEL} flex flex-wrap items-center gap-2`}>
          {BUSINESS_GOOGLE_LISTING(index)}
          <Badge variant="outline" className={`${FLAG_BADGE_SIZING} text-muted-foreground`}>
            {BUSINESS_GOOGLE_TENTATIVE_BADGE}
          </Badge>
        </p>
        <div className={VALUE}>
          <span className="tabular-nums">{BUSINESS_GOOGLE_TENTATIVE_ROW(score)}</span>
          <Link href="/review?kind=google" className={INLINE_LINK}>
            {BUSINESS_GOOGLE_REVIEW_LINK}
          </Link>
        </div>
        <p className={SOURCE}>
          <SourceTag observedMs={null} />
        </p>
      </li>
    );
  }

  return (
    <li data-testid={testid} data-status="attached" data-places-content="" className={ROW}>
      <p className={`${LABEL} tabular-nums`}>{BUSINESS_GOOGLE_LISTING_ATTACHED(index, score)}</p>
      <div className={VALUE}>
        {listing.latest === null ? null : <span>{signalSentence(listing.latest.hostClass)}</span>}
        <ListingActions listing={listing} business={business} />
      </div>
      <p className={SOURCE}>
        <SourceTag observedMs={listing.latest?.observedMs ?? null} />
      </p>
    </li>
  );
}

function HistoryRows({ google }: { google: GoogleCheckView }) {
  const byPlace = new Map(google.listings.map((l) => [l.placeId, kindOf(l)]));
  return (
    <ul className="divide-y divide-border">
      {google.history.map((h) => {
        const kind = byPlace.get(h.placeId);
        const mark =
          kind === 'tentative' || kind === 'rejected' || kind === 'detached'
            ? BUSINESS_GOOGLE_HISTORY_MARK[kind]
            : null;
        return (
          <li
            key={h.observationId}
            data-testid={`business-google-history-row-${h.observationId}`}
            data-places-content=""
            className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <p className="min-w-0 text-base font-normal break-words">
              <span className="tabular-nums">{longDate(h.observedMs)}</span>
              {/* A pending listing's check is never a sentence (D-05) — and nor is a REJECTED
                  one's (C-WR-13): a human confirmed it is NOT this business, so its website
                  signal is another business's and must never read as a fact about this one. */}
              {kind === 'tentative' || kind === 'rejected' ? null : (
                <> · {signalSentence(h.hostClass)}</>
              )}
              {mark === null ? null : <span className="text-muted-foreground"> · {mark}</span>}
              {' · '}
              <Link href={`/runs/${h.runId}`} className={`${INLINE_LINK} tabular-nums`}>
                {BUSINESS_GOOGLE_HISTORY_RUN(shortDate(h.observedMs))}
              </Link>
            </p>
            <p className="text-sm font-normal">
              <GoogleMapsTag />
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyCheck({ business }: { business: GoogleCheckBusiness }) {
  const body =
    business.cluster === null
      ? BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED('cluster')
      : business.city === null
        ? BUSINESS_GOOGLE_EMPTY_BODY_UNCOVERED('city')
        : BUSINESS_GOOGLE_EMPTY_BODY(business.city, business.cluster);
  return (
    <Empty data-testid="business-google-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapPin aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-xl font-semibold">{BUSINESS_GOOGLE_EMPTY_HEADING}</EmptyTitle>
        <EmptyDescription className="max-w-[60ch] text-base font-normal">{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" className="h-11">
          <Link href="/presets">{BUSINESS_GOOGLE_EMPTY_ACTION}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function GoogleCheck({
  google,
  business,
  actors,
}: {
  google: GoogleCheckView;
  business: GoogleCheckBusiness;
  /** Clerk user id → display name (the route's `actorNames`); an unresolved id prints as itself. */
  actors: Readonly<Record<string, string>>;
}) {
  const { signal, listings } = google;
  const hasTentative = listings.some((l) => l.status === 'tentative');
  const only = listings.length === 1 ? listings[0] : undefined;
  // One attached listing and nothing else: row 1 carries its actions, and no listing row renders.
  const merged = signal !== null && only !== undefined && only.status === 'attached' ? only : null;

  let rowOne: ReactNode;
  if (signal !== null) {
    rowOne = (
      <div
        data-testid="business-google-signal"
        data-host-class={signal.hostClass}
        data-places-content=""
        className={ROW}
      >
        <dt className={LABEL}>{BUSINESS_GOOGLE_SIGNAL_LABEL}</dt>
        <dd className={VALUE}>
          <span>{signalSentence(signal.hostClass)}</span>
          {merged === null ? null : <ListingActions listing={merged} business={business} />}
        </dd>
        <dd className={SOURCE}>
          <SourceTag observedMs={signal.observedMs} dateTestId="business-google-signal-date" />
        </dd>
      </div>
    );
  } else if (hasTentative) {
    // Not a Places value — a statement about our own review state — so no tag, no container.
    rowOne = (
      <div data-testid="business-google-signal" className={ROW}>
        <dt className={LABEL}>{BUSINESS_GOOGLE_SIGNAL_LABEL}</dt>
        <dd className={VALUE}>{BUSINESS_GOOGLE_ONLY_TENTATIVE}</dd>
        <dd className={SOURCE} />
      </div>
    );
  } else {
    rowOne = null;
  }

  const rows = merged === null ? listings : [];

  return (
    <Card data-testid="business-google" data-business-id={business.id}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{BUSINESS_GOOGLE_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rowOne === null ? (
          <EmptyCheck business={business} />
        ) : (
          <dl className="divide-y divide-border">{rowOne}</dl>
        )}
        {rows.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((l, i) => (
              <ListingRow
                key={l.attachmentId}
                listing={l}
                index={i + 1}
                business={business}
                actors={actors}
              />
            ))}
          </ul>
        ) : null}
        {google.history.length > 1 ? (
          <GoogleCheckHistory count={google.history.length}>
            <HistoryRows google={google} />
          </GoogleCheckHistory>
        ) : null}
      </CardContent>
    </Card>
  );
}
