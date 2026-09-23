import 'server-only';
import { sql } from 'drizzle-orm';
import { withWorkerOrg } from '@/db/with-worker-org';
import { foldDiacritics } from '@/lib/normalize';
import {
  placeCandidatesQuery,
  type CandidateProbe,
  type CandidateRow,
} from '@/lib/places/candidates';
import { placesKeyConfigured, searchText } from '@/lib/places/client';
import { hostClass } from '@/lib/places/host-class';
import {
  decide,
  scoreLocated,
  scoreSab,
  toPlaceForMatch,
  type BusinessCandidate,
  type PlaceForMatch,
} from '@/lib/places/match';
import {
  reservePage,
  settleInFlight,
  settleInTx,
  settleOrRelease,
  type PlacesMode,
  type RunCtx,
} from '@/lib/places/meter';
import { toPageRecord, type PageRecordItem } from '@/lib/places/page-record';
import { buildFirstPage, buildNextPage, type PlacesRequest } from '@/lib/places/request';
import {
  dbSafe,
  decideSubdivision,
  isSaturated,
  MAX_PAGES,
  shapeFor,
  type GeoShapesFile,
  type TileSpec,
} from '@/lib/places/tiling';
import { similarityThresholdSql } from '@/lib/resolve/block';
import type { LocationMatchType } from '@/lib/resolve/score';
import { rowsOf, type Tx } from '@/server/queries/budget';
import type { FailReason, PlannedSearch, SearchResult } from '@/workflows/places-sweep/reducer';

/**
 * D-14 step body. Called by the `searchTile` step (04-22) and directly by the DB lane. Returns no
 * byte of the Places response: step returns are retained in the workflow event log for run + 7
 * days (Pro) and sit unencrypted on disk in the local world (04-RESEARCH Pitfall 1a).
 *
 * One Enterprise `(Places type × tile)` search, ≤ 3 pages, in the order 04-RESEARCH Pattern 2
 * mandates for EVERY page:
 *
 *   A. reserve  — `reservePage`: the mode gate, then ONE worker transaction that re-reads the
 *                 run, holds the page's price, bumps the request ceiling and writes the durable
 *                 in-flight cursor (criterion 5, D-15).
 *   B. call     — `searchText`, with NO transaction open (an HTTP call inside a transaction
 *                 would hold a pooled connection and row locks for up to the client's timeout).
 *   C. derive   — in memory: the response is classified (host class, D-09), normalized to
 *                 match keys (`toPlaceForMatch`) and the URL, name, address and phone dropped.
 *   D. persist  — ONE worker transaction: settle the attempt as charged, fetch the page's
 *                 candidates, score and decide in memory, and write the page through the one
 *                 writer (`app.record_places_page`, which also clears the in-flight cursor).
 *
 * A step that dies between A and D leaves the cursor set; `settleInFlight` (step 0) settles that
 * attempt AS CHARGED before anything is called again (Pitfall 9).
 *
 * 🔴 PLACE-02 / T-4-05. The `places` array lives for one loop iteration. Only ids, counts, rects,
 * enums, booleans and numbers leave it: into `toPageRecord` (which refuses text), into the return
 * value, and into the overlap set (place ids). Nothing here logs, and no error message is ever
 * built from a response value — a thrown message lands in the workflow's step_failed event.
 */

export type SweepInput = { runId: string; clerkOrgId: string };

export type TileStepResult =
  | SearchResult
  | {
      kind: 'fail';
      tileKey: string;
      reason: FailReason;
      retryable: boolean;
      retryAfterMs?: number;
    };

/**
 * The folded, lower-cased city a city unit names — the name after U+0000 in the RAW unit id
 * (`'48215\u0000McAllen'` → `'mcallen'`). County and radius units have no city: `null`, which
 * drops the candidate query's SAB city arm entirely (src/lib/places/candidates.ts).
 *
 * Folded in TypeScript because SQL never normalizes (tests/unit/sql-never-normalizes.test.ts);
 * the candidate query compares it to `lower(b.city)`.
 */
export function queriedCityOf(search: TileSpec): string | null {
  if (search.unitKind !== 'city') return null;
  const sep = search.unitId.indexOf('\u0000');
  if (sep < 0) return null;
  const folded = foldDiacritics(search.unitId.slice(sep + 1))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return folded === '' ? null : folded;
}

type Fail = Extract<TileStepResult, { kind: 'fail' }>;
type SearchedNext = Extract<SearchResult, { kind: 'searched' }>['next'];

function fail(
  tileKey: string,
  reason: FailReason,
  retryable: boolean,
  retryAfterMs?: number,
): Fail {
  return retryAfterMs === undefined
    ? { kind: 'fail', tileKey, reason, retryable }
    : { kind: 'fail', tileKey, reason, retryable, retryAfterMs };
}

const LOCATION_MATCH_TYPES: readonly LocationMatchType[] = [
  'overture',
  'census_exact',
  'census_non_exact',
];

function locationMatchTypeOf(v: string | null): LocationMatchType | null {
  return v !== null && (LOCATION_MATCH_TYPES as readonly string[]).includes(v)
    ? (v as LocationMatchType)
    : null;
}

/** A candidate row as the scorer's business side. `score()` never reads `source`. */
function businessOf(r: CandidateRow): BusinessCandidate {
  return {
    id: r.business_id,
    source: 'overture',
    nameNorm: r.name_norm,
    phoneE164: r.phone_e164,
    phoneBlockable: r.phone_blockable,
    streetNum: r.street_num,
    streetNorm: r.street_norm,
    unit: r.unit,
    postal: r.postal,
    lat: r.lat,
    lng: r.lng,
    locationMatchType: locationMatchTypeOf(r.location_match_type),
    clusterKey: r.cluster_key,
    chainKey: null,
    city: r.city,
  };
}

function probeOf(p: PlaceForMatch, idx: number): CandidateProbe {
  return {
    idx,
    nameNorm: p.nameNorm,
    // Only a blockable phone is a blocking key (B1 requires the business side blockable too).
    phone: p.phone.blockable ? p.phone.e164 : null,
    postal: p.address.postal,
    streetNum: p.address.streetNum,
    lat: p.lat,
    lng: p.lng,
    sab: p.pureSab,
  };
}

/** What one page leaves in memory once the response is gone: match keys + derived flags. */
type Derived = {
  pfm: PlaceForMatch;
  hadWebsiteUri: boolean;
  hostClass: ReturnType<typeof hostClass>;
};

/**
 * Step D for one page: settle as charged, match against the page's candidates, record. One
 * transaction, so a page is ledgered exactly when its results are written.
 */
async function persistPage(
  tx: Tx,
  a: {
    searchId: string;
    call: Parameters<typeof settleInTx>[1];
    page: 1 | 2 | 3;
    resultsSoFar: number;
    derived: Derived[];
    queriedCity: string | null;
  },
): Promise<void> {
  await settleInTx(tx, a.call, true);

  // Candidates for the in-area places only; `idx` is the index into `derived`.
  const probes: CandidateProbe[] = [];
  a.derived.forEach((d, idx) => {
    if (!d.pfm.outOfArea) probes.push(probeOf(d.pfm, idx));
  });
  const byIdx = new Map<number, CandidateRow[]>();
  if (probes.length > 0) {
    // The trigram operator's cut-off is this session GUC: set FIRST, same transaction.
    await tx.execute(sql.raw(similarityThresholdSql()));
    const rows = rowsOf<CandidateRow>(
      await tx.execute(placeCandidatesQuery(probes, a.queriedCity)),
    );
    for (const r of rows) {
      const list = byIdx.get(r.idx);
      if (list) list.push(r);
      else byIdx.set(r.idx, [r]);
    }
  }

  const items: PageRecordItem[] = a.derived.map((d, idx) => {
    const scorer = d.pfm.pureSab ? scoreSab : scoreLocated;
    const scored = (byIdx.get(idx) ?? []).map((r) => scorer(d.pfm, businessOf(r), r.name_sim));
    return {
      decision: decide(d.pfm, scored),
      pureSab: d.pfm.pureSab,
      hadWebsiteUri: d.hadWebsiteUri,
      hostClass: d.hostClass,
      lat: d.pfm.lat,
      lng: d.pfm.lng,
    };
  });

  const record = toPageRecord({
    page: a.page,
    sku: a.call.sku === 'ts_essentials' ? 'ts_essentials' : 'ts_enterprise',
    resultsSoFar: a.resultsSoFar,
    items,
  });
  // Clears the in-flight cursor itself (drizzle/0029): no mark_run_search after it.
  await tx.execute(
    sql`select app.record_places_page(${a.searchId}::uuid, ${JSON.stringify(record)}::jsonb)`,
  );
}

/** Share of this search's place ids that its parent tile already held (the novelty floor). */
async function overlapWithParent(
  tx: Tx,
  parentTileKey: string,
  ids: ReadonlySet<string>,
): Promise<number> {
  const parent = rowsOf<{ place_id: string }>(
    await tx.execute(sql`
      select m.place_id
        from place_tile_members m
        join place_tiles t on t.id = m.tile_id
       where t.org_id = (select app.current_org_id())
         and t.tile_key = ${parentTileKey}
         and m.gone_at is null`),
  );
  const held = new Set(parent.map((r) => r.place_id));
  let shared = 0;
  for (const id of ids) if (held.has(id)) shared += 1;
  return shared / Math.max(1, ids.size);
}

/**
 * Plans tile specs as run_searches rows (via app.plan_run_searches, idempotent per run × tile)
 * and returns them with their search ids. Used for a saturated tile's children here, and for a
 * run's roots by 04-22's `beginRun` step — one payload mapping, so the two cannot drift.
 */
export async function planRunSearches(
  tx: Tx,
  runId: string,
  children: TileSpec[],
): Promise<PlannedSearch[]> {
  // Every key DB-safe: jsonb cannot hold U+0000, so unitId goes through dbSafe here and ONLY
  // here — the in-memory child keeps its raw unitId (the partition-hash input, tiling.ts).
  const payload = children.map((c) => ({
    tileKey: c.tileKey,
    cellKey: c.cellKey,
    clusterKey: c.clusterKey,
    unitKind: c.unitKind,
    unitId: dbSafe(c.unitId),
    placesType: c.placesType,
    quadPath: c.quadPath,
    depth: c.depth,
    south: c.rect.south,
    west: c.rect.west,
    north: c.rect.north,
    east: c.rect.east,
    parentTileKey: c.parentTileKey,
    kind: c.kind,
  }));
  const rows = rowsOf<{ search_id: string; tile_key: string }>(
    await tx.execute(
      sql`select search_id, tile_key
            from app.plan_run_searches(${runId}::uuid, ${JSON.stringify(payload)}::jsonb)`,
    ),
  );
  const idOf = new Map(rows.map((r) => [r.tile_key, r.search_id]));
  return children.map((c) => {
    const searchId = idOf.get(c.tileKey);
    if (!searchId) throw new Error('search-tile: a planned child came back without a search id');
    return { ...c, searchId };
  });
}

export async function runSearchTile(
  input: SweepInput,
  search: PlannedSearch,
  deps: { mode: PlacesMode; shapes: GeoShapesFile },
): Promise<TileStepResult> {
  if (search.kind !== 'enterprise') {
    // A programming error (04-19's check-tile owns ids_only searches), never a run outcome.
    throw new Error('runSearchTile: an ids_only search is not an Enterprise search');
  }
  const ctx: RunCtx = { clerkOrgId: input.clerkOrgId, runId: input.runId };
  const actor = `workflow:${input.runId}` as const;
  const tileKey = search.tileKey;
  const queriedCity = queriedCityOf(search);

  // 0. A crashed earlier attempt is settled as charged before anything is called again.
  await settleInFlight(ctx, search.searchId);

  // 1. Page 1's request; pages 2 and 3 are this body plus a token (M49).
  const first = buildFirstPage({
    placesType: search.placesType,
    rect: search.rect,
    mode: 'enterprise',
  });
  let req: PlacesRequest = first;
  let total = 0;
  const ids = new Set<string>();

  // 2. Up to MAX_PAGES pages, each reserve → call → derive → settle + write.
  for (let n = 1; n <= MAX_PAGES; n += 1) {
    const page = n as 1 | 2 | 3;

    // A. Reserve. Every refusal ends the tile; nothing is sent.
    const r = await reservePage(ctx, {
      searchId: search.searchId,
      page,
      sku: req.sku,
      mode: deps.mode,
      keyConfigured: placesKeyConfigured(),
    });
    if (r.kind === 'stop') return { kind: 'stopped', tileKey, reason: r.reason };
    // A run that is no longer running (an operator's kill): finishRun's `status = 'running'`
    // guard then leaves the operator's terminal status untouched.
    if (r.kind === 'not_running') return fail(tileKey, 'places_unavailable', false);
    if (r.kind === 'refused') {
      return r.reason === 'places_key_missing'
        ? fail(tileKey, 'places_key_missing', false)
        : fail(tileKey, 'places_request_rejected', false);
    }

    // B. Call. No transaction is open here.
    const out = await searchText(r.call, req);

    if (!out.ok) {
      const settle = (charged: boolean) =>
        settleOrRelease(ctx, r.call, { charged, searchId: search.searchId });
      switch (out.reason) {
        case 'daily_quota':
          // D-19: the day's quota is spent — the run ends partial, never retried into the wall.
          await settle(false);
          return { kind: 'stopped', tileKey, reason: 'google_daily_quota' };
        case 'rate_limited':
          await settle(false);
          return fail(tileKey, 'places_unavailable', true, out.retryAfterMs);
        case 'unavailable':
          await settle(false);
          return fail(tileKey, 'places_unavailable', true);
        case 'rejected':
          await settle(false);
          return fail(tileKey, 'places_request_rejected', false);
        case 'no_key':
          await settle(false);
          return fail(tileKey, 'places_key_missing', false);
        case 'timeout':
          // Unknown outcome: the request may have reached Google (Pitfall 9).
          await settle(true);
          return fail(tileKey, 'places_unavailable', true);
        case 'bad_shape':
          // A 200 we could not read was still billed; one we could not parse will not parse
          // better on a retry.
          await settle(out.status === 200);
          return fail(tileKey, 'places_unavailable', false);
      }
    }

    // C. Derive, in memory. Past this block only keys, ids, flags and numbers remain.
    total += out.places.length;
    const derived: Derived[] = out.places.map((p) => {
      ids.add(p.id);
      const hc = hostClass(p.websiteUri);
      return {
        pfm: toPlaceForMatch(p, { clusterKey: search.clusterKey, queriedCity }),
        hadWebsiteUri: hc !== 'none',
        hostClass: hc,
      };
    });
    const nextPageToken = out.nextPageToken;

    // D. Settle + match + write, one transaction.
    await withWorkerOrg(input.clerkOrgId, actor, (tx) =>
      persistPage(tx, {
        searchId: search.searchId,
        call: r.call,
        page,
        resultsSoFar: total,
        derived,
        queriedCity,
      }),
    );

    if (!nextPageToken) break;
    req = buildNextPage(first, nextPageToken);
  }

  // 3–5. Saturation, subdivision, and the search's final state — one transaction.
  const saturated = isSaturated(total);
  const shape = shapeFor(search.shape, deps.shapes);
  const next = await withWorkerOrg(input.clerkOrgId, actor, async (tx) => {
    const overlap =
      search.parentTileKey === null ? null : await overlapWithParent(tx, search.parentTileKey, ids);
    const decided = decideSubdivision(
      search,
      { resultsCount: total, overlapWithParent: overlap },
      shape,
    );
    const planned: SearchedNext =
      decided.action === 'subdivide'
        ? {
            action: 'subdivide',
            children: await planRunSearches(tx, input.runId, decided.children),
          }
        : decided;
    const state = {
      status: 'done',
      saturated,
      subdivided: planned.action === 'subdivide',
      truncated: planned.action === 'truncate',
      truncated_why: planned.action === 'truncate' ? planned.why : null,
    };
    await tx.execute(
      sql`select app.mark_run_search(${search.searchId}::uuid, ${JSON.stringify(state)}::jsonb)`,
    );
    return planned;
  });

  // 6. Our ids, counts, rects and enums only.
  return { kind: 'searched', tileKey, resultsCount: total, saturated, next };
}
