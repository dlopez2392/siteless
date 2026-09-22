'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { requireOrg } from '@/lib/auth/require-org';
import { COPY_OF, NOT_FOUND, PRESET_NAME_MISSING, UNEXPECTED_ERROR } from '@/lib/ui/copy';
import { rowsOf } from '@/server/queries/budget';

import { fail, ok, type ActionResult } from './_result';

/**
 * D-17. Duplicate creates a NEW preset at version 1, copied from ANY chosen version.
 *
 * 🔴 THE SOURCE IS UNTOUCHED. Not a rename, not a branch, not a pointer move: one new
 * `searches` row and one new `search_versions` row carrying a COPY of the source version's
 * clusters and geography. The source preset keeps its versions and its runs keep pointing at
 * them (SRCH-03), which is the whole reason "duplicate" exists rather than "edit and hope".
 *
 * 🔴 THE SOURCE IS READ THROUGH `withOrg`, SO RLS IS THE ACCESS CONTROL. A version id
 * belonging to another tenant is simply not found, and the answer is `not_found` — never
 * `forbidden`, which would confirm to a wrong-tenant caller that the row exists (T-2-10).
 *
 * 🔴 THE COPY IS NOT RE-ESTIMATED HERE. `estimate_snapshot` is deliberately NOT carried
 * over: the snapshot records what the estimator quoted AT THAT MOMENT, against that month's
 * free allowance and that month's remaining budget, and re-presenting it under a new
 * preset's version 1 would be a quote nobody made. The editor recomputes on open (D-08).
 */
const duplicateInputSchema = z.strictObject({
  fromVersionId: z.uuid(),
  /**
   * Absent means "use the default", and the default is computed HERE, from the source row,
   * rather than by the dialog. UI-SPEC pre-fills `Copy of {name}`; if the client owned that
   * string, a copy made from any other surface would be named something else.
   */
  displayName: z.string().trim().min(1).max(120).optional(),
});

export async function duplicatePreset(
  input: unknown,
): Promise<ActionResult<{ searchId: string; version: number }>> {
  // 🔴 T-2-01. First statement.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = duplicateInputSchema.safeParse(input);
  if (!parsed.success) {
    const named = parsed.error.issues.some((issue) => issue.path[0] === 'displayName');
    // UI-SPEC's Duplicate dialog pre-fills `Copy of {name}`, so an empty name means the user
    // cleared it on purpose and the name copy is the right sentence.
    return fail('validation', named ? PRESET_NAME_MISSING : NOT_FOUND('version'));
  }

  const { fromVersionId, displayName } = parsed.data;

  try {
    const result = await withOrg(claims, async (tx) => {
      const source = rowsOf<{
        cluster_ids: string[];
        geo_kind: string;
        geo_payload: unknown;
        source_display_name: string;
      }>(
        await tx.execute(sql`
          select v.cluster_ids, v.geo_kind, v.geo_payload, s.display_name as source_display_name
            from search_versions v
            join searches s on s.id = v.search_id
           where v.id = ${fromVersionId}`),
      )[0];
      if (!source) return { kind: 'missing' } as const;

      const name = displayName ?? COPY_OF(source.source_display_name);

      /**
       * 🔴 A JS ARRAY IN A DRIZZLE `sql` TEMPLATE BECOMES N PLACEHOLDERS, NOT ONE ARRAY.
       *
       * `${source.cluster_ids}::uuid[]` does NOT bind one `uuid[]` parameter. Drizzle
       * expands an array into a comma-separated placeholder list — that is its behaviour
       * for `in (...)` — so the statement Postgres actually received was
       * `($2, $3)::uuid[]`, a ROW constructor cast to an array. Measured against this
       * database, at every arity:
       *
       *   2+ clusters -> 42846 cannot cast type record to uuid[]
       *   1 cluster   -> 22P02 malformed array literal
       *
       * So this insert could never succeed, and D-17 failed 100% of the time with the
       * generic "something broke on our side" — the action's `catch` turns the SQLSTATE
       * into `unexpected`, which is why nothing upstream ever reported an array problem.
       * Found by the first e2e run that actually pressed the button (plan 02-12).
       *
       * The array-LITERAL string is bound as a single parameter and cast once. It is a
       * parameter, not interpolated SQL, and every element is a uuid read out of this
       * same table, so there is no quoting or injection surface to get wrong.
       *
       * 🔴 `src/server/actions/save-preset-version.ts` HAS THE IDENTICAL DEFECT on its own
       * `cluster_ids` insert and is NOT fixed here — it belongs to the preset editor being
       * built in parallel (plan 02-11), and two worktrees editing one line is the conflict
       * this partitioning exists to avoid. It is recorded in deferred-items.md.
       */
      const clusterIdsLiteral = `{${source.cluster_ids.join(',')}}`;

      // Circular FK, so `current_version_id` starts null and is set below — see
      // `./save-preset-version.ts` for the full note. `name_internal` and `display_name` are
      // two columns and both take the typed name (CONVENTIONS § Naming).
      const created = rowsOf<{ id: string }>(
        await tx.execute(sql`
          insert into searches (org_id, name_internal, display_name, current_version_id)
          values (app.current_org_id(), ${name}, ${name}, null)
          returning id`),
      )[0];
      if (!created?.id) throw new Error('duplicatePreset: searches insert returned no id');

      const version = rowsOf<{ id: string; version: number }>(
        await tx.execute(sql`
          insert into search_versions
            (org_id, search_id, version, cluster_ids, geo_kind, geo_payload, created_by)
          values
            (app.current_org_id(), ${created.id}, 1, ${clusterIdsLiteral}::uuid[],
             ${source.geo_kind}, ${JSON.stringify(source.geo_payload)}::jsonb, ${userId})
          returning id, version`),
      )[0];
      if (!version?.id) {
        throw new Error('duplicatePreset: search_versions insert returned no id');
      }

      await tx.execute(sql`
        update searches set current_version_id = ${version.id} where id = ${created.id}`);

      return { kind: 'duplicated', searchId: created.id, version: version.version } as const;
    });

    if (result.kind === 'missing') return fail('not_found', NOT_FOUND('version'));

    revalidatePath('/presets');
    revalidatePath(`/presets/${result.searchId}`);
    return ok({ searchId: result.searchId, version: result.version });
  } catch {
    return fail('unexpected', UNEXPECTED_ERROR('this preset'));
  }
}
