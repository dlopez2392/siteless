/**
 * The places-sweep workflow's queue, as a pure reducer (04-RESEARCH Pattern 1).
 *
 * The workflow body loops `nextSearch → searchTile (step) → applyResult` until the queue is empty
 * or a stop arrives. Everything it DECIDES lives here, so it is unit-tested without the workflow
 * compiler.
 *
 * 🔴 SANDBOX-SAFE. The workflow runtime replays this code deterministically inside a sandbox:
 * `import type` ONLY — no Node modules, no `@/db`, no workflow runtime, no clock, no randomness.
 * Every function returns a NEW state; nothing is mutated, so a replay sees the same history.
 *
 * 🔴 `SearchResult` IS THE STEP → WORKFLOW CONTRACT (04-18 searchTile, 04-19 checkTile, 04-22
 * workflow), and it is persisted in the workflow event log for the run + 7 days (T-4-05). It
 * carries tile keys, counts, rects and enums ONLY — no field can hold a business name, address,
 * phone or URL. `failReasonOf` likewise never echoes an error message: a thrown message may
 * carry a Places response fragment, so it collapses to an allow-listed machine key.
 */
import type { TileSpec } from '@/lib/places/tiling';

export type PlannedSearch = TileSpec & { searchId: string };

/** A run that ends early but cleanly — reported as `partial` (D-19: quota → partial). */
export type StopReason = 'budget_cap_reached' | 'exceeded_estimate' | 'google_daily_quota';

/** A run that ends on an error — reported as `failed`. */
export type FailReason = 'places_request_rejected' | 'places_unavailable' | 'places_key_missing';

const FAIL_REASONS: readonly FailReason[] = [
  'places_request_rejected',
  'places_unavailable',
  'places_key_missing',
];

export type SearchResult =
  | {
      kind: 'searched';
      tileKey: string;
      resultsCount: number;
      saturated: boolean;
      next:
        | { action: 'done' }
        | { action: 'subdivide'; children: PlannedSearch[] }
        | { action: 'truncate'; why: 'max_depth' | 'min_size' | 'novelty' };
    }
  | { kind: 'checked'; tileKey: string; changed: boolean }
  | { kind: 'stopped'; tileKey: string; reason: StopReason };

export type QueueState = {
  /** FIFO — breadth-first: children join the back. */
  pending: PlannedSearch[];
  searched: number;
  saturated: number;
  subdivided: number;
  truncated: number;
  /** The FIRST stop reason; a stopped queue yields no further searches. */
  stopped: StopReason | null;
};

/**
 * B-WR-09. One search id is one `run_searches` row; queued twice it is searched — and billed —
 * twice, and `applyResult` would drop only the first. Refused (the ids are ours; nothing from a
 * Places response is in the message).
 */
function assertOnce(searches: readonly PlannedSearch[]): void {
  const ids = new Set<string>();
  for (const s of searches) {
    if (ids.has(s.searchId)) {
      throw new Error(`reducer: search ${s.searchId} (${s.tileKey}) would be queued twice`);
    }
    ids.add(s.searchId);
  }
}

export function initialQueue(roots: PlannedSearch[]): QueueState {
  assertOnce(roots);
  return {
    pending: [...roots],
    searched: 0,
    saturated: 0,
    subdivided: 0,
    truncated: 0,
    stopped: null,
  };
}

/** The head of the queue; `null` once stopped or empty. */
export function nextSearch(s: QueueState): PlannedSearch | null {
  if (s.stopped !== null) return null;
  return s.pending[0] ?? null;
}

export function applyResult(s: QueueState, search: PlannedSearch, r: SearchResult): QueueState {
  if (r.tileKey !== search.tileKey) {
    // Tile keys are ours and DB-safe; nothing from a Places response is in this message.
    throw new Error(`reducer: result for ${r.tileKey} applied to ${search.tileKey}`);
  }
  if (r.kind === 'stopped') {
    // The stopped search did not complete: it stays pending (reported as unsearched), and the
    // first stop reason wins.
    return { ...s, pending: [...s.pending], stopped: s.stopped ?? r.reason };
  }
  const index = s.pending.findIndex((p) => p.searchId === search.searchId);
  const pending =
    index === -1 ? [...s.pending] : [...s.pending.slice(0, index), ...s.pending.slice(index + 1)];
  if (r.kind === 'checked') {
    return { ...s, pending, searched: s.searched + 1 };
  }
  const next = {
    ...s,
    pending,
    searched: s.searched + 1,
    saturated: s.saturated + (r.saturated ? 1 : 0),
  };
  switch (r.next.action) {
    case 'done':
      return next;
    case 'subdivide': {
      const queued = [...pending, ...r.next.children];
      assertOnce(queued);
      return { ...next, pending: queued, subdivided: next.subdivided + 1 };
    }
    case 'truncate':
      return { ...next, truncated: next.truncated + 1 };
  }
}

/** An `Error` whose message is exactly an allow-listed key → that key. Anything else — any other
 *  message, a non-Error, a stop reason — → `places_unavailable`. The message is never echoed.
 *
 *  🔴 CROSS-REALM (04-22, measured). The workflow body runs inside the runtime's VM sandbox, and
 *  a failed step reaches its `catch` as a `FatalError` constructed OUTSIDE it (@workflow/core
 *  step.js), so `e instanceof Error` — the sandbox's `Error` — is false for every step failure,
 *  and a 400 reported `places_unavailable`. The brand check (`[object Error]`, which reads the
 *  internal error slot and holds across realms) accepts it; a plain `{ message }` object still
 *  does not. */
function isError(e: unknown): e is Error {
  return e instanceof Error || Object.prototype.toString.call(e) === '[object Error]';
}

export function failReasonOf(e: unknown): FailReason {
  if (isError(e)) {
    const match = FAIL_REASONS.find((k) => k === e.message);
    if (match) return match;
  }
  return 'places_unavailable';
}

/** Failure beats stop beats complete. */
export function finishVerdict(
  s: QueueState,
  failure: FailReason | null,
): { status: 'complete' | 'partial' | 'failed'; reason: StopReason | FailReason | null } {
  if (failure !== null) return { status: 'failed', reason: failure };
  if (s.stopped !== null) return { status: 'partial', reason: s.stopped };
  return { status: 'complete', reason: null };
}
