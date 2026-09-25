import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The business detail's "Google Maps check" card (04-25; 04-UI-SPEC § Screen 5; D-05, D-08,
 * D-09, D-10, D-11; Executor Rules 22, 28, 30, 32).
 *
 * 🔴 THE DETACH ACTION IS FACTORY-MOCKED. `detach-listing.ts` carries the server directive and
 * pulls in `src/db/`, whose `import 'server-only'` throws in the dom lane by design. Nothing here
 * presses detach; the dialog's contract is `detach-dialog.test.tsx`, and the action's own
 * refusals are proven against the real database in tests/db/listing-actions.test.ts (04-21).
 *
 * 🔴 THE SUITE RUNS IN UTC. Every fixture instant is 03:30 UTC, the evening before in Chicago,
 * so a date printed in the process zone reads a day late and goes red.
 */
vi.mock('@/server/actions/detach-listing', () => ({ detachListing: vi.fn() }));
// `useIsDesk` lives in run-drawer.tsx, which also imports the queue-run action — same reason.
vi.mock('@/server/actions/queue-run', () => ({ queueRun: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { GoogleCheck } from '@/components/business-detail/google-check';
import { HOST_CLASS_SENTENCE } from '@/lib/ui/copy';
import { mapsUrlFor } from '@/lib/ui/places-format';
import type { GoogleCheckView } from '@/server/queries/businesses';
import {
  EMPTY_CHECK,
  GOOGLE_ACTORS,
  GOOGLE_BUSINESS,
  IDS,
  MIXED,
  ONE_ATTACHED,
  ONLY_TENTATIVE,
  PLACE,
  TWO_WEEKS_AGO_MS,
} from './fixtures/google-check';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

const SIX_SENTENCES = Object.values(HOST_CLASS_SENTENCE);

function renderCheck(google: GoogleCheckView, business = GOOGLE_BUSINESS) {
  return render(<GoogleCheck google={google} business={business} actors={GOOGLE_ACTORS} />);
}

function tagsIn(el: HTMLElement) {
  return el.querySelectorAll('[data-testid="google-maps-attribution"]');
}

/** The `[data-places-content]` container an element sits in. */
function placesContainerOf(el: HTMLElement): HTMLElement {
  const container = el.closest('[data-places-content]');
  if (!(container instanceof HTMLElement)) throw new Error('no [data-places-content] container');
  return container;
}

describe('google maps check', () => {
  it('the google check shows the business signal with the Google Maps tag and date', () => {
    renderCheck(MIXED);
    const card = screen.getByTestId('business-google');
    expect(within(card).getByText('Google Maps check')).toBeInTheDocument();

    const signal = screen.getByTestId('business-google-signal');
    expect(signal).toHaveAttribute('data-host-class', 'business_site_dead');
    expect(signal).toHaveTextContent('Website on Google');
    expect(signal).toHaveTextContent('Website listed — a dead Google site (business.site)');

    // One tag, in the row's own Places container.
    const container = placesContainerOf(signal);
    expect(container).toBe(signal);
    expect(tagsIn(container)).toHaveLength(1);

    // The date is a SEPARATE muted span: the tag's colour and font never extend to it.
    const tag = tagsIn(container)[0] as HTMLElement;
    expect(tag).toHaveTextContent(/^Google Maps$/);
    const date = within(signal).getByTestId('business-google-signal-date');
    expect(tag.contains(date)).toBe(false);
    expect(date.contains(tag)).toBe(false);
    expect(date).toHaveClass('text-muted-foreground');
    expect(date).toHaveClass('tabular-nums');
    // Two zones: 03:30 UTC Sep 23 is Sep 22 in Chicago.
    expect(date).toHaveTextContent('· Sep 22');
    expect(date).not.toHaveTextContent('Sep 23');

    // Rule 30: never a URL, never Google's text.
    expect(card.textContent).not.toMatch(/https?:\/\//);
  });

  it('the listings render attached, then tentative, then rejected and detached', () => {
    const { container } = renderCheck(MIXED);
    const rows = [...container.querySelectorAll('[data-testid^="business-google-listing-"]')].map(
      (r) => [r.getAttribute('data-testid'), r.getAttribute('data-status')],
    );
    expect(rows).toEqual([
      [`business-google-listing-${IDS.attachedA}`, 'attached'],
      [`business-google-listing-${IDS.attachedB}`, 'attached'],
      [`business-google-listing-${IDS.tentative}`, 'tentative'],
      [`business-google-listing-${IDS.rejected}`, 'rejected'],
      [`business-google-listing-${IDS.detached}`, 'detached'],
    ]);
  });

  it('an attached listing shows its own signal, a tag, the Google Maps link and detach', () => {
    renderCheck(MIXED);
    const row = screen.getByTestId(`business-google-listing-${IDS.attachedB}`);
    expect(row).toHaveTextContent('Listing 2 · attached at 91');
    expect(row).toHaveTextContent('Website listed — a social page, not a website');
    expect(placesContainerOf(row)).toBe(row);
    expect(tagsIn(row)).toHaveLength(1);
    expect(row).toHaveTextContent('· Sep 15');

    const open = within(row).getByTestId(`business-google-open-maps-${IDS.attachedB}`);
    expect(open).toHaveAttribute(
      'href',
      mapsUrlFor(PLACE.b, GOOGLE_BUSINESS.displayName, GOOGLE_BUSINESS.city),
    );
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(open).toHaveAccessibleName('Open this listing on Google Maps (opens Google Maps)');
    expect(within(row).getByTestId(`business-google-detach-${IDS.attachedB}`)).toHaveTextContent(
      'Detach this listing',
    );
  });

  it('a tentative listing shows no website sentence', () => {
    renderCheck(MIXED);
    const row = screen.getByTestId(`business-google-listing-${IDS.tentative}`);
    expect(row).toHaveAttribute('data-status', 'tentative');
    expect(row).toHaveTextContent('Listing 3');
    expect(within(row).getByText('Tentative')).toBeInTheDocument();
    expect(row).toHaveTextContent(
      "Pending review — scored 87. It isn't used for anything until someone confirms it.",
    );
    const review = within(row).getByRole('link', { name: 'Review it in the queue' });
    expect(review).toHaveAttribute('href', '/review?kind=google');
    // The score is Places-derived, so the row carries the tag (Rule 28)…
    expect(placesContainerOf(row)).toBe(row);
    expect(tagsIn(row)).toHaveLength(1);
    // …but never a signal sentence: an unconfirmed signal is not a fact (D-05).
    for (const sentence of SIX_SENTENCES) expect(row).not.toHaveTextContent(sentence);
    expect(within(row).queryByTestId(`business-google-detach-${IDS.tentative}`)).toBeNull();
    expect(within(row).queryByTestId(`business-google-open-maps-${IDS.tentative}`)).toBeNull();
  });

  it('rejected and detached listings show who and when and carry no tag', () => {
    renderCheck(MIXED);
    const rejected = screen.getByTestId(`business-google-listing-${IDS.rejected}`);
    expect(rejected).toHaveTextContent('Listing 4 · not this business');
    expect(rejected).toHaveTextContent('Rejected by danlo on Sep 22, 2026 — never attached again');

    const detached = screen.getByTestId(`business-google-listing-${IDS.detached}`);
    expect(detached).toHaveTextContent('Listing 5 · not this business');
    // An actor the lookup did not resolve prints as the stored id — never dropped.
    expect(detached).toHaveTextContent(
      'Detached by user_unresolved on Sep 15, 2026 — never attached again',
    );

    for (const row of [rejected, detached]) {
      expect(tagsIn(row)).toHaveLength(0);
      expect(row.closest('[data-places-content]')).toBeNull();
      expect(within(row).queryByRole('button')).toBeNull();
      expect(within(row).queryByRole('link')).toBeNull();
      for (const sentence of SIX_SENTENCES) expect(row).not.toHaveTextContent(sentence);
      // No score: nothing Places-derived is shown on a row with no tag.
      expect(row.textContent).not.toMatch(/\b(84|96)\b/);
    }
  });

  it('one attached listing renders once', () => {
    const { container } = renderCheck(ONE_ATTACHED);
    const signal = screen.getByTestId('business-google-signal');
    expect(signal).toHaveAttribute('data-host-class', 'none');
    expect(signal).toHaveTextContent('No website listed');
    expect(container.querySelectorAll('[data-testid^="business-google-listing-"]')).toHaveLength(0);
    // The signal row carries the listing's actions beneath it.
    expect(
      within(signal).getByTestId(`business-google-open-maps-${IDS.attachedA}`),
    ).toBeInTheDocument();
    expect(
      within(signal).getByTestId(`business-google-detach-${IDS.attachedA}`),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid^="business-google-open-maps-"]')).toHaveLength(
      1,
    );
    expect(tagsIn(signal)).toHaveLength(1);
    // One observation: no history toggle.
    expect(screen.queryByTestId('business-google-history-toggle')).toBeNull();
  });

  it('the empty google check says not checked yet', () => {
    renderCheck(EMPTY_CHECK);
    const empty = screen.getByTestId('business-google-empty');
    expect(empty).toHaveTextContent('Not checked on Google yet');
    expect(empty).toHaveTextContent(
      "It's checked the next time a run covers McAllen for Food & hospitality.",
    );
    expect(within(empty).getByRole('link', { name: 'Open presets' })).toHaveAttribute(
      'href',
      '/presets',
    );
    expect(tagsIn(screen.getByTestId('business-google'))).toHaveLength(0);
    expect(screen.queryByTestId('business-google-signal')).toBeNull();
  });

  it('the empty google check never names a run that cannot happen for an unmapped business', () => {
    renderCheck(EMPTY_CHECK, { ...GOOGLE_BUSINESS, city: null, cluster: null });
    const empty = screen.getByTestId('business-google-empty');
    expect(empty).toHaveTextContent('Not checked on Google yet');
    expect(empty).toHaveTextContent('no cluster mapped');
    expect(empty).not.toHaveTextContent('null');
    expect(empty).toHaveTextContent('so no run covers it yet');
    expect(empty).not.toHaveTextContent(/covers \S+ for/);
  });

  it('only tentative listings read as no confirmed listing yet', () => {
    renderCheck(ONLY_TENTATIVE);
    const signal = screen.getByTestId('business-google-signal');
    expect(signal).toHaveTextContent('No confirmed listing yet — one is pending review.');
    expect(signal).not.toHaveAttribute('data-host-class');
    expect(tagsIn(signal)).toHaveLength(0);
    expect(signal.closest('[data-places-content]')).toBeNull();
    // The pending listing itself still renders below, tagged, with no sentence.
    const row = screen.getByTestId(`business-google-listing-${IDS.tentative}`);
    expect(tagsIn(row)).toHaveLength(1);
    for (const sentence of SIX_SENTENCES)
      expect(screen.getByTestId('business-google')).not.toHaveTextContent(sentence);
    expect(screen.queryByTestId('business-google-empty')).toBeNull();
  });

  it("a rejected listing's past check never shows its website sentence here (C-WR-13)", async () => {
    // A human confirmed the rejected listing is NOT this business — its website signal is
    // another business's, a stronger case than the tentative one D-05 already excludes.
    const rejectedObs = '00000000-0000-4000-8000-00000000e005';
    const withRejected: GoogleCheckView = {
      ...MIXED,
      history: [
        ...MIXED.history,
        {
          observationId: rejectedObs,
          placeId: PLACE.r,
          observedMs: TWO_WEEKS_AGO_MS - 60_000,
          hadWebsiteUri: true,
          hostClass: 'other',
          runId: IDS.runTwoWeeks,
        },
      ],
    };
    renderCheck(withRejected);
    await act(async () => {
      fireEvent.click(screen.getByTestId('business-google-history-toggle'));
    });
    const row = screen.getByTestId(`business-google-history-row-${rejectedObs}`);
    for (const sentence of SIX_SENTENCES) expect(row).not.toHaveTextContent(sentence);
    // The mark and the run link stay: the check happened, and it was not this business.
    expect(row).toHaveTextContent('not this business');
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/runs/${IDS.runTwoWeeks}`);
    expect(tagsIn(row)).toHaveLength(1);
  });

  it('the check history is collapsed and newest first', async () => {
    renderCheck(MIXED);
    const toggle = screen.getByTestId('business-google-history-toggle');
    expect(toggle).toHaveTextContent('Show 4 earlier checks');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId(/^business-google-history-row-/)).toHaveLength(0);

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveTextContent('Hide earlier checks');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByTestId(/^business-google-history-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      `business-google-history-row-${IDS.obs1}`,
      `business-google-history-row-${IDS.obs4}`,
      `business-google-history-row-${IDS.obs2}`,
      `business-google-history-row-${IDS.obs3}`,
    ]);
    const runs = [IDS.runLate, IDS.runMid, IDS.runWeek, IDS.runTwoWeeks];
    rows.forEach((row, i) => {
      expect(within(row).getByRole('link')).toHaveAttribute('href', `/runs/${runs[i]}`);
      expect(placesContainerOf(row)).toBe(row);
      expect(tagsIn(row)).toHaveLength(1);
    });
    const [late, pending, week, detached] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(late).toHaveTextContent('Sep 22, 2026');
    expect(late).not.toHaveTextContent('Sep 23');
    expect(late).toHaveTextContent('Website listed — a dead Google site (business.site)');
    expect(within(late).getByRole('link')).toHaveTextContent('run Sep 22');
    // A pending listing's check is history, never a signal sentence (D-05).
    expect(pending).toHaveTextContent('pending review');
    for (const sentence of SIX_SENTENCES) expect(pending).not.toHaveTextContent(sentence);
    expect(week).toHaveTextContent('Website listed — a social page, not a website');
    // DETACH_BODY promises "Its past checks stay in the history, marked detached."
    expect(detached).toHaveTextContent('Website listed — a directory page, not a website');
    expect(detached).toHaveTextContent('detached');
    expect(late).not.toHaveTextContent('detached');
  });
});
