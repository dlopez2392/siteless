import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunReport } from '@/server/queries/run-report';

/**
 * `/runs/[id]` — the run report (plan 04-23; 04-UI-SPEC § Screen 1; D-17; criterion 3).
 *
 * Every fixture is hand-built as a `RunReport` (the 04-20 read's type), so a field the read
 * adds or renames is a compile error here, not a silently-undefined prop. Only the TYPE is
 * imported from the query module: it starts with `server-only`, which is armed in this lane.
 *
 * `next/navigation` is factory-mocked because `RunAutoRefresh` (04-14) calls `useRouter()`, and
 * `next/link` is a plain anchor, as in `run-chrome.test.tsx` — the real one wants an app-router
 * context this lane does not build.
 *
 * 🔴 ZONES. The suite runs in UTC (vitest.config.ts); the app formats in America/Chicago. The
 * finished-line assertion pins the Chicago rendering of an instant whose UTC rendering differs,
 * so a component that forgot `formatLocal` goes red here.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { RunReportView } from '@/components/runs/run-report-view';
import { STOPPED_REASONS, type RunStatus, type StoppedReason } from '@/lib/ui/run-tone';

afterEach(cleanup);

const RUN_ID = '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const PRESET_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

/** 2026-09-23 19:14 UTC = 2:14 PM in Chicago (CDT, UTC−5). */
const STARTED = Date.UTC(2026, 8, 23, 19, 14, 0);
/** 17m 04s later: 2:31 PM Chicago, 7:31 PM UTC. */
const FINISHED = STARTED + (17 * 60 + 4) * 1000;
const RENDERED = STARTED + 20 * 60 * 1000;

type Over = {
  run?: Partial<RunReport['run']>;
  requests?: Partial<RunReport['requests']>;
  tiles?: Partial<RunReport['tiles']>;
  outcomes?: Partial<RunReport['outcomes']>;
  changes?: RunReport['changes'];
};

function reportOf(over: Over = {}): RunReport {
  const base: RunReport = {
    run: {
      id: RUN_ID,
      status: 'complete',
      stoppedReason: null,
      kind: 'full_sweep',
      partitionIndex: null,
      presetId: PRESET_ID,
      presetName: 'McAllen roofers',
      versionNumber: 3,
      createdMs: STARTED - 5_000,
      startedMs: STARTED,
      finishedMs: FINISHED,
      costMicroUsd: 2_310_000,
      callsCount: 69,
      estimateRequestsLo: 34,
      estimateRequestsHi: 54,
      estimateMicroUsdLo: 1_900_000,
      estimateMicroUsdHi: 2_900_000,
      ceilingRequests: 108,
      capMicroUsd: 50_000_000,
      capResetMs: Date.UTC(2026, 9, 1, 5, 0, 0),
    },
    requests: {
      rows: [
        { sku: 'ts_enterprise', requests: 68, freeThisMonth: 68, costMicroUsd: 0 },
        { sku: 'ts_essentials', requests: 0, freeThisMonth: 0, costMicroUsd: 0 },
      ],
      refusedByMeter: 0,
      totalRequests: 68,
      totalMicroUsd: 0,
    },
    tiles: {
      total: 68,
      searched: 68,
      saturated: 5,
      subdivided: 4,
      stillTruncated: 0,
      truncated: [],
      stillSubdividing: [],
    },
    outcomes: {
      found: 428,
      attached: 262,
      tentative: 18,
      unmatched: 148,
      byCluster: [
        {
          clusterKey: 'home_services',
          displayName: 'Home services & trades',
          found: 428,
          attached: 262,
          tentative: 18,
          unmatched: 148,
        },
        {
          clusterKey: 'auto_retail',
          displayName: 'Auto & retail',
          found: 0,
          attached: 0,
          tentative: 0,
          unmatched: 0,
        },
      ],
      website: {
        listed: 204,
        none: 108,
        byHostClass: {
          other: 121,
          social: 41,
          directory: 17,
          platform_subdomain: 14,
          business_site_dead: 11,
        },
      },
    },
    changes: null,
  };
  return {
    run: { ...base.run, ...over.run },
    requests: { ...base.requests, ...over.requests },
    tiles: { ...base.tiles, ...over.tiles },
    outcomes: { ...base.outcomes, ...over.outcomes },
    changes: over.changes === undefined ? base.changes : over.changes,
  };
}

function renderReport(report: RunReport, opts: { canRaiseCap?: boolean } = {}) {
  return render(
    <RunReportView
      report={report}
      renderedAtMs={RENDERED}
      canRaiseCap={opts.canRaiseCap ?? true}
    />,
  );
}

const THREE_TRUNCATED: RunReport['tiles']['truncated'] = [
  {
    tileKey: 'city:4845384|roofing_contractor|r012',
    cellKey: 'home_services/4845384',
    placesType: 'roofing_contractor',
    why: 'min_size',
  },
  {
    tileKey: 'city:4845384|roofing_contractor|r013',
    cellKey: 'home_services/4845384',
    placesType: 'roofing_contractor',
    why: 'max_depth',
  },
  // A truncated tile whose reason was never written still shows (04-20: `why` may be null).
  {
    tileKey: 'city:4822660|plumber|r2',
    cellKey: 'home_services/4822660',
    placesType: 'plumber',
    why: null,
  },
];

/** The status a writer pairs with each stopped reason. */
const STATUS_OF: Record<StoppedReason, RunStatus> = {
  budget_cap_reached: 'partial',
  exceeded_estimate: 'partial',
  google_daily_quota: 'partial',
  places_request_rejected: 'failed',
  places_unavailable: 'failed',
  places_key_missing: 'failed',
  never_started: 'failed',
  abandoned: 'failed',
};

describe('run report — header and alerts (04-23 Task 2)', () => {
  it('the run report shows the truncation warning in every status including complete', () => {
    for (const status of ['running', 'complete', 'partial', 'failed'] as const) {
      const { unmount } = renderReport(
        reportOf({
          run: {
            status,
            stoppedReason:
              status === 'partial'
                ? 'exceeded_estimate'
                : status === 'failed'
                  ? 'places_unavailable'
                  : null,
            finishedMs: status === 'running' ? null : FINISHED,
          },
          tiles: { stillTruncated: 3, truncated: THREE_TRUNCATED },
        }),
      );
      const warning = screen.getByTestId('run-truncation-warning');
      expect(warning, status).toHaveAttribute('data-count', '3');
      expect(warning, status).toHaveAttribute('role', 'status');
      expect(warning.textContent, status).toContain(
        "3 tiles still hit Google's 60-result limit at the smallest tile size.",
      );
      // Icon and words, never colour alone.
      expect(warning.querySelector('[data-icon="triangle-alert"]'), status).not.toBeNull();
      expect(within(warning).getByTestId('run-truncation-toggle')).toBeInTheDocument();
      expect(within(warning).getByTestId('run-truncation-copy')).toBeInTheDocument();
      unmount();
    }

    for (const status of ['running', 'complete', 'partial', 'failed'] as const) {
      const { unmount } = renderReport(
        reportOf({ run: { status, finishedMs: status === 'running' ? null : FINISHED } }),
      );
      expect(screen.queryByTestId('run-truncation-warning'), status).toBeNull();
      unmount();
    }
  });

  it('the run report never renders a raw stopped reason', () => {
    expect(STOPPED_REASONS).toHaveLength(8);
    for (const reason of STOPPED_REASONS) {
      const { container, unmount } = renderReport(
        reportOf({ run: { status: STATUS_OF[reason], stoppedReason: reason } }),
      );
      const alert = screen.getByTestId('run-stop-alert');
      expect(alert, reason).toHaveAttribute('data-reason', reason);
      const text = container.textContent ?? '';
      // `abandoned` is also an English word its own sentence uses ("marked it abandoned"); the
      // underscore keys are the ones that can only be the machine key.
      for (const key of STOPPED_REASONS.filter((k) => k.includes('_'))) {
        expect(text, `${reason} page shows ${key}`).not.toContain(key);
      }
      // No `_`-joined machine key of any kind reaches the page text.
      expect(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g), reason).toBeNull();
      unmount();
    }
  });

  it('the run report renders the refused state alone', () => {
    renderReport(
      reportOf({
        run: {
          status: 'refused',
          stoppedReason: 'budget_cap_reached',
          startedMs: null,
          finishedMs: FINISHED,
          costMicroUsd: 0,
          callsCount: 0,
        },
        requests: { refusedByMeter: 1, totalRequests: 1 },
      }),
    );
    const alert = screen.getByTestId('run-stop-alert');
    expect(alert).toHaveAttribute('data-reason', 'budget_cap_reached');
    expect(alert.textContent).toContain(
      "This run was refused. Your $50.00 cap is spent, so Siteless didn't call anything and nothing was charged.",
    );
    expect(within(alert).getByTestId('run-stop-raise-cap')).toHaveAttribute(
      'href',
      '/settings/budget',
    );
    expect(screen.queryByTestId('run-requests')).toBeNull();
    expect(document.querySelector('[data-testid^="run-tiles-"]')).toBeNull();
    expect(document.querySelector('[data-testid^="run-outcome-"]')).toBeNull();
    expect(document.querySelector('[data-testid^="run-changes"]')).toBeNull();
    // The header still answers "is it done? what did it cost?".
    expect(screen.getByTestId('run-status-line')).toHaveTextContent('Refused before any request');
  });

  it('the refused state offers a member the ask-an-admin way out', () => {
    renderReport(
      reportOf({
        run: { status: 'refused', stoppedReason: 'budget_cap_reached', costMicroUsd: 0 },
      }),
      { canRaiseCap: false },
    );
    const alert = screen.getByTestId('run-stop-alert');
    expect(within(alert).queryByTestId('run-stop-raise-cap')).toBeNull();
    expect(within(alert).getByTestId('run-stop-ask-admin')).toHaveTextContent(
      'Ask an admin to raise the cap',
    );
  });

  it('the ceiling line shows the dollar and request ceilings', () => {
    renderReport(
      reportOf({
        run: { estimateMicroUsdLo: 1_900_000, estimateMicroUsdHi: 2_900_000, ceilingRequests: 108 },
      }),
    );
    const line = screen.getByTestId('run-estimate-line');
    expect(line.textContent).toBe('Estimated $1.90–$2.90 · this run stops at $5.80 · 108 requests');
  });

  it('the header shows the above-estimate line only between the top of the estimate and the ceiling', () => {
    const hi = 2_900_000;
    const cases: Array<[number, boolean]> = [
      [hi - 10_000, false],
      [hi, false], // at the top of the estimate is not above it
      [hi + 400_000, true],
      [2 * hi - 1, true],
      [2 * hi, false], // at the ceiling the run has stopped; the stop alert speaks
    ];
    for (const [cost, shown] of cases) {
      const { unmount } = renderReport(
        reportOf({
          run: { status: 'running', finishedMs: null, costMicroUsd: cost, estimateMicroUsdHi: hi },
        }),
      );
      const line = screen.queryByTestId('run-above-estimate');
      expect(line !== null, `cost ${cost}`).toBe(shown);
      unmount();
    }
    renderReport(
      reportOf({ run: { status: 'running', finishedMs: null, costMicroUsd: hi + 400_000 } }),
    );
    expect(screen.getByTestId('run-above-estimate').textContent).toBe(
      "Above the estimate's top by $0.40 — still under this run's $5.80 stop.",
    );
  });

  it("the header's live parts appear only while the run is live", () => {
    const { unmount } = renderReport(
      reportOf({
        run: { status: 'running', finishedMs: null },
        tiles: { searched: 34, total: 68 },
      }),
    );
    expect(screen.getByTestId('run-refresh-now')).toBeInTheDocument();
    expect(screen.getByTestId('run-updated-at')).toBeInTheDocument();
    expect(screen.queryByTestId('run-finished-line')).toBeNull();
    expect(screen.getByTestId('run-status-line')).toHaveTextContent(
      '34 of 68 tiles searched so far',
    );
    expect(screen.getByTestId('run-live-status')).toBeInTheDocument();
    unmount();

    renderReport(reportOf({ run: { status: 'complete' } }));
    expect(screen.queryByTestId('run-refresh-now')).toBeNull();
    expect(screen.queryByTestId('run-updated-at')).toBeNull();
    // Chicago, not the suite's UTC: 7:31 PM UTC is 2:31 PM in Chicago.
    expect(screen.getByTestId('run-finished-line').textContent).toBe(
      'Finished Sep 23, 2:31 PM · took 17m 04s',
    );
    expect(screen.getByTestId('run-status-line')).toHaveTextContent(
      'Complete — 68 tiles searched in 17m 04s',
    );
    // 🔴 04-14: the live region stays mounted after the run finishes, or "Run complete" is
    // never announced.
    expect(screen.getByTestId('run-live-status')).toBeInTheDocument();
  });

  it('the cost is display-sized and foreground', () => {
    renderReport(reportOf({ run: { costMicroUsd: 2_310_000 } }));
    const cost = screen.getByTestId('run-cost');
    expect(cost).toHaveAttribute('data-micro-usd', '2310000');
    expect(cost.textContent).toBe('$2.31');
    expect(cost.classList.contains('text-[28px]')).toBe(true);
    expect(cost.classList.contains('font-semibold')).toBe(true);
    expect(cost.classList.contains('tabular-nums')).toBe(true);
    expect(cost.classList.contains('text-primary')).toBe(false);
  });

  it('the run kind is muted words beside the badge, never a badge', () => {
    renderReport(reportOf({ run: { kind: 'partition', partitionIndex: 2 } }));
    const kind = screen.getByTestId('run-kind');
    expect(kind).toHaveAttribute('data-kind', 'partition');
    expect(kind.textContent).toBe("This week's partition · started Sep 23, 2:14 PM");
    expect(kind.getAttribute('data-slot')).not.toBe('badge');
    expect(screen.getByTestId('run-status-badge')).toHaveAttribute('data-status', 'complete');
  });

  it('a run queued for more than two minutes says so, in muted words', () => {
    const { unmount } = renderReport(
      reportOf({
        run: {
          status: 'queued',
          startedMs: null,
          finishedMs: null,
          createdMs: RENDERED - 5 * 60_000,
        },
      }),
    );
    const alert = screen.getByTestId('run-queued-long');
    expect(alert.textContent).toContain('Still waiting to start after 5 minutes.');
    expect(alert.querySelector('[data-icon="clock"]')).not.toBeNull();
    expect(alert.className).not.toMatch(/warning|destructive/);
    unmount();

    renderReport(
      reportOf({
        run: { status: 'queued', startedMs: null, finishedMs: null, createdMs: RENDERED - 60_000 },
      }),
    );
    expect(screen.queryByTestId('run-queued-long')).toBeNull();
  });

  it('the truncation list names each tile and copies one per line', () => {
    renderReport(reportOf({ tiles: { stillTruncated: 3, truncated: THREE_TRUNCATED } }));
    const toggle = screen.getByTestId('run-truncation-toggle');
    expect(toggle.textContent).toContain('Show the 3 truncated tiles');
    // Collapsed by default: the list is one click away, the count is always on screen.
    expect(screen.queryAllByTestId('run-truncation-tile')).toHaveLength(0);
    fireEvent.click(toggle);
    const rows = screen.getAllByTestId('run-truncation-tile');
    expect(rows.map((r) => r.textContent)).toEqual([
      'city:4845384 · roofing_contractor · tile r012',
      'city:4845384 · roofing_contractor · tile r013',
      'city:4822660 · plumber · tile r2',
    ]);
    // The null-reason tile is listed, not dropped (04-20; criterion 3).
    expect(rows[2]).toHaveAttribute('data-why', '');
    expect(toggle).toHaveAttribute('data-state', 'open');

    // "Copy the tile list" copies exactly the rows shown, one per line.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTestId('run-truncation-copy'));
    expect(writeText).toHaveBeenCalledWith(
      [
        'city:4845384 · roofing_contractor · tile r012',
        'city:4845384 · roofing_contractor · tile r013',
        'city:4822660 · plumber · tile r2',
      ].join('\n'),
    );
  });

  it('stop alerts stack before the truncation warning', () => {
    renderReport(
      reportOf({
        run: { status: 'partial', stoppedReason: 'exceeded_estimate' },
        tiles: {
          stillTruncated: 3,
          truncated: THREE_TRUNCATED,
          stillSubdividing: [
            {
              tileKey: 'city:4845384|roofing_contractor|r0',
              cellKey: 'home_services/4845384',
              placesType: 'roofing_contractor',
            },
          ],
        },
      }),
    );
    const stop = screen.getByTestId('run-stop-alert');
    const trunc = screen.getByTestId('run-truncation-warning');
    expect(stop.compareDocumentPosition(trunc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stop.textContent).toContain('1 tile was still subdividing when it stopped');
  });
});
