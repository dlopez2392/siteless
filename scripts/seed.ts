/**
 * The reference-row loader. Reads the committed JSON under `src/seed/data/` and upserts it
 * into the six reference tables as `org_id IS NULL` built-ins (D-05).
 *
 *   pnpm db:seed       -> tsx scripts/seed.ts --target=test
 *   pnpm db:seed:prod  -> tsx scripts/seed.ts --target=prod
 *
 * WHY A SCRIPT AND NOT A MIGRATION. drizzle-kit hashes migration SQL and CONVENTIONS
 * § Migrations forbids editing an applied file, while outlet counts are deliberately
 * REFRESHABLE — Socrata's `rowsUpdatedAt` moves, and `scripts/refresh-outlet-counts.ts`
 * rewrites the JSON this loader reads. A migration structurally cannot have that story.
 * The schema ships in a migration; the rows ship here (02-RESEARCH.md § Seed loader).
 *
 * WHY THE OWNER. `referencePolicies()` excludes `org_id IS NULL` from every write policy,
 * so `authenticated` cannot write a built-in at all — by design. The owner bypasses RLS.
 * That asymmetry is the entire mechanism behind "a tenant can read a built-in and can
 * never change one", and it is why this connects with the migration credentials rather
 * than through `withOrg()`.
 *
 * 🔴 EVERY UPSERT NAMES ITS CONSTRAINT: `on conflict on constraint <name>`, never the
 * column-list inference form naming `org_id, key`. Naming the constraint is what makes the
 * `NULLS NOT DISTINCT` semantics explicit at the call site. A plain `UNIQUE (org_id, key)`
 * does NOT stop a duplicate built-in — `NULL != NULL`, so a second `(null,
 * 'home_services')` inserts cleanly and this loader silently doubles every row on its
 * second run (02-RESEARCH.md Pattern 5, surprise 2). EXECUTED during this plan: with the
 * unique key re-declared without `nulls not distinct`, two seed runs took
 * industry_clusters from 4 rows to 8. The column-list form compiles and runs against a
 * plain unique index too, so it would hide exactly the regression the constraint prevents,
 * which is why the repo greps for its absence rather than trusting review.
 *
 * `(xmax = 0)` in RETURNING is how inserted and updated are told apart: an inserted tuple
 * has no deleting xid, an ON CONFLICT DO UPDATE tuple does. Chosen over PostgreSQL 18's
 * `RETURNING old.* / new.*` because production Supabase is **17.6** and would reject it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import type {
  CitiesFile,
  ClustersFile,
  CountiesFile,
  GeoPresetsFile,
  OutletCountsFile,
} from '../src/seed/types';

loadEnv({ path: '.env.local', override: false, quiet: true });

// ---------------------------------------------------------------------------------------
// The committed JSON. Read at run time rather than imported, so `refresh-outlet-counts.ts`
// rewriting a file needs no rebuild and no import-attribute ceremony.
// ---------------------------------------------------------------------------------------

function readSeedFile<T>(name: string): T {
  const path = fileURLToPath(new URL(`../src/seed/data/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const countiesFile = () => readSeedFile<CountiesFile>('counties.json');
export const clustersFile = () => readSeedFile<ClustersFile>('clusters.json');
export const citiesFile = () => readSeedFile<CitiesFile>('cities.json');
export const outletCountsFile = () => readSeedFile<OutletCountsFile>('outlet-counts.json');
export const geoPresetsFile = () => readSeedFile<GeoPresetsFile>('geo-presets.json');

// ---------------------------------------------------------------------------------------
// The upserts. Exported so tests/db/reference-rows.test.ts runs the REAL statement rather
// than a restatement of it — a test that retypes the SQL cannot detect the SQL drifting.
// ---------------------------------------------------------------------------------------

export const COUNTY_UPSERT = `
  insert into counties (org_id, fips, county_fips, comptroller_code, name, is_rgv, outlet_count)
  values (null, $1, $2, $3, $4, $5, $6)
  on conflict on constraint counties_org_fips_uniq do update set
    county_fips      = excluded.county_fips,
    comptroller_code = excluded.comptroller_code,
    name             = excluded.name,
    is_rgv           = excluded.is_rgv,
    outlet_count     = excluded.outlet_count
  returning (xmax = 0) as inserted`;

export const CLUSTER_UPSERT = `
  insert into industry_clusters (org_id, key, display_name, sort_order)
  values (null, $1, $2, $3)
  on conflict on constraint industry_clusters_org_key_uniq do update set
    display_name = excluded.display_name,
    sort_order   = excluded.sort_order
  returning (xmax = 0) as inserted`;

export const TERM_UPSERT = `
  insert into industry_terms (org_id, cluster_id, kind, value, naics_lo, naics_hi)
  values (null, $1, $2, $3, $4, $5)
  on conflict on constraint industry_terms_org_key_uniq do update set
    naics_lo = excluded.naics_lo,
    naics_hi = excluded.naics_hi
  returning (xmax = 0) as inserted`;

export const CITY_UPSERT = `
  insert into cities (org_id, county_id, name, name_variants, outlet_count, is_rgv_seed)
  values (null, $1, $2, $3::text[], $4, $5)
  on conflict on constraint cities_org_county_name_uniq do update set
    name_variants = excluded.name_variants,
    outlet_count  = excluded.outlet_count,
    is_rgv_seed   = excluded.is_rgv_seed
  returning (xmax = 0) as inserted`;

export const OUTLET_COUNT_UPSERT = `
  insert into outlet_counts (org_id, scope, county_id, cluster_id, outlets, measured_at, source)
  values (null, $1, $2, $3, $4, $5::timestamptz, $6)
  on conflict on constraint outlet_counts_org_scope_uniq do update set
    outlets     = excluded.outlets,
    measured_at = excluded.measured_at,
    source      = excluded.source
  returning (xmax = 0) as inserted`;

export const GEO_PRESET_UPSERT = `
  insert into geo_presets (org_id, key, display_name, kind, payload)
  values (null, $1, $2, $3, $4::jsonb)
  on conflict on constraint geo_presets_org_key_uniq do update set
    display_name = excluded.display_name,
    kind         = excluded.kind,
    payload      = excluded.payload
  returning (xmax = 0) as inserted`;

export type Tally = { inserted: number; updated: number };

async function upsert(c: Client, sql: string, params: unknown[], tally: Tally): Promise<void> {
  const r = await c.query<{ inserted: boolean }>(sql, params);
  const row = r.rows[0];
  // A DO UPDATE whose USING is filtered returns no row at all. Silence there would let the
  // loader report success while writing nothing, which is the one failure this script
  // must never have.
  if (!row) throw new Error('seed: upsert affected no row. SQL: ' + sql.trim().split('\n')[0]);
  if (row.inserted) tally.inserted += 1;
  else tally.updated += 1;
}

const emptyTally = (): Tally => ({ inserted: 0, updated: 0 });

// ---------------------------------------------------------------------------------------
// Lookups. Every reference between two seed files is resolved to a real uuid here, and a
// miss throws NAMING the ref: a silently-empty preset is a preset that estimates zero.
// ---------------------------------------------------------------------------------------

async function countyIdsByFips(c: Client): Promise<Map<string, string>> {
  const { rows } = await c.query<{ id: string; fips: string }>(
    'select id, fips from counties where org_id is null',
  );
  return new Map(rows.map((r) => [r.fips, r.id]));
}

async function clusterIdsByKey(c: Client): Promise<Map<string, string>> {
  const { rows } = await c.query<{ id: string; key: string }>(
    'select id, key from industry_clusters where org_id is null',
  );
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function cityIdsByCountyAndName(c: Client): Promise<Map<string, string>> {
  const { rows } = await c.query<{ id: string; name: string; fips: string }>(
    `select ci.id, ci.name, co.fips
       from cities ci join counties co on co.id = ci.county_id
      where ci.org_id is null`,
  );
  return new Map(rows.map((r) => [`${r.fips}|${r.name}`, r.id]));
}

function required<K, V>(map: Map<K, V>, key: K, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`seed: ${what} ${String(key)} resolved to no row`);
  return v;
}

// ---------------------------------------------------------------------------------------
// Per-table loaders, in FK order: counties -> clusters -> terms -> cities -> outlet_counts
// -> geo_presets. Each is exported so a test can run one in isolation inside withRollback.
// ---------------------------------------------------------------------------------------

export async function upsertCounties(c: Client): Promise<Tally> {
  const tally = emptyTally();
  for (const county of countiesFile().counties) {
    await upsert(
      c,
      COUNTY_UPSERT,
      [
        county.fips,
        county.countyFips,
        county.comptrollerCode,
        county.name,
        county.isRgv,
        county.outletCount,
      ],
      tally,
    );
  }
  return tally;
}

export async function upsertIndustryClusters(c: Client): Promise<Tally> {
  const tally = emptyTally();
  for (const cluster of clustersFile().clusters) {
    await upsert(c, CLUSTER_UPSERT, [cluster.key, cluster.displayName, cluster.sortOrder], tally);
  }
  return tally;
}

export async function upsertIndustryTerms(c: Client): Promise<Tally> {
  const tally = emptyTally();
  const byKey = await clusterIdsByKey(c);
  for (const cluster of clustersFile().clusters) {
    const clusterId = required(byKey, cluster.key, 'industry_terms cluster key');
    // `lo` inclusive, `hi` EXCLUSIVE — the half-open form src/seed/types.ts documents,
    // because the Socrata query that produced these counts is a numeric range predicate
    // (`starts_with()` on the NUMBER column outlet_naics_code is HTTP 400).
    for (const range of cluster.naicsRanges) {
      await upsert(
        c,
        TERM_UPSERT,
        [clusterId, 'naics_range', `${range.lo}-${range.hi}`, range.lo, range.hi],
        tally,
      );
    }
    for (const placesType of cluster.placesTypes) {
      // it_naics_range_bounds is an EQUIVALENCE: a places_type term carrying bounds is
      // refused just as a naics_range term missing them is. Hence the explicit nulls.
      await upsert(c, TERM_UPSERT, [clusterId, 'places_type', placesType, null, null], tally);
    }
  }
  return tally;
}

export async function upsertCities(c: Client): Promise<Tally> {
  const tally = emptyTally();
  const byFips = await countyIdsByFips(c);
  for (const city of citiesFile().cities) {
    const countyId = required(byFips, city.countyFips, `city ${city.name} county fips`);
    await upsert(
      c,
      CITY_UPSERT,
      [countyId, city.name, city.nameVariants, city.outletCount, true],
      tally,
    );
  }
  return tally;
}

export async function upsertOutletCounts(c: Client): Promise<Tally> {
  const tally = emptyTally();
  const file = outletCountsFile();
  const byFips = await countyIdsByFips(c);
  const byKey = await clusterIdsByKey(c);
  // Anchored to UTC explicitly. `measuredAt` is a bare date; handing '2026-09-22' to a
  // timestamptz column resolves it in the SERVER's TimeZone, so the same JSON would land
  // on two different instants on two machines. Intl/Date.UTC is the same trap this repo
  // already documents twice.
  const measuredAt = `${file.measuredAt}T00:00:00Z`;
  for (const row of file.outletCounts) {
    const clusterId = required(byKey, row.clusterKey, 'outlet_counts cluster key');
    // oc_scope_target is an EQUIVALENCE: a 'county' row must name a county and a 'state'
    // row must not. `null` here is the state case and is load-bearing, not a default.
    const countyId =
      row.countyFips === null
        ? null
        : required(byFips, row.countyFips, 'outlet_counts county fips');
    await upsert(
      c,
      OUTLET_COUNT_UPSERT,
      [row.scope, countyId, clusterId, row.outlets, measuredAt, file.source],
      tally,
    );
  }
  return tally;
}

export async function upsertGeoPresets(c: Client): Promise<Tally> {
  const tally = emptyTally();
  const byFips = await countyIdsByFips(c);
  const byCity = await cityIdsByCountyAndName(c);
  for (const preset of geoPresetsFile().geoPresets) {
    // The payload is RESOLVED at seed time, never committed: a uuid is assigned by the
    // database and cannot exist in a JSON file. The seed file carries refs (a name plus a
    // county fips, or a fips) and this is where they become ids.
    let payload: { cityIds: string[] } | { countyIds: string[] };
    if (preset.kind === 'cities') {
      payload = {
        cityIds: preset.cities.map((ref) =>
          required(byCity, `${ref.countyFips}|${ref.name}`, `geo_preset ${preset.key} city ref`),
        ),
      };
    } else if (preset.kind === 'counties') {
      payload = {
        countyIds: preset.counties.map((fips) =>
          required(byFips, fips, `geo_preset ${preset.key} county fips`),
        ),
      };
    } else {
      // 'radius' is produced by geocoding a caller-supplied address and cannot be seeded.
      throw new Error(`seed: geo_preset ${preset.key} has unseedable kind ${preset.kind}`);
    }
    await upsert(
      c,
      GEO_PRESET_UPSERT,
      [preset.key, preset.displayName, preset.kind, JSON.stringify(payload)],
      tally,
    );
  }
  return tally;
}

/** FK order matters: cities need counties, terms need clusters, presets need both. */
export async function seedAll(c: Client): Promise<Array<[string, Tally]>> {
  return [
    ['counties', await upsertCounties(c)],
    ['industry_clusters', await upsertIndustryClusters(c)],
    ['industry_terms', await upsertIndustryTerms(c)],
    ['cities', await upsertCities(c)],
    ['outlet_counts', await upsertOutletCounts(c)],
    ['geo_presets', await upsertGeoPresets(c)],
  ];
}

// ---------------------------------------------------------------------------------------
// The target gate. Copied in shape from scripts/db.ts, deliberately rather than imported:
// db.ts runs its gate at module load and spawns drizzle-kit, so importing it would seed by
// side effect. The MESSAGES are identical so a refusal reads the same from either script.
// ---------------------------------------------------------------------------------------

export function resolveSeedTarget(argv: string[]): { target: 'test' | 'prod'; url: string } {
  const targetArg = argv.find((a) => a.startsWith('--target='));
  const target = targetArg ? targetArg.slice('--target='.length) : 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('scripts/seed.ts: unknown target ' + target + ' (test | prod)');
  }
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url)
    throw new Error('scripts/seed.ts: ' + varName + ' is not set. See docs/local-postgres.md.');

  // D-04: the cloud project jahgeqshuesndyscnmjo is production only. A test-target URL that
  // reaches it would write reference rows to production outside the migration authority.
  //
  // The alternation matches both host shapes the project serves: the direct
  // `db.<ref>.supabase.co` address and the pooled `aws-0-<region>.pooler.supabase.com`
  // one. Matching only the first left the pooler URL — the one --target=prod is actually
  // supposed to use — reading as a NON-Supabase host, which inverts both branches below.
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error('scripts/seed.ts: --target=test refuses a Supabase host. D-04.');
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error('scripts/seed.ts: --target=prod expects the Supabase session pooler URL.');
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      'scripts/seed.ts: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the migration/seed path.',
    );
  }
  return { target, url };
}

/** Every reference table must end non-empty. A loader that wrote nothing and exited 0 is
 *  indistinguishable from a working one until the estimator prices everything at zero. */
const MUST_BE_NON_EMPTY = [
  'counties',
  'industry_clusters',
  'industry_terms',
  'cities',
  'outlet_counts',
  'geo_presets',
] as const;

async function main(): Promise<void> {
  const { target, url } = resolveSeedTarget(process.argv.slice(2));
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await c.connect();
  try {
    console.log(`scripts/seed.ts: target=${target}`);
    // One transaction for the whole load: a crash halfway through must not leave a preset
    // pointing at cities that exist beside counties that do not.
    await c.query('begin');
    const results = await seedAll(c);
    await c.query('commit');
    for (const [table, tally] of results) {
      console.log(`${table}: ${tally.inserted} inserted, ${tally.updated} updated`);
    }
    let empty = 0;
    for (const table of MUST_BE_NON_EMPTY) {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from ${table} where org_id is null`,
      );
      const n = rows[0]?.n ?? 0;
      if (n === 0) {
        console.error(`scripts/seed.ts: ${table} ended with zero built-in rows`);
        empty += 1;
      }
    }
    if (empty > 0) process.exitCode = 1;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

// Only when run as a script. tests/db/reference-rows.test.ts imports the upserts above and
// must not seed the database by the act of importing them.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
