import 'server-only';
import { sql } from 'drizzle-orm';
import { withWorkerOrg } from '@/db/with-worker-org';
import { diffTile } from '@/lib/places/change-detect';
import { placesKeyConfigured, searchText } from '@/lib/places/client';
import {
  reservePage,
  settleInFlight,
  settleOrRelease,
  type PlacesMode,
  type RunCtx,
} from '@/lib/places/meter';
import { buildFirstPage, buildNextPage, type PlacesRequest } from '@/lib/places/request';
import type { SweepInput, TileStepResult } from '@/lib/places/search-tile';
import { rowsOf } from '@/server/queries/budget';
import type { FailReason, PlannedSearch } from '@/workflows/places-sweep/reducer';

/**
 * D-16 / PLACE-04 step body: the FREE change check. Called by the `checkTile` step (04-22) and
 * directly by the DB lane. Lists a leaf tile's place ids with the IDs-only mask (Text Search
 * Essentials, `places.id,nextPageToken`), diffs them against the tile's stored members, and has
 * app.record_change_check write the diff. Enterprise spend then scales with churn: only a tile
 * whose id set changed (or now saturates) is a candidate for the next paid sweep.
 *
 * The same builder and the same meter as the paid search (criterion 5 holds for the free SKU
 * too): every page is reserved before it leaves, sent with the mask the ONE builder made, and
 * settled — $0, units 1, a real ledger row — with its in-flight cursor cleared.
 *
 * 🔴 THE MASK IS IDS-ONLY BY CONSTRUCTION. `buildFirstPage` is called with the ids-only mode and
 * nothing else in this file names a mask; a search of any other kind is a programming error and
 * throws before the meter is touched. The meter's own gate refuses a paid SKU in `ids_only`
 * mode as a second wall.
 *
 * 🔴 A PART-WAY LISTING RECORDS NOTHING. If page 2 fails, the ids from page 1 are NOT diffed: a
 * half listing would mark every member on the missing pages `gone`. The step fails or stops,
 * and the retry (or the next night's check) lists the tile again from page 1.
 *
 * Returns no byte of the Places response (04-RESEARCH Pitfall 1a): step returns persist in the
 * workflow event log. Place ids exist here only in memory and in the definer's arguments.
 */

/** The step input and result are 04-18's, declared once in search-tile.ts (deduped by 04-22)
 *  and re-exported so an importer of this module keeps its names. */
export type { SweepInput, TileStepResult };

/** The verdicts that make a tile a candidate for the next paid sweep. */
const CHANGED = new Set(['new', 'gone', 'both', 'saturated']);

function fail(
  tileKey: string,
  reason: FailReason,
  retryable: boolean,
  retryAfterMs?: number,
): TileStepResult {
  return retryAfterMs === undefined
    ? { kind: 'fail', tileKey, reason, retryable }
    : { kind: 'fail', tileKey, reason, retryable, retryAfterMs };
}

export async function runCheckTile(
  input: SweepInput,
  search: PlannedSearch,
  deps: { mode: PlacesMode },
): Promise<TileStepResult> {
  if (search.kind !== 'ids_only') {
    // A tile key is ours and DB-safe; nothing from a Places response is in this message.
    throw new Error(`runCheckTile: ${search.tileKey} is not an ids_only search`);
  }
  const ctx: RunCtx = { clerkOrgId: input.clerkOrgId, runId: input.runId };
  const { tileKey, searchId } = search;

  // 0. A crashed earlier attempt is settled as charged before anything is called again.
  await settleInFlight(ctx, searchId);

  // 0b. B-CR-02 (case 3). A check already recorded `done` is never listed again: a re-executed
  //     step would re-diff against the membership its own first pass just wrote, and overwrite
  //     the recorded verdict with `unchanged`. Its result is rebuilt from the row.
  const prior = (
    await withWorkerOrg(ctx.clerkOrgId, `workflow:${ctx.runId}`, async (tx) =>
      rowsOf<{ status: string; change_verdict: string | null; run_status: string }>(
        await tx.execute(sql`
          select s.status, s.change_verdict, r.status as run_status
            from run_searches s join runs r on r.id = s.run_id
           where s.id = ${searchId}::uuid and s.run_id = ${ctx.runId}::uuid`),
      ),
    )
  )[0];
  if (prior?.status === 'done') {
    if (prior.run_status !== 'running') return fail(tileKey, 'places_unavailable', false);
    return { kind: 'checked', tileKey, changed: CHANGED.has(prior.change_verdict ?? '') };
  }

  const first = buildFirstPage({
    placesType: search.placesType,
    rect: search.rect,
    mode: 'ids_only',
  });
  let req: PlacesRequest = first;
  const ids: string[] = [];
  let pagesServed = 0;

  for (const page of [1, 2, 3] as const) {
    // a. Reserve. Every refusal is a returned value.
    const r = await reservePage(ctx, {
      searchId,
      page,
      sku: req.sku,
      mode: deps.mode,
      keyConfigured: placesKeyConfigured(),
    });
    if (r.kind === 'stop') return { kind: 'stopped', tileKey, reason: r.reason };
    if (r.kind === 'not_running') return fail(tileKey, 'places_unavailable', false);
    if (r.kind === 'refused') {
      return r.reason === 'places_key_missing'
        ? fail(tileKey, 'places_key_missing', false)
        : fail(tileKey, 'places_request_rejected', false);
    }

    // b. The call. No transaction is open here.
    const out = await searchText(r.call, req);

    // c. 04-18's error table, exactly.
    if (!out.ok) {
      switch (out.reason) {
        case 'daily_quota':
          await settleOrRelease(ctx, r.call, { charged: false, searchId });
          return { kind: 'stopped', tileKey, reason: 'google_daily_quota' };
        case 'rate_limited':
          await settleOrRelease(ctx, r.call, { charged: false, searchId });
          return fail(tileKey, 'places_unavailable', true, out.retryAfterMs);
        case 'unavailable':
          await settleOrRelease(ctx, r.call, { charged: false, searchId });
          return fail(tileKey, 'places_unavailable', true);
        case 'rejected':
          await settleOrRelease(ctx, r.call, { charged: false, searchId });
          return fail(tileKey, 'places_request_rejected', false);
        case 'no_key':
          await settleOrRelease(ctx, r.call, { charged: false, searchId });
          return fail(tileKey, 'places_key_missing', false);
        case 'timeout':
          // Unknown outcome: the request may have reached Google (Pitfall 9).
          await settleOrRelease(ctx, r.call, { charged: true, searchId });
          return fail(tileKey, 'places_unavailable', true);
        case 'bad_shape':
          await settleOrRelease(ctx, r.call, { charged: true, searchId });
          return fail(tileKey, 'places_unavailable', false);
      }
    }

    // d. A served page: settled at $0 (units 1) and the cursor cleared, then its ids kept.
    await settleOrRelease(ctx, r.call, { charged: true, searchId });
    for (const p of out.places) ids.push(p.id);
    pagesServed = page;

    // e. The next page is page 1's request plus the token, never a rebuilt body (M49).
    if (!out.nextPageToken) break;
    req = buildNextPage(first, out.nextPageToken);
  }

  // The diff and its record: ONE transaction, after every page arrived.
  const verdict = await withWorkerOrg(ctx.clerkOrgId, `workflow:${ctx.runId}`, async (tx) => {
    const tile = rowsOf<{
      id: string;
      last_checked_at: string | null;
      last_swept_run_id: string | null;
    }>(
      await tx.execute(sql`
        select t.id, t.last_checked_at, t.last_swept_run_id
          from place_tiles t join run_searches s on s.tile_id = t.id
         where s.id = ${searchId}::uuid`),
    )[0];
    if (!tile) throw new Error(`runCheckTile: the tile for ${tileKey} is not visible to this org`);

    const members = rowsOf<{ place_id: string }>(
      await tx.execute(sql`
        select place_id from place_tile_members
         where tile_id = ${tile.id}::uuid and gone_at is null`),
    ).map((m) => m.place_id);

    const hasBaseline =
      tile.last_checked_at !== null || tile.last_swept_run_id !== null || members.length > 0;
    const d = diffTile(new Set(members), ids, { hasBaseline, pagesServed });

    await tx.execute(sql`
      select app.record_change_check(${searchId}::uuid, ${JSON.stringify(d.added)}::jsonb,
                                     ${JSON.stringify(d.gone)}::jsonb, ${d.verdict}, ${ids.length}::int)`);
    const state = JSON.stringify({ status: 'done', saturated: d.verdict === 'saturated' });
    await tx.execute(sql`select app.mark_run_search(${searchId}::uuid, ${state}::jsonb)`);
    return d.verdict;
  });

  return { kind: 'checked', tileKey, changed: CHANGED.has(verdict) };
}
