/**
 * PLACE-03 — the places-sweep workflow's queue, as a pure reducer (04-RESEARCH Pattern 1).
 *
 * The workflow body is sandboxed and replayed, so everything it decides lives here, testable
 * without the workflow compiler: breadth-first order, a stop that ends the run, truncation that
 * is counted, and failures that collapse to allow-listed machine keys only (T-4-05 — an error
 * message can carry Places content into the event log; `failReasonOf` never echoes one).
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { rootSpec, tileKeyOf, type TileSpec } from '@/lib/places/tiling';
import {
  applyResult,
  failReasonOf,
  finishVerdict,
  initialQueue,
  nextSearch,
  type PlannedSearch,
  type QueueState,
  type SearchResult,
} from '@/workflows/places-sweep/reducer';

const RECT = { south: 26.1, west: -98.3, north: 26.4, east: -98.2 };

function root(unitName: string): PlannedSearch {
  const unitId = `48215\u0000${unitName}`;
  const spec = rootSpec({
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId,
    placesType: 'plumber',
    kind: 'enterprise',
    shape: { kind: 'polygon', unitKind: 'city', unitId },
    bbox: RECT,
  });
  return { ...spec, searchId: `s-${spec.tileKey}` };
}

function childOf(parent: PlannedSearch, digit: number): PlannedSearch {
  const quadPath = parent.quadPath + String(digit);
  const tileKey = tileKeyOf(parent.unitKind, parent.unitId, parent.placesType, quadPath);
  const spec: TileSpec = {
    ...parent,
    tileKey,
    quadPath,
    depth: parent.depth + 1,
    parentTileKey: parent.tileKey,
  };
  return { ...spec, searchId: `s-${tileKey}` };
}

const subdivided = (s: PlannedSearch, children: PlannedSearch[]): SearchResult => ({
  kind: 'searched',
  tileKey: s.tileKey,
  resultsCount: 60,
  saturated: true,
  next: { action: 'subdivide', children },
});

const done = (s: PlannedSearch, resultsCount = 12): SearchResult => ({
  kind: 'searched',
  tileKey: s.tileKey,
  resultsCount,
  saturated: false,
  next: { action: 'done' },
});

describe('the queue', () => {
  it('the reducer enqueues children breadth-first', () => {
    const a = root('McAllen');
    const b = root('Pharr');
    const a0 = childOf(a, 0);
    const a3 = childOf(a, 3);
    const b1 = childOf(b, 1);

    const roots = [a, b];
    let s: QueueState = initialQueue(roots);
    // The queue does not alias the caller's array.
    roots.push(a3);
    expect(s).toEqual({
      pending: [a, b],
      searched: 0,
      saturated: 0,
      subdivided: 0,
      truncated: 0,
      stopped: null,
    });
    expect(nextSearch(s)).toBe(a);

    const before = s;
    s = applyResult(s, a, subdivided(a, [a0, a3]));
    // A NEW object: the workflow keeps the previous state for replay.
    expect(s).not.toBe(before);
    expect(before.pending).toEqual([a, b]);
    expect(before.searched).toBe(0);
    // b (depth 0) is still ahead of a's children (depth 1).
    expect(s.pending.map((p) => p.searchId)).toEqual([b, a0, a3].map((p) => p.searchId));
    expect(nextSearch(s)).toBe(b);

    s = applyResult(s, b, subdivided(b, [b1]));
    expect(s.pending.map((p) => p.quadPath)).toEqual(['r0', 'r3', 'r1']);
    expect(nextSearch(s)?.searchId).toBe(a0.searchId);

    s = applyResult(s, a0, done(a0));
    s = applyResult(s, a3, done(a3));
    s = applyResult(s, b1, { kind: 'checked', tileKey: b1.tileKey, changed: true });
    expect(nextSearch(s)).toBeNull();
    expect(s).toMatchObject({
      searched: 5,
      saturated: 2,
      subdivided: 2,
      truncated: 0,
      stopped: null,
    });
  });

  it('a stop ends the queue', () => {
    const a = root('McAllen');
    const b = root('Pharr');
    let s = initialQueue([a, b]);
    s = applyResult(s, a, { kind: 'stopped', tileKey: a.tileKey, reason: 'budget_cap_reached' });
    expect(s.stopped).toBe('budget_cap_reached');
    expect(nextSearch(s)).toBeNull();
    // The stopped search did not complete; nothing is counted as searched.
    expect(s.searched).toBe(0);
    // A later stop does not overwrite the first reason.
    s = applyResult(s, b, { kind: 'stopped', tileKey: b.tileKey, reason: 'google_daily_quota' });
    expect(s.stopped).toBe('budget_cap_reached');
    expect(nextSearch(s)).toBeNull();
  });

  it('a truncated result counts and enqueues nothing', () => {
    const a = root('McAllen');
    const b = root('Pharr');
    let s = initialQueue([a, b]);
    s = applyResult(s, a, {
      kind: 'searched',
      tileKey: a.tileKey,
      resultsCount: 60,
      saturated: true,
      next: { action: 'truncate', why: 'novelty' },
    });
    expect(s).toMatchObject({
      searched: 1,
      saturated: 1,
      subdivided: 0,
      truncated: 1,
      stopped: null,
    });
    expect(s.pending).toEqual([b]);
    expect(nextSearch(s)).toBe(b);
  });

  it('a result for a different tile is refused', () => {
    const a = root('McAllen');
    const b = root('Pharr');
    expect(() => applyResult(initialQueue([a, b]), a, done(b))).toThrow();
  });
});

describe('failures and verdicts', () => {
  it('failReasonOf maps only allow-listed keys', () => {
    expect(failReasonOf(new Error('places_request_rejected'))).toBe('places_request_rejected');
    expect(failReasonOf(new Error('places_unavailable'))).toBe('places_unavailable');
    expect(failReasonOf(new Error('places_key_missing'))).toBe('places_key_missing');

    // Anything else — including a message carrying Places content — collapses and is never echoed.
    const leaked = failReasonOf(new Error('SENTINEL displayName'));
    expect(leaked).toBe('places_unavailable');
    expect(String(leaked)).not.toContain('SENTINEL');
    // A stop reason is not a failure reason.
    expect(failReasonOf(new Error('budget_cap_reached'))).toBe('places_unavailable');
    // Only an Error's message counts; a bare string or object is not trusted.
    expect(failReasonOf('places_key_missing')).toBe('places_unavailable');
    expect(failReasonOf({ message: 'places_key_missing' })).toBe('places_unavailable');
    expect(failReasonOf(undefined)).toBe('places_unavailable');
    expect(failReasonOf(new Error(' places_key_missing'))).toBe('places_unavailable');
  });

  it('failReasonOf reads an Error from another realm', () => {
    // 04-22: the workflow body runs in a VM sandbox and a failed step arrives as an Error built
    // outside it, so `instanceof Error` is false there. Simulated with a second realm.
    const foreign: unknown = runInNewContext('new Error("places_request_rejected")');
    expect(foreign instanceof Error).toBe(false);
    expect(failReasonOf(foreign)).toBe('places_request_rejected');
    expect(failReasonOf(runInNewContext('new TypeError("places_key_missing")'))).toBe(
      'places_key_missing',
    );
    // Still allow-listed and never echoed, and still not a plain object.
    expect(failReasonOf(runInNewContext('new Error("SENTINEL displayName")'))).toBe(
      'places_unavailable',
    );
    expect(failReasonOf(runInNewContext('({ message: "places_key_missing" })'))).toBe(
      'places_unavailable',
    );
  });

  it('finishVerdict: failure beats stop beats complete', () => {
    const a = root('McAllen');
    const clean = applyResult(initialQueue([a]), a, done(a));
    const stopped = applyResult(initialQueue([a]), a, {
      kind: 'stopped',
      tileKey: a.tileKey,
      reason: 'exceeded_estimate',
    });

    expect(finishVerdict(clean, null)).toEqual({ status: 'complete', reason: null });
    expect(finishVerdict(stopped, null)).toEqual({
      status: 'partial',
      reason: 'exceeded_estimate',
    });
    expect(finishVerdict(stopped, 'places_request_rejected')).toEqual({
      status: 'failed',
      reason: 'places_request_rejected',
    });
    expect(finishVerdict(clean, 'places_key_missing')).toEqual({
      status: 'failed',
      reason: 'places_key_missing',
    });
  });
});
