/**
 * How a run status renders. UI-SPEC § Spend view → Status badge tones.
 *
 * 🔴 THIS FILE CARRIES NO CLIENT-BOUNDARY DIRECTIVE, AND THAT IS THE WHOLE POINT.
 *
 * A client module's exports become client REFERENCES inside a server component — even
 * plain data objects like the two below. They do not arrive as data; they arrive as
 * `undefined`, at runtime, with `tsc`, `eslint` and `next build` ALL GREEN. BIS recorded
 * this twice, each time as a production 500 that looked like an empty screen. `RUN_TONE`
 * and `RUN_LABEL` are read by RSC pages, so the directive must never appear here, and
 * `src/app/layout.tsx` carries the same note for the same reason.
 *
 * The guard that enforces this is a BARE TOKEN SEARCH over `src/lib/ui/`, so this comment
 * deliberately does not spell the directive out — the same arrangement `src/lib/time.ts`
 * uses to stay out of its own zone grep. A file inside a guarded tree must not write the
 * string the guard hunts for, or the guard reports the warning as the violation.
 *
 * 🔴 COLOUR IS NEVER THE ONLY SIGNAL. `partial` and `refused` are distinguishable by tone
 * alone only to someone who can see the difference, so every badge renders `RUN_LABEL`
 * beside its tone. UI-SPEC § Accessibility makes that a requirement, not a preference,
 * and it is why the two maps ship together rather than the tone map shipping alone.
 */

/**
 * The six values of the `runs_status_known` CHECK constraint, and exactly those.
 *
 * A seventh status in the database with no tone here renders as `undefined` — an unstyled
 * badge with no word in it — so this union and that constraint move together or the screen
 * lies about what happened to a run.
 */
export type RunStatus = 'queued' | 'running' | 'complete' | 'partial' | 'refused' | 'failed';

export type BadgeTone =
  | 'neutral-outline'
  | 'accent-outline'
  | 'neutral-solid'
  | 'warning'
  | 'destructive';

export const RUN_TONE: Record<RunStatus, BadgeTone> = {
  queued: 'neutral-outline',
  running: 'accent-outline',
  complete: 'neutral-solid',
  // `partial` is the warning tone and nothing else in the product is: UI-SPEC reserves
  // warning for the 80 % banner, the gauge between 80 % and 99.9 %, and this badge.
  partial: 'warning',
  // A refused run and a failed run look the same and mean different things — refused is
  // the budget governor working, failed is the pipeline breaking. The LABEL is what tells
  // them apart, which is the accessibility rule doing double duty.
  refused: 'destructive',
  failed: 'destructive',
};

export const RUN_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  partial: 'Partial',
  refused: 'Refused',
  failed: 'Failed',
};

/** Every status, in the order the CHECK constraint lists them. Exported so a consumer can
 *  enumerate without restating the union, and so a test can compare against `drizzle/`. */
export const RUN_STATUSES: readonly RunStatus[] = [
  'queued',
  'running',
  'complete',
  'partial',
  'refused',
  'failed',
];

/* --- Places runs: stopped reasons and run kinds (04-UI-SPEC Rule 35, Open Question 19) ---
 *
 * `runs.stopped_reason` is a MACHINE KEY in the database and a SENTENCE on screen. These are
 * the keys; the sentences are `STOPPED_REASON` in `./copy.ts`, a `Record<StoppedReason, …>`,
 * so a key with no sentence is a compile error rather than a raw `google_daily_quota` in a
 * recent-runs row.
 *
 * The first six are the places-sweep reducer's `StopReason | FailReason`
 * (`src/workflows/places-sweep/reducer.ts`); `never_started` and `abandoned` are written by
 * the stale-run sweeper and migration 0027's backfill. `tests/unit/ui-maps.test.ts` pins the
 * reducer's unions to this one at compile time and walks every `stopped_reason = '…'`
 * literal in `drizzle/` and `src/`, so a new writer cannot land a key this list lacks. The
 * reducer is not imported here: it lives in the workflow sandbox, and the UI must not reach
 * into it for a string list. */

export const STOPPED_REASONS = [
  'budget_cap_reached',
  'exceeded_estimate',
  'google_daily_quota',
  'places_request_rejected',
  'places_unavailable',
  'places_key_missing',
  'never_started',
  'abandoned',
] as const;

export type StoppedReason = (typeof STOPPED_REASONS)[number];

/** What a run searched for: every cell, this ISO week's cells, or the free IDs-only diff. The
 *  report, the preset's recent runs and `/spend` all label it, in these words. */
export const RUN_KINDS = ['full_sweep', 'partition', 'change_check'] as const;

export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  full_sweep: 'Full sweep',
  partition: "This week's partition",
  change_check: 'Change check',
};

/* --- Ingest runs (03-UI-SPEC § 2, `/sources`) -------------------------------------------
 *
 * EXTENDED, NEVER DUPLICATED. `ingest_runs.status` is a different CHECK constraint
 * (`ir_status_known`: running · complete · stopped · failed) from `runs.status`, so it gets
 * its own named union — but the tones are the SAME `BadgeTone` vocabulary, in the same file,
 * so there is exactly one place that decides what a run status looks like.
 *
 * `stopped` is an ingest that ended before reading its whole source — the same fact Phase 2
 * calls `partial`, so it takes the same warning tone. Its word is "Stopped early", never
 * "Stopped": 03-UI-SPEC § Copy Table fixes the badge words, and a bare "Stopped" reads as
 * something a person did.
 *
 * Same drift rule as above: a fifth status in the database with no tone here renders as an
 * unstyled badge with no word in it, so `tests/unit/ui-maps.test.ts` compares this union
 * against the CHECK constraint's value list. */

export type IngestRunStatus = 'running' | 'complete' | 'stopped' | 'failed';

export const INGEST_RUN_TONE: Record<IngestRunStatus, BadgeTone> = {
  running: 'accent-outline',
  complete: 'neutral-solid',
  stopped: 'warning',
  failed: 'destructive',
};

export const INGEST_RUN_LABEL: Record<IngestRunStatus, string> = {
  running: 'Running',
  complete: 'Complete',
  stopped: 'Stopped early',
  failed: 'Failed',
};

/** Every ingest status, in the order `ir_status_known` lists them. */
export const INGEST_RUN_STATUSES: readonly IngestRunStatus[] = [
  'running',
  'complete',
  'stopped',
  'failed',
];
