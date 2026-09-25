import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunSpend } from '@/server/queries/budget';

/**
 * The shared run chrome (plan 04-14, Task 1): the ONE run status badge, the `/spend` By-run
 * stopped-reason leak fix and run links, and the nav rule that lights Presets on `/runs`.
 *
 * jsdom paints nothing, so the badge test pins the shared CLASS LIST (`FLAG_BADGE_SIZING`'s
 * `text-sm font-semibold`, never the primitive's `text-xs`) — the same arrangement
 * `closed-badge.test.tsx` uses for the flag badges.
 *
 * `next/link` is factory-mocked to a plain anchor, as in `closed-badge.test.tsx`: the real one
 * wants an app-router context this lane does not build.
 */
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LEADS_NAV, isNavActive } from '@/components/app-shell/app-sidebar';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { ByRun } from '@/components/spend/by-run';
import { STOPPED_REASON } from '@/lib/ui/copy';
import { RUN_KIND_LABEL, RUN_LABEL } from '@/lib/ui/run-tone';

afterEach(cleanup);

const RUN_ID = '0f3c2a91-6d4e-4b7a-9c1d-2e5f8a7b6c40';

function run(over: Partial<RunSpend>): RunSpend {
  return {
    runId: RUN_ID,
    presetDisplayName: 'McAllen roofers',
    version: 2,
    startedAt: new Date(Date.UTC(2026, 8, 22, 20, 4, 0)),
    finishedAt: new Date(Date.UTC(2026, 8, 22, 20, 21, 4)),
    calls: 412,
    microUsd: 1_900_000n,
    status: 'complete',
    kind: 'full_sweep',
    stoppedReason: null,
    ...over,
  };
}

describe('RunStatusBadge', () => {
  it('the run status badge is one component sized as a flag badge', () => {
    render(<RunStatusBadge status="partial" />);
    const badge = screen.getByTestId('run-status-badge');
    expect(badge).toHaveAttribute('data-status', 'partial');
    expect(badge).toHaveTextContent(RUN_LABEL.partial);
    expect(badge.classList.contains('text-sm')).toBe(true);
    expect(badge.classList.contains('font-semibold')).toBe(true);
    expect(badge.classList.contains('text-xs')).toBe(false);
    // Only `running` spins.
    expect(badge.querySelector('[data-slot="spinner"]')).toBeNull();

    cleanup();
    render(<RunStatusBadge status="running" />);
    const running = screen.getByTestId('run-status-badge');
    expect(running).toHaveTextContent(RUN_LABEL.running);
    const spinner = running.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner!.getAttribute('class')).toContain('motion-reduce:animate-none');
    // The word carries the state; the glyph is decoration, not a second status region.
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('/spend By-run', () => {
  it('the spend view renders stopped reasons as sentences', () => {
    const unknownId = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const { container } = render(
      <ByRun
        runs={[
          run({ status: 'partial', stoppedReason: 'exceeded_estimate' }),
          // A key no sentence exists for — a future writer's. It must render NOTHING.
          run({
            runId: unknownId,
            status: 'partial',
            stoppedReason: 'some_new_key' as RunSpend['stoppedReason'],
          }),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    // One sentence per layout (desk table + phone cards are both in the DOM).
    expect(screen.getAllByText(STOPPED_REASON.exceeded_estimate)).toHaveLength(2);
    expect(text).not.toContain('exceeded_estimate');
    expect(text).not.toContain('some_new_key');
    // The kind is a word too, never its key.
    expect(text).toContain(RUN_KIND_LABEL.full_sweep);
    expect(text).not.toContain('full_sweep');
    // Every status badge on /spend is the shared one.
    const badges = screen.getAllByTestId('run-status-badge');
    expect(badges).toHaveLength(4);
    for (const b of badges) expect(b.classList.contains('text-xs')).toBe(false);
  });

  it('a past partition run names its week, never "this week" (C-WR-06)', () => {
    const second = '5b1c7d2e-3f40-4a51-9b62-7c83d94ea5f6';
    const { container } = render(
      <ByRun
        runs={[
          // Sep 2, 2026 (Chicago) is ISO week 36 — three weeks before "now" in any reading.
          run({ kind: 'partition', startedAt: new Date(Date.UTC(2026, 8, 2, 15, 0, 0)) }),
          // Never started: no instant to name a week from.
          run({ runId: second, kind: 'partition', status: 'refused', startedAt: null }),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain("This week's partition");
    // One per layout (desk table + phone cards).
    expect(screen.getAllByText('Weekly partition · week 36')).toHaveLength(2);
    expect(screen.getAllByText('Weekly partition')).toHaveLength(2);
  });

  it('the spend view links each run to its report', () => {
    const second = '5b1c7d2e-3f40-4a51-9b62-7c83d94ea5f6';
    render(<ByRun runs={[run({}), run({ runId: second, status: 'running' })]} />);
    const desk = screen.getByTestId('spend-by-run-table');
    const phone = screen.getByTestId('spend-by-run-cards');
    for (const id of [RUN_ID, second]) {
      const testId = `spend-run-link-${id}`;
      const deskLinks = within(desk).getAllByTestId(testId);
      const phoneLinks = within(phone).getAllByTestId(testId);
      expect(deskLinks).toHaveLength(1);
      expect(phoneLinks).toHaveLength(1);
      expect(deskLinks[0]).toHaveAttribute('href', `/runs/${id}`);
      expect(phoneLinks[0]).toHaveAttribute('href', `/runs/${id}`);
      // Desk: the name cell is the link. Phone: the whole card is.
      expect(deskLinks[0]).toHaveTextContent('McAllen roofers · version 2');
      expect(within(phoneLinks[0]!).getByTestId('spend-run-card')).toBeInTheDocument();
    }
  });
});

describe('nav', () => {
  it('the run report lights Presets', () => {
    const presets = LEADS_NAV.find((i) => i.testId === 'nav-presets')!;
    expect(presets.alsoActiveUnder).toEqual(['/runs']);

    const report = `/runs/${RUN_ID}`;
    expect(isNavActive(report, '/presets', ['/runs'])).toBe(true);
    expect(isNavActive('/runs', '/presets', ['/runs'])).toBe(true);
    expect(isNavActive('/runsx', '/presets', ['/runs'])).toBe(false);
    // Through the item, as every call site passes it.
    expect(isNavActive(report, presets.base, presets.alsoActiveUnder)).toBe(true);
    // Without the extra prefix the base rule alone does not light it — the `also` is doing it.
    expect(isNavActive(report, '/presets')).toBe(false);
    // And no other destination claims /runs.
    for (const item of LEADS_NAV.filter((i) => i !== presets)) {
      expect(isNavActive(report, item.base, item.alsoActiveUnder)).toBe(false);
    }
  });
});
