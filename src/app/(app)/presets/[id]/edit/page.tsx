import { notFound } from 'next/navigation';
import { PresetForm, type EditorInitial } from '@/components/preset-editor/preset-form';
import { orgClaims } from '@/lib/auth/require-org';
import { getEditorReference } from '@/server/queries/preset-editor';
import { getPreset } from '@/server/queries/presets';

export const dynamic = 'force-dynamic';

/**
 * UI-SPEC § Screen Inventory 2, the "edit" half — and D-15's whole point: there are no
 * drafts. Saving here appends an immutable `search_versions` row and moves the preset's
 * current pointer; runs that already finished keep pointing at the version that produced
 * them (SRCH-03), which is a foreign key and a revoked grant, not a convention.
 *
 * 🔴 `loadedVersion` IS CARRIED THROUGH THE FORM AND BACK TO THE ACTION. It is not a
 * display value: `savePresetVersion` inserts at `loadedVersion + 1` and lets
 * `search_versions_search_version_uniq` decide, so if somebody else saved first the
 * insert raises `23505` and the screen shows UI-SPEC's save-conflict copy. That is
 * optimistic concurrency for free — and it works only if this page passes the number
 * down rather than letting the form read the current maximum, which is exactly the
 * check-then-write the constraint exists to replace.
 *
 * 🔴 A MISSING PRESET IS A 404, NOT AN EMPTY FORM. `getPreset` is confined by RLS, so a
 * foreign id and a deleted id are the same answer — which is the intended behaviour
 * (T-2-10) and the reason this page never says which of the two it was.
 */
export default async function EditPresetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const claims = await orgClaims();

  // Sequential, never nested: `src/db/client.ts` pools with max: 1, so a second withOrg
  // opened inside the first waits on a connection the outer transaction holds and the
  // request hangs (02-09's deviation 7).
  const preset = await getPreset(claims, id);
  if (preset === null || preset.currentVersion === null) notFound();

  const reference = await getEditorReference(claims);
  const current = preset.currentVersion;
  const spec = current.spec;

  // `spec` is null only when a reference row a saved version names has gone. The form then
  // opens with the name and the version number intact and an empty selection, which is
  // honest: the preset exists, and what it pointed at no longer does.
  const initial: EditorInitial = {
    searchId: preset.id,
    displayName: preset.displayName,
    loadedVersion: current.version,
    clusterKeys: spec?.clusterKeys ?? [],
    mode: spec?.geo.kind ?? 'cities',
    cityIds: spec?.geo.kind === 'cities' ? spec.geo.cityIds : [],
    countyIds: spec?.geo.kind === 'counties' ? spec.geo.countyIds : [],
    centre:
      spec?.geo.kind === 'radius'
        ? {
            lat: spec.geo.lat,
            lng: spec.geo.lng,
            countyFips: spec.geo.countyFips,
            matchedAddress: spec.geo.matchedAddress,
            ...(spec.geo.countyName === undefined ? {} : { countyName: spec.geo.countyName }),
          }
        : null,
    radiusMiles:
      spec?.geo.kind === 'radius'
        ? spec.geo.radiusMiles
        : (reference.radiusOptions[1] ?? reference.radiusOptions[0] ?? 10),
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold leading-tight">Edit {preset.displayName}</h1>

      <PresetForm reference={reference} initial={initial} />
    </div>
  );
}
