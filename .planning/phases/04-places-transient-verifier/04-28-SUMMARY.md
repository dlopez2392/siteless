---
phase: 04-places-transient-verifier
plan: 28
subsystem: ui-verification
tags: [PLACE-06, PLACE-03, attribution, google-maps, rule-28, rule-29, e2e, budget-guard, phase-gate]
requires:
  - phase: 04-08
    provides: GoogleMapsTag + the painted --google-attribution token
  - phase: 04-17
    provides: /sources TransientCard (registered here as a NON-Places negative control)
  - phase: 04-23
    provides: TilesCard / OutcomesCard / ChangesCard / RequestsCard, /runs/[id]
  - phase: 04-24
    provides: GoogleListingCard ([data-testid="review-google-listing"][data-places-content])
  - phase: 04-25
    provides: GoogleCheck + tests/unit/fixtures/google-check.ts MIXED
  - phase: 04-27
    provides: preset-recent-runs / preset-run-row-{id}
provides:
  - "tests/unit/google-maps-attribution.test.tsx: PLACES_SIGNAL_SURFACES registry (8 surfaces) + NOT_PLACES_SURFACES (2) + the places-format import walk"
  - "tests/e2e/runs.spec.ts: local-only run-report e2e pinning the tag's COMPUTED colour and font in both themes"
  - "tests/e2e/budget-banner.spec.ts: aRunIsLive() guard — the cap-lowering tests skip while a run is queued/running"
affects: [04-29, 04-30, 04-31, 04-33]
tech-stack:
  added: []
  patterns:
    - "Registry test: each Places container is named by the surface whose selector owns it; an unclaimed container or a loose tag is itself a failure"
    - "e2e seeds through the shipped SECURITY DEFINER writers under the tenant's claims, in one transaction committed only once the run is terminal"
    - "Append-only rows removed in teardown under a transaction-local session_replication_role = replica, FK enforcement restored for every other delete"
key-files:
  created:
    - tests/unit/google-maps-attribution.test.tsx
    - tests/e2e/runs.spec.ts
  modified:
    - tests/e2e/budget-banner.spec.ts
key-decisions:
  - "Registry holds 8 surfaces, not the plan's 7: attached listing rows are registered separately from the signal row so a failure names them"
  - "The /sources transient card and the run Requests card are NOT_PLACES_SURFACES: they must carry no [data-places-content] and no tag (the transient card shows counts of what Siteless holds, never a Places value)"
  - "runs.spec ledger rows settle at 0 µUSD so the local meter's spent total never moves"
  - "place_observations (append-only even for the owner) are deleted in teardown under set local session_replication_role = replica, for that one statement's transaction only"
requirements-completed: [PLACE-06, PLACE-03]
duration: ~40min
completed: 2026-09-23
---

# Phase 4 Plan 28: Attribution registry, painted-tag e2e and the phase gate Summary

**A registry test now renders every Places-signal surface and fails, naming the surface, if any `[data-places-content]` container holds anything other than exactly one Google Maps tag. An import walk forces every `places-format` importer to import `GoogleMapsTag`. A local-only e2e renders a real run report, seeded through the shipped writers, and pins the tag's computed colour in both themes (`rgb(94, 94, 94)` light, `rgb(255, 255, 255)` dark) and its Roboto stack. The two budget-banner tests that lower the production cap now skip while a run is live. The full phase gate is green.**

## Performance

- **Duration:** about 40 min (23:36Z to 00:00Z, plus reading)
- **Tasks:** 3 of 3. Tasks 1 and 2 each have a commit. Task 3 is the gate and changed no files.
- **Files:** 2 created, 1 modified

## Task Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | `7e4c2ab` | test(04-28): the Google Maps attribution registry and the places-format import walk |
| 2 | `e3a0685` | test(04-28): local-only run-report e2e with painted tag styles, and the live-run cap guard |
| 3 | none | The gate only. No file changed. |

## Task 1: the registry and the import walk

**File:** `tests/unit/google-maps-attribution.test.tsx`, in the dom lane.

**`google maps attribution renders wherever a places signal renders`**
- `PLACES_SIGNAL_SURFACES` holds 8 surfaces:
  - business detail: signal row, attached listing rows, pending (tentative) row, check-history rows (the toggle is clicked open first);
  - the review Google listing card;
  - the run report's Tiles, Outcomes and Changes cards.
- The fixtures:
  - The business surfaces render `GoogleCheck` with `MIXED` from `tests/unit/fixtures/google-check.ts`.
  - The review card is a `GoogleListingView` fixture.
  - The run cards use a hand-built, fully typed `RunReport`.
- In every render:
  - each `[data-places-content]` holds exactly one `google-maps-attribution`;
  - the surface's own containers exist (at least 1) and each one is `[data-places-content]`;
  - a container that no registered surface claims fails as `UNREGISTERED`;
  - a tag outside any container fails.
- Failures are collected and **named by the owning surface**.
- `NOT_PLACES_SURFACES` are the negative controls. The run `RequestsCard` (our own ledger) and the `/sources` `TransientCard` must carry no container and no tag.

**`every places formatter import brings the tag with it`**
- It walks `src/components` and `src/app` with the shared `_walk`.
- Every file whose import specifier ends in `/places-format` must import `{ GoogleMapsTag }` from `…/google-maps-tag`.
- It is two-sided: more than 50 files walked, at least 3 importers, and `google-check.tsx`, `google-listing-card.tsx` and `outcomes-card.tsx` pinned by path.

**Checks:**
- `grep -c "name:"` gives 13 (at least 7 required).
- Both tests are in the PASS list, read by name.

### M44 and further mutations

Method for each: apply the mutation, run `npx vitest run tests/unit/google-maps-attribution.test.tsx --reporter=verbose`, read the names, restore from a byte copy, then check `git diff --quiet src/`, which printed "reverted: src clean" every time.

**M44 (the plan's).** I removed the `<SourceTag … dateTestId="business-google-signal-date" />` (and with it the tag) from the signal row of `google-check.tsx`:
```
 × … > google maps attribution renders wherever a places signal renders
 ✓ … > every places formatter import brings the tag with it
+   "business detail · Google check signal row: business-google-signal holds 0 Google Maps tags",
      Tests  1 failed | 1 passed (2)
```
The failure names only the signal-row surface. The import test stays green because the import remains, as the plan predicted. After the revert, `git diff --stat src/` was empty.

| # | Mutation | Red (surface named) | Import walk |
|---|---|---|---|
| M44a | delete `<GoogleMapsTag />` in the shared `SourceTag` (google-check.tsx:123) | signal row, attached listing row (×2), pending (tentative) row | green |
| M44b | delete the history row's tag (:271) | check-history rows (opened), all 4 rows | green |
| M44c | delete the tag from `google-listing-card.tsx` | review queue · Google listing card | green |
| M44d | delete the tag from `tiles-card.tsx` | run report · Tiles card | green |
| M44e | delete the tag from `outcomes-card.tsx` | run report · Outcomes card | green |
| M44f | delete the tag from `changes-card.tsx` | run report · Changes card | green |
| M44g | add `data-places-content` to the Requests card | "Requests card (our own ledger): 1 [data-places-content] on a non-Places surface" | green |
| M44h | add an `import { hostClassLabel } from '@/lib/ui/places-format'` to `requests-card.tsx` | registry green | **red:** `"src/components/runs/requests-card.tsx"` |

**How the naming was fixed.** The first version named failures by the render they appeared in, so M44a printed each business-detail surface four times. I changed it to name the owning surface, deduplicated with a Set, and re-ran every mutation above on the final file.

## Task 2: the local-only e2e and the guard

### `tests/e2e/runs.spec.ts`

**Scope and safety.** It skips unless `TARGET_IS_LOCAL`, with the reason "two-databases trap". It never uses `getByText` and never clicks a run confirm (`grep -rn run-confirm tests/e2e` exits 1).

**Seeding (`beforeAll`).** It runs in ONE transaction on `TEST_DATABASE_URL`, after tearing down any residue from an interrupted run.
- **As the owner:**
  - a search and version, McAllen × home_services, prefixed `e2e-04-28`;
  - a `runs` row, `running`, with `ceiling_requests` 8 and the estimates.
- **As the tenant:** `set local role authenticated` with the org's real Clerk claim `{o:{id}}`. Then:
  - `app.plan_run_searches` for the tiles `r` and `r0`. The unit is namespaced `e2e-04-28/McAllen`, so no fixture tile key can collide with a real one.
  - `app.record_places_page`, fed by the real chain `toPlaceForMatch` → `decide` → `toPageRecord`:
    - attached at 97 (`business_site_dead`);
    - tentative at 85;
    - unmatched.
    - The two businesses are two of the tenant's live, unmerged businesses that have no attachment.
  - `app.mark_run_search`: `r` done, saturated and subdivided; `r0` done, saturated, and truncated with `min_size`.
  - Two `app.reserve_budget` + `app.settle_reservation` pairs at 0 µUSD.
- **Then:** `reset role`, mark the run `complete`, and COMMIT. The app never sees the run live, and there is no Workflow for it.

**Teardown (`afterAll`).** It deletes in FK order in one transaction:
- coordinates;
- observations, under `set local session_replication_role = replica`, because the append-only trigger (0027 § 9) refuses every DELETE, even from the owner;
- then, back on `origin`: outcomes, attachments, tile members, run_searches, tiles, ledger, reservations (any open hold is returned to the meter first), runs, versions, searches.

**Tests:**

| Test | What it pins |
|---|---|
| a finished run shows its status, truncation and outcomes | `run-status-badge[data-status=complete]` in `run-report-header`; `run-truncation-warning[data-count=1]`; `run-outcome-attached` / `-tentative` / `-unmatched` each `data-count=1`; `run-refresh-now` count 0 |
| the Google Maps tag is painted in both themes | Asserts `innerHeight`, `innerWidth` > 0 and `visibilityState` visible first. Switches theme through the real user menu. Exactly 2 visible tags. Computed `color` is `rgb(94, 94, 94)` light and `rgb(255, 255, 255)` dark; `font-family` matches `^"?Roboto"?,` |
| on a phone Presets is lit and the truncation toggle is a 44px target | At 390×844: `nav-presets:visible[aria-current=page]`; `run-truncation-toggle` bounding box ≥ 44px tall |
| recent runs link the finished run to its report | `/presets/{id}` → `preset-recent-runs` shows `preset-run-row-{runId}` with href `/runs/{runId}` |

**The painted-colour e2e is mutation-proven.**
- **Mutation:** I changed `.dark` `--google-attribution` from `#FFFFFF` to `#FEFEFE` in `globals.css`, rebuilt, started the server, and ran `-g "painted in both themes"`.
- **Result:** `✘ run report: the Google Maps tag is painted in both themes`, with `Expected: "rgb(255, 255, 255)" / Received: "rgb(254, 254, 254)"`.
- **Revert:** restored from a byte copy. `git diff --quiet src/` passed. The server (PID 114852) was killed by PID.

### `tests/e2e/budget-banner.spec.ts`

- **The guard.** `aRunIsLive(page)` opens `/spend`, clicks `spend-tab-by-run`, and waits for exactly one of `spend-by-run-empty`, `-table` or `-cards` to be visible, so the count is never taken before the tab paints. It then counts `:visible` `run-status-badge` elements with `data-status` of `running` or `queued`.
- **Where it runs.** Both cap-lowering tests call `test.skip(await aRunIsLive(page), 'a Places run is live; lowering the cap now could stop it (04-UI-SPEC OQ 14)')` before touching the cap. `grep -c` finds 2.
- **Unchanged:** the existing `committed <= 0` skip.
- **The guard, both ways (local server):**
  - **With a live run.** I inserted a `queued` run for the BIS org on local `siteless_test` (preset `e2e-04-28-guard`), then ran the spec with `--reporter=json`. Both tests were `skipped` with the annotation `"a Places run is live; lowering the cap now could stop it (04-UI-SPEC OQ 14)"`. Afterwards I deleted the run, version and search, and 0 runs remained.
  - **With no live run.** Both tests were skipped by the existing reason, "the meter has committed nothing…". So the guard returned false and did not mask anything.

## Task 3: the full phase gate, run locally

Run on `gsd/phase-04-places-transient-verifier` @ `e3a0685`. Branch and HEAD were printed AFTER the gate, and the tree was clean.

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | |
| `npx eslint . --ignore-pattern ".claude/**"` | 0 | |
| `npx vitest run tests/unit` | 0 | **82 files, 622 tests passed** |
| `npx vitest run --config vitest.db.config.ts --pool=forks` | 0 | **42 files, 375 tests passed** (1m31s) |
| `npx vitest run --config vitest.workflow.config.ts` | 0 | **2 files, 13 tests passed** |
| `npx next build` | 0 | `workflows build complete (8 steps, 1 workflow, time 65ms)`, `✓ Compiled successfully in 4.9s` |

**Local e2e.** I started `node node_modules/next/dist/bin/next start -p 3000` on the gate build, as PID 113968. Before starting it, I checked with `netstat` that nothing was listening on :3000. Then I ran `E2E_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/runs.spec.ts tests/e2e/preset-detail.spec.ts`. It exited 0 after 21.0s:
```
✓ [setup] auth.setup.ts › authenticate
✓ preset-detail.spec.ts › preset detail: a saved edit shows two versions and the run keeps the old one
✓ preset-detail.spec.ts › preset detail: duplicate creates a new preset at version 1
✓ preset-detail.spec.ts › preset detail: with places off, all three run actions are disabled and explained
✓ runs.spec.ts › run report: a finished run shows its status, truncation and outcomes
✓ runs.spec.ts › run report: the Google Maps tag is painted in both themes
✓ runs.spec.ts › run report: on a phone Presets is lit and the truncation toggle is a 44px target
✓ runs.spec.ts › preset detail: recent runs link the finished run to its report
8 passed (21.0s)
```
- `budget-banner.spec.ts` also ran green: 2 passed, 2 skipped as described above.
- The runs spec had already passed once, 8/8, against the pre-gate build.
- Afterwards I killed PID 113968 **by PID** (`taskkill //PID 113968 //F`) and confirmed nothing was left on :3000. Every server I started was my own `next start`, confirmed by its command line. No other node process was touched.

**Local DB left as found.**
- After every e2e run, a read-only probe showed `place_attachments`, `place_observations`, `place_coordinates`, `place_tiles`, `place_tile_members`, `run_searches`, `run_place_outcomes`, `cost_ledger`, `cost_reservations` and `runs` all at 0, which is where they started.
- The BIS org's `budget_periods` stayed at reserved 0 and spent 0.
- The 18 `e2e-17900…` searches found in the DB predate this plan and are another spec's residue. I did not touch them.

## Deviations from Plan

### Auto-fixed / adjusted

1. **[Rule 3 - Blocking] Deleting append-only observations in teardown.**
   - `place_observations` refuses DELETE even for the owner (0027 § 9, D-10), and the writer appends an observation for the attached and tentative listings. A committed e2e seed therefore could not be left "as found" any other way.
   - The fix: the teardown runs that ONE delete under a transaction-local `session_replication_role = replica` on its own connection. The local owner is a superuser, and CI never runs this file. It then restores `origin`, so every other delete is FK-checked. The final `delete from runs` would refuse if any observation or coordinate were left.
   - The wall itself is unchanged for every other session.
   - Commit: `e3a0685`.
2. **[Rule 2] The registry names by owner and carries negative controls.**
   - Added `NOT_PLACES_SURFACES` (Requests card, `/sources` transient card), the `UNREGISTERED`-container failure and the loose-tag failure.
   - 04-17's transient card was read: it shows counts of what Siteless holds and its own timestamps, never a Places value. It is registered as a surface that must carry no tag.
3. **[Rule 2] The painted-colour e2e was mutation-proven** (`#FEFEFE`, red, reverted). This goes beyond the plan: without it, a green run of a style probe would prove nothing.
4. **[Rule 2] The guard was proven with a live run and without one** (a local `queued` row, removed afterwards).
5. **[Plan wording] Ledger rows settle at 0 µUSD** (the free tier). The meter's spent total never moves, so the teardown needs no balance arithmetic.
6. **[Plan wording] Commands.**
   - I ran `npx vitest …` / `npx next …` / `npx playwright …` directly, per the repo's Windows note: `$PNPM test:unit -t` does not filter.
   - I used `next start` through `node node_modules/next/dist/bin/next`, so the recorded PID is the server itself and not an npx wrapper.
7. **[Scope] Prettier.** `prettier --write` reflowed one pre-existing statement in `budget-banner.spec.ts` (the `evaluateAll` in "is not dismissible"). I restored it by hand, so the diff holds only this plan's lines.

**Total:** 7 (none architectural).

## Notes for later plans

- **04-29+ (checkpoints):** the tree is green on `e3a0685`.
- **04-33 (screenshots):**
  - `runs.spec.ts`'s `seedFinishedRun` / `teardown` is a working template for seeding a real run locally. For a `partial` run with `exceeded_estimate`, change the final `update runs`.
  - The run must be inserted `running` for the definers, and it must be the org's only active run (`runs_one_active_per_org`).
- **The guard's residual gap (TOCTOU):**
  - A run queued between the guard's read and the cap write is not caught. The window is one page navigation.
  - A run created last month and still live is not listed by `/spend` By run (it lists this period only). `runs_one_active_per_org` plus the abandon sweeper make that rare.
- **The version-history Run buttons that ignore `PLACES_MODE`** (flagged by 04-27) are untouched here.

## Known Stubs

None.

## Threat Flags

None beyond the register:
- **T-4-13:** registry + walk + computed-style probe; M44 through M44h plus the `#FEFEFE` mutation.
- **T-4-09:** the guard, proven both ways.
- **T-4-01:** the spec self-skips unless local and uses only `TEST_DATABASE_URL`. No production credential, no deployed URL, no push, no Google request.

## Self-Check: PASSED

- FOUND: tests/unit/google-maps-attribution.test.tsx
- FOUND: tests/e2e/runs.spec.ts
- FOUND: tests/e2e/budget-banner.spec.ts (modified)
- FOUND commits: 7e4c2ab, e3a0685
