import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { runs } from './runs';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * One rectangle of the tiling quadtree for one (geography unit × Places type). D-06, D-16;
 * 04-RESEARCH Patterns 5 and 9.
 *
 * `tile_key` = `{unitKind}:{unitId}|{placesType}|{quadPath}`. Tiles are shared across presets
 * (the same unit and type produce the same tiles), which is what makes the IDs-only change
 * check reusable: a leaf's membership is diffed against `place_tile_members`, and
 * `changed_at` marks it as a candidate for the next paid sweep.
 *
 * `unit_id` is the DB-safe form of the geography id. `saturated` = the leaf returned the
 * 60-result ceiling; `truncated` = it could not subdivide further (min size / max depth).
 *
 * Holds geometry WE computed, never Places content. SELECT-only for `authenticated`; written
 * by a SECURITY DEFINER (04-15). Carries `app.touch_updated_at`, no `app.log_event`
 * (drizzle/0027 comment).
 */
export const placeTiles = pgTable(
  'place_tiles',
  {
    ...orgScoped,
    tileKey: text('tile_key').notNull(),
    unitKind: text('unit_kind').notNull(),
    unitId: text('unit_id').notNull(),
    placesType: text('places_type').notNull(),
    quadPath: text('quad_path').notNull(),
    depth: integer('depth').notNull(),
    south: doublePrecision('south').notNull(),
    west: doublePrecision('west').notNull(),
    north: doublePrecision('north').notNull(),
    east: doublePrecision('east').notNull(),
    isLeaf: boolean('is_leaf').notNull().default(true),
    saturated: boolean('saturated').notNull().default(false),
    truncated: boolean('truncated').notNull().default(false),
    lastSweptRunId: uuid('last_swept_run_id').references(() => runs.id),
    lastSweptAt: tstz('last_swept_at'),
    lastCheckedAt: tstz('last_checked_at'),
    changedAt: tstz('changed_at'),
  },
  (t) => [
    index('place_tiles_org_idx').on(t.orgId),
    unique('place_tiles_key').on(t.orgId, t.tileKey),
    check('pt_depth_non_negative', sql`depth >= 0`),
    ...orgPolicies('place_tiles'),
  ],
);
