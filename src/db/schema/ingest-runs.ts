import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One execution of one desk-run ingest (D-06): persisted, not printed, so `/sources` can
 * render it and SCHED-02 can later read the history.
 *
 * `source_key` is exactly the four `/sources` rows. Four keys, not a `dataset` column: each
 * row needs its own run history, and "the last Comptroller-closures run" must stay a
 * one-column lookup. The `ir_status_known` values map onto Phase 2's run-tone map.
 *
 * `added` / `changed` / `unchanged` / `gone` / `total_seen` are the run report. `gone` is a
 * REPORT LINE, never a state transition: Overture drops and re-adds ids between releases,
 * so nothing is deleted or status-changed because a row went unseen.
 *
 * 🔴 Deliberately NO `app.log_event` trigger. The run's own record IS the event; a row
 * trigger here would duplicate it on every counter update. The one run-level event goes
 * through `app.emit_event('ingest_runs', run_id, 'complete', stats)` per CONVENTIONS
 * § Audit. `EVENT_LOGGED` asserts set equality in both directions, so the exclusion is
 * recorded there and in drizzle/0023's `comment on table`.
 *
 * `authenticated` holds SELECT only (drizzle/0023). The ingest is a desk script; no tenant
 * session writes a run row.
 */
export const ingestRuns = pgTable(
  'ingest_runs',
  {
    ...orgScoped,
    sourceKey: text('source_key').notNull(),
    // 'jrea-zgmq' / '3kx8-uryv' for the two Socrata datasets; NULL for Overture and the geocoder.
    datasetId: text('dataset_id'),
    // Socrata rowsUpdatedAt as ISO, or the Overture release string.
    sourceVersion: text('source_version'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    status: text('status').notNull().default('running'),
    added: integer('added').notNull().default(0),
    changed: integer('changed').notNull().default(0),
    unchanged: integer('unchanged').notNull().default(0),
    gone: integer('gone').notNull().default(0),
    totalSeen: integer('total_seen').notNull().default(0),
    // Confidence bands, geocoder match-type counts, the unmapped basic_category list, and
    // every over-size block the resolver refused to expand.
    stats: jsonb('stats'),
    error: text('error'),
  },
  (t) => [
    // An RLS predicate on org_id gets no index for free (CONVENTIONS § Tenancy).
    index('ingest_runs_org_idx').on(t.orgId),
    // `/sources` reads the latest row per source; SCHED-02 reads the history.
    index('ingest_runs_source_idx').on(t.orgId, t.sourceKey, t.startedAt.desc()),
    check(
      'ir_source_key_known',
      sql`source_key in ('tx_comptroller','tx_comptroller_closures','overture','census_geocoder')`,
    ),
    check('ir_status_known', sql`status in ('running','complete','stopped','failed')`),
    ...orgPolicies('ingest_runs'),
  ],
);
