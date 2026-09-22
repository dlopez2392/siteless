import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { PRICE_BOOK, type Sku } from '@/lib/budget/price-book';
import type { EstimateRange } from '@/lib/estimate/estimate';
import type { GeoSpec, PresetSpec, SeedTables } from '@/lib/estimate/expand-cells';
import type { GeocodeResult } from '@/lib/geocode/census';
import citiesJson from '@/seed/data/cities.json';
import countiesJson from '@/seed/data/counties.json';
import geoPresetsJson from '@/seed/data/geo-presets.json';
import outletCountsJson from '@/seed/data/outlet-counts.json';
import { CLUSTER_KEYS, type ClusterKey } from '@/seed/types';
import type {
  CitiesFile,
  CountiesFile,
  GeoPresetsFile,
  OutletCountsFile,
} from '@/seed/types';
import { rowsOf, type Tx } from './budget';

/**
 * Presets, versions, and the translation between what a picker sends and what the estimator
 * eats. Queries, not actions — see the header of `./budget.ts` for why this file carries no
 * server directive and why every function has a `read*` half that takes an open transaction.
 *
 * ── THE TWO VOCABULARIES ───────────────────────────────────────────────────────────────
 *
 * A version row stores IDS: `cluster_ids uuid[]`, and a `geo_payload` of `{ cityIds }`,
 * `{ countyIds }` or a geocoded centre. That is the shape `tests/db/versioned-presets.test.ts`
 * pins, and it is what the pickers produce, because a picker lists rows out of the database.
 *
 * The estimator eats KEYS AND NAMES: `clusterKeys`, and cities as `{ name, countyFips }`.
 * It is pure and imports no database module, which is the whole reason D-08's
 * recompute-as-you-type is safe.
 *
 * `resolveSpec` is the one translation between them, and it goes through `withOrg`, so an
 * id belonging to another tenant simply does not resolve (T-2-10).
 */

/* ======================================================================================
 * The seed the estimator prices against.
 * ==================================================================================== */

const cities: CitiesFile = citiesJson;
const counties: CountiesFile = countiesJson;
const outletCounts: OutletCountsFile = outletCountsJson;
const geoPresets: GeoPresetsFile = geoPresetsJson;

/**
 * 🔴 THE COMMITTED JSON IS THE PRICE MODEL, AND IT IS DELIBERATELY NOT RE-READ FROM THE
 * DATABASE.
 *
 * `scripts/seed.ts` loads these very files into the reference tables, so the database holds
 * a COPY. Deriving the estimate from that copy would create a second source of truth for one
 * number: on any machine where `pnpm db:seed` lagged a `refresh:outlet-counts.ts` run, the
 * screen would quote a dollar figure that `tests/unit/estimate.test.ts` — which asserts exact
 * values against these files — says is impossible. That divergence is precisely what T-2-08
 * exists to prevent, and it would be invisible to every gate.
 *
 * Two more reasons the read is not a `withOrg` read:
 *   * `SeedTables` is typed as the FILE shapes (02-07, `src/lib/estimate/expand-cells.ts`),
 *     including `CityProvenance`'s eleven fields — a measurement rule, a threshold, coverage
 *     percentages and the next candidate cities. None of that has a column in `cities`, and
 *     synthesising it to satisfy the type would be a fabricated provenance on a screen whose
 *     entire job is telling danlo where a number came from.
 *   * These are `org_id IS NULL` built-ins that every tenant reads identically (D-05), so
 *     RLS confines nothing here. What IS tenant-scoped — which cluster ids a version names,
 *     which cities a tenant picked, the budget row — all still goes through `withOrg` below.
 *
 * Module scope rather than a per-request cache: the parse happens once per process, which is
 * strictly better than once per request on a path that recomputes on every keystroke.
 */
const SEED: SeedTables = { cities, counties, outletCounts, geoPresets };

export function getSeedTables(): SeedTables {
  return SEED;
}

/* ======================================================================================
 * The wire spec: what a picker sends, zod-bounded before anything touches it.
 * ==================================================================================== */

const clusterKeySchema = z.enum(CLUSTER_KEYS);

/** Texas FIPS GEOIDs are five digits. Bounded here so a malformed one is a validation
 *  refusal rather than a seed lookup miss the estimator reports as "can't be computed". */
const fipsSchema = z.string().regex(/^\d{5}$/, 'a county FIPS is five digits');

/**
 * UI-SPEC § Preset editor → Radius, and § Executor Notes 10: "5 · 10 · 25 · 50 miles —
 * covers a single RGV town up to a multi-town sweep; 50mi ≈ the Places 50km ceiling."
 *
 * Exported so plan 02-11's `Select` renders these four and cannot invent a fifth. A radius
 * outside this set is a footprint the committed cost model has never been priced against.
 */
export const RADIUS_MILE_OPTIONS = [5, 10, 25, 50] as const;

/**
 * A successful geocode, as `geocodeAddress` hands it back to a screen.
 *
 * Declared here rather than in `src/lib/geocode/census.ts` because it is a WIRE type: a
 * module carrying the server directive may export nothing but async functions, so the
 * action cannot export the shape of its own payload, and a hit is exactly the material a
 * radius geography is then built from — `lat`, `lng` and `countyFips` go straight into the
 * schema above, and `matchedAddress` is what UI-SPEC renders as "Matched: {address}".
 */
export type GeocodeHit = Omit<Extract<GeocodeResult, { ok: true }>, 'ok'>;

const geoSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cities'), cityIds: z.array(z.uuid()).min(1).max(300) }),
  z.strictObject({ kind: z.literal('counties'), countyIds: z.array(z.uuid()).min(1).max(254) }),
  z.strictObject({
    kind: z.literal('radius'),
    lat: z.number().finite(),
    lng: z.number().finite(),
    countyFips: fipsSchema,
    // UI-SPEC § Preset editor fixes the four options; a fifth would be a radius the cost
    // model has never been checked against.
    radiusMiles: z.literal(RADIUS_MILE_OPTIONS),
    matchedAddress: z.string().min(1).max(200),
    countyName: z.string().min(1).max(120).optional(),
  }),
]);

/**
 * 🔴 ONE TO FOUR CLUSTERS. The upper bound is not decoration: the estimator's cell count is
 * `|clusters| × |geography units|`, so an unbounded cluster list is an unbounded compute
 * request from an authenticated caller (T-2-14). Four is every cluster that exists (D-03).
 */
export const presetSpecSchema = z.strictObject({
  clusterKeys: z.array(clusterKeySchema).min(1).max(CLUSTER_KEYS.length),
  geo: geoSchema,
});

export type PresetSpecInput = z.infer<typeof presetSpecSchema>;
export type GeoInput = z.infer<typeof geoSchema>;

/** What lands in `search_versions.geo_payload` — the geography without its discriminator,
 *  which is carried by `geo_kind` beside it. The shape `tests/db/versioned-presets.test.ts`
 *  round-trips. */
export type GeoPayload =
  | { cityIds: string[] }
  | { countyIds: string[] }
  | {
      lat: number;
      lng: number;
      radiusMiles: number;
      countyFips: string;
      matchedAddress: string;
      countyName?: string;
    };

export function geoPayloadOf(geo: GeoInput): { kind: GeoInput['kind']; payload: GeoPayload } {
  if (geo.kind === 'cities') return { kind: 'cities', payload: { cityIds: geo.cityIds } };
  if (geo.kind === 'counties') return { kind: 'counties', payload: { countyIds: geo.countyIds } };
  // Named field by field rather than spread-minus-discriminator: this object is written to
  // an APPEND-ONLY row that a finished run will point at forever, so what it contains is a
  // decision, not a leftover.
  const payload: GeoPayload = {
    lat: geo.lat,
    lng: geo.lng,
    radiusMiles: geo.radiusMiles,
    countyFips: geo.countyFips,
    matchedAddress: geo.matchedAddress,
    ...(geo.countyName === undefined ? {} : { countyName: geo.countyName }),
  };
  return { kind: 'radius', payload };
}

/* ======================================================================================
 * The estimate snapshot, on its way into and out of jsonb.
 * ==================================================================================== */

/**
 * 🔴 `EstimateRange.remainingMicroUsd` IS A BIGINT, AND `JSON.stringify` THROWS ON ONE.
 *
 * "TypeError: Do not know how to serialize a BigInt" — the same failure drizzle-kit hit on
 * `runs.cost_micro_usd` in wave 1, where it emitted no migration at all while typecheck
 * stayed green. Storing an estimate straight into `search_versions.estimate_snapshot` would
 * throw at the moment of saving a preset, which is the one write in this phase a user
 * actually performs.
 *
 * So the stored shape carries the µUSD figure as a DECIMAL STRING and converts back on read.
 * It is not a lossy rounding — a string holds every digit — and the conversion is in one
 * place rather than at each of the three call sites that touch a snapshot.
 *
 * (Over the wire it stays a bigint: React Flight serializes one as `"$n" + toString(10)`,
 * verified in `react-server-dom-turbopack-server.node.production.js`. The boundary that
 * cannot take it is JSON, not the action.)
 */
const SKU_KEYS = Object.keys(PRICE_BOOK) as [Sku, ...Sku[]];

const assumptionsSchema = z.strictObject({
  fanOut: z.number(),
  pagesLo: z.number(),
  pagesHi: z.number(),
  radiusReferenceMiles: z.number(),
});

/** What an action receives from a screen: a real `EstimateRange`, bigint and all. */
export const estimateRangeSchema = z.strictObject({
  cells: z.number(),
  requestsLo: z.number(),
  requestsHi: z.number(),
  costMicroUsdLo: z.number(),
  costMicroUsdHi: z.number(),
  expectedResults: z.number(),
  freeRemaining: z.number(),
  remainingMicroUsd: z.bigint(),
  pctOfRemainingLo: z.number(),
  pctOfRemainingHi: z.number(),
  sku: z.enum(SKU_KEYS),
  assumptions: assumptionsSchema,
});

/** What the column holds. `freeRemaining` is `null` for an unlimited-allowance SKU, because
 *  `JSON.stringify(Infinity)` is `null` anyway and a round-trip that silently turns
 *  "unlimited" into "none left" would quote a cost for a free call. */
const storedEstimateSchema = z.strictObject({
  ...estimateRangeSchema.shape,
  freeRemaining: z.number().nullable(),
  remainingMicroUsd: z.string().regex(/^-?\d+$/),
});

export type StoredEstimate = z.infer<typeof storedEstimateSchema>;

export function toStoredEstimate(range: EstimateRange): StoredEstimate {
  return {
    ...range,
    freeRemaining: Number.isFinite(range.freeRemaining) ? range.freeRemaining : null,
    remainingMicroUsd: range.remainingMicroUsd.toString(),
  };
}

/** `null` when the column holds something this build no longer understands — a snapshot is
 *  a convenience, never a correctness input, so an unreadable one is simply absent. */
export function fromStoredEstimate(value: unknown): EstimateRange | null {
  if (value === null || value === undefined) return null;
  const parsed = storedEstimateSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    freeRemaining: parsed.data.freeRemaining ?? Number.POSITIVE_INFINITY,
    remainingMicroUsd: BigInt(parsed.data.remainingMicroUsd),
  };
}

/* ======================================================================================
 * The reference index: ids <-> keys and names, read through withOrg.
 * ==================================================================================== */

export type CityRow = { id: string; name: string; countyFips: string };
export type CountyRow = { id: string; fips: string; name: string };
export type ClusterRow = { id: string; key: ClusterKey; displayName: string };

export type ReferenceIndex = {
  clusters: ClusterRow[];
  clusterIdByKey: Map<ClusterKey, string>;
  clusterById: Map<string, ClusterRow>;
  cityById: Map<string, CityRow>;
  cityIdByRef: Map<string, string>;
  countyById: Map<string, CountyRow>;
  countyIdByFips: Map<string, string>;
};

const cityRefKey = (countyFips: string, name: string) => `${countyFips}|${name}`;

/**
 * The built-in reference rows, as the two lookup directions the rest of this file needs.
 *
 * `org_id is null` is explicit rather than left to the read policy. The policy admits a
 * tenant's OWN cluster rows too (D-05), and the estimator has outlet counts for the four
 * seeded clusters and nothing else — a tenant-defined cluster would resolve to an id, reach
 * `expandCells`, and throw there with a message about a missing seed rather than here with a
 * message about an unknown cluster.
 */
export async function readReferenceIndex(tx: Tx): Promise<ReferenceIndex> {
  const clusterRows = rowsOf<{ id: string; key: string; display_name: string }>(
    await tx.execute(sql`
      select id, key, display_name
        from industry_clusters
       where org_id is null
       order by sort_order`),
  );
  const cityRows = rowsOf<{ id: string; name: string; fips: string }>(
    await tx.execute(sql`
      select ci.id, ci.name, co.fips
        from cities ci
        join counties co on co.id = ci.county_id
       where ci.org_id is null
       order by ci.name`),
  );
  const countyRows = rowsOf<{ id: string; fips: string; name: string }>(
    await tx.execute(sql`
      select id, fips, name
        from counties
       where org_id is null
       order by fips`),
  );

  const known = new Set<string>(CLUSTER_KEYS);
  const clusters: ClusterRow[] = clusterRows
    .filter((r) => known.has(r.key))
    .map((r) => ({ id: r.id, key: r.key as ClusterKey, displayName: r.display_name }));

  const clusterIdByKey = new Map<ClusterKey, string>(clusters.map((c) => [c.key, c.id]));
  const clusterById = new Map<string, ClusterRow>(clusters.map((c) => [c.id, c]));

  const cityById = new Map<string, CityRow>();
  const cityIdByRef = new Map<string, string>();
  for (const row of cityRows) {
    cityById.set(row.id, { id: row.id, name: row.name, countyFips: row.fips });
    cityIdByRef.set(cityRefKey(row.fips, row.name), row.id);
  }

  const countyById = new Map<string, CountyRow>();
  const countyIdByFips = new Map<string, string>();
  for (const row of countyRows) {
    countyById.set(row.id, { id: row.id, fips: row.fips, name: row.name });
    countyIdByFips.set(row.fips, row.id);
  }

  return {
    clusters,
    clusterIdByKey,
    clusterById: clusterById,
    cityById,
    cityIdByRef,
    countyById,
    countyIdByFips,
  };
}

export async function getReferenceIndex(claims: OrgClaims): Promise<ReferenceIndex> {
  return withOrg(claims, (tx) => readReferenceIndex(tx));
}

/* ======================================================================================
 * Translation.
 * ==================================================================================== */

export type SpecResolution =
  | { ok: true; spec: PresetSpec; clusterIds: string[] }
  | { ok: false; message: string };

/**
 * Wire spec -> `PresetSpec`, plus the cluster ids a version row stores.
 *
 * Returns a result rather than throwing, because every failure here is a user-facing
 * sentence: a city id that belongs to nobody, a county FIPS that is not in the seed. An
 * unresolvable id is reported as an unknown SELECTION, never as "that row belongs to another
 * organisation" — RLS already made the two indistinguishable and confirming which it was
 * would be the disclosure the confinement exists to prevent.
 */
export function resolveSpec(
  input: PresetSpecInput,
  index: ReferenceIndex,
  name: string,
): SpecResolution {
  const clusterIds: string[] = [];
  for (const key of input.clusterKeys) {
    const id = index.clusterIdByKey.get(key);
    if (!id) {
      return {
        ok: false,
        message: `The industry cluster "${key}" is not available. Reload the page and pick it again.`,
      };
    }
    clusterIds.push(id);
  }

  let geo: GeoSpec;
  if (input.geo.kind === 'cities') {
    const refs = [];
    for (const cityId of input.geo.cityIds) {
      const city = index.cityById.get(cityId);
      if (!city) {
        return { ok: false, message: 'One of the selected cities is no longer available.' };
      }
      refs.push({ name: city.name, countyFips: city.countyFips });
    }
    geo = { kind: 'cities', cities: refs };
  } else if (input.geo.kind === 'counties') {
    const fips: string[] = [];
    for (const countyId of input.geo.countyIds) {
      const county = index.countyById.get(countyId);
      if (!county) {
        return { ok: false, message: 'One of the selected counties is no longer available.' };
      }
      fips.push(county.fips);
    }
    geo = { kind: 'counties', counties: fips };
  } else {
    if (!index.countyIdByFips.has(input.geo.countyFips)) {
      return {
        ok: false,
        message:
          'That address geocoded to a county Siteless has no outlet counts for. ' +
          'Pick a Texas address, or define this preset by county instead.',
      };
    }
    geo = {
      kind: 'radius',
      lat: input.geo.lat,
      lng: input.geo.lng,
      countyFips: input.geo.countyFips,
      radiusMiles: input.geo.radiusMiles,
    };
  }

  return { ok: true, spec: { name, clusterKeys: input.clusterKeys, geo }, clusterIds };
}

/** A stored version row back into a wire spec, so an edit screen and a re-run both start
 *  from exactly what was saved. `null` when a referenced reference row has gone. */
export function specInputOfVersion(
  clusterIds: string[],
  geoKind: string,
  geoPayload: unknown,
  index: ReferenceIndex,
): PresetSpecInput | null {
  const clusterKeys: ClusterKey[] = [];
  for (const id of clusterIds) {
    const cluster = index.clusterById.get(id);
    if (!cluster) return null;
    clusterKeys.push(cluster.key);
  }
  const candidate = { clusterKeys, geo: { kind: geoKind, ...(geoPayload as object) } };
  const parsed = presetSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/* ======================================================================================
 * Reads.
 * ==================================================================================== */

export type PresetSummary = {
  id: string;
  displayName: string;
  status: string;
  currentVersionId: string | null;
  currentVersion: number | null;
  versionCount: number;
  updatedAt: Date;
};

export async function readPresets(tx: Tx): Promise<PresetSummary[]> {
  const rows = rowsOf<{
    id: string;
    display_name: string;
    status: string;
    current_version_id: string | null;
    current_version: number | null;
    version_count: number;
    updated_at: Date;
  }>(
    await tx.execute(sql`
      select s.id,
             s.display_name,
             s.status,
             s.current_version_id,
             cv.version                                as current_version,
             (select count(*)::int from search_versions v where v.search_id = s.id)
                                                       as version_count,
             s.updated_at
        from searches s
        left join search_versions cv on cv.id = s.current_version_id
       order by s.updated_at desc`),
  );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    status: r.status,
    currentVersionId: r.current_version_id,
    currentVersion: r.current_version,
    versionCount: r.version_count,
    updatedAt: r.updated_at,
  }));
}

export async function listPresets(claims: OrgClaims): Promise<PresetSummary[]> {
  return withOrg(claims, (tx) => readPresets(tx));
}

export type PresetVersionRow = {
  id: string;
  version: number;
  clusterIds: string[];
  geoKind: string;
  geoPayload: GeoPayload;
  /** The wire spec this version round-trips to, or `null` if a referenced row is gone. */
  spec: PresetSpecInput | null;
  estimateSnapshot: EstimateRange | null;
  createdAt: Date;
  createdBy: string | null;
  /** 🔴 A LIVE `count(*)`, never a stored counter. D-16 shows this on every version row and
   *  a denormalised column is a number that drifts out of agreement with the rows it counts. */
  usedByRuns: number;
};

export type PresetDetail = {
  id: string;
  displayName: string;
  nameInternal: string;
  status: string;
  currentVersionId: string | null;
  currentVersion: PresetVersionRow | null;
  versions: PresetVersionRow[];
  updatedAt: Date;
};

export async function readPreset(
  tx: Tx,
  searchId: string,
  index: ReferenceIndex,
): Promise<PresetDetail | null> {
  const head = rowsOf<{
    id: string;
    display_name: string;
    name_internal: string;
    status: string;
    current_version_id: string | null;
    updated_at: Date;
  }>(
    await tx.execute(sql`
      select id, display_name, name_internal, status, current_version_id, updated_at
        from searches
       where id = ${searchId}`),
  )[0];
  // RLS confines the read, so a foreign id and a deleted id are the same answer. That is
  // the intended behaviour, not a gap: never confirm the resource exists (T-2-10).
  if (!head) return null;

  const versionRows = rowsOf<{
    id: string;
    version: number;
    cluster_ids: string[];
    geo_kind: string;
    geo_payload: GeoPayload;
    estimate_snapshot: unknown;
    created_at: Date;
    created_by: string | null;
    used_by_runs: number;
  }>(
    await tx.execute(sql`
      select v.id,
             v.version,
             v.cluster_ids,
             v.geo_kind,
             v.geo_payload,
             v.estimate_snapshot,
             v.created_at,
             v.created_by,
             (select count(*)::int from runs r where r.search_version_id = v.id)
               as used_by_runs
        from search_versions v
       where v.search_id = ${searchId}
       order by v.version desc`),
  );

  const versions: PresetVersionRow[] = versionRows.map((r) => ({
    id: r.id,
    version: r.version,
    clusterIds: r.cluster_ids,
    geoKind: r.geo_kind,
    geoPayload: r.geo_payload,
    spec: specInputOfVersion(r.cluster_ids, r.geo_kind, r.geo_payload, index),
    estimateSnapshot: fromStoredEstimate(r.estimate_snapshot),
    createdAt: r.created_at,
    createdBy: r.created_by,
    usedByRuns: r.used_by_runs,
  }));

  return {
    id: head.id,
    displayName: head.display_name,
    nameInternal: head.name_internal,
    status: head.status,
    currentVersionId: head.current_version_id,
    currentVersion: versions.find((v) => v.id === head.current_version_id) ?? null,
    versions,
    updatedAt: head.updated_at,
  };
}

/**
 * The version number a preset is on right now.
 *
 * 🔴 CALLED ONLY AFTER A SAVE CONFLICT, AND ONLY IN A FRESH TRANSACTION. The 23505 that
 * detected the conflict ABORTED the transaction it was raised in — every further statement
 * there answers `25P02 current transaction is aborted`, which is the repo's recorded
 * one-refused-statement-per-transaction rule — so the number that goes into the conflict
 * message cannot be read on the way out of the failed save.
 */
export async function readCurrentVersionNumber(tx: Tx, searchId: string): Promise<number | null> {
  const row = rowsOf<{ version: number }>(
    await tx.execute(sql`
      select coalesce(max(version), 0)::int as version
        from search_versions
       where search_id = ${searchId}`),
  )[0];
  return row && row.version > 0 ? row.version : null;
}

export async function getPreset(claims: OrgClaims, searchId: string): Promise<PresetDetail | null> {
  return withOrg(claims, async (tx) => {
    const index = await readReferenceIndex(tx);
    return readPreset(tx, searchId, index);
  });
}
