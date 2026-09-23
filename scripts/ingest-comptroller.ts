/**
 * The Texas Comptroller desk ingest (DATA-01, D-01, D-03, D-08).
 *
 *   pnpm ingest:comptroller --org=<clerk_org_id> [--target=test|prod] [--limit=N]
 *   (= tsx scripts/ingest-comptroller.ts ...)
 *
 * 🔴 A DESK SCRIPT (D-01). Nothing in the app calls Socrata or the Census geocoder; this
 * file is the only caller. It connects as the migration OWNER, like `scripts/seed.ts`, and
 * writes into ONE org, named EXPLICITLY by `clerk_org_id` — never "the only org", which is a
 * bug that appears exactly once, the day a second org exists (T-3-01).
 *
 * WHAT ONE RUN WRITES — one `ingest_runs` row per `/sources` row it owns:
 *
 *   1. `tx_comptroller` (`jrea-zgmq`): the active sales-tax permits of the four RGV counties.
 *      Measured: 34,928 rows in ONE 50,000-row request, 2,550 ms.
 *
 * Every pass goes through the shared, idempotent write path (`src/lib/ingest/`, 03-09): a
 * source record per row, a business per source record gated on the payload-hash diff, and a
 * run report persisted — not printed — so `/sources` can render it (D-06).
 *
 * 🔴 THE ETL ORG CONTEXT IS PER TRANSACTION. `app.current_org_id()` reads
 * `request.jwt.claims` and nothing else, and `app.emit_event` raises
 * `42501 emit_event: no current org` when it is null. An owner connection carries no claims,
 * so `etlTransactions` below runs `setEtlActor` then `resolveEtlOrg` as the first two
 * statements of EVERY transaction it opens. Both are `set_config(..., true)` —
 * transaction-LOCAL, dead at COMMIT — so calling them once at startup would work for exactly
 * one batch and then die at `finishRun()`, ~35,000 rows in.
 *
 * 🔴 DRIZZLE/PG TRAPS THIS FILE AVOIDS: nothing binds a JS `Date` (every instant is
 * `toISOString()` + `::timestamptz`, inside the shared helpers), and no JS array is
 * interpolated into statement text.
 *
 * Importable without side effects: `tests/unit/ingest-comptroller.test.ts` imports the
 * argument gate and the fetch/transform functions, and `main()` runs only when this file is
 * the process entry point (the same guard `scripts/seed.ts` uses).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import {
  resolveEtlOrg,
  setEtlActor,
  type EtlExecutor,
  type EtlScript,
} from '@/lib/ingest/etl-actor';
import {
  countGone,
  emptyTally,
  finishRun,
  recordOutcome,
  startRun,
  type IngestSourceKey,
  type RunTally,
  type StartedRun,
} from '@/lib/ingest/run-report';
import {
  upsertBusinessFromSource,
  upsertSourceRecord,
  type BusinessDerived,
} from '@/lib/ingest/upsert';
import { addressKey, nameNorm } from '@/lib/normalize';
import { paddedCountyCode, quote, socrataQuery, socrataRowsUpdatedAt } from '@/lib/socrata/client';
import {
  comptrollerRowToSourceRecord,
  PERMITS_DATASET,
  PERMITS_RGV_WHERE,
  permitRowSchema,
  type ClusterNaicsRanges,
  type PermitRow,
} from '@/lib/socrata/permits';
import type { ClustersFile, CountiesFile } from '../src/seed/types';

const SCRIPT: EtlScript = 'ingest-comptroller';

/** ~500 rows per transaction: a failure costs one batch, never 35,000 writes. */
export const INGEST_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------------------
// The argument gate. FIRST, before any I/O — no env file, no socket, no request.
// ---------------------------------------------------------------------------------------

/** T-3-01. Thrown when `--org` is absent or empty. Never recovered by picking an org. */
export class IngestOrgRequiredError extends Error {
  constructor() {
    super(
      'ingest-comptroller: --org=<clerk_org_id> is required. This script never defaults to ' +
        "'the only org' — that is a bug that appears once a second org exists.",
    );
    this.name = 'IngestOrgRequiredError';
  }
}

export interface IngestArgs {
  clerkOrgId: string;
  target: 'test' | 'prod';
  /** Ingest only the first N rows of each feed (a smoke run). Undefined = everything. */
  limit: number | undefined;
}

const KNOWN_FLAGS = ['--org=', '--target=', '--limit='] as const;

/**
 * Parses argv. Pure: reads nothing but its argument. An unknown flag is refused rather than
 * ignored, so a typo like `--orgs=...` fails here instead of reaching the org gate as "no
 * org" or, worse, being silently dropped.
 */
export function parseIngestArgs(argv: readonly string[]): IngestArgs {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.some((f) => arg.startsWith(f))) {
      throw new Error(
        `ingest-comptroller: unknown argument ${JSON.stringify(arg)} (expected ${KNOWN_FLAGS.join('… ')}…)`,
      );
    }
  }
  const value = (flag: string) => argv.find((a) => a.startsWith(flag))?.slice(flag.length);

  const clerkOrgId = value('--org=')?.trim() ?? '';
  if (clerkOrgId === '') throw new IngestOrgRequiredError();

  // `resolveSeedTarget`'s shape (scripts/seed.ts), copied rather than imported: that module
  // and scripts/db.ts are entry points with their own argv handling.
  const target = value('--target=') ?? 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('ingest-comptroller: unknown target ' + target + ' (test | prod)');
  }

  const rawLimit = value('--limit=');
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`ingest-comptroller: --limit must be a positive integer, got ${rawLimit}`);
    }
  }
  return { clerkOrgId, target, limit };
}

/**
 * The connection URL for a target — `resolveSeedTarget`'s checks, same messages. D-04: the
 * cloud project is production only, so a test target must never reach a Supabase host, and a
 * prod target must be the SESSION pooler (5432), never the transaction pooler.
 */
export function resolveIngestUrl(target: 'test' | 'prod'): string {
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url) {
    throw new Error('ingest-comptroller: ' + varName + ' is not set. See docs/local-postgres.md.');
  }
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error('ingest-comptroller: --target=test refuses a Supabase host. D-04.');
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error('ingest-comptroller: --target=prod expects the Supabase session pooler URL.');
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      'ingest-comptroller: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the desk-script path.',
    );
  }
  return url;
}

// ---------------------------------------------------------------------------------------
// Transactions: every one of them carries the ETL actor AND the org claim.
// ---------------------------------------------------------------------------------------

export interface EtlTx {
  tx: EtlExecutor;
  /** `orgs.id`, re-resolved from the clerk_org_id in THIS transaction. */
  orgId: string;
}

export interface EtlTransactions {
  run<T>(fn: (t: EtlTx) => Promise<T>): Promise<T>;
}

/**
 * Opens transactions on one owner connection. 🔴 The first two statements of EVERY
 * transaction are `setEtlActor` then `resolveEtlOrg`, in that order: both GUCs are
 * transaction-LOCAL, so each ~500-row batch, each `startRun` and each `finishRun` re-installs
 * them. Nothing here caches the claim across a COMMIT.
 *
 * `nested` swaps BEGIN/COMMIT for SAVEPOINT/RELEASE so a caller holding an outer transaction
 * (a smoke run it intends to roll back) can drive the same code. The desk run never sets it.
 */
export function etlTransactions(
  client: EtlExecutor,
  clerkOrgId: string,
  opts: { nested?: boolean } = {},
): EtlTransactions {
  let seq = 0;
  return {
    async run<T>(fn: (t: EtlTx) => Promise<T>): Promise<T> {
      seq += 1;
      const sp = `ingest_comptroller_${seq}`;
      await client.query(opts.nested ? `savepoint ${sp}` : 'begin');
      try {
        // Per transaction, in this order, never cached across a COMMIT:
        await setEtlActor(client, SCRIPT);
        const orgId = await resolveEtlOrg(client, clerkOrgId);
        const out = await fn({ tx: client, orgId });
        await client.query(opts.nested ? `release savepoint ${sp}` : 'commit');
        return out;
      } catch (e) {
        await client
          .query(opts.nested ? `rollback to savepoint ${sp}` : 'rollback')
          .catch(() => undefined);
        throw e;
      }
    },
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------------------
// The run lifecycle: start (own transaction) → body → gone + finish (own transaction).
// A failure is written as a `failed` run carrying the partial tally, then rethrown.
// ---------------------------------------------------------------------------------------

export interface RunOutcome {
  runId: string;
  status: 'complete' | 'failed';
  tally: RunTally;
  gone: number;
  stats: Record<string, unknown>;
  sourceVersion: string | null;
  wallMs: number;
}

interface RunSpec {
  sourceKey: IngestSourceKey;
  datasetId: string | null;
  sourceVersion: string | null;
}

async function withRun(
  db: EtlTransactions,
  spec: RunSpec,
  body: (run: StartedRun, tally: RunTally, stats: Record<string, unknown>) => Promise<void>,
  onFinished?: (t: EtlTx, runId: string) => Promise<void>,
): Promise<RunOutcome> {
  const t0 = Date.now();
  const run = await db.run(({ tx, orgId }) => startRun(tx, { orgId, ...spec }));
  const tally = emptyTally();
  const stats: Record<string, unknown> = {};
  try {
    await body(run, tally, stats);
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await db
      .run(({ tx }) =>
        finishRun(tx, run.id, {
          status: 'failed',
          ...tally,
          gone: 0,
          stats,
          error: error.slice(0, 2000),
        }),
      )
      .catch(() => undefined);
    throw e;
  }
  const gone = await db.run(async (t) => {
    const n = await countGone(t.tx, {
      orgId: t.orgId,
      sourceKey: spec.sourceKey,
      runStartedAt: run.startedAt,
    });
    await finishRun(t.tx, run.id, { status: 'complete', ...tally, gone: n, stats });
    if (onFinished) await onFinished(t, run.id);
    return n;
  });
  return {
    runId: run.id,
    status: 'complete',
    tally,
    gone,
    stats,
    sourceVersion: spec.sourceVersion,
    wallMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------------------
// Reference data: the seeded county codes, NAICS ranges and city spellings.
// ---------------------------------------------------------------------------------------

function readSeedFile<T>(name: string): T {
  const path = fileURLToPath(new URL(`../src/seed/data/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** The seeded clusters' half-open NAICS ranges — the same file `pnpm db:seed` loads. */
export function seededClusters(): ClusterNaicsRanges[] {
  return readSeedFile<ClustersFile>('clusters.json').clusters.map((c) => ({
    key: c.key,
    naicsRanges: c.naicsRanges,
  }));
}

/** Cameron, Hidalgo, Starr, Willacy as integers (31, 108, 214, 245), from the seed. */
export function seededRgvComptrollerCodes(): number[] {
  return readSeedFile<CountiesFile>('counties.json')
    .counties.filter((c) => c.isRgv)
    .map((c) => c.comptrollerCode)
    .sort((a, b) => a - b);
}

/**
 * `outlet_city` spelling → the seeded city `name`, per county: the Phase 2 ∥ 3 shared
 * contract (`cities.name_variants`, matched upper-case, displayed as `name`). Read from the
 * database's built-in rows, so the fold is exactly what the geo presets resolve against.
 */
export type CityFold = Map<string, string>;

export const cityFoldKey = (countyCode: number, outletCity: string) =>
  `${countyCode}|${outletCity.trim().replace(/\s+/g, ' ').toUpperCase()}`;

export async function loadCityFold(tx: EtlExecutor): Promise<CityFold> {
  const { rows } = await tx.query<{
    comptroller_code: number;
    name: string;
    name_variants: string[];
  }>(
    `select co.comptroller_code, ci.name, ci.name_variants
       from cities ci join counties co on co.id = ci.county_id
      where ci.org_id is null and co.org_id is null`,
  );
  const fold: CityFold = new Map();
  for (const r of rows) {
    for (const v of [r.name, ...r.name_variants])
      fold.set(cityFoldKey(r.comptroller_code, v), r.name);
  }
  return fold;
}

// ---------------------------------------------------------------------------------------
// The permits feed: fetch → validate → transform.
// ---------------------------------------------------------------------------------------

/**
 * The whole-RGV `$where`, built from the SEEDED county codes through `quote()` and
 * `paddedCountyCode()` — `jrea-zgmq`'s county column is zero-padded text ('031'). Checked
 * against the permits module's own literal so the two can never disagree.
 */
export function permitsWhere(codes: readonly number[] = seededRgvComptrollerCodes()): string {
  const where = `outlet_county_code in (${codes.map((c) => quote(paddedCountyCode(c))).join(',')})`;
  if (where !== PERMITS_RGV_WHERE) {
    throw new Error(
      `ingest-comptroller: permits $where ${where} drifted from ${PERMITS_RGV_WHERE}`,
    );
  }
  return where;
}

/**
 * 🔴 `$order=taxpayer_number,outlet_number` is MANDATORY: without an order Socrata gives no
 * stability guarantee across `$offset` pages. `$limit=50000` is the measured one-page size.
 */
export function permitsQuery(where: string = permitsWhere()): Record<string, string> {
  return { $where: where, $order: 'taxpayer_number,outlet_number', $limit: '50000' };
}

export interface Rejected {
  count: number;
  /** The first few, for the run's stats. Never the whole payload. */
  sample: Array<{ key: string; issue: string }>;
}

const emptyRejected = (): Rejected => ({ count: 0, sample: [] });

function reject(r: Rejected, key: string, issue: string): void {
  r.count += 1;
  if (r.sample.length < 10) r.sample.push({ key, issue: issue.slice(0, 200) });
}

export interface FetchedPermits {
  /** `rowsUpdatedAt` as ISO — stored on the run AND on every source record. */
  sourceVersion: string;
  rows: PermitRow[];
  rejected: Rejected;
}

/**
 * One `jrea-zgmq` request (paged by the client), every row through `permitRowSchema`
 * (T-3-03). A row that fails validation is counted and sampled into the run's stats rather
 * than aborting a 35,000-row run over one malformed record.
 *
 * `query` defaults to the whole-RGV request; the unit tests pass the recorded one.
 */
export async function fetchPermits(
  query: Record<string, string> = permitsQuery(),
): Promise<FetchedPermits> {
  const sourceVersion = await socrataRowsUpdatedAt(PERMITS_DATASET);
  const raw = await socrataQuery<Record<string, unknown>>(PERMITS_DATASET, query);
  const rows: PermitRow[] = [];
  const rejected = emptyRejected();
  for (const r of raw) {
    const parsed = permitRowSchema.safeParse(r);
    if (parsed.success) rows.push(parsed.data);
    else
      reject(
        rejected,
        `${String(r.taxpayer_number)}-${String(r.outlet_number)}`,
        parsed.error.message,
      );
  }
  return { sourceVersion, rows, rejected };
}

export interface PermitIngest {
  externalId: string;
  sourceVersion: string;
  payload: PermitRow;
  derived: BusinessDerived;
  /** What the Census batch geocode is fed (Task 2): the OUTLET address, never the mailing one. */
  geocodeInput: { street: string | null; city: string | null; zip: string | null };
  unmappedNaics: boolean;
  cityFolded: boolean;
}

/**
 * One validated permit row → the source record input plus its business's derived columns.
 * Pure. `outlet_address` is the location; the taxpayer's mailing address is stripped by the
 * schema and never read (PITFALLS). An unmapped NAICS leaves `cluster_key` NULL: the row stays
 * in the spine and never enters the funnel (D-02).
 */
export function permitToIngest(
  row: PermitRow,
  sourceVersion: string,
  clusters: ClusterNaicsRanges[],
  cityFold: CityFold,
): PermitIngest {
  const rec = comptrollerRowToSourceRecord(row, sourceVersion, clusters);
  const addr = addressKey(row.outlet_address, row.outlet_zip_code);
  const folded =
    row.outlet_city === undefined
      ? undefined
      : cityFold.get(cityFoldKey(rec.countyCode, row.outlet_city));
  return {
    externalId: rec.externalId,
    sourceVersion: rec.sourceVersion,
    payload: rec.payload,
    derived: {
      displayName: rec.legalName,
      legalName: rec.legalName,
      primarySource: 'tx_comptroller',
      comptrollerKey: rec.externalId,
      nameNorm: nameNorm(row.outlet_name),
      city: folded ?? rec.city,
      street: rec.street,
      streetNum: addr.streetNum,
      streetNorm: addr.streetNorm,
      unit: addr.unit,
      postal: addr.postal,
      clusterKey: rec.clusterKey,
      // lat/lng deliberately UNDEFINED: a re-ingest of a changed permit must not null the
      // location the Census pass wrote (upsert.ts: undefined = not written).
    },
    geocodeInput: { street: rec.street, city: rec.city, zip: rec.postal },
    unmappedNaics: rec.clusterKey === null,
    cityFolded: folded !== undefined,
  };
}

// ---------------------------------------------------------------------------------------
// Pass 1: permits → tx_comptroller
// ---------------------------------------------------------------------------------------

export interface PermitWritten {
  externalId: string;
  businessId: string;
  geocodeInput: PermitIngest['geocodeInput'];
}

export async function runPermitsPass(
  db: EtlTransactions,
  fetched: { sourceVersion: string; records: PermitIngest[]; rejected: Rejected },
): Promise<{ outcome: RunOutcome; written: PermitWritten[] }> {
  const written: PermitWritten[] = [];
  const outcome = await withRun(
    db,
    {
      sourceKey: 'tx_comptroller',
      datasetId: PERMITS_DATASET,
      sourceVersion: fetched.sourceVersion,
    },
    async (run, tally, stats) => {
      let businessesInserted = 0;
      let businessesUpdated = 0;
      stats.rejected_rows = fetched.rejected.count;
      if (fetched.rejected.count > 0) stats.rejected_sample = fetched.rejected.sample;
      stats.unmapped_naics = fetched.records.filter((r) => r.unmappedNaics).length;
      stats.city_unfolded = fetched.records.filter((r) => !r.cityFolded).length;

      for (const batch of chunks(fetched.records, INGEST_BATCH_SIZE)) {
        await db.run(async ({ tx, orgId }) => {
          for (const r of batch) {
            const sr = await upsertSourceRecord(tx, {
              orgId,
              sourceKey: 'tx_comptroller',
              externalId: r.externalId,
              payload: r.payload,
              sourceVersion: r.sourceVersion,
              seenAt: run.startedAt,
            });
            recordOutcome(tally, sr);
            const biz = await upsertBusinessFromSource(tx, sr.id, r.derived, {
              orgId,
              changed: sr.changed,
            });
            if (biz.inserted) businessesInserted += 1;
            else if (biz.wrote) businessesUpdated += 1;
            written.push({
              externalId: r.externalId,
              businessId: biz.businessId,
              geocodeInput: r.geocodeInput,
            });
          }
        });
      }
      stats.businesses_inserted = businessesInserted;
      stats.businesses_updated = businessesUpdated;
    },
  );
  return { outcome, written };
}

// ---------------------------------------------------------------------------------------
// The report: printed AND persisted (the persisted copy is the one D-06 requires).
// ---------------------------------------------------------------------------------------

function printRun(label: string, o: RunOutcome): void {
  const t = o.tally;
  console.log(
    `${label}: added ${t.added}, changed ${t.changed}, unchanged ${t.unchanged}, gone ${o.gone} ` +
      `(seen ${t.totalSeen}) · source version ${o.sourceVersion ?? '—'} · ${(o.wallMs / 1000).toFixed(1)} s · run ${o.runId}`,
  );
}

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. The gate. Throws before any I/O at all.
  const args = parseIngestArgs(process.argv.slice(2));

  loadEnv({ path: '.env.local', override: false, quiet: true });
  const url = resolveIngestUrl(args.target);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  const db = etlTransactions(client, args.clerkOrgId);
  const t0 = Date.now();
  try {
    console.log(
      `ingest-comptroller: target=${args.target} org=${args.clerkOrgId}${args.limit ? ` limit=${args.limit}` : ''}`,
    );

    // Fails fast on an unknown org, before a single request goes out.
    const cityFold = await db.run(({ tx }) => loadCityFold(tx));
    const clusters = seededClusters();

    const permits = await fetchPermits();
    const rows = args.limit === undefined ? permits.rows : permits.rows.slice(0, args.limit);
    const records = rows.map((r) => permitToIngest(r, permits.sourceVersion, clusters, cityFold));
    const { outcome } = await runPermitsPass(db, {
      sourceVersion: permits.sourceVersion,
      records,
      rejected: permits.rejected,
    });
    printRun('tx_comptroller (jrea-zgmq)', outcome);

    console.log(`ingest-comptroller: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await client.end();
  }
}

// Only when run as a script: the unit tests import the gate and the transforms above.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
