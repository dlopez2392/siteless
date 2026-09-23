/**
 * The two server-safe UI maps. UI-SPEC Executor Rule 5.
 *
 * 🔴 THE DEFECT THIS FILE EXISTS TO CATCH IS INVISIBLE TO EVERY OTHER GATE. A client
 * directive on a data module turns its exports into client REFERENCES inside a server
 * component: they arrive `undefined` at runtime while `tsc`, `eslint` and `next build`
 * all pass. BIS recorded it twice, both times as a production 500 that read on screen as
 * an empty page. A grep is the only thing that sees it before deploy.
 *
 * This file lives under `tests/` and the walk only covers `src/lib/ui/`, so it may spell
 * the forbidden token freely — the same arrangement `tests/unit/no-google-credential.test.ts`
 * describes. The two modules it guards may NOT, and they say so in their own headers.
 *
 * The second half is drift: `RunStatus` and the database's `runs_status_known` CHECK are
 * two spellings of one fact, and a status the database allows but the tone map has never
 * heard of renders as an unstyled badge with no word in it.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUDGET_100_BANNER,
  BUDGET_80_BANNER,
  BUDGET_CAP_HELP,
  GEOCODE_NO_MATCH,
  PHASE4_RUN_NOTICE,
  PRESETS_EMPTY_HEADING,
  RUN_REFUSED,
  SKIP_LINK,
  SPEND_FOOTER,
  VERSION_NOTICE,
} from '@/lib/ui/copy';
import { RUN_LABEL, RUN_STATUSES, RUN_TONE, type RunStatus } from '@/lib/ui/run-tone';
import { LEADS_NAV, NAV_ITEMS, OPERATIONS_NAV } from '@/components/app-shell/app-sidebar';

const UI_DIR = nodePath.join('src', 'lib', 'ui');
const DRIZZLE_DIR = 'drizzle';

describe('the server-safe UI maps (UI-SPEC Executor Rule 5)', () => {
  it('ui maps: no module under src/lib/ui carries a use client directive', () => {
    const files = nodeFs.readdirSync(UI_DIR).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

    // Two-sided: a scan of an empty or mistyped directory proves nothing at all.
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('run-tone.ts');
    expect(files).toContain('copy.ts');

    const offences = files.filter((f) =>
      nodeFs.readFileSync(nodePath.join(UI_DIR, f), 'utf8').includes('"use client"'),
    );
    expect(offences, `these modules are imported by RSC pages: ${offences.join(', ')}`).toEqual([]);
  });

  it('ui maps: RunStatus matches the runs_status_known CHECK constraint', () => {
    const sql = nodeFs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => nodeFs.readFileSync(nodePath.join(DRIZZLE_DIR, f), 'utf8'))
      .join('\n');

    const matches = [...sql.matchAll(/runs_status_known"?\s+CHECK\s*\(status in \(([^)]*)\)\)/gi)];
    // Two-sided again: if the constraint is ever renamed this regex finds nothing, and a
    // comparison against an empty list would pass while checking nothing.
    expect(matches.length).toBeGreaterThanOrEqual(1);

    for (const match of matches) {
      const fromSql = [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(fromSql).toEqual([...RUN_STATUSES]);
    }

    // Every status has BOTH a tone and a word. Colour is never the only signal.
    for (const status of RUN_STATUSES) {
      expect(RUN_TONE[status]).toBeTruthy();
      expect(RUN_LABEL[status]).toBeTruthy();
    }
    expect(Object.keys(RUN_TONE).sort()).toEqual([...RUN_STATUSES].sort());
    expect(Object.keys(RUN_LABEL).sort()).toEqual([...RUN_STATUSES].sort());

    // The two destructive statuses are told apart by their words, not their colour.
    const refused: RunStatus = 'refused';
    const failed: RunStatus = 'failed';
    expect(RUN_TONE[refused]).toBe(RUN_TONE[failed]);
    expect(RUN_LABEL[refused]).not.toBe(RUN_LABEL[failed]);
  });

  it('ui copy: money is formatted, never concatenated', () => {
    // $50.00 and $40.12 in micro-USD. A raw number reaching the sentence would read
    // "your 50000000 cap".
    expect(BUDGET_80_BANNER(40_120_000n, 50_000_000n)).toBe(
      "You've used $40.12 of your $50.00 cap — 80%. At 100% Siteless refuses new runs. " +
        'Nothing is blocked yet.',
    );
    expect(BUDGET_100_BANNER(50_000_000n, 'Oct 1')).toContain('Your $50.00 monthly cap is spent.');
    expect(RUN_REFUSED(50_000_000n)).toContain('Your $50.00 cap is spent');

    // Two decimals always, even on a round figure - never "$50" and never "$50.0".
    expect(BUDGET_80_BANNER(0, 50_000_000n)).toContain('$0.00');
  });

  it('ui copy: the fixed strings are the ones UI-SPEC fixed', () => {
    expect(PRESETS_EMPTY_HEADING).toBe('No search presets yet');
    expect(SKIP_LINK).toBe('Skip to main content');
    expect(PHASE4_RUN_NOTICE).toContain('Runs start when the Places verifier ships in Phase 4.');
    expect(SPEND_FOOTER).toContain('One ledger row per paid call.');
    // The user's own input is quoted back, because it is the thing that failed.
    expect(GEOCODE_NO_MATCH('Joe’s Taqueria')).toContain('Joe’s Taqueria');
  });

  it('ui copy: the cap help claims only the scope the meter enforces', () => {
    // WR-02. The sentence read "Applies to Places, Firecrawl and Anthropic together" while
    // the database had never worked that way, and nothing could see the contradiction
    // because copy and schema are never compared. So compare them.
    const sql = nodeFs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => nodeFs.readFileSync(nodePath.join(DRIZZLE_DIR, f), 'utf8'))
      .join('\n');

    // The schema fact: a budget period — and therefore a cap — is per (org, provider, month),
    // and app.reserve_budget's conditional UPDATE matches exactly one such row. A ceiling
    // spanning three rows could not be enforced atomically by that statement at all.
    expect(sql).toMatch(/budget_periods_org_provider_period_uniq/);
    expect(sql).toMatch(/UNIQUE\("org_id","provider","period_start"\)/);

    // The copy fact. "together" is the specific promise the schema refutes; a cap help that
    // stops naming Places would be just as wrong in the other direction, so both halves are
    // asserted. Read the whole string rather than a fragment: this exists to fail if somebody
    // restores the old sentence, and the old sentence is a substring of nothing.
    expect(BUDGET_CAP_HELP).toContain('Applies to Places');
    expect(BUDGET_CAP_HELP).not.toMatch(/together/i);
    expect(BUDGET_CAP_HELP).toContain('metered separately');
  });

  it('ui copy: the version notice refuses a version with no predecessor', () => {
    expect(VERSION_NOTICE(2)).toBe(
      'Saving creates version 2. Runs that already finished keep pointing at version 1.',
    );
    expect(VERSION_NOTICE(7)).toContain('keep pointing at version 6');
    // "keep pointing at version 0" would be a sentence about a row that does not exist.
    expect(() => VERSION_NOTICE(1)).toThrow(/no\s+predecessor/);
  });
});

describe('the navigation partition (03-UI-SPEC § 0)', () => {
  it('nav groups hold six destinations', () => {
    // One partition used at both breakpoints: Leads are the three phone tabs and the first
    // desk group; Operations sit behind the More tab and in the second desk group. Three
    // tabs plus More is the most a 390px bar holds with every label still real text.
    expect(LEADS_NAV).toHaveLength(3);
    expect(OPERATIONS_NAV).toHaveLength(3);

    // The testids, IN ORDER. They are the e2e contract — touch-targets.spec.ts measures
    // every one — and nav-presets / nav-spend / nav-settings keep their Phase 2 names.
    expect(LEADS_NAV.map((i) => i.testId)).toEqual(['nav-presets', 'nav-review', 'nav-businesses']);
    expect(OPERATIONS_NAV.map((i) => i.testId)).toEqual([
      'nav-sources',
      'nav-spend',
      'nav-settings',
    ]);
    expect(NAV_ITEMS.map((i) => i.testId)).toEqual([
      ...LEADS_NAV.map((i) => i.testId),
      ...OPERATIONS_NAV.map((i) => i.testId),
    ]);

    // building-2 is the org glyph in the sidebar header. Reusing it for a destination puts
    // two meanings on one glyph in one sidebar.
    const all = [...LEADS_NAV, ...OPERATIONS_NAV];
    expect(all.map((i) => i.iconName)).not.toContain('building-2');

    // Every row has a real label — the label is the accessible-name fallback, never an
    // icon standing alone.
    for (const item of all) {
      expect(item.label.trim(), `${item.testId} has no label`).not.toBe('');
    }
  });
});
