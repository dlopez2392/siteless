/**
 * SRCH-03 / D-16's readable half.
 *
 * The database already proves a run keeps pointing at the version that produced it
 * (plan 02-06). What it cannot prove is that a human opening the preset page can SEE
 * what changed between version 1 and version 2 — and UI-SPEC is explicit that "What
 * changed" is a concrete diff sentence, never a hash and never the word "changed" on
 * its own. This file pins the sentences.
 *
 * 🔴 EVERY ASSERTION IS TWO-SIDED. A diff function that reported EVERYTHING would pass
 * any `toContain('Added Auto & retail')` check, so each test also asserts what must NOT
 * appear: the clusters that stayed, the units that stayed, the old radius after a
 * centre-only move. A one-sided diff test is a test that cannot fail for the reason it
 * exists.
 *
 * Mutations this file catches, each verified red on its own:
 *   - drop the `Removed` clause              -> test 1
 *   - label 'counties' as 'Counties'         -> test 2
 *   - compare unit lists by length not value -> test 3
 *   - print only the new radius              -> test 4
 *   - return [] instead of ['Created']       -> test 5
 */
import { expect, it } from 'vitest';
import { describeVersionDiff, type DiffVersion } from '@/components/preset-detail/version-diff';

const HOME = 'Home services & trades';
const FOOD = 'Food & hospitality';
const AUTO = 'Auto & retail';

function citiesVersion(clusterNames: string[], names: string[]): DiffVersion {
  return { clusterNames, geo: { kind: 'cities', names } };
}

it('version diff: added and removed clusters read as a sentence', () => {
  const prev = citiesVersion([HOME, FOOD], ['McAllen']);
  const next = citiesVersion([HOME, AUTO], ['McAllen']);

  const clauses = describeVersionDiff(prev, next);
  const sentence = clauses.join(' · ');

  expect(clauses).toContain(`Added ${AUTO}`);
  expect(clauses).toContain(`Removed ${FOOD}`);

  // 🔴 The other side. `Home services & trades` is in BOTH versions, so no clause may
  // name it — a diff that listed the whole spec would satisfy the two assertions above
  // and tell a reader nothing.
  expect(sentence).not.toContain(HOME);
  // The geography did not move either, so nothing may be said about it.
  expect(sentence).not.toContain('McAllen');
  expect(sentence).not.toContain('Geography changed');
});

it('version diff: a geography kind change is named on both sides', () => {
  const prev: DiffVersion = { clusterNames: [HOME], geo: { kind: 'counties', names: ['Hidalgo'] } };
  const next: DiffVersion = { clusterNames: [HOME], geo: { kind: 'cities', names: ['McAllen'] } };

  const clauses = describeVersionDiff(prev, next);

  // Both sides named, in UI-SPEC's own mode labels (Cities / County / Radius) — "the
  // geography changed" without saying from what to what is the sentence this forbids.
  expect(clauses).toContain('Geography changed from County to Cities');

  // Units are not comparable across kinds, so the change is reported once, as the kind
  // change. A stray `Added McAllen` beside it would be double-counting the same edit.
  const sentence = clauses.join(' · ');
  expect(sentence).not.toContain('Added McAllen');
  expect(sentence).not.toContain('Removed Hidalgo');
});

it('version diff: units added and removed within the same kind', () => {
  const prev = citiesVersion([HOME], ['South Padre Island', 'McAllen']);
  const next = citiesVersion([HOME], ['McAllen', 'Starr County']);

  const clauses = describeVersionDiff(prev, next);
  const sentence = clauses.join(' · ');

  expect(clauses).toContain('Added Starr County');
  expect(clauses).toContain('Removed South Padre Island');

  // 🔴 Same count on both sides (2 -> 2), so a diff comparing LENGTHS rather than values
  // would report nothing at all and still be green without this pair.
  expect(clauses.length).toBeGreaterThan(0);
  // McAllen survived the edit and must not be mentioned.
  expect(sentence).not.toContain('McAllen');
  expect(sentence).not.toContain('Geography changed');
});

it('version diff: a radius change names both the old and the new value', () => {
  const centre = '101 N BRITTON AVE, RIO GRANDE CITY, TX, 78582';
  const prev: DiffVersion = {
    clusterNames: [HOME],
    geo: { kind: 'radius', radiusMiles: 10, matchedAddress: centre },
  };
  const next: DiffVersion = {
    clusterNames: [HOME],
    geo: { kind: 'radius', radiusMiles: 25, matchedAddress: centre },
  };

  const clauses = describeVersionDiff(prev, next);

  // 🔴 BOTH values. "Radius 25 mi" alone cannot answer "did this get wider or narrower",
  // which is the only question a spend-conscious reader is asking.
  expect(clauses).toContain('Radius 10 mi → 25 mi');

  // The centre did not move, so it must not be reported as moved.
  expect(clauses.join(' · ')).not.toContain('Centre moved');

  // And the other half of the radius geography: moving the centre alone is its own
  // clause and does not claim the radius changed.
  const moved = describeVersionDiff(prev, {
    clusterNames: [HOME],
    geo: { kind: 'radius', radiusMiles: 10, matchedAddress: '600 E CANO ST, EDINBURG, TX, 78539' },
  });
  expect(moved).toContain('Centre moved to 600 E CANO ST, EDINBURG, TX, 78539');
  expect(moved.join(' · ')).not.toContain('Radius');
});

it('version diff: version 1 reads Created', () => {
  const only = citiesVersion([HOME], ['McAllen']);

  // Exactly this, and exactly one clause: version 1 has no predecessor, so there is
  // nothing to diff against and inventing "Added Home services & trades" would describe
  // a change nobody made.
  expect(describeVersionDiff(null, only)).toEqual(['Created']);
});
