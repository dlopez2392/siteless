import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * BUDG-03's card on /settings/budget (04-UI-SPEC § Screen 6, Executor Rule 41; plan 04-31).
 *
 * The card has two states and the switch between them is ONE recorded constant,
 * `GOOGLE_QUOTA_SET_ON` in src/lib/budget/second-wall.ts — static copy the D-03 checkpoint
 * writes; the app cannot read Google Cloud. The constant module is mocked with a getter so each
 * test chooses the state without re-importing the card.
 *
 * jsdom paints nothing, so the badge is pinned by its CLASS LIST (`FLAG_BADGE_SIZING`, the same
 * pin tests/unit/closed-badge.test.tsx uses for every flag badge) and by the absence of the
 * primitive's 12px `text-xs` the card used to carry.
 */
const quota = vi.hoisted(() => ({ setOn: null as string | null, perDay: 100 }));

// Getters, so a test can move EITHER constant and see what reads it move (C-WR-09).
vi.mock('@/lib/budget/second-wall', () => ({
  get GOOGLE_QUOTA_REQUESTS_PER_DAY() {
    return quota.perDay;
  },
  get GOOGLE_QUOTA_SET_ON() {
    return quota.setOn;
  },
}));

// The run-stop alert renders beside the card in the "moves together" test.
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecondWallCard } from '@/components/budget/second-wall-card';
import { FLAG_BADGE_SIZING } from '@/components/flags/flag-badge';
import { RunAlerts } from '@/components/runs/run-alerts';
import {
  SECOND_WALL_BODY,
  SECOND_WALL_CONSOLE_LINK,
  SECOND_WALL_NEEDS_BADGE,
  SECOND_WALL_SET_BADGE,
  SECOND_WALL_SET_BODY,
  SECOND_WALL_SET_TITLE,
  SECOND_WALL_TITLE,
} from '@/lib/ui/copy';
import type { RunReport } from '@/server/queries/run-report';

/** The inputs the card derives from the real price book at the shipped quota. */
const SHIPPED = {
  quotaPerDay: 100,
  microUsdPerRequest: 35_000,
  freePerMonth: 1_000,
  budgetMicroUsd: 50_000_000,
};

afterEach(() => {
  cleanup();
  quota.setOn = null;
  quota.perDay = 100;
});

const CONSOLE = 'https://console.cloud.google.com/google/maps-apis/quotas';

function badgeIn(card: HTMLElement): HTMLElement {
  const badge = card.querySelector<HTMLElement>('[data-slot="badge"]');
  if (badge === null) throw new Error('the second-wall card rendered no badge');
  return badge;
}

function expectFlagSized(badge: HTMLElement) {
  for (const token of FLAG_BADGE_SIZING.split(' ')) expect(badge).toHaveClass(token);
  // The primitive's 12/500 default is what Rule 41 removes; twMerge drops it when the sizing
  // is applied, so its presence means the sizing was not.
  expect(badge).not.toHaveClass('text-xs');
  expect(badge).not.toHaveClass('font-medium');
}

function expectHonestyLineAndConsole(card: HTMLElement) {
  // The honesty line is the point of the card in BOTH states: the quota bounds a day, only
  // the meter bounds the month.
  const limit = within(card).getByTestId('budget-second-wall-limit');
  expect(limit.textContent).toContain('3,000 requests, which is $70.00/month — more than the $50.00');
  expect(limit.querySelectorAll('strong')).toHaveLength(3);

  const link = within(card).getByTestId('budget-second-wall-console');
  expect(link).toHaveTextContent(SECOND_WALL_CONSOLE_LINK);
  expect(link).toHaveAttribute('href', CONSOLE);
  expect(link).toHaveAttribute('target', '_blank');
}

describe('the second-wall card', () => {
  it('the second wall reads not set while the date is null', () => {
    render(<SecondWallCard />);
    const card = screen.getByTestId('budget-second-wall');

    expect(within(card).getByText(SECOND_WALL_TITLE)).toBeInTheDocument();
    const badge = badgeIn(card);
    expect(badge).toHaveTextContent(SECOND_WALL_NEEDS_BADGE);
    expect(badge).toHaveAttribute('data-variant', 'outline');
    expectFlagSized(badge);

    expect(within(card).getByText(SECOND_WALL_BODY)).toBeInTheDocument();
    const derivation = within(card).getByTestId('budget-second-wall-derivation');
    expect(derivation.textContent).toMatch(/^Set Places API \(New\) → 100 requests\/day\. /);
    // The spec's arithmetic, now DERIVED from the price book and the quota (C-WR-09) — the
    // shipped values still read exactly as the runbook's derivation.
    expect(derivation.textContent).toContain(
      'a $50.00 cap buys 1,428 paid Text Search Enterprise requests at $35.00/1,000, plus ' +
        '1,000 free = 2,428/month ≈ 80/day. Rounded to 100/day',
    );
    expect(derivation.textContent).toContain('about $3.50/day instead of $50.00 in an hour.');
    expect(within(derivation).getByText('Places API (New) → 100 requests/day').tagName).toBe(
      'STRONG',
    );

    expect(within(card).queryByText(SECOND_WALL_SET_TITLE)).toBeNull();
    expectHonestyLineAndConsole(card);
  });

  it('the second wall reads set once the checkpoint records a date', () => {
    quota.setOn = '2026-09-25';
    render(<SecondWallCard />);
    const card = screen.getByTestId('budget-second-wall');

    expect(within(card).getByText(SECOND_WALL_SET_TITLE)).toBeInTheDocument();
    expect(within(card).queryByText(SECOND_WALL_TITLE)).toBeNull();

    const badge = badgeIn(card);
    expect(badge).toHaveTextContent(new RegExp(`^${SECOND_WALL_SET_BADGE}$`));
    expect(badge).toHaveAttribute('data-variant', 'secondary');
    expectFlagSized(badge);
    expect(within(card).queryByText(SECOND_WALL_NEEDS_BADGE)).toBeNull();

    // A floating calendar date, anchored at noon UTC: a midnight-UTC anchor renders the 24th,
    // because the app formats in America/Chicago while the suite's process zone is UTC — one
    // instant, two zones, and only the noon anchor gives both the same day. The whole body is
    // the Copy Table string, exact.
    const body = within(card).getByTestId('budget-second-wall-body');
    expect(body).toHaveTextContent(SECOND_WALL_SET_BODY('Sep 25, 2026', SHIPPED));
    expect(body.textContent).toContain(
      'SearchTextRequest per day = 100, every other Places method per day = 0, set on Sep 25, 2026.',
    );
    expect(body.textContent).toContain('about $3.50 of paid requests');

    // The "they don't yet" paragraph and the imperative "Set …" recommendation are the
    // not-set state's; a card that says "set" must not also say "set it".
    expect(card.textContent).not.toContain(SECOND_WALL_BODY);
    expect(within(card).queryByTestId('budget-second-wall-derivation')).toBeNull();

    expectHonestyLineAndConsole(card);
  });
});

describe('the quota constant is the one source (C-WR-09)', () => {
  it('changing the quota moves the settings card and the stopped run together', () => {
    quota.perDay = 150;
    quota.setOn = '2026-09-25';

    // The card, both its set body and its honesty line.
    render(<SecondWallCard />);
    const card = screen.getByTestId('budget-second-wall');
    const body = within(card).getByTestId('budget-second-wall-body');
    expect(body.textContent).toContain('SearchTextRequest per day = 150');
    expect(body.textContent).toContain('after 150 a day — about $5.25 of paid requests');
    const limit = within(card).getByTestId('budget-second-wall-limit');
    // 150 × 30 = 4,500; minus 1,000 free = 3,500 paid × $0.035 = $122.50.
    expect(limit.textContent).toContain('150/day × 30 days is 4,500 requests, which is $122.50');
    expect(card.textContent).not.toMatch(/\b100\b/);
    cleanup();

    // The run that stopped at Google's daily limit names the SAME number.
    const run = {
      id: '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
      status: 'partial',
      stoppedReason: 'google_daily_quota',
      kind: 'full_sweep',
      partitionIndex: null,
      presetId: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
      presetName: 'McAllen roofers',
      versionNumber: 1,
      createdMs: 0,
      startedMs: 0,
      finishedMs: 0,
      costMicroUsd: 0,
      callsCount: 150,
      estimateRequestsLo: null,
      estimateRequestsHi: null,
      estimateMicroUsdLo: null,
      estimateMicroUsdHi: null,
      ceilingRequests: 300,
      capMicroUsd: 50_000_000,
      capResetMs: 0,
      capPeriodStart: '2026-09-01',
      capPeriodIsCurrent: true,
    } satisfies RunReport['run'];
    const tiles: RunReport['tiles'] = {
      total: 10,
      searched: 4,
      saturated: 0,
      subdivided: 0,
      stillTruncated: 0,
      truncated: [],
      stillSubdividing: [],
    };
    render(<RunAlerts run={run} tiles={tiles} canRaiseCap renderedAtMs={0} />);
    expect(screen.getByTestId('run-stop-alert').textContent).toContain(
      "Stopped at Google's daily limit of 150 requests.",
    );
  });

  it('a quota whose month costs less than the cap is never described as more', () => {
    quota.perDay = 40; // 1,200 requests, 200 paid → $7.00
    render(<SecondWallCard />);
    const limit = screen.getByTestId('budget-second-wall-limit');
    expect(limit.textContent).toContain('which is $7.00/month — less than the $50.00 cap');
    expect(limit.textContent).not.toContain('more than');
  });
});

/**
 * Rule 41 / inherited Executor Rule 5: every word on the card comes from copy.ts. Parsed, not
 * grepped — the card's comments are full of prose and its class lists are long space-separated
 * strings, and neither is copy. What is copy: JSX text and any string or template literal that
 * is not a `className` value, with more than three words.
 */
const CARD = nodePath.join('src', 'components', 'budget', 'second-wall-card.tsx');

function proseIn(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'className') return;
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxText(node) && words(node.text) > 3) found.push(node.text.trim());
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      words(node.text) > 3
    ) {
      found.push(node.text);
    }
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
      if (words(text) > 3) found.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('the second-wall card source', () => {
  it('the second wall card spells no inline strings', () => {
    // Two-sided: the detector finds prose in each shape it hunts, and ignores class lists.
    const sample = [
      'const a = "four words right here";',
      'const b = `four ${1} words right here`;',
      'const c = <p className="flex h-11 w-fit items-center text-sm">five words of JSX text</p>;',
    ].join('\n');
    expect(proseIn('sample.tsx', sample)).toEqual([
      'four words right here',
      'four   words right here',
      'five words of JSX text',
    ]);

    const source = nodeFs.readFileSync(CARD, 'utf8');
    expect(source).toContain('SecondWallCard');
    expect(proseIn(CARD, source)).toEqual([]);
    expect(source).not.toMatch(/\btext-xs\b/);
  });
});
