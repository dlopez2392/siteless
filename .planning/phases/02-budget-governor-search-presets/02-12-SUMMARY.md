---
phase: 02-budget-governor-search-presets
plan: 12
subsystem: ui
tags: [next16, react19, shadcn, radix, vaul, sonner, drizzle, postgres, playwright, vitest, tailwind4]

# Dependency graph
requires:
  - phase: 02-09
    provides: queueRun / duplicatePreset server actions, getPreset + readPreset with live usedByRuns, resolveSpec, specInputOfVersion
  - phase: 02-10
    provides: the (app) shell, requireOrg/orgClaims, BudgetBanner, radius tokens, tests/e2e/auth.setup.ts
  - phase: 02-07
    provides: src/lib/ui/run-tone.ts (RUN_LABEL) and src/lib/ui/copy.ts (RUN_REFUSED, PHASE4_RUN_NOTICE)
  - phase: 02-05
    provides: app.reserve_budget - a full cap is a ZERO-ROW denial, not an exception
provides:
  - "/presets/[id] - the preset detail screen, server-rendered inside the 02-10 shell"
  - "Version history with a concrete diff sentence per version and a live count(*) of the runs still pointing at it (SRCH-03 / D-16)"
  - "describeVersionDiff - a pure, server-safe diff module with five named tests, each mutation-checked"
  - "Duplicate dialog creating a new preset at version 1, pre-named Copy of {name} (D-17)"
  - "Run drawer taking a REAL budget reservation, with the 100% refusal rendered as a persistent destructive Alert (BUDG-02 criterion 5)"
  - "tests/e2e/preset-detail.spec.ts - three specs, all executed green against a built server"
affects: [02-11 preset editor, 02-13 spend and budget settings, 02-15 deployed e2e, phase-04 places verifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One withOrg transaction per screen, composed from the tx-taking read* helpers; never a nested withOrg (max:1 pool deadlocks)"
    - "A timestamptz read through raw tx.execute is a STRING - normalise to a Date at the screen boundary before any Intl call"
    - "A JS array in a drizzle sql template expands to N placeholders; bind a Postgres array LITERAL as one param instead"
    - "Client dialogs receive pre-formatted strings as props from the server; no client module exports data into a server component"
    - "Desk/phone dialog choice is a mounted branch (useIsDesk), never two copies hidden by CSS, so a testid never matches twice"
    - "Counts that a test asserts on are published as a data-* attribute; the sentence beside them stays free to be reworded"

key-files:
  created:
    - src/app/(app)/presets/[id]/page.tsx
    - src/components/preset-detail/version-diff.ts
    - src/components/preset-detail/summary-card.tsx
    - src/components/preset-detail/version-history.tsx
    - src/components/preset-detail/run-drawer.tsx
    - src/components/preset-detail/duplicate-dialog.tsx
    - tests/unit/version-diff.test.ts
    - tests/e2e/preset-detail.spec.ts
    - .planning/phases/02-budget-governor-search-presets/deferred-items.md
  modified:
    - src/server/actions/duplicate-preset.ts

key-decisions:
  - "The refusal Alert renders the action's own message (RUN_REFUSED built server-side from the cap the database refused against) rather than re-deriving the sentence from a cap the client only believes it knows"
  - "No run-status badge on the summary card: RUN_TONE maps `running` to accent-outline and the Current version badge is the only accent badge in the product, so the last run's status renders as its RUN_LABEL word"
  - "The single-version Empty state sits BENEATH version 1's row rather than replacing it - hiding the only row would delete SRCH-03's answer in order to explain that there is one of it"
  - "The run CTA is ONE element in the DOM, moved between the desk title row and the phone sticky bar by CSS, so Executor Rule 10 holds literally"
  - "savePresetVersion's identical array defect was reported to deferred-items.md rather than fixed, because 02-11 holds that file in a parallel worktree"

patterns-established:
  - "Pure diff module, no directive, no I/O: names in, clauses out - so it is testable without a database and safe to import from a server component"
  - "Two-sided diff assertions: every test also asserts what must NOT appear, so a diff that reported everything cannot pass"
  - "e2e teardown gives the budget hold back in the same statement that deletes the reservation row, or the meter strands and 23514s for every tenant"

requirements-completed: [SRCH-03, SRCH-04, BUDG-02]

# Metrics
duration: 165min
completed: 2026-09-22
---

# Phase 2 Plan 12: Preset Detail, Version History and the Run Drawer Summary

**`/presets/[id]` renders a version table whose "What changed" cell is a real sentence ("Added Auto & retail · Added Donna") beside a live `count(*)` proving a finished run still points at the version that produced it — and a run drawer that takes a genuine `app.reserve_budget` hold, so the 100 % refusal is a persistent Alert a human can read rather than a test assertion.**

## Performance

- **Duration:** ~165 min
- **Tasks:** 2
- **Files created:** 9 · **modified:** 1
- **Worktree:** `C:\Users\danlo\prospector\.claude\worktrees\agent-a917ec3ba235901ad`
- **Branch:** `worktree-agent-a917ec3ba235901ad` (base `ea296e1`)

## Accomplishments

- **SRCH-03 is now visible, not just true in the database.** Three versions side by side, each with a concrete diff sentence, and `1 run` against version 1 while versions 2 and 3 read `No runs yet`.
- **BUDG-02 criterion 5 is reachable from a browser.** "Run this preset" inserts a `queued` run and takes a real hold; spending the cap makes the confirm button *disappear* and a destructive Alert take its place, stating that nothing was charged and offering a way out. Screenshotted in both themes at both viewports.
- **D-17 works for the first time.** `duplicatePreset` had never succeeded once — see Deviation 2.
- **Two latent 500-class defects in already-shipped code were found and fixed/reported**, both invisible to typecheck, lint, build and the existing suites.

## Task Commits

1. **Task 1: detail page, summary card, version history, pure diff + its test** — `6c633c5` (feat)
2. **Task 2: duplicate dialog, run drawer with the real reservation, e2e spec** — `3f7aced` (feat)

**Plan metadata:** see the final `docs(02-12)` commit.

## Verification — actual command output

All through the pnpm 12.5.1 store launcher.

| Gate | Result |
|---|---|
| `pnpm typecheck` | `$ tsc --noEmit` — exit 0, no output |
| `pnpm lint` | `$ eslint .` — exit 0, no output |
| `pnpm test:unit` | **18 files, 72 tests passed** |
| `pnpm build` | ✓ compiled; `ƒ /presets/[id]` present in the route table |
| `pnpm test:e2e` (full suite) | **12 passed, 2 skipped, 0 failed** |

`pnpm verify` was not used — it shells out to bare `pnpm`, which is the wrong global 11.9.0 on this machine.

### `pnpm test:unit -t "version diff"` — all five, by name

```
✓ |node| tests/unit/version-diff.test.ts > version diff: added and removed clusters read as a sentence
✓ |node| tests/unit/version-diff.test.ts > version diff: a geography kind change is named on both sides
✓ |node| tests/unit/version-diff.test.ts > version diff: units added and removed within the same kind
✓ |node| tests/unit/version-diff.test.ts > version diff: a radius change names both the old and the new value
✓ |node| tests/unit/version-diff.test.ts > version diff: version 1 reads Created
Test Files  1 passed | 17 skipped (18)
     Tests  5 passed | 67 skipped (72)
```

The file was watched **failing first** (module did not exist), then mutation-checked. Five mutations, each killing exactly one test **by name** and leaving the other four green:

| Mutation | Test that went red |
|---|---|
| drop the cluster `Removed` clause | `added and removed clusters read as a sentence` |
| label `counties` as `Counties` | `a geography kind change is named on both sides` |
| compare unit lists by length, not value | `units added and removed within the same kind` |
| print only the new radius | `a radius change names both the old and the new value` |
| return `[]` instead of `['Created']` | `version 1 reads Created` |

Restored from backup afterwards; `grep -c MUTANT version-diff.ts` = 0.

### Acceptance-criteria greps

| Check | Result |
|---|---|
| `version-diff.ts` has `Added `/`Removed `/`Geography changed from`/`Created` | 7 / 6 / 1 / 1 |
| `version-diff.ts` carries a `"use client"` directive | **no** — the only occurrence is prose on line 4 of the doc comment; the file starts `/**` |
| `version-history.tsx` has `No runs yet`, `version-row-`, `Run version`, `Duplicate from version` | 2 / 4 / 1 / 2 |
| `grep -c usedByRuns version-history.tsx` | 4, and no stored-counter column anywhere in the path |
| hand-rolled surfaces (`bg-card`/`rounded-*`/`border border-` on a raw `div`) | **none** |
| `grep -rc 'variant="default"'` on page + summary-card | `page.tsx:1`, `summary-card.tsx:0` — one accent CTA, one DOM element |
| `page.tsx` contains `notFound` | yes (lines 134, 167) |
| `run-drawer.tsx` has `run-confirm`/`run-refused`/`budget_refused`/`Reserve budget & queue this run`/`Not now`/`PHASE4_RUN_NOTICE` | 2 / 3 / 1 / 1 / 1 / 2 |
| `duplicate-dialog.tsx` has `Create the copy`/`Keep this preset as is`/`duplicate-confirm`/`Copy of` | 1 / 2 / 1 / 3 |
| generic labels (`"Cancel"`, `>Cancel<`, `"Save"<`, `"OK"`) | **0 files** |
| `from 'motion'` under `preset-detail/` | **0 files** |

### The toast is on the success branch only — the two line numbers

`src/components/preset-detail/run-drawer.tsx`:

- **line 160 — `toast(\`Run queued for ${presetName}\`)`**, inside `if (result.ok) {` (line 157). The only `toast(` call in the file; the other occurrence, line 48, is prose in the header comment.
- **line 237 — `<Alert … data-testid="run-refused">`**, rendered from `if (result.code === 'budget_refused')` (line 168), which only calls `setOutcome({ kind: 'refused', … })`. No `toast(` appears anywhere in that branch.

The confirm button is **replaced** by the Alert rather than disabled beside it — a greyed control under a red message invites a second click at a cap that has not moved.

## e2e: which specs EXECUTED, and which were only listed

🔴 **Local smoke against a locally built server.** `next build && next start -p 3112`, `E2E_BASE_URL=http://localhost:3112`, the local `siteless_test` database and the Clerk **dev** instance (`pk_test_`). `.env.local`'s `SUPABASE_DB_POOL_URL` resolves to `localhost:5432/siteless_test`, so **nothing here touched production**. The authoritative run is plan 02-15's against the deployed URL.

Every spec below **executed**; none was merely listed.

```
✓  1 [setup] › auth.setup.ts › authenticate (2.4s)
✓  2 [chromium] › budget-banner.spec.ts › budget banner: absent under 80 percent (1.3s)
-  3 [chromium] › budget-banner.spec.ts › budget banner: renders on every route at 80 percent
-  4 [chromium] › budget-banner.spec.ts › budget banner: is not dismissible
✓  5 [chromium] › no-access.spec.ts › a signed-out visitor never reaches the org-scoped shell (678ms)
✓  6 [chromium] › no-access.spec.ts › /no-access renders the invite-only message (745ms)
✓  7 [chromium] › preset-detail.spec.ts › a saved edit shows two versions and the run keeps the old one (1.1s)
✓  8 [chromium] › preset-detail.spec.ts › duplicate creates a new preset at version 1 (1.4s)
✓  9 [chromium] › preset-detail.spec.ts › run this preset queues a run (1.3s)
✓ 10 [chromium] › signed-in.spec.ts › signs in and is org-scoped (703ms)
✓ 11 [chromium] › theme-tokens.spec.ts › the accent resolves in light (1.3s)
✓ 12 [chromium] › theme-tokens.spec.ts › the accent resolves in dark (1.2s)
✓ 13 [chromium] › theme-tokens.spec.ts › the page background matches the painted token (1.8s)
✓ 14 [chromium] › touch-targets.spec.ts › every primary control clears 44px at 390x844 (1.3s)

2 skipped · 12 passed
```

The two skips are **pre-existing and not mine**: `budget-banner.spec.ts` skips itself when `/settings/budget` is absent, and that screen is plan 02-13's. Documented the same way in 02-10's summary.

**Dependency noted:** `preset detail: run this preset queues a run` was specified to assert a row on `/spend` → By run. `/spend` is 02-13's and is a placeholder on this branch, so — as the plan permits — it asserts instead that the drawer closed and that **version 2's `Used by` count went 0 → 1 while version 1's stayed at 1**. That is the stronger assertion: it names *which* version the run attached to, which the spend view does not show.

**Fixture honesty:** the two-version starting preset is inserted with SQL, because the preset editor is 02-11's and is not on this branch. Everything actually under test — the duplicate and the run — goes through the real server actions via the real UI. When 02-11 lands, the fixture should be rebuilt through the editor and the helper deleted; this is stated at the top of the spec.

## Screenshot inventory — the BUILT app, both themes, both viewports

16 screenshots, `test-results/shots/` (gitignored; the worktree is destroyed on return, so the inventory and the probes are recorded here rather than the binaries). Each was captured with a **computed-style probe** so the theme is proven rather than assumed — `getComputedStyle(document.body).backgroundColor`:

- light → `rgb(244, 246, 247)` · dark → `rgb(14, 20, 22)` — two distinct painted values, so no screenshot was taken in the wrong theme.

| Screenshot | 390×844 | 1280×800 | Shows |
|---|---|---|---|
| `detail-3versions-{desk,phone}-{light,dark}` | ✅ | ✅ | Three versions; diffs read `Added Auto & retail · Added Donna`, `Removed Food & hospitality`, `Created`; `1 run` on v1 and `No runs yet` on v2/v3; the `Current` accent-outline badge on v3 only |
| `detail-1version-{desk,phone}-{light,dark}` | ✅ | ✅ | Single-version preset: `Version 1 is the only version so far` Empty beneath the real row; phone shows the full-width `Edit preset` under the summary card and the sticky `Run this preset` bar above the 64px tab bar |
| `run-drawer-normal-{desk,phone}-{light,dark}` | ✅ | ✅ | Dialog on desk / vaul bottom sheet on phone; estimate as a range (`18 – 54 requests`), `Budget left this month $50.00 of $50.00`, confirm, and the Phase-4 notice directly beneath it |
| `run-drawer-refused-{desk,phone}-{light,dark}` | ✅ | ✅ | **Confirm button gone**, destructive Alert reading "This run was refused. Your $50.00 cap is spent, so Siteless didn't call anything and nothing was charged.", `Raise the monthly cap` as the way out, Phase-4 notice and `Not now` still present, and the shell's 100 % banner behind the dialog |

**How the refused state was driven, and restored.** `/settings/budget` is 02-13's and not on this branch, so the cap was spent directly: a **separate pre-flight read** recorded `budget_periods` (`1ee3e1bd-1ade-42d9-be7c-805364e589df`, cap `50000000`, spent `0`, reserved `0`), then `spent_micro_usd = cap_micro_usd`. That leaves zero headroom, so `app.reserve_budget`'s conditional UPDATE grants nothing and returns a NULL `reservation_id` — the **real** refusal path, not a simulated one. `spent_micro_usd` was restored in a `finally` and **re-read to confirm**: `cap 50000000, spent 0, reserved 0`.

## Database left as found

Pre-flight and post-flight both: `cap 50000000, spent 0, reserved 0`; `cost_reservations` 0 rows; zero leftover `searches` matching any prefix this plan used. No migration, no seed, no schema change.

🔴 **One residue was created and corrected.** The e2e teardown initially deleted `cost_reservations` rows without giving the hold back, stranding `reserved_micro_usd` at `2` (two 1 µUSD holds from two queued runs). Corrected by a *targeted* `reserved_micro_usd - 2 where reserved_micro_usd >= 2` after confirming zero open reservations, so a concurrent agent's reservation could not be clobbered; re-read to confirm `0`. **The teardown itself was then fixed** to decrement and delete in one statement — see Issues, because the same desync broke this suite from the other direction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `RangeError: Invalid time value` 500'd the entire preset detail page**

- **Found during:** Task 2, by the **first real e2e run** — not by reading code, and not by any gate.
- **Issue:** `tstz` declares `mode: 'date'`, but that mapping is applied by drizzle's *column mapper*, which only runs for query-builder results. Every read in `src/server/queries/` is raw `tx.execute(sql\`…\`)`, so `created_at` actually arrives as postgres.js text — `2026-09-22 11:49:28.864085-05` — while `PresetVersionRow.createdAt` is **declared `Date`**. `Intl.DateTimeFormat.format()` coerces a string with `Number()`, gets `NaN`, and throws. typecheck, lint and build were all green on the mismatch because nothing checks a cast. This screen is simply the first to *format* one.
- **Fix:** `instantOf()` in `page.tsx` normalises to strict ISO (space → `T`, `-05`/`-0500` → `-05:00`) before `new Date`, and throws a named error rather than substituting a fallback instant — a NOT NULL column that will not parse means the driver contract changed, and rendering the epoch would be the product lying about when a run happened. Deliberately *not* `new Date(raw)`: V8 happens to parse that form, but a non-ISO string's handling is implementation-defined.
- **Scope:** fixed at **this page's** boundary, not in the shared `src/server/queries/presets.ts`, which 02-11 and 02-13 hold open in parallel worktrees.
- **Verification:** diagnosed by instrumenting both call sites and reading the server log (`DIAG createdAt string false …`); page renders and all three specs pass.
- **Committed in:** `3f7aced`

**2. [Rule 3 — Blocking] `duplicatePreset` could never succeed — D-17 was 100 % broken**

- **Found during:** Task 2, by the e2e spec pressing "Create the copy".
- **Issue:** A JS array inside a drizzle `sql` template is expanded into a comma-separated **placeholder list** (that is how `in (…)` works), so `${source.cluster_ids}::uuid[]` reached Postgres as `($2, $3)::uuid[]` — a ROW constructor cast to an array. Measured against this database at every arity: **2+ clusters → `42846 cannot cast type record to uuid[]`; 1 cluster → `22P02 malformed array literal`**. There is no arity at which it works. The action's `catch` maps the SQLSTATE to `unexpected`, so the UI said "Something broke on our side" and nothing ever named an array problem — which is why it shipped green.
- **Fix:** bind the Postgres array **literal** as a single parameter and cast once. It is a bound parameter, not interpolated SQL, and every element is a uuid read from the same table, so there is no quoting or injection surface.
- **Files modified:** `src/server/actions/duplicate-preset.ts` (outside this plan's `files_modified` — unavoidable: the plan's own done-criterion is that duplicate creates a preset at version 1).
- **Verification:** `preset detail: duplicate creates a new preset at version 1` goes green; the copy appears at version 1 with the single-version Empty state.
- **Committed in:** `3f7aced`

### Reported, deliberately NOT fixed

**3. [Out of scope] `savePresetVersion` has the identical array defect**

`src/server/actions/save-preset-version.ts` uses the same `${resolved.clusterIds}::uuid[]`, so **no preset version can be saved through it at all** — which is plan 02-11's entire critical path. Not fixed here because 02-11 holds that file in a parallel worktree and two worktrees editing one line is precisely the conflict this partitioning exists to prevent. Recorded in **`deferred-items.md`** with the measured SQLSTATEs and the exact patch. 🔴 **This needs a central fix before 02-11 can be believed green.**

### Minor, within the plan's own latitude

- **`RUN_REFUSED(formatUsd(cap))`** in the plan text does not match source: `copy.ts` exports `RUN_REFUSED(capMicroUsd)` and formats internally, and `queueRun` already returns the built sentence in `result.message`. The drawer renders `result.message`, so the cap quoted is the one the database actually refused against.
- **`data-used-by-count`** was added beside the `Used by` cell so the e2e asserts the *number* (SRCH-03's real claim) rather than the sentence, which is UI-SPEC copy and free to be reworded.
- **Screenshots were taken once at the end** covering both tasks, rather than separately per task, since the refused state needs the same built server.

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking) + 1 reported out-of-scope.
**Impact:** no scope creep. Both fixes were required for the plan's own done-criteria; both were pre-existing defects in shipped code that every prior gate passed over.

## Issues Encountered

- **The shared `siteless_test` database was transiently inconsistent**, and it broke the run spec for one cycle with `23514 bp_non_negative`. A concurrent agent had `budget_periods` at cap `$6.41` / spent `$5.57` (pre-flight was `$50` / `0`) with open expired `cost_reservations` behind it, so `app.reserve_budget`'s stale-reservation **self-heal** tried to drive `reserved_micro_usd` to `-5570000`. Re-running after the sibling restored the meter turned it green with no code change — exactly the "re-run it alone before believing it" rule. **This is also what taught the teardown fix above:** deleting reservation rows without returning the hold strands the total and 23514s the meter *for every tenant of the database* until someone fixes the row by hand.
- **A full cap is a ZERO-ROW denial, not a 23514.** My briefing paraphrased 02-05 as "a full cap refuses with 23514", which would have meant criterion 5's refusal was unreachable from the UI. Reading `drizzle/0016` settles it: step 2's conditional UPDATE simply grants nothing and returns a NULL `reservation_id`. `queueRun`'s own comment is correct, and the refused screenshots prove the path end to end.
- **The table is `industry_clusters`, not `clusters`** — the first e2e run failed on `relation "clusters" does not exist`. Assumption corrected against the database, which is the only thing that could have corrected it.

## User Setup Required

None. Nothing on this screen reads a Google credential (Executor Rule 14); the run drawer reserves budget and queues a row, and Phase 4 owns actually calling Places.

## Next Phase Readiness

**Ready.** `/presets/[id]` renders inside 02-10's shell, links to `/presets/{id}/edit` (02-11's) and `/settings/budget` + `/spend` (02-13's), and takes real reservations against the live meter.

**Blockers and concerns for the orchestrator:**

1. 🔴 **`savePresetVersion`'s array bug must be fixed centrally** before 02-11 is believed green — see `deferred-items.md`. 02-11's e2e may well be passing against a save that cannot work.
2. 🟠 **The timestamptz-is-a-string trap is repo-wide**, not local to this screen. `readPresets` (02-11's list, which renders "Last run {date}") and `readSpendByRun` (02-13's spend view) read timestamps the same raw way. Each will 500 the moment it formats one. The structural fix belongs in `src/server/queries/`, in one place, after the wave merges.
3. 🟠 **Two `budget-banner` specs stay skipped** until `/settings/budget` lands with 02-13; they self-enable, with no flag to remember.

## Self-Check: PASSED

All 10 claimed files exist on disk, and all three commits exist on
`worktree-agent-a917ec3ba235901ad`, rooted on the expected base `ea296e1`:

```
5a74af6 docs(02-12): complete preset detail, version history and run drawer plan
3f7aced feat(02-12): duplicate dialog and a run drawer that takes a real reservation
6c633c5 feat(02-12): preset detail with version history and a real diff sentence
ea296e1 docs(phase-02): update tracking after wave 4
```

Neither task commit deleted a tracked file (`git diff --diff-filter=D` empty for both).
`.env.local` was copied in and never staged. STATE.md and ROADMAP.md were not touched —
the orchestrator owns those after the wave merges.

---
*Phase: 02-budget-governor-search-presets · Plan 12*
*Completed: 2026-09-22*
