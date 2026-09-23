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
 *
 * A-CR-03 (review 03) added the columns that do NOT come from the payload alone: `cluster_key`
 * (the seeded NAICS ranges for a permit, `overture_category_map` for a place) and a permit's
 * folded `city`. The view never set a cluster, so survivorship's cluster rule never ran and a
 * merge could drop a business out of the lead funnel. Both sides now read them through one
 * DerivationContext, and this file pins the parity for BOTH sources.
 */
import * as nodeFs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSkipped, overtureRowToSourceRecord } from '@/lib/overture/transform';
import { sourceRecordView } from '@/lib/resolve/merge';
import {
  cityFoldKey,
  overtureClusterKey,
  seededClusterRanges,
  type DerivationContext,
} from '@/lib/resolve/derivation';
import { permitRowSchema, type PermitRow } from '@/lib/socrata/permits';
import { permitToIngest } from '../../scripts/ingest-comptroller';
import overtureCategories from '@/seed/data/overture-categories.json';
import jreaPage from './msw/fixtures/socrata-jrea-page.json';

const ENTRIES = JSON.parse(
  nodeFs.readFileSync('tests/unit/fixtures/overture-rgv-sample.json', 'utf8'),
) as Array<Record<string, unknown>>;
const RELEASE = (ENTRIES[0] as { _meta: { release: string } })._meta.release;
const ROWS = ENTRIES.filter((e) => !('_meta' in e));

/**
 * The built-in category map exactly as `pnpm db:seed` loads it (the mapped entries of the
 * committed seed), and a two-entry city fold that a recorded permit row really hits.
 */
const CATEGORY_MAP = new Map(
  overtureCategories
    .filter((e): e is { basic_category: string; cluster_key: string; rows: number } =>
      'cluster_key' in e,
    )
    .map((e) => [e.basic_category, e.cluster_key] as const),
);
const CITY_FOLD = new Map([
  [cityFoldKey(31, 'HARLINGEN'), 'Harlingen'],
  [cityFoldKey(108, 'MCALLEN'), 'McAllen'],
]);
const CTX: DerivationContext = {
  clusters: seededClusterRanges(),
  categoryMap: CATEGORY_MAP,
  cityFold: CITY_FOLD,
};

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
    }, CTX);
    expect(view!.phoneE164).toBe(rec.derived.phoneE164);
  });

  /**
   * B-WR-04 (review 03). `phones.map(phoneE164).find(e164 !== null)` picked the corporate
   * 800 number a franchisee lists first, so the local number that is the B1 blocking key and
   * the R3 identifier was never considered, and the row dropped out of phone blocking. Both
   * sides pick the first BLOCKABLE number, falling back to the first dialable one — and pick
   * it identically, because a winner whose phone the merge re-derives differently from the
   * ingest reads as a change on every pass.
   */
  it('a toll-free first phone never hides a blockable local number, on either side', () => {
    const raw = ROWS.find(
      (r) => !isSkipped(overtureRowToSourceRecord(r, RELEASE)),
    ) as Record<string, unknown>;
    const tollFreeFirst = { ...raw, phones: { items: ['+18004879643', '(956) 423-1234'] } };
    const rec = overtureRowToSourceRecord(tollFreeFirst, RELEASE);
    if (isSkipped(rec)) throw new Error('toll-free-first row was skipped');
    expect({ e164: rec.derived.phoneE164, blockable: rec.derived.phoneBlockable }).toEqual({
      e164: '+19564231234',
      blockable: true,
    });
    const view = sourceRecordView({
      id: rec.externalId,
      source_key: 'overture',
      payload: JSON.parse(JSON.stringify(rec.payload)) as unknown,
    }, CTX);
    expect({ e164: view!.phoneE164, blockable: view!.phoneBlockable }).toEqual({
      e164: '+19564231234',
      blockable: true,
    });

    // The fallback: with NO blockable number the first dialable one is still kept for
    // display and dialling, and it still never blocks.
    const onlyTollFree = { ...raw, phones: { items: ['n/a', '+18004879643'] } };
    const rec2 = overtureRowToSourceRecord(onlyTollFree, RELEASE);
    if (isSkipped(rec2)) throw new Error('toll-free-only row was skipped');
    expect({ e164: rec2.derived.phoneE164, blockable: rec2.derived.phoneBlockable }).toEqual({
      e164: '+18004879643',
      blockable: false,
    });
    const view2 = sourceRecordView({
      id: rec2.externalId,
      source_key: 'overture',
      payload: JSON.parse(JSON.stringify(rec2.payload)) as unknown,
    }, CTX);
    expect({ e164: view2!.phoneE164, blockable: view2!.phoneBlockable }).toEqual({
      e164: '+18004879643',
      blockable: false,
    });
  });

  it('survivorship view of the stored overture payload reproduces the ingest-derived fields', () => {
    for (const rec of records) {
      if (isSkipped(rec)) continue;
      const stored = JSON.parse(JSON.stringify(rec.payload)) as unknown;
      const view = sourceRecordView({ id: rec.externalId, source_key: 'overture', payload: stored }, CTX);
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

  it('survivorship view of the stored overture payload carries the cluster the ingest writes', () => {
    let mapped = 0;
    for (const rec of records) {
      if (isSkipped(rec)) continue;
      const stored = JSON.parse(JSON.stringify(rec.payload)) as unknown;
      const view = sourceRecordView({ id: rec.externalId, source_key: 'overture', payload: stored }, CTX);
      // What scripts/ingest-overture.ts writes: the derived basic_category through the map.
      const written = overtureClusterKey(rec.derived.basicCategory, CTX.categoryMap);
      expect(view!.clusterKey, rec.externalId).toBe(written);
      if (written !== null) mapped += 1;
    }
    // Positive control: a view that never sets a cluster would pass the loop above on every
    // unmapped row. The committed sample maps well over half its rows.
    expect(mapped).toBeGreaterThan(50);
  });
});

describe('payload contract: comptroller', () => {
  const permits: PermitRow[] = (jreaPage as unknown[]).map((r) => permitRowSchema.parse(r));

  it('survivorship view of the stored permit payload reproduces the ingest-derived fields, cluster and city included', () => {
    let clustered = 0;
    let folded = 0;
    for (const row of permits) {
      const ing = permitToIngest(row, '2026-09-20T00:00:00.000Z', [...CTX.clusters], CITY_FOLD);
      const stored = JSON.parse(JSON.stringify(ing.payload)) as unknown;
      const view = sourceRecordView({ id: ing.externalId, source_key: 'tx_comptroller', payload: stored }, CTX);
      expect(view, ing.externalId).not.toBeNull();
      const d = ing.derived;
      expect(
        {
          legalName: view!.legalName,
          displayName: view!.displayName,
          street: view!.street,
          streetNum: view!.streetNum,
          streetNorm: view!.streetNorm,
          unit: view!.unit,
          postal: view!.postal,
          city: view!.city,
          clusterKey: view!.clusterKey,
        },
        ing.externalId,
      ).toEqual({
        legalName: d.legalName,
        displayName: d.displayName,
        street: d.street,
        streetNum: d.streetNum,
        streetNorm: d.streetNorm,
        unit: d.unit,
        postal: d.postal,
        city: d.city,
        clusterKey: d.clusterKey,
      });
      if (d.clusterKey != null) clustered += 1;
      if (ing.cityFolded) folded += 1;
    }
    // Positive controls: the recording carries mapped NAICS codes and folded cities, so a
    // view that nulled either would fail above instead of matching a null.
    expect(clustered).toBeGreaterThan(5);
    expect(folded).toBeGreaterThan(3);
  });
});
