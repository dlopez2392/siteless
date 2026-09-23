import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The preset page's three ways to run (04-UI-SPEC § Screen 2; Executor Rules 33, 34, 40).
 *
 *   - the accent goes to the FIRST ENABLED action, in the order full → partition → check, and
 *     there is none at all in `off` (Rule 34);
 *   - every action testid exists exactly once in every mode — the primary slot holds one, the
 *     "Other ways to run" card holds the other two (Rule 40);
 *   - a disabled action is `aria-disabled`, focusable and described by the Places-mode notice,
 *     never the HTML `disabled` attribute (Rule 33), and clicking it opens nothing;
 *   - a partition that covers zero cells this week is disabled and says why (04-27 decision).
 *
 * 🔴 `queueRun` is factory-mocked: the action pulls in `src/db/`, whose `import 'server-only'`
 * throws in the dom lane by design. The drawer itself is REAL, so "clicking opens nothing" is
 * proved against the component that would open.
 */
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

import { PlacesModeNotice } from '@/components/preset-detail/places-mode-notice';
import { RunActions, type RunActionsProps } from '@/components/preset-detail/run-actions';
import {
  PLACES_MODE_NOTICE_IDS_ONLY_TITLE,
  PLACES_MODE_NOTICE_OFF_TITLE,
  PRESET_COST_CHECK,
  PRESET_COST_FULL,
  PRESET_COST_PARTITION,
  PRESET_OFF_STICKY_NOTE,
  PRESET_PARTITION_EMPTY,
  PRESET_PARTITION_WEEK,
  RUN_CHECK_CHANGES,
  RUN_FULL_SWEEP,
  RUN_PARTITION,
  type PlacesModeName,
} from '@/lib/ui/copy';
import { queueRun } from '@/server/actions/queue-run';

const action = vi.mocked(queueRun);

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const NOTICE_ID = 'places-mode-notice';
const MODES: PlacesModeName[] = ['enterprise', 'ids_only', 'off'];
const ACTION_IDS = ['run-preset', 'run-partition', 'run-check-changes'] as const;

const OPTION = {
  id: VERSION_ID,
  version: 2,
  isCurrent: true,
  costRange: '$0.00',
  requests: '6 – 54 requests',
};

function props(mode: PlacesModeName, cells = 4): Omit<RunActionsProps, 'slot'> {
  return {
    mode,
    noticeId: NOTICE_ID,
    costs: {
      full: PRESET_COST_FULL(0, 0, 54),
      partition: PRESET_COST_PARTITION(0, 0, 12, cells, 17, 39),
      check: PRESET_COST_CHECK(54),
    },
    partition: {
      index: 1,
      isoWeek: 39,
      mondayIso: '2026-09-21',
      sundayIso: '2026-09-27',
      cells,
      totalCells: 17,
    },
    drawer: {
      presetName: 'McAllen trades',
      initialVersionId: VERSION_ID,
      remainingLabel: '$50.00 of $50.00',
      isAdmin: true,
      versions: { full: [OPTION], partition: [OPTION], check: [OPTION] },
    },
  };
}

/** The page renders the two slots in two places; the invariants hold over BOTH together. */
function renderBoth(mode: PlacesModeName, cells = 4, notice = true): ReturnType<typeof render> {
  const p = props(mode, cells);
  const tree: ReactNode = (
    <>
      {notice ? <PlacesModeNotice mode={mode} id={NOTICE_ID} /> : null}
      <RunActions slot="primary" {...p} />
      <RunActions slot="card" {...p} />
    </>
  );
  return render(tree);
}

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

beforeEach(() => action.mockReset());
afterEach(cleanup);

/**
 * Filled accent buttons anywhere in the tree. The shadcn Button stamps `data-variant`; its
 * `data-slot` is NOT a usable hook, because a Radix `asChild` trigger spreads its own
 * `data-slot="dialog-trigger"` over it.
 */
function accentButtons(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button[data-variant="default"], a[data-variant="default"]',
    ),
  ];
}

describe('preset run actions (04-UI-SPEC § Screen 2)', () => {
  it('the accent goes to the first enabled run action', () => {
    const expected: Record<PlacesModeName, string | null> = {
      enterprise: 'run-preset',
      ids_only: 'run-check-changes',
      off: null,
    };
    for (const mode of MODES) {
      const { container, unmount } = renderBoth(mode);
      const accents = accentButtons(container);
      const want = expected[mode];
      if (want === null) {
        expect(accents, `${mode}: no accent`).toHaveLength(0);
      } else {
        expect(accents, `${mode}: exactly one accent`).toHaveLength(1);
        expect(accents[0]).toHaveAttribute('data-testid', want);
        expect(accents[0]).toHaveAttribute('data-enabled', 'true');
      }
      unmount();
    }
  });

  it('exactly one element per run testid in every mode', () => {
    for (const mode of MODES) {
      const { container, unmount } = renderBoth(mode);
      for (const id of ACTION_IDS) {
        expect(container.querySelectorAll(`[data-testid="${id}"]`), `${mode}: ${id}`).toHaveLength(
          1,
        );
      }
      // The card holds the other two, never the primary's action.
      const card = screen.getByTestId('preset-other-runs');
      const primaryId = mode === 'ids_only' ? 'run-check-changes' : 'run-preset';
      expect(within(card).queryByTestId(primaryId), `${mode}: primary not in card`).toBeNull();
      unmount();
    }
  });

  it('disabled run actions are aria-disabled and focusable', () => {
    renderBoth('off');
    for (const id of ACTION_IDS) {
      const button = screen.getByTestId(id);
      expect(button, id).toHaveAttribute('aria-disabled', 'true');
      expect(button, id).not.toHaveAttribute('disabled');
      expect(button, id).toHaveAttribute('data-enabled', 'false');
      const describedBy = (button.getAttribute('aria-describedby') ?? '').split(/\s+/);
      expect(describedBy, id).toContain(NOTICE_ID);
      expect(document.getElementById(NOTICE_ID), id).not.toBeNull();

      button.focus();
      expect(button, `${id} focusable`).toHaveFocus();

      fireEvent.click(button);
      expect(screen.queryByTestId('run-drawer'), `${id} opens nothing`).toBeNull();
    }
    expect(action).not.toHaveBeenCalled();

    // Phone: the sticky bar keeps the disabled full sweep and says why beneath it.
    expect(screen.getByTestId('run-off-sticky-note')).toHaveTextContent(PRESET_OFF_STICKY_NOTE);
  });

  it('an enabled run action opens its own drawer kind', () => {
    renderBoth('enterprise');
    fireEvent.click(screen.getByTestId('run-partition'));
    expect(screen.getByTestId('run-drawer')).toHaveAttribute('data-run-kind', 'partition');
    expect(screen.queryByTestId('run-off-sticky-note')).toBeNull();
  });

  it('the check action reads as free through words, not colour', () => {
    renderBoth('enterprise');
    const check = screen.getByTestId('run-check-changes');
    expect(check).toHaveTextContent(RUN_CHECK_CHANGES);
    expect(check).toHaveAttribute('data-variant', 'outline');
    const cost = screen.getByTestId('run-cost-check');
    expect(cost).toHaveTextContent('$0.00 · IDs only, no website data · ~54 requests');
    for (const el of [check, cost]) {
      expect(el.className).not.toMatch(/\b(bg|text|border)-primary\b/);
    }
  });

  it('the partition action names this iso week and its date range', () => {
    renderBoth('enterprise');
    const card = screen.getByTestId('preset-other-runs');
    expect(within(card).getByTestId('run-partition')).toHaveTextContent(RUN_PARTITION);
    expect(within(card).getByTestId('run-partition-week')).toHaveTextContent(
      PRESET_PARTITION_WEEK(39, 'Sep 21–27'),
    );
    expect(within(card).getByTestId('run-cost-partition')).toHaveTextContent(
      '4 of 17 cells (week 39)',
    );
    expect(screen.getByTestId('run-preset')).toHaveTextContent(RUN_FULL_SWEEP);
  });

  it('a partition with no cells this week is disabled and says why', () => {
    renderBoth('enterprise', 0, false);
    const partition = screen.getByTestId('run-partition');
    expect(partition).toHaveAttribute('aria-disabled', 'true');
    expect(partition).toHaveAttribute('data-enabled', 'false');
    expect(partition).not.toHaveAttribute('disabled');
    const why = screen.getByTestId('run-partition-empty');
    expect(why).toHaveTextContent(PRESET_PARTITION_EMPTY(17, 39));
    expect((partition.getAttribute('aria-describedby') ?? '').split(/\s+/)).toContain(why.id);

    fireEvent.click(partition);
    expect(screen.queryByTestId('run-drawer')).toBeNull();

    // The other two are untouched, and the accent is still the full sweep's.
    expect(screen.getByTestId('run-preset')).toHaveAttribute('data-enabled', 'true');
    expect(screen.getByTestId('run-check-changes')).toHaveAttribute('data-enabled', 'true');
  });

  it('the places mode notice renders per mode', () => {
    const off = render(<PlacesModeNotice mode="off" id={NOTICE_ID} />);
    const offNotice = screen.getByTestId('places-mode-notice');
    expect(offNotice).toHaveAttribute('data-mode', 'off');
    expect(offNotice).toHaveAttribute('id', NOTICE_ID);
    expect(offNotice.querySelector('[data-icon="power-off"]')).not.toBeNull();
    expect(offNotice).toHaveTextContent(PLACES_MODE_NOTICE_OFF_TITLE);
    // A deliberate configuration, not a fault: never an interrupting alert.
    expect(offNotice).not.toHaveAttribute('role', 'alert');
    off.unmount();

    const ids = render(<PlacesModeNotice mode="ids_only" id={NOTICE_ID} />);
    const idsNotice = screen.getByTestId('places-mode-notice');
    expect(idsNotice).toHaveAttribute('data-mode', 'ids_only');
    expect(idsNotice.querySelector('[data-icon="circle-dashed"]')).not.toBeNull();
    expect(idsNotice).toHaveTextContent(PLACES_MODE_NOTICE_IDS_ONLY_TITLE);
    ids.unmount();

    render(<PlacesModeNotice mode="enterprise" id={NOTICE_ID} />);
    expect(screen.queryByTestId('places-mode-notice')).toBeNull();
  });
});
