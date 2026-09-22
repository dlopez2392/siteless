/**
 * What changed between two preset versions, as clauses a human reads.
 *
 * 🔴 NO `"use client"` DIRECTIVE, AND THAT IS LOAD-BEARING (Executor Rule 5). This module
 * is imported by `version-history.tsx`, which renders on the SERVER. A client module's
 * exports are client REFERENCES inside a server component — plain functions and data
 * objects included — and resolve to `undefined` at runtime with typecheck, lint and build
 * all green. Two recorded BIS occurrences, both 500s. Same reason `src/lib/ui/copy.ts` and
 * `src/lib/ui/run-tone.ts` carry no directive.
 *
 * 🔴 PURE, AND NO I/O. It takes names, not ids: resolving a uuid to "Starr County" needs
 * the reference index, which needs a transaction, which would make this untestable without
 * a database and would put a query inside a render. The page resolves ids to names once,
 * server-side, and hands the resolved shape down.
 *
 * 🔴 NEVER A HASH, NEVER THE BARE WORD "changed". UI-SPEC § Screen Inventory 3 fixes this:
 * "What changed" is a concrete diff sentence — "Added Starr County · Removed Food &
 * hospitality". A content hash is the easy implementation and it answers a question nobody
 * asked; "the geography changed" is the same failure with friendlier spelling. Every clause
 * below names the thing that moved.
 */

/**
 * A version's geography, already resolved to display names.
 *
 * `cities` and `counties` carry `names` under the same key on purpose — the diff for both
 * is "which units came and went", and giving them separate field names would mean writing
 * that comparison twice.
 */
export type DiffGeo =
  | { kind: 'cities'; names: string[] }
  | { kind: 'counties'; names: string[] }
  | { kind: 'radius'; radiusMiles: number; matchedAddress: string };

export type DiffVersion = {
  /** Cluster DISPLAY names ("Auto & retail"), never keys. CONVENTIONS § Naming: a key is
   *  never shown to a person, and `auto_retail` in a diff sentence is a leaked key. */
  clusterNames: string[];
  geo: DiffGeo;
};

/**
 * UI-SPEC's own mode labels, from the preset editor's geography switch ("Choose cities, a
 * county, or a radius around an address"). Singular "County" against plural "Cities" looks
 * like an oversight and is not: those are the words on the control the user actually
 * pressed, and a diff that renames them describes a screen that does not exist.
 */
export const GEO_KIND_LABEL: Record<DiffGeo['kind'], string> = {
  cities: 'Cities',
  counties: 'County',
  radius: 'Radius',
};

/** The one clause that is not about a change. A version whose spec matches its predecessor
 *  exactly is possible (nothing in the schema forbids saving the same thing twice) and
 *  returning an empty list would leave the cell blank — Executor Rule 11: never blank
 *  content to satisfy a state. */
export const NO_SPEC_CHANGE = 'No change to clusters or geography';

/** What a geography reads as when its reference rows no longer resolve. */
export const GEO_UNAVAILABLE = 'Geography unavailable';

/** Items in `after` that are not in `before`, order preserved from `after`. */
function added(before: string[], after: string[]): string[] {
  const had = new Set(before);
  return after.filter((name) => !had.has(name));
}

/**
 * One version's geography in a few words, for the summary card and the table cell.
 *
 * Lives beside the diff rather than in a component because it consumes the same
 * name-resolved `DiffGeo` and is the same kind of thing: a sentence about a version that
 * must be identical everywhere it appears. A second copy inside a `.tsx` is where the card
 * and the row start disagreeing about the same version.
 */
export function geoHeadline(geo: DiffGeo): string {
  if (geo.kind === 'radius') return `${geo.radiusMiles} mi around ${geo.matchedAddress}`;
  const n = geo.names.length;
  // A version whose city or county rows no longer resolve. Says so rather than rendering
  // "0 cities", which reads as a preset that searches nowhere instead of one this screen
  // could not describe.
  if (n === 0) return GEO_UNAVAILABLE;
  if (geo.kind === 'cities') return n === 1 ? '1 city' : `${n} cities`;
  return n === 1 ? '1 county' : `${n} counties`;
}

/** The full list, for the Collapsible that reveals a version's detail beside its diff. */
export function geoDetail(geo: DiffGeo): string {
  if (geo.kind === 'radius') return `${geo.radiusMiles} mi around ${geo.matchedAddress}`;
  return geo.names.length === 0 ? GEO_UNAVAILABLE : geo.names.join(', ');
}

export function describeVersionDiff(prev: DiffVersion | null, next: DiffVersion): string[] {
  // Version 1. There is no predecessor, so there is no diff — and describing its whole
  // spec as "Added ..." would report a change nobody made.
  if (prev === null) return ['Created'];

  const clauses: string[] = [];

  const clustersAdded = added(prev.clusterNames, next.clusterNames);
  const clustersRemoved = added(next.clusterNames, prev.clusterNames);
  if (clustersAdded.length > 0) clauses.push(`Added ${clustersAdded.join(', ')}`);
  if (clustersRemoved.length > 0) clauses.push(`Removed ${clustersRemoved.join(', ')}`);

  const before = prev.geo;
  const after = next.geo;

  if (before.kind !== after.kind) {
    // Units are not comparable across kinds — "Removed Hidalgo · Added McAllen" for a
    // county-to-cities switch describes two edits where the user made one. The kind change
    // IS the change, and the Collapsible on the row carries the full new geography.
    clauses.push(
      `Geography changed from ${GEO_KIND_LABEL[before.kind]} to ${GEO_KIND_LABEL[after.kind]}`,
    );
  } else if (before.kind === 'radius' && after.kind === 'radius') {
    // Both values, always. "Radius 25 mi" alone cannot answer "did this get wider", which
    // is the only question someone watching a spend estimate is asking.
    if (before.radiusMiles !== after.radiusMiles) {
      clauses.push(`Radius ${before.radiusMiles} mi → ${after.radiusMiles} mi`);
    }
    if (before.matchedAddress !== after.matchedAddress) {
      clauses.push(`Centre moved to ${after.matchedAddress}`);
    }
  } else if (before.kind !== 'radius' && after.kind !== 'radius') {
    const unitsAdded = added(before.names, after.names);
    const unitsRemoved = added(after.names, before.names);
    if (unitsAdded.length > 0) clauses.push(`Added ${unitsAdded.join(', ')}`);
    if (unitsRemoved.length > 0) clauses.push(`Removed ${unitsRemoved.join(', ')}`);
  }

  return clauses.length > 0 ? clauses : [NO_SPEC_CHANGE];
}
