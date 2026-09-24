# Phase 4: Deferred Items

Out-of-scope discoveries logged during Phase 4 execution. They are recorded here and not fixed.

## From 04-30 (production pre-flight, 2026-09-23)

### The stale `general_contractor` row in production `industry_terms` (inert)

- **What:** production `industry_terms` still holds one built-in row, `kind = 'places_type'`,
  `value = 'general_contractor'`, `org_id IS NULL`. The read-only pre-flight of 04-30 read it on
  2026-09-23; 27 `places_type` rows are present in total.
- **Why it is stale:** `src/seed/data/clusters.json` removed `general_contractor` because it is
  Places Table B only and cannot be sent as `includedType`. `scripts/seed.ts` upserts and never
  deletes, so removing it from the JSON did not remove the row that is already in production.
- **Why it is inert:** Phase 4 reads no Places type from `industry_terms`. Every type is
  validated against the Table A snapshot in `src/lib/places/place-types.ts` before any paid
  call (`tests/unit/place-types.test.ts`).
- **Optional cleanup:** a later migration can delete the one built-in row, since
  `org_id IS NULL` rows are migration-owner territory. Never delete it by hand in the dashboard.
- **A plan-text defect found alongside it:** 04-30 Task 1 step 5 queries `term`, but the
  column is `value`. The first pre-flight attempt raised `42703` inside the read-only
  transaction, which wrote nothing. The corrected read is
  `select value from industry_terms where kind = 'places_type' and value = 'general_contractor'`.

### Still deferred: no preset delete path, so `presets.spec.ts` cannot tear down (owed since Phase 2)

- Carried forward unchanged from
  `.planning/phases/03-free-data-spine-entity-resolution/deferred-items.md`, section "From 03-21".
  There is no product delete action for a preset. The deployed e2e run keeps adding `e2e-<epoch>-*`
  `searches` rows to production, and `afterAll` only prints their names.
- Phase 4 did not pick this up.
- The five production `runs` those presets queued in Phase 2 and 3 are still `queued` as of the
  pre-flight. Migration 0027 fails them as `never_started` on apply.
