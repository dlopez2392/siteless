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

## From 03-22 (the phase gate, 2026-09-23)

### M25, script form: the distinct-across-clusters check is covered only by chance

- **Found:** mutation M25a (`docs/measurements/03-gate-mutations.md`, finding F7). `mergeCandidate` in
  `scripts/resolve.ts` re-points both sides through `coalesce(merged_into_id, id)` before its
  distinct check. With that re-point removed, the check builds its member set from the RAW ids,
  so it misses a `distinct` decision that spans a cluster **only when** the second edge's raw
  side is the loser rather than the root. That depends on the random uuid order `seedTriple`
  produces.
- **Measured:** `the pass is deterministic` failed **2 of 6** runs under M25a (green 5 of 7
  counting the full-suite run). `a chain-flagged pair is never auto-merged` killed it **6/6**, so
  the re-point is not dead code; the distinct-spanning-cluster behaviour just has no
  deterministic test.
- **Proposed test** (`tests/db/resolve-pass.test.ts`): seed the synthetic triple, then **order
  the ids explicitly**. Re-assign `created_at` so the business whose id sorts first among the
  edge pair is the LOSER of the first merge, so the second edge the pass takes has its raw left
  side merged away. Seed `distinct` between the outer two, run the pass, and assert
  `skipped_distinct: 1, merged: 1`. Watch it red under M25a every time (run it 5× under the
  mutation, and demand 5 reds).

### Restoring a database function from the migration file: strip `\r` and verify by md5

- **Found:** M21's restore (F5). `drizzle/0024_merge_functions.sql` is CRLF in the working tree
  (`core.autocrlf=true`), and the catalog was built from LF text. Restoring `app.undo_merge` from
  the file's bytes gave a function with **105 CRs** (`md5 facc5537…`, 4692 chars), functionally
  identical and green in every test, but **not the same object** as the capture
  (`81cbfbff…`, 4587 chars).
- **Rule for every future live-function mutation:** capture `md5(pg_get_functiondef(oid))` and
  its length before mutating. Restore from the migration's statement **with `\r` stripped**, and
  verify md5 **and** length against the capture. `$PNPM db:migrate` is not a restore: drizzle
  skips a recorded migration and reports success (03-11).
- **Status:** a process note. No code change.

### Local `orgs.display_name` reads `bis-1790038019758308742`, not "BIS"

- **Seen in:** every 03-22 screenshot. The phone top bar and the desk sidebar print the org label.
- **Cause:** the LOCAL `siteless_test` row for `org_3Jf2trxDQzIC3yX4sgZki3kE3ky` (created
  2026-09-22) has `display_name = name_internal = 'bis-1790038019758308742'`, while the Clerk
  org is named "BIS". This is local data and Phase 1 chrome (`ensureOrg` / the shell's
  `orgLabel`), not a Phase 3 screen.
- **Follow-up:** check whether `ensureOrg` writes the Clerk org's **name** or its generated
  slug into `display_name` on first sight. If it writes the slug, production shows the same.
  Otherwise, one `update` of the local row.

### Detail header: "{name} merged into {name}" on a loser's page

- **Found alongside** 03-22 fix 3 (the merge history). `detail-header.tsx`'s
  `business-merged-into` line uses `MERGE_ROW(displayName, mergedInto.displayName)`. On a
  merged-away record whose winner carries the same display name (the common case after
  survivorship), it reads "X merged into X", the ambiguity fix 3 removed from the history.
- **Fix:** carry the winner's lead key on `mergedInto` (`merged_into_key` in
  `readBusinessDetail`) and render `MERGE_ROW(MERGE_SIDE(ownKey, ownSource), MERGE_SIDE(...))`,
  with a render test using two same-name records, as fix 3 did.

### Header badges other than Closed still render at the Badge default 12/500

- **Seen in:** 03-22 fix 4. The shared `ClosedBadge` now renders at 14/600 everywhere. The
  detail header's `Chain` and `Merged away` badges (and the `/businesses` "Merged away" badge)
  still use the Badge default 12px/500, below the UI-SPEC Label 14 while the review card's chain
  badge is 14/600.
- **Fix:** the same treatment, one shared flag-badge class or component, pinned by the
  `closed-badge.test.tsx` pattern.

### Fixed during 03-22 (recorded for the log): the review-actions `created_at` tie

- **Done in `f8cce1a`.** `a recorded merge names the true winner and loser for the toast` failed
  about half the time. `seedComptrollerSide` back-dates the Comptroller side one day, and the
  test back-dated the Overture side to `now() - 1 day`: the same instant inside one transaction.
  So the winner rule fell through to the smaller random uuid. The fix back-dates the Overture
  side two days. It went 6/6 green in isolation and green in every full DB run since (193, then
  194 tests).
