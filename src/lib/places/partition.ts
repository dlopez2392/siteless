/**
 * D-16. Enterprise sweeps run on rotating weekly partitions: a cell belongs to partition
 * `fnv1a32(cellKey) % 4`, and the partition that runs is the week index in the app's zone
 * mod 4, rotating at LOCAL midnight between Sunday and Monday.
 *
 * This module imports APP_TZ from src/lib/time.ts and never spells a zone of its own.
 * That file is the only file in src/ allowed to name one, and the guard is a bare token
 * grep over src/ — so, exactly as src/lib/budget/period.ts does, the comments here
 * deliberately do not spell the zone either.
 *
 * 🔴 Never the zoneless day/date accessors on a bare `Date` (spelled out nowhere here for the
 * same grep reason). The local calendar date comes from `localDate(instant, timeZone)`, and
 * everything after that is date-only arithmetic on `Date.UTC(y, m - 1, d)` values — whole
 * days, never instant math across the zone. Sunday 22:30 in the RGV is Monday 03:30 UTC:
 * one instant, two zones, two different weeks.
 *
 * 🔴 T-4-02 (M47): the partition is a hash of the cell KEY, never its position in a list.
 * Adding a city or re-ordering the preset cannot move an existing cell into a different
 * week — which would sweep it twice in one cycle and bill it twice.
 *
 * The week INDEX (weeks since Monday 1970-01-05) and the ISO week NUMBER are two separate
 * functions on purpose: ISO week mod 4 repeats across a year end (week 53 → week 1 are both
 * 1 mod 4), so it would run the same partition twice in a row. The ISO week is display only.
 *
 * No client directive, no server-only import, no I/O.
 */
import { APP_TZ, localDate } from '@/lib/time';

export const PARTITION_COUNT = 4;

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const DAY_MS = 86_400_000;
/** 1970-01-01 was a Thursday; Monday 1970-01-05 is epoch day 4 and week 0. */
const EPOCH_MONDAY_DAY = 4;

/** 32-bit FNV-1a over UTF-16 code units, unsigned. */
export function fnv1a32(s: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * The partition a cell belongs to. The caller builds `cellKey` (04-04's `cellKey()`); this
 * module never imports expand-cells. Takes ONE argument deliberately, so passing it
 * straight to `Array.prototype.map` cannot smuggle a list index in.
 */
export function partitionOf(cellKey: string): number {
  return fnv1a32(cellKey) % PARTITION_COUNT;
}

/** Whole days since 1970-01-01 for the LOCAL calendar date of `instant` in `timeZone`. */
function localEpochDay(instant: Date, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate(instant, timeZone));
  if (!match) {
    throw new Error('partition: could not resolve a local calendar date');
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** The epoch day of the Monday that begins the week containing `epochDay`. */
function mondayOf(epochDay: number): number {
  const sinceMonday = (((epochDay - EPOCH_MONDAY_DAY) % 7) + 7) % 7;
  return epochDay - sinceMonday;
}

function isoOfEpochDay(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole weeks since Monday 1970-01-05, counted in `timeZone`'s calendar.
 *
 * `timeZone` defaults to APP_TZ so forgetting it is still correct, and exists as a
 * parameter for exactly one reason: it is what makes the discriminating pair in
 * tests/unit/partition.test.ts expressible.
 */
export function weeksSinceEpoch(instant: Date, timeZone: string = APP_TZ): number {
  return (mondayOf(localEpochDay(instant, timeZone)) - EPOCH_MONDAY_DAY) / 7;
}

/** The partition whose cells are swept in the week containing `instant`. */
export function currentPartition(instant: Date, timeZone: string = APP_TZ): number {
  const weeks = weeksSinceEpoch(instant, timeZone);
  return ((weeks % PARTITION_COUNT) + PARTITION_COUNT) % PARTITION_COUNT;
}

/**
 * The ISO week number and its Monday–Sunday range, for display (UI-SPEC). Never an index:
 * see the header on why ISO week mod 4 is not a rotation.
 */
export function isoWeekOf(
  instant: Date,
  timeZone: string = APP_TZ,
): { isoWeek: number; mondayIso: string; sundayIso: string } {
  const monday = mondayOf(localEpochDay(instant, timeZone));
  // The ISO year is the year of the week's Thursday.
  const thursday = monday + 3;
  const isoYear = Number(isoOfEpochDay(thursday).slice(0, 4));
  const jan1 = Date.UTC(isoYear, 0, 1) / DAY_MS;
  const isoWeek = Math.floor((thursday - jan1) / 7) + 1;
  return { isoWeek, mondayIso: isoOfEpochDay(monday), sundayIso: isoOfEpochDay(monday + 6) };
}
