# Phase 3 — deferred items

Work found during execution that is outside the finding plan's scope. Each entry has its evidence
and the plan that found it.

## From 03-20 (the desk run, 2026-09-22/23)

### D-11 amendment: a chain needs ≥ 3 members more than 500 m apart

- **Decision (danlo, 2026-09-23):** D-11 is **kept** as is for Phase 3. This is queued as a follow-up.
- **Why:** D-11 counts ≥ 3 live rows per `name_norm` before anything merges, so three copies of
  one business (one Comptroller outlet plus two Overture listings) are flagged as a chain. They
  are capped at 94 and never auto-merge.
- **Measured** on the pre-merge spine (`docs/measurements/03-desk-run.md` § D-11):
  - **67 groups / 205 rows** have every member within 500 m of every other.
  - **66 candidate pairs** inside them score raw ≥ 95 and are held at 94.
  - Rio Stone Products (fixture P10) is one of them.
- **Shape of the fix:** a chain counts only when it has ≥ 3 members that are more than 500 m
  apart. It needs its own fixture group and a red test. `tests/db/resolve-pass.test.ts`
  test 9 (`three identical names read as a chain and wait for review`) pins today's behaviour
  and should flip.

### Resolve stage 2: the B3 trigram lateral takes 6–12 minutes

- **Measured:** 725 s on the first pass (51,664 pairs inserted) and 345 s on a re-pass that
  inserted nothing. Research expected ~70 s.
- **Cause:** B3 probes every live row (~90k), not only the 34,928 Comptroller rows, against its
  whole ZIP. The plan BitmapANDs `businesses_name_trgm` (≈168 rows per probe) with
  `businesses_addr_idx`, which returns every row in the ZIP (≈4,080 per probe). A 500-probe
  `EXPLAIN ANALYZE` took 4.7 s, about 9 ms per probe.
- **Options:**
  - Probe cross-source only, as research did (Comptroller → Overture).
  - Drop the `postal` equality from the index conditions so the planner uses the GIN index
    alone and rechecks the ZIP.
  - Add `btree_gin` for a composite `(org_id, postal, name_norm)` GIN index.

### Resolve stage 5: 343 ms per merge (an org-wide lookup)

- **Measured:** 1,077 merges in 369.8 s.
- **Cause:** 03-14 predicted this. The member lookup in `merge.ts` `readParents` uses
  `coalesce(merged_into_id, id) = $1`, which no index serves, so it scans the org's businesses
  once per merge.
- **Fix:** `id in (…) or merged_into_id in (…)`, which `businesses_pkey` and
  `businesses_merged_idx` can both serve.
- **Why it matters:** it is correct, just slow, and against production every merge also pays
  the network round trip.

## From 03-21 (production migrate + deploy + e2e, 2026-09-23)

### No product delete path for a preset, so `presets.spec.ts` cannot tear down

- **Gap:** `tests/e2e/presets.spec.ts` creates three `searches` rows (each with one
  `search_versions` row) per run, named `e2e-<epoch>-{cities,county,radius}` in both
  `display_name` and `name_internal`, in whatever database the E2E_BASE_URL app writes to —
  production, in CI and in this plan's run. The product has **no delete path** for a preset
  (the server actions are duplicate, estimate, queue-run and save-version), so there is no
  product path an `afterAll` could drive.
- **Refused alternative:** a direct database delete from the spec. The only credential that can
  delete on production is `SUPABASE_DB_URL` (the owner, bypasses RLS), which `docs/deploy.md`
  §3 forbids from leaving a developer machine.
- **What 03-21 did instead:** the spec's `afterAll` prints the names of every preset it created
  (`presets.spec.ts: this run named 3 preset(s) … e2e-<epoch>-cities, …`), so a cleanup can
  target exactly those rows.
- **Measured on production (read-only, 2026-09-23):** **12** `e2e-*` searches (12 versions)
  from **4** prior runs before 03-21's run; 03-21's run added three more:
  `e2e-1790140526554-cities`, `e2e-1790140526554-county`, `e2e-1790140526554-radius` —
  confirmed read-only afterwards at **15** searches / 15 versions from 5 runs. (The
  mutation-check run of `sources`/`businesses` created none.)
- **Fix:** a "delete preset" (or archive) server action with its own RLS test. Then turn the
  `afterAll` into a real teardown through it, and do a one-time human cleanup of the `e2e-%`
  rows (FK order: any runs, then versions, then searches).
