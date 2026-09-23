import type { Client } from 'pg';
import { CLAIMS_A, CLAIMS_B, seedOvertureSide } from './_merge-fixtures';

/**
 * Places fixtures (plan 04-09), shared by every Phase 4 DB and workflow test.
 *
 * 🔴 `PLACES_SPINE` IS A PRODUCER→CONSUMER CONTRACT. 04-10's msw match fixtures
 * (`tests/unit/msw/fixtures/places-match-*.json`) carry EXACTLY these names, phones, streets
 * and ZIPs, so a Places page replayed against a spine seeded from here matches the way the
 * real thing would. Change a value here and the matching tests downstream quietly stop
 * matching — change both files in one commit, or neither.
 *
 *   * `rio` and `rioCo` SHARE a phone on purpose: the tie case (two businesses ≥95 for one
 *     place → both tentative, `reason = 'tie'`).
 *   * Every business is seeded through the SHIPPED Overture ingest path (`seedOvertureSide`),
 *     so each carries a real external key, a durable source record and provenance ids.
 *   * `basicCategory: 'home_service'` — a built-in `overture_category_map` row (org_id IS NULL)
 *     mapping to the `home_services` cluster, so every spine business is in the cluster a
 *     default `seedPlacesRun` queries.
 *
 * 🔴 SEED AS THE OWNER, BEFORE `actAs`. Seven Places tables are SELECT-only for
 * `authenticated` and `place_coordinates` grants it nothing (drizzle/0027); in production
 * every write is a SECURITY DEFINER. Tens of rows, never thousands.
 */
// Kept one row per business, column-aligned, so a diff against 04-10's fixtures reads at a glance.
// prettier-ignore
export const PLACES_SPINE = {
  ortiz:   { name: 'Ortiz Plumbing',   street: '1200 N 10th St',        zip: '78501', city: 'McAllen', lat: 26.2159, lng: -98.2336, phone: '+19566310001' },
  garza:   { name: 'Garza Electric',   street: '4100 N 23rd St',        zip: '78504', city: 'McAllen', lat: 26.2489, lng: -98.2388, phone: '+19566310002' },
  rio:     { name: 'Rio Roofing',      street: '900 S Main St',         zip: '78501', city: 'McAllen', lat: 26.1960, lng: -98.2300, phone: '+19566310003' },
  rioCo:   { name: 'Rio Roofing Co',   street: '2200 W Nolana Ave',     zip: '78504', city: 'McAllen', lat: 26.2400, lng: -98.2450, phone: '+19566310003' },
  valley:  { name: 'Valley Locksmith', street: '500 E Expressway 83',   zip: '78503', city: 'McAllen', lat: 26.1900, lng: -98.2200, phone: '+19566310004' },
} as const;

export type SpineKey = keyof typeof PLACES_SPINE;

/** The built-in Overture category every spine business carries; maps to `home_services`. */
export const SPINE_BASIC_CATEGORY = 'home_service';

export { CLAIMS_A, CLAIMS_B };

/** Seeds the five spine businesses into `orgId`; returns their business ids by key. */
export async function seedPlacesSpine(c: Client, orgId: string): Promise<Record<SpineKey, string>> {
  const out = {} as Record<SpineKey, string>;
  for (const key of Object.keys(PLACES_SPINE) as SpineKey[]) {
    const s = PLACES_SPINE[key];
    const side = await seedOvertureSide(c, orgId, {
      name: s.name,
      street: s.street,
      zip: s.zip,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
      phone: s.phone,
      basicCategory: SPINE_BASIC_CATEGORY,
    });
    out[key] = side.businessId;
  }
  return out;
}

export interface SeededPlacesRun {
  searchId: string;
  versionId: string;
  runId: string;
  clusterId: string;
  cityId: string;
}

/**
 * A search + version (default: McAllen × home_services, `geo_kind = 'cities'`) and one `runs`
 * row, all as the owner.
 *
 * `status` defaults to `'running'` — the state every Phase 4 definer requires. 🔴 Two
 * `queued`/`running` runs in ONE org are refused by `runs_one_active_per_org` (23505), so a
 * test that needs a second run in the same org passes `status: 'complete'` for the older one.
 * `ceilingRequests` defaults to 0 (the legacy value: every reservation refused).
 */
export async function seedPlacesRun(
  c: Client,
  orgId: string,
  opts: {
    kind?: 'full_sweep' | 'partition' | 'change_check';
    status?: 'queued' | 'running' | 'complete' | 'partial' | 'refused' | 'failed';
    ceilingRequests?: number;
    /** A built-in industry_clusters key. */
    clusterKey?: string;
    /** A built-in city name (case-insensitive). */
    unit?: string;
    partitionIndex?: number | null;
  } = {},
): Promise<SeededPlacesRun> {
  const clusterKey = opts.clusterKey ?? 'home_services';
  const unit = opts.unit ?? 'McAllen';
  const cl = await c.query<{ id: string }>(
    'select id from industry_clusters where org_id is null and key = $1',
    [clusterKey],
  );
  const clusterId = cl.rows[0]?.id;
  if (!clusterId) throw new Error('seedPlacesRun: no built-in cluster ' + clusterKey);
  const ci = await c.query<{ id: string }>(
    'select id from cities where org_id is null and lower(name) = lower($1) order by id limit 1',
    [unit],
  );
  const cityId = ci.rows[0]?.id;
  if (!cityId) throw new Error('seedPlacesRun: no built-in city ' + unit);

  const s = await c.query<{ id: string }>(
    'insert into searches (org_id, name_internal, display_name) values ($1, $2, $3) returning id',
    [orgId, `${unit} × ${clusterKey} — places fixture`, `${unit} ${clusterKey}`],
  );
  const searchId = s.rows[0]!.id;
  const v = await c.query<{ id: string }>(
    `insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
     values ($1, $2, 1, $3::uuid[], 'cities', $4::jsonb) returning id`,
    [orgId, searchId, [clusterId], JSON.stringify({ cityIds: [cityId] })],
  );
  const versionId = v.rows[0]!.id;
  const r = await c.query<{ id: string }>(
    `insert into runs (org_id, search_version_id, status, kind, partition_index, ceiling_requests)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      orgId,
      versionId,
      opts.status ?? 'running',
      opts.kind ?? 'full_sweep',
      opts.partitionIndex ?? null,
      opts.ceilingRequests ?? 0,
    ],
  );
  return { searchId, versionId, runId: r.rows[0]!.id, clusterId, cityId };
}

/** McAllen's rough bounding box: the default rectangle for a fixture tile. */
const MCALLEN_RECT = { south: 26.15, west: -98.3, north: 26.3, east: -98.18 };

/**
 * Upserts the `place_tiles` row for `tileKey` and inserts one `run_searches` row for it.
 *
 * `tileKey` follows `{unitKind}:{unitId}|{placesType}|{quadPath}` (04-RESEARCH Pattern 5) in
 * its DB-SAFE form, e.g. `city:48215/McAllen|plumber|r`; unit kind, unit id and quad path are
 * parsed out of it (defaults `city`, `48215/McAllen`, `r`).
 *
 * 🔴 NO U+0000 IN ANY KEY THAT REACHES THE DATABASE. expand-cells joins a cell's parts with
 * U+0000 in memory, but a Postgres `text` value cannot hold NUL — the insert is refused with
 * `22021 invalid byte sequence for encoding "UTF8": 0x00` (hit by this fixture's own smoke
 * test). The DB-safe form replaces it with `/` (04-05 `dbSafe`), so `cellKey` here is
 * `clusterKey + '/' + unitId`.
 */
export async function seedRunSearch(
  c: Client,
  orgId: string,
  runId: string,
  opts: {
    tileKey: string;
    placesType: string;
    depth?: number;
    parentTileKey?: string | null;
    kind?: 'enterprise' | 'ids_only';
    clusterKey?: string;
    rect?: { south: number; west: number; north: number; east: number };
  },
): Promise<{ tileId: string; runSearchId: string }> {
  if (opts.tileKey.includes('\u0000')) {
    throw new Error('seedRunSearch: a tile key reaching the database must be DB-safe (no U+0000)');
  }
  const [unitPart = 'city:48215/McAllen', , quadPath = 'r'] = opts.tileKey.split('|');
  const colon = unitPart.indexOf(':');
  const unitKind = colon > 0 ? unitPart.slice(0, colon) : 'city';
  const unitId = colon > 0 ? unitPart.slice(colon + 1) : unitPart;
  const depth = opts.depth ?? 0;
  const rect = opts.rect ?? MCALLEN_RECT;
  const clusterKey = opts.clusterKey ?? 'home_services';
  const t = await c.query<{ id: string }>(
    `insert into place_tiles (org_id, tile_key, unit_kind, unit_id, places_type, quad_path, depth,
                              south, west, north, east)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (org_id, tile_key) do update set updated_at = now()
     returning id`,
    [
      orgId,
      opts.tileKey,
      unitKind,
      unitId,
      opts.placesType,
      quadPath,
      depth,
      rect.south,
      rect.west,
      rect.north,
      rect.east,
    ],
  );
  const tileId = t.rows[0]!.id;
  const rs = await c.query<{ id: string }>(
    `insert into run_searches (org_id, run_id, tile_id, tile_key, cell_key, cluster_key,
                               places_type, kind, depth, parent_tile_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      orgId,
      runId,
      tileId,
      opts.tileKey,
      clusterKey + '/' + unitId,
      clusterKey,
      opts.placesType,
      opts.kind ?? 'enterprise',
      depth,
      opts.parentTileKey ?? null,
    ],
  );
  return { tileId, runSearchId: rs.rows[0]!.id };
}

export type HostClass =
  'none' | 'business_site_dead' | 'social' | 'directory' | 'platform_subdomain' | 'other';

/**
 * Upserts a `place_attachments` row for (org, business, place) with `status`, then appends one
 * `place_observations` row for `runId` — and, with `withCoordinates`, its `place_coordinates`
 * row expiring exactly 30 days after `observedAt` (the longest the CHECK allows).
 *
 * Call it twice with two runs and two `observedAt`s to give one listing an observation
 * history; the attachment is upserted, the observations are appended.
 */
export async function seedAttachmentWithObservation(
  c: Client,
  args: {
    orgId: string;
    businessId: string;
    placeId: string;
    runId: string;
    status: 'attached' | 'tentative' | 'rejected';
    hadWebsiteUri: boolean;
    hostClass: HostClass;
    observedAt?: Date;
    withCoordinates?: boolean | { lat: number; lng: number };
    sku?: 'ts_essentials' | 'ts_pro' | 'ts_enterprise' | 'ts_enterprise_atmosphere';
    pureSab?: boolean;
  },
): Promise<{ attachmentId: string; observationId: string; coordinateId: string | null }> {
  const reason = args.status === 'rejected' ? 'rejected' : 'score';
  const score = args.status === 'tentative' ? 80 : 95;
  const a = await c.query<{ id: string }>(
    `insert into place_attachments (org_id, business_id, place_id, status, reason, score, features,
                                    first_seen_run_id, last_seen_run_id)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)
     on conflict (org_id, business_id, place_id)
       do update set status = excluded.status, reason = excluded.reason, score = excluded.score,
                     last_seen_run_id = excluded.last_seen_run_id
     returning id`,
    [
      args.orgId,
      args.businessId,
      args.placeId,
      args.status,
      reason,
      score,
      // Numbers only: pa_features_numeric (drizzle/0029) refuses any key outside the matcher's
      // allow-list and any non-numeric value — a `rule: 'fixture'` string is 23514 since 04-15.
      JSON.stringify({ name: 30, nameSim: 1 }),
      args.runId,
    ],
  );
  const attachmentId = a.rows[0]!.id;
  // An ISO string, never a Date: the drizzle-tx executor (`asPg`) refuses a Date parameter by
  // design (src/db/drizzle-executor.ts), and pg.Client binds the string identically.
  const observedAt = (args.observedAt ?? new Date()).toISOString();
  const o = await c.query<{ id: string }>(
    `insert into place_observations (org_id, business_id, place_id, run_id, attachment_id,
                                     had_website_uri, host_class, sku, pure_sab, observed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      args.orgId,
      args.businessId,
      args.placeId,
      args.runId,
      attachmentId,
      args.hadWebsiteUri,
      args.hostClass,
      args.sku ?? 'ts_enterprise',
      args.pureSab ?? false,
      observedAt,
    ],
  );
  const observationId = o.rows[0]!.id;
  let coordinateId: string | null = null;
  if (args.withCoordinates) {
    const at =
      typeof args.withCoordinates === 'object'
        ? args.withCoordinates
        : { lat: 26.2159, lng: -98.2336 };
    const pc = await c.query<{ id: string }>(
      `insert into place_coordinates (org_id, observation_id, lat, lng, observed_at, expires_at)
       values ($1, $2, $3, $4, $5, $5::timestamptz + interval '30 days') returning id`,
      [args.orgId, observationId, at.lat, at.lng, observedAt],
    );
    coordinateId = pc.rows[0]!.id;
  }
  return { attachmentId, observationId, coordinateId };
}
