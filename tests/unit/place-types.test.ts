/**
 * T-4-10 / M48. Every type string in clusters.json becomes a Places `includedType`. Google
 * accepts only Table A values there; a Table B value is a 400 at best. So the seed is checked
 * against the COMMITTED Table A snapshot (src/lib/places/place-types.ts), never against the
 * network, before any paid call can send it.
 *
 * The failure names the offending cluster and type, not a bare boolean.
 */
import { describe, expect, it } from 'vitest';
import { isTableAType, PLACES_TABLE_A } from '@/lib/places/place-types';
import clustersJson from '@/seed/data/clusters.json';
import type { ClustersFile } from '@/seed/types';

const clusters: ClustersFile = clustersJson;

describe('Places type validity', () => {
  it('every placesTypes entry is a Table A type', () => {
    const invalid = clusters.clusters.flatMap((c) =>
      c.placesTypes.filter((t) => !isTableAType(t)).map((t) => `${c.key}: ${t}`),
    );
    expect(invalid).toEqual([]);
  });

  it('the Table A snapshot is the published table', () => {
    expect(PLACES_TABLE_A.size).toBe(478);
    for (const t of ['plumber', 'roofing_contractor', 'hair_salon', 'car_repair']) {
      expect(PLACES_TABLE_A.has(t), t).toBe(true);
    }
    // Table B only: may be returned, may never be sent.
    expect(PLACES_TABLE_A.has('general_contractor')).toBe(false);
  });
});
