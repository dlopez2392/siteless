'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  NO_CLUSTER_SELECTED,
  NO_GEOGRAPHY_SELECTED,
  PRESET_NAME_MISSING,
  VERSION_NOTICE,
} from '@/lib/ui/copy';
import type { PresetSpecInput } from '@/server/queries/presets';
import type { EditorReference } from '@/server/queries/preset-editor';
import { savePresetVersion } from '@/server/actions/save-preset-version';
import type { ClusterKey } from '@/seed/types';
import { ClusterPicker } from './cluster-picker';
import { GeographyPicker, type GeoMode, type RadiusCentre } from './geography-picker';

/**
 * SRCH-01's editor. `/presets/new` and `/presets/[id]/edit` are the same component with a
 * different `initial`.
 *
 * ── 🔴 WHY THERE IS NO `action` PROP ON THIS FORM, AND WHY THERE NEVER WILL BE ───────────
 *
 * Recorded BIS defect: React resets a form driven by the `action` prop EVEN WHEN THE ACTION
 * FAILED, and a Radix `Select` driven by that reset walks its own state BACKWARDS. On this
 * screen that would mean a failed save silently reverting the radius the user had just
 * chosen — with a validation message on screen explaining a state the form no longer holds.
 * The whole save path is therefore `onSubmit` + `useTransition`, which owns its own pending
 * flag and touches nothing else.
 *
 * ── SERVER-SIDE VALIDATION IS THE REAL ONE ───────────────────────────────────────────────
 *
 * The three inline checks below are an AFFORDANCE — they put the sentence next to the field
 * instead of at the bottom of a page. `savePresetVersion` re-parses everything with
 * `presetSpecSchema` behind its own `requireOrg()`, so a client that skips them is refused
 * exactly the same way (T-2-01, T-2-14).
 */

export type EditorInitial = {
  /** Absent on `/presets/new`. */
  searchId?: string;
  displayName: string;
  /** The version this form was loaded from. Absent on `/presets/new`; on an edit it is what
   *  `savePresetVersion` inserts AFTER, which is how `search_versions_search_version_uniq`
   *  becomes optimistic concurrency for free. */
  loadedVersion?: number;
  clusterKeys: ClusterKey[];
  mode: GeoMode;
  cityIds: string[];
  countyIds: string[];
  centre: RadiusCentre | null;
  radiusMiles: number;
};

type FieldErrors = { name?: string; clusters?: string; geography?: string };

/**
 * The wire spec, or `null` when the form is not yet a preset.
 *
 * Exported because the live-estimate hook takes exactly this and the two must agree about
 * when a selection is estimable: an estimate computed from a spec the save path would
 * refuse is a dollar figure for something that cannot exist.
 */
export function buildSpec(state: EditorState): PresetSpecInput | null {
  if (state.clusterKeys.length === 0) return null;
  if (state.mode === 'cities') {
    if (state.cityIds.length === 0) return null;
    return { clusterKeys: state.clusterKeys, geo: { kind: 'cities', cityIds: state.cityIds } };
  }
  if (state.mode === 'counties') {
    if (state.countyIds.length === 0) return null;
    return {
      clusterKeys: state.clusterKeys,
      geo: { kind: 'counties', countyIds: state.countyIds },
    };
  }
  if (state.centre === null) return null;
  return {
    clusterKeys: state.clusterKeys,
    geo: {
      kind: 'radius',
      lat: state.centre.lat,
      lng: state.centre.lng,
      countyFips: state.centre.countyFips,
      radiusMiles: state.radiusMiles as 5 | 10 | 25 | 50,
      matchedAddress: state.centre.matchedAddress,
      ...(state.centre.countyName === undefined ? {} : { countyName: state.centre.countyName }),
    },
  };
}

export type EditorState = {
  displayName: string;
  clusterKeys: ClusterKey[];
  mode: GeoMode;
  cityIds: string[];
  countyIds: string[];
  centre: RadiusCentre | null;
  radiusMiles: number;
};

export function PresetForm({
  reference,
  initial,
}: {
  reference: EditorReference;
  initial: EditorInitial;
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>({
    displayName: initial.displayName,
    clusterKeys: initial.clusterKeys,
    mode: initial.mode,
    cityIds: initial.cityIds,
    countyIds: initial.countyIds,
    centre: initial.centre,
    radiusMiles: initial.radiusMiles,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const isEdit = initial.searchId !== undefined;
  const nextVersion = (initial.loadedVersion ?? 0) + 1;
  const patch = (next: Partial<EditorState>) => setState((prev) => ({ ...prev, ...next }));

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (state.displayName.trim() === '') errors.name = PRESET_NAME_MISSING;
    if (state.clusterKeys.length === 0) errors.clusters = NO_CLUSTER_SELECTED;
    if (buildSpec({ ...state, clusterKeys: ['home_services'] }) === null) {
      errors.geography = NO_GEOGRAPHY_SELECTED;
    }
    return errors;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 🔴 The whole reason this handler exists rather than a form `action` prop. See header.
    event.preventDefault();
    setFailure(null);
    setConflictVersion(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const spec = buildSpec(state);
    if (spec === null) return;

    startSaving(async () => {
      const result = await savePresetVersion({
        ...(initial.searchId === undefined ? {} : { searchId: initial.searchId }),
        displayName: state.displayName.trim(),
        spec,
        ...(initial.loadedVersion === undefined ? {} : { loadedVersion: initial.loadedVersion }),
      });

      if (result.ok) {
        toast.success(`Version ${result.data.version} saved`);
        // Back to the list, where the new preset is on screen with its cost. The detail
        // route at /presets/[id] is plan 02-12's; this screen links to it from the card and
        // does not assume it before it ships.
        router.push('/presets');
        router.refresh();
        return;
      }

      if (result.code === 'conflict') {
        const shown = result.detail?.currentVersion;
        setConflictVersion(typeof shown === 'number' ? shown : nextVersion);
        setFailure(result.message);
        return;
      }

      if (result.code === 'validation') {
        // The action maps a zod issue path onto UI-SPEC's per-field sentence, so the
        // message IS the branch — matching on it puts the sentence beside the field it is
        // about instead of at the bottom of the page.
        if (result.message === PRESET_NAME_MISSING) setFieldErrors({ name: result.message });
        else if (result.message === NO_CLUSTER_SELECTED) {
          setFieldErrors({ clusters: result.message });
        } else if (result.message === NO_GEOGRAPHY_SELECTED) {
          setFieldErrors({ geography: result.message });
        } else setFailure(result.message);
        return;
      }

      setFailure(result.message);
    });
  }

  async function copyChanges() {
    const spec = buildSpec(state);
    const lines = [
      `Preset name: ${state.displayName}`,
      `Clusters: ${state.clusterKeys.join(', ')}`,
      `Geography: ${state.mode}`,
      spec === null ? 'Selection is incomplete' : JSON.stringify(spec),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Your changes are on the clipboard');
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-disabled={saving}
      data-testid="preset-editor-form"
      className="flex flex-col gap-6"
    >
      <Field data-invalid={fieldErrors.name !== undefined}>
        <FieldLabel htmlFor="preset-editor-name" className="text-sm font-semibold">
          Preset name
        </FieldLabel>
        <Input
          id="preset-editor-name"
          data-testid="preset-editor-name"
          value={state.displayName}
          onChange={(event) => patch({ displayName: event.target.value })}
          placeholder="Hidalgo — home services"
          aria-invalid={fieldErrors.name !== undefined}
          aria-describedby={
            fieldErrors.name === undefined ? undefined : 'preset-editor-name-error'
          }
          className="h-11 text-base"
        />
        {fieldErrors.name === undefined ? (
          <FieldDescription className="text-sm font-normal text-muted-foreground">
            You&apos;ll see this on the run list and in spend history.
          </FieldDescription>
        ) : (
          <InlineError id="preset-editor-name-error" message={fieldErrors.name} />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <ClusterPicker
          clusters={reference.clusters}
          selected={state.clusterKeys}
          invalid={fieldErrors.clusters !== undefined}
          errorId={
            fieldErrors.clusters === undefined ? undefined : 'preset-editor-clusters-error'
          }
          onToggle={(key, checked) =>
            patch({
              clusterKeys: checked
                ? [...state.clusterKeys, key]
                : state.clusterKeys.filter((k) => k !== key),
            })
          }
        />
        {fieldErrors.clusters === undefined ? null : (
          <InlineError id="preset-editor-clusters-error" message={fieldErrors.clusters} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <GeographyPicker
          reference={reference}
          mode={state.mode}
          cityIds={state.cityIds}
          countyIds={state.countyIds}
          centre={state.centre}
          radiusMiles={state.radiusMiles}
          invalid={fieldErrors.geography !== undefined}
          errorId={
            fieldErrors.geography === undefined ? undefined : 'preset-editor-geography-error'
          }
          onModeChange={(mode) => patch({ mode })}
          onCityIdsChange={(cityIds) => patch({ cityIds })}
          onCountyIdsChange={(countyIds) => patch({ countyIds })}
          onCentreChange={(centre) => patch({ centre })}
          onRadiusChange={(radiusMiles) => patch({ radiusMiles })}
        />
        {fieldErrors.geography === undefined ? null : (
          <InlineError id="preset-editor-geography-error" message={fieldErrors.geography} />
        )}
      </div>

      {conflictVersion === null ? null : (
        <Alert variant="destructive" data-testid="preset-editor-conflict">
          <CircleAlert data-icon="circle-alert" className="size-4" aria-hidden="true" />
          <AlertTitle>This preset moved while you were editing</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{failure}</span>
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                data-testid="preset-editor-conflict-reload"
                onClick={() => router.refresh()}
              >
                Reload version {conflictVersion}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                data-testid="preset-editor-conflict-copy"
                onClick={copyChanges}
              >
                Copy my changes first
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {failure === null || conflictVersion !== null ? null : (
        <Alert variant="destructive" data-testid="preset-editor-failure">
          <CircleAlert data-icon="circle-alert" className="size-4" aria-hidden="true" />
          <AlertTitle>Siteless could not save this preset</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      {/* D-15, mandatory and directly above the save button on the edit screen. Versions are
          immutable and a finished run points at one — that is the thing a user has to
          understand BEFORE they press save, not after. */}
      {isEdit ? (
        <p
          data-testid="preset-editor-version-notice"
          className="text-sm font-normal tabular-nums text-muted-foreground"
        >
          {VERSION_NOTICE(nextVersion)}
        </p>
      ) : null}

      {/* Desk: the actions sit inline under the form. Phone: the same two controls are the
          sticky action bar in the thumb zone (MOB-01), on the --card surface with a 1px top
          border, directly above the 64px tab bar and its safe-area inset. */}
      <Card className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 flex-row items-center gap-3 rounded-none border-0 border-t p-4 shadow-none sm:static sm:border-0 sm:p-0">
        <Button
          type="submit"
          variant="default"
          disabled={saving}
          data-testid="preset-editor-save"
          className="h-12 flex-1 sm:h-11 sm:flex-none"
        >
          {saving ? (
            <>
              <Spinner className="size-4" aria-hidden="true" />
              {`Saving version ${nextVersion}…`}
            </>
          ) : isEdit ? (
            `Save as version ${nextVersion}`
          ) : (
            'Create preset'
          )}
        </Button>
        <Button asChild variant="ghost" className="h-12 sm:h-11">
          <Link href="/presets" data-testid="preset-editor-dismiss">
            Close without saving
          </Link>
        </Button>
      </Card>
    </form>
  );
}

/**
 * 🔴 ERROR TEXT IS NEVER COLOUR-ONLY (UI-SPEC § Accessibility). The `circle-alert` icon
 * carries the same meaning for a reader who cannot see the tone, and the message is linked
 * to its control with `aria-describedby` while the control carries `aria-invalid`.
 */
function InlineError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-2 text-sm font-normal text-destructive">
      <CircleAlert data-icon="circle-alert" className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
