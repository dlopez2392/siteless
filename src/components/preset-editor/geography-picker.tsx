'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { FieldLabel } from '@/components/ui/field';
import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { EditorReference } from '@/server/queries/preset-editor';
import { RadiusGeocoder, type RadiusCentre } from './radius-geocoder';

/**
 * D-01: all three geography modes ship in this phase — the seeded RGV city list, the county
 * picker with D-04's built-in Texas row, and a radius around a geocoded address.
 *
 * 🔴 THE TEXAS ROW RENDERS `Texas (254 counties)` AND ITS MULTIPLIER CHIP IS COMPUTED.
 * Both strings come down as props: the label is built from the county rows that were
 * actually read (so a seed shipping 253 would say 253), and the chip reads `×{n}` from
 * `texasMultiplier(ctx)` — which the seeded cell lists put at about 14.9, not at the much
 * larger illustrative figure in UI-SPEC's copy table (Executor Rule 16: the numbers in that
 * document show the format, not the arithmetic). Nothing here is a literal, and the
 * illustrative one is deliberately not repeated in this file so the grep that forbids it
 * counts rendered values rather than comments about them.
 *
 * 🔴 SELECTING TEXAS IS AN ORDINARY COUNTY SELECTION — all 254 county ids — so nothing
 * downstream special-cases it. That is exactly D-04's "the estimator treats it like any
 * geography; nothing is special-cased".
 *
 * 🔴 THE PICKERS SEND IDS, NEVER NAMES. `search_versions.geo_payload` stores `{ cityIds }`
 * / `{ countyIds }`, which is the shape `tests/db/versioned-presets.test.ts` round-trips,
 * and an id belonging to another tenant simply does not resolve through `resolveSpec`.
 */

export type GeoMode = 'cities' | 'counties' | 'radius';
export type { RadiusCentre };

export function GeographyPicker({
  reference,
  mode,
  cityIds,
  countyIds,
  centre,
  radiusMiles,
  invalid,
  errorId,
  onModeChange,
  onCityIdsChange,
  onCountyIdsChange,
  onCentreChange,
  onRadiusChange,
}: {
  reference: EditorReference;
  mode: GeoMode;
  cityIds: string[];
  countyIds: string[];
  centre: RadiusCentre | null;
  radiusMiles: number;
  invalid: boolean;
  errorId: string | undefined;
  onModeChange: (mode: GeoMode) => void;
  onCityIdsChange: (ids: string[]) => void;
  onCountyIdsChange: (ids: string[]) => void;
  onCentreChange: (centre: RadiusCentre | null) => void;
  onRadiusChange: (miles: number) => void;
}) {
  const [query, setQuery] = useState('');

  const selectedCities = reference.cities.filter((c) => cityIds.includes(c.id));
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? reference.cities
      : reference.cities.filter((c) => c.name.toLowerCase().includes(needle));

  // "All of Texas" is true exactly when every seeded county is selected. Derived, never a
  // separate flag — a flag and a list are two sources of truth for one selection.
  const texasSelected =
    reference.texas.countyIds.length > 0 &&
    reference.texas.countyIds.every((id) => countyIds.includes(id));

  function toggleCity(id: string, checked: boolean) {
    onCityIdsChange(checked ? [...cityIds, id] : cityIds.filter((c) => c !== id));
  }

  function toggleCounty(id: string, checked: boolean) {
    onCountyIdsChange(checked ? [...countyIds, id] : countyIds.filter((c) => c !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="preset-editor-mode" className="text-sm font-semibold">
          Geography
        </FieldLabel>
        <ToggleGroup
          id="preset-editor-mode"
          type="single"
          value={mode}
          onValueChange={(next) => {
            // Radix clears a single ToggleGroup when the active item is pressed again.
            // A geography is mandatory, so an empty value is not a state this form has.
            if (next === 'cities' || next === 'counties' || next === 'radius') {
              onModeChange(next);
            }
          }}
          variant="outline"
          className="w-full"
          aria-invalid={invalid}
          aria-describedby={errorId}
        >
          <ToggleGroupItem
            value="cities"
            data-testid="preset-editor-mode-cities"
            className="h-11 flex-1 text-base"
          >
            Cities
          </ToggleGroupItem>
          <ToggleGroupItem
            value="counties"
            data-testid="preset-editor-mode-county"
            className="h-11 flex-1 text-base"
          >
            County
          </ToggleGroupItem>
          <ToggleGroupItem
            value="radius"
            data-testid="preset-editor-mode-radius"
            className="h-11 flex-1 text-base"
          >
            Radius
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === 'cities' ? (
        <div className="flex flex-col gap-3">
          {selectedCities.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {selectedCities.map((city) => (
                <Badge key={city.id} variant="outline" className="h-11 gap-1 pl-3 pr-1 text-sm">
                  {city.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${city.name}`}
                    data-testid={`preset-editor-city-remove-${city.id}`}
                    onClick={() => toggleCity(city.id, false)}
                    className="size-11"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          <Command shouldFilter={false} className="border">
            <CommandInput
              data-testid="preset-editor-city-search"
              value={query}
              onValueChange={setQuery}
              placeholder={`Search the ${reference.cities.length} RGV cities`}
              className="h-11 text-base"
            />
            {matches.length === 0 ? (
              <Empty className="py-8" data-testid="preset-editor-city-empty">
                <EmptyHeader>
                  <EmptyTitle className="text-xl font-semibold leading-tight">
                    No RGV city matches “{query}”
                  </EmptyTitle>
                  <EmptyDescription className="max-w-[60ch] text-base font-normal text-muted-foreground">
                    Siteless ships the {reference.cities.length} Rio Grande Valley cities.
                    Clear the search to see all of them, or switch to County or Radius for a
                    wider net.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    data-testid="preset-editor-city-clear"
                    onClick={() => setQuery('')}
                  >
                    Clear search
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <ScrollArea className="max-h-80">
                <CommandList className="max-h-none">
                  {matches.map((city) => {
                    const id = `preset-editor-city-${city.id}`;
                    const checked = cityIds.includes(city.id);
                    return (
                      <CommandItem
                        key={city.id}
                        value={city.name}
                        data-testid={id}
                        onSelect={() => toggleCity(city.id, !checked)}
                        className="h-11 gap-3"
                      >
                        <Checkbox
                          checked={checked}
                          tabIndex={-1}
                          aria-hidden="true"
                          className="pointer-events-none size-5"
                        />
                        <span className="flex-1 text-base font-normal">{city.name}</span>
                        <span className="text-sm font-normal tabular-nums text-muted-foreground">
                          {city.outletLabel}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </ScrollArea>
            )}
          </Command>
        </div>
      ) : null}

      {mode === 'counties' ? (
        <ItemGroup className="gap-2">
          {reference.rgvCounties.map((county) => {
            const id = `preset-editor-county-${county.id}`;
            const checked = countyIds.includes(county.id);
            return (
              <Item key={county.id} variant="outline" asChild className="min-h-11 py-2">
                <Label htmlFor={id} className="cursor-pointer items-center font-normal">
                  <ItemMedia>
                    <Checkbox
                      id={id}
                      data-testid={id}
                      checked={checked}
                      onCheckedChange={(next) => toggleCounty(county.id, next === true)}
                      className="size-5"
                    />
                  </ItemMedia>
                  <ItemContent className="gap-0">
                    <span className="text-base font-normal">{county.name}</span>
                    <span className="text-sm font-normal tabular-nums text-muted-foreground">
                      {county.outletLabel}
                    </span>
                  </ItemContent>
                </Label>
              </Item>
            );
          })}

          <Separator className="my-2" />

          <Item variant="outline" asChild className="min-h-11 py-2">
            <Label
              htmlFor="preset-editor-county-texas"
              className="cursor-pointer items-center font-normal"
            >
              <ItemMedia>
                <Checkbox
                  id="preset-editor-county-texas"
                  data-testid="preset-editor-county-texas"
                  checked={texasSelected}
                  onCheckedChange={(next) =>
                    onCountyIdsChange(next === true ? [...reference.texas.countyIds] : [])
                  }
                  className="size-5"
                />
              </ItemMedia>
              <ItemContent className="gap-1">
                <span className="text-base font-normal">{reference.texas.label}</span>
                <span className="text-sm font-normal tabular-nums text-muted-foreground">
                  {reference.texas.outletLabel}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Built-in
                  </Badge>
                  {/* Warning tone, and never colour alone: the chip carries the word
                      "vs RGV" beside the number. */}
                  <Badge
                    data-testid="preset-editor-texas-multiplier"
                    className="bg-warning-surface text-warning-surface-foreground tabular-nums"
                  >
                    ×{reference.texasMultiplier.toFixed(1)} vs RGV
                  </Badge>
                </span>
              </ItemContent>
            </Label>
          </Item>
        </ItemGroup>
      ) : null}

      {mode === 'radius' ? (
        <RadiusGeocoder
          centre={centre}
          radiusMiles={radiusMiles}
          radiusOptions={reference.radiusOptions}
          onCentreChange={onCentreChange}
          onRadiusChange={onRadiusChange}
          onSwitchToCounty={() => onModeChange('counties')}
          onSwitchToCities={() => onModeChange('cities')}
        />
      ) : null}
    </div>
  );
}
