import type { PublicBusiness } from './public-business';

export type PayloadBuilder = { name: string; build: (b: PublicBusiness) => unknown };

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
