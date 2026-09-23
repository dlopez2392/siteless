import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { placeObservations } from './place-observations';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * The only Places lat/lng on disk, and the retention barrier. D-10, D-12.
 *
 * 🔴 `authenticated` and `anon` hold NO privilege on this table at all (drizzle/0027 revokes
 * everything and grants nothing). Any tenant read is `42501 permission denied for table
 * place_coordinates` — that is D-12's database-level proof, named test
 * "authenticated cannot read place coordinates" (M37). The counts the /sources screen shows
 * come from a SECURITY DEFINER (04-11), and the daily purge — the one cross-org function,
 * executable only by `siteless_cron` — DELETES expired rows. It never touches an observation.
 *
 * `pc_expiry_within_30_days` makes "kept past 30 days" unrepresentable: a writer cannot set
 * an expiry beyond `observed_at + 30 days`, so the purge only ever has to honour the column.
 *
 * One row per observation (`place_coordinates_observation_key`). No touch trigger and no
 * `app.log_event`: rows are inserted, then deleted by the purge, never updated.
 */
export const placeCoordinates = pgTable(
  'place_coordinates',
  {
    ...orgScoped,
    observationId: uuid('observation_id')
      .notNull()
      .references(() => placeObservations.id),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    observedAt: tstz('observed_at').notNull(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    index('place_coordinates_org_idx').on(t.orgId),
    unique('place_coordinates_observation_key').on(t.observationId),
    // The purge's predicate: `expires_at <= now()`.
    index('place_coordinates_expiry_idx').on(t.expiresAt),
    check('pc_expiry_within_30_days', sql`expires_at <= observed_at + interval '30 days'`),
    check('pc_expiry_after_observed', sql`expires_at > observed_at`),
    ...orgPolicies('place_coordinates'),
  ],
);
