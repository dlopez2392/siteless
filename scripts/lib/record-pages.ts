import 'server-only';
import { readFileSync } from 'node:fs';
import { resolveEtlOrg, type EtlExecutor } from '@/lib/ingest/etl-actor';
import { placesKeyConfigured, searchText, type SearchTextFailure } from '@/lib/places/client';
import {
  reservePage,
  settleInFlight,
  settleOrRelease,
  type ModeRefusal,
  type PlacesMode,
  type RunCtx,
} from '@/lib/places/meter';
import { buildFirstPage, buildNextPage, type PlacesRequest } from '@/lib/places/request';
import { dbSafe, quadrants, tileKeyOf, type GeoShapesFile, type Rect } from '@/lib/places/tiling';
import type { ClustersFile } from '@/seed/types';
import { anonymizePage, type AnonymizeContext } from './anonymize-places';

/**
 * The D-04 recorder's database and Places legs (scripts/record-places-fixtures.ts), split out so
 * the DB lane can drive them against msw with the worker double (tests/db/places-recorder.test.ts).
 *
 * 🔴 THE SAME TWO PRIMITIVES THE PRODUCT USES (criterion 5 holds for recordings): every page is
 * `reservePage` → `searchText` → `settleOrRelease`, through the real meter, against a real `runs`
 * row whose `ceiling_requests` IS the recorder's cap — so the meter refuses the request after the
 * cap even if this loop regressed. A recording is ledgered like any other request.
 *
 * 🔴 THE PAYLOAD LIVES ONE ITERATION. The parsed page is handed straight to `anonymizePage`; only
 * its anonymized twin is kept. Nothing here logs, returns or throws a byte of it.
 *
 * This module imports `server-only` modules (the meter, the client, src/env.ts through the DB
 * client): the desk script loads it by dynamic import AFTER `.env.local` is loaded and after
 * every guard has passed, under `node --conditions=react-server`.
 */

const GEO_SHAPES = new URL('../../src/seed/data/geo-shapes.json', import.meta.url);
const CLUSTERS = new URL('../../src/seed/data/clusters.json', import.meta.url);

/** The actor every recorder write is attributed to (no Clerk subject, like the ETL). */
const ACTOR = 'etl:record-places';

export type RecordingRun = {
  clerkOrgId: string;
  orgId: string;
  runId: string;
  searchId: string;
  tileKey: string;
  rect: Rect;
  clusterKey: string;
  /** The unit as a person reads it — the anonymizer's synthetic city. */
  unitName: string;
  idsOnly: boolean;
};

type OpenArgs = {
  versionId: string;
  placesType: string;
  /** `<unitKind>:<unitId, DB-safe>`. */
  unit: string;
  quad?: string;
  idsOnly: boolean;
  maxRequests: number;
};

async function claim(c: EtlExecutor, clerkOrgId: string): Promise<string> {
  await c.query("select set_config('app.actor_id', $1, true)", [ACTOR]);
  return resolveEtlOrg(c, clerkOrgId);
}

/** The unit's rectangle at `quad` (`r`, `r0`, `r21`, …), from the committed geo seed. */
function rectFor(
  unit: string,
  quad: string,
): { rect: Rect; name: string; unitKind: 'city' | 'county'; unitId: string } {
  const colon = unit.indexOf(':');
  const kind = unit.slice(0, colon);
  const idSafe = unit.slice(colon + 1);
  const shapes = JSON.parse(readFileSync(GEO_SHAPES, 'utf8')) as GeoShapesFile;
  const found = shapes.units.find((u) => u.unitKind === kind && dbSafe(u.unitId) === idSafe);
  if (!found || found.rings.length === 0) {
    throw new Error(`record-places: no committed geo shape for ${kind}:${idSafe}`);
  }
  let rect = found.bbox;
  for (const digit of quad.slice(1)) rect = quadrants(rect)[Number(digit)] as Rect;
  return { rect, name: found.name, unitKind: found.unitKind, unitId: found.unitId };
}

/**
 * As the OWNER, inside the caller's transaction: the org named by the version (never "the only
 * org" — T-3-01), a `running` run capped at `maxRequests`, and the one search planned through
 * `app.plan_run_searches`. `--ids-only` is a `change_check` run with an `ids_only` search; a
 * recording is a `full_sweep` run with an enterprise search.
 */
export async function openRecordingRun(c: EtlExecutor, a: OpenArgs): Promise<RecordingRun> {
  const v = (
    await c.query<{ clerk_org_id: string; cluster_ids: string[] }>(
      `select o.clerk_org_id, v.cluster_ids::text[] as cluster_ids
         from search_versions v join orgs o on o.id = v.org_id
        where v.id = $1::uuid`,
      [a.versionId],
    )
  ).rows[0];
  if (!v) throw new Error('record-places: no search version with that id in the local database');
  const orgId = await claim(c, v.clerk_org_id);

  // The cluster: the ONE seeded cluster that lists this type, and it must be the version's.
  const seed = JSON.parse(readFileSync(CLUSTERS, 'utf8')) as ClustersFile;
  const listing = seed.clusters.filter((cl) => cl.placesTypes.includes(a.placesType));
  if (listing.length !== 1) {
    throw new Error(
      `record-places: ${a.placesType} is listed by ${listing.length} seeded clusters (need 1)`,
    );
  }
  const clusterKey = listing[0]!.key;
  const versionKeys = (
    await c.query<{ key: string }>('select key from industry_clusters where id = any($1::uuid[])', [
      v.cluster_ids,
    ])
  ).rows.map((r) => r.key);
  if (!versionKeys.includes(clusterKey)) {
    throw new Error(`record-places: the version does not cover the ${clusterKey} cluster`);
  }

  const quad = a.quad ?? 'r';
  const unit = rectFor(a.unit, quad);
  const tileKey = tileKeyOf(unit.unitKind, unit.unitId, a.placesType, quad);
  const parentKey =
    quad.length > 1 ? tileKeyOf(unit.unitKind, unit.unitId, a.placesType, quad.slice(0, -1)) : null;

  const run = (
    await c.query<{ id: string }>(
      `insert into runs (org_id, search_version_id, status, kind, ceiling_requests, started_at)
       values ($1, $2, 'running', $3, $4, now()) returning id`,
      [orgId, a.versionId, a.idsOnly ? 'change_check' : 'full_sweep', a.maxRequests],
    )
  ).rows[0];
  if (!run) throw new Error('record-places: the run insert returned no row');

  const element = {
    tileKey,
    cellKey: dbSafe(`${clusterKey}\u0000${unit.unitId}`),
    clusterKey,
    unitKind: unit.unitKind,
    unitId: dbSafe(unit.unitId),
    placesType: a.placesType,
    quadPath: quad,
    depth: quad.length - 1,
    south: unit.rect.south,
    west: unit.rect.west,
    north: unit.rect.north,
    east: unit.rect.east,
    parentTileKey: parentKey,
    kind: a.idsOnly ? 'ids_only' : 'enterprise',
  };
  const planned = (
    await c.query<{ search_id: string }>(
      'select search_id from app.plan_run_searches($1::uuid, $2::jsonb)',
      [run.id, JSON.stringify([element])],
    )
  ).rows[0];
  if (!planned) throw new Error('record-places: plan_run_searches returned no search');

  return {
    clerkOrgId: v.clerk_org_id,
    orgId,
    runId: run.id,
    searchId: planned.search_id,
    tileKey,
    rect: unit.rect,
    clusterKey,
    unitName: unit.name,
    idsOnly: a.idsOnly,
  };
}

export type RecordOutcome =
  | 'ok'
  | SearchTextFailure
  | ModeRefusal
  | 'budget_cap_reached'
  | 'exceeded_estimate'
  | 'not_running';

export type RecordResult = {
  outcome: RecordOutcome;
  /** HTTP status of a failed response (null for a transport failure or a refusal). */
  status: number | null;
  /** Requests that LEFT (a refused reservation is not a request). */
  requests: number;
  /** Anonymized pages, in order. Never the raw payload. */
  pages: Record<string, unknown>[];
  idsSeen: number;
  /** The cap stopped paging while Google still offered a next page. */
  truncatedByCap: boolean;
};

/** One search, ≤ 3 pages, ≤ `maxRequests` requests, each reserved → sent → settled. */
export async function recordPages(
  ctx: RunCtx,
  a: {
    searchId: string;
    first: PlacesRequest;
    mode: PlacesMode;
    maxRequests: number;
    anonymize: Omit<AnonymizeContext, 'page'>;
  },
): Promise<RecordResult> {
  const pages: Record<string, unknown>[] = [];
  let requests = 0;
  let idsSeen = 0;
  const done = (outcome: RecordOutcome, status: number | null, truncatedByCap = false) => ({
    outcome,
    status,
    requests,
    pages,
    idsSeen,
    truncatedByCap,
  });

  let req = a.first;
  for (const page of [1, 2, 3] as const) {
    if (requests >= a.maxRequests) return done('ok', null, true);

    const r = await reservePage(ctx, {
      searchId: a.searchId,
      page,
      sku: req.sku,
      mode: a.mode,
      keyConfigured: placesKeyConfigured(),
    });
    if (r.kind === 'stop') return done(r.reason, null);
    if (r.kind === 'refused') return done(r.reason, null);
    if (r.kind === 'not_running') return done('not_running', null);

    requests += 1;
    const out = await searchText(r.call, req);
    if (!out.ok) {
      // 04-16's charging rule: an unknown outcome is charged; a known error is released.
      const charged =
        out.reason === 'timeout' || (out.reason === 'bad_shape' && out.status === 200);
      await settleOrRelease(ctx, r.call, { charged, searchId: a.searchId });
      return done(out.reason, out.status);
    }
    await settleOrRelease(ctx, r.call, { charged: true, searchId: a.searchId });

    idsSeen += out.places.length;
    // The parsed page goes straight into the anonymizer; only its twin is kept.
    pages.push(
      anonymizePage(
        out.nextPageToken
          ? { places: out.places, nextPageToken: out.nextPageToken }
          : { places: out.places },
        { ...a.anonymize, page },
      ),
    );

    if (!out.nextPageToken) break;
    req = buildNextPage(a.first, out.nextPageToken);
  }
  return done('ok', null);
}

/** The first request for a recording run: the product's one builder, at the run's mask. */
export function firstRequest(run: RecordingRun, placesType: string): PlacesRequest {
  return buildFirstPage({
    placesType,
    rect: run.rect,
    mode: run.idsOnly ? 'ids_only' : 'enterprise',
  });
}

const STOPS = new Set<RecordOutcome>(['budget_cap_reached', 'exceeded_estimate', 'daily_quota']);

/**
 * As the owner, inside the caller's transaction: the run ends `complete` (ok), `partial` (a
 * budget or quota stop) or `failed`, and the search is marked `stopped` — never `done`, because
 * a recording writes no membership and must not claim the tile was swept or checked.
 *
 * 🔴 A-WR-12. FIRST, whatever attempt the search still has in flight is settled AS CHARGED
 * (`settleInFlight`, the product's own replay rule). `recordPages` can throw after `reservePage`
 * but before `settleOrRelease` — a database error inside the settle, or the anonymizer throwing
 * after a settled page — and the request may already have left and been billed. The cursor is
 * the only record of it; `settleInFlight` ledgers it under the attempt's own request id and
 * clears it in the same transaction, and a no-op when nothing is in flight. If that settle
 * itself fails, this throws BEFORE the cursor is touched, so the record survives for the next
 * admission's abandoned-run reclaim (queue-run.ts, A-WR-09) to settle. The cursor is therefore
 * never cleared here: the payload below names status only.
 */
export async function closeRecordingRun(
  c: EtlExecutor,
  run: RecordingRun,
  outcome: RecordOutcome | 'crashed',
): Promise<void> {
  await settleInFlight({ clerkOrgId: run.clerkOrgId, runId: run.runId }, run.searchId);
  await claim(c, run.clerkOrgId);
  await c.query('select app.mark_run_search($1::uuid, $2::jsonb)', [
    run.searchId,
    JSON.stringify({ status: 'stopped' }),
  ]);
  const status =
    outcome === 'ok'
      ? 'complete'
      : outcome !== 'crashed' && STOPS.has(outcome)
        ? 'partial'
        : 'failed';
  await c.query(
    `update runs set status = $2, stopped_reason = $3, finished_at = now()
      where id = $1::uuid and status = 'running'`,
    [run.runId, status, outcome === 'ok' ? null : outcome],
  );
}

/** What the run cost, from the ledger (owner read). */
export async function ledgerOfRun(
  c: EtlExecutor,
  runId: string,
): Promise<{ rows: number; microUsd: number; skus: string[] }> {
  const r = (
    await c.query<{ n: number; micro: string; skus: string[] }>(
      `select count(*)::int as n, coalesce(sum(micro_usd), 0)::text as micro,
              coalesce(array_agg(distinct sku), '{}') as skus
         from cost_ledger where run_id = $1::uuid`,
      [runId],
    )
  ).rows[0];
  return { rows: r?.n ?? 0, microUsd: Number(r?.micro ?? 0), skus: r?.skus ?? [] };
}

/** The meter's pool (src/db/client.ts) — ended so the desk process can exit. */
export async function closeMeterPool(): Promise<void> {
  const { db } = await import('@/db/client');
  await db.$client.end({ timeout: 5 });
}
