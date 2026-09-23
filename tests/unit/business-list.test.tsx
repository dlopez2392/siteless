import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessListRow } from '@/server/queries/businesses';

/**
 * `/businesses` (03-18) — the render contract of the list and the search box's behaviour.
 *
 * What this pins, one named test per property:
 *   - Sources are plain muted text joined with a middle dot, never badges (Executor Rule 22).
 *   - An unmapped row reads "No cluster mapped" — visible, never blank (D-02).
 *   - Every link carries the internal uuid; the lead key is never a route parameter
 *     (Executor Rule 18). The list row does not even carry the lead key.
 *   - The Closed badge's date is America/Chicago: ONE instant that is Sep 3 in UTC and Sep 2
 *     in Chicago. The suite runs in UTC (vitest.config.ts), so a formatter that forgot the
 *     zone renders Sep 3 and this goes red — Chicago only ever as half a pair.
 *   - `display_name` renders verbatim, accents intact (D-12).
 *   - The search box writes the URL with a debounced `replace`, never `push`; it never
 *     blanks what is being typed when the URL catches up; it follows a URL change it did not
 *     make (Clear search); it autofocuses on desk only.
 *
 * `next/navigation`, `next/link` and `useIsDesk` are factory-mocked: the real
 * `run-drawer.tsx` imports a server action, whose `src/db/` import throws outside a
 * react-server build, and this lane leaves that guard armed on purpose.
 */

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
  desk: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
  usePathname: () => '/businesses',
  useSearchParams: () => nav.params,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/preset-detail/run-drawer', () => ({ useIsDesk: () => nav.desk }));

import { BusinessCards } from '@/components/business-list/business-cards';
import { BusinessFilters } from '@/components/business-list/business-filters';
import { BusinessTable } from '@/components/business-list/business-table';

// vitest globals are off, so Testing Library's automatic cleanup never registers.
afterEach(cleanup);

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const ACTIVE_ID = '7ea03b52-da41-4fa7-85df-4ea253aac068';
const UNMAPPED_ID = '0198f3a1-9c2d-7c3e-8f21-6b5a4d3c2e10';
const CLOSED_ID = '5b1c7d2e-3f40-4a51-9b62-7c83d94ea5f6';

/** 2026-09-03 03:00 UTC = 2026-09-02 22:00 America/Chicago. Opposite days by zone. */
const CLOSED_AT = new Date(Date.UTC(2026, 8, 3, 3, 0, 0));

const ROWS: BusinessListRow[] = [
  {
    id: ACTIVE_ID,
    displayName: 'Taquería La Güera',
    city: 'McAllen',
    clusterName: 'Food & hospitality',
    sources: ['tx_comptroller', 'overture'],
    status: 'active',
    closedAt: null,
  },
  {
    id: UNMAPPED_ID,
    displayName: 'RGV Widgets',
    city: null,
    clusterName: null,
    sources: ['overture'],
    status: 'active',
    closedAt: null,
  },
  {
    id: CLOSED_ID,
    displayName: 'Old Shop',
    city: 'Edinburg',
    clusterName: 'Auto & retail',
    sources: ['tx_comptroller', 'tx_comptroller_closures'],
    status: 'closed',
    closedAt: CLOSED_AT,
  },
];

function renderList() {
  return render(
    <>
      <BusinessTable rows={ROWS} />
      <BusinessCards rows={ROWS} />
    </>,
  );
}

describe('business list', () => {
  it('business list: sources render as plain text joined with a middle dot, never badges', () => {
    renderList();
    const row = screen.getByTestId(`businesses-row-${ACTIVE_ID}`);
    const cell = within(row).getByText('Comptroller · Overture');
    expect(cell).toHaveClass('text-muted-foreground');
    expect(cell.closest('[data-slot="badge"]')).toBeNull();
    // Across the whole screen, no badge carries a source name.
    for (const badge of document.querySelectorAll('[data-slot="badge"]')) {
      expect(badge.textContent).not.toMatch(/Comptroller|Overture|Census/);
    }
    const card = screen.getByTestId(`businesses-card-${ACTIVE_ID}`);
    expect(within(card).getByText('Comptroller · Overture').closest('[data-slot="badge"]')).toBeNull();
  });

  it('business list: an unmapped row reads No cluster mapped, muted, on both breakpoints', () => {
    renderList();
    const cell = within(screen.getByTestId(`businesses-row-${UNMAPPED_ID}`)).getByText(
      'No cluster mapped',
    );
    expect(cell).toHaveClass('text-muted-foreground');
    // The card's place line; with no city it is the cluster alone.
    expect(
      within(screen.getByTestId(`businesses-card-${UNMAPPED_ID}`)).getByText('No cluster mapped'),
    ).toBeInTheDocument();
  });

  it('business list: every link carries the internal uuid, and only the name cell is a link on desk', () => {
    renderList();
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    // Three names in the table, three whole cards.
    expect(hrefs).toHaveLength(6);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/businesses\/[0-9a-f-]{36}$/);
      expect(href).not.toMatch(/SL-/);
    }
    const row = screen.getByTestId(`businesses-row-${ACTIVE_ID}`);
    const links = within(row).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Taquería La Güera');
    expect(row.tagName).toBe('TR');
  });

  it('business list: Closed carries the America/Chicago date, and Active shows no badge', () => {
    renderList();
    const closedRow = screen.getByTestId(`businesses-row-${CLOSED_ID}`);
    const badge = within(closedRow).getByText('Closed Sep 2, 2026');
    expect(badge.closest('[data-slot="badge"]')).toHaveClass('bg-destructive-surface');
    expect(within(closedRow).queryByText('Closed Sep 3, 2026')).toBeNull();

    const activeRow = screen.getByTestId(`businesses-row-${ACTIVE_ID}`);
    expect(activeRow.querySelector('[data-slot="badge"]')).toBeNull();
    // The word still exists for a screen reader.
    expect(within(activeRow).getByText('Active')).toHaveClass('sr-only');
  });

  it('business list: display_name renders verbatim, accents intact', () => {
    renderList();
    expect(
      within(screen.getByTestId(`businesses-card-${ACTIVE_ID}`)).getByText('Taquería La Güera'),
    ).toBeInTheDocument();
  });
});

describe('businesses search', () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.push.mockReset();
    nav.params = new URLSearchParams();
    nav.desk = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const noClusters = () => Promise.resolve([]);

  it('businesses search: debounced router.replace, never push, limit dropped', () => {
    vi.useFakeTimers();
    nav.params = new URLSearchParams('status=closed&limit=150');
    render(<BusinessFilters clusters={noClusters()} />);
    const input = screen.getByTestId('businesses-search');

    fireEvent.change(input, { target: { value: 'ta' } });
    fireEvent.change(input, { target: { value: 'taq' } });
    expect(nav.replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith('/businesses?status=closed&q=taq', { scroll: false });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('businesses search: the box keeps what is being typed when the URL catches up', () => {
    vi.useFakeTimers();
    const { rerender } = render(<BusinessFilters clusters={noClusters()} />);
    const input = screen.getByTestId('businesses-search') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'taq' } });
    act(() => vi.advanceTimersByTime(300));
    // Two more characters typed before the navigation lands.
    fireEvent.change(input, { target: { value: 'taque' } });

    nav.params = new URLSearchParams('q=taq');
    rerender(<BusinessFilters clusters={noClusters()} />);
    expect(input.value).toBe('taque');
  });

  it('businesses search: a URL change it did not make (Clear search) empties the box', () => {
    vi.useFakeTimers();
    const { rerender } = render(<BusinessFilters clusters={noClusters()} />);
    const input = screen.getByTestId('businesses-search') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'nomatch' } });
    act(() => vi.advanceTimersByTime(300));
    nav.params = new URLSearchParams('q=nomatch');
    rerender(<BusinessFilters clusters={noClusters()} />);
    expect(input.value).toBe('nomatch');

    nav.params = new URLSearchParams();
    rerender(<BusinessFilters clusters={noClusters()} />);
    expect(input.value).toBe('');
  });

  it('businesses search: autofocus on desk only', () => {
    nav.desk = false;
    const phone = render(<BusinessFilters clusters={noClusters()} />);
    expect(screen.getByTestId('businesses-search')).not.toHaveFocus();
    phone.unmount();

    nav.desk = true;
    render(<BusinessFilters clusters={noClusters()} />);
    expect(screen.getByTestId('businesses-search')).toHaveFocus();
  });

  it('businesses search: 48px, 16px text at every width', () => {
    render(<BusinessFilters clusters={noClusters()} />);
    const input = screen.getByTestId('businesses-search');
    expect(input).toHaveClass('h-12', 'text-base', 'md:text-base');
    expect(input).toHaveAccessibleName('Search by name or lead key');
  });
});
