import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { businesses } from './businesses';
import { placeAttachments } from './place-attachments';
import { runs } from './runs';
import { orgPolicies, orgScoped, tstz } from './_helpers';

/**
 * What one run saw for one attached (or tentative) listing. APPEND-ONLY. D-09, D-10, D-13.
 *
 * One immutable row per (run, business, place). It holds exactly the derived signals the
 * Places terms let us keep, and nothing else:
 *   * `had_website_uri` — the boolean (PLACE-02).
 *   * `host_class` — computed from `websiteUri` AT CALL TIME and the URL itself discarded
 *     (D-09): `none | business_site_dead | social | directory | platform_subdomain | other`.
 *     `po_host_class_agrees` makes the pair impossible to contradict.
 *   * `sku` — which Text Search SKU produced it (the cost of the verdict).
 *   * `pure_sab` — the `pureServiceAreaBusiness` flag.
 *
 * 🔴 Coordinates are NOT here. They live in `place_coordinates`, which `authenticated` cannot
 * read at all and which the purge DELETES from — so D-10 ("the purge never deletes an
 * observation") and D-12 ("no coordinate older than 30 days can be read") hold with ZERO
 * UPDATE path on this table (04-RESEARCH Open Question 6).
 *
 * Append-only twice over (drizzle/0027): `authenticated` holds SELECT only, and a BEFORE
 * UPDATE OR DELETE trigger raises `55000` even for the owner. No `app.touch_updated_at` —
 * the `cost_ledger` precedent — and no `app.log_event` (per-run volume; audited at run level).
 * `updated_at` / `updated_by` come with `orgScoped` and simply never move.
 */
export const placeObservations = pgTable(
  'place_observations',
  {
    ...orgScoped,
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    placeId: text('place_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => placeAttachments.id),
    hadWebsiteUri: boolean('had_website_uri').notNull(),
    hostClass: text('host_class').notNull(),
    sku: text('sku').notNull(),
    pureSab: boolean('pure_sab').notNull(),
    observedAt: tstz('observed_at').notNull().defaultNow(),
  },
  (t) => [
    index('place_observations_org_idx').on(t.orgId),
    unique('place_observations_run_pair_key').on(t.runId, t.businessId, t.placeId),
    // The signal view's lateral: latest observation per (business, place).
    index('place_observations_business_idx').on(t.orgId, t.businessId, t.observedAt.desc()),
    check(
      'po_host_class_known',
      sql`host_class in ('none','business_site_dead','social','directory','platform_subdomain','other')`,
    ),
    check(
      'po_sku_known',
      sql`sku in ('ts_essentials','ts_pro','ts_enterprise','ts_enterprise_atmosphere')`,
    ),
    // D-09: the boolean and the class cannot disagree. `none` ⇔ no websiteUri.
    check('po_host_class_agrees', sql`had_website_uri = (host_class <> 'none')`),
    ...orgPolicies('place_observations'),
  ],
);
