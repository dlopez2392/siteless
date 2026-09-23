import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The run report's live-refresh island (04-UI-SPEC D-17, Executor Rules 11 and 36), driven
 * with FAKE timers so every claim about the 5-second cadence is a claim about the timer queue
 * rather than about wall-clock luck.
 *
 * `next/navigation` is factory-mocked as in `review-actions.test.tsx`: the island's only
 * dependency is `useRouter().refresh`, and counting calls to it IS the cadence.
 *
 * 🔴 ZONE AND LOCALE. The suite runs in UTC (vitest.config.ts); the "Updated …" time must be
 * rendered in the app's zone through `formatLocal`. 19:14:05Z is 2:14:05 PM in Chicago (CDT)
 * and 7:14:05 PM in UTC — the literal below only matches if the zone pin is real.
 */
const refresh = vi.fn();
// 🔴 A FRESH ROUTER OBJECT PER RENDER, DELIBERATELY — harsher than Next, whose router is
// stable. With the island's callback keyed on the router's identity, every re-render re-armed
// the cadence and the "Refresh now doesn't reset the cadence" mutation survived this file.
// The island now reads the router through a ref; this mock keeps that honest.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { REFRESH_MS, REFRESH_TIMEOUT_MS, RunAutoRefresh } from '@/components/runs/run-auto-refresh';
import {
  RUN_ANNOUNCE_STARTED,
  RUN_ANNOUNCE_TRUNCATED,
  RUN_REPORT_REFRESHING,
  RUN_REPORT_REFRESH_NOW,
} from '@/lib/ui/copy';

const T0 = Date.UTC(2026, 8, 23, 19, 14, 5);

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  refresh.mockClear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

type Props = Parameters<typeof RunAutoRefresh>[0];

function props(over: Partial<Props> = {}): Props {
  return {
    status: 'running',
    renderedAtMs: T0,
    truncatedCount: 0,
    costMicroUsd: 1_900_000,
    stoppedReason: null,
    ...over,
  };
}

describe('RunAutoRefresh', () => {
  it('the live refresh polls every 5 seconds while running', () => {
    expect(REFRESH_MS).toBe(5000);
    render(<RunAutoRefresh {...props()} />);
    expect(screen.getByTestId('run-updated-at')).toHaveTextContent(
      'Updated 2:14:05 PM · updating every 5 seconds',
    );
    advance(4999);
    expect(refresh).toHaveBeenCalledTimes(0);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
    // Queued is live too.
    cleanup();
    refresh.mockClear();
    render(<RunAutoRefresh {...props({ status: 'queued' })} />);
    advance(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the live refresh stops on a terminal status', () => {
    const { rerender } = render(<RunAutoRefresh {...props()} />);
    advance(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The refresh lands with the run finished — WITHOUT a new render time, so even the
    // refresh watchdog is still armed at this point and must be cleared by the status alone.
    rerender(<RunAutoRefresh {...props({ status: 'complete' })} />);
    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The live parts are gone; the live region stays for the announcement.
    expect(screen.queryByTestId('run-updated-at')).toBeNull();
    expect(screen.queryByTestId('run-refresh-now')).toBeNull();
    expect(screen.getByTestId('run-live-status')).toBeInTheDocument();
    // A report that is already terminal on load never starts a timer at all.
    cleanup();
    for (const status of ['complete', 'partial', 'refused', 'failed']) {
      render(<RunAutoRefresh {...props({ status })} />);
      expect(vi.getTimerCount()).toBe(0);
      cleanup();
    }
  });

  it('the live refresh pauses while hidden and refreshes on return', () => {
    render(<RunAutoRefresh {...props()} />);
    advance(2000);
    setVisibility('hidden');
    advance(20_000);
    expect(refresh).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(4999);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('the live refresh clears its timer on unmount', () => {
    const { unmount } = render(<RunAutoRefresh {...props()} />);
    advance(5000); // one refresh in flight: the cadence timer AND the watchdog are armed
    expect(vi.getTimerCount()).toBeGreaterThan(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    // And the visibility listener went with it.
    setVisibility('hidden');
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refresh that does not land within 10 seconds shows the refresh-failed line', () => {
    expect(REFRESH_TIMEOUT_MS).toBe(10_000);
    const { rerender } = render(<RunAutoRefresh {...props()} />);
    advance(5000); // refresh #1 at 2:14:10 PM
    advance(REFRESH_TIMEOUT_MS - 1);
    expect(screen.getByTestId('run-updated-at')).toHaveTextContent('Updated 2:14:05 PM');
    advance(1);
    const line = screen.getByTestId('run-updated-at');
    expect(line).toHaveTextContent(
      "Couldn't refresh at 2:14:10 PM. Showing the numbers from 2:14:05 PM; the next try is in 5 seconds.",
    );
    expect(line).toHaveAttribute('data-state', 'failed');
    // A new render — the refresh finally landed — clears it.
    const landed = T0 + 17_000;
    rerender(<RunAutoRefresh {...props({ renderedAtMs: landed })} />);
    expect(screen.getByTestId('run-updated-at')).toHaveTextContent(
      'Updated 2:14:22 PM · updating every 5 seconds',
    );
    expect(screen.getByTestId('run-updated-at')).toHaveAttribute('data-state', 'live');
  });

  it('refresh now refreshes immediately and resets the cadence', () => {
    const { rerender } = render(<RunAutoRefresh {...props()} />);
    const button = screen.getByTestId('run-refresh-now');
    expect(button).toHaveAttribute('data-state', 'idle');
    expect(button.className).toContain('h-11');
    advance(3000);
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(4999); // 7.999 s: the old 5 s tick must NOT have fired
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(1); // 8 s
    expect(refresh).toHaveBeenCalledTimes(2);

    // While waiting: "Refreshing…" is the visible label, and "Refresh now" still occupies the
    // same grid cell (invisible), so the button keeps the wider label's width.
    expect(button).toHaveAttribute('data-state', 'refreshing');
    expect(button).toHaveAttribute('aria-busy', 'true');
    const busy = screen.getByTestId('run-refresh-now-busy');
    const idle = screen.getByTestId('run-refresh-now-idle');
    expect(busy).toHaveTextContent(RUN_REPORT_REFRESHING);
    expect(busy.className).not.toContain('invisible');
    expect(idle).toHaveTextContent(RUN_REPORT_REFRESH_NOW);
    expect(idle.className).toContain('invisible');
    expect(busy.querySelector('[data-slot="spinner"]')).not.toBeNull();

    // The render lands: back to idle.
    rerender(<RunAutoRefresh {...props({ renderedAtMs: T0 + 9000 })} />);
    expect(button).toHaveAttribute('data-state', 'idle');
    expect(idle.className).not.toContain('invisible');
    expect(busy.className).toContain('invisible');
  });

  it('the live region announces only transitions', () => {
    const { rerender } = render(<RunAutoRefresh {...props({ status: 'queued' })} />);
    const region = screen.getByTestId('run-live-status');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    // Nothing is announced on load.
    expect(region).toHaveTextContent('');

    rerender(<RunAutoRefresh {...props({ status: 'running', renderedAtMs: T0 + 5000 })} />);
    expect(region).toHaveTextContent(RUN_ANNOUNCE_STARTED);

    // Only the render time changes — the 5-second counts refresh — and the region is silent.
    rerender(<RunAutoRefresh {...props({ status: 'running', renderedAtMs: T0 + 10_000 })} />);
    expect(region).toHaveTextContent(RUN_ANNOUNCE_STARTED);
    const before = region.textContent;
    rerender(<RunAutoRefresh {...props({ status: 'running', renderedAtMs: T0 + 15_000 })} />);
    expect(region.textContent).toBe(before);

    // First truncation.
    rerender(
      <RunAutoRefresh
        {...props({ status: 'running', renderedAtMs: T0 + 20_000, truncatedCount: 3 })}
      />,
    );
    expect(region).toHaveTextContent(RUN_ANNOUNCE_TRUNCATED(3));

    // Growing past the first appearance is not a new transition.
    rerender(
      <RunAutoRefresh
        {...props({ status: 'running', renderedAtMs: T0 + 25_000, truncatedCount: 5 })}
      />,
    );
    expect(region).toHaveTextContent(RUN_ANNOUNCE_TRUNCATED(3));

    // Terminal.
    rerender(
      <RunAutoRefresh
        {...props({ status: 'complete', renderedAtMs: T0 + 30_000, truncatedCount: 5 })}
      />,
    );
    expect(region).toHaveTextContent('Run complete — $1.90');
  });
});
