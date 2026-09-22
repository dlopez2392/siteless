'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription, FieldLabel } from '@/components/ui/field';
import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import type { ClusterOption } from '@/server/queries/preset-editor';
import type { ClusterKey } from '@/seed/types';

/**
 * D-03: the industry side is the four seeded clusters, ATOMIC.
 *
 * 🔴 THERE IS NO PER-TYPE TOGGLE INSIDE A CLUSTER IN v1, and that is a decision rather than
 * an omission. The Places types and the NAICS ranges that make up a cluster are seed data
 * (`src/seed/data/clusters.json`); the estimator prices a whole cluster against a whole
 * geography, and a half-selected cluster is a cell the committed cost model has never been
 * checked against. Per-type exclusion is in 02-CONTEXT § Deferred Ideas.
 *
 * The outlet counts arrive preformatted from the server (see `preset-editor.ts`) — nothing
 * on the client formats a number, so the client and the server cannot resolve a different
 * locale and produce an SSR hydration mismatch.
 */
export function ClusterPicker({
  clusters,
  selected,
  invalid,
  errorId,
  onToggle,
}: {
  clusters: ClusterOption[];
  selected: ClusterKey[];
  invalid: boolean;
  errorId: string | undefined;
  onToggle: (key: ClusterKey, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor="preset-editor-cluster-group" className="text-sm font-semibold">
        Industry clusters
      </FieldLabel>
      <FieldDescription className="text-sm font-normal text-muted-foreground">
        Pick one or more. Clusters are atomic — the Places types and NAICS ranges inside them
        are seeded.
      </FieldDescription>
      <ItemGroup
        id="preset-editor-cluster-group"
        role="group"
        aria-label="Industry clusters"
        aria-invalid={invalid}
        aria-describedby={errorId}
        className="gap-2"
      >
        {clusters.map((cluster) => {
          const id = `preset-editor-cluster-${cluster.key}`;
          const checked = selected.includes(cluster.key);
          return (
            <Item key={cluster.key} variant="outline" asChild className="min-h-11 py-2">
              <Label htmlFor={id} className="cursor-pointer items-center font-normal">
                <ItemMedia>
                  <Checkbox
                    id={id}
                    data-testid={id}
                    checked={checked}
                    onCheckedChange={(next) => onToggle(cluster.key, next === true)}
                    className="size-5"
                  />
                </ItemMedia>
                <ItemContent className="gap-0">
                  <span className="text-base font-normal">{cluster.displayName}</span>
                  <span className="text-sm font-normal tabular-nums text-muted-foreground">
                    {cluster.outletLabel}
                  </span>
                </ItemContent>
              </Label>
            </Item>
          );
        })}
      </ItemGroup>
    </div>
  );
}
