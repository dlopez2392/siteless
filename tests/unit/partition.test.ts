/**
 * D-16. A cell's partition is a hash of its key, and the partition that runs this week
 * rotates on Monday 00:00 in the app's zone.
 *
 * 🔴 The suite runs TZ=UTC deliberately (vitest.config.ts line 1) because this dev machine
 * IS Chicago — a fixture zone equal to the dev zone cannot discriminate. America/Chicago
 * appears here only ever as HALF a pair: one instant, two zones, opposite verdicts.
 *
 * Mutations, one named test each:
 *   - M47: the partition taken from the cell's list index instead of its hash
 *       → 'a cell keeps its partition when cells are added'
 *     (the test maps `partitionOf` DIRECTLY over each array, so an implementation that
 *     reads the index `Array.prototype.map` hands it is observable)
 *   - currentPartition's default parameter APP_TZ -> 'UTC'
 *       → 'one instant in two zones gives opposite partitions'
 *   - weeksSinceEpoch counted from Thursday 1970-01-01 instead of Monday 1970-01-05
 *       → 'partitions rotate weekly' (the rotation then happens on a Thursday)
 */
import { describe, expect, it } from 'vitest';
import { APP_TZ } from '@/lib/time';
import {
  PARTITION_COUNT,
  currentPartition,
  fnv1a32,
  isoWeekOf,
  partitionOf,
  weeksSinceEpoch,
} from '@/lib/places/partition';

// The expand-cells separator (04-04 `cellKey()`): cluster key + NUL + unit id. Built by
// hand here — this module never imports expand-cells.
const key = (cluster: string, unit: string) => cluster + '\u0000' + unit;

describe('partition', () => {
  it('partition: there are four partitions', () => {
    expect(PARTITION_COUNT).toBe(4);
  });

  it('partition: fnv1a32 is 32-bit FNV-1a', () => {
    // The offset basis for the empty string, and the published vector for 'a'.
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
    // Unsigned 32-bit, always.
    for (const s of ['foobar', key('home_services', 'city:mcallen'), 'ñandú']) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('a cell keeps its partition when cells are added', () => {
    const five = [
      key('home_services', 'city:mcallen'),
      key('food_hospitality', 'city:edinburg'),
      key('personal_care_health', 'city:harlingen'),
      key('auto_retail', 'city:brownsville'),
      key('home_services', 'city:pharr'),
    ];
    const twelveMore = [
      'mission',
      'weslaco',
      'san-juan',
      'alamo',
      'donna',
      'mercedes',
      'san-benito',
      'la-feria',
      'rio-grande-city',
      'raymondville',
      'port-isabel',
      'los-fresnos',
    ].map((city) => key('food_hospitality', 'city:' + city));

    // Five cells alone…
    const alone = five.map(partitionOf);

    // …and the same five, shuffled into a list of 17 where none keeps its old position.
    const seventeen = [
      twelveMore[0],
      five[4],
      twelveMore[1],
      twelveMore[2],
      five[2],
      twelveMore[3],
      twelveMore[4],
      twelveMore[5],
      five[0],
      twelveMore[6],
      twelveMore[7],
      five[3],
      twelveMore[8],
      twelveMore[9],
      twelveMore[10],
      five[1],
      twelveMore[11],
    ];
    expect(seventeen).toHaveLength(17);
    const inList = seventeen.map(partitionOf);

    five.forEach((cell, i) => {
      expect(inList[seventeen.indexOf(cell)]).toBe(alone[i]);
    });

    // And a partition is always one of the four.
    for (const p of inList) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(PARTITION_COUNT);
    }
    // The five must not all hash to one partition, or this test could not tell a hash
    // from a constant.
    expect(new Set(alone).size).toBeGreaterThan(1);
  });

  it('partitions rotate weekly', () => {
    // Noon in the RGV on five consecutive Mondays (all CDT, UTC−5).
    const mondays = [
      '2026-09-28T17:00:00.000Z',
      '2026-10-05T17:00:00.000Z',
      '2026-10-12T17:00:00.000Z',
      '2026-10-19T17:00:00.000Z',
      '2026-10-26T17:00:00.000Z',
    ].map((iso) => currentPartition(new Date(iso)));

    expect(new Set(mondays.slice(0, 4)).size).toBe(4);
    expect(mondays[4]).toBe(mondays[0]);

    // The week is Monday–Sunday: noon on Sunday 2026-10-04 is still the first week, and
    // noon on the Thursday in between does not rotate it.
    expect(currentPartition(new Date('2026-10-04T17:00:00.000Z'))).toBe(mondays[0]);
    expect(currentPartition(new Date('2026-10-01T17:00:00.000Z'))).toBe(mondays[0]);

    // Monday 1970-01-05 is week 0 — the epoch the index counts from.
    expect(weeksSinceEpoch(new Date('1970-01-05T12:00:00.000Z'), 'UTC')).toBe(0);
    expect(weeksSinceEpoch(new Date('1970-01-11T12:00:00.000Z'), 'UTC')).toBe(0);
    expect(weeksSinceEpoch(new Date('1970-01-12T12:00:00.000Z'), 'UTC')).toBe(1);
  });

  it('one instant in two zones gives opposite partitions', () => {
    // Sunday 22:30 in the RGV, Monday 03:30 in UTC — the week has turned in one zone only.
    const instant = new Date('2026-09-28T03:30:00Z');

    expect(currentPartition(instant, 'America/Chicago')).not.toBe(currentPartition(instant, 'UTC'));
    expect(weeksSinceEpoch(instant, 'UTC')).toBe(weeksSinceEpoch(instant, 'America/Chicago') + 1);

    // The default parameter is the Chicago half, not the process zone (which is UTC here).
    expect(currentPartition(instant)).toBe(currentPartition(instant, APP_TZ));
    expect(currentPartition(instant)).not.toBe(currentPartition(instant, 'UTC'));
  });

  it('iso week is for display and crosses year ends', () => {
    // 2027-01-01 is a Friday; its ISO week belongs to 2026, which has 53 of them.
    expect(isoWeekOf(new Date('2027-01-01T18:00:00Z'))).toEqual({
      isoWeek: 53,
      mondayIso: '2026-12-28',
      sundayIso: '2027-01-03',
    });

    // And the week after is week 1 — so ISO week mod 4 would repeat (53 % 4 === 1 % 4),
    // while the rotating index does not.
    const nextWeek = new Date('2027-01-04T18:00:00Z');
    expect(isoWeekOf(nextWeek).isoWeek).toBe(1);
    expect(currentPartition(nextWeek)).not.toBe(currentPartition(new Date('2027-01-01T18:00:00Z')));

    // A mid-year week, pinned to the app zone: Sunday 22:30 in the RGV is still the week
    // that began on Monday the 21st.
    expect(isoWeekOf(new Date('2026-09-28T03:30:00Z'))).toEqual({
      isoWeek: 39,
      mondayIso: '2026-09-21',
      sundayIso: '2026-09-27',
    });
    expect(isoWeekOf(new Date('2026-09-28T03:30:00Z'), 'UTC').mondayIso).toBe('2026-09-28');
  });
});
