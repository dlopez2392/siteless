/**
 * The contract between what an ingest STORES in `source_records.payload` and what survivorship
 * READS back out of it (`sourceRecordView`, 03-11). The two were written by parallel plans
 * (03-13 wrote the Overture payload, 03-11 the reader), and a spelling mismatch is silent:
 * `survive()` sees a null field and a merge nulls it on the winner.
 *
 * Found at the wave-4 merge: the Overture payload stores `lon`, the reader read `lng`, so every
 * Overture location vanished on merge; and the reader took the raw first phone while the ingest
 * takes the first one that normalises, so a junk first entry nulled the winner's phone.
 *
 * The invariant: for every real fixture row, the view of the STORED payload (JSON round-tripped,
 * as jsonb returns it) reproduces the columns the ingest derived from the same row.
 */
import * as nodeFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSkipped, overtureRowToSourceRecord } from '@/lib/overture/transform';
import { sourceRecordView } from '@/lib/resolve/merge';

const ENTRIES = JSON.parse(
  nodeFs.readFileSync('tests/unit/fixtures/overture-rgv-sample.json', 'utf8'),
) as Array<Record<string, unknown>>;
const RELEASE = (ENTRIES[0] as { _meta: { release: string } })._meta.release;
const ROWS = ENTRIES.filter((e) => !('_meta' in e));

describe('payload contract: overture', () => {
  const records = ROWS.map((r) => overtureRowToSourceRecord(r, RELEASE)).filter(
    (r) => !isSkipped(r),
  );

  it('survivorship reads the first DIALABLE phone, as the ingest does, not the raw first entry', () => {
    expect(records.length).toBeGreaterThanOrEqual(100);
    const withPhone = records.find((r) => !isSkipped(r) && r.derived.phoneE164 !== null);
    if (!withPhone || isSkipped(withPhone)) throw new Error('fixture has no dialable phone');
    // A real row, with a junk entry put ahead of its dialable phone. Run through the ingest's
    // own transform so both sides see the same list.
    const raw = ROWS.find((r) => r.id === withPhone.externalId)!;
    const junkFirst = {
      ...raw,
      phones: { items: ['n/a', ...(raw.phones as { items: string[] }).items] },
    };
    const rec = overtureRowToSourceRecord(junkFirst, RELEASE);
    if (isSkipped(rec)) throw new Error('junk-first row was skipped');
    expect(rec.derived.phoneE164).toBe(withPhone.derived.phoneE164);
    const view = sourceRecordView({
      id: rec.externalId,
      source_key: 'overture',
      payload: JSON.parse(JSON.stringify(rec.payload)) as unknown,
    });
    expect(view!.phoneE164).toBe(rec.derived.phoneE164);
  });

  it('survivorship view of the stored overture payload reproduces the ingest-derived fields', () => {
    for (const rec of records) {
      if (isSkipped(rec)) continue;
      const stored = JSON.parse(JSON.stringify(rec.payload)) as unknown;
      const view = sourceRecordView({ id: rec.externalId, source_key: 'overture', payload: stored });
      expect(view, rec.externalId).not.toBeNull();
      const d = rec.derived;
      expect(
        {
          displayName: view!.displayName,
          phoneE164: view!.phoneE164,
          phoneBlockable: view!.phoneBlockable,
          street: view!.street,
          streetNum: view!.streetNum,
          streetNorm: view!.streetNorm,
          unit: view!.unit,
          postal: view!.postal,
          city: view!.city,
          lat: view!.lat,
          lng: view!.lng,
          locationMatchType: view!.locationMatchType,
          basicCategory: view!.basicCategory,
          confidence: view!.confidence,
          operatingStatus: view!.operatingStatus,
        },
        rec.externalId,
      ).toEqual({
        displayName: d.displayName,
        phoneE164: d.phoneE164,
        phoneBlockable: d.phoneBlockable,
        street: d.street,
        streetNum: d.streetNum,
        streetNorm: d.streetNorm,
        unit: d.unit,
        postal: d.postal,
        city: d.city,
        lat: d.lat,
        lng: d.lng,
        locationMatchType: d.locationMatchType,
        basicCategory: d.basicCategory,
        confidence: d.confidence,
        operatingStatus: d.operatingStatus,
      });
    }
  });
});
