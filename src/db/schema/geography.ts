import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { orgScopedNullable, referencePolicies } from './_helpers';

/**
 * Texas counties, carrying BOTH numbering systems, because the corpus needs both and
 * neither can be derived from the other by anything trustworthy.
 *
 * - `fips` is the 5-character census GEOID ('48215' = Hidalgo). Overture and the Census
 *   geocoder speak this.
 * - `comptroller_code` is the Texas Comptroller's own 1..254 county number. The sales-tax
 *   permit corpus speaks this.
 *
 * The relation between them is `county_fips = 2 * comptroller_code - 1`, and
 * `counties_fips_identity` pins it as a CHECK so a mistyped seed row is refused rather
 * than quietly mapping a permit to the wrong county. Deriving one from the other by
 * re-sorting county names is the documented anti-pattern — 15 of the 254 break it, so the
 * table ships with both columns and the identity is merely the guard.
 *
 * `outlet_count` is a denormalised roll-up the estimator reads; it is maintained by the
 * seed loader, which is why the table is mutable and carries `app.touch_updated_at`.
 */
export const counties = pgTable(
  'counties',
  {
    ...orgScopedNullable,
    fips: text('fips').notNull(),
    countyFips: integer('county_fips').notNull(),
    comptrollerCode: integer('comptroller_code').notNull(),
    name: text('name').notNull(),
    isRgv: boolean('is_rgv').notNull().default(false),
    outletCount: integer('outlet_count').notNull().default(0),
  },
  (t) => [
    index('counties_org_idx').on(t.orgId),
    unique('counties_org_fips_uniq').on(t.orgId, t.fips).nullsNotDistinct(),
    check('counties_fips_identity', sql`county_fips = 2 * comptroller_code - 1`),
    ...referencePolicies('counties'),
  ],
);

/**
 * The city list. It does not exist in the public corpus in a usable form, so it is
 * defined here and seeded: `is_rgv_seed` marks the hand-curated Rio Grande Valley set
 * the product launches on.
 *
 * `name_variants` is a text[] because the Comptroller corpus spells one city several ways
 * ('MCALLEN', 'Mc Allen'). Matching happens against the variants, display uses `name`.
 */
export const cities = pgTable(
  'cities',
  {
    ...orgScopedNullable,
    countyId: uuid('county_id')
      .notNull()
      .references(() => counties.id),
    name: text('name').notNull(),
    nameVariants: text('name_variants')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    outletCount: integer('outlet_count').notNull().default(0),
    isRgvSeed: boolean('is_rgv_seed').notNull().default(false),
  },
  (t) => [
    index('cities_org_idx').on(t.orgId),
    unique('cities_org_county_name_uniq').on(t.orgId, t.countyId, t.name).nullsNotDistinct(),
    ...referencePolicies('cities'),
  ],
);

/**
 * SRCH-01's three geography kinds, as saveable named shortcuts ("All RGV", "Hidalgo
 * County", "30 miles around McAllen").
 *
 * `kind` is constrained to exactly the three the product supports, and `payload` holds the
 * kind-specific body: an array of city ids, an array of county ids, or a centre plus a
 * radius. The same `kind`/`payload` pair reappears on `search_versions.geo_kind` /
 * `geo_payload` — a preset is a geo_preset the user named, and a version snapshots the
 * resolved shape rather than pointing at a preset that could later change underneath a
 * past run.
 */
export const geoPresets = pgTable(
  'geo_presets',
  {
    ...orgScopedNullable,
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [
    index('geo_presets_org_idx').on(t.orgId),
    unique('geo_presets_org_key_uniq').on(t.orgId, t.key).nullsNotDistinct(),
    check('gp_kind_known', sql`kind in ('cities','counties','radius')`),
    ...referencePolicies('geo_presets'),
  ],
);
