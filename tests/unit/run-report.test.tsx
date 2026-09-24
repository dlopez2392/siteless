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
import {
  RUN_OUTCOMES_NONE_REACHED_BODY,
  RUN_OUTCOMES_NONE_REACHED_HEADING,
} from '@/lib/ui/copy';
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

/** Any colour class other than the foreground / muted pair. */
const COLOUR_CLASS =
  /\b(?:text|bg|border|fill)-(?:primary|warning|destructive|accent|chart|success|red|green|blue|amber|yellow|teal|orange)/;

function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('run report — cards (04-23 Task 3)', () => {
  it('the requests card renders both SKUs even at zero', () => {
    const { unmount } = renderReport(reportOf());
    const card = screen.getByTestId('run-requests');
    const ent = within(card).getByTestId('run-sku-row-ts_enterprise');
    const ess = within(card).getByTestId('run-sku-row-ts_essentials');
    expect(ent).toHaveAttribute('data-requests', '68');
    expect(ess).toHaveAttribute('data-requests', '0');
    expect(ess.textContent).toContain('Text Search Essentials (IDs only)');
    expect(within(card).queryByTestId('run-sku-row-refused')).toBeNull();
    expect(within(card).getByTestId('run-sku-row-total')).toHaveAttribute('data-requests', '68');
    // The phone twins exist with their OWN testids — never one testid on two elements.
    expect(within(card).getByTestId('run-sku-card-ts_essentials')).toBeInTheDocument();
    unmount();

    renderReport(
      reportOf({
        run: { status: 'partial', stoppedReason: 'budget_cap_reached' },
        requests: { refusedByMeter: 1, totalRequests: 69 },
      }),
    );
    const refused = screen.getByTestId('run-sku-row-refused');
    expect(refused).toHaveAttribute('data-requests', '1');
    expect(refused.textContent).toContain('Refused by the meter');
    expect(refused.textContent).toContain('—');
    expect(screen.getByTestId('run-sku-row-total')).toHaveAttribute('data-requests', '69');
    expect(screen.getByTestId('run-sku-row-total').textContent).toContain('69');
  });

  it('the tiles card warns on still truncated', () => {
    const { unmount } = renderReport(
      reportOf({
        tiles: { stillTruncated: 2, truncated: THREE_TRUNCATED.slice(0, 2) },
      }),
    );
    const cell = screen.getByTestId('run-tiles-truncated');
    expect(cell).toHaveAttribute('data-count', '2');
    expect(cell.querySelector('[data-icon="triangle-alert"]')).not.toBeNull();
    expect(cell.className).toContain('text-warning');
    expect(screen.getByTestId('run-tiles-searched')).toHaveAttribute('data-count', '68');
    expect(screen.getByTestId('run-tiles-saturated')).toHaveAttribute('data-count', '5');
    expect(screen.getByTestId('run-tiles-subdivided')).toHaveAttribute('data-count', '4');
    unmount();

    renderReport(reportOf());
    const plain = screen.getByTestId('run-tiles-truncated');
    expect(plain).toHaveAttribute('data-count', '0');
    expect(plain.querySelector('[data-icon="triangle-alert"]')).toBeNull();
    expect(plain.className).not.toMatch(COLOUR_CLASS);
  });

  it('the tiles card lists the tiles still subdividing on an exceeded-estimate run', () => {
    renderReport(
      reportOf({
        run: { status: 'partial', stoppedReason: 'exceeded_estimate' },
        tiles: {
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
    const list = screen.getByTestId('run-tiles-subdividing');
    // The stop alert's "Show the tiles still subdividing" is an in-page link to this list.
    expect(screen.getByTestId('run-stop-show-subdividing')).toHaveAttribute('href', `#${list.id}`);
    expect(list.textContent).toContain('Tiles still subdividing when the run stopped (1)');
    expect(list.textContent).toContain('city:4845384 · roofing_contractor · tile r0');
  });

  it('the outcomes card links tentative listings to the Google review filter', () => {
    const { unmount } = renderReport(reportOf());
    const link = screen.getByTestId('run-review-link');
    expect(link).toHaveAttribute('href', '/review?kind=google');
    expect(link.textContent).toBe('Review 18 in the queue');
    expect(screen.getByTestId('run-outcome-found')).toHaveAttribute('data-count', '428');
    expect(screen.getByTestId('run-outcome-attached')).toHaveAttribute('data-count', '262');
    expect(screen.getByTestId('run-outcome-tentative')).toHaveAttribute('data-count', '18');
    expect(screen.getByTestId('run-outcome-unmatched')).toHaveAttribute('data-count', '148');
    unmount();

    renderReport(reportOf({ outcomes: { tentative: 0, found: 410 } }));
    expect(screen.queryByTestId('run-review-link')).toBeNull();
  });

  it('the outcomes card lists every cluster including zero rows', () => {
    renderReport(reportOf());
    const home = screen.getByTestId('run-cluster-row-home_services');
    const auto = screen.getByTestId('run-cluster-row-auto_retail');
    expect(home.textContent).toContain('Home services & trades');
    expect(auto.textContent).toContain('Auto & retail');
    // Zeros render as zeros — the coverage gap is measured per cluster (D-06).
    expect(auto).toHaveAttribute('data-found', '0');
    expect(auto.textContent).toContain('0');
    expect(home).toHaveAttribute('data-unmatched', '148');
    expect(isBefore(home, auto)).toBe(true);
    // Phone twins, own testids.
    expect(screen.getByTestId('run-cluster-card-auto_retail')).toHaveAttribute('data-found', '0');
  });

  it('the website block keeps its fixed order and one colour', () => {
    renderReport(reportOf());
    const ids = [
      'run-website-listed',
      'run-host-class-other',
      'run-host-class-social',
      'run-host-class-directory',
      'run-host-class-platform_subdomain',
      'run-host-class-business_site_dead',
      'run-website-none',
    ];
    const rows = ids.map((id) => screen.getByTestId(id));
    for (let i = 1; i < rows.length; i++) {
      expect(isBefore(rows[i - 1]!, rows[i]!), `${ids[i - 1]} before ${ids[i]}`).toBe(true);
    }
    expect(rows.map((r) => r.getAttribute('data-count'))).toEqual([
      '204',
      '121',
      '41',
      '17',
      '14',
      '11',
      '108',
    ]);
    expect(rows[1]!.textContent).toContain('Own website (not yet checked)');
    expect(rows[5]!.textContent).toContain('Dead Google site (business.site)');
    for (const [i, row] of rows.entries()) {
      for (const el of [row, ...row.querySelectorAll('*')]) {
        expect(el.getAttribute('class') ?? '', ids[i]).not.toMatch(COLOUR_CLASS);
      }
    }
  });

  it('a change check shows changes instead of matching', () => {
    renderReport(
      reportOf({
        run: {
          kind: 'change_check',
          costMicroUsd: 0,
          estimateMicroUsdLo: null,
          estimateMicroUsdHi: null,
        },
        changes: {
          checked: 64,
          unchanged: 58,
          withNew: 4,
          withGone: 3,
          newIds: 9,
          goneIds: 5,
          changedTiles: 6,
        },
      }),
    );
    expect(screen.getByTestId('run-changes-checked')).toHaveAttribute('data-count', '64');
    expect(screen.getByTestId('run-changes-unchanged')).toHaveAttribute('data-count', '58');
    expect(screen.getByTestId('run-changes-new')).toHaveAttribute('data-count', '4');
    expect(screen.getByTestId('run-changes-gone')).toHaveAttribute('data-count', '3');
    const card = screen.getByTestId('run-changes');
    expect(card.textContent).toContain('New place ids 9 · Gone place ids 5');
    expect(card.textContent).toContain(
      'The 6 changed tiles are candidates for the next paid sweep.',
    );
    expect(document.querySelector('[data-testid^="run-outcome-"]')).toBeNull();
    expect(screen.queryByTestId('run-outcomes')).toBeNull();
    // The header's free-search note replaces the estimate line.
    expect(screen.getByTestId('run-change-check-note')).toBeInTheDocument();
    expect(screen.queryByTestId('run-estimate-line')).toBeNull();
  });

  it('places-derived cards carry the Google Maps tag', () => {
    const { unmount } = renderReport(reportOf());
    const containers = [...document.querySelectorAll('[data-places-content]')];
    expect(containers.map((c) => c.getAttribute('data-testid'))).toEqual([
      'run-tiles',
      'run-outcomes',
    ]);
    for (const c of containers) {
      expect(
        c.querySelectorAll('[data-testid="google-maps-attribution"]'),
        c.getAttribute('data-testid') ?? '',
      ).toHaveLength(1);
    }
    // Our own ledger is not Places content (D-11): no tag on it.
    expect(
      screen
        .getByTestId('run-requests')
        .querySelectorAll('[data-testid="google-maps-attribution"]'),
    ).toHaveLength(0);
    // Exactly one tag per Places-derived card, none loose on the page.
    expect(document.querySelectorAll('[data-testid="google-maps-attribution"]')).toHaveLength(2);
    unmount();

    renderReport(
      reportOf({
        run: { kind: 'change_check' },
        changes: {
          checked: 1,
          unchanged: 1,
          withNew: 0,
          withGone: 0,
          newIds: 0,
          goneIds: 0,
          changedTiles: 0,
        },
      }),
    );
    const checkContainers = [...document.querySelectorAll('[data-places-content]')];
    expect(checkContainers.map((c) => c.getAttribute('data-testid'))).toEqual([
      'run-tiles',
      'run-changes',
    ]);
    for (const c of checkContainers) {
      expect(c.querySelectorAll('[data-testid="google-maps-attribution"]')).toHaveLength(1);
    }
  });

  it('the outcomes card says no places yet while live', () => {
    renderReport(
      reportOf({
        run: { status: 'running', finishedMs: null },
        outcomes: { found: 0, attached: 0, tentative: 0, unmatched: 0 },
      }),
    );
    const pending = screen.getByTestId('run-outcomes-pending');
    expect(pending.textContent).toContain('No Google places yet');
    expect(pending.textContent).toContain('Results appear here as each tile finishes.');
    expect(screen.queryByTestId('run-outcomes-empty')).toBeNull();
    expect(screen.queryByTestId('run-outcome-found')).toBeNull();
  });

  it('the outcomes card says Google returned none when finished empty', () => {
    renderReport(
      reportOf({
        outcomes: {
          found: 0,
          attached: 0,
          tentative: 0,
          unmatched: 0,
          website: {
            listed: 0,
            none: 0,
            byHostClass: {
              other: 0,
              social: 0,
              directory: 0,
              platform_subdomain: 0,
              business_site_dead: 0,
            },
          },
        },
      }),
    );
    const empty = screen.getByTestId('run-outcomes-empty');
    expect(empty.textContent).toContain('Google returned no places for this run');
    const open = within(empty).getByTestId('run-outcomes-open-preset');
    expect(open).toHaveAttribute('href', `/presets/${PRESET_ID}`);
    expect(open.textContent).toBe('Open McAllen roofers');
    expect(screen.queryByTestId('run-outcomes-pending')).toBeNull();
  });

  it('a run that stopped before any listing never claims every tile was searched', () => {
    const none: Partial<RunReport['outcomes']> = { found: 0, attached: 0, tentative: 0, unmatched: 0 };
    const cases: Array<[RunStatus, StoppedReason]> = [
      ['failed', 'places_key_missing'],
      ['failed', 'never_started'],
      ['failed', 'abandoned'],
      ['failed', 'places_unavailable'],
      ['partial', 'budget_cap_reached'],
      ['partial', 'google_daily_quota'],
      ['partial', 'exceeded_estimate'],
    ];
    for (const [status, reason] of cases) {
      const { unmount } = renderReport(
        reportOf({ run: { status, stoppedReason: reason }, outcomes: none }),
      );
      const label = `${status} · ${reason}`;
      const card = screen.getByTestId('run-outcomes');
      expect(card.textContent, label).not.toContain('Every tile was searched');
      expect(screen.queryByTestId('run-outcomes-empty'), label).toBeNull();
      const reached = within(card).getByTestId('run-outcomes-none-reached');
      expect(reached.textContent, label).toContain(RUN_OUTCOMES_NONE_REACHED_HEADING);
      expect(reached.textContent, label).toContain(RUN_OUTCOMES_NONE_REACHED_BODY);
      expect(within(reached).getByTestId('run-outcomes-open-preset'), label).toHaveAttribute(
        'href',
        `/presets/${PRESET_ID}`,
      );
      unmount();
    }

    // Only a COMPLETE run with nothing found gets the "every tile was searched" sentence.
    renderReport(reportOf({ run: { status: 'complete' }, outcomes: none }));
    expect(screen.getByTestId('run-outcomes-empty').textContent).toContain(
      'Every tile was searched',
    );
    expect(screen.queryByTestId('run-outcomes-none-reached')).toBeNull();
  });

  it('every testid on the report is on one element only', () => {
    // Desk and phone layouts both live in the DOM (CSS hides one), so a shared testid would
    // make every e2e `getByTestId` ambiguous. Repeating list rows are the only exception.
    const REPEATING = new Set([
      'run-truncation-tile',
      'google-maps-attribution',
      'run-tiles-subdividing-tile',
    ]);
    renderReport(
      reportOf({
        run: { status: 'partial', stoppedReason: 'budget_cap_reached' },
        requests: { refusedByMeter: 1, totalRequests: 69 },
        tiles: { stillTruncated: 3, truncated: THREE_TRUNCATED },
      }),
    );
    const counts = new Map<string, number>();
    for (const el of document.querySelectorAll('[data-testid]')) {
      const id = el.getAttribute('data-testid')!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const dupes = [...counts].filter(([id, n]) => n > 1 && !REPEATING.has(id));
    expect(dupes).toEqual([]);
    expect(counts.size).toBeGreaterThan(30);
  });
});
