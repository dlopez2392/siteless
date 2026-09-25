---
phase: 04-places-transient-verifier
verified: 2026-09-25T17:20:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (7/7 requirements satisfied)
overrides_applied: 0
re_verification: false
deferred:
  - truth: "PLACE-04 'nightly' change detection and 'weekly' partitions run on a clock"
    addressed_in: "Phase 9"
    evidence: "Phase 9 SC1: 'Saved presets run unattended on their schedule — weekly Enterprise partitions plus nightly free change detection'. 04-CONTEXT D-16: 'PLACE-04 closes here; Phase 9 only puts them on a clock.'"
  - truth: "A change check's changed-tile verdicts drive which tiles the next Enterprise sweep buys"
    addressed_in: "Phase 9"
    evidence: "Phase 9 SC3: 'an unchanged record is not re-verified'. Phase 4 records change_verdict per tile and reports the candidate count (ChangesCard RUN_CHANGE_CANDIDATES); no run kind consumes it yet, as D-16 scoped it to 'built and tested as functions'."
  - truth: "Counsel's written answer on Maps Platform Terms §3.2.3(c) and (d)(iii)"
    addressed_in: "Phase 9 (D-01 condition)"
    evidence: "PROJECT.md Key Decisions D-01 danlo-risk-call: 'Counsel's written answer ... is required before any scheduled or recurring sweep (Phase 9) or any external customer.'"
human_verification:
  - test: "Reconcile the first Google Cloud invoice for siteless-509611 (2026-09) against the local ledger"
    expected: "35 Text Search Enterprise + 1 Text Search Essentials requests, $0 (inside the free 1,000). Confirms research A1 (each pageToken page is a separately billed request) and A2 (error responses are not billed)."
    why_human: "Needs the billing console. The meter RELEASES the hold on a non-OK HTTP response and writes no spend_ledger row (src/lib/places/meter.ts settleAttempt; drizzle/0028 release_reservation). SC5's 'lands in the ledger with its SKU' holds for every billed call only if A2 holds. The released reservation row keeps its sku, so a correction is possible."
  - test: "Open production /sources after the next 09:17 UTC tick and read the 'Google Places (transient)' card's last-purge line; or check the Vercel cron log for /api/cron/purge-places"
    expected: "A purge dated within the last 24 h (rows purged 0, since production holds no Places data), and no purge-overdue alert"
    why_human: "The orchestrator proved the route answers 401 unauthenticated in production, so CRON_SECRET is set. That Vercel Cron actually delivers the daily tick can only be seen in Vercel or on the deployed page. A skipped day is visible on /sources by design (purge-overdue)."
  - test: "danlo confirms the six fixer-chosen semantics in 04-REVIEW-FIX.md: A-WR-01, A-WR-03, A-WR-04, A-WR-09, A-WR-10, A-WR-11"
    expected: "Each one is accepted or turned into a follow-up"
    why_human: "Behaviour choices. They pass their tests, but the report marks them 'fixed (verify)'."
  - test: "danlo reviews the copy strings the executors added outside the UI-SPEC: SOURCES_TRANSIENT_PURGE_NEVER_RAN (04-17) and DETACH_ALREADY_DECIDED (04-25)"
    expected: "The wording is approved or changed"
    why_human: "Tone and wording are danlo's call. The strings are in src/lib/ui/copy.ts."
---

# Phase 4: Places Transient Verifier Verification Report

**Phase goal:** Google Places answers "does this business have a website URI?" as an authoritative, billed, transient verifier whose response is almost entirely discarded.
**Verified:** 2026-09-25T17:20:00Z, at branch `gsd/phase-04-places-transient-verifier` HEAD `15823b8` (branch and sha re-checked after each lane)
**Status:** human_needed
**Re-verification:** No. This is the initial verification.

## Goal Achievement

### Observable Truths (ROADMAP success criteria, with PLAN must-haves merged)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | A Text Search runs against a hard-coded field-mask allow-list; `fieldMaskTier()` refuses an unknown field, and Place Details is unreachable per candidate. | ✓ VERIFIED | `src/lib/budget/field-mask-tier.ts`: `PLACES_TEXT_SEARCH_FIELD_MASK` / `PLACES_IDS_ONLY_FIELD_MASK` are constants. `fieldMaskTier` throws on an empty mask and on an unknown field (`satisfies never`). `src/lib/places/request.ts` is the one builder: mask and SAB flag are module constants, and it refuses a Table B type or an inverted rectangle. `src/lib/places/client.ts` has a hard-coded origin and the single path `/v1/places:searchText`, and exports only `searchText` and `placesKeyConfigured`. The test `place details is unreachable` pins that export surface and forbids `v1/places/`, `places:get`, `placeDetails`, `:autocomplete` and `:searchNearby`. The one-module header grep lives in `field-mask-tier.test.ts`. `no-google-credential.test.ts` sanctions only client.ts. GCP: every other Places method has a daily quota of 0 (runbook, 04-31). |
| 2 | After a run, the only Places-derived data on disk is `place_id`, lat/lng younger than 30 days, and derived signals (`had_website_uri`, host class with the URL discarded at call time, the service-area flag). The TTL purge is observable, and wherever a Places-derived signal is displayed, Google attribution is displayed with it. | ✓ VERIFIED (cron delivery → human) | **Schema** (drizzle/0026): `place_observations` holds a boolean, `host_class` (CHECK-enumerated, and `po_host_class_agrees`), `sku`, `pure_sab`, `observed_at`. There is no text column for Google content. `place_coordinates` has CHECK `expires_at <= observed_at + 30 days`, and authenticated/anon have no grant (test `authenticated cannot read place coordinates`). **Call time**: `search-tile.ts` classifies `hostClass(p.websiteUri)` in memory. `toPageRecord` rebuilds every key, refuses any feature key off the allow-list, and drops `nameSim`/`distanceM`. Behind it sits 0030's `places_features_ok` CHECK. Gate mutations M36 and M45 are killed (`no Places text reaches the database`, `no step returns Places content`). Committed fixtures are anonymized: synthetic names, addresses, phones and URLs, coordinates hashed inside the searched rect, and `assertAnonymizedPage` refuses anything else. **Purge**: `/api/cron/purge-places` (bearer + `timingSafeEqual`, 503 when unset) → `app.purge_expired_place_coordinates` runs as `siteless_cron` only. `vercel.json` cron `17 9 * * *`. The /sources `TransientCard` reads `app.places_transient_stats()`. **Attribution**: the `google-maps-attribution.test.tsx` registry and its import walk. danlo approved the both-theme screen review ("approved + fix 1"). Real run: coordinate `expires_at − observed_at` = exactly 30 days on all 114 rows. |
| 3 | A search that saturates the 60-result ceiling is detected, its tile subdivided, and the run reports truncation rather than returning a silent partial. | ✓ VERIFIED | `tiling.ts`: `isSaturated` (=== 60, or page 3 served). `decideSubdivision` subdivides, or truncates on `max_depth`, `min_size` or `novelty`. `search-tile.ts` persists `saturated`, `subdivided`, `truncated` and `truncated_why` through `mark_run_search`. The run report counts truncated tiles, and `RunAlerts` shows the warning. DB tests: `a saturated tile returns its children planned`, `a saturated child that repeats its parent truncates by novelty`, `run report counts truncated tiles`, `run report lists tiles still subdividing when a run stopped at the ceiling`. M30 was killed by 6 tests. Real D-04 run: 4 saturated tiles, all subdivided, 0 truncated. |
| 4 | Pure service-area businesses appear in results, and Enterprise sweeps run over rotating weekly partitions of the (cluster × city × type) cell list while change detection uses the free IDs-Only SKU. | ✓ VERIFIED (scheduling deferred to Phase 9) | `includePureServiceAreaBusinesses: true` is a module constant in request.ts. The msw handler answers 501 without it (`places-msw.test.ts`), and M26 was killed. The SAB matching branch is in `match.ts` `scoreSab`. The real run had 9 `pure_sab` observations. `partition.ts`: FNV-1a of the cell key % 4, and the week index is taken in APP_TZ. `plan-run.ts` has `full_sweep`, `partition` and `change_check`. A change check plans `ids_only` roots only, and 0028 `plan_run_searches` refuses a mismatch (22023). `check-tile.ts` builds with `mode: 'ids_only'`. The meter's `modeAllows` blocks Enterprise in `ids_only`. The preset page offers Run, "Run this week's partition" and "Check for changes (free)". `queueRun` accepts all three kinds, and `PLACES_MODE` is checked before any transaction. |
| 5 | Every outbound Places call is reserved against the budget before it leaves and lands in the ledger with its SKU; with the cap reached, the run stops instead of calling. | ✓ VERIFIED (A2 invoice check → human) | `searchText` requires a `ReservedCall`. Only `meter.ts` mints one, pinned by the test `no module but the meter mints a reserved call`. `reservePage` runs the mode gate first, then one transaction: re-read the run under RLS, `app.reserve_budget`, bump `calls_count < ceiling_requests`, and write the in-flight cursor. A charged attempt is settled at the actual price with its SKU. A crashed attempt is settled as charged. A cap denial returns `stop/budget_cap_reached`, never a retry. Tests: `no places request leaves without a reservation` (M32 killed), `a refused reservation stops with budget_cap_reached`, `a refused reservation ends the run partial` (M33), `every Enterprise page is ledgered with its SKU`, `off mode refuses before any reservation`. Real run: 33 requests = 33 ledger rows, `ts_enterprise`, 0 open reservations. Caveat: a non-OK response is released with no ledger row, by design, on assumption A2 (see human item 1). |

**Score:** 5/5 truths verified.

### Deferred Items

| # | Item | Addressed in | Evidence |
|---|---|---|---|
| 1 | Partitions weekly and change detection nightly, on a clock | Phase 9 | SC1: "weekly Enterprise partitions plus nightly free change detection" |
| 2 | A change check's changed tiles gate the next paid sweep | Phase 9 | SC3: "an unchanged record is not re-verified" (Phase 4 records and reports `change_verdict` only) |
| 3 | Counsel on §3.2.3(c)/(d)(iii) | Before Phase 9 | D-01 risk call, PROJECT.md Key Decisions |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/budget/field-mask-tier.ts` | mask allow-list + refusing tier function | ✓ VERIFIED | Wired into request.ts (`fieldMaskTier(mask)`) |
| `src/lib/places/request.ts` | the one request builder | ✓ VERIFIED | Used by search-tile, check-tile and the recorder |
| `src/lib/places/client.ts` | the only Places caller / key reader | ✓ VERIFIED | Called by search-tile, check-tile and scripts/lib/record-pages.ts |
| `src/lib/places/meter.ts` | reserve → call → settle; ceiling | ✓ VERIFIED | Sole `mintReservedCall` caller |
| `src/lib/places/host-class.ts` | pure URL → class, URL discarded | ✓ VERIFIED | Called at call time in search-tile.ts:524 |
| `src/lib/places/page-record.ts` | allow-listed step → writer contract | ✓ VERIFIED | `persistPage` → `app.record_places_page` |
| `src/lib/places/tiling.ts`, `partition.ts`, `change-detect.ts`, `plan-run.ts`, `match.ts` | quadtree, partitions, diff, planning, matcher | ✓ VERIFIED | All imported by steps and queue-run |
| `src/workflows/places-sweep/*` | Workflow DevKit executor | ✓ VERIFIED | `start(placesSweep, …)` in queue-run.ts:426, after the commit |
| `drizzle/0026`–`0031` | 8 tables, grants, writers, purge, stats | ✓ VERIFIED | Applied locally (db lane 405 green). Production at journal 32 (orchestrator-verified) |
| `src/app/api/cron/purge-places/route.ts` + `vercel.json` cron | daily purge | ✓ VERIFIED | Tick delivery is a human item |
| `src/components/places/google-maps-tag.tsx` | attribution tag | ✓ VERIFIED | Used by 8 surfaces: GoogleCheck, GoogleListingCard, ReviewScore, Changes, Outcomes, RunAlerts, Tiles, and the places-format helpers |
| `src/app/(app)/runs/[id]/page.tsx` | live run report | ✓ VERIFIED | `getRunReport` under RLS. Reviewed on screen by danlo |
| `docs/legal/places-persistence.md` + PROJECT.md D-01 row | legal gate | ✓ VERIFIED | Re-acknowledged on 96c20f4. No change to the doc, `drizzle/` or `src/db/schema` since then |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| Preset page Run / partition / check | `queueRun` | server action, `kind` enum | ✓ WIRED |
| `queueRun` | `placesSweep` workflow | `start()` after the tx commits | ✓ WIRED |
| workflow steps | `runSearchTile` / `runCheckTile` | `{ mode: env.PLACES_MODE }` | ✓ WIRED |
| `runSearchTile` | `reservePage` → `searchText` → `persistPage` | per page, per attempt | ✓ WIRED |
| `persistPage` | `app.record_places_page` | `toPageRecord` jsonb | ✓ WIRED |
| Vercel Cron | `app.purge_expired_place_coordinates` | bearer → `withCronRole` | ✓ WIRED (delivery → human) |
| `/sources` | `app.places_transient_stats()` | `readTransientStats` → `TransientCard` | ✓ WIRED |
| `/businesses/[id]`, `/review`, `/runs/[id]` | observations / attachments | `readGoogleCheck`, `listReviewQueue`, `getRunReport` → tagged components | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| Run report | requests by SKU, tiles, outcomes | `spend_ledger`, `run_searches`, `run_place_outcomes` (run-report.ts) | Yes. The D-04 run rendered and danlo watched it | ✓ FLOWING |
| GoogleCheck (business detail) | latest signal + host class | `place_observations` / `place_attachments` (businesses.ts:762) | Yes | ✓ FLOWING |
| TransientCard | held / oldest / last purge | `app.places_transient_stats()` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks (run by the verifier, local only, no Google or production access)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Unit lane | `pnpm test:unit` | 84 files, **672 passed** | ✓ PASS |
| Workflow lane (msw, `onUnhandledRequest: 'error'`, fake key) | `pnpm test:workflow` | **22 passed** | ✓ PASS |
| DB lane (local `siteless_test`) | `pnpm test:db` | 43 files, **405 passed** | ✓ PASS |
| Types | `pnpm typecheck` | exit 0 | ✓ PASS |
| Lint | `pnpm lint` | exit 0 | ✓ PASS |

`pnpm build` was not re-run. The deployed build at `e7a059f` passed its e2e run (orchestrator), and the only `src/` diff since then is three presentation files (run-alerts, tiles-card, copy.ts), which typecheck and lint cleanly.

### Requirements Coverage

| Requirement | Description (as amended) | Status | Evidence |
|---|---|---|---|
| PLACE-01 | Text Search with a hard-coded mask; `fieldMaskTier()` refuses unknown fields; no per-candidate Place Details | ✓ SATISFIED | Truth 1 |
| PLACE-02 | Persist only `place_id`, lat/lng (30-day TTL, enforced), `had_website_uri`, host class (URL discarded), `pureServiceAreaBusiness`. Amended by 04-CONTEXT D-09/D-13, and REQUIREMENTS.md already carries the amended text | ✓ SATISFIED | Truth 2. Match `score`/`features` are integer-only derived points under D-05, on the D-01 list, and CHECK-constrained |
| PLACE-03 | Saturation detected, tile subdivided, truncation reported | ✓ SATISFIED | Truth 3 |
| PLACE-04 | Enterprise on rotating weekly partitions; change detection on the free IDs-Only SKU | ✓ SATISFIED (the clock is deferred to Phase 9) | Truth 4 |
| PLACE-05 | `includePureServiceAreaBusinesses: true` | ✓ SATISFIED | Truth 4. 9 real SAB observations |
| PLACE-06 | Google Maps attribution wherever a Places-derived signal is shown | ✓ SATISFIED | Truth 2 (registry test and import walk; screens approved) |
| BUDG-03 | GCP per-API daily quota as an independent second wall | ✓ SATISFIED | 24cf57c: `SearchTextRequest per day = 100` and every other method 0 on project siteless-509611 (danlo's D-03 setup, runbook "Recorded setup — 2026-09-24"). Verified with one metered IDs-only call |

All 7 IDs are claimed by plan frontmatter, and REQUIREMENTS.md maps no other ID to Phase 4. None is orphaned. REQUIREMENTS.md's traceability table still shows PLACE-01..06 as "Pending"; updating it is the orchestrator's job.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/lib/places/*`, `src/workflows/places-sweep/*`, the cron route, runs components | — | TODO/FIXME/console scan | clean | No logging of response content, no stubs |
| `src/lib/places/meter.ts` | settleAttempt | non-OK responses released without a ledger row | ⚠️ Warning | Rests on assumption A2. Human item 1 |
| `src/lib/places/search-tile.ts` | 0b | a crash mid-tile re-buys already-recorded pages (B-CR-02 residual; F1 waits on a D-01 decision) | ℹ️ Info | Every re-bought page is still reserved and ledgered, so SC5 holds. Costs a few requests in a rare case |

### Human Verification Required

1. **First invoice (A1/A2).** Reconcile 35 Enterprise + 1 Essentials requests at $0 for 2026-09. If Google bills error responses, the release-without-ledger path under-ledgers.
2. **Production purge tick.** Production `/sources` should show a last purge within 24 h and no overdue alert, or check the Vercel cron log for `/api/cron/purge-places`.
3. **Review-fix semantics.** Confirm A-WR-01, 03, 04, 09, 10 and 11, which the review-fix report marks "fixed (verify)".
4. **Copy strings.** Review `SOURCES_TRANSIENT_PURGE_NEVER_RAN` and `DETACH_ALREADY_DECIDED`.

These are decisions, not gaps: the remaining open items in 04-REVIEW-FIX.md "Needs decision" (F1 page token, B-WR-02 novelty, C-WR-03 keep-last-good, the C-WR-05 1 µUSD hold, the >2 km chip, the accented-city SAB miss) and the banner specs re-deferred to the first billed month. None of them contradicts a success criterion.

### Gaps Summary

No blocking gaps. The code does what the goal asks. Places answers the website question through one hard-coded Text Search path. Every request is reserved and metered, and a cap stop is clean. Only ids, 30-day coordinates and derived booleans/enums survive the call, with database walls behind the TypeScript walls. Saturation subdivides or reports truncation. SAB listings are included and matched. The real D-04 run exercised all of this on McAllen × home services. What remains needs a person: the invoice check, the production cron tick, and danlo's pending confirmations and copy approvals. The status is `human_needed`, not `passed`.

---

_Verified: 2026-09-25T17:20:00Z_
_Verifier: Claude (gsd-verifier)_
