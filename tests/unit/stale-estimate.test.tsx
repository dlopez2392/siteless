import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstimateRange } from '@/lib/estimate/estimate';
import type { PresetSpecInput } from '@/server/queries/presets';

/**
 * Pitfall 5, as a named component test: an out-of-order server-action answer must never
 * repaint over a fresher one.
 *
 * WHY THIS TEST EXISTS AT ALL. Next.js Server Actions are QUEUED and UNCANCELLABLE — no
 * `AbortController` — so an answer computed for an earlier selection can arrive after an
 * answer computed for a later one. Nothing on the server can prevent it: by the time the
 * answer exists, the request that asked for it is gone. The only defence is the monotonic
 * `seq` guard in `use-live-estimate.ts`, and a guard nothing can kill is dead code — so
 * this file was watched RED with that guard deleted, and its in-order control was watched
 * STAY GREEN in the same run, which is what proves the guard discriminates rather than
 * simply discarding every answer.
 *
 * 🔴 THE HOOK IS DRIVEN AT `debounceMs = 0`, NOT WITH FAKE TIMERS. The debounce is a real
 * 400 ms in the product (`ESTIMATE_DEBOUNCE_MS`); driving it at zero here lets two
 * recomputes actually reach the action instead of the second one cancelling the first's
 * timer, which is the whole scenario under test.
 *
 * 🔴 THE ACTION MODULE IS FACTORY-MOCKED. `src/server/actions/estimate-preset.ts` carries
 * the server directive and pulls in `src/db/`, whose `import 'server-only'` throws outside
 * a react-server build — and the dom lane deliberately leaves that guard armed (see
 * vitest.config.ts). A factory mock prevents the real module from loading at all.
 */
vi.mock('@/server/actions/estimate-preset', () => ({ estimatePreset: vi.fn() }));

import { estimatePreset } from '@/server/actions/estimate-preset';
import { EstimatePanel, NO_CLUSTER_PROMPT } from '@/components/preset-editor/estimate-panel';
import { useLiveEstimate } from '@/components/preset-editor/use-live-estimate';

const mocked = vi.mocked(estimatePreset);

/** Radix and vaul both read these on mount; jsdom ships neither. Stubbed here rather than
 *  in the shared setup file so this test carries its own environment. */
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

/**
 * Two specs that differ in a way the hook's key must notice — one city against two. Ids
 * are opaque to the hook; it JSON-stringifies the spec and compares.
 */
const SPEC_A: PresetSpecInput = {
  clusterKeys: ['home_services'],
  geo: { kind: 'cities', cityIds: ['11111111-1111-4111-8111-111111111111'] },
};
const SPEC_B: PresetSpecInput = {
  clusterKeys: ['home_services', 'auto_retail'],
  geo: {
    kind: 'cities',
    cityIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
  },
};

/** $1.10 for A, $2.90 for B — far enough apart that no rounding can confuse them. */
const A_MICRO = 1_100_000;
const B_MICRO = 2_900_000;

function range(costMicroUsdHi: number): EstimateRange {
  return {
    cells: 68,
    requestsLo: 204,
    requestsHi: 612,
    costMicroUsdLo: Math.round(costMicroUsdHi / 2),
    costMicroUsdHi,
    expectedResults: 1100,
    freeRemaining: 1000,
    remainingMicroUsd: 47_600_000n,
    pctOfRemainingLo: 2.4,
    pctOfRemainingHi: 4.8,
    sku: 'ts_enterprise',
    assumptions: { fanOut: 3, pagesLo: 1, pagesHi: 3, radiusReferenceMiles: 25 },
  };
}

const okResult = (micro: number) => ({ ok: true as const, data: range(micro) });

function deferred() {
  let resolve!: (value: { ok: true; data: EstimateRange }) => void;
  const promise = new Promise<{ ok: true; data: EstimateRange }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness({ spec }: { spec: PresetSpecInput | null }) {
  const { estimate, error, busy } = useLiveEstimate(spec, 0);
  return (
    <EstimatePanel
      estimate={estimate}
      error={error}
      busy={busy}
      hasClusters={(spec?.clusterKeys.length ?? 0) > 0}
      hasSpec={spec !== null}
      texasMultiplier={null}
    />
  );
}

const dollars = () => screen.getByTestId('preset-editor-estimate-dollars');
const region = () => screen.getByTestId('preset-editor-estimate');

beforeEach(() => {
  mocked.mockReset();
});

/**
 * 🔴 EXPLICIT, NOT AUTOMATIC. Testing Library registers its own `afterEach(cleanup)` only
 * when vitest runs with `globals: true`, and `vitest.config.ts` deliberately does not.
 * Without this line every render accumulates in one document and the SECOND test in this
 * file fails with "Found multiple elements by: preset-editor-estimate-dollars" — which is
 * a harness bug that looks exactly like a duplicated testid.
 */
afterEach(cleanup);

describe('stale estimate', () => {
  it('stale estimate: an out-of-order answer never repaints over a fresher one', async () => {
    const first = deferred();
    mocked.mockReturnValueOnce(first.promise);
    mocked.mockResolvedValueOnce(okResult(B_MICRO));

    const { rerender } = render(<Harness spec={SPEC_A} />);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));

    rerender(<Harness spec={SPEC_B} />);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));

    // Call 2 answers first and paints.
    await waitFor(() => expect(dollars()).toHaveTextContent('~$2.90'));

    // Call 1 — issued EARLIER, answered LAST. This is the exact ordering the queue
    // behaviour produces and the exact ordering the guard exists for.
    await act(async () => {
      first.resolve(okResult(A_MICRO));
      await first.promise;
    });

    expect(dollars()).toHaveTextContent('~$2.90');
    expect(dollars()).not.toHaveTextContent('~$1.10');
  });

  it('stale estimate: the in-order control still paints the newer answer', async () => {
    // The inverse of the test above, in the same file and against the same guard. Without
    // it, a hook that simply ignored EVERY answer would pass the out-of-order test.
    mocked.mockResolvedValueOnce(okResult(A_MICRO));
    mocked.mockResolvedValueOnce(okResult(B_MICRO));

    const { rerender } = render(<Harness spec={SPEC_A} />);
    await waitFor(() => expect(dollars()).toHaveTextContent('~$1.10'));

    rerender(<Harness spec={SPEC_B} />);
    await waitFor(() => expect(dollars()).toHaveTextContent('~$2.90'));
  });

  it('stale estimate: the previous value stays visible while recomputing', async () => {
    mocked.mockResolvedValueOnce(okResult(A_MICRO));
    const pending = deferred();
    mocked.mockReturnValueOnce(pending.promise);

    const { rerender } = render(<Harness spec={SPEC_A} />);
    await waitFor(() => expect(dollars()).toHaveTextContent('~$1.10'));

    rerender(<Harness spec={SPEC_B} />);
    await waitFor(() => expect(region()).toHaveAttribute('aria-busy', 'true'));

    // 🔴 The whole point: the old figure is STILL THERE while the new one computes.
    expect(dollars()).toBeInTheDocument();
    expect(dollars()).toHaveTextContent('~$1.10');
    // And it did not become a skeleton. UI-SPEC § States → Loading: "Never a skeleton,
    // never a blank" for this one region.
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('stale estimate: no cluster selected renders the prompt, not a zero', async () => {
    render(<Harness spec={null} />);

    expect(screen.getByText(NO_CLUSTER_PROMPT)).toBeInTheDocument();
    expect(screen.getByText('Pick at least one cluster to see an estimate.')).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    // Nothing was asked of the server for a selection that cannot be priced.
    expect(mocked).not.toHaveBeenCalled();
  });
});
