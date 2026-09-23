import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatLocal } from '@/lib/time';
import {
  BUSINESS_FIELD_LABEL,
  BUSINESS_SECTION,
  FIELD_NO_DURABLE_SOURCE,
  FIELD_NOT_STORED,
  LEGAL_NAME_NOTE,
  NO_CLUSTER_MAPPED,
  SOURCE_TAG,
} from '@/lib/ui/copy';
import type { BusinessFields, FieldView } from '@/server/queries/businesses';

/**
 * "Fields and sources" — the D-18 heart of `/businesses/[id]` (03-UI-SPEC § 4, section 2).
 *
 * 🔴 PHASE 7'S TRIAGE CARD INHERITS THIS. The ten rows below, in this order, and the
 * source-tag treatment are the contract; the rows are written out one by one rather than
 * mapped from a list so that the order is a literal a reviewer can read top to bottom.
 *
 * Every row is `label · value · source tag`. Desk: a three-column grid with the source tag
 * right-aligned into a column of its own. Phone: label (Label 14/600) line 1, value
 * (Body 16/400) line 2, source tag (Label 14/400 muted) line 3.
 *
 * 🔴 SOURCE TAGS ARE TEXT; BADGES ARE STATE (Executor Rule 22). About ten tags sit on this
 * screen. Ten bordered pills would be ten objects competing with the values they annotate;
 * plain muted text in a fixed column reads as a COLUMN. A tag is never a badge, never an
 * accent, never a tooltip and never behind a tap — D-18 says always visible, and a
 * tooltip-only provenance would be invisible on a phone, the device this product is for.
 *
 * 🔴 THE ABSENCE OF A SOURCE IS NOT THE ABSENCE OF A VALUE. `FieldView` keeps them
 * independent (03-15): a null value renders "Not stored"; `provenance: 'none'` renders the
 * tag "No durable source". A field whose only source would be a Google payload cannot be set
 * at all (CONVENTIONS § Retention), and this is the honest rendering of that — never a blank
 * that reads as missing data (T-3-06).
 *
 * 🔴 NEVER RENDERED, ANYWHERE: the operator's internal annotation and the normalized match
 * keys (D-12, Executor Rule 17). The query does not select them (T-3-11), and nothing here
 * would print them if it did — every row below names its field explicitly.
 *
 * 🔴 NO LOCALE FORMATTER IS CALLED IN THIS FILE (Executor Rule 26). Dates go through
 * `formatLocal`; lat/lng and the confidence are fixed-point figures with no grouping, which
 * `toFixed` renders identically in every locale.
 */

type SourceKey = keyof typeof SOURCE_TAG;

/** The tag for one field. `cited` and `derived` both name their source; `none` says so. A
 *  cited record whose source kind is not one of the four (unreachable through the ingests)
 *  gets the honest "No durable source" rather than a guessed name. */
function sourceTagOf(field: FieldView<unknown>): string {
  if (field.provenance === 'none' || field.source === null) return FIELD_NO_DURABLE_SOURCE;
  return SOURCE_TAG[field.source as SourceKey] ?? FIELD_NO_DURABLE_SOURCE;
}

/**
 * A Comptroller floating date ('YYYY-MM-DD', no zone — it never was an instant) → "Apr 1, 2019".
 *
 * 🔴 ANCHORED AT NOON UTC, NOT MIDNIGHT. `formatLocal` renders in America/Chicago, which is
 * UTC-5 or UTC-6; midnight UTC on the 1st IS the evening of the 31st in Chicago, so a
 * midnight anchor prints every permit date one day early. Noon UTC is 6–7am the same day in
 * Chicago, so the calendar date survives. tests/unit/business-detail.test.tsx pins it.
 */
export function floatingDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return formatLocal(at, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** E.164 → the national display form, "(956) 555-0142". The href keeps E.164. */
export function phoneDisplay(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
}

/** Overture's `basic_category` is a snake_case key ("plumbing_services"); the words are shown. */
function categoryWords(key: string): string {
  return key.replace(/_/g, ' ');
}

function NotStored({ 'data-testid': testid }: { 'data-testid': string }) {
  return (
    <span data-testid={testid} className="text-muted-foreground">
      {FIELD_NOT_STORED}
    </span>
  );
}

/**
 * One row. The value and the tag each carry their own `data-testid` — the call sites below
 * spell both, so every row's pair of hooks is a literal in this file.
 */
function FieldRow({
  label,
  value,
  source,
  note,
}: {
  label: string;
  value: ReactNode;
  source: ReactNode;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] sm:items-baseline sm:gap-x-6 sm:gap-y-1">
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-base font-normal break-words">
        {value}
        {note ? <span className="text-sm font-normal text-muted-foreground">{note}</span> : null}
      </dd>
      <dd className="text-sm font-normal text-muted-foreground sm:text-right">{source}</dd>
    </div>
  );
}

function Tag({
  field,
  'data-testid': testid,
}: {
  field: FieldView<unknown>;
  'data-testid': string;
}) {
  return <span data-testid={testid}>{sourceTagOf(field)}</span>;
}

export function FieldsAndSources({ fields }: { fields: BusinessFields }) {
  const f = fields;

  const address = f.address.value
    ? [f.address.value.street, f.address.value.unit].filter((p) => p !== null && p !== '').join(', ')
    : '';
  const cityZip = f.cityZip.value
    ? [f.cityZip.value.city, f.cityZip.value.postal].filter((p) => p !== null && p !== '').join(' · ')
    : '';
  const category = f.category.value
    ? [
        f.category.value.basicCategory === null ? null : categoryWords(f.category.value.basicCategory),
        f.category.value.clusterName ?? NO_CLUSTER_MAPPED,
      ]
        .filter((p) => p !== null)
        .join(' · ')
    : '';
  // Permit dates: "Issued {date} · First sales {date}", each half only when present.
  const permit = f.permitDates.value
    ? [
        f.permitDates.value.issued === null
          ? null
          : `Issued ${floatingDateLabel(f.permitDates.value.issued)}`,
        f.permitDates.value.firstSales === null
          ? null
          : `First sales ${floatingDateLabel(f.permitDates.value.firstSales)}`,
      ]
        .filter((p) => p !== null)
        .join(' · ')
    : '';

  const rows: ReactNode[] = [
    <FieldRow
      key="display-name"
      label={BUSINESS_FIELD_LABEL.displayName}
      value={
        f.displayName.value === null ? (
          <NotStored data-testid="business-field-display-name" />
        ) : (
          <span data-testid="business-field-display-name">{f.displayName.value}</span>
        )
      }
      source={<Tag field={f.displayName} data-testid="business-field-display-name-source" />}
    />,
    <FieldRow
      key="legal-name"
      label={BUSINESS_FIELD_LABEL.legalName}
      note={LEGAL_NAME_NOTE}
      value={
        f.legalName.value === null ? (
          <NotStored data-testid="business-field-legal-name" />
        ) : (
          <span data-testid="business-field-legal-name">{f.legalName.value}</span>
        )
      }
      source={<Tag field={f.legalName} data-testid="business-field-legal-name-source" />}
    />,
    <FieldRow
      key="phone"
      label={BUSINESS_FIELD_LABEL.phone}
      value={
        f.phone.value === null ? (
          <NotStored data-testid="business-field-phone" />
        ) : (
          // Tap-to-call. Accent, because an inline text link is on the accent list (§ Color
          // item 6); E.164 in the href, the national form on screen.
          <a
            data-testid="business-field-phone"
            href={`tel:${f.phone.value}`}
            className="w-fit tabular-nums text-primary underline underline-offset-4"
          >
            {phoneDisplay(f.phone.value)}
          </a>
        )
      }
      source={<Tag field={f.phone} data-testid="business-field-phone-source" />}
    />,
    <FieldRow
      key="address"
      label={BUSINESS_FIELD_LABEL.address}
      value={
        address === '' ? (
          <NotStored data-testid="business-field-address" />
        ) : (
          <span data-testid="business-field-address">{address}</span>
        )
      }
      source={<Tag field={f.address} data-testid="business-field-address-source" />}
    />,
    <FieldRow
      key="city-zip"
      label={BUSINESS_FIELD_LABEL.cityZip}
      value={
        cityZip === '' ? (
          <NotStored data-testid="business-field-city-zip" />
        ) : (
          <span data-testid="business-field-city-zip" className="tabular-nums">
            {cityZip}
          </span>
        )
      }
      source={<Tag field={f.cityZip} data-testid="business-field-city-zip-source" />}
    />,
    <FieldRow
      key="location"
      label={BUSINESS_FIELD_LABEL.location}
      value={
        f.location.value === null ? (
          <NotStored data-testid="business-field-location" />
        ) : (
          <span data-testid="business-field-location" className="tabular-nums">
            {f.location.value.lat.toFixed(5)}, {f.location.value.lng.toFixed(5)}
          </span>
        )
      }
      source={<Tag field={f.location} data-testid="business-field-location-source" />}
    />,
    <FieldRow
      key="category"
      label={BUSINESS_FIELD_LABEL.category}
      value={
        category === '' ? (
          <NotStored data-testid="business-field-category" />
        ) : (
          <span data-testid="business-field-category">{category}</span>
        )
      }
      source={<Tag field={f.category} data-testid="business-field-category-source" />}
    />,
    <FieldRow
      key="overture-confidence"
      label={BUSINESS_FIELD_LABEL.overtureConfidence}
      value={
        f.overtureConfidence.value === null ? (
          <NotStored data-testid="business-field-overture-confidence" />
        ) : (
          <span data-testid="business-field-overture-confidence" className="tabular-nums">
            {f.overtureConfidence.value.toFixed(2)}
          </span>
        )
      }
      source={
        <Tag field={f.overtureConfidence} data-testid="business-field-overture-confidence-source" />
      }
    />,
    <FieldRow
      key="permit-dates"
      label={BUSINESS_FIELD_LABEL.permitDates}
      value={
        permit === '' ? (
          <NotStored data-testid="business-field-permit-dates" />
        ) : (
          <span data-testid="business-field-permit-dates" className="tabular-nums">
            {permit}
          </span>
        )
      }
      source={<Tag field={f.permitDates} data-testid="business-field-permit-dates-source" />}
    />,
    <FieldRow
      key="closed-on"
      label={BUSINESS_FIELD_LABEL.closedOn}
      value={
        f.closedOn.value === null ? (
          <NotStored data-testid="business-field-closed-on" />
        ) : (
          <span data-testid="business-field-closed-on" className="tabular-nums">
            {formatLocal(f.closedOn.value, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )
      }
      source={<Tag field={f.closedOn} data-testid="business-field-closed-on-source" />}
    />,
  ];

  return (
    <Card data-testid="business-fields">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{BUSINESS_SECTION.fields}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Each row is a `div` directly inside the `dl` (the one grouping level HTML allows
            around a dt/dd set); the hairline between rows is the list's divider. */}
        <dl className="divide-y divide-border">{rows}</dl>
      </CardContent>
    </Card>
  );
}
