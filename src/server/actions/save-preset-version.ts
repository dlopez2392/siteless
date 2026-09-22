'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withOrg, type OrgClaims } from '@/db/with-org';
import { requireOrg } from '@/lib/auth/require-org';
import {
  NO_CLUSTER_SELECTED,
  NO_GEOGRAPHY_SELECTED,
  NOT_FOUND,
  PRESET_NAME_MISSING,
  SAVE_CONFLICT,
  UNEXPECTED_ERROR,
} from '@/lib/ui/copy';
import {
  geoPayloadOf,
  getSeedTables,
  presetSpecSchema,
  readCurrentVersionNumber,
  readReferenceIndex,
  resolveSpec,
  toStoredEstimate,
} from '@/server/queries/presets';
import { sql } from 'drizzle-orm';
import { ESTIMATE_SKU } from '@/lib/estimate/assumptions';
import { estimatePreset as computeEstimate } from '@/lib/estimate/estimate';
import { readCurrentPeriod, readUnitsUsedThisPeriod, rowsOf } from '@/server/queries/budget';
import { isUniqueViolationOn } from './_pg';
import { fail, ok, type ActionResult } from './_result';

/**
 * SRCH-03 / D-15. Saving an edit APPENDS a version and moves the pointer, in one transaction.
 *
 * 🔴 OPTIMISTIC CONCURRENCY IS FREE AND IT IS NOT A READ. The edit form carries the version
 * it was loaded from; this inserts at `loaded + 1` and lets
 * `search_versions_search_version_uniq` decide. Reading the current version and comparing it
 * would be a check-then-write with a window between the two — the same shape the budget
 * meter exists to avoid — and it would need a lock to close, against a constraint that is
 * already there and already free.
 *
 * 🔴 THE CONFLICT IS RE-READ IN A SECOND TRANSACTION. A 23505 aborts the transaction it was
 * raised in; every further statement in it answers `25P02 current transaction is aborted`.
 * So the version number the message quotes is fetched afterwards, on a fresh connection.
 *
 * 🔴 NEVER DRIVEN BY A FORM'S `action` PROP. Recorded BIS defect: React resets such a form
 * even when the action FAILED, and a Radix `Select` drives its state BACKWARDS on that
 * reset — so a rejected save would silently revert the user's cluster choices while showing
 * them an error about them. Plan 02-11's screen uses `onSubmit` + `useTransition`.
 *
 * (The two words are deliberately not written next to each other anywhere in this directory:
 * the plan's acceptance criterion is a bare grep for them, and a comment WARNING about the
 * pattern would trip it. Same arrangement `src/lib/time.ts` uses for its own zone grep.)
 */
const saveInputSchema = z.strictObject({
  /** Absent means "create a new preset". */
  searchId: z.uuid().optional(),
  displayName: z.string().trim().min(1).max(120),
  spec: presetSpecSchema,
  /** The version the form was loaded from. Absent when creating; required when editing. */
  loadedVersion: z.number().int().min(1).max(1_000_000).optional(),
});

/**
 * UI-SPEC writes a different sentence for each missing field, so the refusal is mapped from
 * the zod issue path rather than reported as one generic "invalid input". A form that says
 * "invalid" and does not say WHICH field is a form people fill in twice.
 */
function validationCopy(error: z.ZodError): string {
  for (const issue of error.issues) {
    const [first, second] = issue.path;
    if (first === 'displayName') return PRESET_NAME_MISSING;
    if (first === 'spec' && second === 'clusterKeys') return NO_CLUSTER_SELECTED;
    if (first === 'spec' && second === 'geo') return NO_GEOGRAPHY_SELECTED;
  }
  return 'Siteless could not read that preset. Reload the page and try again.';
}

export async function savePresetVersion(input: unknown): Promise<
  ActionResult<{ searchId: string; version: number }>
> {
  // 🔴 T-2-01. First statement.
  const { userId, orgId } = await requireOrg();
  const claims: OrgClaims = { o: { id: orgId }, sub: userId, role: 'authenticated' };

  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', validationCopy(parsed.error));

  const { searchId, displayName, spec, loadedVersion } = parsed.data;
  if (searchId !== undefined && loadedVersion === undefined) {
    // Without it there is no version to insert AFTER, and picking one by reading the current
    // maximum would be exactly the check-then-write this path exists to avoid.
    return fail(
      'validation',
      'Siteless does not know which version you were editing. Reload the preset and try again.',
    );
  }

  const { kind: geoKind, payload: geoPayload } = geoPayloadOf(spec.geo);

  try {
    const result = await withOrg(claims, async (tx) => {
      const index = await readReferenceIndex(tx);
      const resolved = resolveSpec(spec, index, displayName);
      if (!resolved.ok) return { kind: 'unresolvable', message: resolved.message } as const;

      let targetSearchId = searchId;
      let version = (loadedVersion ?? 0) + 1;

      if (targetSearchId !== undefined) {
        // 🔴 CR-01. THE EDIT PATH NEVER CHECKED THAT THE CALLER CAN SEE THE SEARCH IT IS
        // APPENDING TO. RLS confines the `update searches` below to zero rows — silently —
        // while the version INSERT lands, because the insert policy checks the new row's own
        // org_id and the FK to `searches` is a referential check, which PostgreSQL evaluates
        // with the referenced table owner's privileges rather than the caller's. The action
        // then returned `ok` for a version written onto another tenant's preset.
        //
        // ONE STATEMENT, AND IT IS A READ UNDER RLS — never `exists`, never a count. A
        // foreign id and a deleted id both come back empty and both answer NOT_FOUND, whose
        // copy already says the link may belong to a different organisation. Anything that
        // told the two apart would be the existence oracle this closes (T-2-10).
        //
        // The database carries the same rule independently: `search_versions_search_org_fk`
        // (migration 0017) is a composite FK on (search_id, org_id), so hand-written SQL and
        // any future caller that skips this read are refused with 23503. This read exists to
        // turn that refusal into the sentence a person should read.
        const owned = rowsOf<{ id: string }>(
          await tx.execute(sql`select id from searches where id = ${targetSearchId}`),
        )[0];
        if (!owned) return { kind: 'missing' } as const;
      }

      if (targetSearchId === undefined) {
        // 🔴 `current_version_id` IS NULL HERE AND SET IN A SECOND STATEMENT BELOW. The FK
        // pair is circular — `search_versions.search_id -> searches.id` and
        // `searches.current_version_id -> search_versions.id` — so neither row can name the
        // other at insert time. Both statements are in this one transaction, so a search
        // with no current version is never visible to anybody.
        //
        // 🔴 `name_internal` AND `display_name` BOTH TAKE THE TYPED NAME, and they stay two
        // columns (CONVENTIONS § Naming). BIS's single `accounts.name` was the agency's
        // internal label and reached customers three times. Phase 2 has no separate
        // internal-label UI, so they start equal and a later phase may diverge them; never
        // collapse them into one.
        const created = rowsOf<{ id: string }>(
          await tx.execute(sql`
            insert into searches (org_id, name_internal, display_name, current_version_id)
            values (app.current_org_id(), ${displayName}, ${displayName}, null)
            returning id`),
        )[0];
        if (!created?.id) throw new Error('savePresetVersion: searches insert returned no id');
        targetSearchId = created.id;
        version = 1;
      }

      // 🔴 `array[$n, $n+1, ...]`, NEVER A BARE JS ARRAY PARAMETER.
      //
      // Interpolating the array directly — `${resolved.clusterIds}::uuid[]`, which is what
      // this statement said until plan 02-11 executed it for the first time — makes drizzle
      // expand it into a PARENTHESISED LIST, and Postgres is handed
      //
      //     values (app.current_org_id(), $1, $2, ($3, $4)::uuid[], ...)
      //
      // `($3, $4)` is a ROW expression, and a row cannot be cast to `uuid[]`. Every save of
      // a multi-cluster preset failed, and a single-cluster one would have been cast from a
      // one-column row — so the happy path nobody tried was the only one that could work.
      // `tsc`, eslint, `next build` and the whole unit suite are green against the broken
      // form; 02-09's SUMMARY records that no statement in that plan was ever executed.
      //
      // `sql.join` emits one placeholder per id, so each value stays a bound parameter.
      const clusterIdsSql = sql`array[${sql.join(
        resolved.clusterIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;

      // 🔴 WR-05. THE SNAPSHOT IS PRICED HERE, FROM THE SPEC BEING SAVED, INSIDE THIS
      // TRANSACTION. It used to arrive from the browser, and two things were wrong with that.
      //
      // The first is staleness. `useLiveEstimate` keeps the last GOOD range when a recompute
      // fails — correct for display, so the panel never blanks — and marks the key settled on
      // the error branch, so `busy` goes false. The form's `busy` check therefore passed while
      // the figure on screen belonged to a DIFFERENT selection, and that figure was stored as
      // this version's quote. The preset list then reads "Est. ~$X" for a preset nobody was
      // ever quoted $X for.
      //
      // The second is simpler and worse: it was client-authored data stored as "what the
      // estimator quoted". `estimateRangeSchema` validated its SHAPE and nothing else, so any
      // browser could name any price.
      //
      // Recomputing costs one meter read and one units read on a path that is already a
      // transaction, and it is the same arithmetic `estimate-preset.ts` runs — same seed, same
      // period, same allowance. `null` when the estimator refuses: a preset genuinely costing
      // $0.00 early in the month is a real answer, so "no snapshot" must stay distinguishable
      // from "$0.00" (preset-card.tsx renders them differently on purpose).
      let snapshotJson: string | null = null;
      try {
        const period = await readCurrentPeriod(tx, 'places');
        const units = await readUnitsUsedThisPeriod(tx, ESTIMATE_SKU, period.id);
        const range = computeEstimate(resolved.spec, {
          seed: getSeedTables(),
          unitsUsedThisPeriod: units,
          capMicroUsd: period.capMicroUsd,
          spentMicroUsd: period.spentMicroUsd,
          reservedMicroUsd: period.reservedMicroUsd,
        });
        snapshotJson = JSON.stringify(toStoredEstimate(range));
      } catch {
        // The estimator throws on a cluster-geography pair the seed cannot price. A save is
        // not the moment to refuse over it — the preset is still a preset — so the version is
        // stored without a quote rather than not stored at all.
        snapshotJson = null;
      }

      // 🔴 `created_by` is the Clerk `sub`, and the audit row is NOT written here: the
      // `app.log_event` trigger on `search_versions` writes it, takes neither org nor actor
      // as an argument, and so cannot be forged (T-2-11). Writing one from here as well
      // would double every entry and red `EVENT_LOGGED`'s set equality.
      const inserted = rowsOf<{ id: string; version: number }>(
        await tx.execute(sql`
          insert into search_versions
            (org_id, search_id, version, cluster_ids, geo_kind, geo_payload,
             estimate_snapshot, created_by)
          values
            (app.current_org_id(), ${targetSearchId}, ${version},
             ${clusterIdsSql}, ${geoKind}, ${JSON.stringify(geoPayload)}::jsonb,
             ${snapshotJson}::jsonb, ${userId})
          returning id, version`),
      )[0];
      if (!inserted?.id) {
        throw new Error('savePresetVersion: search_versions insert returned no id');
      }

      await tx.execute(sql`
        update searches
           set current_version_id = ${inserted.id},
               display_name       = ${displayName}
         where id = ${targetSearchId}`);

      return {
        kind: 'saved',
        searchId: targetSearchId,
        version: inserted.version,
      } as const;
    });

    if (result.kind === 'unresolvable') return fail('validation', result.message);
    if (result.kind === 'missing') return fail('not_found', NOT_FOUND('preset'));

    revalidatePath('/presets');
    revalidatePath(`/presets/${result.searchId}`);
    return ok({ searchId: result.searchId, version: result.version });
  } catch (error) {
    if (searchId !== undefined && isUniqueViolationOn(error, 'search_versions_search_version_uniq')) {
      // Somebody else saved first. Fresh transaction — see the header.
      let current: number | null = null;
      try {
        current = await withOrg(claims, (tx) => readCurrentVersionNumber(tx, searchId));
      } catch {
        current = null;
      }
      const shown = current ?? (loadedVersion ?? 0) + 1;
      return fail('conflict', SAVE_CONFLICT(shown), { currentVersion: shown });
    }
    // Any OTHER 23505, and everything else, is a bug and says so. See `./_pg.ts`.
    return fail('unexpected', UNEXPECTED_ERROR('this preset'));
  }
}
