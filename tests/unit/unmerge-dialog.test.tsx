import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D-20 made visible: the merge history and the one destructive action in Phase 3 (03-19).
 *
 * 🔴 THE ACTION MODULE IS FACTORY-MOCKED. `unmerge-business.ts` carries the server directive
 * and pulls in `src/db/`, whose `import 'server-only'` throws in the dom lane by design. What
 * this file proves is the DIALOG's contract — always confirm, stay open on a refusal and show
 * the sentence the action chose, close and refresh only on `ok: true`, stay modal while the
 * write is in flight. The action's own refusals are proven against the real database in
 * tests/db/review-actions.test.ts (03-15); nothing here presses unmerge on real data.
 */
vi.mock('@/server/actions/unmerge-business', () => ({ unmergeBusiness: vi.fn() }));
// `useIsDesk` lives in run-drawer.tsx, which also imports the queue-run action — same reason.
vi.mock('@/server/actions/queue-run', () => ({ queueRun: vi.fn() }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { MergeHistory, type MergeRow } from '@/components/business-detail/merge-history';
import { UNMERGE_ALREADY_UNDONE, UNMERGE_FAILED, UNMERGE_LATER_MERGE_FIRST } from '@/lib/ui/copy';
import { unmergeBusiness } from '@/server/actions/unmerge-business';

const mocked = vi.mocked(unmergeBusiness);

/** Desk by default: `useIsDesk()` reads `(min-width: 1024px)` through matchMedia. */
let deskMatches = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: deskMatches,
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

beforeEach(() => {
  deskMatches = true;
  mocked.mockReset();
  refresh.mockReset();
  toast.mockReset();
});

afterEach(cleanup);

const WINNER = '00000000-0000-4000-8000-0000000000a1';
/** 03:30 UTC on Sep 23 is 22:30 on Sep 22 in Chicago (CDT). The suite runs in UTC. */
const LATE = new Date(Date.UTC(2026, 8, 23, 3, 30));

const NEWER: MergeRow = {
  mergeId: '00000000-0000-4000-8000-0000000000b2',
  loserName: 'Taqueria El Nandu',
  winnerName: 'Taquería El Ñandú',
  loserKey: 'SL-2K9QX',
  winnerKey: 'SL-7F3K2',
  reason: 'review',
  score: 88,
  actor: 'danlo',
  mergedAt: LATE,
  undoneAt: null,
  undoneBy: null,
};

const OLDER: MergeRow = {
  mergeId: '00000000-0000-4000-8000-0000000000b1',
  loserName: 'El Nandu Taqueria #2',
  winnerName: 'Taquería El Ñandú',
  loserKey: 'SL-4HHM8',
  winnerKey: 'SL-7F3K2',
  reason: 'auto',
  score: 97,
  actor: 'etl:resolve',
  mergedAt: new Date(Date.UTC(2026, 8, 1, 15, 0)),
  undoneAt: LATE,
  undoneBy: 'danlo',
};

const CONTEXT = { businessId: WINNER, businessName: 'Taquería El Ñandú' };

function renderHistory(merges: MergeRow[] = [NEWER, OLDER]) {
  return render(<MergeHistory merges={merges} context={CONTEXT} />);
}

function openDialog() {
  fireEvent.click(screen.getByTestId(`business-unmerge-${NEWER.mergeId}`));
  return screen.getByTestId('business-unmerge-dialog');
}

describe('merge history', () => {
  it('merge history keeps the query order, names the active unmerge, and shows no action on an undone row', () => {
    const { container } = renderHistory();
    const rows = [...container.querySelectorAll('[data-testid^="business-merge-row-"]')].map((r) =>
      r.getAttribute('data-testid'),
    );
    expect(rows).toEqual([`business-merge-row-${NEWER.mergeId}`, `business-merge-row-${OLDER.mergeId}`]);

    const newer = within(screen.getByTestId(`business-merge-row-${NEWER.mergeId}`));
    expect(newer.getByText('Taqueria El Nandu merged into Taquería El Ñandú')).toBeInTheDocument();
    expect(newer.getByText(/Reviewed by danlo/)).toBeInTheDocument();
    const action = screen.getByTestId(`business-unmerge-${NEWER.mergeId}`);
    expect(action).toHaveAccessibleName('Unmerge Taqueria El Nandu');
    expect(action).toHaveTextContent('Unmerge Taqueria El Nandu');

    const older = within(screen.getByTestId(`business-merge-row-${OLDER.mergeId}`));
    expect(older.getByText(/Auto-merged at 97/)).toBeInTheDocument();
    // The desk resolve pass is never printed as an actor.
    expect(older.queryByText(/etl:resolve/)).toBeNull();
    expect(screen.queryByTestId(`business-unmerge-${OLDER.mergeId}`)).toBeNull();
    expect(older.queryByRole('button')).toBeNull();
  });

  it('two zones: merge and undo times render in Chicago, not in the suite zone (UTC)', () => {
    renderHistory();
    const newer = screen.getByTestId(`business-merge-row-${NEWER.mergeId}`);
    expect(newer).toHaveTextContent('Sep 22, 2026, 10:30 PM');
    expect(newer).not.toHaveTextContent('Sep 23');
    expect(screen.getByTestId(`business-merge-undone-${OLDER.mergeId}`)).toHaveTextContent(
      'Unmerged by danlo on Sep 22, 2026, 10:30 PM',
    );
  });

  it('no merges reads One source, no merges and offers no action', () => {
    renderHistory([]);
    const empty = screen.getByTestId('business-merges-empty');
    expect(empty).toHaveTextContent('One source, no merges');
    expect(within(empty).queryByRole('button')).toBeNull();
    expect(within(empty).queryByRole('link')).toBeNull();
  });
});

describe('unmerge confirmation', () => {
  it('unmerge always confirms: the row button opens the dialog and writes nothing', () => {
    renderHistory();
    const dialog = openDialog();
    expect(mocked).not.toHaveBeenCalled();

    const d = within(dialog);
    expect(d.getByText('Unmerge “Taqueria El Nandu” from “Taquería El Ñandú”?')).toBeInTheDocument();
    const body = d.getByTestId('business-unmerge-consequences');
    // All four consequences and the audit line, with both keys.
    expect(body).toHaveTextContent('becomes active again with its own lead key SL-2K9QX');
    expect(body).toHaveTextContent('keeps SL-7F3K2 and loses whatever came from');
    expect(body).toHaveTextContent('records this pair as different');
    expect(body).toHaveTextContent('recorded with your name and the time');
    expect(d.getByTestId('business-unmerge-confirm')).toHaveTextContent('Unmerge these two records');
    expect(d.getByTestId('business-unmerge-dismiss')).toHaveTextContent('Keep them merged');
    expect(d.queryByText('Cancel')).toBeNull();
    // No icon-only close in the corner.
    expect(d.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(dialog.querySelector('form')).toBeNull();
  });

  it.each([
    ['later merge first', UNMERGE_LATER_MERGE_FIRST, 'conflict'],
    ['already undone', UNMERGE_ALREADY_UNDONE, 'conflict'],
    ['unexpected', UNMERGE_FAILED, 'unexpected'],
  ] as const)(
    'a refused unmerge (%s) keeps the dialog open and shows the action message',
    async (_label, message, code) => {
      mocked.mockResolvedValue({ ok: false, code, message });
      renderHistory();
      openDialog();
      await act(async () => {
        fireEvent.click(screen.getByTestId('business-unmerge-confirm'));
      });

      expect(mocked).toHaveBeenCalledWith({ mergeId: NEWER.mergeId });
      const error = await screen.findByTestId('business-unmerge-error');
      expect(error).toHaveTextContent(message);
      expect(within(error).getByTestId('business-unmerge-retry')).toHaveTextContent('Try again');
      expect(within(error).getByTestId('business-unmerge-open-sources')).toHaveAttribute(
        'href',
        '/sources',
      );
      expect(screen.getByTestId('business-unmerge-dialog')).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it('a successful unmerge toasts, closes and refreshes', async () => {
    mocked.mockResolvedValue({ ok: true, data: { loserId: '00000000-0000-4000-8000-0000000000c9' } });
    renderHistory();
    openDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId('business-unmerge-confirm'));
    });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith('Unmerged — “Taqueria El Nandu” is active again');
    await waitFor(() => expect(screen.queryByTestId('business-unmerge-dialog')).toBeNull());
  });

  it('while unmerging the confirm reads Unmerging… and the dialog stays open and modal', async () => {
    let settle: (v: Awaited<ReturnType<typeof unmergeBusiness>>) => void = () => {};
    mocked.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderHistory();
    const dialog = openDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId('business-unmerge-confirm'));
    });

    const confirm = screen.getByTestId('business-unmerge-confirm');
    expect(confirm).toHaveTextContent('Unmerging…');
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId('business-unmerge-dismiss')).toBeDisabled();

    // Escape is refused mid-write.
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(screen.getByTestId('business-unmerge-dialog')).toBeInTheDocument();

    await act(async () => {
      settle({ ok: false, code: 'unexpected', message: UNMERGE_FAILED });
    });
    expect(await screen.findByTestId('business-unmerge-error')).toHaveTextContent(UNMERGE_FAILED);
  });

  it('on a phone the confirmation is a drawer with the same contract', () => {
    deskMatches = false;
    renderHistory();
    const drawer = openDialog();
    expect(drawer).toHaveAttribute('data-slot', 'drawer-content');
    expect(within(drawer).getByTestId('business-unmerge-dismiss')).toHaveTextContent(
      'Keep them merged',
    );
    expect(mocked).not.toHaveBeenCalled();
  });
});
