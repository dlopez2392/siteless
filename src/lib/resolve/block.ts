import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import { BLOCK_SIMILARITY_THRESHOLD } from './score';

/**
 * DEDUP-01 candidate generation: the three measured blocking shapes (B1, B2′, B3), the D-10
 * 25 km hard rule, and the block-size cap. 03-RESEARCH § Blocking Strategy at Real Scale.
 *
 * 🔴 THIS MODULE GENERATES SQL; IT OPENS NO CONNECTION. Every shape is a `{ setup, text, values }`
 * value so `tests/unit/block-sql.test.ts` can inspect the generated text with no database, and
 * `runBlock` is the one place that executes it — inside the CALLER's transaction, after the
 * caller has run `setEtlActor` + `resolveEtlOrg` (src/lib/ingest/etl-actor.ts).
 *
 * ── Why a blocker at all ─────────────────────────────────────────────────────────────────────
 * All-pairs is 1,988,940,032 cross-source comparisons (34,928 Comptroller × 56,944 Overture) —
 * forty times STACK.md's "49 M" estimate — plus 1.62 billion intra-Overture. B1 ∪ B2′ ∪ B3 is
 * 29,701 distinct candidate pairs (measured, 70.5 s): a 66,970× reduction, a ~2-minute desk pass.
 *
 * ── The trap that wastes a day ───────────────────────────────────────────────────────────────
 * The obvious form — an inner join on the ZIP whose join predicate ALSO carries the trigram
 * similarity operator — does NOT use the GIN index. Measured: 269,647 ms. EXPLAIN (ANALYZE,
 * BUFFERS) shows the planner driving from the ZIP btree and applying the similarity operator as
 * a post-index Filter: 85 million similarity() evaluations. The GIN trigram index cannot be the
 * driver when the probe value is a correlated column of the outer relation. The
 * `cross join lateral … order by <-> … limit 5` form below makes the GIN index the driver
 * (3.3 ms per probe, `Bitmap Index Scan on businesses_name_trgm`, 43 buffers) and finishes the
 * whole pass in 101,807 ms. `tests/unit/block-sql.test.ts` 'lateral blocker' fails if the join
 * form ever comes back.
 *
 * ── Measured pair counts (so nobody re-derives them) ─────────────────────────────────────────
 *   B1  exact phone_e164, phone_blockable only ........ 12,717 pairs, worst block 32 rows (496 pairs)
 *       WITHOUT the toll-free exclusion ............... 61,677 pairs, worst block 215 rows
 *                                                        (23,005 pairs from ONE number)
 *   B2  (postal, street_num) UNGATED .................. 332,738 pairs, worst block 57,568 pairs
 *                                                        (one shopping centre: 2200 in 78503)
 *   B2′ (postal, street_num) AND similarity >= 0.3 .... 14,357 pairs, 1,743 ms
 *   B3  GIN lateral trigram top-5 within postal ....... <= 5 per left row by construction, ~70 s
 *   pg_trgm.similarity_threshold 0.45 → 33,333 pairs; 0.60 → 14,485 (the B3 knob)
 *   The D-10 gate over 332,738 pairs .................. 303 ms
 *
 * ── Rejected blocking keys, so nobody re-invents them ────────────────────────────────────────
 *   (postal, soundex(first token)) ... 597,063 pairs, worst block 65,658 — WORSE than ungated B2.
 *                                      fuzzystrmatch is therefore not needed at all.
 *   grid cell 0.01° .................. 4,172,644 pairs.
 *   grid cell 0.002° ................. 449,667 pairs BEFORE the 3×3 neighbour expansion (×9).
 *   A geohash column buys nothing the (postal, street_num) block does not already find, and the
 *   pairs it adds uniquely are the "six different businesses at 1805 …" class that must not merge.
 *   (postal, left(name_norm,4)) btree  115,358 pairs, worst block 4,165: the FALLBACK ONLY, if
 *                                      pg_trgm turns out to be unavailable in CI (open question A1).
 *
 * ── The block-size cap (T-3-12) ──────────────────────────────────────────────────────────────
 * A block's size is its UNGATED pair count, n·(n−1)/2 over its live members, computed from a
 * group-by BEFORE any pair is expanded — so the 57,568-pair mall is refused without evaluating a
 * single similarity() over it. A block above MAX_BLOCK_PAIRS is REFUSED WHOLE and returned as
 * `{ block_key, size }` for the run report's `stats.skipped_blocks`; it is never silently
 * truncated, because a truncated block is how a whole mall disappears from the spine. The mall's
 * genuine duplicates are still reachable through B3, which is bounded per row, not per block.
 * The cap is 500 because B1's worst real block is 32 rows = 496 pairs: it fits, the mall does not.
 *
 * ── Invariants every statement here holds ────────────────────────────────────────────────────
 *  - `least`/`greatest` on the two uuids satisfies the `mc_pair_ordered` CHECK and stops one
 *    unordered pair becoming two rows; `on conflict (org_id, left_id, right_id) do nothing` makes
 *    the union of the three shapes free.
 *  - `merged_into_id is null` on BOTH sides: a merged-away row is not a candidate.
 *  - Both sides are the SAME org, and the org is bound as `$1` — never concatenated (T-3-09,
 *    T-3-03). `businesses_name_trgm` cannot carry org_id without btree_gin (drizzle/0023), so the
 *    lateral re-checks `o.org_id = c.org_id` itself.
 *  - `features` is written as `{}` here: the scorer (03-14) fills it with integers, `nameSim` and
 *    a rule name only. The normalized name is never copied into it or into `block_key` (T-3-11).
 *  - The normalized columns are compared RAW. SQL never re-normalizes a key the TypeScript
 *    normalizer wrote (tests/unit/sql-never-normalizes.test.ts, mutation M24).
 *  - Every statement is preceded by `set local pg_trgm.similarity_threshold` (T-3-04). The
 *    threshold is a GUC, and `vitest.db.config.ts` runs `fileParallelism:false`, which makes a
 *    leaked threshold DETERMINISTIC and therefore invisible. It is set explicitly every time and
 *    read back by `runBlock`, which refuses to run if it did not take — which is also what
 *    catches a caller that forgot the transaction (`set local` outside one is a no-op warning).
 */

/** T-3-12. A block whose ungated pair count exceeds this is refused whole and reported. */
export const MAX_BLOCK_PAIRS = 500;

/** B2′'s gate. B2 ungated is 332,738 pairs; gated at 0.3 it is 14,357. Not optional. */
export const ADDRESS_BLOCK_MIN_SIMILARITY = 0.3;

/** D-10: both locations known and further apart than this is `distinct` by construction.
 *  The same number `score()`'s R1 clause spells inline (src/lib/resolve/score.ts). */
export const HARD_DISTINCT_M = 25_000;

/** The `block_key` of every B3 candidate. B3 is bounded per row, not per block. */
export const TRIGRAM_BLOCK_KEY = 'trgm_zip';

export type BlockShape = 'phone' | 'address' | 'trigram';

export interface SqlStatement {
  text: string;
  values: unknown[];
}

export interface BlockStatement extends SqlStatement {
  shape: BlockShape;
  /** Run FIRST, in the same transaction. Carries no bound value (a SET takes none); its only
   *  input is the committed constant, validated below. */
  setup: string;
}

export interface SkippedBlock {
  block_key: string;
  size: number;
}

export interface BlockResult {
  shape: BlockShape;
  /** `merge_candidates` rows this statement wrote (a pair another shape already wrote is not counted). */
  inserted: number;
  /** Blocks refused by the cap — the run report's `stats.skipped_blocks`. Always [] for B3. */
  skippedBlocks: SkippedBlock[];
}

/** `set local pg_trgm.similarity_threshold = <BLOCK_SIMILARITY_THRESHOLD>`, from the committed
 *  constant only. A SET cannot take a bound parameter, so the number is checked, not trusted. */
export function similarityThresholdSql(threshold: number = BLOCK_SIMILARITY_THRESHOLD): string {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`similarityThresholdSql: not a similarity threshold: ${threshold}`);
  }
  return `set local pg_trgm.similarity_threshold = ${threshold}`;
}

function assertOrgId(orgId: string): void {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('block: an org id is required — every blocking statement is org-scoped (T-3-09)');
  }
}

/**
 * B1 — exact `phone_e164`, toll-free and 555 numbers excluded by `phone_blockable = true`, which
 * the normalizer (src/lib/normalize/phone.ts) already computed. The NPA list is NOT re-derived
 * here: a second copy of it in SQL would be a second answer to the same question.
 *
 * $1 org id · $2 MAX_BLOCK_PAIRS.
 */
export function phoneBlockSql(orgId: string): BlockStatement {
  assertOrgId(orgId);
  return {
    shape: 'phone',
    setup: similarityThresholdSql(),
    text: `with members as (
  select id, phone_e164 as k
    from businesses
   where org_id = $1::uuid
     and phone_blockable = true
     and phone_e164 is not null
     and merged_into_id is null
),
blocks as (
  select k, count(*)::bigint * (count(*)::bigint - 1) / 2 as pairs
    from members
   group by k
  having count(*) >= 2
),
ins as (
  insert into merge_candidates (org_id, left_id, right_id, block_key, block_size, score, features, decision)
  select $1::uuid, least(x.id, y.id), greatest(x.id, y.id), 'phone:' || blk.k, blk.pairs, 0, '{}'::jsonb, 'pending'
    from blocks blk
    join members x using (k)
    join members y using (k)
   where x.id < y.id
     and blk.pairs <= $2::bigint
  on conflict (org_id, left_id, right_id) do nothing
  returning 1
)
select (select count(*) from ins)::int as inserted,
       coalesce((select jsonb_agg(jsonb_build_object('block_key', 'phone:' || k, 'size', pairs) order by k)
                   from blocks where pairs > $2::bigint), '[]'::jsonb) as skipped`,
    values: [orgId, MAX_BLOCK_PAIRS],
  };
}

/**
 * B2′ — `(postal, street_num)`, gated by `similarity(name_norm, name_norm) >= 0.3`. The block is
 * sized UNGATED (see the header): a shopping-centre address is refused before its pairs exist.
 *
 * $1 org id · $2 MAX_BLOCK_PAIRS · $3 ADDRESS_BLOCK_MIN_SIMILARITY.
 */
export function addressBlockSql(orgId: string): BlockStatement {
  assertOrgId(orgId);
  return {
    shape: 'address',
    setup: similarityThresholdSql(),
    text: `with members as (
  select id, postal, street_num, name_norm
    from businesses
   where org_id = $1::uuid
     and postal is not null
     and street_num is not null
     and merged_into_id is null
),
blocks as (
  select postal, street_num, count(*)::bigint * (count(*)::bigint - 1) / 2 as pairs
    from members
   group by postal, street_num
  having count(*) >= 2
),
ins as (
  insert into merge_candidates (org_id, left_id, right_id, block_key, block_size, score, features, decision)
  select $1::uuid, least(x.id, y.id), greatest(x.id, y.id),
         'addr:' || blk.postal || ':' || blk.street_num, blk.pairs, 0, '{}'::jsonb, 'pending'
    from blocks blk
    join members x using (postal, street_num)
    join members y using (postal, street_num)
   where x.id < y.id
     and blk.pairs <= $2::bigint
     and similarity(x.name_norm, y.name_norm) >= $3::real
  on conflict (org_id, left_id, right_id) do nothing
  returning 1
)
select (select count(*) from ins)::int as inserted,
       coalesce((select jsonb_agg(jsonb_build_object('block_key', 'addr:' || postal || ':' || street_num, 'size', pairs)
                                  order by postal, street_num)
                   from blocks where pairs > $2::bigint), '[]'::jsonb) as skipped`,
    values: [orgId, MAX_BLOCK_PAIRS, ADDRESS_BLOCK_MIN_SIMILARITY],
  };
}

/**
 * B3 — THE PRIMARY BLOCKER: for every live business with a name and a postal code, the five
 * most similar live names in the same postal code, found through the GIN trigram index.
 *
 * The similarity operator sits INSIDE the lateral subquery's WHERE, against the outer row's
 * value, and the ordering uses the distance operator with a limit — that is the shape the
 * planner drives from `businesses_name_trgm`. The operator's cut-off is the session GUC set by
 * `setup`, which is why the setup is not optional. Bounded to 5 per left row by construction,
 * so it has no cap and no `block_size`.
 *
 * $1 org id.
 */
export function trigramLateralSql(orgId: string): BlockStatement {
  assertOrgId(orgId);
  return {
    shape: 'trigram',
    setup: similarityThresholdSql(),
    text: `with ins as (
  insert into merge_candidates (org_id, left_id, right_id, block_key, block_size, score, features, decision)
  select $1::uuid, least(c.id, k.id), greatest(c.id, k.id), '${TRIGRAM_BLOCK_KEY}', null, 0, '{}'::jsonb, 'pending'
    from businesses c
    cross join lateral (
      select o.id
        from businesses o
       where o.org_id = c.org_id
         and o.id <> c.id
         and o.postal = c.postal
         and o.merged_into_id is null
         and o.name_norm % c.name_norm
       order by o.name_norm <-> c.name_norm
       limit 5
    ) k
   where c.org_id = $1::uuid
     and c.name_norm is not null
     and c.postal is not null
     and c.merged_into_id is null
  on conflict (org_id, left_id, right_id) do nothing
  returning 1
)
select (select count(*) from ins)::int as inserted, '[]'::jsonb as skipped`,
    values: [orgId],
  };
}

/**
 * D-10, the 25 km hard rule, over ALREADY-BLOCKED pairs: both locations known and more than
 * 25 km apart is `decision='distinct'` before anything is scored. Pairs with a location unknown
 * on either side are left `pending` — the scorer's geo gate (R6) keeps them out of auto-merge.
 *
 * `features` gains `distanceM` and `rule: 'over_25km'` — the same keys `score()`'s `Features`
 * carries, so the review queue reads one shape whichever of the two wrote it (T-3-11: numbers and
 * a rule name only).
 *
 * $1 org id · $2 HARD_DISTINCT_M. Returns `{ n }`, the number of pairs it made distinct.
 */
export function distanceGateSql(orgId: string): SqlStatement {
  assertOrgId(orgId);
  return {
    text: `with gated as (
  update merge_candidates mc
     set decision = 'distinct',
         features = mc.features || jsonb_build_object('distanceM', d.m, 'rule', 'over_25km')
    from businesses a, businesses b,
         lateral (select app.distance_m(a.lat, a.lng, b.lat, b.lng) as m) d
   where mc.org_id = $1::uuid
     and mc.decision = 'pending'
     and a.id = mc.left_id and a.org_id = $1::uuid
     and b.id = mc.right_id and b.org_id = $1::uuid
     and a.lat is not null and a.lng is not null
     and b.lat is not null and b.lng is not null
     and d.m > $2::double precision
  returning 1
)
select count(*)::int as n from gated`,
    values: [orgId, HARD_DISTINCT_M],
  };
}

function parseSkipped(raw: unknown): SkippedBlock[] {
  const v: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(v)) throw new Error('runBlock: the skipped-block report is not an array');
  return v.map((s: { block_key?: unknown; size?: unknown }) => {
    if (typeof s.block_key !== 'string') throw new Error('runBlock: a skipped block has no block_key');
    return { block_key: s.block_key, size: Number(s.size) };
  });
}

/**
 * Executes one blocking shape inside the caller's transaction: the threshold, a read-back that
 * proves it took, then the statement. Returns what it wrote and what the cap refused.
 */
export async function runBlock(tx: EtlExecutor, stmt: BlockStatement): Promise<BlockResult> {
  await tx.query(stmt.setup);
  const setting = await tx.query<{ t: string }>(
    "select current_setting('pg_trgm.similarity_threshold') as t",
  );
  const live = Number(setting.rows[0]?.t);
  if (live !== BLOCK_SIMILARITY_THRESHOLD) {
    throw new Error(
      `runBlock: pg_trgm.similarity_threshold is ${String(setting.rows[0]?.t)}, not ` +
        `${BLOCK_SIMILARITY_THRESHOLD}. The setup is transaction-local — run the blocker inside a transaction.`,
    );
  }
  const { rows } = await tx.query<{ inserted: number | string; skipped: unknown }>(stmt.text, stmt.values);
  const row = rows[0];
  if (!row) throw new Error(`runBlock: the ${stmt.shape} block returned no report row`);
  return { shape: stmt.shape, inserted: Number(row.inserted), skippedBlocks: parseSkipped(row.skipped) };
}

/** Runs the D-10 gate. Returns how many pending pairs it made `distinct`. */
export async function runDistanceGate(tx: EtlExecutor, orgId: string): Promise<number> {
  const stmt = distanceGateSql(orgId);
  const { rows } = await tx.query<{ n: number | string }>(stmt.text, stmt.values);
  return Number(rows[0]?.n ?? 0);
}
