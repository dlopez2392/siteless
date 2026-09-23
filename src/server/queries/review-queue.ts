import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { instantOf } from '@/lib/instant';
import { rowsOf, type Tx } from './budget';

/**
 * `/review` (03-UI-SPEC § 1, D-13 / D-15 / D-16): the ONE pair on screen and how many are left.
 *
 * 🔴 ONE TRANSACTION PER REQUEST, NEVER NESTED. `src/db/client.ts` pools with `max: 1`, so a
 * `withOrg` opened inside another waits forever on the connection the outer one holds — the
 * request HANGS rather than failing. `readReviewQueue` takes an open transaction; only
 * `listReviewQueue` opens one. The review action calls `readReviewRemaining` inside its own
 * transaction for the same reason.
 *
 * 🔴 THE ORDER IS D-13's "Skip leaves this pair pending and moves on": `skipped_at nulls first`
 * sinks a skipped pair below everything undecided, and it resurfaces once the rest is worked.
 * Then highest score first (D-16), then the id so two equal scores cannot swap between loads.
 * `merge_candidates_queue_idx` is `(org_id, decision, score desc)`; `skipped_at` sorts outside
 * it, over the pending band only.
 *
 * 🔴 THE NORMALIZED MATCH KEY IS NEVER SELECTED (D-12, UI-SPEC Rule 17) — and neither is
 * `chain_key`, which IS that key (src/lib/resolve/chain.ts). The chain badge renders a member COUNT,
 * never the key, so the view carries the count and nothing that could leak the key.
 *
 * 🔴 A KEY IS NEVER SHOWN TO A PERSON. `cluster_key` is resolved to
 * `industry_clusters.display_name` here — the org's own row first, then the built-in — the
 * way `preset-cards.ts` resolves a geography.
 */

/** The four durable spine sources, as `businesses.primary_source` / `source_records.source_key` spell them. */
export type SpineSourceKey =
  | 'tx_comptroller'
  | 'tx_comptroller_closures'
  | 'overture'
  | 'census_geocoder';

/** D-11: a chain is a flag with a member count. `statewide` says whether "in Texas" is honest. */
export type ChainFlag = {
  /** Statewide Comptroller count when the latest complete permits run measured it; else the
   *  org's own live member count. */
  members: number;
  /** True only when `members` came from the statewide frequency. When false the count is
   *  RGV-only and the badge must not say "in Texas". */
  statewide: boolean;
};

export type CandidateSideView = {
  id: string;
  /** Verbatim, accents intact. Never the normalized key. */
  displayName: string;
  street: string | null;
  city: string | null;
  postal: string | null;
  phoneE164: string | null;
  basicCategory: string | null;
  /** `industry_clusters.display_name`, or null when no cluster is mapped (D-02). */
  clusterName: string | null;
  /** The source that created this record — the inline source tag. */
  sourceKey: SpineSourceKey | null;
  closedAt: Date | null;
  chain: ChainFlag | null;
};

export type CandidatePairView = {
  candidateId: string;
  score: number;
  /** The component vector the chip band renders (src/lib/resolve/score.ts `Features`). Never
   *  carries a normalized name — score.ts T-3-11. */
  features: Record<string, unknown>;
  a: CandidateSideView;
  b: CandidateSideView;
};

/**
 * `ingested` tells the two empty states apart (03-UI-SPEC § States → Empty): "Nothing to review
 * yet" says NO INGEST HAS RUN, so it may only render when no run for this org ever finished
 * (`complete` or `stopped` — a stopped run still wrote rows). Every other empty queue is
 * "Queue clear". A `running` or `failed` run alone has scored nothing, so it does not count.
 */
export type ReviewQueue = {
  top: CandidatePairView | null;
  remaining: number;
  ingested: boolean;
};

/** The review band's floor. Pairs under it never reach a person (D-15). */
export const REVIEW_BAND_FLOOR = 80;

type SideRow = {
  id: string;
  display_name: string;
  street: string | null;
  city: string | null;
  postal: string | null;
  phone_e164: string | null;
  basic_category: string | null;
  cluster_name: string | null;
  primary_source: string | null;
  closed_ms: string | null;
  chain_members: number | null;
  chain_statewide: boolean | null;
};

const SPINE_SOURCES: ReadonlySet<string> = new Set<SpineSourceKey>([
  'tx_comptroller',
  'tx_comptroller_closures',
  'overture',
  'census_geocoder',
]);

export function spineSourceOf(value: string | null): SpineSourceKey | null {
  return value !== null && SPINE_SOURCES.has(value) ? (value as SpineSourceKey) : null;
}

function toSide(r: SideRow): CandidateSideView {
  return {
    id: r.id,
    displayName: r.display_name,
    street: r.street,
    city: r.city,
    postal: r.postal,
    phoneE164: r.phone_e164,
    basicCategory: r.basic_category,
    clusterName: r.cluster_name,
    sourceKey: spineSourceOf(r.primary_source),
    closedAt: instantOf(r.closed_ms),
    chain:
      r.chain_members === null
        ? null
        : { members: r.chain_members, statewide: r.chain_statewide === true },
  };
}

/**
 * 🔴 A-WR-03 (review 03): THE LIVE-ROOTS PREDICATE, shared by the count and the top pair. A
 * reviewer's merge makes other pending pairs stale until the next resolve pass settles them
 * (scripts/resolve.ts stage 6): a side may now be a merged-away loser, and both sides may now
 * be ONE cluster. Each side is read as its live root (`coalesce(merged_into_id, id)` —
 * clusters are flattened, so one hop is the root), and a pair whose roots coincide is not a
 * question any more, so it is neither shown nor counted.
 */
export async function readReviewRemaining(tx: Tx): Promise<number> {
  const row = rowsOf<{ remaining: number }>(
    await tx.execute(sql`
      select count(*)::int as remaining
        from merge_candidates mc
        join businesses l on l.id = mc.left_id and l.org_id = mc.org_id
        join businesses r on r.id = mc.right_id and r.org_id = mc.org_id
       where mc.org_id = (select app.current_org_id())
         and mc.decision = 'pending'
         and mc.score >= ${REVIEW_BAND_FLOOR}
         and coalesce(l.merged_into_id, l.id) <> coalesce(r.merged_into_id, r.id)`),
  )[0];
  return row?.remaining ?? 0;
}

/**
 * 🔴 THE GOOGLE ITEM'S PREDICATE, shared by the count and the top listing (D-05, D-08): a
 * `tentative` attachment in the review band whose spine business is still LIVE. A merged-away
 * loser's listing is not a question a person can answer — confirming it would hang a signal on
 * a business nobody sees — so it is neither shown nor counted. `record_places_page` (0029)
 * already refuses to attach to a merged business; this covers a merge that happened AFTER the
 * listing went tentative. Decided listings (`attached` / `rejected`) never reach the queue.
 */
export async function readGoogleReviewRemaining(tx: Tx): Promise<number> {
  const row = rowsOf<{ remaining: number }>(
    await tx.execute(sql`
      select count(*)::int as remaining
        from place_attachments a
        join businesses b on b.id = a.business_id and b.org_id = a.org_id
       where a.org_id = (select app.current_org_id())
         and a.status = 'tentative'
         and a.score >= ${REVIEW_BAND_FLOOR}
         and b.merged_into_id is null`),
  )[0];
  return row?.remaining ?? 0;
}

export async function readReviewQueue(tx: Tx): Promise<ReviewQueue> {
  const top = rowsOf<{
    id: string;
    left_id: string;
    right_id: string;
    score: number;
    features: Record<string, unknown> | null;
  }>(
    await tx.execute(sql`
      select mc.id,
             coalesce(l.merged_into_id, l.id) as left_id,
             coalesce(r.merged_into_id, r.id) as right_id,
             mc.score, mc.features
        from merge_candidates mc
        join businesses l on l.id = mc.left_id and l.org_id = mc.org_id
        join businesses r on r.id = mc.right_id and r.org_id = mc.org_id
       where mc.org_id = (select app.current_org_id())
         and mc.decision = 'pending'
         and mc.score >= ${REVIEW_BAND_FLOOR}
         and coalesce(l.merged_into_id, l.id) <> coalesce(r.merged_into_id, r.id)
       order by mc.skipped_at nulls first, mc.score desc, mc.id
       limit 1`),
  )[0];

  const remaining = await readReviewRemaining(tx);
  if (!top) return { top: null, remaining, ingested: await readIngested(tx) };

  // Two ids, two scalar parameters — never a JS array in a drizzle template (it expands into N
  // placeholders; see src/db/drizzle-executor.ts).
  const sides = rowsOf<SideRow>(
    await tx.execute(sql`
      with statewide_run as (
        select r.stats -> 'statewide_name_frequency' as f
          from ingest_runs r
         where r.org_id = (select app.current_org_id())
           and r.source_key = 'tx_comptroller'
           and r.status = 'complete'
           and jsonb_typeof(r.stats -> 'statewide_name_frequency') = 'object'
         order by r.started_at desc nulls last, r.id desc
         limit 1
      )
      select b.id,
             b.display_name,
             b.street,
             b.city,
             b.postal,
             b.phone_e164,
             b.basic_category,
             cl.display_name                                         as cluster_name,
             b.primary_source,
             (extract(epoch from b.closed_at) * 1000)::bigint::text  as closed_ms,
             ch.members                                              as chain_members,
             ch.statewide                                            as chain_statewide
        from businesses b
        left join lateral (
          select ic.display_name
            from industry_clusters ic
           where ic.key = b.cluster_key
           order by ic.org_id nulls last
           limit 1
        ) cl on true
        left join lateral (
          select coalesce(sw.n, lc.n)::int as members, sw.n is not null as statewide
            from (select ((select f from statewide_run) ->> b.chain_key)::int as n) sw,
                 (select count(*)::int as n
                    from businesses m
                   where m.org_id = b.org_id
                     and m.chain_key = b.chain_key
                     and m.merged_into_id is null) lc
           where b.chain_key is not null
        ) ch on true
       where b.id = ${top.left_id} or b.id = ${top.right_id}`),
  );

  const left = sides.find((s) => s.id === top.left_id);
  const right = sides.find((s) => s.id === top.right_id);
  // RLS confines both reads to this org and the candidate FK guarantees both sides exist, so
  // a missing side means the claims changed mid-transaction — a bug, not a state to render.
  if (!left || !right) throw new Error('readReviewQueue: a candidate side is not readable');

  return {
    top: {
      candidateId: top.id,
      score: top.score,
      features: top.features ?? {},
      a: toSide(left),
      b: toSide(right),
    },
    remaining,
    // A pending pair exists, so something was scored — no need to ask.
    ingested: true,
  };
}

/** Has any ingest for this org finished writing rows? Read only when the queue is empty. */
async function readIngested(tx: Tx): Promise<boolean> {
  const row = rowsOf<{ ingested: boolean }>(
    await tx.execute(sql`
      select exists (
        select 1
          from ingest_runs r
         where r.org_id = (select app.current_org_id())
           and r.status in ('complete', 'stopped')
      ) as ingested`),
  )[0];
  return row?.ingested === true;
}

export async function listReviewQueue(claims: OrgClaims): Promise<ReviewQueue> {
  return withOrg(claims, (tx) => readReviewQueue(tx));
}
