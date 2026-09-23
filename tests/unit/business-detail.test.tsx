import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DetailHeader } from '@/components/business-detail/detail-header';
import {
  FieldsAndSources,
  floatingDateLabel,
  phoneDisplay,
} from '@/components/business-detail/fields-and-sources';
import { SourceRecords } from '@/components/business-detail/source-records';
import type { BusinessFields, FieldView, SourceRecordRow } from '@/server/queries/businesses';

/**
 * `/businesses/[id]` (03-19), rendered. The field order and the source-tag treatment are the
 * contract Phase 7's triage card inherits, so they are pinned here rather than left to a
 * screenshot.
 *
 * 🔴 THE SUITE RUNS IN UTC (vitest.config.ts), and every instant below is chosen so that UTC
 * and America/Chicago disagree about the calendar day. A component that formatted in the
 * process zone would print the UTC day and go red; Chicago is only ever half of the pair.
 */

afterEach(cleanup);

const none = <T,>(): FieldView<T> => ({
  value: null,
  provenance: 'none',
  source: null,
  sourceRecordId: null,
});

function cited<T>(value: T, source: FieldView<T>['source']): FieldView<T> {
  return { value, provenance: 'cited', source, sourceRecordId: '00000000-0000-4000-8000-000000000001' };
}

/** 03:30 UTC on Sep 23 is 22:30 on Sep 22 in Chicago (CDT, UTC-5). */
const LATE_EVENING_CHICAGO = new Date(Date.UTC(2026, 8, 23, 3, 30));

const FULL: BusinessFields = {
  displayName: cited('Taquería El Ñandú', 'overture'),
  legalName: cited('TAQUERIA EL NANDU LLC', 'tx_comptroller'),
  phone: cited('+19566300142', 'overture'),
  address: cited({ street: '1201 N 10th St', unit: 'Ste 4' }, 'overture'),
  cityZip: cited({ city: 'McAllen', postal: '78501' }, 'overture'),
  location: cited({ lat: 26.2034071, lng: -98.2300124, matchType: 'Exact' }, 'census_geocoder'),
  category: {
    value: { basicCategory: 'mexican_restaurant', clusterName: 'Food & hospitality' },
    provenance: 'derived',
    source: 'overture',
    sourceRecordId: null,
  },
  overtureConfidence: {
    value: 0.873,
    provenance: 'derived',
    source: 'overture',
    sourceRecordId: null,
  },
  permitDates: cited({ issued: '2019-04-01', firstSales: '2019-04-15' }, 'tx_comptroller'),
  closedOn: cited(LATE_EVENING_CHICAGO, 'tx_comptroller_closures'),
};

const EMPTY: BusinessFields = {
  displayName: cited('Llantera Chuy', 'tx_comptroller'),
  legalName: none(),
  phone: none(),
  address: none(),
  cityZip: none(),
  location: none(),
  category: none(),
  overtureConfidence: none(),
  permitDates: none(),
  closedOn: none(),
};

/** The ten rows, in the order Phase 7 inherits. */
const ORDER = [
  'display-name',
  'legal-name',
  'phone',
  'address',
  'city-zip',
  'location',
  'category',
  'overture-confidence',
  'permit-dates',
  'closed-on',
];

describe('business detail — fields and sources', () => {
  it('fields render in the D-18 order, each with an always-visible text source tag', () => {
    const { container } = render(<FieldsAndSources fields={FULL} />);

    const hooks = [...container.querySelectorAll('[data-testid^="business-field-"]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null && !id.endsWith('-source'));
    expect(hooks).toEqual(ORDER.map((f) => `business-field-${f}`));

    for (const f of ORDER) {
      const tag = screen.getByTestId(`business-field-${f}-source`);
      // Text, in the DOM, not behind a tooltip or a tap: visible content of a plain span.
      expect(tag.tagName).toBe('SPAN');
      expect(tag.textContent).not.toBe('');
      // Never a badge (Executor Rule 22) — nothing badge-shaped wraps it.
      expect(tag.closest('[data-slot="badge"]')).toBeNull();
      // Never accent.
      expect(tag.closest('.text-primary')).toBeNull();
    }

    expect(screen.getByTestId('business-field-display-name-source')).toHaveTextContent('Overture');
    expect(screen.getByTestId('business-field-legal-name-source')).toHaveTextContent('Comptroller');
    expect(screen.getByTestId('business-field-location-source')).toHaveTextContent('Census geocoder');
    expect(screen.getByTestId('business-field-closed-on-source')).toHaveTextContent(
      'Comptroller closures',
    );
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it('display name renders verbatim and the legal name carries its note', () => {
    render(<FieldsAndSources fields={FULL} />);
    expect(screen.getByTestId('business-field-display-name')).toHaveTextContent('Taquería El Ñandú');
    expect(screen.getByTestId('business-field-legal-name')).toHaveTextContent('TAQUERIA EL NANDU LLC');
    expect(
      screen.getByText('The string on the state filing. Outreach uses the display name.'),
    ).toBeInTheDocument();
  });

  it('an unsourced field reads Not stored with the tag No durable source', () => {
    render(<FieldsAndSources fields={EMPTY} />);
    for (const f of ORDER.slice(1)) {
      expect(screen.getByTestId(`business-field-${f}`)).toHaveTextContent('Not stored');
      expect(screen.getByTestId(`business-field-${f}-source`)).toHaveTextContent('No durable source');
    }
    // A value no durable record cites keeps its value — the two are independent (03-15).
    render(
      <FieldsAndSources
        fields={{ ...EMPTY, phone: { ...none<string>(), value: '+19566300142' } }}
      />,
    );
    const phones = screen.getAllByTestId('business-field-phone');
    expect(phones[1]).toHaveTextContent('(956) 630-0142');
    expect(screen.getAllByTestId('business-field-phone-source')[1]).toHaveTextContent(
      'No durable source',
    );
  });

  it('the phone is a tel: link with E.164 in the href and the national form on screen', () => {
    render(<FieldsAndSources fields={FULL} />);
    const phone = screen.getByTestId('business-field-phone');
    expect(phone.tagName).toBe('A');
    expect(phone).toHaveAttribute('href', 'tel:+19566300142');
    expect(phone).toHaveTextContent('(956) 630-0142');
    expect(phoneDisplay('+19566300142')).toBe('(956) 630-0142');
  });

  it('two zones: closed-on renders the Chicago day, not the UTC day', () => {
    render(<FieldsAndSources fields={FULL} />);
    const closed = screen.getByTestId('business-field-closed-on');
    // The same instant is Sep 23 in UTC (the suite's zone) and Sep 22 in Chicago.
    expect(closed).toHaveTextContent('Sep 22, 2026');
    expect(closed).not.toHaveTextContent('Sep 23');
  });

  it('two zones: a floating permit date keeps its calendar day in Chicago', () => {
    // Anchored at UTC midnight this would print Mar 31 in Chicago.
    expect(floatingDateLabel('2019-04-01')).toBe('Apr 1, 2019');
    expect(floatingDateLabel('2019-01-01')).toBe('Jan 1, 2019');
    render(<FieldsAndSources fields={FULL} />);
    expect(screen.getByTestId('business-field-permit-dates')).toHaveTextContent(
      'Issued Apr 1, 2019 · First sales Apr 15, 2019',
    );
  });

  it('location and confidence are fixed-point figures; category shows words and the cluster', () => {
    render(<FieldsAndSources fields={FULL} />);
    expect(screen.getByTestId('business-field-location')).toHaveTextContent('26.20341, -98.23001');
    expect(screen.getByTestId('business-field-overture-confidence')).toHaveTextContent('0.87');
    expect(screen.getByTestId('business-field-category')).toHaveTextContent(
      'mexican restaurant · Food & hospitality',
    );
    expect(screen.getByTestId('business-field-address')).toHaveTextContent('1201 N 10th St, Ste 4');
    expect(screen.getByTestId('business-field-city-zip')).toHaveTextContent('McAllen · 78501');
  });
});

describe('business detail — header', () => {
  it('the lead key is accent text with a text copy button, and it is the only accent', () => {
    const { container } = render(
      <DetailHeader
        displayName="Taquería El Ñandú"
        leadKey="SL-7F3K2"
        status="active"
        closedAt={null}
        chainLabel={null}
        mergedInto={null}
      />,
    );
    const key = screen.getByTestId('business-lead-key');
    expect(key).toHaveTextContent('SL-7F3K2');
    expect(key).toHaveClass('text-primary', 'tabular-nums', 'font-semibold');
    expect(container.querySelectorAll('.text-primary')).toHaveLength(1);

    const copy = screen.getByTestId('business-lead-key-copy');
    expect(copy).toHaveAccessibleName('Copy lead key');
    expect(copy).toHaveTextContent('Copy lead key');
    expect(screen.getByTestId('business-display-name')).toHaveTextContent('Taquería El Ñandú');
    expect(screen.queryByTestId('business-status-badges')).toBeNull();
  });

  it('closed, chain and merged-away badges each appear only when set, Closed in the Chicago day', () => {
    render(
      <DetailHeader
        displayName="Llantera Chuy"
        leadKey="SL-2K9QX"
        status="merged_away"
        closedAt={LATE_EVENING_CHICAGO}
        chainLabel="Chain · 7 in Texas"
        mergedInto={{ id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Llantera Chuy #2' }}
      />,
    );
    const badges = within(screen.getByTestId('business-status-badges'));
    expect(badges.getByTestId('business-badge-closed')).toHaveTextContent('Closed Sep 22, 2026');
    expect(badges.getByTestId('business-badge-chain')).toHaveTextContent('Chain · 7 in Texas');
    expect(badges.getByTestId('business-badge-merged-away')).toHaveTextContent('Merged away');
    const link = within(screen.getByTestId('business-merged-into')).getByRole('link');
    expect(link).toHaveAttribute('href', '/businesses/00000000-0000-4000-8000-0000000000aa');
    expect(link).toHaveTextContent('Llantera Chuy merged into Llantera Chuy #2');
  });
});

describe('business detail — source records', () => {
  const base: SourceRecordRow = {
    id: '00000000-0000-4000-8000-0000000000b1',
    sourceKey: 'overture',
    sourceVersion: '2026-08-19.0',
    externalId: '08f48a4c-overture-id',
    businessId: '00000000-0000-4000-8000-0000000000c1',
    firstSeenAt: LATE_EVENING_CHICAGO,
    lastSeenAt: LATE_EVENING_CHICAGO,
    stale: false,
  };

  it('a gone record says so in words instead of a silent stale date', () => {
    render(
      <SourceRecords
        records={[
          base,
          { ...base, id: '00000000-0000-4000-8000-0000000000b2', stale: true },
        ]}
      />,
    );
    expect(
      screen.getByTestId('business-source-record-00000000-0000-4000-8000-0000000000b1-last-seen'),
    ).toHaveTextContent('Sep 22, 2026');
    expect(
      screen.getByTestId('business-source-record-00000000-0000-4000-8000-0000000000b2-last-seen'),
    ).toHaveTextContent('Last seen in the 2026-08-19.0 release — not in the latest run');
    expect(screen.getAllByText('Overture places')).toHaveLength(2);
  });
});
