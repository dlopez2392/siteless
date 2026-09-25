import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { costReservations } from './budget';
import { placeTiles } from './place-tiles';
import { runs } from './runs';
import { orgPolicies, orgScoped } from './_helpers';

/**
 * One tile searched by one run. D-15, D-16; 04-RESEARCH Pattern 8.
 *
 * Drives the run screen's Tiles counts and "tiles still subdividing", and is the durable
 * cursor that lets a crashed workflow resume without paying twice:
 * `inflight_reservation_id` / `inflight_request_id` name the page reservation a step holds
 * between reserving and settling (04-RESEARCH Pattern 2).
 *
 * 🔴 NO page-token column. A `nextPageToken` stays in memory for the life of one step — data
 * minimization; a token is Google's opaque content and a resumed run re-queries from page 1.
 *
 * `kind`: `enterprise` pays for `websiteUri`; `ids_only` is the free change check (D-16).
 * `truncated_why`: `max_depth | min_size | novelty`. `change_verdict` is the IDs-only diff.
 *
 * SELECT-only for `authenticated`; written by a SECURITY DEFINER. Carries
 * `app.touch_updated_at`, no `app.log_event` (drizzle/0027 comment).
 */
export const runSearches = pgTable(
  'run_searches',
  {
    ...orgScoped,
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    tileId: uuid('tile_id')
      .notNull()
      .references(() => placeTiles.id),
    tileKey: text('tile_key').notNull(),
    cellKey: text('cell_key').notNull(),
    clusterKey: text('cluster_key').notNull(),
    placesType: text('places_type').notNull(),
    kind: text('kind').notNull(),
    depth: integer('depth').notNull(),
    parentTileKey: text('parent_tile_key'),
    status: text('status').notNull().default('planned'),
    pagesDone: integer('pages_done').notNull().default(0),
    resultsCount: integer('results_count').notNull().default(0),
    saturated: boolean('saturated').notNull().default(false),
    subdivided: boolean('subdivided').notNull().default(false),
    truncated: boolean('truncated').notNull().default(false),
    truncatedWhy: text('truncated_why'),
    changeVerdict: text('change_verdict'),
    newIds: integer('new_ids').notNull().default(0),
    goneIds: integer('gone_ids').notNull().default(0),
    inflightReservationId: uuid('inflight_reservation_id').references(() => costReservations.id),
    inflightRequestId: text('inflight_request_id'),
  },
  (t) => [
    index('run_searches_org_idx').on(t.orgId),
    unique('run_searches_key').on(t.runId, t.tileKey),
    index('run_searches_run_idx').on(t.orgId, t.runId),
    check('rs_kind_known', sql`kind in ('enterprise','ids_only')`),
    check('rs_status_known', sql`status in ('planned','searching','done','stopped')`),
    check(
      'rs_truncated_why_known',
      sql`truncated_why is null or truncated_why in ('max_depth','min_size','novelty')`,
    ),
    check(
      'rs_change_verdict_known',
      sql`change_verdict is null or change_verdict in ('baseline','unchanged','new','gone','both','saturated')`,
    ),
    ...orgPolicies('run_searches'),
  ],
);
