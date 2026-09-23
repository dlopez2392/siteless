/**
 * The resolve pass (DEDUP-01, DEDUP-02): block → score → auto-merge → enqueue review.
 *
 *   pnpm resolve --org=<clerk_org_id> [--target=test|prod] [--dry-run]
 *   (= tsx scripts/resolve.ts ...)
 *
 * 🔴 A DESK SCRIPT, AND A MATERIALISED PASS — NEVER A LIVE QUERY. Candidate generation is ~2
 * minutes at RGV scale (03-RESEARCH: 29,701 pairs from B1 12,717 ∪ B2′ 14,357 ∪ B3 ≤5/row,
 * against 1.99 billion all-pairs). It runs here, once per pass, and writes `merge_candidates`.
 * The app never issues a blocking query: `/review` reads one indexed pending row.
 *
 * THE STAGES, each in its own transaction(s):
 *   0. preflight — `app.current_org_id()` is non-null and is the org `--org` names, BEFORE any
 *      stage runs. The stages take minutes and the merge loop writes; failing at second zero
 *      on a missing org claim beats failing after the blocker.
 *   1. chains — D-11's flag (src/lib/resolve/chain.ts), BEFORE blocking, so a flagged row is
 *      already flagged when it is scored.
 *   2. block — B1 (phone), B2′ (postal, street_num, gated), B3 (GIN lateral top-5), one
 *      transaction per shape, `on conflict do nothing` so the union is free. A block over
 *      MAX_BLOCK_PAIRS is refused whole and NAMED in `stats.skipped_blocks` (T-3-12).
 *   3. gate — D-10: pairs over 25 km become `distinct` before anything is scored.
 *   4. score — every pending candidate, both sides' columns plus `similarity()` FROM SQL, through
 *      the one committed scorer (src/lib/resolve/score.ts). Written back in batches.
 *   5. merge — `score >= 95`, descending, cluster-aware, chain-aware, distinct-aware, one
 *      transaction per candidate, through `mergePair` → `app.record_merge` (the only write path).
 *   80–94 stays `pending`: that IS the review queue. Below 80 stays pending too, under the
 *   queue's score floor.
 *
 * 🔴 THE ORG CONTEXT IS PER TRANSACTION. This script connects as the migration OWNER and sets
 * no Clerk claims. `app.record_merge` and `app.emit_event` both open with
 * `v_org := app.current_org_id()` and raise `42501` when it is null, and `app.current_org_id()`
 * reads `request.jwt.claims` and nothing else. `resolveTransactions` below is the ONE place a
 * transaction is opened, and its first two statements are the actor GUC and the org claim —
 * both transaction-LOCAL, dead at COMMIT, so they are re-installed for every stage transaction
 * and every per-candidate merge transaction. The claim carries `{o:{id}}` only, no `sub`, so
 * every merge is attributed `etl:resolve` (03-09, T-3-15).
 *
 * 🔴 THE RUN REPORT IS AN EVENT, NOT AN `ingest_runs` ROW. `ingest_runs.source_key` is CHECKed
 * (`ir_source_key_known`) to the four data sources, and `/sources` renders exactly those four
 * rows (D-17); a fifth would change that contract. The pass reports through
 * `app.emit_event('businesses', null, 'resolve', stats)` plus the printed summary. A persisted
 * resolve-run table, if one is ever wanted, is a new table with its own migration.
 *
 * 🔴 DRIVER TRAPS AVOIDED: raw `pg` with bound parameters only; no JS `Date` is bound; a batch
 * is ONE jsonb parameter unpacked with `jsonb_to_recordset`, never an interpolated JS array.
 *
 * Importable without side effects: `tests/db/resolve-pass.test.ts` drives the exported stages
 * inside `withRollback` (the `nested` transaction mode), and `main()` runs only when this file
 * is the process entry point (the same guard `scripts/ingest-comptroller.ts` uses). No
 * `server-only` import and no app DB client anywhere in the graph: this runs under `tsx`.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { resolveEtlOrg, setEtlActor, type EtlExecutor } from '@/lib/ingest/etl-actor';
import {
  addressBlockSql,
  phoneBlockSql,
  runBlock,
  runDistanceGate,
  trigramLateralSql,
  type BlockShape,
  type BlockStatement,
  type SkippedBlock,
} from '@/lib/resolve/block';
import { detectChains, type ChainDetectionResult } from '@/lib/resolve/chain';
import { mergePair } from '@/lib/resolve/merge';
import {
  AUTO_MERGE_SCORE,
  BLOCK_SIMILARITY_THRESHOLD,
  REVIEW_SCORE,
  score,
  type LocationMatchType,
  type Side,
} from '@/lib/resolve/score';
import { pgFailure } from '@/server/actions/_pg';

// ---------------------------------------------------------------------------------------
// The argument gate. FIRST, before any I/O.
// ---------------------------------------------------------------------------------------

/** T-3-01. Thrown when `--org` is absent or empty. Never recovered by picking an org. */
export class ResolveOrgRequiredError extends Error {
  constructor() {
    super(
      "resolve: --org=<clerk_org_id> is required. This script never defaults to 'the only " +
        "org' — that is a bug that appears once a second org exists (T-3-01).",
    );
    this.name = 'ResolveOrgRequiredError';
  }
}

export interface ResolveArgs {
  clerkOrgId: string;
  target: 'test' | 'prod';
  /** Stages 1–4 only: chains, blocks, gate and scores are written; nothing is merged. */
  dryRun: boolean;
}

const KNOWN_FLAGS = ['--org=', '--target=', '--dry-run'] as const;

/** Pure. An unknown flag is refused rather than ignored, so a typo never reaches the org gate. */
export function parseResolveArgs(argv: readonly string[]): ResolveArgs {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.some((f) => (f.endsWith('=') ? arg.startsWith(f) : arg === f))) {
      throw new Error(
        `resolve: unknown argument ${JSON.stringify(arg)} (expected --org=… --target=… --dry-run)`,
      );
    }
  }
  const value = (flag: string) => argv.find((a) => a.startsWith(flag))?.slice(flag.length);
  const clerkOrgId = value('--org=')?.trim() ?? '';
  if (clerkOrgId === '') throw new ResolveOrgRequiredError();
  const target = value('--target=') ?? 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('resolve: unknown target ' + target + ' (test | prod)');
  }
  return { clerkOrgId, target, dryRun: argv.includes('--dry-run') };
}

/** `resolveSeedTarget`'s checks (scripts/seed.ts), same shape as the two ingest scripts. D-04. */
export function resolveResolveUrl(target: 'test' | 'prod'): string {
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url) throw new Error('resolve: ' + varName + ' is not set. See docs/local-postgres.md.');
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error('resolve: --target=test refuses a Supabase host. D-04.');
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error('resolve: --target=prod expects the Supabase session pooler URL.');
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      'resolve: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the desk-script path.',
    );
  }
  return url;
}

// ---------------------------------------------------------------------------------------
// Transactions: every one of them carries the ETL actor AND the org claim.
// ---------------------------------------------------------------------------------------

export interface ResolveTx {
  tx: EtlExecutor;
  /** `orgs.id`, re-resolved from the clerk_org_id in THIS transaction. */
  orgId: string;
}

export interface ResolveDb {
  readonly clerkOrgId: string;
  run<T>(fn: (t: ResolveTx) => Promise<T>): Promise<T>;
}

/**
 * The ONE place this script opens a transaction. 🔴 Its first two statements, every time, are
 * `setEtlActor` then `resolveEtlOrg`: both GUCs are transaction-LOCAL and die at COMMIT, so a
 * stage that ran them once at startup would hold the org for its first transaction only.
 *
 * `nested` swaps BEGIN/COMMIT for SAVEPOINT/RELEASE so a test holding an outer transaction
 * (`withRollback`) drives the same code. The desk run never sets it. Note for test authors: a
 * transaction-local GUC set inside a RELEASED savepoint survives until the outer transaction
 * ends, so nested mode is more forgiving than the desk run about a later transaction that
 * forgot the claim — the test that proves the claim matters installs none anywhere.
 */
export function resolveTransactions(
  client: EtlExecutor,
  clerkOrgId: string,
  opts: { nested?: boolean } = {},
): ResolveDb {
  let seq = 0;
  return {
    clerkOrgId,
    async run<T>(fn: (t: ResolveTx) => Promise<T>): Promise<T> {
      seq += 1;
      const sp = `resolve_${seq}`;
      await client.query(opts.nested ? `savepoint ${sp}` : 'begin');
      try {
        await setEtlActor(client, 'resolve');
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

// ---------------------------------------------------------------------------------------
// Stage 0 — preflight
// ---------------------------------------------------------------------------------------

/** The org claim did not take. Names `--org` so the operator knows what to check. */
export class ResolvePreflightError extends Error {
  constructor(clerkOrgId: string, found: string | null, expected: string) {
    super(
      `resolve: stage 0 preflight failed for --org=${clerkOrgId}: app.current_org_id() is ` +
        `${found === null ? 'NULL' : found}, expected ${expected}. Every merge and the run ` +
        'report would raise 42501 (no current org); nothing has been written.',
    );
    this.name = 'ResolvePreflightError';
  }
}

/** Returns `orgs.id`. Writes nothing. */
export async function preflight(db: ResolveDb): Promise<string> {
  return db.run(async ({ tx, orgId }) => {
    const { rows } = await tx.query<{ id: string | null }>(
      'select app.current_org_id()::text as id',
    );
    const found = rows[0]?.id ?? null;
    if (found === null || found !== orgId) {
      throw new ResolvePreflightError(db.clerkOrgId, found, orgId);
    }
    return orgId;
  });
}

// ---------------------------------------------------------------------------------------
// Stage 1 — chain detection (a flag, never a merge)
// ---------------------------------------------------------------------------------------

export async function stageChains(db: ResolveDb): Promise<ChainDetectionResult> {
  return db.run(({ tx, orgId }) => detectChains(tx, orgId));
}

// ---------------------------------------------------------------------------------------
// Stage 2 — blocking, with the GIN planner trap closed
// ---------------------------------------------------------------------------------------

/**
 * 🔴 THE PLANNER TRAP (03-10). pg_trgm's `%` is priced like a cheap operator, so with a large
 * unflushed GIN pending list or stale statistics the planner may run B3's lateral probe as a
 * Seq Scan — an O(n²) pass measured in HOURS at ~92k rows instead of ~2 minutes. Stage 2
 * therefore flushes the pending list and ANALYZEs first, then EXPLAINs B3 and refuses to run
 * it unless `businesses_name_trgm` is in the plan.
 *
 * The guard applies only at or above this many probe rows. Below it the planner is right to
 * pick a btree or a seq scan (03-10 measured the btree plan at 14 rows and the GIN plan from
 * ~30k up), and a small org's B3 is seconds whatever the plan. A false refusal between 20k and
 * 30k rows costs a re-run; a missed seq scan at 92k costs the afternoon.
 */
export const TRIGRAM_GUARD_MIN_ROWS = 20_000;

export class TrigramPlanError extends Error {
  constructor(rows: number, plan: string) {
    super(
      `resolve: refusing B3 — the planner did not choose businesses_name_trgm for the lateral ` +
        `trigram probe over ${rows} rows. That plan is an O(n²) pass. Plan:\n${plan}`,
    );
    this.name = 'TrigramPlanError';
  }
}

/** Pure: does an EXPLAIN text drive B3 from the GIN trigram index? */
export function planUsesTrigramIndex(plan: string): boolean {
  return /\bbusinesses_name_trgm\b/.test(plan);
}

/**
 * EXPLAINs (never executes) B3 in the caller's transaction and refuses a plan without the GIN
 * index when the org has at least `minRows` probe rows. Returns what it checked.
 */
export async function assertTrigramPlan(
  tx: EtlExecutor,
  orgId: string,
  minRows: number = TRIGRAM_GUARD_MIN_ROWS,
): Promise<'gin' | 'unchecked_small'> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from businesses
      where org_id = $1::uuid and merged_into_id is null
        and name_norm is not null and postal is not null`,
    [orgId],
  );
  const probes = Number(rows[0]?.n ?? 0);
  if (probes < minRows) return 'unchecked_small';
  const b3 = trigramLateralSql(orgId);
  const explained = await tx.query<{ 'QUERY PLAN': string }>(`explain ${b3.text}`, b3.values);
  const plan = explained.rows.map((r) => r['QUERY PLAN']).join('\n');
  if (!planUsesTrigramIndex(plan)) throw new TrigramPlanError(probes, plan);
  return 'gin';
}

export interface BlockStageResult {
  inserted: Record<BlockShape, number>;
  skippedBlocks: SkippedBlock[];
  trigramPlan: 'gin' | 'unchecked_small';
}

export async function stageBlock(
  db: ResolveDb,
  opts: { trigramGuardMinRows?: number } = {},
): Promise<BlockStageResult> {
  // The trap's two preconditions, committed before any probe is planned. ANALYZE may run in a
  // transaction block (VACUUM may not); gin_clean_pending_list is a function call.
  await db.run(async ({ tx }) => {
    await tx.query("select gin_clean_pending_list('businesses_name_trgm'::regclass)");
    await tx.query('analyze businesses');
  });

  const inserted: Record<BlockShape, number> = { phone: 0, address: 0, trigram: 0 };
  const skippedBlocks: SkippedBlock[] = [];
  let trigramPlan: 'gin' | 'unchecked_small' = 'unchecked_small';

  const shapes: ReadonlyArray<(orgId: string) => BlockStatement> = [
    phoneBlockSql, // B1
    addressBlockSql, // B2′ — gated at similarity >= 0.3, never run ungated
    trigramLateralSql, // B3 — bounded 5 per left row
  ];
  for (const build of shapes) {
    await db.run(async ({ tx, orgId }) => {
      // Each shape's transaction begins with the threshold (T-3-04). `runBlock` sets it again
      // from the statement's own `setup` and reads it back; this first SET is what the B3
      // EXPLAIN below is planned under.
      await tx.query(`set local pg_trgm.similarity_threshold = ${BLOCK_SIMILARITY_THRESHOLD}`);
      const stmt = build(orgId);
      if (stmt.shape === 'trigram') {
        trigramPlan = await assertTrigramPlan(tx, orgId, opts.trigramGuardMinRows);
      }
      const r = await runBlock(tx, stmt);
      inserted[r.shape] += r.inserted;
      skippedBlocks.push(...r.skippedBlocks);
    });
  }
  return { inserted, skippedBlocks, trigramPlan };
}

// ---------------------------------------------------------------------------------------
// Stage 3 — the D-10 25 km hard rule
// ---------------------------------------------------------------------------------------

export async function stageDistanceGate(db: ResolveDb): Promise<number> {
  return db.run(async ({ tx, orgId }) => {
    // Fresh statistics for the join the gate and the scorer both make.
    await tx.query('analyze merge_candidates');
    return runDistanceGate(tx, orgId);
  });
}

// ---------------------------------------------------------------------------------------
// Stage 4 — score every pending candidate with the one committed scorer
// ---------------------------------------------------------------------------------------

/** Pending candidates written back per statement: one jsonb parameter each. */
export const SCORE_WRITE_BATCH = 2_000;

export interface BandCounts {
  /** >= 95 — handed to stage 5. */
  merge: number;
  /** 80–94 — the review queue. */
  review: number;
  /** < 80 — pending, below the queue's score floor. */
  ignore: number;
  /** R1 fired in the scorer (the gate should have caught it first; counted, never written as a decision). */
  distinct: number;
}

export interface ScoreStageResult {
  scored: number;
  /** Rows whose score or features actually changed (write-gated). */
  written: number;
  bands: BandCounts;
}

type SideRow = {
  id: string;
  source: string | null;
  name_norm: string | null;
  phone_e164: string | null;
  phone_blockable: boolean;
  street_num: string | null;
  street_norm: string | null;
  postal: string | null;
  lat: number | string | null;
  lng: number | string | null;
  location_match_type: string | null;
  cluster_key: string | null;
  chain_key: string | null;
};

const SIDE_COLUMNS = [
  'id',
  'primary_source as source',
  'name_norm',
  'phone_e164',
  'phone_blockable',
  'street_num',
  'street_norm',
  'postal',
  'lat',
  'lng',
  'location_match_type',
  'cluster_key',
  'chain_key',
] as const;

const numOrNull = (v: number | string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const LOCATION_MATCH_TYPES: ReadonlySet<string> = new Set([
  'overture',
  'census_exact',
  'census_non_exact',
]);

/**
 * A `businesses` row → the scorer's `Side`. `source` is not read by `score()`; a row with no
 * `primary_source` (none exist from the ingest path) reads as Comptroller. An unknown
 * `location_match_type` is NULL, which the geo gate treats as unpromotable.
 */
export function sideOf(r: SideRow): Side {
  return {
    id: r.id,
    source: r.source === 'overture' ? 'overture' : 'tx_comptroller',
    nameNorm: r.name_norm,
    phoneE164: r.phone_e164,
    phoneBlockable: r.phone_blockable === true,
    streetNum: r.street_num,
    streetNorm: r.street_norm,
    postal: r.postal,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    locationMatchType:
      r.location_match_type !== null && LOCATION_MATCH_TYPES.has(r.location_match_type)
        ? (r.location_match_type as LocationMatchType)
        : null,
    clusterKey: r.cluster_key,
    chainKey: r.chain_key,
  };
}

const sideSelect = (alias: string, prefix: string): string =>
  SIDE_COLUMNS.map((col) => {
    const [expr, as] = col.includes(' as ') ? col.split(' as ') : [col, col];
    return `${alias}.${expr} as ${prefix}${as}`;
  }).join(', ');

function pickSide(row: Record<string, unknown>, prefix: string): SideRow {
  const out: Record<string, unknown> = {};
  for (const col of SIDE_COLUMNS) {
    const name = col.includes(' as ') ? col.split(' as ')[1]! : col;
    out[name] = row[prefix + name];
  }
  return out as SideRow;
}

export async function stageScore(db: ResolveDb): Promise<ScoreStageResult> {
  return db.run(async ({ tx, orgId }) => {
    // 🔴 name_sim comes from pg_trgm, IN SQL. The scorer never recomputes trigram similarity:
    // pg_trgm's trigram set is not reproducible in TypeScript, and a blocker and a scorer that
    // disagree about a key produce candidates that vanish when re-scored.
    const { rows } = await tx.query<Record<string, unknown>>(
      `select mc.id as candidate_id,
              similarity(a.name_norm, b.name_norm) as name_sim,
              ${sideSelect('a', 'a_')},
              ${sideSelect('b', 'b_')}
         from merge_candidates mc
         join businesses a on a.id = mc.left_id and a.org_id = mc.org_id
         join businesses b on b.id = mc.right_id and b.org_id = mc.org_id
        where mc.org_id = $1::uuid and mc.decision = 'pending'
        order by mc.id`,
      [orgId],
    );

    const bands: BandCounts = { merge: 0, review: 0, ignore: 0, distinct: 0 };
    const updates: Array<{ id: string; score: number; features: unknown }> = [];
    for (const row of rows) {
      const nameSim = numOrNull(row.name_sim as number | string | null) ?? 0;
      const r = score({ a: sideOf(pickSide(row, 'a_')), b: sideOf(pickSide(row, 'b_')), nameSim });
      bands[r.band] += 1;
      updates.push({ id: String(row.candidate_id), score: r.score, features: r.features });
    }

    let written = 0;
    for (let i = 0; i < updates.length; i += SCORE_WRITE_BATCH) {
      const batch = updates.slice(i, i + SCORE_WRITE_BATCH);
      // ONE jsonb parameter per batch, unpacked in SQL. Write-gated: a re-run over an
      // unchanged spine rewrites nothing.
      const res = await tx.query<{ n: number }>(
        `with v as (
           select * from jsonb_to_recordset($2::jsonb) as v(id uuid, score int, features jsonb)
         ),
         upd as (
           update merge_candidates mc
              set score = v.score, features = v.features
             from v
            where mc.id = v.id and mc.org_id = $1::uuid and mc.decision = 'pending'
              and (mc.score is distinct from v.score or mc.features is distinct from v.features)
           returning 1
         )
         select count(*)::int as n from upd`,
        [orgId, JSON.stringify(batch)],
      );
      written += Number(res.rows[0]?.n ?? 0);
    }
    return { scored: rows.length, written, bands };
  });
}

// ---------------------------------------------------------------------------------------
// Stage 5 — auto-merge: descending score, cluster-aware, chain-aware, distinct-aware
// ---------------------------------------------------------------------------------------

/** A per-candidate transaction that hits `40001` (a concurrent merge moved the pair) is retried. */
export const MERGE_RETRIES = 3;

export type MergeOutcome =
  | 'merged'
  | 'already_one'
  | 'skipped_chain'
  | 'skipped_distinct'
  | 'not_pending';

export interface MergeStageResult {
  considered: number;
  merged: number;
  already_one: number;
  skipped_chain: number;
  skipped_distinct: number;
  not_pending: number;
  retries: number;
}

/**
 * The candidates at or above 95, in the order they are merged. 🔴 `score desc` first: a
 * cluster forms around its strongest edges. The tiebreak is the BUSINESS PAIR
 * (`left_id`, `right_id` — unique per org), not the candidate's own `id`: candidate ids are
 * random uuids that a regenerated candidate set reshuffles, while the pair is the same pair on
 * every run, so equal-score ties resolve identically every time.
 */
export async function autoMergeQueue(tx: EtlExecutor, orgId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `select mc.id
       from merge_candidates mc
      where mc.org_id = $1::uuid and mc.decision = 'pending' and mc.score >= $2::int
      order by mc.score desc, mc.left_id asc, mc.right_id asc`,
    [orgId, AUTO_MERGE_SCORE],
  );
  return rows.map((r) => r.id);
}

/**
 * One candidate, in the caller's transaction. 🔴 Both sides are RE-POINTED through
 * `coalesce(merged_into_id, id)` and the roots re-read before anything is decided: an earlier
 * merge in this pass may already have folded either side into a cluster.
 *
 *  - not pending any more            → skip (decided since the queue was read)
 *  - both sides resolve to one root  → `mergePair` marks it `merged` through the definer and
 *                                      returns a null merge id (the third edge of a triangle)
 *  - a chain flag on either side OR either root → skip (D-11: auto-merge never takes a
 *                                      flagged row; the review queue shows the flag)
 *  - a `distinct` decision already spans the two clusters → skip (D-20: an unmerged or
 *                                      rejected pair is never re-merged by the pass, even when
 *                                      it comes back through a different edge)
 *  - otherwise                       → `mergePair(..., reason 'auto')`
 */
export async function mergeCandidate(t: ResolveTx, candidateId: string): Promise<MergeOutcome> {
  const { tx, orgId } = t;
  const { rows } = await tx.query<{
    id: string;
    decision: string;
    left_id: string;
    right_id: string;
    score: number;
    features: Record<string, unknown>;
    left_root: string | null;
    right_root: string | null;
    chained: boolean;
  }>(
    `with c as (
       select mc.id, mc.decision, mc.left_id, mc.right_id, mc.score, mc.features,
              (select coalesce(merged_into_id, id) from businesses
                where id = mc.left_id and org_id = $2::uuid) as left_root,
              (select coalesce(merged_into_id, id) from businesses
                where id = mc.right_id and org_id = $2::uuid) as right_root
         from merge_candidates mc
        where mc.id = $1::uuid and mc.org_id = $2::uuid
     )
     select c.*,
            exists (select 1 from businesses b
                     where b.org_id = $2::uuid
                       and b.id in (c.left_id, c.right_id, c.left_root, c.right_root)
                       and b.chain_key is not null) as chained
       from c`,
    [candidateId, orgId],
  );
  const c = rows[0];
  if (!c || c.decision !== 'pending') return 'not_pending';

  const input = {
    candidateId: c.id,
    leftId: c.left_id,
    rightId: c.right_id,
    reason: 'auto' as const,
    score: Number(c.score),
    features: c.features,
  };

  if (c.left_root !== null && c.left_root === c.right_root) {
    // Already one business. The definer marks the candidate `merged` and writes nothing else.
    await mergePair(tx, input);
    return 'already_one';
  }
  if (c.chained) return 'skipped_chain';

  const distinct = await tx.query<{ blocked: boolean }>(
    `with members as (
       select id from businesses where org_id = $1::uuid and id in ($2::uuid, $3::uuid)
       union
       select id from businesses where org_id = $1::uuid and merged_into_id in ($2::uuid, $3::uuid)
     )
     select exists (
       select 1
         from merge_candidates d
         join businesses l on l.id = d.left_id and l.org_id = d.org_id
         join businesses r on r.id = d.right_id and r.org_id = d.org_id
        where d.org_id = $1::uuid
          and d.decision = 'distinct'
          and d.left_id in (select id from members)
          and d.right_id in (select id from members)
          and coalesce(l.merged_into_id, l.id) <> coalesce(r.merged_into_id, r.id)
     ) as blocked`,
    [orgId, c.left_root, c.right_root],
  );
  if (distinct.rows[0]?.blocked === true) return 'skipped_distinct';

  const r = await mergePair(tx, input);
  return r.mergeId === null ? 'already_one' : 'merged';
}

/** One candidate's merge, as stage 5 calls it. A test seam: production is `mergeCandidate`. */
export type MergeOne = (t: ResolveTx, candidateId: string) => Promise<MergeOutcome>;

export async function stageMerge(
  db: ResolveDb,
  opts: { mergeOne?: MergeOne } = {},
): Promise<MergeStageResult> {
  const mergeOne = opts.mergeOne ?? mergeCandidate;
  const queue = await db.run(({ tx, orgId }) => autoMergeQueue(tx, orgId));
  const out: MergeStageResult = {
    considered: queue.length,
    merged: 0,
    already_one: 0,
    skipped_chain: 0,
    skipped_distinct: 0,
    not_pending: 0,
    retries: 0,
  };
  for (const candidateId of queue) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // One transaction per candidate, each re-installing the actor and the org claim.
        const outcome = await db.run((t) => mergeOne(t, candidateId));
        out[outcome] += 1;
        break;
      } catch (e) {
        const code = pgFailure(e)?.code;
        // 🔴 A-WR-10 (review 03). 40001 (a concurrent merge moved the pair) AND 40P01 (a
        // deadlock with a concurrent undo_merge) are transient: the transaction rolled back
        // whole, so re-running it from the top is safe.
        if ((code === '40001' || code === '40P01') && attempt < MERGE_RETRIES) {
          out.retries += 1;
          continue;
        }
        // 55000: the definer refused a candidate that is no longer pending — a reviewer
        // decided it (or an unmerge ruled it distinct) after the queue was read. That is the
        // same outcome as the pending check at the top of mergeCandidate, reached a moment
        // later; it must never kill the rest of a pass that took minutes to block and score.
        if (code === '55000') {
          out.not_pending += 1;
          break;
        }
        throw e;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Stage 6 — tidy the pending pairs the merges (and the reviewers) have made stale
// ---------------------------------------------------------------------------------------

export interface TidyStageResult {
  /** Pending pairs whose two sides are now ONE cluster — marked `merged`. */
  already_one: number;
  /** Pending pairs between two clusters a `distinct` decision already spans — marked `distinct`. */
  spanned_distinct: number;
}

/**
 * A-WR-03 (review 03). Stage 5 settled "both sides are one root" only for the >= 95 queue it
 * walks, and left a `skipped_distinct` candidate `pending` forever. So the review queue kept:
 *   - an 80–94 pair whose two sides had been merged through OTHER edges — asking "Same
 *     business?" about a pair that already IS one business (answering "Different" wrote a
 *     `distinct` inside a single cluster);
 *   - a >= 95 pair between two clusters a person had ruled apart (an unmerge, a "Different"),
 *     ranked FIRST by score, one tap from re-merging what was just unmerged (D-20).
 * This stage settles both, for every pending pair at every score, set-based, in one
 * transaction:
 *   - roots coincide            → `merged` (it is one business; nothing is written but the row)
 *   - a `distinct` decision already joins the two ROOT clusters → `distinct`
 * Attributed to the ETL actor (`etl:resolve`), stamped `decided_at`. `merge_candidates` carries
 * no log_event (0023); the decision columns are its audit. A write-gated statement: a pair
 * already settled is not pending, so a re-run settles nothing twice.
 */
export const TIDY_SQL = `
  with roots as (
    select mc.id, mc.decision,
           coalesce(l.merged_into_id, l.id) as lr,
           coalesce(r.merged_into_id, r.id) as rr
      from merge_candidates mc
      join businesses l on l.id = mc.left_id and l.org_id = mc.org_id
      join businesses r on r.id = mc.right_id and r.org_id = mc.org_id
     where mc.org_id = $1::uuid
  ),
  ruled_apart as (
    select distinct least(lr, rr) as a, greatest(lr, rr) as b
      from roots where decision = 'distinct' and lr <> rr
  ),
  one as (
    update merge_candidates mc
       set decision = 'merged', decided_at = now(),
           decided_by = coalesce(current_setting('app.actor_id', true), 'system')
      from roots x
     where mc.id = x.id and mc.org_id = $1::uuid and mc.decision = 'pending' and x.lr = x.rr
    returning 1
  ),
  apart as (
    update merge_candidates mc
       set decision = 'distinct', decided_at = now(),
           decided_by = coalesce(current_setting('app.actor_id', true), 'system')
      from roots x
      join ruled_apart d on d.a = least(x.lr, x.rr) and d.b = greatest(x.lr, x.rr)
     where mc.id = x.id and mc.org_id = $1::uuid and mc.decision = 'pending' and x.lr <> x.rr
    returning 1
  )
  select (select count(*) from one)::int as already_one,
         (select count(*) from apart)::int as spanned_distinct`;

export async function stageTidy(db: ResolveDb): Promise<TidyStageResult> {
  return db.run(async ({ tx, orgId }) => {
    const { rows } = await tx.query<{ already_one: number; spanned_distinct: number }>(TIDY_SQL, [
      orgId,
    ]);
    return {
      already_one: Number(rows[0]?.already_one ?? 0),
      spanned_distinct: Number(rows[0]?.spanned_distinct ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------------------

export interface ResolveStats {
  [key: string]: unknown;
  dry_run: boolean;
  chains: ChainDetectionResult;
  blocks: Record<BlockShape, number>;
  trigram_plan: 'gin' | 'unchecked_small';
  /** T-3-12: every block the cap refused, `{ block_key, size }`. Never truncated silently. */
  skipped_blocks: SkippedBlock[];
  distance_gated: number;
  scored: number;
  score_rows_written: number;
  /** Pending candidates per band after scoring: >= 95, 80–94, < 80. */
  bands: BandCounts;
  merges: MergeStageResult | null;
  /** Stage 6 (A-WR-03): pending pairs settled because they went stale. Null on a dry run. */
  tidy: TidyStageResult | null;
  ms: Record<string, number>;
}

export interface ResolveReport {
  orgId: string;
  eventId: string;
  stats: ResolveStats;
}

export interface ResolvePassOptions {
  dryRun?: boolean;
  log?: (line: string) => void;
  /** Test lever only; the desk run always uses TRIGRAM_GUARD_MIN_ROWS. */
  trigramGuardMinRows?: number;
  /** Test lever only (stage 5's per-candidate merge); the desk run uses `mergeCandidate`. */
  mergeOne?: MergeOne;
}

export async function runResolvePass(
  db: ResolveDb,
  opts: ResolvePassOptions = {},
): Promise<ResolveReport> {
  const log = opts.log ?? (() => undefined);
  const ms: Record<string, number> = {};
  const t0 = Date.now();
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    const v = await fn();
    ms[name] = Date.now() - s;
    return v;
  };

  const orgId = await timed('preflight', () => preflight(db));
  log(`resolve: stage 0 preflight ok — org ${db.clerkOrgId} → ${orgId}`);

  // The report is built as the stages finish, so a failure part-way still has something true to
  // say. A-WR-10 (review 03): a pass that died in stage 5 used to leave NO report at all, after
  // minutes of blocking and scoring had been committed.
  const partial: Record<string, unknown> = { dry_run: opts.dryRun === true, ms };
  const emitReport = (stats: Record<string, unknown>) =>
    db.run(async ({ tx }) => {
      const { rows } = await tx.query<{ id: string }>(
        "select app.emit_event('businesses', null, 'resolve', $1::jsonb)::text as id",
        [JSON.stringify(stats)],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('resolve: emit_event returned no id');
      return id;
    });

  let stage = 'chains';
  try {
    const chains = await timed('chains', () => stageChains(db));
    partial.chains = chains;
    log(`resolve: stage 1 chains — ${chains.names} names / ${chains.rows} rows flagged (statewide ${chains.statewide})`);

    stage = 'block';
    const blocks = await timed('block', () =>
      stageBlock(db, { trigramGuardMinRows: opts.trigramGuardMinRows }),
    );
    Object.assign(partial, {
      blocks: blocks.inserted,
      trigram_plan: blocks.trigramPlan,
      skipped_blocks: blocks.skippedBlocks,
    });
    log(
      `resolve: stage 2 block — phone ${blocks.inserted.phone}, address ${blocks.inserted.address}, ` +
        `trigram ${blocks.inserted.trigram} (plan ${blocks.trigramPlan}); ` +
        `${blocks.skippedBlocks.length} block(s) over the cap skipped`,
    );

    stage = 'gate';
    const gated = await timed('gate', () => stageDistanceGate(db));
    partial.distance_gated = gated;
    log(`resolve: stage 3 gate — ${gated} pair(s) over 25 km marked distinct`);

    stage = 'score';
    const scored = await timed('score', () => stageScore(db));
    Object.assign(partial, {
      scored: scored.scored,
      score_rows_written: scored.written,
      bands: scored.bands,
    });
    log(
      `resolve: stage 4 score — ${scored.scored} pending scored (${scored.written} rewritten): ` +
        `>=${AUTO_MERGE_SCORE} ${scored.bands.merge}, ${REVIEW_SCORE}–${AUTO_MERGE_SCORE - 1} ` +
        `${scored.bands.review}, <${REVIEW_SCORE} ${scored.bands.ignore}`,
    );

    let merges: MergeStageResult | null = null;
    if (!opts.dryRun) {
      stage = 'merge';
      merges = await timed('merge', () => stageMerge(db, { mergeOne: opts.mergeOne }));
      log(
        `resolve: stage 5 merge — ${merges.merged} merged, ${merges.already_one} already one, ` +
          `${merges.skipped_chain} chain-skipped, ${merges.skipped_distinct} distinct-skipped, ` +
          `${merges.not_pending} no longer pending, ${merges.retries} retries`,
      );
    } else {
      log('resolve: --dry-run — stage 5 not run, nothing merged');
    }
    partial.merges = merges;

    let tidy: TidyStageResult | null = null;
    if (!opts.dryRun) {
      stage = 'tidy';
      tidy = await timed('tidy', () => stageTidy(db));
      log(
        `resolve: stage 6 tidy — ${tidy.already_one} pending pair(s) already one business, ` +
          `${tidy.spanned_distinct} across a distinct ruling`,
      );
    }
    ms.total = Date.now() - t0;

    const stats: ResolveStats = {
      dry_run: opts.dryRun === true,
      chains,
      blocks: blocks.inserted,
      trigram_plan: blocks.trigramPlan,
      skipped_blocks: blocks.skippedBlocks,
      distance_gated: gated,
      scored: scored.scored,
      score_rows_written: scored.written,
      bands: scored.bands,
      merges,
      tidy,
      ms,
    };

    // The run report: one event, attributed etl:resolve, in its own transaction.
    stage = 'report';
    const eventId = await emitReport(stats);
    return { orgId, eventId, stats };
  } catch (e) {
    if (stage === 'report') throw e;
    ms.total = Date.now() - t0;
    partial.failed = {
      stage,
      error: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 2000),
    };
    // Best effort: the stage's own error is the one the operator must see, so a failure to
    // write the partial report never replaces it.
    await emitReport(partial).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  // The gate. Throws before any I/O at all.
  const args = parseResolveArgs(process.argv.slice(2));
  loadEnv({ path: '.env.local', override: false, quiet: true });
  const url = resolveResolveUrl(args.target);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    console.log(
      `resolve: target=${args.target} org=${args.clerkOrgId}${args.dryRun ? ' (dry run)' : ''}`,
    );
    const report = await runResolvePass(resolveTransactions(client, args.clerkOrgId), {
      dryRun: args.dryRun,
      log: (line) => console.log(line),
    });
    const s = report.stats;
    for (const b of s.skipped_blocks) {
      console.log(`  skipped block ${b.block_key}: ${b.size} pairs (cap exceeded, refused whole)`);
    }
    console.log(
      `resolve: done in ${((s.ms.total ?? 0) / 1000).toFixed(1)} s · report event ${report.eventId}`,
    );
  } finally {
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
