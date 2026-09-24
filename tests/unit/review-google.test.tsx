import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * `/review`'s Google listing item (04-UI-SPEC § Screen 3; D-05, D-08, D-11; Executor Rules 28,
 * 30, 31): the spine record through the reused Phase 3 card, the chips, the reason it is
 * tentative, and ONE Google Maps tag in the bordered card that holds every Places-derived value.
 *
 * 🔴 RULE 30 / T-4-05: the card renders the SPINE's own fields, copy strings and numbers only.
 * `the google listing card renders no Google text` removes every string the card is allowed to
 * say from its text and asserts nothing else is left over. The fixture carries SENTINEL values
 * wherever a later change could try to smuggle Google text in (an unknown feature key, an
 * extra field on the view): none of them may reach the DOM.
 */
import { GoogleListingCard } from '@/components/review/google-listing-card';
import {
  ReviewDuplicatesClear,
  ReviewGoogleClear,
  ReviewQueueClear,
} from '@/components/review/review-empty';
import { ReviewFilter } from '@/components/review/review-filter';
import {
  parseReviewKind,
  parseSkipped,
  reviewEmptyKind,
  reviewHref,
  reviewRemainingText,
  SKIPPED_MAX,
  withSkipped,
} from '@/lib/ui/review-kind';
import {
  GOOGLE_MAPS_LINK_SR_SUFFIX,
  GOOGLE_MAPS_TAG,
  REVIEW_GOOGLE_CARD_BODY,
  REVIEW_GOOGLE_CARD_TITLE,
  REVIEW_GOOGLE_COMPARED,
  REVIEW_GOOGLE_OPEN_MAPS,
  REVIEW_GOOGLE_REASON_SCORE,
  REVIEW_GOOGLE_REASON_TIE,
  REVIEW_CLEAR_BODY_WITH_GOOGLE,
  REVIEW_SIDE_LABEL,
  SOURCE_TAG,
} from '@/lib/ui/copy';
import { mapsUrlFor, placesChips } from '@/lib/ui/places-format';
import { displayPhone } from '@/lib/ui/review-format';
import type { GoogleListingView } from '@/server/queries/review-queue';

afterEach(cleanup);

const ATTACHMENT = '22222222-2222-4222-8222-222222222222';
const TIE_BUSINESS = '33333333-3333-4333-8333-333333333333';

/** The matcher's stored features for a service-area listing (src/lib/places/match.ts). */
const FEATURES = {
  name: 38,
  phone: 0,
  cluster: 5,
  city: 1,
  sab: 1,
  listingPhone: 1,
  listingLocation: 0,
  // An unknown key carrying text must never render (placesChips reads known numeric keys only).
  displayName: 'SENTINEL Google Name',
};

function listing(over: Partial<GoogleListingView> = {}): GoogleListingView {
  const item: GoogleListingView = {
    kind: 'google',
    attachmentId: ATTACHMENT,
    placeId: 'ChIJ-sentinel-place',
    score: 88,
    reason: 'score',
    features: FEATURES,
    business: {
      id: '44444444-4444-4444-8444-444444444444',
      displayName: 'Valley Locksmith & Key',
      street: '2100 N 23rd St',
      city: 'McAllen',
      postal: '78501',
      phoneE164: '+19566821234',
      basicCategory: 'locksmith',
      clusterName: 'Home services & trades',
      sourceKey: 'tx_comptroller',
      closedAt: null,
      chain: null,
    },
    tie: null,
    ...over,
  };
  // A view that someday carries a Google field anyway: the card must not know it exists.
  return Object.assign(item, {
    googleName: 'SENTINEL Google Name',
    formattedAddress: 'SENTINEL 1 Google Way',
  });
}

const TIE = listing({
  reason: 'tie',
  score: 97,
  tie: { businessId: TIE_BUSINESS, displayName: 'Valley Lock Co', score: 96 },
});

describe('google listing card', () => {
  it('the google listing card shows the spine side, chips, reason and one Google Maps tag', () => {
    const item = listing();
    render(<GoogleListingCard item={item} />);

    const root = screen.getByTestId('review-google');
    expect(root).toHaveAttribute('data-kind', 'google');

    // The spine record is the reused Phase 3 card: name, address, phone, category, source tag,
    // and the focus hook the queue advance moves focus to.
    const side = within(screen.getByTestId('review-google-side'));
    const name = side.getByRole('heading', { level: 2 });
    expect(name).toHaveTextContent('Valley Locksmith & Key');
    expect(name).toHaveAttribute('tabindex', '-1');
    expect(name).toHaveAttribute('data-review-focus');
    expect(side.getByText('2100 N 23rd St, McAllen 78501')).toBeInTheDocument();
    expect(side.getByText(displayPhone('+19566821234'))).toBeInTheDocument();
    expect(side.getByText('locksmith · Home services & trades')).toBeInTheDocument();
    expect(side.getByText(SOURCE_TAG.tx_comptroller)).toBeInTheDocument();

    // Everything Places-derived sits in ONE bordered card with exactly one attribution tag.
    const card = screen.getByTestId('review-google-listing');
    expect(card).toHaveAttribute('data-slot', 'card');
    expect(card).toHaveAttribute('data-places-content');
    expect(within(card).getAllByTestId('google-maps-attribution')).toHaveLength(1);
    expect(within(root).getAllByTestId('google-maps-attribution')).toHaveLength(1);
    expect(
      within(card).getByRole('heading', { name: REVIEW_GOOGLE_CARD_TITLE }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(REVIEW_GOOGLE_CARD_BODY);
    expect(card).toHaveTextContent(REVIEW_GOOGLE_COMPARED);

    // The chips are placesChips over the stored features, in its order, inside the card.
    const chips = within(card).getByTestId('review-chips');
    const labels = [...chips.querySelectorAll('[data-chip]')].map((c) => c.textContent);
    expect(labels).toEqual(placesChips(item.features).map((c) => c.label));
    expect(labels).toEqual(
      expect.arrayContaining(['city match', 'service-area business', 'no location on the listing']),
    );
    expect(chips.querySelector('[data-chip="sab"]')).toHaveAttribute('data-agrees', 'false');
    expect(chips.querySelector('[data-chip="city"]')).toHaveAttribute('data-agrees', 'true');

    const reason = within(card).getByTestId('review-tentative-reason');
    expect(reason).toHaveAttribute('data-reason', 'score');
    expect(reason).toHaveTextContent(REVIEW_GOOGLE_REASON_SCORE(88));
    expect(within(reason).queryByRole('link')).toBeNull();

    // No map, ever (Rule 31): no iframe, no image.
    expect(root.querySelector('iframe, img')).toBeNull();
  });

  it('the tie reason names the other business as a link', () => {
    render(<GoogleListingCard item={TIE} />);
    const reason = screen.getByTestId('review-tentative-reason');
    expect(reason).toHaveAttribute('data-reason', 'tie');
    // The whole sentence is the copy module's, word for word.
    expect(reason.textContent).toBe(REVIEW_GOOGLE_REASON_TIE(97, 'Valley Lock Co', 96));
    const link = within(reason).getByRole('link', { name: 'Valley Lock Co' });
    expect(link).toHaveAttribute('href', `/businesses/${TIE_BUSINESS}`);
    // An in-app link: no new tab.
    expect(link).not.toHaveAttribute('target');
  });

  it('the open-on-Google-Maps link is built from the place id and opens safely', () => {
    const item = listing();
    render(<GoogleListingCard item={item} />);
    const link = screen.getByTestId('review-google-open-maps');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute(
      'href',
      mapsUrlFor('ChIJ-sentinel-place', 'Valley Locksmith & Key', 'McAllen'),
    );
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Valley%20Locksmith%20%26%20Key%2C%20McAllen&query_place_id=ChIJ-sentinel-place',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(`${REVIEW_GOOGLE_OPEN_MAPS} ${GOOGLE_MAPS_LINK_SR_SUFFIX}`);
    const suffix = within(link).getByText(GOOGLE_MAPS_LINK_SR_SUFFIX);
    expect(suffix).toHaveClass('sr-only');
    const icon = link.querySelector('[data-icon="external-link"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // 44px, outline (UI-SPEC § Accessibility & Touch).
    expect(link).toHaveClass('h-11');
    expect(link).toHaveAttribute('data-variant', 'outline');
  });

  it('the google listing card renders no Google text', () => {
    for (const item of [listing(), TIE]) {
      const { unmount } = render(<GoogleListingCard item={item} />);
      const text = screen.getByTestId('review-google').textContent ?? '';

      expect(text).not.toContain('SENTINEL');
      expect(text).not.toContain('ChIJ');

      // Every string the card is allowed to say, longest first so a sentence goes before its parts.
      const allowed = [
        REVIEW_GOOGLE_CARD_TITLE,
        REVIEW_GOOGLE_CARD_BODY,
        REVIEW_GOOGLE_OPEN_MAPS,
        GOOGLE_MAPS_LINK_SR_SUFFIX,
        REVIEW_GOOGLE_COMPARED,
        GOOGLE_MAPS_TAG,
        item.tie
          ? REVIEW_GOOGLE_REASON_TIE(item.score, item.tie.displayName, item.tie.score)
          : REVIEW_GOOGLE_REASON_SCORE(item.score),
        ...placesChips(item.features).map((c) => c.label),
        // The spine side: our own record, never Google's.
        `${REVIEW_SIDE_LABEL.phone.a}: `,
        `${REVIEW_SIDE_LABEL.desk.a}: `,
        item.business.displayName,
        '2100 N 23rd St, McAllen 78501',
        displayPhone('+19566821234'),
        'locksmith · Home services & trades',
        SOURCE_TAG.tx_comptroller,
      ].sort((a, b) => b.length - a.length);

      let rest = text;
      for (const s of allowed) rest = rest.split(s).join(' ');
      // What is left is whitespace and punctuation — no word the card did not get from us.
      expect(rest).toMatch(/^[\s\d.,:·()]*$/);
      unmount();
    }
  });
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '55555555-5555-4555-8555-555555555555';

describe('review filter and queue lines', () => {
  beforeEach(() => {
    push.mockReset();
  });

  it('the review filter reflects the URL', async () => {
    // The page parses `?kind=` and hands the filter its value; anything unknown reads as all.
    expect(parseReviewKind('google')).toBe('google');
    expect(parseReviewKind(['duplicates', 'google'])).toBe('duplicates');
    expect(parseReviewKind('GOOGLE')).toBe('all');
    expect(parseReviewKind(undefined)).toBe('all');

    render(<ReviewFilter kind="google" skipped={[A]} />);
    const group = screen.getByTestId('review-filter');
    expect(within(group).getAllByRole('radio')).toHaveLength(3);

    const google = screen.getByTestId('review-filter-google');
    expect(google).toHaveAttribute('aria-checked', 'true');
    expect(google).toHaveTextContent('Google');
    expect(google).toHaveAccessibleName('Google listings');
    expect(screen.getByTestId('review-filter-all')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('review-filter-all')).toHaveTextContent('All');
    // 44px toggles.
    for (const id of ['review-filter-all', 'review-filter-duplicates', 'review-filter-google']) {
      expect(screen.getByTestId(id)).toHaveClass('min-h-11');
    }

    await act(async () => {
      fireEvent.click(screen.getByTestId('review-filter-duplicates'));
    });
    expect(push).toHaveBeenCalledTimes(1);
    // The session's skipped listings travel with the filter.
    expect(push).toHaveBeenCalledWith(`/review?kind=duplicates&skip=${A}`);

    // Pressing the selected toggle again is not "no filter": nothing navigates.
    push.mockReset();
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-filter-duplicates'));
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('the remaining count names both kinds', () => {
    const counts = { pairs: 3, google: 2 };
    expect(reviewRemainingText('all', { remaining: 5, counts })).toBe(
      '5 left to review · 3 duplicate pairs, 2 Google listings',
    );
    expect(reviewRemainingText('all', { remaining: 2, counts: { pairs: 1, google: 1 } })).toBe(
      '2 left to review · 1 duplicate pair, 1 Google listing',
    );
    expect(reviewRemainingText('google', { remaining: 2, counts })).toBe(
      '2 Google listings left to review',
    );
    expect(reviewRemainingText('google', { remaining: 1, counts })).toBe(
      '1 Google listing left to review',
    );
    // Duplicates keep the inherited Phase 3 line.
    expect(reviewRemainingText('duplicates', { remaining: 3, counts })).toBe(
      '3 pairs left to review',
    );
    expect(
      reviewRemainingText('all', { remaining: 1284, counts: { pairs: 1284, google: 0 } }),
    ).toBe('1,284 left to review · 1,284 duplicate pairs, 0 Google listings');
  });

  it('the google empty state offers the duplicates', () => {
    const counts = { pairs: 3, google: 0 };
    expect(reviewEmptyKind('google', { counts, ingested: true })).toBe('google-clear');
    render(<ReviewGoogleClear pairs={3} href={reviewHref('duplicates', [A])} />);
    const empty = screen.getByTestId('review-google-clear');
    expect(within(empty).getByRole('heading', { level: 2 })).toHaveTextContent(
      'No Google listings to review',
    );
    expect(empty).toHaveTextContent(
      'Every tentative Google listing has a decision. 3 duplicate pairs are still waiting.',
    );
    const action = within(empty).getByRole('link', { name: 'Show duplicates' });
    expect(action).toHaveAttribute('href', `/review?kind=duplicates&skip=${A}`);
    expect(empty.querySelector('[data-icon="map-pin-check"]')).not.toBeNull();
  });

  it('the duplicates empty state offers the Google listings', () => {
    expect(reviewEmptyKind('duplicates', { counts: { pairs: 0, google: 1 }, ingested: true })).toBe(
      'duplicates-clear',
    );
    render(<ReviewDuplicatesClear listings={1} href={reviewHref('google')} />);
    const empty = screen.getByTestId('review-duplicates-clear');
    expect(empty).toHaveTextContent('No duplicate pairs to review');
    expect(empty).toHaveTextContent(
      'Every duplicate pair has a decision. 1 Google listing is still waiting.',
    );
    expect(within(empty).getByRole('link', { name: 'Show Google listings' })).toHaveAttribute(
      'href',
      '/review?kind=google',
    );
  });

  it('queue clear covers both kinds, and a filter with nothing of either kind is queue clear', () => {
    expect(reviewEmptyKind('all', { counts: { pairs: 0, google: 0 }, ingested: true })).toBe(
      'queue-clear',
    );
    expect(reviewEmptyKind('google', { counts: { pairs: 0, google: 0 }, ingested: true })).toBe(
      'queue-clear',
    );
    expect(reviewEmptyKind('google', { counts: { pairs: 0, google: 0 }, ingested: false })).toBe(
      'nothing-yet',
    );
    render(<ReviewQueueClear />);
    expect(screen.getByTestId('review-queue-clear')).toHaveTextContent(
      REVIEW_CLEAR_BODY_WITH_GOOGLE,
    );
  });

  it('the review URL carries only valid skipped listing ids', () => {
    // Anything but a uuid is dropped before it can reach SQL; duplicates collapse.
    expect(parseSkipped(`${A},not-a-uuid,${A.toUpperCase()}, ${B}`)).toEqual([A, B]);
    expect(parseSkipped([A, `${B},x`])).toEqual([A, B]);
    expect(parseSkipped(undefined)).toEqual([]);
    expect(parseSkipped("1' or '1'='1")).toEqual([]);

    // Skipping appends at the newest end; past the cap the oldest fall off.
    expect(withSkipped([A], B)).toEqual([A, B]);
    expect(withSkipped([A, B], A)).toEqual([B, A]);
    const many = Array.from(
      { length: SKIPPED_MAX },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const capped = withSkipped(many, B);
    expect(capped).toHaveLength(SKIPPED_MAX);
    expect(capped.at(-1)).toBe(B);
    expect(capped[0]).toBe(many[1]);

    expect(reviewHref('google')).toBe('/review?kind=google');
    expect(reviewHref('all', [A, B])).toBe(`/review?kind=all&skip=${A},${B}`);
  });
});
