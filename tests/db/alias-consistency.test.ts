/**
 * D-19: `businesses.merged_into_id` is the SOURCE OF TRUTH for where an external key resolves;
 * `business_aliases` is the indexed, queryable projection a `SL-…` search hits. This test is
 * what stops the two ever disagreeing — after a merge, after a second merge into the same
 * winner, and after an unmerge.
 *
 * 🔴 Each measurement has a positive control beside it: the org's live alias count. A zero-row
 * disagreement over an EMPTY alias table passes for the wrong reason.
 *
 * Mutation, executed 2026-09-22: deleting the alias `released_at` stamp from the live
 * app.undo_merge reds this test at its third measurement ('expected 2 to be 1' on the live
 * alias count) and 'key survives merge' in merge-unmerge.test.ts — nothing else
 * (03-11-SUMMARY.md).
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { mergePair, unmergeBusinesses } from '@/lib/resolve/merge';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';
import { asEtlExecutor } from './_ingest-fixtures';
import { CLAIMS_A, seedTriple } from './_merge-fixtures';

const DISAGREEMENTS = `
  select count(*)::int as n from business_aliases a
  join businesses l on l.id = a.source_business_id
  where a.released_at is null and l.merged_into_id is distinct from a.business_id`;

const disagreements = async (c: Client) => (await c.query<{ n: number }>(DISAGREEMENTS)).rows[0]!.n;

const liveAliases = async (c: Client, orgId: string) =>
  (
    await c.query<{ n: number }>(
      'select count(*)::int as n from business_aliases where org_id = $1 and released_at is null',
      [orgId],
    )
  ).rows[0]!.n;

describe('D-19: aliases agree with merged_into_id', () => {
  it('alias consistency', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const t = await seedTriple(c, a); // A is the oldest, so A wins both merges below
      await actAs(c, CLAIMS_A);
      const x = asEtlExecutor(c);
      const edge = async (one: string, two: string) =>
        (
          await c.query<{ id: string }>(
            `select id from merge_candidates
              where org_id = $1 and left_id = least($2::uuid, $3::uuid)
                and right_id = greatest($2::uuid, $3::uuid)`,
            [a, one, two],
          )
        ).rows[0]!.id;
      const merge = (candidateId: string, leftId: string, rightId: string) =>
        mergePair(x, { candidateId, leftId, rightId, reason: 'review', score: 95, features: {} });

      // 1. After a merge.
      await merge(await edge(t.a.businessId, t.b.businessId), t.a.businessId, t.b.businessId);
      expect(await liveAliases(c, a)).toBe(1);
      expect(await disagreements(c)).toBe(0);

      // 2. After a second merge into the SAME winner.
      const second = await merge(
        await edge(t.a.businessId, t.c.businessId),
        t.a.businessId,
        t.c.businessId,
      );
      expect(second.winnerId).toBe(t.a.businessId);
      expect(await liveAliases(c, a)).toBe(2);
      expect(await disagreements(c)).toBe(0);

      // 3. After an unmerge (last in, first out).
      await unmergeBusinesses(x, { mergeId: second.mergeId! });
      expect(await liveAliases(c, a)).toBe(1);
      expect(await disagreements(c)).toBe(0);
    }));
});
