import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunReport } from '@/server/queries/run-report';
import type { GoogleListingView } from '@/server/queries/review-queue';
import { walk } from './_walk';

/**
 * The Google Maps attribution REGISTRY (plan 04-28; PLACE-06; D-11; Executor Rule 28; M44).
 *
 * Rule 28 asks for the tag "wherever" a Places-derived value renders. A per-surface test only
 * proves the surfaces someone remembered, so this file holds the two halves of "wherever":
 *
 * 1. `PLACES_SIGNAL_SURFACES` — every surface that paints a Places-derived value, rendered with
 *    a fixture. In each render EVERY `[data-places-content]` element holds EXACTLY ONE
 *    `[data-testid="google-maps-attribution"]`, and the surface's own containers exist (≥ 1),
 *    so a surface that silently stopped rendering cannot pass by having nothing to check.
 *    A failure names the surface.
 * 2. The import walk — every file under `src/components/` and `src/app/` that imports
 *    `@/lib/ui/places-format` (the one Places formatter) also imports `GoogleMapsTag`. A NEW
 *    surface that formats a Places value therefore has to bring the tag with it, before anyone
 *    remembers to register it above.
 *
 * `NOT_PLACES_SURFACES` is the other side of the contract: our own ledger (the run's requests
 * by SKU) and the /sources transient card (counts of what Siteless holds, and its own purge
 * timestamps) show no Places content, so they carry neither a container nor a tag. A tag on
 * them would teach that Google is a source.
 *
 * 🔴 FACTORY MOCKS. `GoogleCheck` renders `DetachDialog` (the detach action carries the server
 * directive and imports `src/db/`, whose `server-only` throws in this lane by design) and
 * `useIsDesk` from run-drawer.tsx, which imports the queue-run action — the same two mocks
 * google-check.test.tsx carries. Nothing here presses a button that would call either.
 * `next/link` is a plain anchor, as in run-report.test.tsx.
 */
vi.mock('@/server/actions/detach-listing', () => ({ detachListing: vi.fn() }));
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
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { GoogleCheck } from '@/components/business-detail/google-check';
import { GoogleListingCard } from '@/components/review/google-listing-card';
import { ReviewScore } from '@/components/review/review-score';
import { ChangesCard } from '@/components/runs/changes-card';
import { OutcomesCard } from '@/components/runs/outcomes-card';
import { RequestsCard } from '@/components/runs/requests-card';
import { RunAlerts } from '@/components/runs/run-alerts';
import { TilesCard } from '@/components/runs/tiles-card';
import { TransientCard } from '@/components/sources/transient-card';
import { GOOGLE_ACTORS, GOOGLE_BUSINESS, IDS, MIXED } from './fixtures/google-check';

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

afterEach(cleanup);

const TAG = '[data-testid="google-maps-attribution"]';

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────

const RUN_ID = '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const STARTED = Date.UTC(2026, 8, 23, 19, 14, 0);

/** A complete full sweep with one still-truncated tile — every Places card has content. */
const REPORT: RunReport = {
  run: {
    id: RUN_ID,
    status: 'complete',
    stoppedReason: null,
    kind: 'full_sweep',
    partitionIndex: null,
    presetId: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
    presetName: 'McAllen home services',
    versionNumber: 1,
    createdMs: STARTED - 5_000,
    startedMs: STARTED,
    finishedMs: STARTED + 60_000,
    costMicroUsd: 70_000,
    callsCount: 2,
    estimateRequestsLo: 1,
    estimateRequestsHi: 4,
    estimateMicroUsdLo: 35_000,
    estimateMicroUsdHi: 140_000,
    ceilingRequests: 8,
    capMicroUsd: 50_000_000,
    capResetMs: Date.UTC(2026, 9, 1, 5, 0, 0),
    capPeriodStart: '2026-09-01',
    capPeriodIsCurrent: true,
  },
  requests: {
    rows: [
      { sku: 'ts_enterprise', requests: 2, freeThisMonth: 0, costMicroUsd: 70_000 },
      { sku: 'ts_essentials', requests: 0, freeThisMonth: 0, costMicroUsd: 0 },
    ],
    refusedByMeter: 0,
    totalRequests: 2,
    totalMicroUsd: 70_000,
  },
  tiles: {
    total: 2,
    searched: 2,
    saturated: 1,
    subdivided: 0,
    stillTruncated: 1,
    truncated: [
      {
        tileKey: 'city:48215/McAllen|roofing_contractor|r000',
        cellKey: 'home_services/48215/McAllen',
        placesType: 'roofing_contractor',
        unitName: 'McAllen',
        typeLabel: 'roofing contractor',
        quadPath: 'r000',
        why: 'min_size',
      },
    ],
    stillSubdividing: [],
  },
  outcomes: {
    found: 3,
    attached: 1,
    tentative: 1,
    unmatched: 1,
    byCluster: [
      {
        clusterKey: 'home_services',
        displayName: 'Home services & trades',
        found: 3,
        attached: 1,
        tentative: 1,
        unmatched: 1,
      },
    ],
    website: {
      listed: 1,
      none: 0,
      byHostClass: {
        other: 0,
        social: 0,
        directory: 0,
        platform_subdomain: 0,
        business_site_dead: 1,
      },
    },
  },
  changes: null,
};

const CHANGES: NonNullable<RunReport['changes']> = {
  checked: 2,
  unchanged: 1,
  withNew: 1,
  withGone: 0,
  newIds: 3,
  goneIds: 0,
  changedTiles: 1,
};

/** A tentative listing in the review queue: the spine side plus the Places card. */
const LISTING: GoogleListingView = {
  kind: 'google',
  attachmentId: '22222222-2222-4222-8222-222222222222',
  placeId: 'ChIJ-registry-place',
  score: 88,
  reason: 'score',
  features: {
    name: 38,
    phone: 0,
    cluster: 5,
    city: 1,
    sab: 1,
    listingPhone: 1,
    listingLocation: 0,
  },
  business: {
    id: '44444444-4444-4444-8444-444444444444',
    displayName: 'Valley Locksmith & Key',
    street: '2100 N 23rd St',
    city: 'McAllen',
    postal: '78501',
    phoneE164: '+19566821234',
    basicCategory: 'locksmith',
    clusterName: 'Home services & trades',
    sourceKey: 'tx_comptroller',
    closedAt: null,
    chain: null,
  },
  tie: null,
};

// ── The registry ─────────────────────────────────────────────────────────────────────────────

type Surface = {
  /** How a failure names it. */
  name: string;
  /** Render the surface into the document (open whatever it keeps collapsed). */
  render: () => Promise<void>;
  /** The surface's OWN Places containers: must match ≥ 1 element in the render. */
  containers: string;
};

async function renderGoogleCheck(): Promise<void> {
  render(<GoogleCheck google={MIXED} business={GOOGLE_BUSINESS} actors={GOOGLE_ACTORS} />);
}

async function renderGoogleCheckWithHistoryOpen(): Promise<void> {
  await renderGoogleCheck();
  await act(async () => {
    fireEvent.click(screen.getByTestId('business-google-history-toggle'));
  });
}

/**
 * Every surface that paints a Places-derived value (a website signal, a listing's score, a
 * check, a run's tiles / outcomes / changes). Add a row here with every new one — and the
 * import walk below fails first if the new surface formats through places-format.
 */
const PLACES_SIGNAL_SURFACES: readonly Surface[] = [
  {
    name: 'business detail · Google check signal row',
    render: renderGoogleCheck,
    containers: '[data-testid="business-google-signal"]',
  },
  {
    name: 'business detail · attached listing row',
    render: renderGoogleCheck,
    containers: `[data-testid="business-google-listing-${IDS.attachedA}"], [data-testid="business-google-listing-${IDS.attachedB}"]`,
  },
  {
    name: 'business detail · pending (tentative) listing row',
    render: renderGoogleCheck,
    containers: `[data-testid="business-google-listing-${IDS.tentative}"]`,
  },
  {
    name: 'business detail · check-history rows (opened)',
    render: renderGoogleCheckWithHistoryOpen,
    containers: '[data-testid^="business-google-history-row-"]',
  },
  {
    name: 'review queue · Google listing card',
    render: async () => {
      render(<GoogleListingCard item={LISTING} />);
    },
    containers: '[data-testid="review-google-listing"]',
  },
  {
    name: 'run report · Tiles card',
    render: async () => {
      render(<TilesCard tiles={REPORT.tiles} stoppedReason={REPORT.run.stoppedReason} />);
    },
    containers: '[data-testid="run-tiles"]',
  },
  {
    name: 'run report · Outcomes card',
    render: async () => {
      render(<OutcomesCard run={REPORT.run} outcomes={REPORT.outcomes} />);
    },
    containers: '[data-testid="run-outcomes"]',
  },
  {
    name: 'run report · Changes card',
    render: async () => {
      render(<ChangesCard changes={CHANGES} />);
    },
    containers: '[data-testid="run-changes"]',
  },
  // C-WR-02: a tile saturation count ("{n} tiles still hit Google's 60-result limit") and the
  // truncated-tile list are Places-derived, outside the Tiles card.
  {
    name: 'run report · truncation warning',
    render: async () => {
      render(
        <RunAlerts run={REPORT.run} tiles={REPORT.tiles} canRaiseCap renderedAtMs={STARTED} />,
      );
    },
    containers: '[data-testid="run-truncation-warning"]',
  },
  // C-WR-02: "{k} tiles were still subdividing when it stopped" — a saturation count too.
  {
    name: 'run report · exceeded-estimate stop alert',
    render: async () => {
      render(
        <RunAlerts
          run={{ ...REPORT.run, status: 'partial', stoppedReason: 'exceeded_estimate' }}
          tiles={{
            ...REPORT.tiles,
            stillTruncated: 0,
            truncated: [],
            stillSubdividing: [
              {
                tileKey: 'city:48215/McAllen|roofing_contractor|r0',
                cellKey: 'home_services/48215/McAllen',
                placesType: 'roofing_contractor',
                unitName: 'McAllen',
                typeLabel: 'roofing contractor',
                quadPath: 'r0',
              },
            ],
          }}
          canRaiseCap
          renderedAtMs={STARTED}
        />,
      );
    },
    containers: '[data-testid="run-stop-alert"][data-reason="exceeded_estimate"]',
  },
  // C-WR-02: a Google item's score line sits in the review header row, outside the listing card.
  {
    name: 'review queue · score line (Google listing)',
    render: async () => {
      render(<ReviewScore kind="google" score={LISTING.score} />);
    },
    containers: '[data-testid="review-score"]',
  },
];

/** Surfaces that show NO Places content: never a container, never a tag (D-11). */
const NOT_PLACES_SURFACES: readonly { name: string; render: () => void; root: string }[] = [
  {
    name: 'run report · Requests card (our own ledger)',
    render: () => render(<RequestsCard requests={REPORT.requests} />),
    root: '[data-testid="run-requests"]',
  },
  {
    // A duplicate pair's score compares two of OUR records — nothing Google in it.
    name: 'review queue · score line (duplicate pair)',
    render: () => render(<ReviewScore kind="duplicate" score={88} />),
    root: '[data-testid="review-score"]',
  },
  {
    // A stop that is about money, not tiles, carries no Places number.
    name: 'run report · cap stop alert',
    render: () =>
      render(
        <RunAlerts
          run={{ ...REPORT.run, status: 'partial', stoppedReason: 'budget_cap_reached' }}
          tiles={{ ...REPORT.tiles, stillTruncated: 0, truncated: [] }}
          canRaiseCap
          renderedAtMs={STARTED}
        />,
      ),
    root: '[data-testid="run-stop-alert"]',
  },
  {
    // IN-01: an exceeded-estimate stop with NO tile still subdividing prints no Places count —
    // only our own estimate and ceiling — so it is no container and carries no tag.
    name: 'run report · exceeded-estimate stop alert, 0 tiles subdividing',
    render: () =>
      render(
        <RunAlerts
          run={{ ...REPORT.run, status: 'partial', stoppedReason: 'exceeded_estimate' }}
          tiles={{ ...REPORT.tiles, stillTruncated: 0, truncated: [], stillSubdividing: [] }}
          canRaiseCap
          renderedAtMs={STARTED}
        />,
      ),
    root: '[data-testid="run-stop-alert"]',
  },
  {
    name: '/sources · Google Places (transient) card (counts of what Siteless holds)',
    render: () =>
      render(
        <TransientCard
          stats={{
            placeIdsHeld: 12,
            coordinatesHeld: 9,
            oldestCoordinateMs: STARTED - 3 * 86_400_000,
            expiredAwaitingPurge: 0,
            oldestExpiredMs: null,
            lastPurgeMs: STARTED - 3_600_000,
            lastRowsPurged: 2,
          }}
          nowMs={STARTED}
        />,
      ),
    root: '[data-testid="sources-transient"]',
  },
];

function testidOf(el: Element): string {
  return el.getAttribute('data-testid') ?? `<${el.tagName.toLowerCase()}>`;
}

/** The registered surface a Places container belongs to — so a failure names the surface
 *  that lost its tag, not merely the render it happened to appear in. */
function ownerOf(el: Element): string | null {
  return PLACES_SIGNAL_SURFACES.find((s) => el.matches(s.containers))?.name ?? null;
}

describe('google maps attribution registry', () => {
  it('google maps attribution renders wherever a places signal renders', async () => {
    // A Set: several surfaces share one render (the business detail card), so the same
    // container is seen more than once.
    const failures = new Set<string>();

    for (const surface of PLACES_SIGNAL_SURFACES) {
      await surface.render();

      // Two-sided: the surface's own containers render, and each IS a Places container.
      const own = [...document.querySelectorAll(surface.containers)];
      if (own.length === 0) failures.add(`${surface.name}: rendered no container`);
      for (const el of own) {
        if (!el.hasAttribute('data-places-content'))
          failures.add(`${surface.name}: ${testidOf(el)} is not [data-places-content]`);
      }

      // Every Places container in the render holds exactly one tag, named by its owner.
      // A container no registered surface claims is itself a failure: register it.
      for (const el of document.querySelectorAll('[data-places-content]')) {
        const owner = ownerOf(el) ?? `UNREGISTERED container in the ${surface.name} render`;
        const tags = el.querySelectorAll(TAG).length;
        if (!ownerOf(el)) failures.add(`${owner}: ${testidOf(el)}`);
        if (tags !== 1) failures.add(`${owner}: ${testidOf(el)} holds ${tags} Google Maps tags`);
      }

      // A tag outside any Places container is attribution for nothing.
      for (const tag of document.querySelectorAll(TAG)) {
        if (!tag.closest('[data-places-content]'))
          failures.add(`${surface.name}: a Google Maps tag outside any [data-places-content]`);
      }

      cleanup();
    }

    for (const surface of NOT_PLACES_SURFACES) {
      surface.render();
      const root = document.querySelector(surface.root);
      if (!root) failures.add(`${surface.name}: did not render`);
      const containers = document.querySelectorAll('[data-places-content]').length;
      const tags = document.querySelectorAll(TAG).length;
      if (containers !== 0)
        failures.add(
          `${surface.name}: ${containers} [data-places-content] on a non-Places surface`,
        );
      if (tags !== 0)
        failures.add(`${surface.name}: ${tags} Google Maps tags on a non-Places surface`);
      cleanup();
    }

    expect(PLACES_SIGNAL_SURFACES.length).toBeGreaterThanOrEqual(10);
    expect([...failures]).toEqual([]);
  });

  it('every places formatter import brings the tag with it', () => {
    const root = process.cwd();
    const files = ['src/components', 'src/app'].flatMap((dir) =>
      walk(nodePath.join(root, dir), { exts: new Set(['.ts', '.tsx']) }),
    );
    // A module specifier ending in places-format — the alias, a relative path, or an extension.
    const importsFormatter =
      /(?:from\s*|import\s*\(\s*|import\s+)['"][^'"]*\/places-format(?:\.tsx?)?['"]/;
    const importsTag =
      /import\s*\{[^}]*\bGoogleMapsTag\b[^}]*\}\s*from\s*['"][^'"]*\/google-maps-tag(?:\.tsx?)?['"]/;

    const importers: string[] = [];
    const missing: string[] = [];
    for (const file of files) {
      const source = nodeFs.readFileSync(file, 'utf8');
      if (!importsFormatter.test(source)) continue;
      const rel = nodePath.relative(root, file).split(nodePath.sep).join('/');
      importers.push(rel);
      if (!importsTag.test(source)) missing.push(rel);
    }

    // Two-sided: the walk read the real tree and found the known importers.
    expect(files.length).toBeGreaterThan(50);
    expect(importers.length).toBeGreaterThanOrEqual(3);
    expect(importers).toEqual(
      expect.arrayContaining([
        'src/components/business-detail/google-check.tsx',
        'src/components/review/google-listing-card.tsx',
        'src/components/runs/outcomes-card.tsx',
      ]),
    );
    expect(missing).toEqual([]);
  });
});
