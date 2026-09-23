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
  DETACH_CONFIRM,
  GEOCODE_NO_MATCH,
  GOOGLE_MAPS_TAG,
  PHASE4_RUN_NOTICE,
  PRESETS_EMPTY_HEADING,
  REJECT_CONFIRM,
  REVIEW_ACTION_NOT_THIS,
  RUN_ABANDONED,
  RUN_ALREADY_IN_PROGRESS,
  RUN_CHECK_CHANGES,
  RUN_ESTIMATE_LINE,
  RUN_FAILED_ERROR,
  RUN_FULL_SWEEP,
  RUN_MODE_REFUSED,
  RUN_NEVER_STARTED,
  RUN_NO_GEOMETRY,
  RUN_PARTITION,
  RUN_REFUSED,
  RUN_REPORT_TITLE,
  RUN_STOP_DAILY_QUOTA,
  RUN_TRUNCATION_HEADING,
  SECOND_WALL_SET_BADGE,
  SKIP_LINK,
  SOURCES_RUN_STATUS,
  SOURCES_TRANSIENT_TITLE,
  SPEND_FOOTER,
  STOPPED_REASON,
  VERSION_NOTICE,
} from '@/lib/ui/copy';
import {
  RUN_ABANDONED_AFTER_MINUTES,
  RUN_CEILING_MULTIPLIER,
  RUN_NEVER_STARTED_AFTER_MINUTES,
} from '@/lib/estimate/assumptions';
import {
  INGEST_RUN_LABEL,
  INGEST_RUN_STATUSES,
  INGEST_RUN_TONE,
  RUN_KIND_LABEL,
  RUN_KINDS,
  RUN_LABEL,
  RUN_STATUSES,
  RUN_TONE,
  STOPPED_REASONS,
  type RunStatus,
  type StoppedReason,
} from '@/lib/ui/run-tone';
import type { FailReason, StopReason } from '@/workflows/places-sweep/reducer';
import { LEADS_NAV, NAV_ITEMS, OPERATIONS_NAV } from '@/components/app-shell/app-sidebar';

const UI_DIR = nodePath.join('src', 'lib', 'ui');
const DRIZZLE_DIR = 'drizzle';

/** Every file under `dir` (recursively) whose name ends in one of `exts`. */
function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** A compile-time assertion: `Assert<false>` does not type-check. */
type Assert<T extends true> = T;

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

  it('ingest run tone covers every status', () => {
    // `ingest_runs.status` is its own CHECK constraint (`ir_status_known`), not `runs.status`.
    // A fifth value there with no tone here renders on /sources as an unstyled badge with no
    // word in it, so the union and the constraint are compared, not trusted to agree.
    const sql = nodeFs
      .readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => nodeFs.readFileSync(nodePath.join(DRIZZLE_DIR, f), 'utf8'))
      .join('\n');

    const matches = [...sql.matchAll(/ir_status_known"?\s+CHECK\s*\(status in \(([^)]*)\)\)/gi)];
    // Two-sided: a renamed constraint makes this regex find nothing, and an empty list would
    // compare equal to nothing while checking nothing.
    expect(matches.length).toBeGreaterThanOrEqual(1);

    for (const match of matches) {
      const fromSql = [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(fromSql).toEqual([...INGEST_RUN_STATUSES]);
    }

    expect(Object.keys(INGEST_RUN_TONE).sort()).toEqual([...INGEST_RUN_STATUSES].sort());
    expect(Object.keys(INGEST_RUN_LABEL).sort()).toEqual([...INGEST_RUN_STATUSES].sort());
    for (const status of INGEST_RUN_STATUSES) {
      expect(INGEST_RUN_TONE[status], `${status} has no tone`).toBeTruthy();
      expect(INGEST_RUN_LABEL[status], `${status} has no word`).toBeTruthy();
    }

    // 03-UI-SPEC § Copy Table fixes the three badge words; the copy module spells them too,
    // so the two spellings are pinned to each other and to the spec.
    expect(INGEST_RUN_LABEL.stopped).toBe('Stopped early');
    for (const status of ['complete', 'stopped', 'failed'] as const) {
      expect(INGEST_RUN_LABEL[status]).toBe(SOURCES_RUN_STATUS[status]);
    }

    // Extended, not forked: the ingest tones are drawn from the SAME vocabulary the Phase 2
    // run statuses use, so a stopped ingest looks exactly like a partial run.
    const phase2Tones = new Set(Object.values(RUN_TONE));
    for (const tone of Object.values(INGEST_RUN_TONE)) expect(phase2Tones.has(tone)).toBe(true);
    expect(INGEST_RUN_TONE.stopped).toBe(RUN_TONE.partial);
    expect(INGEST_RUN_TONE.failed).toBe(RUN_TONE.failed);
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

describe('run kinds and stopped reasons (04-UI-SPEC Rule 35, Open Question 19)', () => {
  it('every run kind has a label', () => {
    expect([...RUN_KINDS]).toEqual(['full_sweep', 'partition', 'change_check']);
    expect(Object.keys(RUN_KIND_LABEL).sort()).toEqual([...RUN_KINDS].sort());
    // 04-UI-SPEC § Copy Table → Run report → Kind labels, verbatim.
    expect(RUN_KIND_LABEL).toEqual({
      full_sweep: 'Full sweep',
      partition: "This week's partition",
      change_check: 'Change check',
    });
  });

  it("the reducer's stop and fail reasons are stopped reasons", () => {
    // Compile-time half: a ninth reason added to the reducer's unions without a matching
    // StoppedReason makes this line fail `tsc` — the check runs before any test does.
    const covered: Assert<StopReason | FailReason extends StoppedReason ? true : false> = true;
    expect(covered).toBe(true);

    // Runtime half. `satisfies Record<…, true>` makes this literal list EXACTLY the reducer's
    // union (a missing key and an extra key are both compile errors), so the loop below walks
    // every reason the workflow can write, not a hand-picked subset.
    const reducerReasons = {
      budget_cap_reached: true,
      exceeded_estimate: true,
      google_daily_quota: true,
      places_request_rejected: true,
      places_unavailable: true,
      places_key_missing: true,
    } satisfies Record<StopReason | FailReason, true>;
    for (const reason of Object.keys(reducerReasons)) {
      expect(STOPPED_REASONS as readonly string[], `${reason} is not a StoppedReason`).toContain(
        reason,
      );
    }

    // The writers outside the reducer: every `stopped_reason = '<key>'` literal in a migration
    // or in src/ (the never_started backfill, the budget refusal, the stale-run sweeper) must
    // be a StoppedReason too. Two-sided: the walk must find the two writers that exist today.
    const sources = [
      ...nodeFs
        .readdirSync(DRIZZLE_DIR)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => nodePath.join(DRIZZLE_DIR, f)),
      ...walk('src', ['.ts', '.tsx']),
    ];
    const written = new Set<string>();
    for (const file of sources) {
      const text = nodeFs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/stopped_reason\s*=\s*'([a-z_]+)'/g)) written.add(m[1] ?? '');
    }
    expect(written).toContain('never_started');
    expect(written).toContain('budget_cap_reached');
    for (const reason of written) {
      expect(STOPPED_REASONS as readonly string[], `${reason} is written but has no copy`).toContain(
        reason,
      );
    }
  });

  it('every stopped reason the executor can write has copy', () => {
    expect([...STOPPED_REASONS]).toEqual([
      'budget_cap_reached',
      'exceeded_estimate',
      'google_daily_quota',
      'places_request_rejected',
      'places_unavailable',
      'places_key_missing',
      'never_started',
      'abandoned',
    ]);
    expect(Object.keys(STOPPED_REASON).sort()).toEqual([...STOPPED_REASONS].sort());
    for (const reason of STOPPED_REASONS) {
      const sentence = STOPPED_REASON[reason];
      expect(typeof sentence, `${reason} has no copy`).toBe('string');
      expect(sentence.trim(), `${reason} has empty copy`).not.toBe('');
      // Rule 35: a machine key never reaches the screen. No sentence carries an underscore,
      // which is the one character every key has and no English sentence here needs.
      expect(sentence, `${reason} renders a machine key`).not.toContain('_');
      expect(sentence).not.toContain(reason);
    }
  });

  it('phase 4 copy matches the UI-SPEC copy table', () => {
    // 04-UI-SPEC § Copy Table / § Copywriting Contract, exact. Case matters: "Google Maps" is
    // Google's required attribution text and is never "google maps" or "Google".
    expect(GOOGLE_MAPS_TAG).toBe('Google Maps');
    expect(RUN_FULL_SWEEP).toBe('Run full sweep');
    expect(RUN_PARTITION).toBe("Run this week's partition");
    expect(RUN_CHECK_CHANGES).toBe('Check for changes (free)');
    expect(REVIEW_ACTION_NOT_THIS).toBe('Not this business');
    expect(REJECT_CONFIRM).toBe('Never attach this listing');
    expect(DETACH_CONFIRM).toBe('Detach this listing');
    expect(SOURCES_TRANSIENT_TITLE).toBe('Google Places (transient)');
    expect(RUN_REPORT_TITLE).toBe('Run report');
    expect(SECOND_WALL_SET_BADGE).toBe('Set');

    // "Name the number", with the grammar the number needs.
    expect(RUN_TRUNCATION_HEADING(1).startsWith('1 tile still hit')).toBe(true);
    expect(RUN_TRUNCATION_HEADING(3).startsWith('3 tiles still hit')).toBe(true);
    expect(RUN_TRUNCATION_HEADING(1234).startsWith('1,234 tiles still hit')).toBe(true);
    expect(RUN_TRUNCATION_HEADING(3)).toBe(
      "3 tiles still hit Google's 60-result limit at the smallest tile size.",
    );
  });

  it('the settled copy gaps name the number and say what happened to the money', () => {
    // Amendment 1 (04-UI-SPEC). Every stop, refusal and failure says whether anything was
    // charged — the voice rule these sentences were written against.
    const quota = RUN_STOP_DAILY_QUOTA(100, 41, 27);
    expect(quota).toContain("Google's daily limit of 100 requests");
    expect(quota).toContain('nothing past the limit was charged');
    expect(quota).toContain('The 41 tiles already searched are complete; the 27 not searched');
    expect(quota).toContain('midnight Pacific time');

    // D-18: the ceiling is enforced on REQUESTS, so both figures render — inside the free
    // allowance the dollar ceiling is $0.00 and would read as "stops immediately" alone.
    expect(RUN_ESTIMATE_LINE(1_900_000n, 2_900_000n, 5_800_000n, 166)).toBe(
      'Estimated $1.90–$2.90 · this run stops at $5.80 · 166 requests',
    );
    expect(RUN_ESTIMATE_LINE(0, 0, 0, 1_204)).toBe(
      'Estimated $0.00–$0.00 · this run stops at $0.00 · 1,204 requests',
    );

    // The minute figures come from the constants the sweeper uses, never a second literal.
    expect(RUN_NEVER_STARTED).toContain(`within ${RUN_NEVER_STARTED_AFTER_MINUTES} minutes`);
    expect(RUN_NEVER_STARTED).toContain('nothing was charged');
    expect(RUN_ABANDONED(2_310_000n)).toContain(`for ${RUN_ABANDONED_AFTER_MINUTES} minutes`);
    expect(RUN_ABANDONED(2_310_000n)).toContain('so $2.31 above is exactly what it cost');
    // "twice the estimate" in STOPPED_REASON is prose for RUN_CEILING_MULTIPLIER.
    expect(RUN_CEILING_MULTIPLIER).toBe(2);
    expect(STOPPED_REASON.exceeded_estimate).toContain('twice the estimate');

    expect(RUN_ALREADY_IN_PROGRESS).toContain('Nothing was reserved and nothing was charged.');
    expect(RUN_NO_GEOMETRY('Texas')).toContain('no map outline for Texas, so it can');
    expect(RUN_NO_GEOMETRY(['Texas', 'Oklahoma'])).toContain(
      "no map outline for Texas and Oklahoma, so it can't tile them",
    );
    expect(RUN_MODE_REFUSED('off')).toContain('Google Places was switched off after this page');
    expect(RUN_MODE_REFUSED('ids_only')).toContain('switched to IDs-only mode after this page');

    // The {error} clause never carries a machine key or a Google response fragment.
    expect(Object.keys(RUN_FAILED_ERROR).sort()).toEqual([
      'places_key_missing',
      'places_request_rejected',
      'places_unavailable',
    ]);
    for (const clause of Object.values(RUN_FAILED_ERROR)) expect(clause).not.toContain('_');
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
