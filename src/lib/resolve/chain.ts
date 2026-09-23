import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import { foldDiacritics, nameNorm } from '@/lib/normalize';
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
 * 🔴 `chain_key` IS THE `name_norm` ITSELF — or, for a name D-12 reduced by a trade word, the
 * `name_norm` with that trade word put back (B-WR-05, below) — not a synthetic id. It is stable across runs (a
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
 * ── "Across Texas": the statewide frequency ─────────────────────────────────────────────────
 * This phase's spine is four counties, so a national chain with two RGV outlets and 400
 * elsewhere would never reach three locally. 03-12's one statewide Socrata request
 * (`src/lib/socrata/statewide-names.ts`, keyed by `nameNorm(outlet_name)`, 11,647 names
 * measured) closes that. There is NO statewide-frequency table — a table is a migration 03-12
 * does not own — so the map lives on the Comptroller run row as
 * `ingest_runs.stats -> 'statewide_name_frequency'` (`{ name_norm: n }`, ~400 KB), written after
 * `finishRun` by `scripts/ingest-comptroller.ts`. This statement reads THAT KEY ONLY, never the
 * whole `stats`, from the org's latest COMPLETE `tx_comptroller` run that carries it (a run whose
 * statewide request failed records an error instead and is skipped, so the last good measurement
 * still counts). Any name with a statewide count >= 3 is a chain even with one local member.
 * `statewide` in the result says whether that data existed — the badge may say "in Texas" only
 * when it did; otherwise the count is RGV-only and the copy must say so.
 *
 * $1 org id. Every value bound; the frequency never leaves the database (T-3-03).
 */

/** D-11's bar. The SQL spells the literal `>= 3` so a grep finds the rule and its number together. */
export const CHAIN_MIN_MEMBERS = 3;

// ── B-WR-05 (review 03): the chain IDENTITY keeps the trade words ─────────────────────────────
//
// D-12 strips the generic trade words (taqueria, carniceria, panaderia) from `name_norm`, which
// is right for SIMILARITY — they are in so many RGV names they carry no signal. It is wrong for
// IDENTITY: "Taqueria Garcia", "Panaderia Garcia" and "Carniceria Garcia" are three unrelated
// family businesses — the dominant RGV naming pattern — and grouping on `name_norm` made them
// one chain "garcia", badged "Chain · 3 in Texas", each capped out of auto-merge against its own
// true duplicate. So the chain key is `name_norm` with the trade words the name was REDUCED BY
// put back in front: "taqueria garcia", "panaderia garcia". Three outlets of one trade name are
// still a chain ("taqueria rey" × 3); three different trades on one surname are not.
//
// A name reduced by a trade word is never matched against the statewide frequency, which is
// keyed by the REDUCED name (src/lib/socrata/statewide-names.ts folds through nameNorm): its
// count of "garcia" is every "X Garcia" in Texas, not this business's.

/**
 * The trade words D-12 strips. They MUST be exactly the ones `nameNorm` removes
 * (src/lib/normalize/name.ts `TRADE`, not exported): tests/unit/chain-key.test.ts pins that
 * `nameNorm` strips each of them, so a word dropped from the normalizer reds here.
 */
export const CHAIN_TRADE_WORDS: ReadonlySet<string> = new Set([
  'taqueria',
  'carniceria',
  'panaderia',
]);

/**
 * The chain key of one business: its `name_norm` with the trade words its raw name was reduced
 * by put back in front, or `name_norm` itself when none was. `rawName` is the name `name_norm`
 * was computed from; null when unknown (the key is then `name_norm`). Pure.
 */
export function chainKeyOf(nameNormValue: string, rawName: string | null): string {
  if (rawName === null) return nameNormValue;
  const trades = foldDiacritics(rawName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => CHAIN_TRADE_WORDS.has(t));
  // Only the trade words the normalizer actually REMOVED. Since B-WR-05's name half (review 03)
  // nameNorm keeps a trade word when stripping it would leave a lone surname ("taqueria garcia"),
  // so a word already present in name_norm must not be put back a second time.
  const kept = new Set(nameNormValue.split(' '));
  const removed = [...new Set(trades)].filter((t) => !kept.has(t));
  if (removed.length === 0) return nameNormValue;
  return `${removed.join(' ')} ${nameNormValue}`;
}

/**
 * Which stored name `name_norm` came from: the display name when it normalizes to it (an
 * Overture name, an unmerged Comptroller outlet), else the legal name (a Comptroller winner
 * whose display name survivorship took from an Overture parent), else unknown.
 */
function rawNameOf(r: { name_norm: string; display_name: string | null; legal_name: string | null }): string | null {
  if (r.display_name !== null && nameNorm(r.display_name) === r.name_norm) return r.display_name;
  if (r.legal_name !== null && nameNorm(r.legal_name) === r.name_norm) return r.legal_name;
  return null;
}

export interface ChainDetectionResult {
  /** Distinct chain names with at least one live member in this org. */
  names: number;
  /** Live businesses carrying a chain flag after the statement. */
  rows: number;
  /** Rows whose flag this run changed (set or corrected). */
  flagged: number;
  /** Rows whose stale flag this run removed. */
  cleared: number;
  /** Whether a statewide frequency was found on a complete Comptroller run. */
  statewide: boolean;
}

/** A business whose chain key is not its bare `name_norm` (B-WR-05): the trade-word key. */
export type ChainKeyOverride = { id: string; chain_key: string };

/**
 * $1 org id; $2 the overrides (`[{ id, chain_key }]`, ONE jsonb parameter) for the businesses
 * whose name was reduced by a trade word. Every other live business's key is its `name_norm`,
 * and only those "plain" rows are matched against the statewide frequency.
 */
export function chainDetectionSql(
  orgId: string,
  overrides: readonly ChainKeyOverride[] = [],
): SqlStatement {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('chainDetectionSql: an org id is required — chain detection is org-scoped');
  }
  return {
    text: `with overrides as (
  select * from jsonb_to_recordset($2::jsonb) as o(id uuid, chain_key text)
),
keyed as (
  select b.id, b.name_norm, coalesce(o.chain_key, b.name_norm) as ck, (o.id is null) as plain
    from businesses b
    left join overrides o on o.id = b.id
   where b.org_id = $1::uuid and b.name_norm is not null and b.merged_into_id is null
),
local_counts as (
  select ck, count(*) as n
    from keyed
   group by ck
  having count(*) >= 3
),
statewide_run as (
  select r.stats -> 'statewide_name_frequency' as f
    from ingest_runs r
   where r.org_id = $1::uuid
     and r.source_key = 'tx_comptroller'
     and r.status = 'complete'
     and jsonb_typeof(r.stats -> 'statewide_name_frequency') = 'object'
   order by r.started_at desc nulls last, r.id desc
   limit 1
),
statewide as (
  select s.key as name_norm
    from statewide_run sr
   cross join jsonb_each_text(sr.f) s
   where s.value::int >= 3
),
live as (
  select k.id, k.ck
    from keyed k
   where k.ck in (select ck from local_counts)
      or (k.plain and k.name_norm in (select name_norm from statewide))
),
cleared as (
  update businesses b
     set chain_key = null
   where b.org_id = $1::uuid
     and b.chain_key is not null
     and not exists (select 1 from live l where l.id = b.id)
  returning 1
),
flagged as (
  update businesses b
     set chain_key = l.ck
    from live l
   where b.id = l.id and b.org_id = $1::uuid
     and b.chain_key is distinct from l.ck
  returning 1
)
select (select count(distinct ck) from live)::int as names,
       (select count(*) from live)::int as rows,
       (select count(*) from flagged)::int as flagged,
       (select count(*) from cleared)::int as cleared,
       exists (select 1 from statewide_run) as statewide`,
    values: [orgId, JSON.stringify(overrides)],
  };
}

/**
 * The trade-word overrides for this org's live businesses (B-WR-05): read the names in
 * TypeScript — the normalizer's fold is TypeScript only (src/lib/normalize/name.ts: SQL never
 * normalizes) — and return only the rows whose key differs from their `name_norm`.
 */
export async function chainKeyOverrides(tx: EtlExecutor, orgId: string): Promise<ChainKeyOverride[]> {
  const { rows } = await tx.query<{
    id: string;
    name_norm: string;
    display_name: string | null;
    legal_name: string | null;
  }>(
    `select id, name_norm, display_name, legal_name
       from businesses
      where org_id = $1::uuid and name_norm is not null and merged_into_id is null`,
    [orgId],
  );
  const out: ChainKeyOverride[] = [];
  for (const r of rows) {
    const key = chainKeyOf(r.name_norm, rawNameOf(r));
    if (key !== r.name_norm) out.push({ id: r.id, chain_key: key });
  }
  return out;
}

/** Runs chain detection in the caller's transaction and returns the counts for `stats`. */
export async function detectChains(tx: EtlExecutor, orgId: string): Promise<ChainDetectionResult> {
  const stmt = chainDetectionSql(orgId, await chainKeyOverrides(tx, orgId));
  const { rows } = await tx.query<{
    names: number | string;
    rows: number | string;
    flagged: number | string;
    cleared: number | string;
    statewide: boolean;
  }>(stmt.text, stmt.values);
  const r = rows[0];
  if (!r) throw new Error('detectChains: the statement returned no report row');
  return {
    names: Number(r.names),
    rows: Number(r.rows),
    flagged: Number(r.flagged),
    cleared: Number(r.cleared),
    statewide: r.statewide === true,
  };
}
