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
