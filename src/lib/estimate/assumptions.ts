/**
 * Every number the estimator cannot measure, in one file, spelled out.
 *
 * D-07 calls these "visible, editable assumptions stored as committed constants". Both
 * halves are load-bearing. VISIBLE: each value below is surfaced verbatim in the
 * assumptions drawer, so danlo can see what the dollar figure was built from rather than
 * being asked to trust it. COMMITTED: they live in source control with a test that prices
 * the real seeded cell list against them, so changing one reds a named test with exact
 * numbers instead of quietly moving every estimate in the product.
 *
 * 🔴 NOTHING HERE IS MEASURED. That is deliberate, not a gap. The honest thing to do with
 * an unmeasured multiplier is to name it, show it, and true it up against a real invoice —
 * which happens at the Phase 6 gate. The dishonest thing is to bury it in an expression.
 *
 * Source for the SKU choice and the free allowance: `src/lib/budget/price-book.ts`.
 * Source for the caveat: 02-RESEARCH.md § The Estimator, measured live 2026-09-22.
 */

/**
 * Query fan-out / tile overlap. One logical (cluster × geography) cell does not become one
 * Places request: the cluster's Places types are queried separately and the tiles that
 * cover a geography overlap, so the same cell is swept more than once.
 *
 * 🔴 UNMEASURED BY DESIGN (D-07). Every dollar figure in the product scales linearly with
 * this number. Trued up with real invoice data at the Phase 6 gate.
 */
export const FAN_OUT = 3.0;

/** Result pages per query leg, low end of the range. One page, nothing paginated. */
export const PAGES_LO = 1;

/**
 * Result pages per query leg, high end. Text Search (New) caps at 60 results across three
 * pages of 20, and 02-RESEARCH records that each `pageToken` page is separately billed
 * (MEDIUM confidence — verify on the first invoice). Three is therefore the worst case.
 */
export const PAGES_HI = 3;

/**
 * A radius is apportioned against a 25-mile reference county footprint: a 25-mile radius
 * is treated as covering a whole county, and smaller radii scale by the square of the
 * ratio (area, not distance).
 *
 * 🔴 This affects the EXPECTED-BUSINESS count only, never the request count — a radius is
 * one geography unit whatever its size, so it is always exactly one cell per cluster.
 * Trued up at the Phase 6 gate alongside FAN_OUT.
 */
export const RADIUS_REFERENCE_MILES = 25;

/** What the committed cost-model test prices: one full sweep per calendar month. */
export const DEFAULT_MONTHLY_SWEEPS = 1;

/**
 * `websiteUri` is an Enterprise-tier field and there is no cheaper path to it — Essentials
 * returns IDs only and Pro omits the website. The whole product is "does this business have
 * a website", so the estimate prices Enterprise or it prices a fiction.
 */
export const ESTIMATE_SKU = 'ts_enterprise' as const;

/**
 * Printed verbatim in the assumptions drawer. The under-count is a property of the tax
 * code, not of the query: Texas does not tax most personal services, so a barber holds no
 * sales-tax permit and never appears in the Comptroller data at all.
 */
export const ASSUMPTIONS_CAVEAT =
  'The Comptroller under-counts pure-service businesses - Texas does not tax most personal ' +
  'services, which is why personal care shows 977 RGV outlets against 15,977 for auto & ' +
  'retail. Expected businesses is a permit-holder count, not a Places result count.';
