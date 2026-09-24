/**
 * The review queue's second item kind (plan 04-21, D-05 / D-08, UI-SPEC § Screen 3 and OQ 3):
 * tentative Google listings join the Phase 3 duplicate pairs in ONE score-ordered queue,
 * filterable all / duplicates / google — read as a Clerk user, through RLS.
 *
 * 🔴 RULE 30 / T-4-05: a Google item carries the SPINE side, the score and the numeric features
 * only. Google's name, address, phone and website are never stored, so they cannot be carried —
 * the key-set test below is what goes red if a later read tries to add one anyway.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readReviewQueue, type GoogleListingView } from '@/server/queries/review-queue';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { CLAIMS_A, CLAIMS_B, seedMergePair } from './_merge-fixtures';
import { seedAttachmentWithObservation, seedPlacesRun, seedPlacesSpine } from './_places-fixtures';

vi.mock('server-only', () => ({}));

afterAll(async () => {
  await closeDrizzleTx();
});

/** Every key at every depth, as `Object.keys` reports it — not a value scan. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const key of Object.keys(value)) {
      out.add(key);
      allKeys((value as Record<string, unknown>)[key], out);
    }
  }
  return out;
}

/** Google-authored fields, in every spelling a view could carry (Places API names + ours). */
const GOOGLE_AUTHORED = [
  'websiteUri',
  'website_uri',
  'formattedAddress',
  'formatted_address',
  'nationalPhoneNumber',
  'national_phone_number',
  'internationalPhoneNumber',
  'displayName.text',
  'rating',
  'userRatingCount',
  'lat',
  'lng',
  'location',
];

type Seeded = Awaited<ReturnType<typeof seedAll>>;

/** Org A: the Places spine, one running run, and one Phase 3 pending pair at `pairScore`. */
async function seedAll(c: ReturnType<typeof asPg>, pairScore: number) {
  const orgs = await seedTwoOrgs(c);
  const spine = await seedPlacesSpine(c, orgs.a);
  const run = await seedPlacesRun(c, orgs.a);
  const pair = await seedMergePair(c, orgs.a);
  await c.query('update merge_candidates set score = $2 where id = $1', [
    pair.candidateId,
    pairScore,
  ]);
  return { orgs, spine, run, pair };
}

async function tentative(
  c: ReturnType<typeof asPg>,
  s: Seeded,
  businessId: string,
  placeId: string,
  score: number,
): Promise<string> {
  const { attachmentId } = await seedAttachmentWithObservation(c, {
    orgId: s.orgs.a,
    businessId,
    placeId,
    runId: s.run.runId,
    status: 'tentative',
    hadWebsiteUri: false,
    hostClass: 'none',
  });
  await c.query('update place_attachments set score = $2 where id = $1', [attachmentId, score]);
  return attachmentId;
}

describe('review queue — the google item kind', () => {
  it('the review queue orders both kinds by score', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 90);
      const listing = await tentative(c, s, s.spine.ortiz, 'ChIJ_ortiz_92', 92);
      await actAs(c, CLAIMS_A);

      const all = await readReviewQueue(tx);
      expect(all.top?.kind).toBe('google');
      expect(all.top?.kind === 'google' && all.top.attachmentId).toBe(listing);
      expect(all.top?.score).toBe(92);

      const duplicates = await readReviewQueue(tx, 'duplicates');
      expect(duplicates.top?.kind).toBe('pair');
      expect(duplicates.top?.kind === 'pair' && duplicates.top.candidateId).toBe(
        s.pair.candidateId,
      );

      const google = await readReviewQueue(tx, 'google');
      expect(google.top?.kind).toBe('google');

      // The pair outranks the listing once its score is higher — one ordering, not two queues.
      await actAsOwner(c);
      await c.query('update merge_candidates set score = 93 where id = $1', [s.pair.candidateId]);
      await actAs(c, CLAIMS_A);
      expect((await readReviewQueue(tx)).top?.kind).toBe('pair');

      // Equal scores: the pair first (kind), never a coin toss between loads.
      await actAsOwner(c);
      await c.query('update merge_candidates set score = 92 where id = $1', [s.pair.candidateId]);
      await actAs(c, CLAIMS_A);
      expect((await readReviewQueue(tx)).top?.kind).toBe('pair');

      // A skipped pair sinks below everything undecided — the Google listing included (D-13).
      await actAsOwner(c);
      await c.query(
        'update merge_candidates set score = 95, skipped_at = now() where id = $1',
        [s.pair.candidateId],
      );
      await actAs(c, CLAIMS_A);
      expect((await readReviewQueue(tx)).top?.kind).toBe('google');
    }));

  it('the review queue counts both kinds', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 90);
      await tentative(c, s, s.spine.ortiz, 'ChIJ_ortiz_count', 88);
      // Not counted: under the review band, decided, and on a merged-away business.
      await tentative(c, s, s.spine.garza, 'ChIJ_garza_low', 79);
      await seedAttachmentWithObservation(c, {
        orgId: s.orgs.a,
        businessId: s.spine.valley,
        placeId: 'ChIJ_valley_attached',
        runId: s.run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      await tentative(c, s, s.spine.rio, 'ChIJ_rio_loser', 90);
      await c.query("update businesses set merged_into_id = $2, status = 'merged' where id = $1", [
        s.spine.rio,
        s.spine.rioCo,
      ]);
      await actAs(c, CLAIMS_A);

      const all = await readReviewQueue(tx);
      expect(all.counts).toEqual({ pairs: 1, google: 1 });
      expect(all.remaining).toBe(2);
      expect((await readReviewQueue(tx, 'duplicates')).remaining).toBe(1);
      expect((await readReviewQueue(tx, 'google')).remaining).toBe(1);
      // The merged-away loser's listing is never the one on screen.
      const google = await readReviewQueue(tx, 'google');
      expect(google.top?.kind === 'google' && google.top.business.id).toBe(s.spine.ortiz);

      // RLS: org B sees none of org A's items.
      await actAs(c, CLAIMS_B);
      const theirs = await readReviewQueue(tx);
      expect(theirs.counts).toEqual({ pairs: 0, google: 0 });
      expect(theirs.top).toBeNull();
    }));

  it("the google item carries the tie partner's name and score", () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 85);
      const mine = await tentative(c, s, s.spine.rio, 'ChIJ_rio_tie', 97);
      const theirs = await tentative(c, s, s.spine.rioCo, 'ChIJ_rio_tie', 96);
      await c.query(
        `update place_attachments set reason = 'tie', tie_business_id = $2 where id = $1`,
        [mine, s.spine.rioCo],
      );
      await c.query(
        `update place_attachments set reason = 'tie', tie_business_id = $2 where id = $1`,
        [theirs, s.spine.rio],
      );
      await actAs(c, CLAIMS_A);

      const queue = await readReviewQueue(tx, 'google');
      expect(queue.top?.kind).toBe('google');
      const top = queue.top as GoogleListingView;
      expect(top.attachmentId).toBe(mine);
      expect(top.reason).toBe('tie');
      expect(top.tie).toEqual({
        businessId: s.spine.rioCo,
        displayName: 'Rio Roofing Co',
        score: 96,
      });
      expect(queue.counts.google).toBe(2);

      // A score-band listing has no tie.
      await actAsOwner(c);
      await c.query(`update place_attachments set status = 'attached' where id in ($1, $2)`, [
        mine,
        theirs,
      ]);
      await tentative(c, s, s.spine.garza, 'ChIJ_garza_band', 86);
      await actAs(c, CLAIMS_A);
      const band = (await readReviewQueue(tx, 'google')).top as GoogleListingView;
      expect(band.reason).toBe('score');
      expect(band.tie).toBeNull();
    }));

  it('the google item carries the spine side and numeric features only', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 81);
      const listing = await tentative(c, s, s.spine.ortiz, 'ChIJ_ortiz_side', 89);
      await actAs(c, CLAIMS_A);

      const queue = await readReviewQueue(tx, 'google');
      const top = queue.top as GoogleListingView;
      expect(Object.keys(top).sort()).toEqual(
        [
          'attachmentId',
          'business',
          'features',
          'kind',
          'placeId',
          'reason',
          'score',
          'tie',
        ].sort(),
      );
      expect(top).toMatchObject({
        kind: 'google',
        attachmentId: listing,
        placeId: 'ChIJ_ortiz_side',
        score: 89,
        reason: 'score',
        tie: null,
      });
      // The stored features object, verbatim (the fixture's numeric allow-listed keys).
      expect(top.features).toEqual({ name: 30 });
      // The spine side is the Phase 3 CandidateSideView of the business — the same shape the
      // pair renders, so SpineRecordCard can take either.
      expect(top.business).toMatchObject({
        id: s.spine.ortiz,
        displayName: 'Ortiz Plumbing',
        street: '1200 N 10th St',
        city: 'McAllen',
        postal: '78501',
        phoneE164: '+19566310001',
        sourceKey: 'overture',
        closedAt: null,
      });
      const pairTop = (await readReviewQueue(tx, 'duplicates')).top;
      if (pairTop?.kind !== 'pair') throw new Error('expected the seeded pair');
      expect(Object.keys(top.business).sort()).toEqual(Object.keys(pairTop.a).sort());

      const keys = allKeys(queue);
      for (const field of GOOGLE_AUTHORED) {
        expect(keys.has(field), `the queue carries ${field}`).toBe(false);
      }
    }));

  it('a listing skipped this session sinks below every undecided item', () =>
    // 04-24: "Skip" on a listing writes nothing (0029 has no skip column), so the screen carries
    // the ids it skipped (`?skip=`) and the queue sinks them — D-13's rule for a skipped pair:
    // leave it pending, move on, and let it resurface once the rest is worked.
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 85);
      const high = await tentative(c, s, s.spine.ortiz, 'ChIJ_ortiz_skip_high', 93);
      const low = await tentative(c, s, s.spine.garza, 'ChIJ_garza_skip_low', 82);
      await actAs(c, CLAIMS_A);

      // Nothing skipped: the highest listing, then (google filter) the order is by score.
      const fresh = (await readReviewQueue(tx, 'google')).top as GoogleListingView;
      expect(fresh.attachmentId).toBe(high);

      // The 93 skipped: the 82 is next, below it but not skipped.
      const next = await readReviewQueue(tx, 'google', [high]);
      expect((next.top as GoogleListingView).attachmentId).toBe(low);
      // Still pending, still counted — a skip is not a decision.
      expect(next.remaining).toBe(2);

      // In the mixed queue the skipped 93 falls below the 85 pair as well — even when every
      // listing is skipped, so the best listing left to compare IS a skipped one.
      expect((await readReviewQueue(tx, 'all', [high])).top?.kind).toBe('pair');
      expect((await readReviewQueue(tx, 'all', [high, low])).top?.kind).toBe('pair');

      // Everything skipped: the skipped ones resurface, highest first — never an empty screen
      // while listings are still pending.
      const again = await readReviewQueue(tx, 'google', [high, low]);
      expect((again.top as GoogleListingView).attachmentId).toBe(high);

      // An id that is not a listing of this org changes nothing.
      const foreign = await readReviewQueue(tx, 'google', ['00000000-0000-4000-8000-000000000000']);
      expect((foreign.top as GoogleListingView).attachmentId).toBe(high);
    }));

  it('existing pair behaviour is unchanged', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const s = await seedAll(c, 88);
      await actAs(c, CLAIMS_A);

      const queue = await readReviewQueue(tx);
      expect(queue.top?.kind).toBe('pair');
      expect(queue.counts).toEqual({ pairs: 1, google: 0 });
      expect(queue.remaining).toBe(1);
      expect(queue.ingested).toBe(true);
      const top = queue.top;
      if (top?.kind !== 'pair') throw new Error('expected a pair');
      expect(top.candidateId).toBe(s.pair.candidateId);
      expect(top.score).toBe(88);
      expect(new Set([top.a.id, top.b.id])).toEqual(
        new Set([s.pair.comptroller.businessId, s.pair.overture.businessId]),
      );

      // The google filter on a queue with only pairs: empty, and it says so with a count.
      const google = await readReviewQueue(tx, 'google');
      expect(google.top).toBeNull();
      expect(google.remaining).toBe(0);
      expect(google.counts).toEqual({ pairs: 1, google: 0 });
      // Something WAS scored (a pair waits), so this is "no Google listings", never "nothing
      // ingested yet".
      expect(google.ingested).toBe(true);
    }));
});
