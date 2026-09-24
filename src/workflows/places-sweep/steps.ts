import 'server-only';
import { sql } from 'drizzle-orm';
import { FatalError, RetryableError } from 'workflow';
import { withWorkerOrg } from '@/db/with-worker-org';
import { env } from '@/env';
import { runCheckTile } from '@/lib/places/check-tile';
import { settleInFlight } from '@/lib/places/meter';
import { planRootSearches, type RunKind } from '@/lib/places/plan-run';
import {
  planRunSearches,
  runSearchTile,
  type SweepInput,
  type TileStepResult,
} from '@/lib/places/search-tile';
import { tileKeyOf, type GeoShapesFile, type TileSpec } from '@/lib/places/tiling';
import { rowsOf, type Tx } from '@/server/queries/budget';
import {
  getSeedTables,
  readReferenceIndex,
  resolveSpec,
  specInputOfVersion,
} from '@/server/queries/preset-spec';
import type { FailReason, PlannedSearch, SearchResult, StopReason } from './reducer';
import { isDeterministicFault, stepError } from './step-errors';
import { fromWire, toWire } from './wire';
import type { SweepOutcome } from './workflow';

/**
 * D-14. The places-sweep workflow's four steps — every side effect of a sweep lives here.
 *
 *   beginRun   — claim the run (queued → running), release the admission hold, plan the roots.
 *   searchTile — one Enterprise (Places type × tile) search, ≤ 3 pages (04-18 runSearchTile).
 *   checkTile  — one free IDs-only listing of a leaf tile (04-19 runCheckTile).
 *   finishRun  — settle leftovers, close the run from the ledger, emit one run-level event.
 *
 * 🔴 T-4-05 / Pitfall 1a. Every argument and return below is persisted in the workflow event log
 * (run + 7 days on Pro; unencrypted on disk in the local world). They carry our ids, tile keys,
 * rects, counts and enums ONLY. No error thrown from here echoes a message it did not write:
 * a failure becomes an allow-listed reason key, and anything unexpected is reduced to its
 * SQLSTATE or error name (`stepError`), because a database error can quote a parameter and some
 * parameters are derived from a Places response.
 *
 * 🔴 NO U+0000 CROSSES A STEP BOUNDARY. Searches leave a step through `toWire` and enter one
 * through `fromWire` (./wire.ts) — the raw unit id exists only inside a step.
 *
 * 🔴 T-4-06. Every transaction is `withWorkerOrg(input.clerkOrgId, 'workflow:<runId>')`: the
 * org comes from the start input (a server action, 04-26), RLS and the column grants stand in
 * front of every statement, and a run the org cannot see is never executed.
 *
 * 🔴 M33 / D-19. A budget stop (cap, request ceiling, Google's daily quota) is a RETURNED value
 * the reducer turns into `partial` — never thrown, so never retried. Only a retryable failure
 * (per-minute 429, 5xx, timeout) is a RetryableError, and every step's retries are bounded.
 *
 * The postgres pool is ONE connection per process (src/db/client.ts), so no helper here opens a
 * worker transaction while another is open — the meter's own transactions run between ours.
 */

/** A retryable Places failure with no Retry-After of its own waits this long. */
const DEFAULT_RETRY_AFTER_MS = 2_000;

type Fail = Extract<TileStepResult, { kind: 'fail' }>;

export type BeginResult =
  | { kind: 'not_runnable'; reason: 'never_started' | null }
  | { kind: 'runnable'; runKind: RunKind; searches: PlannedSearch[] };

export type FinishVerdict = {
  status: 'complete' | 'partial' | 'failed';
  reason: StopReason | FailReason | null;
};

const RUN_KINDS: readonly RunKind[] = ['full_sweep', 'partition', 'change_check'];

function actorOf(input: SweepInput): `workflow:${string}` {
  return `workflow:${input.runId}`;
}

/** The 0.8 MB TIGERweb seed, loaded inside a step and never in the workflow body. The module
 *  cache holds it once per process. */
async function loadShapes(): Promise<GeoShapesFile> {
  return (await import('@/seed/data/geo-shapes.json')).default as GeoShapesFile;
}

/**
 * Runs a step body and translates what it throws. The workflow's own error classes pass through;
 * the meter's M46 refusal (the run is not visible to this org) is fatal — retrying it into the
 * same org cannot help. A DETERMINISTIC fault (a SQLSTATE of class 22/23/42 read through
 * drizzle's `.cause`, or a `toPageRecord` refusal — ./step-errors.ts) is fatal too: it would
 * refuse the same way on every retry, and each retry would re-buy the page it follows (B-CR-02).
 * Everything else is sanitised to its SQLSTATE or name and left retryable (the default 3).
 */
async function guarded<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (FatalError.is(e) || RetryableError.is(e)) throw e;
    if (e instanceof Error && e.name === 'WorkerOrgMismatch') {
      throw new FatalError('places_request_rejected');
    }
    const safe = stepError(e);
    if (isDeterministicFault(e)) throw new FatalError(safe.message);
    throw safe;
  }
}

/** A tile step's `fail` → the workflow's error classes. The message is the reason key only. */
function throwFail(r: Fail): never {
  if (r.retryable) {
    throw new RetryableError(r.reason, { retryAfter: r.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS });
  }
  throw new FatalError(r.reason);
}

/** A tile step's result as it leaves the step: subdivided children in wire form. */
function resultToWire(r: TileStepResult): SearchResult {
  if (r.kind === 'fail') throwFail(r);
  if (r.kind === 'searched' && r.next.action === 'subdivide') {
    return { ...r, next: { action: 'subdivide', children: r.next.children.map(toWire) } };
  }
  return r;
}

/**
 * Closes a running run: terminal status, stopped reason, finished_at, and the cost read from the
 * ledger — only while `status = 'running'` (T-4-03: an operator's terminal status is never
 * overwritten) — and one `places_run_finished` event. Returns false when the guard matched
 * nothing, and then emits nothing, so a replay cannot write a second event.
 */
async function closeRun(
  tx: Tx,
  runId: string,
  status: 'complete' | 'partial' | 'failed',
  reason: string | null,
): Promise<boolean> {
  const closed = rowsOf<{ calls_count: number }>(
    await tx.execute(sql`
      update runs r
         set status = ${status},
             stopped_reason = ${reason},
             finished_at = now(),
             heartbeat_at = now(),
             cost_micro_usd = (select coalesce(sum(l.micro_usd), 0)
                                 from cost_ledger l
                                where l.run_id = r.id)
       where r.id = ${runId}::uuid
         and r.status = 'running'
      returning r.calls_count`),
  );
  const row = closed[0];
  if (!row) return false;
  // app.emit_event(entity_type, entity_id, action, after) — drizzle/0011's parameter order.
  await tx.execute(sql`
    select app.emit_event('runs', ${runId}::uuid, 'places_run_finished',
                          jsonb_build_object('status', ${status}::text,
                                             'reason', ${reason}::text,
                                             'calls', ${row.calls_count}::int))`);
  return true;
}

/**
 * D-16, change checks: each root is replaced by the leaves already stored under it (the tree the
 * last sweep drew), as `ids_only` specs carrying the root's shape — the shallowest leaf on each
 * path only (B-WR-04). A root with no stored leaf stays itself.
 */
async function storedLeaves(tx: Tx, roots: TileSpec[]): Promise<TileSpec[]> {
  const out: TileSpec[] = [];
  for (const root of roots) {
    const rows = rowsOf<{
      quad_path: string;
      depth: number;
      south: number;
      west: number;
      north: number;
      east: number;
    }>(
      await tx.execute(sql`
        select quad_path, depth, south, west, north, east
          from place_tiles
         where org_id = (select app.current_org_id())
           and starts_with(tile_key, ${root.tileKey})
           and is_leaf
         order by quad_path`),
    );
    const shaped = rows.filter((r) => /^r[0-3]*$/.test(r.quad_path));
    // B-WR-04: only the SHALLOWEST leaf on each path. `mark_run_search` sets `is_leaf` on the one
    // tile it closes, so a root that stopped saturating becomes a leaf while its old descendants
    // keep `is_leaf` from the sweep that split it (0030 retires them only when that root next
    // closes). Listing both would search overlapping rectangles and diff stale memberships.
    const paths = new Set(shaped.map((r) => r.quad_path));
    const leaves = shaped.filter((r) => {
      for (let n = 1; n < r.quad_path.length; n += 1) {
        if (paths.has(r.quad_path.slice(0, n))) return false;
      }
      return true;
    });
    if (leaves.length === 0) {
      out.push(root);
      continue;
    }
    for (const leaf of leaves) {
      out.push({
        ...root,
        tileKey: tileKeyOf(root.unitKind, root.unitId, root.placesType, leaf.quad_path),
        quadPath: leaf.quad_path,
        depth: leaf.quad_path.length - 1,
        rect: {
          south: Number(leaf.south),
          west: Number(leaf.west),
          north: Number(leaf.north),
          east: Number(leaf.east),
        },
        parentTileKey:
          leaf.quad_path.length > 1
            ? tileKeyOf(root.unitKind, root.unitId, root.placesType, leaf.quad_path.slice(0, -1))
            : null,
        kind: 'ids_only',
      });
    }
  }
  return out;
}

/**
 * Step 1. One transaction: read the run under RLS (zero rows → fatal: a run this org cannot see
 * is never executed), claim it, release the admission hold, plan the roots with the planner
 * admission used, and record them.
 */
export async function beginRun(input: SweepInput): Promise<BeginResult> {
  'use step';
  const shapes = await loadShapes();
  return guarded(() =>
    withWorkerOrg(input.clerkOrgId, actorOf(input), async (tx): Promise<BeginResult> => {
      const run = rowsOf<{
        status: string;
        kind: string;
        created_ms: string;
        cluster_ids: string[];
        geo_kind: string;
        geo_payload: unknown;
        display_name: string;
      }>(
        await tx.execute(sql`
          select r.status, r.kind,
                 (extract(epoch from r.created_at) * 1000)::bigint::text as created_ms,
                 v.cluster_ids, v.geo_kind, v.geo_payload, s.display_name
            from runs r
            join search_versions v on v.id = r.search_version_id
            join searches s on s.id = v.search_id
           where r.id = ${input.runId}::uuid`),
      )[0];
      if (!run) throw new FatalError('places_request_rejected');

      if (run.status === 'queued') {
        await tx.execute(sql`
          update runs set status = 'running', started_at = now(), heartbeat_at = now()
           where id = ${input.runId}::uuid and status = 'queued'`);
      } else if (run.status !== 'running') {
        // Already terminal (an operator's kill, a finished run started twice): nothing to do.
        return { kind: 'not_runnable', reason: null };
      }

      // D-15 / M53. The queue-time hold is RELEASED, never settled: settling would write a
      // phantom Enterprise ledger row into the free allowance. A hold a page attempt still
      // points at is not the admission hold, and is left to that search's settleInFlight.
      const holds = rowsOf<{ id: string }>(
        await tx.execute(sql`
          select c.id from cost_reservations c
           where c.run_id = ${input.runId}::uuid
             and c.settled_at is null and c.released_at is null
             and not exists (select 1 from run_searches s
                              where s.run_id = c.run_id and s.inflight_reservation_id = c.id)`),
      );
      for (const h of holds) {
        await tx.execute(sql`select app.release_reservation(${h.id}::uuid)`);
      }

      // The spec, built exactly as queueRun priced it (D-16).
      const runKind = RUN_KINDS.find((k) => k === run.kind);
      const index = await readReferenceIndex(tx);
      const specInput = specInputOfVersion(run.cluster_ids, run.geo_kind, run.geo_payload, index);
      const resolved = specInput ? resolveSpec(specInput, index, run.display_name) : null;
      let roots: TileSpec[] | null = null;
      if (runKind && resolved?.ok) {
        try {
          // The run's own creation instant: a partition keeps the week it was queued in.
          roots = planRootSearches({
            spec: resolved.spec,
            seed: getSeedTables(),
            shapes,
            kind: runKind,
            now: new Date(Number(run.created_ms)),
          });
        } catch {
          roots = null;
        }
      }
      if (!runKind || !roots) {
        // Unplannable (a reference row gone, a unit with no outline): nothing was sent and the
        // hold is released, so the run ends as never started rather than holding the org's one
        // active slot forever.
        await closeRun(tx, input.runId, 'failed', 'never_started');
        return { kind: 'not_runnable', reason: 'never_started' };
      }

      const specs = runKind === 'change_check' ? await storedLeaves(tx, roots) : roots;
      const searches = await planRunSearches(tx, input.runId, specs);
      return { kind: 'runnable', runKind, searches: searches.map(toWire) };
    }),
  );
}

/** Step 2a. One Enterprise (Places type × tile) search. */
export async function searchTile(input: SweepInput, search: PlannedSearch): Promise<SearchResult> {
  'use step';
  const shapes = await loadShapes();
  const r = await guarded(() =>
    runSearchTile(input, fromWire(search), { mode: env.PLACES_MODE, shapes }),
  );
  return resultToWire(r);
}
searchTile.maxRetries = 3;

/** Step 2b. One free IDs-only listing of a leaf tile (change check, D-16). */
export async function checkTile(input: SweepInput, search: PlannedSearch): Promise<SearchResult> {
  'use step';
  const r = await guarded(() => runCheckTile(input, fromWire(search), { mode: env.PLACES_MODE }));
  return resultToWire(r);
}
checkTile.maxRetries = 3;

/**
 * Step 3. Settle any in-flight attempt a crashed step left behind (as charged — the pessimistic
 * direction, Pitfall 9), then close the run from the ledger while it is still running. When the
 * guard matched nothing (an operator already ended it), the row's own terminal status is
 * reported instead.
 */
export async function finishRun(input: SweepInput, v: FinishVerdict): Promise<SweepOutcome> {
  'use step';
  return guarded(async () => {
    const leftovers = await withWorkerOrg(input.clerkOrgId, actorOf(input), async (tx) =>
      rowsOf<{ id: string }>(
        await tx.execute(sql`
          select id from run_searches
           where run_id = ${input.runId}::uuid
             and (inflight_reservation_id is not null or inflight_request_id is not null)`),
      ),
    );
    for (const s of leftovers) {
      await settleInFlight({ clerkOrgId: input.clerkOrgId, runId: input.runId }, s.id);
    }

    return withWorkerOrg(input.clerkOrgId, actorOf(input), async (tx): Promise<SweepOutcome> => {
      if (await closeRun(tx, input.runId, v.status, v.reason)) {
        return { status: v.status, reason: v.reason };
      }
      const row = rowsOf<{ status: string; stopped_reason: string | null }>(
        await tx.execute(
          sql`select status, stopped_reason from runs where id = ${input.runId}::uuid`,
        ),
      )[0];
      if (!row) throw new FatalError('places_request_rejected');
      const status =
        row.status === 'complete' || row.status === 'partial' || row.status === 'failed'
          ? row.status
          : 'not_runnable';
      return { status, reason: row.stopped_reason };
    });
  });
}
