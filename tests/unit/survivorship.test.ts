/**
 * D-14 survivorship, pinned. `survive()` is the ONE function both the merge and the unmerge
 * call (src/lib/resolve/merge.ts), so every rule here holds on both sides of DEDUP-02.
 *
 * Every test asserts the VALUE and the SOURCE RECORD ID it came from. A field with the right
 * value and the wrong provenance is a FOUND-05 defect the UI would render as a wrong source tag.
 */
import { describe, expect, it } from 'vitest';
import { survive, type SourceRecordView } from '@/lib/resolve/survivorship';

const base: Omit<SourceRecordView, 'id' | 'sourceKey'> = {
  legalName: null,
  displayName: null,
  phoneE164: null,
  phoneBlockable: false,
  street: null,
  streetNum: null,
  streetNorm: null,
  unit: null,
  postal: null,
  city: null,
  lat: null,
  lng: null,
  locationMatchType: null,
  basicCategory: null,
  clusterKey: null,
  confidence: null,
  operatingStatus: null,
  closedAt: null,
};

const comptroller = (id: string, over: Partial<SourceRecordView> = {}): SourceRecordView => ({
  ...base,
  id,
  sourceKey: 'tx_comptroller',
  legalName: 'TACOS EL GUERO',
  displayName: 'TACOS EL GUERO',
  street: '1200 N 10TH ST',
  streetNum: '1200',
  streetNorm: 'n 10th st',
  postal: '78501',
  city: 'MCALLEN',
  ...over,
});

const overture = (id: string, over: Partial<SourceRecordView> = {}): SourceRecordView => ({
  ...base,
  id,
  sourceKey: 'overture',
  displayName: 'Tacos El Güero',
  phoneE164: '+19566822400',
  phoneBlockable: true,
  street: '1200 N 10th St',
  streetNum: '1200',
  streetNorm: 'n 10th st',
  postal: '78501',
  city: 'McAllen',
  lat: 26.2034,
  lng: -98.23,
  locationMatchType: 'overture',
  basicCategory: 'taco_restaurant',
  confidence: 0.91,
  operatingStatus: 'open',
  ...over,
});

const census = (
  id: string,
  kind: 'census_exact' | 'census_non_exact',
  lat: number,
  lng: number,
): SourceRecordView => ({
  ...base,
  id,
  sourceKey: 'census_geocoder',
  lat,
  lng,
  locationMatchType: kind,
});

const closure = (id: string, closedAt: string): SourceRecordView => ({
  ...base,
  id,
  sourceKey: 'tx_comptroller_closures',
  legalName: 'TACOS EL GUERO',
  closedAt,
});

describe('survivorship (D-14)', () => {
  it('survivorship: legal_name from Comptroller and display_name from Overture', () => {
    const s = survive([comptroller('sr-c'), overture('sr-o')]);
    expect(s.legalName).toEqual({ value: 'TACOS EL GUERO', sourceId: 'sr-c' });
    expect(s.displayName).toEqual({ value: 'Tacos El Güero', sourceId: 'sr-o' });
  });

  it('survivorship: display_name falls back to the Comptroller outlet_name with no Overture parent', () => {
    const s = survive([comptroller('sr-c')]);
    expect(s.displayName).toEqual({ value: 'TACOS EL GUERO', sourceId: 'sr-c' });
    expect(s.legalName).toEqual({ value: 'TACOS EL GUERO', sourceId: 'sr-c' });
  });

  it("survivorship: phone_e164 takes Overture's when both parents carry one", () => {
    const s = survive([
      comptroller('sr-c', { phoneE164: '+19565550101', phoneBlockable: true }),
      overture('sr-o'),
    ]);
    expect(s.phone).toEqual({ e164: '+19566822400', blockable: true, sourceId: 'sr-o' });
    // and whichever parent has one when only one does
    const only = survive([
      comptroller('sr-c', { phoneE164: '+19565550101', phoneBlockable: true }),
      overture('sr-o', { phoneE164: null, phoneBlockable: false }),
    ]);
    expect(only.phone).toEqual({ e164: '+19565550101', blockable: true, sourceId: 'sr-c' });
  });

  it('survivorship: lat/lng prefer Overture, then Census Exact, then Census Non_Exact last', () => {
    const exact = census('sr-ge', 'census_exact', 26.1, -98.1);
    const nonExact = census('sr-gn', 'census_non_exact', 26.2, -98.2);
    const all = survive([nonExact, comptroller('sr-c'), exact, overture('sr-o')]);
    expect(all.location).toEqual({
      lat: 26.2034,
      lng: -98.23,
      matchType: 'overture',
      sourceId: 'sr-o',
    });
    const noOverture = survive([nonExact, comptroller('sr-c'), exact]);
    expect(noOverture.location).toEqual({
      lat: 26.1,
      lng: -98.1,
      matchType: 'census_exact',
      sourceId: 'sr-ge',
    });
    const onlyNonExact = survive([nonExact, comptroller('sr-c')]);
    expect(onlyNonExact.location).toEqual({
      lat: 26.2,
      lng: -98.2,
      matchType: 'census_non_exact',
      sourceId: 'sr-gn',
    });
    expect(survive([comptroller('sr-c')]).location).toEqual({
      lat: null,
      lng: null,
      matchType: null,
      sourceId: null,
    });
  });

  it('survivorship: closed_at comes only from a tx_comptroller_closures parent', () => {
    // An Overture 'permanently_closed' and a closedAt smuggled onto any other parent never
    // write closed_at (D-03).
    const noClosure = survive([
      comptroller('sr-c', { closedAt: '2020-01-01T06:00:00.000Z' }),
      overture('sr-o', { operatingStatus: 'permanently_closed', closedAt: '2021-01-01T06:00:00.000Z' }),
    ]);
    expect(noClosure.closedAt).toEqual({ value: null, sourceId: null });
    const closed = survive([comptroller('sr-c'), closure('sr-x', '1993-03-03T06:00:00.000Z')]);
    expect(closed.closedAt).toEqual({ value: '1993-03-03T06:00:00.000Z', sourceId: 'sr-x' });
  });

  it('survivorship: every surviving field returns the id of the source record it came from', () => {
    const s = survive([
      comptroller('sr-c'),
      overture('sr-o'),
      census('sr-ge', 'census_exact', 26.1, -98.1),
      closure('sr-x', '1993-03-03T06:00:00.000Z'),
    ]);
    expect(s.legalName.sourceId).toBe('sr-c');
    expect(s.displayName.sourceId).toBe('sr-o');
    expect(s.phone.sourceId).toBe('sr-o');
    expect(s.address).toEqual({
      street: '1200 N 10th St',
      streetNum: '1200',
      streetNorm: 'n 10th st',
      unit: null,
      postal: '78501',
      city: 'McAllen',
      sourceId: 'sr-o',
    });
    expect(s.location.sourceId).toBe('sr-o');
    expect(s.closedAt.sourceId).toBe('sr-x');
    // Address falls back to the Comptroller row when there is no Overture parent.
    const fallback = survive([comptroller('sr-c'), census('sr-ge', 'census_exact', 26.1, -98.1)]);
    expect(fallback.address.sourceId).toBe('sr-c');
    expect(fallback.address.street).toBe('1200 N 10TH ST');
    // A field with no candidate parent carries no source id — never a made-up one.
    expect(survive([overture('sr-o')]).legalName).toEqual({ value: null, sourceId: null });
  });

  it('survivorship: a google_places parent never supplies a source id (T-3-06)', () => {
    const google = {
      ...overture('sr-g'),
      sourceKey: 'google_places',
    } as unknown as SourceRecordView;
    const s = survive([google, comptroller('sr-c')]);
    const ids = [
      s.legalName.sourceId,
      s.displayName.sourceId,
      s.phone.sourceId,
      s.address.sourceId,
      s.location.sourceId,
      s.closedAt.sourceId,
    ];
    expect(ids).not.toContain('sr-g');
    expect(s.location).toEqual({ lat: null, lng: null, matchType: null, sourceId: null });
  });

  it('survivorship: deterministic under parent order (merge and unmerge agree)', () => {
    const parents = [
      comptroller('sr-c'),
      overture('sr-o2', { displayName: 'Tacos El Guero 2', confidence: 0.5 }),
      overture('sr-o1', { displayName: 'Tacos El Güero', confidence: 0.91 }),
    ];
    const forward = survive(parents);
    const reversed = survive([...parents].reverse());
    expect(reversed).toEqual(forward);
    // Two Overture parents: the higher confidence wins.
    expect(forward.displayName).toEqual({ value: 'Tacos El Güero', sourceId: 'sr-o1' });
    expect(forward.derived).toEqual({
      basicCategory: 'taco_restaurant',
      confidence: 0.91,
      operatingStatus: 'open',
    });
  });
});
