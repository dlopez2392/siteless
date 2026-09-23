import 'server-only';
import { sql } from 'drizzle-orm';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { instantOf } from '@/lib/instant';
import { rowsOf, type Tx } from './budget';

/**
 * `/review` (03-UI-SPEC § 1, D-13 / D-15 / D-16): the ONE item on screen and how many are left.
 * Since 04-21 (D-05 / D-08, 04-UI-SPEC § Screen 3) an item is a duplicate PAIR or a tentative
 * Google LISTING, in one score-ordered queue with a filter (`ReviewFilter`).
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

/** 04-UI-SPEC § Screen 3 (OQ 3): the queue's filter, reflected in the URL as `?kind=`. */
export type ReviewFilter = 'all' | 'duplicates' | 'google';

/**
 * A tentative Google listing awaiting "Same business" / "Not this business" (D-05, D-08).
 *
 * 🔴 RULE 30 / T-4-05: NOTHING HERE IS GOOGLE-AUTHORED. Google's name, address, phone, rating and
 * website are never stored (D-09), so the item is the SPINE business (`business`, the same
 * `CandidateSideView` a pair side is), the score, the stored NUMERIC features (the
 * `pa_features_numeric` CHECK refuses text in them, drizzle/0029) and the `place_id` the Maps
 * link is built from. `tests/db/review-queue-google.test.ts` pins the key set.
 */
export type GoogleListingView = {
  kind: 'google';
  attachmentId: string;
  placeId: string;
  score: number;
  /** `score`: in the 80–95 band. `tie`: ≥95 against two businesses (D-08). */
  reason: 'score' | 'tie';
  /** The stored matcher features (src/lib/places/page-record.ts FEATURE_KEYS) — numbers only. */
  features: unknown;
  business: CandidateSideView;
  /** For a tie: the OTHER spine business (its live root) and its own score. */
  tie: { businessId: string; displayName: string; score: number } | null;
};

/**
 * `ingested` tells the two empty states apart (03-UI-SPEC § States → Empty): "Nothing to review
 * yet" says NO INGEST HAS RUN, so it may only render when no run for this org ever finished
 * (`complete` or `stopped` — a stopped run still wrote rows). Every other empty queue is
 * "Queue clear". A `running` or `failed` run alone has scored nothing, so it does not count.
 *
 * `remaining` is the FILTERED total (all = both kinds); `counts` is always both kinds, so the
 * "All" header ("{n} left · {d} duplicate pairs, {g} Google listings") and a filtered empty state
 * ("{n} Google listings are still waiting") render from one read.
 */
export type ReviewQueue = {
  top: (CandidatePairView & { kind: 'pair' }) | GoogleListingView | null;
  remaining: number;
  counts: { pairs: number; google: number };
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

type PairTopRow = {
  id: string;
  left_id: string;
  right_id: string;
  score: number;
  features: Record<string, unknown> | null;
  skipped: boolean;
};

/** The best pending pair (D-13 order: a skipped pair sinks, then score, then id). */
async function readTopPair(tx: Tx): Promise<PairTopRow | undefined> {
  return rowsOf<PairTopRow>(
    await tx.execute(sql`
      select mc.id,
             coalesce(l.merged_into_id, l.id) as left_id,
             coalesce(r.merged_into_id, r.id) as right_id,
             mc.score, mc.features,
             mc.skipped_at is not null as skipped
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
}

type ListingTopRow = {
  id: string;
  place_id: string;
  score: number;
  reason: string;
  features: unknown;
  business_id: string;
  tie_business_id: string | null;
  tie_name: string | null;
  tie_score: number | null;
};

/**
 * The best tentative listing (score, then id) under `readGoogleReviewRemaining`'s predicate.
 *
 * A tie partner is read as its LIVE ROOT (A-WR-03's one hop): the reason sentence links to the
 * partner's detail, which must be a business a person can open. Its score is the partner's own
 * attachment row for the same place (0029 writes both tie rows). Only spine columns and the
 * numeric row are selected — never an observation, never a coordinate.
 */
async function readTopListing(tx: Tx): Promise<ListingTopRow | undefined> {
  return rowsOf<ListingTopRow>(
    await tx.execute(sql`
      select a.id,
             a.place_id,
             a.score,
             a.reason,
             a.features,
             a.business_id,
             tr.id           as tie_business_id,
             tr.display_name as tie_name,
             tp.score        as tie_score
        from place_attachments a
        join businesses b on b.id = a.business_id and b.org_id = a.org_id
        left join businesses tb on tb.id = a.tie_business_id and tb.org_id = a.org_id
        left join businesses tr on tr.id = coalesce(tb.merged_into_id, tb.id) and tr.org_id = a.org_id
        left join place_attachments tp on tp.org_id = a.org_id
                                      and tp.business_id = a.tie_business_id
                                      and tp.place_id = a.place_id
       where a.org_id = (select app.current_org_id())
         and a.status = 'tentative'
         and a.score >= ${REVIEW_BAND_FLOOR}
         and b.merged_into_id is null
       order by a.score desc, a.id
       limit 1`),
  )[0];
}

/**
 * ONE queue, two kinds, one ordering (04-UI-SPEC § Screen 3, OQ 3): the higher of the best
 * pending pair and the best tentative listing by score; on equal scores the PAIR first, so two
 * loads never swap. A SKIPPED pair sinks below every undecided item of either kind (D-13 — a
 * Google listing has no skip state: "Skip" writes nothing). A filtered-out kind is not read.
 */
export async function readReviewQueue(
  tx: Tx,
  filter: ReviewFilter = 'all',
): Promise<ReviewQueue> {
  const counts = {
    pairs: await readReviewRemaining(tx),
    google: await readGoogleReviewRemaining(tx),
  };
  const remaining =
    filter === 'duplicates'
      ? counts.pairs
      : filter === 'google'
        ? counts.google
        : counts.pairs + counts.google;

  const pair = filter === 'google' ? undefined : await readTopPair(tx);
  const listing = filter === 'duplicates' ? undefined : await readTopListing(tx);

  if (listing && (!pair || pair.skipped || listing.score > pair.score)) {
    const [side] = await readSides(tx, listing.business_id, listing.business_id);
    if (!side) throw new Error('readReviewQueue: a listing business is not readable');
    return {
      top: {
        kind: 'google',
        attachmentId: listing.id,
        placeId: listing.place_id,
        score: listing.score,
        reason: listing.reason === 'tie' ? 'tie' : 'score',
        features: listing.features ?? {},
        business: toSide(side),
        tie:
          listing.reason === 'tie' && listing.tie_business_id !== null && listing.tie_name !== null
            ? {
                businessId: listing.tie_business_id,
                displayName: listing.tie_name,
                score: listing.tie_score ?? listing.score,
              }
            : null,
      },
      remaining,
      counts,
      // A pending item exists, so something was scored — no need to ask.
      ingested: true,
    };
  }

  if (!pair) {
    return {
      top: null,
      remaining,
      counts,
      // The OTHER kind still waiting (a filtered queue) means something was scored.
      ingested: counts.pairs + counts.google > 0 || (await readIngested(tx)),
    };
  }

  const top = pair;
  const sides = await readSides(tx, top.left_id, top.right_id);
  const left = sides.find((s) => s.id === top.left_id);
  const right = sides.find((s) => s.id === top.right_id);
  // RLS confines both reads to this org and the candidate FK guarantees both sides exist, so
  // a missing side means the claims changed mid-transaction — a bug, not a state to render.
  if (!left || !right) throw new Error('readReviewQueue: a candidate side is not readable');

  return {
    top: {
      kind: 'pair',
      candidateId: top.id,
      score: top.score,
      features: top.features ?? {},
      a: toSide(left),
      b: toSide(right),
    },
    remaining,
    counts,
    // A pending pair exists, so something was scored — no need to ask.
    ingested: true,
  };
}

/**
 * The spine side(s) of one queue item — a pair's two live roots, or a listing's one business
 * (pass it twice). Two ids, two scalar parameters — never a JS array in a drizzle template (it
 * expands into N placeholders; see src/db/drizzle-executor.ts).
 */
async function readSides(tx: Tx, firstId: string, secondId: string): Promise<SideRow[]> {
  return rowsOf<SideRow>(
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
       where b.id = ${firstId} or b.id = ${secondId}`),
  );
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

/** `/review`'s one read — ONE `withOrg` for both kinds, the counts and the empty-state flag. */
export async function listReviewQueue(
  claims: OrgClaims,
  filter: ReviewFilter = 'all',
): Promise<ReviewQueue> {
  return withOrg(claims, (tx) => readReviewQueue(tx, filter));
}
