import { APP_TZ } from '@/lib/time';
import type { SqlStatement } from '@/lib/resolve/block';
import type { EtlExecutor } from './etl-actor';

/**
 * D-03: apply the Comptroller closure feed (`3kx8-uryv`, source_key `tx_comptroller_closures`)
 * to the spine. EXACT MATCH ONLY — no fuzzy logic on this feed, ever.
 *
 * A closure source record's `external_id` is `tp_number-loc_number`, built by the same
 * `comptrollerExternalId` the permits transform uses (src/lib/socrata/closures.ts), so it equals
 * the permit business's `comptroller_key` character for character. That equality IS the match.
 * `32006170057-5` never closes `32006170057-6`, and nothing else is consulted.
 *
 * 🔴 ON A MERGED-AWAY BUSINESS THE CLOSURE LANDS ON THE WINNER, resolved through
 * `coalesce(merged_into_id, id)`. The loser is not the business anybody sees any more.
 *
 * 🔴 THE DATE IS A TEXAS BUSINESS DATE. `out_of_business_date` is stored in the payload as
 * Socrata's floating timestamp (`"1993-03-03T00:00:00.000"`, no zone). It is read in
 * `APP_TZ` (America/Chicago) IN SQL — `::timestamp at time zone $2` — never as UTC, or every
 * closure lands the evening before (and on 31 December, a year early). The instant is the same
 * one `closureRowToSourceRecord().closedAt` computes in TypeScript; tests/db/chain-closures.test.ts
 * pins the two against each other.
 *
 * 🔴 THIS IS THE ONLY WRITER OF `closed_at` (D-03, D-14). Overture's `permanently_closed` lives
 * in `operating_status`, is stored and reported, and never reaches `closed_at`; Phase 6 decides
 * what it means. The composite FK `businesses_closed_at_src_fk` (drizzle/0023) makes the
 * provenance pair cite a DURABLE source record.
 *
 * WRITE-GATED: a business already carrying this exact closure is not touched, so a re-run of an
 * unchanged feed writes no `events` rows (`businesses` carries `app.log_event`).
 *
 * Handoff: 03-12's `scripts/ingest-comptroller.ts` runs its closure pass through this statement
 * rather than re-typing it — a script that re-types the SQL is exactly what the DB proof cannot
 * catch.
 *
 * $1 org id · $2 the app zone. Returns `{ n }`, the businesses whose closure it wrote.
 */
export function closureApplySql(orgId: string): SqlStatement {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('closureApplySql: an org id is required — the closure pass is org-scoped');
  }
  return {
    text: `with closures as (
  select distinct on (coalesce(b.merged_into_id, b.id))
         coalesce(b.merged_into_id, b.id) as target_id,
         sr.id as source_id,
         (sr.payload->>'out_of_business_date')::timestamp at time zone $2::text as closed_at
    from source_records sr
    join businesses b
      on b.org_id = sr.org_id
     and b.comptroller_key = sr.external_id
   where sr.org_id = $1::uuid
     and sr.source_key = 'tx_comptroller_closures'
     and sr.payload->>'out_of_business_date' is not null
   order by coalesce(b.merged_into_id, b.id), closed_at desc, sr.id
),
applied as (
  update businesses w
     set closed_at = c.closed_at,
         closed_at_source_id = c.source_id
    from closures c
   where w.org_id = $1::uuid
     and w.id = c.target_id
     and (w.closed_at is distinct from c.closed_at
          or w.closed_at_source_id is distinct from c.source_id)
  returning 1
)
select count(*)::int as n from applied`,
    values: [orgId, APP_TZ],
  };
}

/** Runs the closure pass in the caller's transaction. Returns how many businesses it closed. */
export async function applyClosures(tx: EtlExecutor, orgId: string): Promise<number> {
  const stmt = closureApplySql(orgId);
  const { rows } = await tx.query<{ n: number | string }>(stmt.text, stmt.values);
  return Number(rows[0]?.n ?? 0);
}
