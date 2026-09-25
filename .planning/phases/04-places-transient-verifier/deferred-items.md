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

## From the Phase 4 code review fixes (04-REVIEW-FIX.md, 2026-09-24)

Each item below was left alone on purpose. Each one needs a decision, a legal check or a schema
change, not a code fix.

### F1: persist the Places page token (B-CR-02's residual). Needs a D-01 check first.

- **What stays open.** If the process crashes AFTER some pages of a tile are recorded, the
  re-executed step starts again at page 1 and re-buys those pages. Google's `nextPageToken` lives
  only in the step's memory, so nothing lets it resume.
- **Current mitigation (B-CR-02, `9444a26`).** A 5xx, a timeout or a per-minute 429 on page 2 or
  3 is retried INSIDE the step while the token is still in memory. That is up to 2 retries, 1 s
  then 2 s back-off, honouring a Retry-After of up to 60 s, and each attempt is reserved, counted
  and settled on its own. A finished search re-executed buys nothing: it rebuilds its result
  from its `run_searches` row. Deterministic faults are fatal, never retried. So only a real
  process crash in the middle of a tile still re-buys pages, and every re-bought page is
  reserved and ledgered.
- **Why it is not implemented.** A Google page cursor is an opaque string that Google issued.
  Storing it, even for the life of one run, would add a new column of Google-issued content to
  the persistence list. `docs/legal/places-persistence.md` (the D-01 list) names exactly what may
  be stored, and this is not on it. So danlo decides under D-01 before it is built, not the code.
- **The change, if D-01 allows it** (exact shape: 04-REVIEW-FIX-partB.md, follow-up F1):
  1. `run_searches.next_page_token text`, nullable.
  2. `record_places_page` sets it from the page record; `mark_run_search` clears it at `done`.
  3. `PageRecord` carries it.
  4. `runSearchTile` resumes at page `pages_done + 1` when a token is present.
  5. It joins the D-01 enumeration, with its retention: cleared at `done`, gone with the run.
- **Also to check on the 04-32 run.** How long a page token stays valid. The in-step retry
  waits up to about 60 s; a resume after a crash could come minutes later.

### B-WR-02: the novelty rule can stop a dense core from splitting. Tune at D-04.

- The part that could be fixed without choosing a rule is fixed (`8da5d37`): the parent's
  overlap is now read only from this run's members.
- **Still open.** If the parent's top 60 sit in one quadrant, that child's own top 60 are the same
  ids, so it truncates as `novelty` while hundreds of listings stay unsearched. Ids alone cannot
  tell this apart from the service-area loop the rule exists to stop. Three options:
  - (a) count novelty over pure-SAB ids only;
  - (b) truncate only when the repeated places lie outside the child's rectangle, or have no
    location;
  - (c) compare siblings, truncating when all four children return the same set. This needs
    state across steps.
- Each option trades spend for coverage. Decide from the 04-32 / D-04 run's
  `truncated_why = 'novelty'` counts in dense cores.

### C-WR-03: keep the last good report when a live refresh fails. A structural decision.

- Done (`9af3296`): the dead `try/catch` around `router.refresh()` is removed, and the header
  says what really happens.
- **Still open.** A refresh whose server render throws still replaces the segment with
  `runs/[id]/error.tsx`, which stops polling in the middle of a run. There are two ways to fix
  it, and both change the page's structure (`notFound()`, metadata):
  - (a) a client error boundary around a child server component that does the read and keeps
    the last good children;
  - (b) a route-handler probe before each `router.refresh()`. This doubles the reads per tick
    (T-4-02).

### The free change check's 1 µUSD hold vs the monthly cap (C-WR-05 / B-IN-07)

- A change check holds one micro-dollar on `ts_essentials`, because `reserve_budget` refuses a
  zero estimate (T-2-07). Once the month's cap is spent, that hold is refused, so the free
  check is refused too.
- The copy now says so honestly (`6f58606`: `RUN_DRAWER_CHECK_NOTE`, `RUN_REFUSED_CHECK_NOTE`).
- **The decision.** Should `app.reserve_budget` exempt zero-priced `ts_essentials` holds from the
  cap comparison, while still writing the zero-cost ledger row? That changes the cap's meaning
  (a hold that is never counted), so it is danlo's call, not a review fix.

### The >2 km distance warning (C-WR-01 / C-IN-01). This would be new persisted data.

- A listing 5 km away shows no distance chip. Zero distance points covers both "beyond 2 km" and
  "location not promotable", and the stored features cannot tell the two apart.
- Warning on it again would take a new derived 0|1 feature, `beyondLastTier`, written by the
  matcher. It is integer-only, the same class as `listingLocation`. But it is a NEW persisted
  key, so it changes the `FEATURE_KEYS` allow-list, 0030's `places_features_ok` CHECK and the
  D-01 legal list. Needs danlo's decision, and the chip wording itself (C-IN-01) still needs his
  approval.

### The accented-city SAB miss (B-IN-01). Needs a folded-city column.

- The SAB trigram arm in `src/lib/places/candidates.ts` compares `lower(b.city)` with a query
  city that TypeScript has already folded. So `'peñitas' ≠ 'penitas'`, and multiple-space
  variants miss too.
- **The fix.** A folded `city_key` column on `businesses`, written by the normalizer, is compared
  instead. That is a schema change plus a backfill of the spine, so it waits for a phase that
  touches the normalizer.

### Also still open from the review's Info findings

- **A-IN-03: 3 of 4 closed.** `plan_run_searches` and `mark_run_search` lost `service_role`
  EXECUTE in 0030, and `places_transient_stats` lost it in 0031.
  `app.release_reservation(uuid)` still has it. It is one `revoke … from service_role` in the
  next migration, plus a line in the catalog test.

## From 04-32 (D-04 first real run, 2026-09-25) — see docs/measurements/04-first-run.md

- **Banner specs (Phase 2 80 %/100 % shots): RE-DEFERRED to the first billed month** (danlo,
  04-32 Task 1). The D-04 run settled at $0.00 inside the free 1,000, so committed spend stays 0
  and `budget-banner.spec.ts` keeps self-skipping.
- **Tiling constants: no change proposed** (0 truncated, depth ≤ 2 of 5). Re-measure on the first
  dense-core or food & hospitality cell.
- **Research A1/A2 — verify on the first invoice:** per-page billing and error-response billing.
  Expected Google-side total for 2026-09: 35 Text Search Enterprise (2 recording + 33 run, all
  in the LOCAL ledger) + 1 Essentials IDs-only (04-31).
- **Research A6 — measured: yes.** 9 `pure_sab` observations; SABs are returned under
  `locationRestriction` and match on real phone + name.
- **Replay limitation (not a defect):** anonymized fixtures carry 555-01xx phones, so a recorded
  SAB can score at most 50 and never matches; `places-recorded-replay.test.ts` pins 0 `pure_sab`.
  The SAB-true path stays covered by the synthetic fixture test.
- **Daily quota (D-19):** keep 100/day through Phase 6; size a raise from Phase 9's partition plan.

## From 04-33 (phase gate, screen review, 2026-09-25) — see docs/measurements/04-screens/README.md

- **Item 2a — noted, NOT taken (danlo's reply was "approved + fix 1").** The "Google Maps" tag
  also sits on our own planner data: the truncation warning's tile line ("McAllen · roofing
  contractor · tile r0") and the Tiles card. That is over-attribution — harmless under the
  attribution policy, not strictly required. Left as built; revisit only if danlo asks.
- **Noted, no action:** the chrome's org label shows the local dev `orgs.display_name`
  (`bis-…`), not "BIS" (local data, already deferred from Phase 3); the screenshot seed attached
  a restaurant to a roofing-contractor run (seed picks the first unattached businesses by id — a
  fixture artifact, not a matcher result).
- **Not re-shot:** the `run-report-partial-*` screenshots predate fix 1 (`0456186`); the fix is
  proven by its unit test, not by a new screenshot.
