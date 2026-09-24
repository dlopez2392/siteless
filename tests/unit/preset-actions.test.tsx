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
// The version rows carry a DuplicateDialog, whose action pulls in `src/db/` too.
vi.mock('@/server/actions/duplicate-preset', () => ({ duplicatePreset: vi.fn() }));
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
import { RecentRuns, type RecentRun } from '@/components/preset-detail/recent-runs';
import { RunActions, type RunActionsProps } from '@/components/preset-detail/run-actions';
import { SummaryCard } from '@/components/preset-detail/summary-card';
import {
  VersionHistory,
  type HistoryVersion,
} from '@/components/preset-detail/version-history';
import {
  PLACES_MODE_NOTICE_IDS_ONLY_TITLE,
  PLACES_MODE_NOTICE_OFF_TITLE,
  PRESET_COST_CHECK,
  PRESET_COST_FULL,
  PRESET_COST_PARTITION,
  PRESET_LAST_RUN_LINK,
  PRESET_OFF_STICKY_NOTE,
  PRESET_PARTITION_EMPTY,
  PRESET_PARTITION_WEEK,
  PRESET_RECENT_RUNS_EMPTY_BODY,
  PRESET_RECENT_RUNS_EMPTY_BODY_OFF,
  PRESET_RECENT_RUNS_FOOTER,
  RUN_CHECK_CHANGES,
  RUN_FULL_SWEEP,
  RUN_PARTITION,
  STOPPED_REASON,
  type PlacesModeName,
} from '@/lib/ui/copy';
import { RUN_KIND_LABEL, RUN_LABEL } from '@/lib/ui/run-tone';
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
      editHref: '/presets/x/edit',
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

/* --- Version history's "Run version N" (C-CR-02) ---------------------------------------------- */

const V1 = '22222222-2222-4222-8222-222222222222';

function historyVersion(id: string, version: number, isCurrent: boolean): HistoryVersion {
  return {
    id,
    version,
    isCurrent,
    clauses: ['Home services'],
    clusterNames: ['Home services'],
    geo: { kind: 'cities', names: ['McAllen'] },
    usedByRuns: 0,
    createdAt: new Date('2026-09-20T15:00:00Z'),
    costRange: '$0.00',
    requests: '~54',
  };
}

function renderHistory(mode: PlacesModeName) {
  return render(
    <>
      <PlacesModeNotice mode={mode} id={NOTICE_ID} />
      <VersionHistory
        versions={[historyVersion(VERSION_ID, 2, true), historyVersion(V1, 1, false)]}
        editHref="/presets/x/edit"
        context={{
          presetName: 'McAllen trades',
          isAdmin: true,
          remainingLabel: '$50.00 of $50.00',
          placesMode: mode,
          noticeId: NOTICE_ID,
        }}
      />
    </>,
  );
}

/** Both presentations (desk row and phone card) of both versions. */
const VERSION_RUN_IDS = [
  'version-row-2-run',
  'version-row-1-run',
  'version-card-2-run',
  'version-card-1-run',
];

describe('version history run buttons follow the places mode', () => {
  it('in off and ids_only every run version button is inert and points at the notice', () => {
    for (const mode of ['off', 'ids_only'] as const) {
      const { unmount } = renderHistory(mode);
      for (const id of VERSION_RUN_IDS) {
        const button = screen.getByTestId(id);
        expect(button, `${mode}: ${id}`).toHaveAttribute('aria-disabled', 'true');
        expect(button, `${mode}: ${id}`).toHaveAttribute('data-enabled', 'false');
        expect(button, `${mode}: ${id}`).not.toHaveAttribute('disabled');
        expect(button.getAttribute('aria-describedby'), `${mode}: ${id}`).toBe(NOTICE_ID);
        expect(document.getElementById(NOTICE_ID), `${mode}: notice`).not.toBeNull();

        button.focus();
        expect(button, `${mode}: ${id} focusable`).toHaveFocus();
        fireEvent.click(button);
        expect(screen.queryByTestId('run-drawer'), `${mode}: ${id} opens nothing`).toBeNull();
      }
      unmount();
    }
    expect(action).not.toHaveBeenCalled();
  });

  it('in enterprise a run version button opens the drawer', () => {
    renderHistory('enterprise');
    const button = screen.getByTestId('version-row-1-run');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveAttribute('data-enabled', 'true');
    fireEvent.click(button);
    expect(screen.getByTestId('run-drawer')).toHaveAttribute('data-run-kind', 'full');
  });
});

/* --- Recent runs and the summary's report link (§ Screen 2, § States → Empty) --------------- */

const RUN = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

/** Six runs, deliberately NOT in time order, so "newest first" is the component's claim. The
 *  newest is 2026-09-23 19:14Z = 2:14 PM in Chicago (7:14 PM in UTC, the suite's zone). */
const SIX: RecentRun[] = [
  {
    id: RUN(3),
    kind: 'partition',
    status: 'partial',
    stoppedReason: 'budget_cap_reached',
    costMicroUsd: 2_310_000n,
    at: new Date('2026-09-21T15:00:00Z'),
    version: 2,
  },
  {
    id: RUN(1),
    kind: 'full_sweep',
    status: 'complete',
    stoppedReason: null,
    costMicroUsd: 0n,
    at: new Date('2026-09-23T19:14:00Z'),
    version: 2,
  },
  {
    id: RUN(6),
    kind: 'full_sweep',
    status: 'failed',
    stoppedReason: 'never_started',
    costMicroUsd: 0n,
    at: new Date('2026-09-10T15:00:00Z'),
    version: 1,
  },
  {
    id: RUN(2),
    kind: 'change_check',
    status: 'running',
    stoppedReason: null,
    costMicroUsd: 0n,
    at: new Date('2026-09-22T15:00:00Z'),
    version: 2,
  },
  {
    id: RUN(5),
    kind: 'full_sweep',
    status: 'refused',
    stoppedReason: 'budget_cap_reached',
    costMicroUsd: 0n,
    at: new Date('2026-09-15T15:00:00Z'),
    version: 1,
  },
  {
    id: RUN(4),
    kind: 'partition',
    status: 'complete',
    stoppedReason: null,
    costMicroUsd: 1_000_000n,
    at: new Date('2026-09-20T15:00:00Z'),
    version: 2,
  },
];

describe('preset recent runs (04-UI-SPEC § Screen 2)', () => {
  it('recent runs list the five newest with kind, cost and status', () => {
    render(<RecentRuns runs={SIX} mode="enterprise" />);
    const card = screen.getByTestId('preset-recent-runs');
    const rows = [...card.querySelectorAll<HTMLElement>('[data-testid^="preset-run-row-"]')];

    // Five, newest first; the oldest (RUN 6) is not on the preset page.
    expect(rows.map((r) => r.dataset.testid)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `preset-run-row-${RUN(n)}`),
    );

    for (const row of rows) {
      const id = row.dataset.testid!.replace('preset-run-row-', '');
      expect(row.tagName).toBe('A');
      expect(row).toHaveAttribute('href', `/runs/${id}`);
      expect(row.className).toMatch(/\bmin-h-11\b/);
      expect(within(row).getByTestId(`preset-run-status-${id}`)).toBeInTheDocument();
    }

    const newest = screen.getByTestId(`preset-run-row-${RUN(1)}`);
    // Chicago time, pinned — the suite runs in UTC, where this would read 7:14 PM.
    expect(newest).toHaveTextContent('Sep 23, 2:14 PM');
    expect(newest).toHaveTextContent(RUN_KIND_LABEL.full_sweep);
    expect(newest).toHaveTextContent('version 2');
    expect(within(newest).getByTestId(`preset-run-status-${RUN(1)}`)).toHaveTextContent(
      RUN_LABEL.complete,
    );

    const partial = screen.getByTestId(`preset-run-row-${RUN(3)}`);
    expect(partial).toHaveTextContent('$2.31');
    expect(partial).toHaveTextContent(STOPPED_REASON.budget_cap_reached);
    // C-WR-06: a past partition names its ISO week (Mon Sep 21, 2026 is week 39), never "This
    // week's partition" — that phrase belongs to the action row only.
    expect(partial).toHaveTextContent('Weekly partition · week 39');
    expect(card).not.toHaveTextContent(RUN_KIND_LABEL.partition);
    // A machine key never renders (Rule 35); a refused run carries no stopped sentence.
    expect(card).not.toHaveTextContent('budget_cap_reached');
    expect(screen.getByTestId(`preset-run-row-${RUN(5)}`)).not.toHaveTextContent(
      STOPPED_REASON.budget_cap_reached,
    );

    // The run drawer's "Check recent runs" (C-CR-01) is a `#preset-recent-runs` hash.
    expect(card).toHaveAttribute('id', 'preset-recent-runs');

    const footer = within(card).getByTestId('preset-recent-runs-spend');
    expect(footer).toHaveAttribute('href', '/spend');
    expect(footer).toHaveTextContent(PRESET_RECENT_RUNS_FOOTER);
  });

  it('recent runs empty state names the off mode', () => {
    const off = render(<RecentRuns runs={[]} mode="off" />);
    expect(screen.getByTestId('preset-recent-runs-empty')).toHaveTextContent(
      PRESET_RECENT_RUNS_EMPTY_BODY_OFF,
    );
    off.unmount();

    render(<RecentRuns runs={[]} mode="enterprise" />);
    const empty = screen.getByTestId('preset-recent-runs-empty');
    expect(empty).toHaveTextContent(PRESET_RECENT_RUNS_EMPTY_BODY);
    expect(empty).not.toHaveTextContent(PRESET_RECENT_RUNS_EMPTY_BODY_OFF);
  });

  it("the summary links the last run's report", () => {
    render(
      <SummaryCard
        version={2}
        isCurrent
        clusterNames={['Home services']}
        geo={{ kind: 'cities', names: ['McAllen'] }}
        estimate={null}
        runCost={{ kindLabel: RUN_KIND_LABEL.full_sweep, line: PRESET_COST_FULL(0, 0, 54) }}
        lastRun={{
          id: RUN(1),
          status: 'complete',
          at: new Date('2026-09-23T19:14:00Z'),
          costMicroUsd: 2_310_000n,
        }}
      />,
    );
    const link = screen.getByTestId('summary-last-run-link');
    expect(link).toHaveAttribute('href', `/runs/${RUN(1)}`);
    expect(link).toHaveTextContent(PRESET_LAST_RUN_LINK);
    expect(screen.getByTestId('summary-last-run')).toHaveTextContent('Sep 23, 2:14 PM');
    // The primary action's cost line sits beside the estimate, so all three are visible.
    expect(screen.getByTestId('summary-run-cost')).toHaveTextContent(
      `${RUN_KIND_LABEL.full_sweep} · ${PRESET_COST_FULL(0, 0, 54)}`,
    );
  });

  it('a never-run preset has no report link', () => {
    render(
      <SummaryCard
        version={1}
        isCurrent
        clusterNames={['Home services']}
        geo={{ kind: 'cities', names: ['McAllen'] }}
        estimate={null}
        runCost={null}
        lastRun={null}
      />,
    );
    expect(screen.queryByTestId('summary-last-run-link')).toBeNull();
    expect(screen.queryByTestId('summary-run-cost')).toBeNull();
  });
});
