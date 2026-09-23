---
phase: 4
slug: places-transient-verifier
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth for the requirement → test map and the gate mutations: `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@5.0.1` (unit + DB lanes) · **new** workflow lane with `@workflow/vitest@4.0.25` · `@playwright/test@1.63.0` e2e |
| **Config file** | `vitest.config.ts`, `vitest.db.config.ts`, **new `vitest.workflow.config.ts`** (Wave 0) |
| **Quick run command** | `cd /c/Users/danlo/prospector && $PNPM test:unit -t "<name>"` (never the `-- -t` form — it does not filter under pnpm 12) |
| **Full suite command** | `typecheck` · `lint` · `test:unit` · `test:db` · `test:workflow` · `build`, each via `$PNPM` |
| **Estimated runtime** | unit ~30 s · db ~3 min · workflow ~1 min · build ~2 min |

`$PNPM` = `node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs`

**Test layering (measured in the research spike):**
1. Pure modules (builder, tiler, host class, matcher, partition, change detection, estimate) → unit lane.
2. Step bodies → DB lane, called as plain functions inside a rolled-back transaction, msw for Places.
3. Orchestration → workflow lane: real compiled workflow, msw for Places (msw intercepts in-process), real local DB with a dedicated test org. `vi.mock` of `@/` modules does NOT reach step code.

---

## Sampling Rate

- **After every task commit:** the quick unit filter for the touched module + `typecheck`
- **After every plan wave:** `test:unit`, `test:db`, `test:workflow`, `typecheck`, `lint`, **`build`** (the build generates `.well-known/workflow` and proves registration)
- **Before `/gsd-verify-work`:** full suite green + mutations M26–M53 logged in `docs/measurements/04-gate-mutations.md`
- **Max feedback latency:** 60 seconds for the quick filter
- 🔴 Read the failing test's **name** on every filtered run — a `-t` that matches nothing exits green.

---

## Per-Task Verification Map

*Filled by the planner from each PLAN's `<automated>` verify blocks; requirement-level map is in `04-RESEARCH.md` § Phase Requirements → Test Map.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 01 | 1 | PLACE-03, PLACE-04 | T-4-01 T-4-09 T-4-14 T-4-15 | Pin the packages, allow-list their install scripts, and ignore the generated trees | build/grep | `$PNPM install --frozen-lockfile && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-01-T2 | 01 | 1 | PLACE-03, PLACE-04 | T-4-01 T-4-09 T-4-14 T-4-15 | withWorkflow, the proxy exclusion, and the workflow test lane | workflow | `$PNPM test:workflow -t "the workflow lane pins zone, locale and a fake Places key" && $PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-01-T3 | 01 | 1 | PLACE-03, PLACE-04 | T-4-01 T-4-09 T-4-14 T-4-15 | CI runs the lane, and a clean build proves the toolchain | unit | `$PNPM build && $PNPM test:unit` | W0/plan | ⬜ pending |
| 04-02-T1 | 02 | 1 | PLACE-01 | T-4-01 T-4-02 T-4-05 T-4-08 | PLACES_MODE and CRON_SECRET in src/env.ts, with the credential guard amended (watched red  | unit | `$PNPM test:unit -t "PLACES_MODE" && $PNPM test:unit -t "CRON_SECRET" && $PNPM test:unit -t "src/env.ts declares no Google variable and only the PLACES_MODE swit` | W0/plan | ⬜ pending |
| 04-02-T2 | 02 | 1 | PLACE-01 | T-4-01 T-4-02 T-4-05 T-4-08 | One shared walker that skips the generated workflow tree, adopted by all three guards | unit | `$PNPM test:unit -t "the shared walker" && $PNPM test:unit -t "no google credential is read anywhere in src" && $PNPM test:unit tests/unit/no-network.test.ts tes` | W0/plan | ⬜ pending |
| 04-03-T1 | 03 | 1 | PLACE-02, PLACE-04 | T-4-02 T-4-05 T-4-10 | host-class.ts (RED → GREEN) | unit | `$PNPM test:unit -t "host class"` | W0/plan | ⬜ pending |
| 04-03-T2 | 03 | 1 | PLACE-02, PLACE-04 | T-4-02 T-4-05 T-4-10 | partition.ts (RED → GREEN), two-zone test | unit | `$PNPM test:unit -t "partition"` | W0/plan | ⬜ pending |
| 04-03-T3 | 03 | 1 | PLACE-02, PLACE-04 | T-4-02 T-4-05 T-4-10 | change-detect.ts (RED → GREEN) | unit | `$PNPM test:unit -t "change detection" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-04-T1 | 04 | 1 | PLACE-01, PLACE-04 | T-4-02 T-4-10 T-4-12 | Table A snapshot, the named validity test (red on general_contractor), and the corrected s | unit | `$PNPM test:unit -t "every placesTypes entry is a Table A type" && $PNPM test:unit -t "the Table A snapshot is the published table" && $PNPM test:unit tests/unit` | W0/plan | ⬜ pending |
| 04-04-T2 | 04 | 1 | PLACE-01, PLACE-04 | T-4-02 T-4-10 T-4-12 | Type-aware estimate, the ceiling constant, cellKey export, and the re-pinned cost model | unit | `$PNPM test:unit -t "cost model" && $PNPM test:unit -t "the estimate can price a subset of cells" && $PNPM test:unit -t "cellKey joins cluster and unit" && $PNPM` | W0/plan | ⬜ pending |
| 04-05-T1 | 05 | 1 | PLACE-03 | T-4-02 T-4-05 T-4-10 | The geo-shape seed and its desk fetch script | build/grep | `node -e "const g=require('./src/seed/data/geo-shapes.json');if(g.units.length!==21)process.exit(1);console.log('units',g.units.length)"` | W0/plan | ⬜ pending |
| 04-05-T2 | 05 | 1 | PLACE-03 | T-4-02 T-4-05 T-4-10 | tiling.ts (RED → GREEN) | unit | `$PNPM test:unit -t "saturated" && $PNPM test:unit -t "truncated at minimum size" && $PNPM test:unit -t "pruned" && $PNPM test:unit -t "the committed geo shapes ` | W0/plan | ⬜ pending |
| 04-05-T3 | 05 | 1 | PLACE-03 | T-4-02 T-4-05 T-4-10 | reducer.ts (RED → GREEN) | unit | `$PNPM test:unit -t "the reducer enqueues children breadth-first" && $PNPM test:unit -t "failReasonOf maps only allow-listed keys" && $PNPM test:unit -t "finishV` | W0/plan | ⬜ pending |
| 04-06-T1 | 06 | 1 | PLACE-05, PLACE-02 | T-4-02 T-4-05 T-4-06 T-4-10 | Widen score.ts types and build match.ts (RED → GREEN) | unit | `$PNPM test:unit -t "places match" && $PNPM test:unit -t "a place tying two businesses at 95 goes to review" && $PNPM test:unit -t "service-area listing" && $PNP` | W0/plan | ⬜ pending |
| 04-06-T2 | 06 | 1 | PLACE-05, PLACE-02 | T-4-02 T-4-05 T-4-06 T-4-10 | candidates.ts — one bounded statement per page (RED → GREEN) | unit | `$PNPM test:unit -t "places candidate query" && $PNPM test:unit tests/unit/sql-never-normalizes.test.ts && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-07-T1 | 07 | 2 | PLACE-06, PLACE-03 | T-4-05 T-4-11 T-4-13 | run-tone.ts unions and maps, with the drift assertions | unit | `$PNPM test:unit -t "every run kind has a label" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-07-T2 | 07 | 2 | PLACE-06, PLACE-03 | T-4-05 T-4-11 T-4-13 | The Phase 4 copy section, including the settled gaps, and the UI-SPEC amendment | unit | `$PNPM test:unit -t "every stopped reason the executor can write has copy" && $PNPM test:unit -t "phase 4 copy matches the UI-SPEC copy table" && $PNPM test:unit` | W0/plan | ⬜ pending |
| 04-07-T3 | 07 | 2 | PLACE-06, PLACE-03 | T-4-05 T-4-11 T-4-13 | places-format.ts — signal sentences, host-class labels, Google chips, Maps URL | unit | `$PNPM test:unit -t "signal sentence for every host class" && $PNPM test:unit -t "google chips read the numeric features" && $PNPM test:unit -t "the maps link is` | W0/plan | ⬜ pending |
| 04-08-T1 | 08 | 1 | PLACE-06 | T-4-13 | GoogleMapsTag and its token/class | unit | `$PNPM test:unit -t "the google maps tag is exact text with translate=no" && $PNPM test:unit -t "the attribution token is painted in both themes" && $PNPM typech` | W0/plan | ⬜ pending |
| 04-08-T2 | 08 | 1 | PLACE-06 | T-4-13 | no-map guard | unit | `$PNPM test:unit -t "no map library or map embed anywhere in the app"` | W0/plan | ⬜ pending |
| 04-09-T1 | 09 | 1 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-06 T-4-07 T-4-12 | Drizzle schema for eight tables + runs extension, generated migration 0026 | build/grep | `$PNPM typecheck && $PNPM db:generate` | W0/plan | ⬜ pending |
| 04-09-T2 | 09 | 1 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-06 T-4-07 T-4-12 | Custom migration 0027 — data fix, indexes, grants, triggers, cron role, signal view; apply | db | `$PNPM db:migrate && $PNPM db:generate && $PNPM test:db -t "grants" && $PNPM test:db tests/db/event-trigger.test.ts tests/db/schema-audit.test.ts` | W0/plan | ⬜ pending |
| 04-09-T3 | 09 | 1 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-06 T-4-07 T-4-12 | The DB proofs, the shared Places fixtures, and the D-09 requirement amendment | db | `$PNPM test:db -t "place observations are append-only" && $PNPM test:db -t "authenticated cannot read place coordinates" && $PNPM test:db -t "a tentative attachm` | W0/plan | ⬜ pending |
| 04-10-T1 | 10 | 1 | PLACE-05, PLACE-01 | T-4-05 T-4-09 T-4-10 | Synthetic fixtures, the sidecar, and the README section | build/grep | `node -e "const f=n=>require('./tests/unit/msw/fixtures/'+n);const t=['places-saturated-p1.json','places-saturated-p2.json','places-saturated-p3.json'].reduce((s` | W0/plan | ⬜ pending |
| 04-10-T2 | 10 | 1 | PLACE-05, PLACE-01 | T-4-05 T-4-09 T-4-10 | The Places handler, routes, request log and sentinels, registered in the shared server | unit | `$PNPM test:unit -t "the places handler" && $PNPM test:unit -t "the places sentinels cover every google string in the fixtures" && $PNPM test:unit tests/unit/cen` | W0/plan | ⬜ pending |
| 04-11-T1 | 11 | 2 | PLACE-02, PLACE-03 | T-4-02 T-4-04 T-4-06 T-4-07 T-4-10 | Migration 0028 — five definers, grants and comments; apply locally | unit | `$PNPM db:migrate && $PNPM db:generate && $PNPM test:unit tests/unit/pg17-compat.test.ts` | W0/plan | ⬜ pending |
| 04-11-T2 | 11 | 2 | PLACE-02, PLACE-03 | T-4-02 T-4-04 T-4-06 T-4-07 T-4-10 | withCronRole and the database-access convention | build/grep | `$PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-11-T3 | 11 | 2 | PLACE-02, PLACE-03 | T-4-02 T-4-04 T-4-06 T-4-07 T-4-10 | DB proofs for the five definers | db | `$PNPM test:db -t "release_reservation" && $PNPM test:db -t "plan_run_searches" && $PNPM test:db -t "mark_run_search" && $PNPM test:db -t "the purge" && $PNPM te` | W0/plan | ⬜ pending |
| 04-12-T1 | 12 | 2 | PLACE-01, PLACE-05, BUDG-03 | T-4-01 T-4-02 T-4-05 T-4-10 | D-13 mask change, the IDs-only mask, and the one builder | unit | `$PNPM test:unit -t "fieldMaskTier" && $PNPM test:unit -t "every places request carries includePureServiceAreaBusinesses" && $PNPM test:unit -t "a page request r` | W0/plan | ⬜ pending |
| 04-12-T2 | 12 | 2 | PLACE-01, PLACE-05, BUDG-03 | T-4-01 T-4-02 T-4-05 T-4-10 | response schema, the ReservedCall brand, and the one sanctioned client | unit | `$PNPM test:unit -t "searchText" && $PNPM test:unit -t "place details is unreachable" && $PNPM test:unit -t "a failed request's outcome never contains response t` | W0/plan | ⬜ pending |
| 04-12-T3 | 12 | 2 | PLACE-01, PLACE-05, BUDG-03 | T-4-01 T-4-02 T-4-05 T-4-10 | Move the three repo guards onto client.ts (amended, never deleted) | unit | `$PNPM test:unit -t "no google credential is read anywhere in src" && $PNPM test:unit tests/unit/no-network.test.ts tests/unit/field-mask-tier.test.ts && $PNPM t` | W0/plan | ⬜ pending |
| 04-13-T1 | 13 | 2 | PLACE-04, PLACE-03 | T-4-02 T-4-10 | plan-run.ts (RED → GREEN) | unit | `$PNPM test:unit -t "a full sweep plans one root per cell and Places type" && $PNPM test:unit -t "a partition keeps only this week's cells" && $PNPM test:unit -t` | W0/plan | ⬜ pending |
| 04-14-T1 | 14 | 3 | PLACE-03 | T-4-02 T-4-05 | Extract RunStatusBadge, fix the /spend leak, add run links and kind, light Presets on /run | unit | `$PNPM test:unit -t "the run status badge is one component" && $PNPM test:unit -t "the spend view renders stopped reasons as sentences" && $PNPM test:unit -t "th` | W0/plan | ⬜ pending |
| 04-14-T2 | 14 | 3 | PLACE-03 | T-4-02 T-4-05 | RunAutoRefresh — the live refresh island with its fake-timer proofs | unit | `$PNPM test:unit -t "the live refresh" && $PNPM test:unit -t "refresh now refreshes immediately" && $PNPM test:unit -t "the live region announces only transition` | W0/plan | ⬜ pending |
| 04-15-T1 | 15 | 3 | PLACE-02, PLACE-04, PLACE-05 | T-4-04 T-4-05 T-4-06 T-4-10 | The page-record contract (TS) | unit | `$PNPM test:unit -t "page record" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-15-T2 | 15 | 3 | PLACE-02, PLACE-04, PLACE-05 | T-4-04 T-4-05 T-4-06 T-4-10 | Migration 0029 — the features guard and the three writers; apply locally | unit | `$PNPM db:migrate && $PNPM db:generate && $PNPM test:unit tests/unit/pg17-compat.test.ts` | W0/plan | ⬜ pending |
| 04-15-T3 | 15 | 3 | PLACE-02, PLACE-04, PLACE-05 | T-4-04 T-4-05 T-4-06 T-4-10 | DB proofs for the writers (records built through toPageRecord) | db | `$PNPM test:db -t "record_places_page" && $PNPM test:db -t "a rejected pair never re-attaches" && $PNPM test:db -t "record_change_check" && $PNPM test:db -t "dec` | W0/plan | ⬜ pending |
| 04-16-T1 | 16 | 3 | PLACE-01, PLACE-04 | T-4-02 T-4-03 T-4-06 T-4-12 | withWorkerOrg and the pure mode gate | unit | `$PNPM test:unit -t "ids_only refuses an Enterprise mask" && $PNPM test:unit -t "off refuses every sku" && $PNPM test:unit -t "a missing key is refused" && $PNPM` | W0/plan | ⬜ pending |
| 04-16-T2 | 16 | 3 | PLACE-01, PLACE-04 | T-4-02 T-4-03 T-4-06 T-4-12 | reservePage / settleInTx / settleOrRelease / settleInFlight | unit | `$PNPM test:unit -t "no module but the meter mints a reserved call" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-16-T3 | 16 | 3 | PLACE-01, PLACE-04 | T-4-02 T-4-03 T-4-06 T-4-12 | DB proofs for the meter (savepoint double for withWorkerOrg) | db | `$PNPM test:db -t "off mode refuses before any reservation" && $PNPM test:db -t "a run stops at 2x its estimate-high" && $PNPM test:db -t "a retried page never u` | W0/plan | ⬜ pending |
| 04-17-T1 | 17 | 3 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-07 T-4-08 | The cron route, its schedule, the desk script (M50) | unit | `$PNPM test:unit -t "the purge route" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-17-T2 | 17 | 3 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-07 T-4-08 | The transient card on /sources, its query, and the overdue rule | db | `$PNPM test:unit -t "purge overdue" && $PNPM test:unit -t "the transient card" && $PNPM test:unit -t "oldest coordinates read in days" && $PNPM test:db -t "trans` | W0/plan | ⬜ pending |
| 04-17-T3 | 17 | 3 | PLACE-02 | T-4-02 T-4-04 T-4-05 T-4-07 T-4-08 | The deployed-URL sources spec and the Places runbook | build/grep | `$PNPM typecheck && $PNPM lint && grep -c "PLACES_MODE\|CRON_SECRET\|google_daily_quota\|purge:places" docs/runbooks/places.md` | W0/plan | ⬜ pending |
| 04-18-T1 | 18 | 4 | PLACE-01, PLACE-02, PLACE-03, PLACE-05 | T-4-02 T-4-05 T-4-06 T-4-10 | runSearchTile | build/grep | `$PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-18-T2 | 18 | 4 | PLACE-01, PLACE-02, PLACE-03, PLACE-05 | T-4-02 T-4-05 T-4-06 T-4-10 | DB-lane proofs for the tile search against msw | db | `$PNPM test:db -t "no places request leaves without a reservation" && $PNPM test:db -t "no Places text reaches the database" && $PNPM test:db -t "a service-area ` | W0/plan | ⬜ pending |
| 04-19-T1 | 19 | 4 | PLACE-04, PLACE-02 | T-4-02 T-4-04 T-4-05 | runCheckTile and its DB proofs | db | `$PNPM test:db -t "a change check" && $PNPM test:db -t "an unchanged tile is not a paid-sweep candidate" && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-19-T2 | 19 | 4 | PLACE-04, PLACE-02 | T-4-02 T-4-04 T-4-05 | The anonymizer and the recorder's guards (unit-tested; the recorder is not run here) | unit | `$PNPM test:unit -t "the anonymizer" && $PNPM test:unit -t "the recorder" && $PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-20-T1 | 20 | 4 | PLACE-03, PLACE-04 | T-4-04 T-4-05 T-4-06 | run-report.ts | build/grep | `$PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-20-T2 | 20 | 4 | PLACE-03, PLACE-04 | T-4-04 T-4-05 T-4-06 | DB proofs seeded through the real writer | db | `$PNPM test:db -t "run report counts truncated tiles" && $PNPM test:db -t "run report" && $PNPM test:db` | W0/plan | ⬜ pending |
| 04-21-T1 | 21 | 4 | PLACE-02 | T-4-04 T-4-05 T-4-06 | recordListingDecision and detachListing | db | `$PNPM test:db -t "confirms a tentative listing" && $PNPM test:db -t "a listing already decided elsewhere is a conflict" && $PNPM test:db -t "detach" && $PNPM te` | W0/plan | ⬜ pending |
| 04-21-T2 | 21 | 4 | PLACE-02 | T-4-04 T-4-05 T-4-06 | The Google item kind in the review queue | db | `$PNPM test:db -t "the review queue" && $PNPM test:db -t "the google item" && $PNPM test:db tests/db/review-actions.test.ts && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-21-T3 | 21 | 4 | PLACE-02 | T-4-04 T-4-05 T-4-06 | The business-detail Google check read | db | `$PNPM test:db -t "the google check" && $PNPM test:db tests/db/provenance-render.test.ts && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-22-T1 | 22 | 5 | PLACE-03, PLACE-04, PLACE-05 | T-4-02 T-4-03 T-4-05 T-4-06 | steps.ts and workflow.ts (+ a step-safe preset-spec module) | build/grep | `$PNPM typecheck && $PNPM lint && $PNPM build` | W0/plan | ⬜ pending |
| 04-22-T2 | 22 | 5 | PLACE-03, PLACE-04, PLACE-05 | T-4-02 T-4-03 T-4-05 T-4-06 | The workflow-lane proofs (real compiled workflow, msw, local DB) | workflow | `$PNPM test:workflow -t "a saturated tile subdivides and the run completes" && $PNPM test:workflow -t "google daily quota stops the run" && $PNPM test:workflow -` | W0/plan | ⬜ pending |
| 04-23-T1 | 23 | 5 | PLACE-03, PLACE-06 | T-4-05 T-4-06 T-4-13 | The /runs/[id] route files | unit | `$PNPM test:unit tests/unit/ids.test.ts && $PNPM typecheck` | W0/plan | ⬜ pending |
| 04-23-T2 | 23 | 5 | PLACE-03, PLACE-06 | T-4-05 T-4-06 T-4-13 | RunReportView, the header and the alerts (stop / refused / failed / queued-long / truncati | unit | `$PNPM test:unit -t "the run report shows the truncation warning in every status including complete" && $PNPM test:unit -t "the run report never renders a raw st` | W0/plan | ⬜ pending |
| 04-23-T3 | 23 | 5 | PLACE-03, PLACE-06 | T-4-05 T-4-06 T-4-13 | Requests, Tiles, Outcomes and Changes cards | unit | `$PNPM test:unit -t "the requests card" && $PNPM test:unit -t "the tiles card" && $PNPM test:unit -t "the outcomes card" && $PNPM test:unit -t "the website block` | W0/plan | ⬜ pending |
| 04-24-T1 | 24 | 5 | PLACE-06, PLACE-05 | T-4-05 T-4-06 T-4-11 T-4-13 | SpineRecordCard extraction, GoogleListingCard, chips widening, and the chips contract test | unit | `$PNPM test:unit -t "the google listing card" && $PNPM test:unit -t "the tie reason names the other business" && $PNPM test:unit -t "the open-on-Google-Maps link` | W0/plan | ⬜ pending |
| 04-24-T2 | 24 | 5 | PLACE-06, PLACE-05 | T-4-05 T-4-06 T-4-11 T-4-13 | RejectDialog, the Google actions, the filter and the page | unit | `$PNPM test:unit -t "the reject trigger calls no server action until confirm" && $PNPM test:unit -t "the reject dialog" && $PNPM test:unit -t "same business on a` | W0/plan | ⬜ pending |
| 04-25-T1 | 25 | 5 | PLACE-06, PLACE-02 | T-4-04 T-4-06 T-4-11 T-4-13 | GoogleCheck card and its placement on the page | unit | `$PNPM test:unit -t "the google check" && $PNPM test:unit -t "a tentative listing shows no website sentence" && $PNPM test:unit -t "one attached listing renders ` | W0/plan | ⬜ pending |
| 04-25-T2 | 25 | 5 | PLACE-06, PLACE-02 | T-4-04 T-4-06 T-4-11 T-4-13 | DetachDialog and the never-rendered-coordinates guard | unit | `$PNPM test:unit -t "the detach trigger calls no server action until confirm" && $PNPM test:unit -t "the detach dialog" && $PNPM test:unit -t "places coordinates` | W0/plan | ⬜ pending |
| 04-26-T1 | 26 | 6 | PLACE-04, PLACE-01 | T-4-02 T-4-06 T-4-09 T-4-14 | queueRun — mode refusal, kinds, planner-sized admission, one active run, start() after com | db | `$PNPM test:db -t "queueRun" && $PNPM test:db -t "a confirmed run creates a runs row on the current version" && $PNPM test:db -t "a change check holds one micro-` | W0/plan | ⬜ pending |
| 04-26-T2 | 26 | 6 | PLACE-04, PLACE-01 | T-4-02 T-4-06 T-4-09 T-4-14 | Drawer kinds and navigation; retire PHASE4_RUN_NOTICE everywhere; the manifest proof | unit | `$PNPM test:unit tests/unit/ui-maps.test.ts && $PNPM typecheck && $PNPM lint && $PNPM build && grep -rl "placesSweep" src/app/.well-known/workflow` | W0/plan | ⬜ pending |
| 04-26-T3 | 26 | 6 | PLACE-04, PLACE-01 | T-4-02 T-4-06 T-4-09 T-4-14 | Make the e2e suite incapable of starting a run (Rules 38, 39) | build/grep | `$PNPM typecheck && grep -rn "run-confirm" tests/e2e` | W0/plan | ⬜ pending |
| 04-27-T1 | 27 | 7 | PLACE-04 | T-4-01 T-4-02 T-4-09 | RunActions, the Places-mode notice, and the other-runs card (accent by mode) | unit | `$PNPM test:unit -t "the accent goes to the first enabled run action" && $PNPM test:unit -t "exactly one element per run testid in every mode" && $PNPM test:unit` | W0/plan | ⬜ pending |
| 04-27-T2 | 27 | 7 | PLACE-04 | T-4-01 T-4-02 T-4-09 | Recent runs, the summary's report link, the page wiring and the local e2e | unit | `$PNPM test:unit -t "recent runs" && $PNPM test:unit -t "the summary links the last run's report" && $PNPM typecheck && $PNPM lint && $PNPM build` | W0/plan | ⬜ pending |
| 04-28-T1 | 28 | 8 | PLACE-06, PLACE-03 | T-4-01 T-4-09 T-4-13 | The attribution registry and the import walk (M44) | unit | `$PNPM test:unit -t "google maps attribution renders wherever a places signal renders" && $PNPM test:unit -t "every places formatter import brings the tag with i` | W0/plan | ⬜ pending |
| 04-28-T2 | 28 | 8 | PLACE-06, PLACE-03 | T-4-01 T-4-09 T-4-13 | Local-only run-report e2e (computed tag styles) and the budget-banner guard | build/grep | `$PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-28-T3 | 28 | 8 | PLACE-06, PLACE-03 | T-4-01 T-4-09 T-4-13 | Full phase gate, locally | db | `$PNPM typecheck && $PNPM lint && $PNPM test:unit && $PNPM test:db && $PNPM test:workflow && $PNPM build` | W0/plan | ⬜ pending |
| 04-29-T1 | 29 | 9 | PLACE-02, PLACE-06 | T-4-02 T-4-05 | Generate the persistence enumeration from the live schema | build/grep | `grep -c "place_coordinates\|host_class\|pure_sab\|§3.2.3" docs/legal/places-persistence.md` | W0/plan | ⬜ pending |
| 04-29-T2 | 29 | 9 | PLACE-02, PLACE-06 | T-4-02 T-4-05 | danlo records the D-01 legal decision | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-29-T3 | 29 | 9 | PLACE-02, PLACE-06 | T-4-02 T-4-05 | Record the decision in PROJECT.md and STATE.md | build/grep | `grep -n "D-01" .planning/PROJECT.md` | W0/plan | ⬜ pending |
| 04-30-T1 | 30 | 10 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06 | T-4-01 T-4-02 T-4-08 T-4-09 T-4-16 | Read-only production pre-flight | build/grep | `test -f .planning/phases/04-places-transient-verifier/deferred-items.md` | W0/plan | ⬜ pending |
| 04-30-T2 | 30 | 10 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06 | T-4-01 T-4-02 T-4-08 T-4-09 T-4-16 | Approve the production migration and deploy | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-30-T3 | 30 | 10 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06 | T-4-01 T-4-02 T-4-08 T-4-09 T-4-16 | Migrate once, verify from the catalog, prove the no-op, set env, deploy, smoke, deployed e | e2e | `E2E_BASE_URL=https://siteless-iota.vercel.app $PNPM test:e2e` | W0/plan | ⬜ pending |
| 04-31-T1 | 31 | 11 | BUDG-03 | T-4-01 T-4-02 T-4-05 | Runbook steps and the second-wall card's "set" state (constant still null) | unit | `$PNPM test:unit -t "the second wall" && $PNPM typecheck && $PNPM lint` | W0/plan | ⬜ pending |
| 04-31-T2 | 31 | 11 | BUDG-03 | T-4-01 T-4-02 T-4-05 | danlo sets up Google Cloud and stores the key | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-31-T3 | 31 | 11 | BUDG-03 | T-4-01 T-4-02 T-4-05 | One free metered IDs-only call, then close BUDG-03 and deploy the card | unit | `$PNPM test:unit -t "the second wall" && grep -n "\[x\] \*\*BUDG-03\*\*" .planning/REQUIREMENTS.md` | W0/plan | ⬜ pending |
| 04-32-T1 | 32 | 12 | PLACE-03, PLACE-04, PLACE-05, PLACE-02 | T-4-02 T-4-03 T-4-05 T-4-16 | Where and what the first real run is, and the banner-spec question | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-32-T2 | 32 | 12 | PLACE-03, PLACE-04, PLACE-05, PLACE-02 | T-4-02 T-4-03 T-4-05 T-4-16 | Record anonymized fixtures, prepare the venue, and add the replay test | db | `$PNPM test:db -t "recorded fixtures replay through the tile search" && node -e "const r=require('./tests/unit/msw/fixtures/places-recordings.json');const rec=Ob` | W0/plan | ⬜ pending |
| 04-32-T3 | 32 | 12 | PLACE-03, PLACE-04, PLACE-05, PLACE-02 | T-4-02 T-4-03 T-4-05 T-4-16 | danlo starts the run and watches the report | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-32-T4 | 32 | 12 | PLACE-03, PLACE-04, PLACE-05, PLACE-02 | T-4-02 T-4-03 T-4-05 T-4-16 | Verify the run from the database, measure, restore the mode, record | build/grep | `grep -c "pure_sab\|calls_count\|truncated\|ts_enterprise" docs/measurements/04-first-run.md` | W0/plan | ⬜ pending |
| 04-33-T1 | 33 | 13 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06, BUDG-03 | T-4-05 T-4-16 | Run M26–M53 and log them | build/grep | `grep -c "^| M[2-5][0-9]" docs/measurements/04-gate-mutations.md && git diff --stat -- src drizzle` | W0/plan | ⬜ pending |
| 04-33-T2 | 33 | 13 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06, BUDG-03 | T-4-05 T-4-16 | Both-theme screenshots of the real screens on the built app | build/grep | `ls docs/measurements/04-screens/*.png | wc -l` | W0/plan | ⬜ pending |
| 04-33-T3 | 33 | 13 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06, BUDG-03 | T-4-05 T-4-16 | danlo reviews the screens | manual | `human checkpoint` | n/a | ⬜ pending |
| 04-33-T4 | 33 | 13 | PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06, BUDG-03 | T-4-05 T-4-16 | Close 04-VALIDATION | build/grep | `grep -n "nyquist_compliant: true" .planning/phases/04-places-transient-verifier/04-VALIDATION.md` | W0/plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Gate Mutations (M26–M53)

Listed verbatim in `04-RESEARCH.md` § Gate mutations. Each: apply, run the named test, confirm it goes red **by name**, revert, `git diff` clean.

---

## Wave 0 Requirements

- [ ] Install `workflow@4.8.9`, `@workflow/vitest@4.0.25`; `allowBuilds` entries for `@swc/core`, `cbor-extract`; prove `install --frozen-lockfile` + `build`
- [ ] `next.config.ts` → `withWorkflow`; `proxy.ts` matcher excludes workflow internals; ignore `src/app/.well-known/workflow/**` in `.gitignore`/`.prettierignore`/ESLint and in the source-walking tests (`field-mask-tier`, `no-network`, `no-google-credential`)
- [ ] `vitest.workflow.config.ts` + `test:workflow` script + CI step in the `db` job
- [ ] msw Places handler (RegExp path — a string path containing `places:searchText` is parsed as a route param) + **anonymized** synthetic fixtures (D-20) with a sidecar marker: 3-page saturated set, empty tile, SAB listing, `business.site` listing, tie pair, daily-quota 429, per-minute 429, 400 `INVALID_ARGUMENT`, 503
- [ ] `src/lib/places/place-types.ts` Table A snapshot; geo-shapes seed + desk fetch script
- [ ] DB fixtures for the new tables; worker/cron-role savepoint doubles for the DB lane
- [ ] `clusters.json`: remove `general_contractor` (test watched red first)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legal checkpoint recorded before the first real call | D-01 | Human decision (counsel or danlo's written call) | PROJECT.md Key Decisions entry enumerating everything that persists (D-05, D-10, D-13, D-20, D-21) |
| GCP project, Places API (New), billing, 100/day quota, API-restricted key | BUDG-03 / D-03 | danlo clicks in the GCP console | Runbook `docs/runbooks/google-quota.md`; Claude verifies with one free IDs-only call |
| First real run (one city × one cluster) proves saturation, subdivision, SAB inclusion, TTL purge on real density | D-04 / PLACE-03/05 | Needs the real key + legal gate | Run from the deployed app; inspect the run report and `/sources` Places row |
| First invoice confirms per-`pageToken` billing | Pricing assumption (MEDIUM) | Billing data only | Compare GCP billing SKU counts to the ledger |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
