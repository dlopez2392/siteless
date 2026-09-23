/**
 * WR-08. The uuid guard every route that interpolates an id into `where id = ...` needs,
 * and the walk that proves each of them actually has it.
 *
 * 🔴 POSTGRES ANSWERS A MALFORMED UUID WITH `22P02 invalid input syntax`, WHICH IS A 500.
 * `/presets/not-a-uuid` and `/presets/not-a-uuid/edit` are the same kind of mistyped link,
 * and they behaved differently: the detail page had a regex, the edit page — written later,
 * from the same data and the same query module — did not, so one route answered 404 and its
 * sibling crashed. That is the whole defect: not that the guard is hard, but that it was
 * COPIED, and the second copy was never made.
 *
 * So the regex now lives in one module and this file walks the routes rather than testing
 * the regex alone. A unit test over `isUuid` would have been green the whole time the edit
 * page was crashing.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { isUuid } from '@/lib/ids';

/** Every route file that takes an `[id]` segment. Discovered, not listed: a route added in
 *  Phase 3 under the same segment has to be found by this walk, or the walk is a snapshot of
 *  what somebody remembered in Phase 2. */
function idRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) idRouteFiles(full, out);
    else if (entry.name === 'page.tsx' && full.includes('[id]')) out.push(full);
  }
  return out;
}

describe('route id validation', () => {
  it('ids: isUuid accepts a real uuid and refuses everything else', () => {
    // A v4 and a v7 — the generator may change (production is PostgreSQL 17.6, which has no
    // v7 generator, but a client-side id or a later upgrade could produce one) and this
    // guard is about SHAPE, never about version bits.
    expect(isUuid('7ea03b52-da41-4fa7-85df-4ea253aac068')).toBe(true);
    expect(isUuid('0198f3a1-9c2d-7c3e-8f21-6b5a4d3c2e10')).toBe(true);
    // Case-insensitive: Postgres accepts either and so must a guard standing in front of it.
    expect(isUuid('7EA03B52-DA41-4FA7-85DF-4EA253AAC068')).toBe(true);

    // The refusals, each a DIFFERENT way to be wrong, because one representative string
    // would pass against a guard that only checked the length.
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('7ea03b52da414fa785df4ea253aac068')).toBe(false); // no hyphens
    expect(isUuid('7ea03b52-da41-4fa7-85df-4ea253aac06')).toBe(false); // one short
    expect(isUuid('7ea03b52-da41-4fa7-85df-4ea253aac0688')).toBe(false); // one long
    expect(isUuid('7ea03b52-da41-4fa7-85df-4ea253aac06g')).toBe(false); // not hex
    // 🔴 ANCHORED AT BOTH ENDS. An unanchored regex admits this, and the value that reaches
    // the query is the whole string.
    expect(isUuid(" 7ea03b52-da41-4fa7-85df-4ea253aac068'; drop table searches --")).toBe(false);
    expect(isUuid('x7ea03b52-da41-4fa7-85df-4ea253aac068')).toBe(false);
  });

  it('ids: every [id] route guards its id before it queries', () => {
    const routes = idRouteFiles(nodePath.join('src', 'app'));

    // Two-sided: a renamed directory would leave this walking nothing, and a loop over an
    // empty list passes every assertion inside it. Phase 2 ships the preset detail page and
    // the edit page; Phase 3 adds /businesses/[id] (03-19), whose [id] is the internal uuid
    // and never the SL- lead key (D-19).
    expect(routes.length, `walked src/app and found ${routes.join(', ')}`).toBeGreaterThanOrEqual(3);
    expect(routes.some((r) => r.includes('edit'))).toBe(true);
    expect(
      routes.some((r) => r.includes(nodePath.join('businesses', '[id]', 'page.tsx'))),
      `walked src/app and found ${routes.join(', ')}`,
    ).toBe(true);

    const unguarded = routes.filter((file) => {
      const source = nodeFs.readFileSync(file, 'utf8');
      return !source.includes('isUuid(');
    });
    expect(
      unguarded,
      'these routes hand an unvalidated segment to a query; Postgres answers 22P02 and the user gets a 500',
    ).toEqual([]);
  });
});
