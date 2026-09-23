import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import type { SqlStatement } from './block';

/**
 * D-11 chain detection — A FLAG, NEVER A MERGE.
 *
 * A normalized name carried by three or more live businesses is a chain, and every live member
 * gets `chain_key`. The flag does exactly two things downstream: `score()` caps a flagged pair at
 * 94 (R2, applied after the lifts — src/lib/resolve/score.ts), so a chain never auto-merges; and
 * the review queue shows the badge (`Chain · {n} in Texas`) when a flagged pair lands there
 * through another signal. Nothing here merges, re-points or hides a row.
 *
 * 🔴 `chain_key` IS THE `name_norm` ITSELF — not a synthetic id. It is stable across runs (a
 * sequence or uuid would renumber every pass), it is what the badge's count groups on, and it is
 * directly indexable (`businesses_chain_idx`, drizzle/0023). It carries NO provenance pair: it is
 * derived from the spine, not sourced from a record. And because it equals the normalized name
 * it is exactly as INTERNAL as `name_norm` (D-12) — the badge renders the member COUNT, never
 * the key.
 *
 * Measured on the real spine: 1,025 Overture names with >= 3 members covering 9,782 rows
 * (17.2 %), and 444 Comptroller names covering 2,091 rows (6.0 %). One in six Overture rows
 * carries the flag, so ~17 % of the Overture spine is excluded from auto-merge by this rule
 * alone. The flagged-name and flagged-row counts belong in the resolve pass's `stats`, which is
 * why the statement returns them.
 *
 * Merged-away rows (`merged_into_id` set) are neither counted toward the threshold nor flagged,
 * and a flag left on a row that no longer qualifies (it was merged away, or its name fell below
 * three) is CLEARED — "chain_key on exactly the names with three or more members and on no
 * others" has to hold on the second run too, not only the first.
 *
 * 🔴 WRITE-GATED. `businesses` carries `app.log_event`, so every UPDATE here writes an `events`
 * row. A row whose `chain_key` already has the right value is not touched (`is distinct from`),
 * so a re-run over an unchanged spine writes ZERO events — the same argument as the ingest's
 * payload-hash gate (src/lib/ingest/upsert.ts).
 *
 * ⚠ SCOPE. D-11 says "across Texas", but this phase's spine is four counties: a national chain
 * with two RGV outlets and 400 elsewhere would not reach three here. 03-12's statewide Socrata
 * request (`fetchStatewideNameFrequency()`, keyed by `nameNorm(outlet_name)`) closes that; pass
 * its map as `statewide` and any name with a statewide count >= 3 is a chain even with one local
 * member. It is bound as ONE jsonb parameter, never interpolated and never an identifier (T-3-03).
 * The badge copy may say "in Texas" only once that data is being passed.
 *
 * $1 org id · $2 the statewide frequency as a jsonb object `{ name_norm: count }` (`{}` if none).
 */

/** D-11's bar. The SQL spells the literal `>= 3` so a grep finds the rule and its number together. */
export const CHAIN_MIN_MEMBERS = 3;

export interface ChainDetectionResult {
  /** Distinct chain names with at least one live member in this org. */
  names: number;
  /** Live businesses carrying a chain flag after the statement. */
  rows: number;
  /** Rows whose flag this run changed (set or corrected). */
  flagged: number;
  /** Rows whose stale flag this run removed. */
  cleared: number;
}

export function chainDetectionSql(
  orgId: string,
  statewide?: ReadonlyMap<string, number>,
): SqlStatement {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('chainDetectionSql: an org id is required — chain detection is org-scoped');
  }
  const frequency: Record<string, number> = {};
  for (const [name, n] of statewide ?? []) {
    // Only chain-sized counts cross the boundary; the SQL re-checks the same bar.
    if (typeof name === 'string' && name !== '' && Number.isInteger(n) && n >= CHAIN_MIN_MEMBERS) {
      frequency[name] = n;
    }
  }
  return {
    text: `with local_counts as (
  select name_norm, count(*) as n
    from businesses
   where org_id = $1::uuid and name_norm is not null and merged_into_id is null
   group by name_norm
  having count(*) >= 3
),
statewide as (
  select s.key as name_norm
    from jsonb_each_text($2::jsonb) s
   where s.value::int >= 3
),
chains as (
  select name_norm from local_counts
  union
  select name_norm from statewide
),
cleared as (
  update businesses b
     set chain_key = null
   where b.org_id = $1::uuid
     and b.chain_key is not null
     and (b.merged_into_id is not null
          or not exists (select 1 from chains c where c.name_norm = b.name_norm))
  returning 1
),
flagged as (
  update businesses b
     set chain_key = c.name_norm
    from chains c
   where b.org_id = $1::uuid and b.name_norm = c.name_norm and b.merged_into_id is null
     and b.chain_key is distinct from c.name_norm
  returning 1
),
live as (
  select b.name_norm
    from businesses b
    join chains c on c.name_norm = b.name_norm
   where b.org_id = $1::uuid and b.merged_into_id is null
)
select (select count(distinct name_norm) from live)::int as names,
       (select count(*) from live)::int as rows,
       (select count(*) from flagged)::int as flagged,
       (select count(*) from cleared)::int as cleared`,
    values: [orgId, JSON.stringify(frequency)],
  };
}

/** Runs chain detection in the caller's transaction and returns the counts for `stats`. */
export async function detectChains(
  tx: EtlExecutor,
  orgId: string,
  statewide?: ReadonlyMap<string, number>,
): Promise<ChainDetectionResult> {
  const stmt = chainDetectionSql(orgId, statewide);
  const { rows } = await tx.query<Record<keyof ChainDetectionResult, number | string>>(
    stmt.text,
    stmt.values,
  );
  const r = rows[0];
  if (!r) throw new Error('detectChains: the statement returned no report row');
  return {
    names: Number(r.names),
    rows: Number(r.rows),
    flagged: Number(r.flagged),
    cleared: Number(r.cleared),
  };
}
