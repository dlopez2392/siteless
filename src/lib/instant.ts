/**
 * Epoch-milliseconds → `Date`, for a `timestamptz` read back through a raw SQL executor.
 *
 * MOVED here verbatim from `src/server/queries/budget.ts` (plan 03-09), which still
 * re-exports both names so no existing import changed. The move exists because the desk
 * ingest (`src/lib/ingest/*`, run under `tsx`) needs the same conversion, and `budget.ts`
 * opens with `import 'server-only'` and constructs the app's database client at import time —
 * neither of which a desk script can load. A third copy was the alternative, and this repo
 * already has two conversions of this shape that disagree on their input type.
 *
 * Why epoch milliseconds rather than the driver's text: a `timestamptz` read back through
 * `tx.execute` / `pg` is a zone-rendered STRING with a space separator, and re-parsing it is
 * how "it looked right locally" happens. `extract(epoch from x) * 1000` is an instant with no
 * zone and no text format to misparse; cast it in SQL, convert it here. `extract` is
 * null-propagating, so a NULL column stays null rather than becoming 1970.
 *
 * NO `"use client"` and NO `server-only` in this file: it is imported from server components,
 * server query modules and desk scripts alike.
 */
export function instantOf(epochMs: string | null): Date | null {
  if (epochMs === null) return null;
  const ms = Number(epochMs);
  if (!Number.isFinite(ms)) {
    throw new Error(`instantOf: expected epoch milliseconds, got ${JSON.stringify(epochMs)}`);
  }
  return new Date(ms);
}

/**
 * The same conversion for a NOT NULL column, which every other query module has one or more
 * of (`searches.updated_at`, `search_versions.created_at`, a run's coalesced timestamp).
 *
 * Throws rather than substituting a fallback instant: the column cannot be null, so an empty
 * value means the cast in the SELECT was forgotten or the driver's text format changed
 * underneath us. Rendering the epoch instead would be the product lying about when something
 * happened — quietly, and in a way no gate can see.
 */
export function requireInstant(epochMs: string | null, what: string): Date {
  const at = instantOf(epochMs);
  if (at === null) {
    throw new Error(`requireInstant: ${what} came back null from a NOT NULL column`);
  }
  return at;
}
