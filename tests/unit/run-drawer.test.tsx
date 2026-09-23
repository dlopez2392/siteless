import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The run drawer after 04-26 (04-UI-SPEC § Screen 2 "The run drawer"; Rules 38, 41):
 *   - each of the three kinds sends its own run kind to `queueRun`;
 *   - success NAVIGATES to `/runs/{runId}` — no toast, no refresh-in-place;
 *   - a mode refusal and a second active run are persistent Alerts that REPLACE the confirm,
 *     each with its way out (reload the preset / open the running run).
 *
 * 🔴 `queueRun` is factory-mocked: the action pulls in `src/db/`, whose `import 'server-only'`
 * throws in the dom lane by design.
 */
vi.mock('@/server/actions/queue-run', () => ({ queueRun: vi.fn() }));

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { toast } from 'sonner';
import { RunDrawer, type RunVersionOption } from '@/components/preset-detail/run-drawer';
import {
  RUN_ALREADY_IN_PROGRESS,
  RUN_DRAWER_CHECK_COST,
  RUN_DRAWER_CHECK_NOTE,
  RUN_DRAWER_CONFIRM_CHECK,
  RUN_DRAWER_CONFIRM_FULL,
  RUN_DRAWER_CONFIRM_PARTITION,
  RUN_DRAWER_TITLE_CHECK,
  RUN_DRAWER_TITLE_FULL,
  RUN_DRAWER_TITLE_PARTITION,
  RUN_MODE_REFUSED,
  RUN_OPEN_RUNNING,
} from '@/lib/ui/copy';
import { queueRun } from '@/server/actions/queue-run';

type Answer = Awaited<ReturnType<typeof queueRun>>;
const action = vi.mocked(queueRun);
const toastFn = vi.mocked(toast);

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const RUNNING_ID = '44444444-4444-4444-8444-444444444444';
const NAME = 'McAllen trades';

const VERSIONS: RunVersionOption[] = [
  { id: VERSION_ID, version: 2, isCurrent: true, costRange: '$0.00–$0.00', requests: '~54' },
];

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

beforeEach(() => {
  action.mockReset();
  refresh.mockReset();
  push.mockReset();
  toastFn.mockReset();
});

afterEach(cleanup);

const COMMON = {
  presetName: NAME,
  versions: VERSIONS,
  initialVersionId: VERSION_ID,
  pickable: false,
  remainingLabel: '$50.00',
  isAdmin: true,
};

const PARTITION = {
  index: 2,
  isoWeek: 39,
  mondayIso: '2026-09-21',
  sundayIso: '2026-09-27',
  cells: 4,
  totalCells: 17,
};

function openDrawer(kind: 'full' | 'partition' | 'check') {
  render(
    kind === 'partition' ? (
      <RunDrawer {...COMMON} kind="partition" partition={PARTITION}>
        <button type="button" data-testid="trigger">
          open
        </button>
      </RunDrawer>
    ) : (
      <RunDrawer {...COMMON} kind={kind}>
        <button type="button" data-testid="trigger">
          open
        </button>
      </RunDrawer>
    ),
  );
  fireEvent.click(screen.getByTestId('trigger'));
  return within(screen.getByTestId('run-drawer'));
}

async function confirmWith(d: ReturnType<typeof openDrawer>, answer: Answer) {
  action.mockResolvedValueOnce(answer);
  await act(async () => {
    fireEvent.click(d.getByTestId('run-confirm'));
  });
}

const STARTED: Answer = {
  ok: true,
  data: { runId: RUN_ID, reservationId: 'r', pctAfter: 0, at80: false },
};

describe('run drawer', () => {
  it('a confirmed run navigates to its report without a toast', async () => {
    const d = openDrawer('full');
    expect(d.getByText(RUN_DRAWER_TITLE_FULL(NAME, 2))).toBeInTheDocument();
    expect(d.getByTestId('run-confirm')).toHaveTextContent(RUN_DRAWER_CONFIRM_FULL);

    await confirmWith(d, STARTED);

    expect(action).toHaveBeenCalledWith({ searchVersionId: VERSION_ID, kind: 'full_sweep' });
    expect(push).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    expect(refresh).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('each drawer kind sends its own run kind', async () => {
    const p = openDrawer('partition');
    expect(p.getByText(RUN_DRAWER_TITLE_PARTITION(NAME, 2, 39))).toBeInTheDocument();
    expect(p.getByTestId('run-partition-cells')).toHaveTextContent('4 of 17 (week 39, Sep 21–27)');
    expect(p.getByTestId('run-confirm')).toHaveTextContent(RUN_DRAWER_CONFIRM_PARTITION(39));
    await confirmWith(p, STARTED);
    expect(action).toHaveBeenLastCalledWith({ searchVersionId: VERSION_ID, kind: 'partition' });
    cleanup();

    const c = openDrawer('check');
    expect(c.getByText(RUN_DRAWER_TITLE_CHECK(NAME))).toBeInTheDocument();
    expect(c.getByTestId('run-estimate')).toHaveTextContent(RUN_DRAWER_CHECK_COST);
    expect(c.getByText(RUN_DRAWER_CHECK_NOTE)).toBeInTheDocument();
    expect(c.getByTestId('run-confirm')).toHaveTextContent(RUN_DRAWER_CONFIRM_CHECK);
    await confirmWith(c, STARTED);
    expect(action).toHaveBeenLastCalledWith({
      searchVersionId: VERSION_ID,
      kind: 'change_check',
    });
  });

  it('a mode refusal replaces the confirm with a reload', async () => {
    const d = openDrawer('full');
    await confirmWith(d, {
      ok: false,
      code: 'mode_refused',
      message: RUN_MODE_REFUSED('off'),
    });

    const alert = d.getByTestId('run-mode-refused');
    expect(alert).toHaveTextContent(RUN_MODE_REFUSED('off'));
    expect(d.queryByTestId('run-confirm')).toBeNull();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByTestId('run-mode-refused-reload'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a second active run links to the running run', async () => {
    const d = openDrawer('check');
    await confirmWith(d, {
      ok: false,
      code: 'conflict',
      message: RUN_ALREADY_IN_PROGRESS,
      detail: { reason: 'busy', runningRunId: RUNNING_ID },
    });

    const alert = d.getByTestId('run-already-running');
    expect(alert).toHaveTextContent(RUN_ALREADY_IN_PROGRESS);
    const link = within(alert).getByTestId('run-already-running-link');
    expect(link).toHaveTextContent(RUN_OPEN_RUNNING);
    expect(link).toHaveAttribute('href', `/runs/${RUNNING_ID}`);
    expect(d.queryByTestId('run-confirm')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
