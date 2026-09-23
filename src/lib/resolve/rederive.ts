import type { EtlExecutor } from '@/lib/ingest/etl-actor';
import type { DerivationContext } from './derivation';
import { readRootParents, survivorshipJson } from './merge';
import { survive } from './survivorship';

/**
 * Re-deriving a business's survivorship-owned columns from its stored parents — the desk-tier
 * half of A-CR-02 and A-WR-06 (review 03).
 *
 * 🔴 WHY THIS EXISTS. A merged business's columns are a FUNCTION of every parent in its cluster
 * (D-14). Anything that changes one parent — a re-ingest whose payload moved, a Census answer
 * that moved, a derivation rule that changed — has to re-run that function for the cluster ROOT,
 * never write one record's values straight onto "its" business. That direct write was A-CR-02:
 * it reverted a winner's Overture name to the Comptroller outlet_name, and it landed a loser's
 * new phone on the dead loser row while the winner kept citing the record.
 *
 * 🔴 ONE survive(), THE MERGE'S. `readRootParents` + `survive` + `survivorshipJson` are exactly
 * what `mergePair` hands `app.record_merge`, in `complete` mode (every parent is present, so a
 * derived column no parent carries is NULL).
 *
 * 🔴 WRITE-GATED IN THE DATABASE. `app.apply_survivorship_if_changed` (drizzle/0025) compares the
 * typed row and writes only on a real difference, so re-deriving an unchanged cluster writes no
 * `businesses` event (DATA-04). It is owner-only: this module is for the desk tier (the ingests,
 * the rederive pass), never the app.
 *
 * 🔴 THE ORG CLAIM MUST BE INSTALLED. The parent read is scoped `app.current_org_id()`, like
 * every read in merge.ts. On the desk tier that claim exists only after `resolveEtlOrg` in THIS
 * transaction; without it the read would return nothing and the re-derivation would silently
 * do nothing — so it is checked, and a missing claim throws.
 */

export interface ClusterPosition {
  /** `coalesce(merged_into_id, id)`: the business the cluster's columns live on. */
  root: string;
  /** Merged into something, or something is merged into it. */
  clustered: boolean;
}

export async function clusterOf(
  tx: EtlExecutor,
  orgId: string,
  businessId: string,
): Promise<ClusterPosition> {
  const { rows } = await tx.query<{ root: string; clustered: boolean }>(
    `select coalesce(b.merged_into_id, b.id) as root,
            (b.merged_into_id is not null
             or exists (select 1 from businesses m
                         where m.org_id = $2::uuid and m.merged_into_id = b.id)) as clustered
       from businesses b
      where b.id = $1::uuid and b.org_id = $2::uuid`,
    [businessId, orgId],
  );
  const row = rows[0];
  if (!row) throw new Error(`clusterOf: business ${businessId} is not in org ${orgId}`);
  return { root: row.root, clustered: row.clustered === true };
}

async function assertOrgClaim(tx: EtlExecutor, orgId: string): Promise<void> {
  const { rows } = await tx.query<{ ok: boolean }>(
    'select app.current_org_id() is not distinct from $1::uuid as ok',
    [orgId],
  );
  if (rows[0]?.ok !== true) {
    throw new Error(
      `rederive: the transaction's org claim is not ${orgId}. Run setEtlActor + resolveEtlOrg ` +
        'in this transaction first — the parent read is scoped by the claim, and without it ' +
        'the re-derivation would read nothing and change nothing.',
    );
  }
}

/**
 * Re-derives the cluster root's survivorship-owned columns from every member's parents.
 * Returns whether anything was written.
 */
export async function rederiveRoot(
  tx: EtlExecutor,
  orgId: string,
  rootId: string,
  opts: { caller: string; ctx?: DerivationContext },
): Promise<boolean> {
  await assertOrgClaim(tx, orgId);
  const parents = await readRootParents(tx, rootId, opts.ctx);
  const fields = survivorshipJson(survive(parents), parents.length, { complete: true });
  const { rows } = await tx.query<{ wrote: boolean }>(
    'select app.apply_survivorship_if_changed($1::uuid, $2::uuid, $3::jsonb, $4::text) as wrote',
    [orgId, rootId, JSON.stringify(fields), opts.caller],
  );
  return rows[0]?.wrote === true;
}
