/**
 * The review decision and the unmerge — the adapter, the transactional core and the action
 * tier — against the real database as a Clerk user (plan 03-15).
 *
 * THREE LAYERS, EACH PROVEN WHERE IT CAN FAIL:
 *   1. `src/db/drizzle-executor.ts` on the RUNTIME driver (postgres.js through drizzle,
 *      `prepare: false`): an array bound as one parameter, many mixed-type parameters in one
 *      statement — and the CONTROL, the bare drizzle template, refused by Postgres with the
 *      exact SQLSTATEs phase 2 shipped green (42846 at two elements, 22P02 at one).
 *   2. `_merge-decisions.ts` (`decideCandidate`): the definers' writes, attributed to the
 *      Clerk subject (T-3-08), and the D-13 queue order after a skip.
 *   3. The two server actions, with ONLY their request plumbing replaced: `requireOrg` /
 *      `orgClaims` (Clerk has no request here), `revalidatePath`, and `withOrg` — which here
 *      opens a SAVEPOINT in the test's rolled-back transaction and does exactly what the real
 *      one does inside it (the claims via `set_config(..., true)`, then `set local role
 *      authenticated`). A refused definer call therefore rolls back only its savepoint, the
 *      same way a real refused `withOrg` rolls back its transaction, and the action's
 *      `pgFailure()` mapping runs on a REAL driver error chain.
 *
 * 🔴 THE MOCKS ARE `vi.doMock` + DYNAMIC IMPORT, UNDONE IN `afterAll`. The DB suite runs with
 * `isolate: false`, so a hoisted `vi.mock` of `@/db/with-org` could reach another file's real
 * import of it. Scoping the mocks to this file's own dynamic imports and resetting the module
 * registry afterwards keeps `tests/db/with-org.test.ts` on the real wrapper.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzleExecutor } from '@/db/drizzle-executor';
import type { OrgClaims } from '@/db/with-org';
import { NOT_FOUND, REVIEW_DECISION_FAILED, UNMERGE_FAILED } from '@/lib/ui/copy';
import { pgFailure } from '@/server/actions/_pg';
import { decideCandidate } from '@/server/actions/_merge-decisions';
import type { Tx } from '@/server/queries/budget';
import { readReviewQueue } from '@/server/queries/review-queue';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { CLAIMS_A, seedMergePair, seedTriple } from './_merge-fixtures';

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
const request: { tx: Tx | null; claims: OrgClaims } = { tx: null, claims: USER_A };

type Actions = {
  recordReviewDecision: typeof import('@/server/actions/record-review-decision').recordReviewDecision;
  unmergeBusiness: typeof import('@/server/actions/unmerge-business').unmergeBusiness;
};
let actions: Actions;

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
      const outer = request.tx;
      if (!outer) throw new Error('review-actions: no request transaction is open');
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
  const decision = await import('@/server/actions/record-review-decision');
  const unmerge = await import('@/server/actions/unmerge-business');
  actions = {
    recordReviewDecision: decision.recordReviewDecision,
    unmergeBusiness: unmerge.unmergeBusiness,
  };
});

afterAll(async () => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.resetModules();
  request.tx = null;
  await closeDrizzleTx();
});

/** One statement Postgres must refuse, in its own savepoint so the test can continue. */
async function refusedCode(tx: Tx, run: (sp: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.transaction(async (sp) => {
      await run(sp as unknown as Tx);
    });
  } catch (error) {
    return pgFailure(error)?.code ?? `no SQLSTATE: ${String(error)}`;
  }
  return null;
}

describe('drizzle executor', () => {
  it('drizzle executor binds an array as one parameter against the real database', () =>
    withTxRollback(async (tx) => {
      const x = drizzleExecutor(tx);
      const u1 = randomUUID();
      const u2 = randomUUID();

      const one = await x.query<{ n: number; first: string }>(
        'select array_length($1::uuid[], 1) as n, ($1::uuid[])[1]::text as first',
        [[u1]],
      );
      expect(one.rows).toEqual([{ n: 1, first: u1 }]);

      const two = await x.query<{ n: number; second: string }>(
        'select array_length($1::uuid[], 1) as n, ($1::uuid[])[2]::text as second',
        [[u1, u2]],
      );
      expect(two.rows).toEqual([{ n: 2, second: u2 }]);

      // Elements that would change the count or the nullness if the literal were naive.
      const tricky = await x.query<{ n: number; a: string; b: string; c: boolean; d: string }>(
        `select cardinality($1::text[]) as n, ($1::text[])[1] as a, ($1::text[])[2] as b,
                ($1::text[])[3] is null as c, ($1::text[])[4] as d`,
        [['a,b', 'q"uote\\', null, 'NULL']],
      );
      expect(tricky.rows).toEqual([{ n: 4, a: 'a,b', b: 'q"uote\\', c: true, d: 'NULL' }]);

      // THE CONTROL: the bare drizzle template does what phase 2 shipped — N placeholders.
      expect(await refusedCode(tx, (sp) => sp.execute(sql`select ${[u1, u2]}::uuid[]`))).toBe(
        '42846',
      );
      expect(await refusedCode(tx, (sp) => sp.execute(sql`select ${[u1]}::uuid[]`))).toBe('22P02');
    }));

  it('drizzle executor binds many mixed parameters and refuses a Date', () =>
    withTxRollback(async (tx) => {
      const x = drizzleExecutor(tx);
      const r = await x.query<Record<string, unknown>>(
        `select $1::int + $2::int as s, $3::text as t, $4::boolean as b,
                ($5::jsonb ->> 'k') as j, $6::bigint::text as big, $7::text is null as nul,
                $8::float8 as f`,
        [2, 3, "it's", true, '{"k":"v"}', 9007199254740993n, null, 26.1802],
      );
      expect(r.rows).toEqual([
        { s: 5, t: "it's", b: true, j: 'v', big: '9007199254740993', nul: true, f: 26.1802 },
      ]);
      await expect(x.query('select $1::timestamptz', [new Date()])).rejects.toThrow(/is a Date/);
    }));
});

describe('review decision core, as a Clerk user', () => {
  it('a review decision merges through the definer as a Clerk user', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const pair = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);

      const outcome = await decideCandidate(tx, {
        candidateId: pair.candidateId,
        decision: 'merged',
      });
      expect(outcome.kind).toBe('recorded');
      if (outcome.kind !== 'recorded') return;
      expect(outcome.mergeId).not.toBeNull();
      expect(outcome.remaining).toBe(0);

      // Attributed to the Clerk subject by the definer — never a parameter (T-3-08).
      const m = await c.query<{ reason: string; merged_by: string; loser_id: string }>(
        'select reason, merged_by, loser_id from business_merges where id = $1',
        [outcome.mergeId],
      );
      expect(m.rows[0]).toMatchObject({ reason: 'review', merged_by: 'user_reviewer_A' });
      const cand = await c.query<{ decision: string; decided_by: string }>(
        'select decision, decided_by from merge_candidates where id = $1',
        [pair.candidateId],
      );
      expect(cand.rows[0]).toEqual({ decision: 'merged', decided_by: 'user_reviewer_A' });
      // Survivorship ran over both parents: the Comptroller winner now shows Overture's name.
      const w = await c.query<{ display_name: string }>(
        'select display_name from businesses where id = $1',
        [pair.comptroller.businessId],
      );
      expect(w.rows[0]?.display_name).toBe('Riverside Stone');
    }));

  it('skip sinks a pair below the undecided and distinct decides one', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const high = await seedMergePair(c, a, 'HIGHPAIR');
      const low = await seedMergePair(c, a, 'LOWPAIR');
      await c.query('update merge_candidates set score = 90 where id = $1', [high.candidateId]);
      await c.query('update merge_candidates set score = 85 where id = $1', [low.candidateId]);
      await actAs(c, CLAIMS_A);

      let queue = await readReviewQueue(tx);
      expect(queue.remaining).toBe(2);
      expect(queue.top?.candidateId).toBe(high.candidateId);

      const skipped = await decideCandidate(tx, { candidateId: high.candidateId, decision: 'skip' });
      expect(skipped).toMatchObject({ kind: 'recorded', remaining: 2, mergeId: null });
      queue = await readReviewQueue(tx);
      expect(queue.top?.candidateId).toBe(low.candidateId); // 85 undecided beats 90 skipped

      const distinct = await decideCandidate(tx, {
        candidateId: low.candidateId,
        decision: 'distinct',
      });
      expect(distinct).toMatchObject({ kind: 'recorded', remaining: 1 });
      queue = await readReviewQueue(tx);
      expect(queue.top?.candidateId).toBe(high.candidateId); // the skipped pair resurfaces
      expect(queue.remaining).toBe(1);
    }));
});

describe('review actions, as a Clerk user', () => {
  it('a foreign candidate id answers not_found, never a permission error', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { b } = await seedTwoOrgs(c);
      const theirs = await seedMergePair(c, b, 'BRAVOPAIR');
      request.tx = tx;
      request.claims = USER_A;

      const foreign = await actions.recordReviewDecision({
        candidateId: theirs.candidateId,
        decision: 'merged',
      });
      const unknown = await actions.recordReviewDecision({
        candidateId: randomUUID(),
        decision: 'merged',
      });
      expect(foreign).toEqual({ ok: false, code: 'not_found', message: NOT_FOUND('pair') });
      expect(unknown).toEqual(foreign);

      expect(await actions.recordReviewDecision({ candidateId: 'SL-7F3K2A', decision: 'merged' }))
        .toMatchObject({ ok: false, code: 'validation' });
      expect(
        await actions.recordReviewDecision({
          candidateId: randomUUID(),
          decision: 'merged',
          decidedBy: 'someone else',
        }),
      ).toMatchObject({ ok: false, code: 'validation' });

      // Nothing of org B's was touched.
      await actAsOwner(c);
      const cand = await c.query<{ decision: string }>(
        'select decision from merge_candidates where id = $1',
        [theirs.candidateId],
      );
      expect(cand.rows[0]?.decision).toBe('pending');
    }));

  it('an already-decided pair answers conflict', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const pair = await seedMergePair(c, a);
      request.tx = tx;
      request.claims = USER_A;

      const first = await actions.recordReviewDecision({
        candidateId: pair.candidateId,
        decision: 'distinct',
      });
      expect(first).toEqual({ ok: true, data: { remaining: 0 } });

      const second = await actions.recordReviewDecision({
        candidateId: pair.candidateId,
        decision: 'merged',
      });
      expect(second).toEqual({
        ok: false,
        code: 'conflict',
        message: REVIEW_DECISION_FAILED,
        detail: { reason: 'already_decided' },
      });
    }));

  it('unmerge restores through the definer and a second unmerge is a conflict', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const pair = await seedMergePair(c, a);
      request.tx = tx;
      request.claims = USER_A;

      expect(
        await actions.recordReviewDecision({ candidateId: pair.candidateId, decision: 'merged' }),
      ).toEqual({ ok: true, data: { remaining: 0 } });
      const merge = await c.query<{ id: string; loser_id: string }>(
        'select id, loser_id from business_merges where candidate_id = $1',
        [pair.candidateId],
      );
      const mergeId = merge.rows[0]!.id;
      const loserId = merge.rows[0]!.loser_id;

      expect(await actions.unmergeBusiness({ mergeId })).toEqual({ ok: true, data: { loserId } });

      const loser = await c.query<{ status: string; merged_into_id: string | null }>(
        'select status, merged_into_id from businesses where id = $1',
        [loserId],
      );
      expect(loser.rows[0]).toEqual({ status: 'active', merged_into_id: null });
      const cand = await c.query<{ decision: string; decided_by: string }>(
        'select decision, decided_by from merge_candidates where id = $1',
        [pair.candidateId],
      );
      expect(cand.rows[0]).toEqual({ decision: 'distinct', decided_by: 'user_reviewer_A' });
      const undone = await c.query<{ undone_by: string }>(
        'select undone_by from business_merges where id = $1',
        [mergeId],
      );
      expect(undone.rows[0]?.undone_by).toBe('user_reviewer_A');

      expect(await actions.unmergeBusiness({ mergeId })).toEqual({
        ok: false,
        code: 'conflict',
        message: UNMERGE_FAILED,
        detail: { reason: 'already_undone' },
      });
    }));

  it('unmerge maps the definer refusals: later merge first, and a foreign merge id', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const triple = await seedTriple(c, a);
      request.tx = tx;
      request.claims = USER_A;

      // Two edges of the triangle: two real merges that together join all three records.
      for (const candidateId of triple.candidates.slice(0, 2)) {
        expect(
          await actions.recordReviewDecision({ candidateId, decision: 'merged' }),
        ).toMatchObject({ ok: true });
      }
      const merges = await c.query<{ id: string }>(
        'select id from business_merges where undone_at is null order by merged_at',
      );
      expect(merges.rows).toHaveLength(2);
      const earlier = merges.rows[0]!.id;

      // 55000 'undo_merge: undo the later merge first', raised INSIDE the definer and read off
      // the driver's error chain by pgFailure — not the pre-read's answer.
      expect(await actions.unmergeBusiness({ mergeId: earlier })).toEqual({
        ok: false,
        code: 'conflict',
        message: UNMERGE_FAILED,
        detail: { reason: 'later_merge_first' },
      });
      // The refusal rolled back its own transaction: both merges still stand.
      const still = await c.query<{ n: number }>(
        'select count(*)::int as n from business_merges where undone_at is null',
      );
      expect(still.rows[0]?.n).toBe(2);

      // Org B asking for org A's merge: the same not_found as an id that never existed.
      request.claims = USER_B;
      const foreign = await actions.unmergeBusiness({ mergeId: earlier });
      expect(foreign).toEqual({ ok: false, code: 'not_found', message: NOT_FOUND('merge') });
      expect(await actions.unmergeBusiness({ mergeId: randomUUID() })).toEqual(foreign);
      request.claims = USER_A;
    }));
});
