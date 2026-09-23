---
phase: 03-free-data-spine-entity-resolution
plan: 22
subsystem: phase gate: mutations, screen review, validation contract
tags: [mutation-testing, playwright, computed-style, wcag, nyquist, resize-observer, shadcn]
requires:
  - 03-01…03-21 (every plan's tests, the four screens, the desk-run spine in the local DB)
provides:
  - docs/measurements/03-gate-mutations.md (M13–M25 + M20b/M22b/M25a/M25b, as run; the Task 2 screen review and danlo's approval)
  - docs/measurements/03-screens/ (25 PNGs + the new SIMULATED-refusal-scrolled shot)
  - 03-VALIDATION.md closed (59-row Per-Task map, nyquist_compliant true, status approved)
  - four UI fixes danlo asked for at the Task 2 checkpoint
affects:
  - src/components/review/thumb-bar.tsx (new), src/app/(app)/review/page.tsx
  - src/components/ui/sheet.tsx, src/components/app-shell/top-bar.tsx
  - src/components/business-detail/{merge-history,unmerge-dialog,detail-header}.tsx, src/server/queries/businesses.ts, src/app/(app)/businesses/[id]/page.tsx
  - src/components/flags/closed-badge.tsx (new), src/components/review/candidate-pair.tsx, src/components/business-list/business-cards.tsx, src/components/sources/attribution-block.tsx
  - src/lib/ui/copy.ts
  - .planning/phases/02-budget-governor-search-presets/deferred-items.md, .planning/phases/03-…/deferred-items.md
tech-stack:
  added: []
  patterns:
    - "Live-DB mutation harness: capture pg_indexes/pg_constraint(+comments)/role_table_grants/column_privileges/md5(pg_get_functiondef) first; revert; diff the whole capture"
    - "Restore a function from its migration with \\r stripped, verified by md5 AND length"
    - "Exact-one-match source mutator that normalises the anchor to the file's EOL (CRLF-safe)"
    - "Contrast by computed style: composite every ancestor background, normalise each CSS colour through a 1px canvas, WCAG ratio"
    - "Measured fixed-bar clearance: ResizeObserver -> in-flow spacer height (constant only as first paint)"
    - "One shared ClosedBadge, pinned by comparing class lists across every call site"
key-files:
  created:
    - docs/measurements/03-gate-mutations.md
    - docs/measurements/03-screens/*.png
    - src/components/review/thumb-bar.tsx
    - src/components/flags/closed-badge.tsx
    - tests/unit/thumb-bar.test.tsx
    - tests/unit/closed-badge.test.tsx
  modified:
    - .planning/phases/03-free-data-spine-entity-resolution/03-VALIDATION.md
    - .planning/phases/03-free-data-spine-entity-resolution/deferred-items.md
    - .planning/phases/02-budget-governor-search-presets/deferred-items.md
    - src/app/(app)/review/page.tsx
    - src/components/ui/sheet.tsx
    - src/components/app-shell/top-bar.tsx
    - src/components/business-detail/merge-history.tsx
    - src/components/business-detail/unmerge-dialog.tsx
    - src/components/business-detail/detail-header.tsx
    - src/components/review/candidate-pair.tsx
    - src/components/business-list/business-cards.tsx
    - src/components/sources/attribution-block.tsx
    - src/server/queries/businesses.ts
    - src/app/(app)/businesses/[id]/page.tsx
    - src/lib/ui/copy.ts
    - tests/e2e/touch-targets.spec.ts
    - tests/unit/unmerge-dialog.test.tsx
    - tests/unit/sources-ledger.test.tsx
    - tests/db/provenance-render.test.ts
    - tests/db/review-actions.test.ts
decisions:
  - "danlo, 2026-09-23: screens approved, with four fixes required before the phase closes (refusal clearance, sheet close 44px, key+source merge history, 14/600 Closed badge + foreground attribution heading); all four applied"
  - "The phase's test filters are `$PNPM test:x -t \"name\"`; the plans' `-- -t` form does not filter under pnpm 12 (verified: -t ran 1/42 files)"
  - "A merge side is named MERGE_SIDE(key, source) = \"SL-XXXXXX · Overture\"; display names move to a quiet second line (\"Both records are named …\" when equal)"
  - "M20 as written can never discriminate (42P10); M20b (delete the business-write gate) is the recorded discriminating form"
  - "M25b (the definer's re-point) is the variant that matches the plan's M25; M25a (the script's) is covered deterministically only by the chain test (F7, deferred with a proposed test)"
metrics:
  duration: ~3 h active across two sessions (00:15–01:05 and 04:55–05:40, with the Task 2 checkpoint between)
  completed: 2026-09-23
  tasks: 3
  files: 52
---

# Phase 3 Plan 22: Phase gate (mutations, screen review, validation sign-off) Summary

I ran thirteen gate mutations (M13–M25) plus four variants against the live local database and the source, one at a time. Each was read by test NAME and reverted, and the catalog afterwards was byte-identical to a capture taken before any mutation. None of them redded nothing. I then shot the four Phase 3 screens in both themes on the built app, measuring contrast by computed style. danlo approved the screens with four fixes; all four are applied, each watched red first, and I re-shot the screens they touched. 03-VALIDATION.md is now closed: `nyquist_compliant: true`, with a 59-row map whose 109 filters all match real tests.

## Tasks

| Task | What | Commits |
|---|---|---|
| (pre) | A ~50% flake in `a recorded merge names the true winner and loser for the toast` (a `created_at` tie) fixed before any mutation | `f8cce1a` |
| 1 | M13–M25 + M20b/M22b/M25a/M25b, logged with findings F1–F8 | `b820e6c` |
| 2 | 25 screenshots, contrast table, the two flagged items measured → danlo: **approved with four fixes** | `c7f0d29`, then `bd83587`, `f274413`, `7b00b72`, `3c89af4`, `337a35a` |
| 3 | 03-VALIDATION.md filled and signed; Phase 2 debts settled | `3dacf0d` |

## Mutation results (full log: docs/measurements/03-gate-mutations.md)

- **As predicted:** M13, M14 (via the re-tuned weights only; F1), M15, M18, M19, M22 (and its column-level twin M22b), M23.
- **More than predicted, each explained:**
  - M16: the transform's downstream pin also reds.
  - M17 and M20: `42P10` takes out every test that seeds through the shipped path (F3). M20b is the form that discriminates. `gone is not a delete` is not M20's test (F4).
  - M21: the same `decision='distinct'` row is pinned at three layers.
  - M24: the EXPLAIN index gate also reds, which is an independent guard (F8).
  - M25b: the resolve-pass twin also reds.
- **Weakest guard found:** M25a, the script's re-point. `the pass is deterministic` catches it only 2 of 6 times, depending on uuid order (F7). It is deferred with a proposed deterministic test.
- **Trap found:** restoring a function from the CRLF working-tree migration injects 105 CRs. Only the md5 check caught it (F5). Restore with `\r` stripped.

## The four fixes (danlo, Task 2)

1. **The refusal alert hid card B.** `ThumbBar` now measures the fixed bar and mirrors its height into a spacer. On the built app with a simulated refusal, scrolled to the end: card B ends at 427 and the bar starts at 443. Before the fix, card B was 184 px under the bar. Rule 20 is intact.
2. **The Sheet ✕ was 28×28.** It is now 44×44 in the shared component, named "Close" from `copy.ts`. `touch-targets.spec.ts` measures it in the phone More sheet and in a new tablet test. The spec was red at 28, then 4/4 green on the local build.
3. **The merge history read "X merged into X".** It now reads "SL-CW2K9F · Overture merged into SL-PZWZJM · Comptroller" with a names line, and the button, dialog title and toast name the loser by its key. Covered by a unit test with two same-name records and a DB test on the query's new per-side source.
4. **Badge and heading.** One `ClosedBadge` at 14/600 replaces three copies. The attribution heading is foreground, and now measures 15.2:1 light and 12.9:1 dark (it was 4.80:1 in light).

## Verification

- typecheck exit 0 · lint exit 0 · `$PNPM test:unit` **298/298** · `$PNPM test:db` **194/194** · build exit 0, on `3c89af4`. Everything after that commit is docs only.
- `tests/e2e/touch-targets.spec.ts` 4/4 against `next start` of this tree on :3122 (local DB override).
- **Not run:** `$PNPM test:e2e` against the deployed URL. The no-production rule forbids it (the suite writes presets there), and the fixes are unpushed. It is owed to CI on the phase PR, and the new `sheet-close` assertions will fail against the old deployment until this branch deploys.
- Local data untouched throughout: 7,975 pending pairs, 1,077 merges and 91,872 businesses. The last `decided_at` predates the session, and no Same/Different/Skip/Unmerge was ever pressed.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] A flaky DB test tied `created_at`.** Found at the baseline, before any mutation. `seedComptrollerSide` back-dates the Comptroller side one day, and the test back-dated the Overture side to the same instant, so a random uuid picked the winner. Fixed by back-dating two days (`f8cce1a`).

**2. [Rule 3 - Blocking] Every plan's verify command, `$PNPM test:x -- -t`, does not filter.** The map uses `$PNPM test:x -t "…"`, which does. I verified that form, and checked all 109 filters in 03-VALIDATION.md against the real names.

**3. [Rule 1 - Bug] Three stale filters in the requirement → test map matched nothing.** `no internal leak`, `no Mexican-side result`, and `external key is not a FK`, which is a DB test. All three were corrected to real names.

**4. [Rule 2 - Correctness] Dropping `businesses_location_src_fk` deletes its T-3-06 catalog comment.** Captured the comment first, re-applied it on revert, and verified it identical.

**5. Scope (danlo-directed):** the four UI fixes were added at the Task 2 checkpoint on danlo's instruction; each has its own commit and a red-first test.

**6. The Wave 0 "register in `registry.ts`" item was not done there.** 03-05 registered the internal columns in `PublicBusiness`'s `Omit` and the sentinel's key list instead. `registry.ts` lists payload builders and has none until Phase 8. I recorded this in 03-VALIDATION rather than moving anything.

### Deferred (all in `deferred-items.md` § From 03-22)

The M25a deterministic test, the function-restore rule, the local org label `bis-1790…`, the "{name} merged into {name}" line on a loser's page header, and the Chain/Merged-away badges still at 12/500.

## Known Stubs

None. The only DOM injection in this plan was in the measurement script (the SIMULATED refusal Alert, labelled as such in the file names and the log), never in shipped code.

## Threat Flags

None. No new endpoint, auth path or trust-boundary change. The merge-history query now also returns `businesses.primary_source` for the two sides of a merge the caller can already read under RLS. It is a source key, already rendered as a source tag elsewhere on the same screen.

## Self-Check: PASSED

- Files present: `docs/measurements/03-gate-mutations.md`, 26 PNGs in `docs/measurements/03-screens/` (incl. `review-phone-light-SIMULATED-refusal-scrolled.png`), `src/components/review/thumb-bar.tsx`, `src/components/flags/closed-badge.tsx`, `tests/unit/thumb-bar.test.tsx`, `tests/unit/closed-badge.test.tsx`.
- Commits present: `f8cce1a`, `b820e6c`, `c7f0d29`, `bd83587`, `f274413`, `7b00b72`, `3c89af4`, `337a35a`, `3dacf0d`.
- Acceptance: `grep -n "nyquist_compliant: true"` matches; `grep -c "_pending_"` = 0; 59 map rows; `vercelignore` struck in the Phase 2 file with 03-01 named; the catalog diff was empty after the last revert.
