/**
 * The Google listing decisions (plan 04-21, D-05 / UI OQ 6): `recordListingDecision` ("Same
 * business" / "Not this business" / "Skip" on the review queue) and `detachListing` (the
 * business detail's reversal path) — against the real database as a Clerk user.
 *
 * Only the request plumbing is replaced, exactly as `tests/db/review-actions.test.ts` does it:
 * `requireOrg` / `orgClaims` (Clerk has no request here), `revalidatePath`, and `withOrg` —
 * which here opens a SAVEPOINT in the test's rolled-back transaction and does what the real one
 * does inside it (the claims via `set_config(..., true)`, then `set local role authenticated`).
 * A refused definer call therefore rolls back only its savepoint, and the action's
 * `pgFailure()` mapping runs on a REAL driver error chain.
 *
 * 🔴 `vi.doMock` + DYNAMIC IMPORT, UNDONE IN `afterAll` — the DB suite runs `isolate: false`,
 * so a hoisted mock of `@/db/with-org` could reach another file's real import of it.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrgClaims } from '@/db/with-org';
import {
  DETACH_FAILED,
  NOT_FOUND,
  REVIEW_GOOGLE_ALREADY_DECIDED,
  REVIEW_GOOGLE_TIE_TAKEN,
} from '@/lib/ui/copy';
import type { Tx } from '@/server/queries/budget';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedAttachmentWithObservation,
  seedPlacesRun,
  seedPlacesSpine,
} from './_places-fixtures';

vi.mock('server-only', () => ({}));

const USER_A: OrgClaims = {
  o: { id: 'org_A' },
  sub: 'user_reviewer_A',
  role: 'authenticated',
  org_role: 'org:admin',
};
const USER_B: OrgClaims = {
  o: { id: 'org_B' },
  sub: 'user_reviewer_B',
  role: 'authenticated',
  org_role: 'org:admin',
};

/** The request the mocked plumbing answers for: who is calling, inside which transaction. */
const request: { tx: Tx | null; claims: OrgClaims; withOrgCalls: number } = {
  tx: null,
  claims: USER_A,
  withOrgCalls: 0,
};

type Actions = {
  recordListingDecision: typeof import('@/server/actions/record-listing-decision').recordListingDecision;
  detachListing: typeof import('@/server/actions/detach-listing').detachListing;
};
let actions: Actions;

type Queries = {
  readGoogleCheck: typeof import('@/server/queries/businesses').readGoogleCheck;
  readBusinessDetail: typeof import('@/server/queries/businesses').readBusinessDetail;
};
let queries: Queries;

const MOCKED = ['@/lib/auth/require-org', 'next/cache', '@/db/with-org'] as const;

beforeAll(async () => {
  vi.doMock('@/lib/auth/require-org', () => ({
    requireOrg: async () => ({
      userId: request.claims.sub,
      orgId: request.claims.o.id,
      orgSlug: null,
    }),
    orgClaims: async () => request.claims,
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.doMock('@/db/with-org', () => ({
    withOrg: async <T>(claims: OrgClaims, fn: (tx: Tx) => Promise<T>): Promise<T> => {
      request.withOrgCalls += 1;
      const outer = request.tx;
      if (!outer) throw new Error('listing-actions: no request transaction is open');
      return outer.transaction(async (sp) => {
        const tx = sp as unknown as Tx;
        await tx.execute(
          sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
        );
        await tx.execute(sql`set local role authenticated`);
        return fn(tx);
      });
    },
  }));
  const decision = await import('@/server/actions/record-listing-decision');
  const detach = await import('@/server/actions/detach-listing');
  actions = {
    recordListingDecision: decision.recordListingDecision,
    detachListing: detach.detachListing,
  };
  // The reads take an open transaction and never call withOrg, so the mock is irrelevant to
  // them; imported dynamically anyway so this file's module graph is loaded in one place.
  const businesses = await import('@/server/queries/businesses');
  queries = {
    readGoogleCheck: businesses.readGoogleCheck,
    readBusinessDetail: businesses.readBusinessDetail,
  };
});

afterAll(async () => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.resetModules();
  request.tx = null;
  await closeDrizzleTx();
});

type Row = { status: string; reason: string; decided_by: string | null };

async function attachmentRow(tx: Tx, attachmentId: string): Promise<Row | undefined> {
  const c = asPg(tx);
  await actAsOwner(c);
  const r = await c.query<Row>(
    'select status, reason, decided_by from place_attachments where id = $1',
    [attachmentId],
  );
  return r.rows[0];
}

/** Org A's spine and one running run, as the owner; the request answers as USER_A. */
async function seedOrgA(tx: Tx) {
  const c = asPg(tx);
  const orgs = await seedTwoOrgs(c);
  const spine = await seedPlacesSpine(c, orgs.a);
  const run = await seedPlacesRun(c, orgs.a);
  request.tx = tx;
  request.claims = USER_A;
  request.withOrgCalls = 0;
  return { c, orgs, spine, run };
}

describe('recordListingDecision', () => {
  it('same business confirms a tentative listing', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.ortiz,
        placeId: 'ChIJ_ortiz_tentative',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });

      const result = await actions.recordListingDecision({ attachmentId, decision: 'attached' });
      expect(result).toEqual({
        ok: true,
        data: { remaining: 0, businessName: 'Ortiz Plumbing' },
      });
      expect(await attachmentRow(tx, attachmentId)).toEqual({
        status: 'attached',
        reason: 'confirmed',
        decided_by: 'user_reviewer_A',
      });
    }));

  it('not this business rejects a tentative listing', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.garza,
        placeId: 'ChIJ_garza_tentative',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: true,
        hostClass: 'social',
      });

      const result = await actions.recordListingDecision({ attachmentId, decision: 'rejected' });
      expect(result).toEqual({
        ok: true,
        data: { remaining: 0, businessName: 'Garza Electric' },
      });
      expect(await attachmentRow(tx, attachmentId)).toEqual({
        status: 'rejected',
        reason: 'rejected',
        decided_by: 'user_reviewer_A',
      });
    }));

  it('skip records nothing', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.valley,
        placeId: 'ChIJ_valley_tentative',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      const before = await attachmentRow(tx, attachmentId);
      expect(before).toEqual({ status: 'tentative', reason: 'score', decided_by: null });

      const result = await actions.recordListingDecision({ attachmentId, decision: 'skip' });
      // The listing is still pending, so it still counts.
      expect(result).toEqual({
        ok: true,
        data: { remaining: 1, businessName: 'Valley Locksmith' },
      });
      expect(await attachmentRow(tx, attachmentId)).toEqual(before);
    }));

  it('a listing already decided elsewhere is a conflict', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.rio,
        placeId: 'ChIJ_rio_tentative',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });

      expect(await actions.recordListingDecision({ attachmentId, decision: 'attached' })).toMatchObject(
        { ok: true },
      );
      // The second reviewer, on a stale screen, says "Not this business".
      expect(
        await actions.recordListingDecision({ attachmentId, decision: 'rejected' }),
      ).toEqual({
        ok: false,
        code: 'conflict',
        message: REVIEW_GOOGLE_ALREADY_DECIDED,
        detail: { reason: 'already_decided' },
      });
      // The first decision stands.
      expect((await attachmentRow(tx, attachmentId))?.status).toBe('attached');
    }));

  // 0030 (A-WR-03) refuses confirming one side of a tie whose OTHER side a human already
  // confirmed — 55000, the same code as a stale screen. The generic "someone already decided
  // this listing" is false here: nobody decided THIS row. The action says what happened: the
  // place was confirmed for the other business, so it can't also be this one's.
  it('confirming a tie the other business already holds says which business has it', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const mine = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.rio,
        placeId: 'ChIJ_rio_tie',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      const theirs = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.rioCo,
        placeId: 'ChIJ_rio_tie',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      await c.query(
        `update place_attachments set reason = 'tie', tie_business_id = $1 where id = $2`,
        [spine.rioCo, mine.attachmentId],
      );
      await c.query(`update place_attachments set reason = 'confirmed' where id = $1`, [
        theirs.attachmentId,
      ]);

      expect(
        await actions.recordListingDecision({
          attachmentId: mine.attachmentId,
          decision: 'attached',
        }),
      ).toEqual({
        ok: false,
        code: 'conflict',
        message: REVIEW_GOOGLE_TIE_TAKEN('Rio Roofing Co'),
        detail: { reason: 'tie_confirmed_elsewhere' },
      });
      // Nothing moved: this side is still pending, the other still confirmed.
      expect((await attachmentRow(tx, mine.attachmentId))?.status).toBe('tentative');
      expect(await attachmentRow(tx, theirs.attachmentId)).toMatchObject({
        status: 'attached',
        reason: 'confirmed',
      });
    }));

  it("another org's listing is not found", () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.ortiz,
        placeId: 'ChIJ_ortiz_foreign',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      request.claims = USER_B;

      const foreign = await actions.recordListingDecision({ attachmentId, decision: 'attached' });
      expect(foreign).toEqual({ ok: false, code: 'not_found', message: NOT_FOUND('listing') });
      // A skip is a read, and a foreign read is the same answer.
      expect(await actions.recordListingDecision({ attachmentId, decision: 'skip' })).toEqual(
        foreign,
      );
      // An id that never existed is indistinguishable from a foreign one.
      expect(
        await actions.recordListingDecision({ attachmentId: randomUUID(), decision: 'rejected' }),
      ).toEqual(foreign);
      // Nothing of org A's was touched.
      expect(await attachmentRow(tx, attachmentId)).toEqual({
        status: 'tentative',
        reason: 'score',
        decided_by: null,
      });
    }));

  it('a malformed listing id is a validation failure', () =>
    withTxRollback(async (tx) => {
      await seedOrgA(tx);
      expect(await actions.recordListingDecision({ attachmentId: 'x', decision: 'attached' }))
        .toMatchObject({ ok: false, code: 'validation' });
      expect(
        await actions.recordListingDecision({ attachmentId: randomUUID(), decision: 'confirm' }),
      ).toMatchObject({ ok: false, code: 'validation' });
      expect(
        await actions.recordListingDecision({
          attachmentId: randomUUID(),
          decision: 'attached',
          decidedBy: 'someone else',
        }),
      ).toMatchObject({ ok: false, code: 'validation' });
      // Refused before any transaction was opened.
      expect(request.withOrgCalls).toBe(0);
    }));
});

describe('detachListing', () => {
  it('detach rejects an attached listing and drops it from the signal', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.ortiz,
        placeId: 'ChIJ_ortiz_attached',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'directory',
      });
      const signal = async () =>
        (
          await c.query<{ n: number }>(
            'select count(*)::int as n from business_place_signal where business_id = $1',
            [spine.ortiz],
          )
        ).rows[0]?.n;
      expect(await signal()).toBe(1);

      expect(await actions.detachListing({ attachmentId })).toEqual({
        ok: true,
        data: { businessId: spine.ortiz, businessName: 'Ortiz Plumbing' },
      });
      expect(await attachmentRow(tx, attachmentId)).toEqual({
        status: 'rejected',
        reason: 'detached',
        decided_by: 'user_reviewer_A',
      });
      // It was the only attached listing: the business has no Google signal any more.
      expect(await signal()).toBe(0);
    }));

  it('detach refuses a tentative listing', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.garza,
        placeId: 'ChIJ_garza_pending',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: false,
        hostClass: 'none',
      });

      expect(await actions.detachListing({ attachmentId })).toEqual({
        ok: false,
        code: 'conflict',
        message: DETACH_FAILED,
        detail: { reason: 'already_decided' },
      });
      expect((await attachmentRow(tx, attachmentId))?.status).toBe('tentative');
    }));

  it("detach answers not_found for another org's listing and validation for a bad id", () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const { attachmentId } = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.rio,
        placeId: 'ChIJ_rio_attached',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      request.claims = USER_B;
      expect(await actions.detachListing({ attachmentId })).toEqual({
        ok: false,
        code: 'not_found',
        message: NOT_FOUND('listing'),
      });
      expect(await attachmentRow(tx, attachmentId)).toEqual({
        status: 'attached',
        reason: 'score',
        decided_by: null,
      });

      request.withOrgCalls = 0;
      expect(await actions.detachListing({ attachmentId: 'x' })).toMatchObject({
        ok: false,
        code: 'validation',
      });
      expect(request.withOrgCalls).toBe(0);
    }));
});

/**
 * The business detail's "Google Maps check" read (04-UI-SPEC § Screen 5, D-08 / D-10): the
 * business-level signal (attached listings only), every listing with its status and latest
 * observation, and the append-only observation history — read as a Clerk user through RLS.
 *
 * 🔴 Instants are chosen off the hour and on different days so a swapped `observed_at` / `decided_at`
 * or a wrong sort cannot pass by coincidence.
 */
describe('the google check', () => {
  const T_OLD = Date.UTC(2026, 8, 18, 14, 5);
  const T_MID = Date.UTC(2026, 8, 20, 16, 40);
  const T_NEW = Date.UTC(2026, 8, 22, 3, 30);
  const T_DECIDED = Date.UTC(2026, 8, 21, 9, 15);

  it('the google check reads the business signal and every listing', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      const seed = (placeId: string, status: 'attached' | 'tentative' | 'rejected', at: number) =>
        seedAttachmentWithObservation(c, {
          orgId: orgs.a,
          businessId: spine.ortiz,
          placeId,
          runId: run.runId,
          status,
          hadWebsiteUri: false,
          hostClass: 'none',
          observedAt: new Date(at),
          withCoordinates: true,
        });
      // Seeded out of display order on purpose.
      const rejected = await seed('ChIJ_rejected', 'rejected', T_NEW);
      const tentative = await seed('ChIJ_tentative', 'tentative', T_NEW);
      const olderAttached = await seed('ChIJ_attached_old', 'attached', T_OLD);
      const newerAttached = await seed('ChIJ_attached_new', 'attached', T_MID);
      await c.query(
        `update place_attachments set reason = 'detached', decided_by = 'user_reviewer_A',
                decided_at = $2::timestamptz where id = $1`,
        [rejected.attachmentId, new Date(T_DECIDED).toISOString()],
      );
      await actAs(c, CLAIMS_A);

      const view = await queries.readGoogleCheck(tx, spine.ortiz);
      // D-08: the business-level value — the newest attached observation; tentative and
      // rejected listings (observed LATER, at T_NEW) are never a verdict input.
      expect(view.signal).toEqual({ hadWebsiteUri: false, hostClass: 'none', observedMs: T_MID });
      expect(view.listings.map((l) => l.attachmentId)).toEqual([
        newerAttached.attachmentId,
        olderAttached.attachmentId,
        tentative.attachmentId,
        rejected.attachmentId,
      ]);
      expect(view.listings[0]).toEqual({
        attachmentId: newerAttached.attachmentId,
        placeId: 'ChIJ_attached_new',
        status: 'attached',
        reason: 'score',
        score: 95,
        tieBusinessId: null,
        decidedBy: null,
        decidedMs: null,
        latest: { hadWebsiteUri: false, hostClass: 'none', observedMs: T_MID, runId: run.runId },
      });
      expect(view.listings[2]).toMatchObject({ status: 'tentative', score: 80 });
      expect(view.listings[3]).toEqual({
        attachmentId: rejected.attachmentId,
        placeId: 'ChIJ_rejected',
        status: 'rejected',
        reason: 'detached',
        score: 95,
        tieBusinessId: null,
        decidedBy: 'user_reviewer_A',
        decidedMs: T_DECIDED,
        latest: { hadWebsiteUri: false, hostClass: 'none', observedMs: T_NEW, runId: run.runId },
      });

      // The detail page reads it inside its ONE transaction.
      const detail = await queries.readBusinessDetail(tx, spine.ortiz);
      expect(detail?.google).toEqual(view);
    }));

  it('the google check history is newest first and names its run', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      // A second run in one org must not be active (runs_one_active_per_org).
      const earlier = await seedPlacesRun(c, orgs.a, { status: 'complete' });
      const first = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.garza,
        placeId: 'ChIJ_garza_history',
        runId: earlier.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'social',
        observedAt: new Date(T_OLD),
      });
      const second = await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.garza,
        placeId: 'ChIJ_garza_history',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: new Date(T_NEW),
      });
      expect(second.attachmentId).toBe(first.attachmentId);
      await actAs(c, CLAIMS_A);

      const view = await queries.readGoogleCheck(tx, spine.garza);
      expect(view.history).toEqual([
        {
          observationId: second.observationId,
          placeId: 'ChIJ_garza_history',
          observedMs: T_NEW,
          hadWebsiteUri: false,
          hostClass: 'none',
          runId: run.runId,
        },
        {
          observationId: first.observationId,
          placeId: 'ChIJ_garza_history',
          observedMs: T_OLD,
          hadWebsiteUri: true,
          hostClass: 'social',
          runId: earlier.runId,
        },
      ]);
      // The listing's latest is the newer run; the signal follows the view (0027).
      expect(view.listings[0]?.latest).toEqual({
        hadWebsiteUri: false,
        hostClass: 'none',
        observedMs: T_NEW,
        runId: run.runId,
      });
      expect(view.signal).toEqual({ hadWebsiteUri: false, hostClass: 'none', observedMs: T_NEW });
    }));

  it('the google check never selects coordinates', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.valley,
        placeId: 'ChIJ_valley_coords',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'directory',
        withCoordinates: { lat: 26.1901234, lng: -98.2201234 },
      });
      await actAs(c, CLAIMS_A);

      const view = await queries.readGoogleCheck(tx, spine.valley);
      expect(view.listings).toHaveLength(1);
      expect(view.history).toHaveLength(1);
      const json = JSON.stringify(view);
      expect(json).not.toMatch(/"lat"|"lng"|"latitude"|"longitude"|"location"/);
      expect(json).not.toContain('26.1901234');
      expect(json).not.toContain('-98.2201234');
      // Rule 32 at the source: the query module never names the coordinate table. (The role
      // holds no grant on it either — 0027 — so a select would be 42501, not a quiet leak.)
      const source = readFileSync('src/server/queries/businesses.ts', 'utf8');
      expect(source).not.toContain('place_coordinates');
    }));

  it('a business with no listing has an empty google check', () =>
    withTxRollback(async (tx) => {
      const { c, orgs, spine, run } = await seedOrgA(tx);
      await seedAttachmentWithObservation(c, {
        orgId: orgs.a,
        businessId: spine.rio,
        placeId: 'ChIJ_rio_only',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      await actAs(c, CLAIMS_A);

      const empty = { signal: null, listings: [], history: [] };
      expect(await queries.readGoogleCheck(tx, spine.rioCo)).toEqual(empty);
      expect((await queries.readBusinessDetail(tx, spine.rioCo))?.google).toEqual(empty);

      // Through RLS another org sees nothing of org A's listings — the same empty answer.
      await actAs(c, CLAIMS_B);
      expect(await queries.readGoogleCheck(tx, spine.rio)).toEqual(empty);
    }));
});
