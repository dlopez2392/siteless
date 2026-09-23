/**
 * The Overture places desk ingest (DATA-02, D-04, D-05, D-06).
 *
 *   tsx scripts/ingest-overture.ts --org=<clerk_org_id> --release=<YYYY-MM-DD.N> [--target=test|prod]
 *   tsx scripts/ingest-overture.ts --release=<YYYY-MM-DD.N> --sample=<path.json>
 *
 * The first form range-reads the naive RGV bbox out of the public Overture bucket through
 * DuckDB, runs every row through the PURE transform (`src/lib/overture/transform.ts`) and writes
 * the Texas side through the shared ingest path (03-09). The second form writes the committed
 * CI fixture instead and touches no database: that fixture is the only reproducible copy of the
 * release, because the bucket keeps exactly ONE release (`2026-08-19.0` was the only prefix
 * under `release/` on 2026-09-22) — a pinned release string documents provenance, it does not
 * guarantee re-fetchability.
 *
 * 🔴 `@duckdb/node-api` IS IMPORTED HERE AND NOWHERE ELSE. It is a native binary and a
 * devDependency; nothing reachable from `src/` may import it, so the deployed bundle and CI's
 * unit lane never load it (T-3-14). The script does the I/O; the transform is pure.
 *
 * 🔴 THE bbox STRUCT IS THE PUSHDOWN PREDICATE ONLY. It prunes 10.4 GB of zstd Parquet to a
 * handful of row groups (9.5 s measured), but it is float32-rounded: 98,834 of 98,960 rows
 * differ from the geometry by up to 1.53e-5° lon (≈1.7 m). The STORED coordinate is
 * `ST_X/ST_Y(geometry)`. 1.7 m is irrelevant to a 25 km gate and visible in a "12 m apart" chip.
 *
 * 🔴 The legacy `categories` struct is removed in the September 2026 release (2026-09-23.0).
 * `basic_category` is the only category input, which makes this script release-agnostic.
 *
 * 🔴 THE ORG CONTEXT IS PER TRANSACTION. `app.current_org_id()` reads `request.jwt.claims` and
 * nothing else, and `app.emit_event` raises 42501 'emit_event: no current org' when it is null.
 * An owner connection sets no claims; `resolveEtlOrg` installs them. Both it and `setEtlActor`
 * are `set_config(..., true)` — transaction-LOCAL, dying at COMMIT — so `inEtlTransaction`
 * below calls BOTH at the top of EVERY transaction: the run start, each ~500-row batch, the
 * finish, and the failure record. Calling either once at startup would leave every later batch
 * orgless and the run would die at `finishRun()`, ~57,000 rows in.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import {
  DuckDBInstance,
  DuckDBListValue,
  DuckDBStructValue,
  type DuckDBConnection,
  type DuckDBValue,
} from '@duckdb/node-api';
import {
  isSkipped,
  OVERTURE_RGV_BBOX,
  overtureRowToSourceRecord,
  type OvertureSkipReason,
  type OvertureSourceRecord,
} from '../src/lib/overture/transform';
import { resolveEtlOrg, setEtlActor, type EtlExecutor } from '../src/lib/ingest/etl-actor';
import { upsertBusinessFromSource, upsertSourceRecord } from '../src/lib/ingest/upsert';
import {
  countGone,
  emptyTally,
  finishRun,
  recordOutcome,
  startRun,
} from '../src/lib/ingest/run-report';

loadEnv({ path: '.env.local', override: false, quiet: true });

// ---------------------------------------------------------------------------------------
// Constants. The bucket and region are module constants; the release string is the ONLY
// caller-influenced part of any URL in this phase (T-3-05).
// ---------------------------------------------------------------------------------------

const BUCKET_RELEASES = 's3://overturemaps-us-west-2/release/';
const S3_REGION = 'us-west-2';

/** Validated BEFORE it is interpolated into the S3 path (T-3-05). */
const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

const BATCH_SIZE = 500;
const SCRIPT = 'scripts/ingest-overture.ts';

// ---------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------

interface Args {
  release: string | null;
  org: string | null;
  target: 'test' | 'prod';
  sample: string | null;
}

function argValue(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

export function parseArgs(argv: string[]): Args {
  const target = argValue(argv, 'target') ?? 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error(`${SCRIPT}: unknown target ${target} (test | prod)`);
  }
  const release = argValue(argv, 'release');
  if (release !== null && !RELEASE_PATTERN.test(release)) {
    throw new Error(
      `${SCRIPT}: --release=${JSON.stringify(release)} is not a release string ` +
        '(YYYY-MM-DD.N, e.g. 2026-08-19.0). It is interpolated into an S3 path, so nothing ' +
        'else is accepted.',
    );
  }
  const sample = argValue(argv, 'sample');
  if (sample !== null && !sample.endsWith('.json')) {
    throw new Error(`${SCRIPT}: --sample must name a .json file (got ${sample})`);
  }
  return { release, org: argValue(argv, 'org'), target, sample };
}

/**
 * The target gate. Copied in shape from scripts/seed.ts, deliberately rather than imported:
 * importing seed.ts's module would pull its loader, and the messages match so a refusal reads
 * the same from either script.
 */
function resolveTargetUrl(target: 'test' | 'prod'): string {
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url) throw new Error(`${SCRIPT}: ${varName} is not set. See docs/local-postgres.md.`);
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error(`${SCRIPT}: --target=test refuses a Supabase host. D-04.`);
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error(`${SCRIPT}: --target=prod expects the Supabase session pooler URL.`);
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      `${SCRIPT}: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the desk-script path.`,
    );
  }
  return url;
}

// ---------------------------------------------------------------------------------------
// DuckDB
// ---------------------------------------------------------------------------------------

async function openDuckDb(): Promise<DuckDBConnection> {
  // Measured: threads 4 / 6 GB is comfortable and peaks near 1 GB. Do NOT raise threads past
  // the physical core count — S3 range reads are the bottleneck, not CPU (T-3-12).
  const instance = await DuckDBInstance.create(':memory:', { threads: '4', memory_limit: '6GB' });
  const c = await instance.connect();
  await c.run('install httpfs; load httpfs;');
  await c.run('install spatial; load spatial;'); // only for ST_X / ST_Y
  await c.run(`set s3_region='${S3_REGION}';`);
  return c;
}

/** Every release prefix present in the bucket right now. Listing only: no data is read. */
async function listReleases(c: DuckDBConnection): Promise<string[]> {
  const reader = await c.runAndReadAll(
    `select distinct regexp_extract(file, 'release/([^/]+)/', 1) as release
       from glob('${BUCKET_RELEASES}*/theme=places/type=place/*')
      order by 1`,
  );
  return reader
    .getRowObjectsJson()
    .map((r) => String(r.release))
    .filter((r) => RELEASE_PATTERN.test(r));
}

function placesPath(release: string): string {
  // Re-checked here as well: this function is the interpolation point.
  if (!RELEASE_PATTERN.test(release)) throw new Error(`${SCRIPT}: refusing release ${release}`);
  return `${BUCKET_RELEASES}${release}/theme=places/type=place/*`;
}

/**
 * The select list, exactly as the transform's zod schema reads it. `withBbox` adds the bbox
 * struct for the FIXTURE only, so `geometry not bbox` can prove the two differ; the ingest
 * never selects it.
 */
function placesSelect(release: string, withBbox: boolean): string {
  const b = OVERTURE_RGV_BBOX;
  return `
    select
      id,
      names.primary            as name_primary,
      basic_category,
      taxonomy.primary         as taxonomy_primary,
      confidence,
      operating_status,
      coalesce(websites, [])   as websites,
      coalesce(socials,  [])   as socials,
      coalesce(phones,   [])   as phones,
      coalesce(emails,   [])   as emails,
      addresses[1].freeform    as street,
      addresses[1].locality    as locality,
      addresses[1].postcode    as postcode,
      addresses[1].region      as region,
      addresses[1].country     as country,
      ST_X(geometry)           as lon,
      ST_Y(geometry)           as lat,
      version${withBbox ? ',\n      bbox' : ''}
    from read_parquet('${placesPath(release)}', hive_partitioning=1)
    where bbox.xmin between ${b.xmin} and ${b.xmax}
      and bbox.ymin between ${b.ymin} and ${b.ymax}`;
}

// ---------------------------------------------------------------------------------------
// The ingest
// ---------------------------------------------------------------------------------------

function asExecutor(c: Client): EtlExecutor {
  return {
    async query<R>(text: string, params?: unknown[]) {
      const r = await c.query(text, params);
      return { rows: r.rows as R[] };
    },
  };
}

/**
 * One transaction with the ETL identity installed: `setEtlActor` AND `resolveEtlOrg`, both,
 * first, every time. See the header — both GUCs die at COMMIT.
 */
async function inEtlTransaction<T>(
  c: Client,
  clerkOrgId: string,
  fn: (x: EtlExecutor, orgId: string) => Promise<T>,
): Promise<T> {
  await c.query('begin');
  try {
    const x = asExecutor(c);
    await setEtlActor(x, 'ingest-overture');
    const orgId = await resolveEtlOrg(x, clerkOrgId);
    const out = await fn(x, orgId);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  }
}

/** D-04: rows per 0.1 confidence band, in the 03-RESEARCH table's labels. */
function confidenceBand(c: number | null): string {
  if (c === null) return 'null';
  if (c >= 1) return '=1.0';
  const lo = Math.min(9, Math.max(0, Math.floor(c * 10)));
  return `${(lo / 10).toFixed(1)}-${((lo + 1) / 10).toFixed(1)}`;
}

interface IngestStats {
  release: string;
  bbox: typeof OVERTURE_RGV_BBOX;
  rows_read: number;
  texas_side: number;
  skipped: Record<OvertureSkipReason, number>;
  confidence_bands: Record<string, number>;
  permanently_closed: number;
  basic_category_null: number;
  mapped_rows: number;
  unmapped_rows: number;
  /** Every non-NULL basic_category with no map row, with counts. Reported, never guessed. */
  unmapped_basic_category: Array<{ basic_category: string; rows: number }>;
}

async function readCategoryMap(x: EtlExecutor, orgId: string): Promise<Map<string, string>> {
  // Built-ins (org_id IS NULL) first, then this org's own rows, so an org override wins.
  const { rows } = await x.query<{ basic_category: string; cluster_key: string }>(
    `select basic_category, cluster_key from overture_category_map
      where org_id is null or org_id = $1
      order by (org_id is not null), basic_category`,
    [orgId],
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.basic_category, r.cluster_key);
  if (map.size === 0) {
    throw new Error(
      `${SCRIPT}: overture_category_map has no rows. Run db:seed first — without the map every ` +
        'row would land untagged and the funnel would see none of them (D-02).',
    );
  }
  return map;
}

function buildStats(
  release: string,
  rowsRead: number,
  records: OvertureSourceRecord[],
  skipped: Record<OvertureSkipReason, number>,
  categoryMap: Map<string, string>,
): IngestStats {
  const bands: Record<string, number> = {};
  const unmapped = new Map<string, number>();
  let closed = 0;
  let nullCategory = 0;
  let mapped = 0;
  for (const r of records) {
    const band = confidenceBand(r.derived.confidence ?? null);
    bands[band] = (bands[band] ?? 0) + 1;
    if (r.derived.operatingStatus === 'permanently_closed') closed += 1;
    const cat = r.derived.basicCategory ?? null;
    if (cat === null) nullCategory += 1;
    else if (categoryMap.has(cat)) mapped += 1;
    else unmapped.set(cat, (unmapped.get(cat) ?? 0) + 1);
  }
  return {
    release,
    bbox: OVERTURE_RGV_BBOX,
    rows_read: rowsRead,
    texas_side: records.length,
    skipped,
    confidence_bands: bands,
    permanently_closed: closed,
    basic_category_null: nullCategory,
    mapped_rows: mapped,
    unmapped_rows: records.length - mapped - nullCategory,
    unmapped_basic_category: [...unmapped.entries()]
      .map(([basic_category, rows]) => ({ basic_category, rows }))
      .sort((a, b) => b.rows - a.rows || a.basic_category.localeCompare(b.basic_category)),
  };
}

async function ingest(duck: DuckDBConnection, release: string, clerkOrgId: string, target: 'test' | 'prod') {
  const t0 = Date.now();
  const reader = await duck.runAndReadAll(placesSelect(release, false));
  // getRowObjects(), NOT the JSON-converting accessor: lists arrive as `{ items }`, the shape
  // the transform and the committed fixture both carry.
  const raw: Record<string, DuckDBValue>[] = reader.getRowObjects();
  console.log(`${SCRIPT}: read ${raw.length} rows from ${release} in ${Date.now() - t0} ms`);

  // Transform everything BEFORE a single write, so a schema drift aborts cleanly instead of
  // leaving half a release in the spine.
  const skipped: Record<OvertureSkipReason, number> = { not_texas: 0, no_name: 0, malformed: 0 };
  const malformedIds: string[] = [];
  const records: OvertureSourceRecord[] = [];
  for (const row of raw) {
    const r = overtureRowToSourceRecord(row, release);
    if (isSkipped(r)) {
      skipped[r.skipped] += 1;
      if (r.skipped === 'malformed' && malformedIds.length < 5) malformedIds.push(r.id ?? '?');
    } else {
      records.push(r);
    }
  }
  if (skipped.malformed > 0) {
    throw new Error(
      `${SCRIPT}: ${skipped.malformed} rows do not match the transform's schema ` +
        `(first ids: ${malformedIds.join(', ')}). The Parquet schema moved; nothing was written.`,
    );
  }
  console.log(
    `${SCRIPT}: texas side ${records.length}, skipped not_texas ${skipped.not_texas}, ` +
      `no_name ${skipped.no_name}`,
  );

  const c = new Client({ connectionString: resolveTargetUrl(target), connectionTimeoutMillis: 10000 });
  await c.connect();
  let runId: string | null = null;
  try {
    console.log(`${SCRIPT}: target=${target} org=${clerkOrgId}`);
    const started = await inEtlTransaction(c, clerkOrgId, async (x, orgId) => {
      const categoryMap = await readCategoryMap(x, orgId);
      const run = await startRun(x, {
        orgId,
        sourceKey: 'overture',
        datasetId: 'theme=places/type=place',
        sourceVersion: release,
      });
      return { run, orgId, categoryMap };
    });
    runId = started.run.id;
    const { run, categoryMap } = started;

    const tally = emptyTally();
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await inEtlTransaction(c, clerkOrgId, async (x, orgId) => {
        for (const rec of batch) {
          const sr = await upsertSourceRecord(x, {
            orgId,
            sourceKey: rec.sourceKey,
            externalId: rec.externalId,
            payload: { ...rec.payload },
            sourceVersion: rec.sourceVersion,
            seenAt: run.startedAt,
          });
          recordOutcome(tally, sr);
          const cat = rec.derived.basicCategory ?? null;
          await upsertBusinessFromSource(
            x,
            sr.id,
            { ...rec.derived, clusterKey: cat === null ? null : (categoryMap.get(cat) ?? null) },
            { orgId, changed: sr.changed },
          );
        }
      });
      console.log(`${SCRIPT}: ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length}`);
    }

    const stats = buildStats(release, raw.length, records, skipped, categoryMap);
    const report = await inEtlTransaction(c, clerkOrgId, async (x, orgId) => {
      const gone = await countGone(x, { orgId, sourceKey: 'overture', runStartedAt: run.startedAt });
      const r = { status: 'complete' as const, ...tally, gone, stats: { ...stats } };
      await finishRun(x, run.id, r);
      return r;
    });
    console.log(
      `${SCRIPT}: complete — added ${report.added}, changed ${report.changed}, ` +
        `unchanged ${report.unchanged}, gone ${report.gone}, seen ${report.totalSeen}, ` +
        `release ${release}, ${Math.round((Date.now() - t0) / 1000)} s`,
    );
    console.log(
      `${SCRIPT}: permanently_closed ${stats.permanently_closed}, basic_category NULL ` +
        `${stats.basic_category_null}, unmapped ${stats.unmapped_rows} rows in ` +
        `${stats.unmapped_basic_category.length} basic_category values`,
    );
  } catch (e) {
    if (runId !== null) {
      const failedRunId = runId;
      await inEtlTransaction(c, clerkOrgId, async (x) => {
        await finishRun(x, failedRunId, {
          status: 'failed',
          ...emptyTally(),
          gone: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }).catch((inner) => console.error(`${SCRIPT}: could not record the failure:`, inner));
    }
    throw e;
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------------------
// --sample: the committed CI fixture
// ---------------------------------------------------------------------------------------

/**
 * The branches the fixture must cover, in output order. Each is a deterministic selection
 * (`order by md5(id)`, stable across DuckDB versions) over the materialised bbox table.
 * `required` groups abort the cut when empty: a fixture silently missing its one
 * `country='MX' AND region='TX'` row would leave M23 undetectable.
 */
const TX = `country = 'US' and region = 'TX'`;
const DIGITS10 = `right(regexp_replace(phones[1], '[^0-9]', '', 'g'), 10)`;
const SAMPLE_GROUPS: ReadonlyArray<{ why: string; where: string; limit: number; required: boolean }> = [
  {
    why: 'all_fields',
    where: `${TX} and name_primary is not null and basic_category is not null
            and taxonomy_primary is not null and confidence is not null and operating_status = 'open'
            and len(websites) > 0 and len(socials) > 0 and len(phones) > 0 and len(emails) > 0
            and street is not null and locality is not null and postcode is not null`,
    limit: 4,
    required: true,
  },
  { why: 'basic_category_null', where: `${TX} and basic_category is null`, limit: 4, required: true },
  { why: 'permanently_closed', where: `${TX} and operating_status = 'permanently_closed'`, limit: 4, required: true },
  { why: 'no_phone', where: `${TX} and len(phones) = 0`, limit: 4, required: true },
  { why: 'phone_e164', where: `${TX} and regexp_full_match(phones[1], '\\+1[0-9]{10}')`, limit: 3, required: true },
  { why: 'phone_bare10', where: `${TX} and regexp_full_match(phones[1], '[0-9]{10}')`, limit: 3, required: true },
  { why: 'phone_bare11', where: `${TX} and regexp_full_match(phones[1], '[0-9]{11}')`, limit: 3, required: true },
  {
    why: 'phone_other',
    where: `${TX} and len(phones) > 0 and not regexp_full_match(phones[1], '\\+1[0-9]{10}|[0-9]{10,11}')`,
    limit: 5,
    required: true,
  },
  {
    why: 'toll_free_shared',
    where: `${TX} and len(phones) > 0 and ${DIGITS10} = (
              select ${DIGITS10} as d from rgv
               where ${TX} and len(phones) > 0
                 and substr(${DIGITS10}, 1, 3) in ('800','833','844','855','866','877','888')
               group by d order by count(*) desc, d limit 1)`,
    limit: 4,
    required: true,
  },
  {
    why: 'junk_postcode',
    where: `${TX} and postcode is not null and not regexp_full_match(postcode, '[0-9]{5}(-?[0-9]{4})?')`,
    limit: 4,
    required: true,
  },
  { why: 'mx_region_tx', where: `country = 'MX' and region = 'TX'`, limit: 10, required: true },
  { why: 'mx_reynosa', where: `country = 'MX' and locality = 'Reynosa'`, limit: 6, required: true },
  {
    why: 'mx_matamoros',
    where: `country = 'MX' and locality in ('Matamoros', 'Heroica Matamoros')`,
    limit: 6,
    required: true,
  },
  { why: 'mx_rio_bravo', where: `country = 'MX' and locality in ('Río Bravo', 'Rio Bravo')`, limit: 5, required: true },
  {
    why: 'mx_other_region',
    where: `country = 'MX' and region is not null and region not in ('TX', '')`,
    limit: 4,
    required: false,
  },
  { why: 'us_region_missing', where: `country = 'US' and (region is null or region = '')`, limit: 4, required: true },
  { why: 'us_other_state', where: `country = 'US' and region not in ('TX', '')`, limit: 2, required: false },
  { why: 'no_name', where: `name_primary is null or trim(name_primary) = ''`, limit: 2, required: false },
  // Texas-side filler: ordinary rows, so the positive controls have volume.
  { why: 'texas_filler', where: TX, limit: 125, required: true },
];

/**
 * Substrings `tests/unit/no-network.test.ts` treats as a live data host. The fixture lives
 * under tests/, so a row whose website happens to contain one (e.g. `tacos3.com` contains
 * `s3.`) would red that gate. Such rows are skipped at the cut, deterministically.
 */
const NO_NETWORK_HOSTS = ['data.texas.gov', 'overturemaps', 's3.', 'geocoding.geo.census.gov'];

type FixtureJson = null | string | number | boolean | FixtureJson[] | { [k: string]: FixtureJson };

/**
 * DuckDB value → the fixture's JSON. 🔴 A list is written as `{ "items": [...] }` ON PURPOSE:
 * that is the node-api shape the transform must read, and freezing it is what lets
 * `duckdb list shape` fail a bare-array read. A struct (the bbox, fixture-only) becomes a
 * plain object.
 */
function fixtureValue(v: DuckDBValue): FixtureJson {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof DuckDBListValue) return { items: v.items.map(fixtureValue) };
  if (v instanceof DuckDBStructValue) {
    const out: Record<string, FixtureJson> = {};
    for (const [k, inner] of Object.entries(v.entries)) out[k] = fixtureValue(inner);
    return out;
  }
  throw new Error(`${SCRIPT}: unexpected DuckDB value in the fixture: ${String(v)}`);
}

async function cutSample(duck: DuckDBConnection, release: string, path: string): Promise<void> {
  const t0 = Date.now();
  await duck.run(`create table rgv as ${placesSelect(release, true)}`);
  console.log(`${SCRIPT}: materialised the bbox in ${Date.now() - t0} ms`);

  const seen = new Set<string>();
  const rows: Array<Record<string, FixtureJson>> = [];
  const perGroup: Record<string, number> = {};
  for (const g of SAMPLE_GROUPS) {
    // Over-select, then drop host-bearing rows and rows an earlier group already took.
    const reader = await duck.runAndReadAll(
      `select * from rgv where ${g.where} order by md5(id) limit ${g.limit * 3 + 10}`,
    );
    let taken = 0;
    for (const raw of reader.getRowObjects()) {
      if (taken >= g.limit) break;
      const row: Record<string, FixtureJson> = { _why: g.why };
      for (const [k, v] of Object.entries(raw)) row[k] = fixtureValue(v);
      const id = String(row.id);
      const text = JSON.stringify(row).toLowerCase();
      if (seen.has(id) || NO_NETWORK_HOSTS.some((h) => text.includes(h))) continue;
      seen.add(id);
      rows.push(row);
      taken += 1;
    }
    perGroup[g.why] = taken;
    if (g.required && taken === 0) {
      throw new Error(`${SCRIPT}: the fixture group ${g.why} selected no row in ${release}`);
    }
  }

  const meta = {
    _meta: {
      description:
        'Real Overture places rows, frozen as the DuckDB node-api getRowObjects() output ' +
        '(VARCHAR[] as {"items": [...]}), plus the fixture-only bbox struct. Drives ' +
        'tests/unit/overture-transform.test.ts with no DuckDB and no network.',
      release,
      theme: 'places/place',
      bbox: OVERTURE_RGV_BBOX,
      rowCount: rows.length,
      perBranch: perGroup,
      cutDate: new Date().toISOString().slice(0, 10),
      cutBy: `tsx ${SCRIPT} --release=${release} --sample=<this file>`,
      license: 'CDLA-Permissive-2.0 (Overture Maps Foundation)',
    },
  };
  const body =
    '[\n' +
    JSON.stringify(meta, null, 2)
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n') +
    ',\n' +
    rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') +
    '\n]\n';
  writeFileSync(resolve(path), body, 'utf8');
  console.log(`${SCRIPT}: wrote ${rows.length} rows to ${path}`);
  console.log(JSON.stringify(perGroup));
}

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // T-3-01: an ingest names its org. Never "the only org". (A --sample cut touches no DB.)
  if (args.sample === null && (args.org === null || args.org.trim() === '')) {
    throw new Error(`${SCRIPT}: --org=<clerk_org_id> is required. The ETL never picks an org.`);
  }

  const duck = await openDuckDb();
  const releases = await listReleases(duck);
  if (args.release === null) {
    throw new Error(
      `${SCRIPT}: --release is required and is never guessed. Releases in the bucket now: ` +
        (releases.length > 0 ? releases.join(', ') : '(none found)'),
    );
  }
  if (!releases.includes(args.release)) {
    throw new Error(
      `${SCRIPT}: release ${args.release} is not in the bucket (it keeps one). ` +
        `Present: ${releases.join(', ') || '(none found)'}`,
    );
  }

  if (args.sample !== null) {
    await cutSample(duck, args.release, args.sample);
    return;
  }
  await ingest(duck, args.release, args.org as string, args.target);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
