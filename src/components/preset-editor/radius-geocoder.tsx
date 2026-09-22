'use client';

import { CircleAlert } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { GEOCODE_NO_MATCH, GEOCODE_UNREACHABLE } from '@/lib/ui/copy';
import { geocodeAddress } from '@/server/actions/geocode-address';

/**
 * D-01/D-02's third geography: a radius around a geocoded address.
 *
 * 🔴 THE ADDRESS ON SCREEN IS THE ONE THE SERVICE RETURNED, NEVER THE ONE THAT WAS TYPED.
 * The US Census Geocoder silently corrects a bad ZIP — '99999' comes back as '78501' — so
 * echoing the typed string would hide the correction and the preset would be centred
 * somewhere the user never asked for without anything on screen saying so. The single
 * exception is the no-match sentence, which quotes the input precisely because there is no
 * match to quote instead.
 *
 * 🔴 EVERY FAILURE ENDS WITH A WAY OUT, AND THE WAY OUT IS A CONTROL. UI-SPEC's escape
 * hatch for the colonia case ("define this preset by county instead") is a button that
 * actually moves the ToggleGroup, not a sentence telling the user to go and do it.
 *
 * 🔴 GEOCODING COSTS NOTHING. No key, no Google call, no ledger row, no reservation. The
 * help text says so on screen because "this will call an API" is the reasonable assumption
 * and it is wrong here.
 */

export type RadiusCentre = {
  lat: number;
  lng: number;
  countyFips: string;
  matchedAddress: string;
  countyName?: string;
};

type Failure = { code: 'validation' | 'upstream'; message: string };

const HELP = 'Geocoded free by the US Census Geocoder. No Google call, no cost.';

export function RadiusGeocoder({
  centre,
  radiusMiles,
  radiusOptions,
  onCentreChange,
  onRadiusChange,
  onSwitchToCounty,
  onSwitchToCities,
}: {
  centre: RadiusCentre | null;
  radiusMiles: number;
  radiusOptions: number[];
  onCentreChange: (centre: RadiusCentre | null) => void;
  onRadiusChange: (miles: number) => void;
  onSwitchToCounty: () => void;
  onSwitchToCities: () => void;
}) {
  const [address, setAddress] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [finding, startFinding] = useTransition();

  function find() {
    const typed = address.trim();
    if (typed.length < 3) {
      // The same sentence the action would return for it, from the same constant — an
      // unusable address IS, to the person who typed it, an address we could not find.
      setFailure({ code: 'validation', message: GEOCODE_NO_MATCH(typed) });
      return;
    }
    setFailure(null);
    startFinding(async () => {
      const result = await geocodeAddress(typed);
      if (result.ok) {
        onCentreChange(result.data);
        return;
      }
      setFailure({
        code: result.code === 'upstream' ? 'upstream' : 'validation',
        // `upstream` always carries GEOCODE_UNREACHABLE; naming the constant here rather
        // than trusting the payload keeps the sentence fixed even if a future code path
        // forgets it.
        message: result.code === 'upstream' ? GEOCODE_UNREACHABLE : result.message,
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {centre === null ? (
        <Field>
          <FieldLabel htmlFor="preset-editor-address" className="text-sm font-semibold">
            Address
          </FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="preset-editor-address"
              data-testid="preset-editor-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                // Enter inside the editor's single <form> would submit the whole preset,
                // which is not what pressing Enter in an address box means.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  find();
                }
              }}
              placeholder="Street address, city, ZIP"
              aria-invalid={failure !== null}
              aria-describedby={failure === null ? undefined : 'preset-editor-address-error'}
              className="h-11 text-base"
            />
            {/* min-w keeps the box identical in both states, so the button does not
                resize when the label becomes "Finding…" (UI-SPEC § States → Loading). */}
            <Button
              type="button"
              variant="outline"
              data-testid="preset-editor-geocode"
              onClick={find}
              disabled={finding}
              className="h-11 min-w-44"
            >
              {finding ? (
                <>
                  <Spinner className="size-4" aria-hidden="true" />
                  Finding…
                </>
              ) : (
                'Find this address'
              )}
            </Button>
          </div>
          <FieldDescription className="text-sm font-normal text-muted-foreground">
            {HELP}
          </FieldDescription>
        </Field>
      ) : (
        <Item variant="outline" data-testid="preset-editor-geocode-result">
          <ItemContent>
            <ItemTitle className="text-base font-normal">
              Matched: {centre.matchedAddress}
              {centre.countyName === undefined ? '' : ` · ${centre.countyName} County`}
            </ItemTitle>
            <ItemDescription className="text-sm font-normal tabular-nums text-muted-foreground">
              {centre.lat.toFixed(6)}, {centre.lng.toFixed(6)} · FIPS {centre.countyFips}
            </ItemDescription>
            <Button
              type="button"
              variant="link"
              data-testid="preset-editor-geocode-reset"
              onClick={() => {
                onCentreChange(null);
                setFailure(null);
              }}
              className="h-11 justify-start px-0 text-sm"
            >
              Use a different address
            </Button>
          </ItemContent>
        </Item>
      )}

      {failure === null ? null : (
        <div
          id="preset-editor-address-error"
          data-testid="preset-editor-geocode-error"
          role="status"
          className="flex flex-col gap-2"
        >
          <p className="flex items-start gap-2 text-sm font-normal text-destructive">
            {/* Error text is never colour-only — UI-SPEC § Accessibility. */}
            <CircleAlert data-icon="circle-alert" className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{failure.message}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {failure.code === 'upstream' ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  data-testid="preset-editor-geocode-retry"
                  onClick={find}
                >
                  Retry geocoding
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  data-testid="preset-editor-geocode-to-cities"
                  onClick={onSwitchToCities}
                >
                  Switch to cities
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  data-testid="preset-editor-geocode-retry"
                  onClick={() => setFailure(null)}
                >
                  Try another address
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  data-testid="preset-editor-geocode-to-county"
                  onClick={onSwitchToCounty}
                >
                  Switch to county
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <Field>
        <FieldLabel htmlFor="preset-editor-radius" className="text-sm font-semibold">
          Radius
        </FieldLabel>
        {/* The four options are passed down from the server's RADIUS_MILE_OPTIONS, so this
            Select cannot invent a fifth radius the committed cost model has never priced. */}
        <Select
          value={String(radiusMiles)}
          onValueChange={(value) => onRadiusChange(Number(value))}
        >
          <SelectTrigger
            id="preset-editor-radius"
            data-testid="preset-editor-radius"
            className="h-11 w-full text-base sm:w-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {radiusOptions.map((miles) => (
              <SelectItem
                key={miles}
                value={String(miles)}
                className="h-11 text-base tabular-nums"
              >
                {miles} miles
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
