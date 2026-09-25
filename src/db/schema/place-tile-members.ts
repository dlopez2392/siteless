import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { placeTiles } from './place-tiles';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * Which place ids a leaf tile returned, over time. D-06, D-16; 04-RESEARCH Pattern 9.
 *
 * `place_id` only — legal to keep indefinitely (D-06). A place that disappears from a tile
 * gets `gone_at`, never a delete: "gone" is history the change check diffs against.
 *
 * SELECT-only for `authenticated`; written by a SECURITY DEFINER. Carries
 * `app.touch_updated_at`, no `app.log_event` (drizzle/0027 comment).
 */
export const placeTileMembers = pgTable(
  'place_tile_members',
  {
    ...orgScoped,
    tileId: uuid('tile_id')
      .notNull()
      .references(() => placeTiles.id),
    placeId: text('place_id').notNull(),
    firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    goneAt: tstz('gone_at'),
  },
  (t) => [
    index('place_tile_members_org_idx').on(t.orgId),
    unique('place_tile_members_key').on(t.tileId, t.placeId),
    index('place_tile_members_place_idx').on(t.orgId, t.placeId),
    ...orgPolicies('place_tile_members'),
  ],
);
