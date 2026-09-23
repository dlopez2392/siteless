import { toPublicBusiness, type BusinessLike, type PublicBusiness } from './public-business';

export type PayloadBuilder = { name: string; build: (b: PublicBusiness) => unknown };

/**
 * The ONE way to run a payload builder (B-WR-10): it is handed the runtime projection of the
 * row, never the row itself, so even a builder that spreads or stringifies its argument
 * cannot emit an internal column. Callers pass the wide row they hold.
 */
export function buildPayload(builder: PayloadBuilder, business: BusinessLike): unknown {
  return builder.build(toPublicBusiness(business));
}

/**
 * Every outbound payload builder — CSV export row, BIS contact push, any future webhook —
 * registers here. The list is empty in Phase 1 and that is deliberate: the enumeration
 * test in tests/unit/no-internal-leak.test.ts turns "I forgot to register it" into a
 * failing build from day one, so the harness is real before there is anything to harness.
 *
 * A builder's `name` is also its module's basename: `{ name: 'csv-export-row' }` must live
 * in `src/lib/export/csv-export-row.ts`. That is what lets the enumeration compare a
 * directory listing against this array without a second mapping to keep in sync.
 *
 * Phase 8 adds: { name: 'bis-contact-push', build: buildBisContact }
 * Phase 8 adds: { name: 'csv-export-row',   build: buildCsvRow }
 */
export const PAYLOAD_BUILDERS: PayloadBuilder[] = [];
