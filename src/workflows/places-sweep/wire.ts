/**
 * The step boundary's form of a search: NUL-free, and exactly reversible.
 *
 * A `TileSpec`'s `unitId` (and a polygon shape's `unitId`) is RAW in memory — expand-cells joins
 * a county FIPS and a city name with U+0000 (`'48215\u0000McAllen'`), and the raw form is what
 * the partition hash, `queriedCityOf` and the geo-shape lookup read. Every other key is already
 * DB-safe (`dbSafe`, tiling.ts).
 *
 * Step arguments and returns are persisted in the workflow event log (T-4-05). Workflow 4.8.9
 * stores them as a devalue string inside a binary payload, so today a U+0000 survives as a
 * `\u0000` escape in the local and Vercel worlds — but a world that keeps payloads as Postgres
 * `jsonb` would refuse that escape (22P05), and nothing about a raw NUL in an audit log is
 * useful. So every search crosses a step boundary in this form, and only in this form
 * (04-22):
 *
 *   `%` → `%25`, `/` → `%2F`, then U+0000 → `/`.
 *
 * For every unit id the seed produces (no `%`, no `/`) that is EXACTLY `dbSafe(unitId)` — the
 * value `place_tiles.unit_id` already holds — and, unlike `dbSafe`, it inverts: `fromWire`
 * restores the raw id byte for byte, so a step computes from the same raw value the planner
 * did.
 *
 * 🔴 SANDBOX-SAFE. The workflow body never calls these (only steps do), but they are pure — no
 * I/O, no clock — so nothing here could break a replay if it ever did.
 */
import type { PlannedSearch } from './reducer';

const ENCODE: Record<string, string> = { '%': '%25', '/': '%2F', '\u0000': '/' };
const DECODE: Record<string, string> = { '%25': '%', '%2F': '/', '/': '\u0000' };

export function encodeUnitId(raw: string): string {
  return raw.replace(/[%/\u0000]/g, (c) => ENCODE[c] as string);
}

export function decodeUnitId(wire: string): string {
  return wire.replace(/%25|%2F|\//g, (c) => DECODE[c] as string);
}

function mapUnitIds(s: PlannedSearch, f: (id: string) => string): PlannedSearch {
  return {
    ...s,
    unitId: f(s.unitId),
    shape: s.shape.kind === 'polygon' ? { ...s.shape, unitId: f(s.shape.unitId) } : s.shape,
  };
}

/** A planned search as it leaves a step. Throws if any U+0000 would still cross. */
export function toWire(s: PlannedSearch): PlannedSearch {
  const w = mapUnitIds(s, encodeUnitId);
  if (JSON.stringify(w).includes('\\u0000')) {
    // Tile keys are ours and DB-safe; nothing from a Places response is in this message.
    throw new Error(`wire: a U+0000 would cross the step boundary in ${w.tileKey}`);
  }
  return w;
}

/** A planned search as a step receives it: the raw unit ids restored. */
export function fromWire(s: PlannedSearch): PlannedSearch {
  return mapUnitIds(s, decodeUnitId);
}
