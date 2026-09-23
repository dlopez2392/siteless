import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessListRow } from '@/server/queries/businesses';
import type { CandidatePairView, CandidateSideView } from '@/server/queries/review-queue';

/**
 * The `Closed` badge is ONE treatment wherever it appears (03-22 screen review). It was three
 * hand-written copies: the review card at 14/600 with padding, the `/businesses` list at 14/600
 * without, and the detail header at the Badge default, 12/500. That is below the UI-SPEC type
 * scale (Label 14), and a copy that drifted from the other two.
 *
 * jsdom paints nothing, so this pins the SHARED CLASS LIST: every call site renders the same
 * classes, including `text-sm font-semibold` (14px / 600). The painted values (font-size 14px,
 * weight 600, the destructive-surface pair) are measured by computed style on the built app in
 * docs/measurements/03-gate-mutations.md.
 */
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DetailHeader } from '@/components/business-detail/detail-header';
import { BusinessStatusBadge } from '@/components/business-list/business-cards';
import { CandidatePair } from '@/components/review/candidate-pair';

afterEach(cleanup);

/** 03:00 UTC on Sep 3 is Sep 2 in Chicago. The suite runs in UTC. */
const CLOSED_AT = new Date(Date.UTC(2026, 8, 3, 3, 0, 0));

const side = (over: Partial<CandidateSideView>): CandidateSideView => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  displayName: 'Old Shop',
  street: '100 N Main St',
  city: 'Edinburg',
  postal: '78539',
  phoneE164: null,
  basicCategory: null,
  clusterName: null,
  sourceKey: 'tx_comptroller',
  closedAt: null,
  chain: null,
  ...over,
});

const PAIR: CandidatePairView = {
  candidateId: '00000000-0000-4000-8000-0000000000c1',
  score: 88,
  features: {},
  a: side({ closedAt: CLOSED_AT }),
  b: side({ id: '00000000-0000-4000-8000-0000000000a2', sourceKey: 'overture' }),
};

const ROW: BusinessListRow = {
  id: '5b1c7d2e-3f40-4a51-9b62-7c83d94ea5f6',
  displayName: 'Old Shop',
  city: 'Edinburg',
  clusterName: null,
  sources: ['tx_comptroller'],
  status: 'closed',
  closedAt: CLOSED_AT,
};

const classesOf = (el: HTMLElement) => [...el.classList].sort();

describe('closed badge', () => {
  it('the Closed badge is one treatment on the review card, the list and the detail header', () => {
    render(
      <DetailHeader
        displayName="Old Shop"
        leadKey="SL-2K9QXM"
        status="active"
        closedAt={CLOSED_AT}
        chainLabel={null}
        mergedInto={null}
      />,
    );
    const detail = screen.getByTestId('business-badge-closed');
    cleanup();

    render(<CandidatePair pair={PAIR} />);
    const review = screen.getByTestId('review-side-a-closed');
    cleanup();

    const { container } = render(<BusinessStatusBadge row={ROW} />);
    const list = within(container).getByText(/^Closed/);

    for (const el of [detail, review, list]) {
      expect(el).toHaveTextContent('Closed Sep 2, 2026');
      expect(el.classList.contains('text-sm')).toBe(true);
      expect(el.classList.contains('font-semibold')).toBe(true);
      expect(el.classList.contains('bg-destructive-surface')).toBe(true);
      expect(el.classList.contains('text-destructive-surface-foreground')).toBe(true);
    }
    expect(classesOf(review)).toEqual(classesOf(detail));
    expect(classesOf(list)).toEqual(classesOf(detail));
  });
});
