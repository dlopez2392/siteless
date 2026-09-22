import { PresetForm } from '@/components/preset-editor/preset-form';
import { orgClaims } from '@/lib/auth/require-org';
import { getEditorReference } from '@/server/queries/preset-editor';

export const dynamic = 'force-dynamic';

/**
 * UI-SPEC § Screen Inventory 2, the "new" half. A thin server component: it reads the
 * seeded reference rows and the live meter once, and hands them to the client form as
 * props.
 *
 * 🔴 IT READS RATHER THAN RE-EXPORTS. A `"use client"` module's exports are client
 * REFERENCES inside a server component — plain data objects included — and resolve to
 * `undefined` at runtime with typecheck, lint and build all green (UI-SPEC Executor Rule 5,
 * two recorded BIS 500s). Props cross that boundary; imports of data do not.
 *
 * 🔴 `requireOrg()` is already the first statement of the group layout (T-2-01). This page
 * takes claims for its own query and opens exactly one `withOrg`, because the pool is
 * `max: 1` and a nested transaction hangs rather than failing.
 */
export default async function NewPresetPage() {
  const claims = await orgClaims();
  const reference = await getEditorReference(claims);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold leading-tight">New search preset</h1>

      <PresetForm
        reference={reference}
        initial={{
          displayName: '',
          clusterKeys: [],
          mode: 'cities',
          cityIds: [],
          countyIds: [],
          centre: null,
          // The middle of the seeded options, taken from the list rather than typed: a
          // radius this Select cannot offer is one the committed cost model never priced.
          radiusMiles: reference.radiusOptions[1] ?? reference.radiusOptions[0] ?? 10,
        }}
      />
    </div>
  );
}
