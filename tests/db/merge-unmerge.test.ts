/**
 * DEDUP-02 / D-14 / D-19 / D-20 against the live local database: merges are rows, every parent
 * survives, unmerge restores both sides and marks the pair distinct, a three-way cluster
 * resolves to one winner, and the three definers refuse every foreign id by name.
 *
 * 🔴 BOTH CALLER TIERS ARE EXERCISED, because a fixture more permissive than the real caller
 * hides a whole broken tier (03-09: `app.emit_event` 42501'd on the desk tier while every
 * `actAs` test stayed green):
 *   - the APP tier — `actAs(c, CLAIMS_A)`: a Clerk user with real claims, as `authenticated`,
 *     reaching the definers through the shipped `src/lib/resolve/merge.ts` (tests 1–3, 5–11);
 *   - the DESK tier — the owner connection, NO `actAs`, `setEtlActor` + `resolveEtlOrg` in the
 *     transaction, exactly as `scripts/resolve.ts` (03-14) will connect (tests 4, 12, 12b).
 *
 * 🔴 ONE REFUSED STATEMENT PER `withRollback`, always LAST. The first refusal aborts the
 * transaction and the next statement would report its own abort instead of its reason. Every
 * refusal pins the SQLSTATE AND the message: 42501 is both a grant refusal and every org guard.
 *
 * Mutations, executed 2026-09-22 against the live local functions (`create or replace`, never
 * the migration file) and against merge.ts; each reverted and the revert verified from
 * `pg_get_functiondef` md5 / `git diff --stat` (03-11-SUMMARY.md has the output):
 *   M21  undo_merge skips the decision='distinct' write      -> 'never auto-re-merges' only
 *   M25  record_merge loses the coalesce(merged_into_id, id) -> 'three-way cluster' only. The
 *        definer has four layers behind the re-point and each was peeled in turn: the
 *        candidate-pair check (22023), then the post-lock "still roots" re-check (40001), then
 *        business_merges_loser_uniq (23505). The test reds at every depth, alone.
 *   T-3-10 undo_merge's business_merges read loses its org predicate
 *                                          -> 'undo_merge refuses a cross-org merge id' only
 *   T-3-16 record_merge's candidate read / loser read loses its org predicate
 *                                          -> the matching cross-org test only, each
 *   record_candidate_decision's read loses its org predicate
 *                        -> 'record_candidate_decision refuses a cross-org candidate id' only
 *   record_merge emits no merge event      -> 'merge is audited' only
 *   T-3-15 resolveEtlOrg installs no claim -> the three desk-tier tests ('record_merge succeeds
 *          from an owner connection with no claims', its undo/decision sibling, and
 *          'three-way cluster'), each 42501 'record_merge: no current org'; every one of the 14
 *          actAs-tier tests stays green — the masking this file exists to close
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import { mergePair, recordCandidateDecision, unmergeBusinesses } from '@/lib/resolve/merge';
import { actAs, actAsRole, seedTwoOrgs, withRollback } from './_fixtures';
import { asEtlExecutor } from './_ingest-fixtures';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedMergePair,
  seedTriple,
  survivorshipColumns,
} from './_merge-fixtures';

const FEATURES = { name: 45, address: 30, distance: 15, cluster: 5 };

/** The desk-script preamble: the actor GUC, then the org claim. No actAs, no set role. */
async function asResolvePass(c: Client, clerkOrgId = 'org_A'): Promise<void> {
  const x = asEtlExecutor(c);
  await setEtlActor(x, 'resolve');
  await resolveEtlOrg(x, clerkOrgId);
}

const sourceRecordLinks = async (c: Client, orgId: string) =>
  (
    await c.query<{ id: string; business_id: string | null }>(
      'select id, business_id from source_records where org_id = $1 order by id',
      [orgId],
    )
  ).rows;

const businessState = async (c: Client, id: string) =>
  (
    await c.query<{ status: string; merged_into_id: string | null }>(
      'select status, merged_into_id from businesses where id = $1',
      [id],
    )
  ).rows[0];

const resolveKey = async (c: Client, orgId: string, key: string) =>
  (
    await c.query<{ business_id: string }>(
      `select coalesce(b.merged_into_id, b.id) as business_id
         from businesses b where b.org_id = $1 and b.external_key = $2`,
      [orgId, key],
    )
  ).rows[0]?.business_id;

describe('merge and unmerge (DEDUP-02)', () => {
  it('every parent survives', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      const before = await sourceRecordLinks(c, a);
      // Positive control: the snapshot is not empty, and each side's record points at it.
      expect(before).toHaveLength(3); // comptroller + census + overture
      expect(before).toContainEqual({ id: overture.sourceRecordId, business_id: overture.businessId });

      await actAs(c, CLAIMS_A);
      const r = await mergePair(asEtlExecutor(c), {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'review',
        score: 95,
        features: FEATURES,
      });
      expect(r.mergeId).not.toBeNull();
      expect(r.winnerId).toBe(comptroller.businessId); // the older one
      expect(await businessState(c, overture.businessId)).toEqual({
        status: 'merged',
        merged_into_id: comptroller.businessId,
      });
      // 🔴 EVERY source_records.business_id is byte-identical: nothing was re-pointed.
      expect(await sourceRecordLinks(c, a)).toEqual(before);
      // And the winner now cites the loser's Overture record for the fields D-14 gives it.
      const w = await survivorshipColumns(c, comptroller.businessId);
      expect(w.display_name_source_id).toBe(overture.sourceRecordId);
      expect(w.legal_name_source_id).toBe(comptroller.sourceRecordId);
      expect(w.location_source_id).toBe(overture.sourceRecordId);
    }));

  it('unmerge restores', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      const winnerBefore = await survivorshipColumns(c, comptroller.businessId);
      const loserBefore = await survivorshipColumns(c, overture.businessId);

      await actAs(c, CLAIMS_A);
      const x = asEtlExecutor(c);
      const { mergeId } = await mergePair(x, {
        candidateId,
        leftId: overture.businessId,
        rightId: comptroller.businessId,
        reason: 'review',
        score: 95,
        features: FEATURES,
      });
      // Positive control: the merge DID change the winner, so "equal after unmerge" is a restore.
      expect(await survivorshipColumns(c, comptroller.businessId)).not.toEqual(winnerBefore);

      // Corrupt the loser while it is merged (as the owner — this is a test lever, not a path
      // the app has): the unmerge must re-derive it from its OWN source records, not leave it.
      await c.query('reset role');
      await c.query("update businesses set display_name = 'CORRUPTED', city = null where id = $1", [
        overture.businessId,
      ]);
      await actAs(c, CLAIMS_A);

      await unmergeBusinesses(x, { mergeId: mergeId! });

      const merge = (
        await c.query<{ winner_fields_before: Record<string, unknown>; undone_at: Date | null; undone_by: string | null }>(
          'select winner_fields_before, undone_at, undone_by from business_merges where id = $1',
          [mergeId],
        )
      ).rows[0]!;
      // The row still exists, stamped — never deleted.
      expect(merge.undone_at).not.toBeNull();
      expect(merge.undone_by).toBe('user_reviewer_A');

      const winnerAfter = await survivorshipColumns(c, comptroller.businessId);
      for (const col of Object.keys(winnerAfter).filter((k) => k.endsWith('_source_id'))) {
        expect(winnerAfter[col], col).toBe(merge.winner_fields_before[col] ?? null);
      }
      expect(winnerAfter).toEqual(winnerBefore);

      expect(await businessState(c, overture.businessId)).toEqual({ status: 'active', merged_into_id: null });
      expect(await survivorshipColumns(c, overture.businessId)).toEqual(loserBefore);
    }));

  it('never auto-re-merges', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      const x = asEtlExecutor(c);
      const pair = {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        score: 95,
        features: FEATURES,
      };
      const { mergeId } = await mergePair(x, { ...pair, reason: 'review' });
      await unmergeBusinesses(x, { mergeId: mergeId! });

      // D-20: the unmerge IS the "different" decision, attributed to whoever undid it.
      const cand = (
        await c.query<{ decision: string; decided_by: string | null }>(
          'select decision, decided_by from merge_candidates where id = $1',
          [candidateId],
        )
      ).rows[0];
      expect(cand).toEqual({ decision: 'distinct', decided_by: 'user_reviewer_A' });

      // The next automatic pass meets the same pair at the same score and may not merge it.
      await expect(mergePair(x, { ...pair, reason: 'auto' })).rejects.toMatchObject({
        code: '55000',
        message: 'record_merge: pair was marked distinct',
      });
    }));

  it('three-way cluster', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const t = await seedTriple(c, a);
      await asResolvePass(c); // the resolve pass is the desk tier

      const x = asEtlExecutor(c);
      // The resolve pass's order: descending score (all three edges are 95).
      const pending = (
        await c.query<{ id: string; left_id: string; right_id: string; score: number }>(
          `select id, left_id, right_id, score from merge_candidates
            where org_id = $1 and decision = 'pending' order by score desc, id`,
          [a],
        )
      ).rows;
      expect(pending).toHaveLength(3);
      const results = [];
      for (const p of pending) {
        results.push(
          await mergePair(x, {
            candidateId: p.id,
            leftId: p.left_id,
            rightId: p.right_id,
            reason: 'auto',
            score: p.score,
            features: FEATURES,
          }),
        );
      }
      // Two real merges; the third edge found its two businesses already one.
      expect(results.filter((r) => r.mergeId !== null)).toHaveLength(2);

      const ids = [t.a.businessId, t.b.businessId, t.c.businessId];
      const rows = (
        await c.query<{ id: string; status: string; merged_into_id: string | null }>(
          'select id, status, merged_into_id from businesses where id = any($1::uuid[])',
          [ids],
        )
      ).rows;
      const winners = rows.filter((r) => r.status === 'active');
      expect(winners).toEqual([{ id: t.a.businessId, status: 'active', merged_into_id: null }]);
      const losers = rows.filter((r) => r.status === 'merged');
      expect(losers.map((r) => r.merged_into_id)).toEqual([t.a.businessId, t.a.businessId]);

      // 🔴 M25's target: no merged_into_id anywhere in the org points at a merged row.
      const chains = await c.query(
        `select l.id from businesses l join businesses w on w.id = l.merged_into_id
          where l.org_id = $1 and w.merged_into_id is not null`,
        [a],
      );
      expect(chains.rows).toEqual([]);
      const decisions = await c.query<{ decision: string }>(
        'select decision from merge_candidates where org_id = $1',
        [a],
      );
      expect(decisions.rows.map((r) => r.decision)).toEqual(['merged', 'merged', 'merged']);
    }));

  it('merge is audited', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      // The RAW SQL write path — the definer itself, no application code in between.
      const m = await c.query<{ id: string }>(
        `select app.record_merge($1::uuid, $2::uuid, $3::uuid, 'review', 95, '{}'::jsonb, '{}'::jsonb) as id`,
        [comptroller.businessId, overture.businessId, candidateId],
      );
      const mergeId = m.rows[0]!.id;
      expect(mergeId).toMatch(/^[0-9a-f-]{36}$/);

      const ev = await c.query<{ actor_id: string; occurred_at: Date; after: Record<string, unknown> }>(
        `select actor_id, occurred_at, after from events
          where org_id = $1 and entity_type = 'businesses' and action = 'merge' and entity_id = $2`,
        [a, overture.businessId],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0]!.actor_id).toBe('user_reviewer_A');
      expect(ev.rows[0]!.occurred_at).toBeInstanceOf(Date);
      expect(ev.rows[0]!.after).toMatchObject({ merge_id: mergeId, winner_id: comptroller.businessId });
      const merge = await c.query<{ merged_by: string }>(
        'select merged_by from business_merges where id = $1',
        [mergeId],
      );
      expect(merge.rows[0]!.merged_by).toBe('user_reviewer_A');
    }));

  it('key survives merge', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      const x = asEtlExecutor(c);
      // Positive control: before the merge each key resolves to its own business.
      expect(await resolveKey(c, a, overture.externalKey)).toBe(overture.businessId);

      const { mergeId } = await mergePair(x, {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'review',
        score: 95,
        features: FEATURES,
      });
      expect(await resolveKey(c, a, overture.externalKey)).toBe(comptroller.businessId);
      expect(await resolveKey(c, a, comptroller.externalKey)).toBe(comptroller.businessId);
      const alias = await c.query(
        `select business_id, source_business_id from business_aliases
          where org_id = $1 and external_key = $2 and released_at is null`,
        [a, overture.externalKey],
      );
      expect(alias.rows).toEqual([
        { business_id: comptroller.businessId, source_business_id: overture.businessId },
      ]);

      await unmergeBusinesses(x, { mergeId: mergeId! });
      expect(await resolveKey(c, a, overture.externalKey)).toBe(overture.businessId);
      const live = await c.query(
        'select 1 from business_aliases where org_id = $1 and external_key = $2 and released_at is null',
        [a, overture.externalKey],
      );
      expect(live.rows).toEqual([]);
    }));

  it('merged_by cannot be forged', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture } = await seedMergePair(c, a);
      await actAsRole(c, 'authenticated');
      // Positive control: the same caller CAN read the table (the grant is SELECT).
      await expect(c.query('select count(*) from business_merges')).resolves.toBeDefined();
      await expect(
        c.query(
          `insert into business_merges (org_id, winner_id, loser_id, reason, merged_by, winner_fields_before)
           values ($1, $2, $3, 'review', 'user_someone_else', '{}'::jsonb)`,
          [a, comptroller.businessId, overture.businessId],
        ),
      ).rejects.toMatchObject({
        code: '42501',
        message: 'permission denied for table business_merges',
      });
    }));
});

describe('cross-org refusal (T-3-10, T-3-16)', () => {
  it('positive control: org A unmerges its own merge', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      const x = asEtlExecutor(c);
      const { mergeId } = await mergePair(x, {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'review',
        score: 95,
        features: FEATURES,
      });
      await c.query("select app.undo_merge($1::uuid, '{}'::jsonb)", [mergeId]);
      expect(await businessState(c, overture.businessId)).toEqual({ status: 'active', merged_into_id: null });
    }));

  it('undo_merge refuses a cross-org merge id', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      const { mergeId } = await mergePair(asEtlExecutor(c), {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'review',
        score: 95,
        features: FEATURES,
      });
      expect(mergeId).not.toBeNull();

      await actAs(c, CLAIMS_B);
      // 🔴 The refusal, never rowCount 0: a silent no-op and a refusal look alike, and only one
      // of them is safe. Without the org predicate this call SUCCEEDS and splits org A's pair.
      await expect(
        c.query("select app.undo_merge($1::uuid, '{}'::jsonb)", [mergeId]),
      ).rejects.toMatchObject({ code: '42501', message: 'undo_merge: merge not in this org' });
    }));

  it('record_merge refuses a cross-org loser id', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      const inA = await seedMergePair(c, a, 'ALPHA');
      const inB = await seedMergePair(c, b, 'BRAVO');
      await actAs(c, CLAIMS_B);
      await expect(
        c.query(
          `select app.record_merge($1::uuid, $2::uuid, $3::uuid, 'review', 95, '{}'::jsonb, '{}'::jsonb)`,
          [inB.comptroller.businessId, inA.overture.businessId, inB.candidateId],
        ),
      ).rejects.toMatchObject({ code: '42501', message: 'record_merge: loser not in this org' });
    }));

  it('record_merge refuses a cross-org candidate id', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      const inA = await seedMergePair(c, a, 'ALPHA');
      const inB = await seedMergePair(c, b, 'BRAVO');
      await actAs(c, CLAIMS_B);
      await expect(
        c.query(
          `select app.record_merge($1::uuid, $2::uuid, $3::uuid, 'review', 95, '{}'::jsonb, '{}'::jsonb)`,
          [inB.comptroller.businessId, inB.overture.businessId, inA.candidateId],
        ),
      ).rejects.toMatchObject({ code: '42501', message: 'record_merge: candidate not in this org' });
    }));

  it('positive control: org A records distinct on its own candidate', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      await recordCandidateDecision(asEtlExecutor(c), { candidateId, decision: 'distinct' });
      const r = await c.query('select decision, decided_by from merge_candidates where id = $1', [
        candidateId,
      ]);
      expect(r.rows).toEqual([{ decision: 'distinct', decided_by: 'user_reviewer_A' }]);
    }));

  it('record_candidate_decision refuses a cross-org candidate id', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_B);
      await expect(
        c.query("select app.record_candidate_decision($1::uuid, 'distinct')", [candidateId]),
      ).rejects.toMatchObject({
        code: '42501',
        message: 'record_candidate_decision: candidate not in this org',
      });
    }));

  it('skip leaves the candidate pending and stamps skipped_at', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { candidateId } = await seedMergePair(c, a);
      await actAs(c, CLAIMS_A);
      await recordCandidateDecision(asEtlExecutor(c), { candidateId, decision: 'skip' });
      const r = await c.query<{ decision: string; skipped: boolean; decided_by: string | null }>(
        `select decision, skipped_at is not null as skipped, decided_by
           from merge_candidates where id = $1`,
        [candidateId],
      );
      expect(r.rows).toEqual([{ decision: 'pending', skipped: true, decided_by: null }]);
    }));
});

describe('the desk tier (T-3-15): owner connection, no Clerk claims', () => {
  it('record_merge succeeds from an owner connection with no claims', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      // The shape this test depends on: no claims, and not the authenticated role.
      const shape = await c.query<{ claims: string | null; who: string }>(
        "select nullif(current_setting('request.jwt.claims', true), '') as claims, current_user as who",
      );
      expect(shape.rows[0]!.claims).toBeNull();
      expect(shape.rows[0]!.who).not.toBe('authenticated');

      await asResolvePass(c);
      const r = await mergePair(asEtlExecutor(c), {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'auto',
        score: 95,
        features: FEATURES,
      });
      expect(r.mergeId).toMatch(/^[0-9a-f-]{36}$/);
      const m = await c.query<{ org_id: string; merged_by: string; reason: string }>(
        'select org_id, merged_by, reason from business_merges where id = $1',
        [r.mergeId],
      );
      expect(m.rows).toEqual([{ org_id: a, merged_by: 'etl:resolve', reason: 'auto' }]);
    }));

  it('undo_merge and record_candidate_decision succeed from an owner connection with no claims', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const first = await seedMergePair(c, a, 'ALPHA');
      const second = await seedMergePair(c, a, 'BRAVO');
      await asResolvePass(c);
      const x = asEtlExecutor(c);
      const { mergeId } = await mergePair(x, {
        candidateId: first.candidateId,
        leftId: first.comptroller.businessId,
        rightId: first.overture.businessId,
        reason: 'auto',
        score: 95,
        features: FEATURES,
      });
      await unmergeBusinesses(x, { mergeId: mergeId! });
      await recordCandidateDecision(x, { candidateId: second.candidateId, decision: 'distinct' });
      const r = await c.query<{ undone_by: string; decided_by: string }>(
        `select (select undone_by from business_merges where id = $1) as undone_by,
                (select decided_by from merge_candidates where id = $2) as decided_by`,
        [mergeId, second.candidateId],
      );
      expect(r.rows).toEqual([{ undone_by: 'etl:resolve', decided_by: 'etl:resolve' }]);
      expect(await businessState(c, first.overture.businessId)).toEqual({
        status: 'active',
        merged_into_id: null,
      });
    }));
});
