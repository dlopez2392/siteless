/**
 * The rederive pass (A-WR-06 and the normalizer-propagation half of review 03).
 *
 *   pnpm rederive --org=<clerk_org_id> [--target=test|prod] [--dry-run]
 *   (= tsx scripts/rederive.ts ...)
 *
 * 🔴 WHY IT EXISTS. Every derived column on `businesses` is a function of stored payloads PLUS
 * inputs that live outside them: the normalizers (name_norm, street_norm, phone blockability —
 * src/lib/normalize), the Overture phone pick, the seeded NAICS ranges and
 * `overture_category_map` (cluster_key), the city fold (city). The ingests' payload-hash gate
 * writes NOTHING for an unchanged payload (DATA-04 — it is what keeps a re-run at zero events),
 * so when one of those inputs changes, not even a full re-ingest carries the change to a stored
 * row. D-02 promises that adding a cluster is "a mapping change, not a re-ingest"; this pass is
 * how that promise is kept, and how a normalizer fix reaches the ~92k rows it changes.
 *
 * WHAT ONE PASS DOES, per batch of businesses, in its own transaction:
 *   1. OWN columns — the ones no merge owns — from the record that CREATED each business:
 *      `name_norm` (nameNorm of the Comptroller outlet_name / the Overture names.primary).
 *      Every business, merged-away losers included: an unmerge re-derives a loser's
 *      survivorship columns but never its name_norm, so it must already be current.
 *   2. SURVIVORSHIP columns for every cluster ROOT, from every member's parents through the
 *      one survive() a merge uses (src/lib/resolve/merge.ts `readParentsForRoots` +
 *      `survivorshipJson(..., { complete: true })`), written through
 *      `app.apply_survivorship_if_changed` (drizzle/0025), which writes a row only when its
 *      typed columns really differ. A single-record business is a cluster of one.
 * Both halves are WRITE-GATED, so a pass over a spine already up to date writes zero rows and
 * zero `businesses` events — `tests/db/rederive.test.ts` 'an up-to-date spine' pins it.
 *
 * 🔴 AFTER A PASS THAT CHANGED name_norm, RUN `pnpm resolve`: chain flags (chain_key IS a
 * name_norm), blocking and pending scores are all computed from name_norm, and the resolve
 * pass recomputes them. The report says how many name_norm values moved.
 *
 * `--dry-run` runs every batch and ROLLS IT BACK: the counts are what a real pass would write,
 * measured, not estimated. Always dry-run first on a real spine and read the counts.
 *
 * 🔴 THE ORG CONTEXT IS PER TRANSACTION, as in every desk script: `setEtlActor('rederive')` then
 * `resolveEtlOrg`, first, in every transaction. The parent read and the definer-side org check
 * both read `app.current_org_id()`. The run report is ONE event,
 * `app.emit_event('businesses', null, 'rederive', stats)`, attributed `etl:rederive`.
 *
 * Importable without side effects (tests/db/rederive.test.ts drives `runRederivePass` inside
 * `withRollback` through the `nested` transaction mode); `main()` runs only as the entry point.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { resolveEtlOrg, setEtlActor, type EtlExecutor } from '@/lib/ingest/etl-actor';
import { nameNorm } from '@/lib/normalize';
import {
  DERIVATION_VERSION,
  loadDerivationContext,
  type DerivationContext,
} from '@/lib/resolve/derivation';
import { readParentsForRoots, survivorshipJson } from '@/lib/resolve/merge';
import { survive } from '@/lib/resolve/survivorship';

// ---------------------------------------------------------------------------------------
// The argument gate. FIRST, before any I/O.
// ---------------------------------------------------------------------------------------

export class RederiveOrgRequiredError extends Error {
  constructor() {
    super(
      "rederive: --org=<clerk_org_id> is required. This script never defaults to 'the only " +
        "org' — that is a bug that appears once a second org exists (T-3-01).",
    );
    this.name = 'RederiveOrgRequiredError';
  }
}

export interface RederiveArgs {
  clerkOrgId: string;
  target: 'test' | 'prod';
  dryRun: boolean;
}

const KNOWN_FLAGS = ['--org=', '--target=', '--dry-run'] as const;

/** Pure. An unknown flag is refused rather than ignored (a typo must never become a real run). */
export function parseRederiveArgs(argv: readonly string[]): RederiveArgs {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.some((f) => (f.endsWith('=') ? arg.startsWith(f) : arg === f))) {
      throw new Error(
        `rederive: unknown argument ${JSON.stringify(arg)} (expected --org=… --target=… --dry-run)`,
      );
    }
  }
  const value = (flag: string) => argv.find((a) => a.startsWith(flag))?.slice(flag.length);
  const clerkOrgId = value('--org=')?.trim() ?? '';
  if (clerkOrgId === '') throw new RederiveOrgRequiredError();
  const target = value('--target=') ?? 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('rederive: unknown target ' + target + ' (test | prod)');
  }
  return { clerkOrgId, target, dryRun: argv.includes('--dry-run') };
}

/** `resolveSeedTarget`'s checks, the same shape as the other desk scripts. D-04. */
export function resolveRederiveUrl(target: 'test' | 'prod'): string {
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url) throw new Error('rederive: ' + varName + ' is not set. See docs/local-postgres.md.');
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error('rederive: --target=test refuses a Supabase host. D-04.');
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error('rederive: --target=prod expects the Supabase session pooler URL.');
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      'rederive: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the desk-script path.',
    );
  }
  return url;
}

// ---------------------------------------------------------------------------------------
// Transactions: every one carries the ETL actor AND the org claim.
// ---------------------------------------------------------------------------------------

export interface RederiveTx {
  tx: EtlExecutor;
  orgId: string;
}

export interface RederiveDb {
  readonly clerkOrgId: string;
  /** `commit: false` rolls the transaction back (the dry run). */
  run<T>(fn: (t: RederiveTx) => Promise<T>, opts?: { commit?: boolean }): Promise<T>;
}

/**
 * The ONE place this script opens a transaction; its first two statements are the actor GUC
 * and the org claim, both transaction-LOCAL. `nested` swaps BEGIN/COMMIT/ROLLBACK for
 * savepoints so a test holding an outer transaction drives the same code.
 */
export function rederiveTransactions(
  client: EtlExecutor,
  clerkOrgId: string,
  opts: { nested?: boolean } = {},
): RederiveDb {
  let seq = 0;
  return {
    clerkOrgId,
    async run<T>(fn: (t: RederiveTx) => Promise<T>, runOpts: { commit?: boolean } = {}) {
      seq += 1;
      const sp = `rederive_${seq}`;
      const commit = runOpts.commit !== false;
      await client.query(opts.nested ? `savepoint ${sp}` : 'begin');
      try {
        await setEtlActor(client, 'rederive');
        const orgId = await resolveEtlOrg(client, clerkOrgId);
        const out = await fn({ tx: client, orgId });
        if (commit) await client.query(opts.nested ? `release savepoint ${sp}` : 'commit');
        else await client.query(opts.nested ? `rollback to savepoint ${sp}` : 'rollback');
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

// ---------------------------------------------------------------------------------------
// One batch
// ---------------------------------------------------------------------------------------

/** Businesses per transaction. */
export const REDERIVE_BATCH = 500;

/** The first few re-derived roots, for the report. Never the whole list. */
const SAMPLE_LIMIT = 20;

/** A creating record's payload → the name_norm the ingest writes for it. */
export function ownNameNorm(sourceKey: string, payload: unknown): string | null | undefined {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (sourceKey === 'tx_comptroller') {
    return typeof p.outlet_name === 'string' ? nameNorm(p.outlet_name) : undefined;
  }
  if (sourceKey === 'overture') {
    return typeof p.name_primary === 'string' ? nameNorm(p.name_primary) : undefined;
  }
  return undefined;
}

interface BatchResult {
  nameNormWritten: number;
  survivorshipWritten: number;
  roots: number;
  changedRoots: string[];
}

async function rederiveBatch(
  tx: EtlExecutor,
  orgId: string,
  ids: ReadonlyArray<{ id: string; is_root: boolean }>,
  ctx: DerivationContext,
): Promise<BatchResult> {
  // 1. OWN columns: name_norm from the record that created each business.
  const { rows: creators } = await tx.query<{ id: string; source_key: string; payload: unknown }>(
    `select b.id, sr.source_key, sr.payload
       from businesses b
       join source_records sr
         on sr.business_id = b.id and sr.org_id = b.org_id
        and sr.source_key in ('tx_comptroller', 'overture')
      where b.org_id = $1::uuid
        and b.id in (select value::uuid from jsonb_array_elements_text($2::jsonb))`,
    [orgId, JSON.stringify(ids.map((r) => r.id))],
  );
  const own: Array<{ id: string; name_norm: string | null }> = [];
  for (const r of creators) {
    const n = ownNameNorm(r.source_key, r.payload);
    if (n !== undefined) own.push({ id: r.id, name_norm: n });
  }
  let nameNormWritten = 0;
  if (own.length > 0) {
    const { rows } = await tx.query<{ n: number }>(
      `with v as (
         select * from jsonb_to_recordset($2::jsonb) as v(id uuid, name_norm text)
       ), upd as (
         update businesses b set name_norm = v.name_norm
           from v
          where b.id = v.id and b.org_id = $1::uuid and b.name_norm is distinct from v.name_norm
         returning 1
       )
       select count(*)::int as n from upd`,
      [orgId, JSON.stringify(own)],
    );
    nameNormWritten = Number(rows[0]?.n ?? 0);
  }

  // 2. SURVIVORSHIP columns for every cluster root in the batch.
  const roots = ids.filter((r) => r.is_root).map((r) => r.id);
  const parents = await readParentsForRoots(tx, roots, ctx);
  const fields: Array<{ id: string; f: Record<string, unknown> }> = [];
  for (const root of roots) {
    const ps = parents.get(root) ?? [];
    if (ps.length === 0) continue; // nothing to derive from: leave it exactly as it is
    fields.push({ id: root, f: survivorshipJson(survive(ps), ps.length, { complete: true }) });
  }
  const changedRoots: string[] = [];
  if (fields.length > 0) {
    const { rows } = await tx.query<{ id: string; wrote: boolean }>(
      `select r.id::text as id,
              app.apply_survivorship_if_changed($1::uuid, r.id, r.f, 'rederive') as wrote
         from jsonb_to_recordset($2::jsonb) as r(id uuid, f jsonb)`,
      [orgId, JSON.stringify(fields)],
    );
    for (const r of rows) if (r.wrote === true) changedRoots.push(r.id);
  }
  return {
    nameNormWritten,
    survivorshipWritten: changedRoots.length,
    roots: roots.length,
    changedRoots,
  };
}

// ---------------------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------------------

export interface RederiveStats {
  [key: string]: unknown;
  derivation_version: number;
  dry_run: boolean;
  businesses: number;
  roots: number;
  name_norm_written: number;
  survivorship_written: number;
  /** Up to 20 root ids whose survivorship columns moved — for a human to open and check. */
  sample_changed: string[];
  ms: number;
}

export interface RederiveReport {
  orgId: string;
  eventId: string | null;
  stats: RederiveStats;
}

export async function runRederivePass(
  db: RederiveDb,
  opts: { dryRun?: boolean; batchSize?: number; log?: (line: string) => void } = {},
): Promise<RederiveReport> {
  const t0 = Date.now();
  const log = opts.log ?? (() => undefined);
  const dryRun = opts.dryRun === true;
  const batchSize = opts.batchSize ?? REDERIVE_BATCH;
  const { orgId, ctx } = await db.run(async ({ tx, orgId }) => ({
    orgId,
    ctx: await loadDerivationContext(tx),
  }));

  const stats: RederiveStats = {
    derivation_version: DERIVATION_VERSION,
    dry_run: dryRun,
    businesses: 0,
    roots: 0,
    name_norm_written: 0,
    survivorship_written: 0,
    sample_changed: [],
    ms: 0,
  };

  // Keyset paging by id: stable, and a batch's own writes cannot move the cursor.
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const done = await db.run(
      async ({ tx }) => {
        const { rows: ids } = await tx.query<{ id: string; is_root: boolean }>(
          `select id::text as id, merged_into_id is null as is_root
             from businesses
            where org_id = $1::uuid and id > $2::uuid
            order by id
            limit $3::int`,
          [orgId, after, batchSize],
        );
        if (ids.length === 0) return true;
        const r = await rederiveBatch(tx, orgId, ids, ctx);
        stats.businesses += ids.length;
        stats.roots += r.roots;
        stats.name_norm_written += r.nameNormWritten;
        stats.survivorship_written += r.survivorshipWritten;
        for (const id of r.changedRoots) {
          if (stats.sample_changed.length < SAMPLE_LIMIT) stats.sample_changed.push(id);
        }
        after = ids[ids.length - 1]!.id;
        log(
          `rederive: ${stats.businesses} businesses — name_norm ${stats.name_norm_written}, ` +
            `survivorship ${stats.survivorship_written}${dryRun ? ' (dry run, rolled back)' : ''}`,
        );
        return ids.length < batchSize;
      },
      { commit: !dryRun },
    );
    if (done) break;
  }
  stats.ms = Date.now() - t0;

  // The run report: one event, attributed etl:rederive. A dry run writes nothing at all.
  let eventId: string | null = null;
  if (!dryRun) {
    eventId = await db.run(async ({ tx }) => {
      const { rows } = await tx.query<{ id: string }>(
        "select app.emit_event('businesses', null, 'rederive', $1::jsonb)::text as id",
        [JSON.stringify(stats)],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('rederive: emit_event returned no id');
      return id;
    });
  }
  return { orgId, eventId, stats };
}

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseRederiveArgs(process.argv.slice(2));
  loadEnv({ path: '.env.local', override: false, quiet: true });
  const url = resolveRederiveUrl(args.target);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    console.log(
      `rederive: target=${args.target} org=${args.clerkOrgId} derivation v${DERIVATION_VERSION}` +
        (args.dryRun ? ' (dry run — every batch is rolled back)' : ''),
    );
    const report = await runRederivePass(rederiveTransactions(client, args.clerkOrgId), {
      dryRun: args.dryRun,
      log: (line) => console.log(line),
    });
    const s = report.stats;
    console.log(
      `rederive: done in ${(s.ms / 1000).toFixed(1)} s — ${s.businesses} businesses, ` +
        `${s.roots} roots; name_norm written ${s.name_norm_written}, survivorship written ` +
        `${s.survivorship_written}` +
        (report.eventId ? ` · report event ${report.eventId}` : ' · dry run, nothing written'),
    );
    if (s.sample_changed.length > 0) console.log(`  sample: ${s.sample_changed.join(', ')}`);
    if (!args.dryRun && s.name_norm_written > 0) {
      console.log('rederive: name_norm moved — run `pnpm resolve` to recompute chains, blocks and scores.');
    }
  } finally {
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
