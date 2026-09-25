---
phase: 04-places-transient-verifier
plan: 33
subsystem: Phase 4 gate — mutations M26–M53, both-theme screen review, VALIDATION closed
tags: [gate, mutations, screenshots, validation, PLACE-01, PLACE-02, PLACE-03, PLACE-04, PLACE-05, PLACE-06, BUDG-03]
requires:
  - 04-28 (full local phase gate, runs.spec.ts seeding)
  - 04-32 (D-04 first real run; prod at journal 32, e7a059f deployed, PLACES_MODE off)
provides:
  - docs/measurements/04-gate-mutations.md — M26–M53 (+ M50b), one row each, 0 survived
  - docs/measurements/04-screens/ — 32 screenshots + README (8 states × desk/phone × light/dark)
  - 04-VALIDATION.md closed (86/86 task rows green, nyquist_compliant true, approved 2026-09-25)
  - fix 1 from danlo's review (0456186): an exceeded-estimate stop with 0 tiles mid-split points at no empty list
affects:
  - src/components/runs/run-alerts.tsx, src/components/runs/tiles-card.tsx, src/lib/ui/copy.ts (fix 1)
  - tests/unit/run-report.test.tsx (fix 1's test)
  - deferred-items.md (item 2a noted-not-taken; seed/org-label notes; partial shots not re-shot)
key-files:
  created:
    - docs/measurements/04-gate-mutations.md
    - docs/measurements/04-screens/README.md
    - docs/measurements/04-screens/*.png (32)
    - .planning/phases/04-places-transient-verifier/04-33-SUMMARY.md
  modified:
    - .planning/phases/04-places-transient-verifier/04-VALIDATION.md
    - .planning/phases/04-places-transient-verifier/deferred-items.md
    - src/components/runs/run-alerts.tsx
    - src/components/runs/tiles-card.tsx
    - src/lib/ui/copy.ts
    - tests/unit/run-report.test.tsx
decisions:
  - "danlo, Task 3, 2026-09-25 (verbatim): 'approved + fix 1'. Fix 1 made (0456186); optional item 2a (Google Maps tag on our own truncated-tile / Tiles-card data) not taken — recorded in deferred-items.md."
  - "M50's research-table pairing was wrong: the named test covers the unset-secret branch; M50b added so a mutation reds exactly that test. Recorded, not 'fixed' in the test."
  - "M32/M36 as written die on an earlier guard; their faithful forms red the named assertion. Both forms logged."
metrics:
  duration: "2026-09-25 (Tasks 1–2 automated; Task 3 danlo's review; fix 1 + Task 4 same day)"
  completed: 2026-09-25
---

# 04-33 — Phase 4 gate: mutations, screens, VALIDATION closed

Every guard in the phase went red by its named test (28 rows M26–M53 plus M50b, 0 survived). The
real screens were shot on the built app in both themes and danlo approved them with one fix,
which landed in `0456186`. 04-VALIDATION is closed.

## Task 1 — M26–M53 (`2558916`)

`docs/measurements/04-gate-mutations.md`: 28 rows, M26–M53, **0 survived**.
- 27 rows went red by the named test.
- **M50** was killed by three other purge-route tests. The research table paired it with the wrong
  test: the named test covers the unset-secret branch. **M50b** was added, and it reds exactly the
  named test.
- **M32 / M36** as written die on an earlier guard. Their faithful forms red the named assertion.
  Both forms are logged.
- Over-reds are explained as F1–F6 in the log.
- DB reverts were proven by the md5 of the saved function definitions plus a byte-identical catalog
  capture, not by "the script ran". Code mutations ended with `git diff --stat -- src drizzle`
  empty.
- Lanes after the run: unit **671**, db **405**, workflow **22**, all green.

## Task 2 — both-theme screenshots (`d127b1c`)

- 32 PNGs in `docs/measurements/04-screens/`: 8 screen states × desk (1280×800) / phone (390×844)
  × light / dark, each listed in the README with what it proves.
- Automated checks: no raw stopped-reason key on any screen; no map; every Google Maps tag painted
  `rgb(94, 94, 94)` in light and `rgb(255, 255, 255)` in dark, in Roboto.
- Seeded rows were all deleted afterwards. 12 audit `events` rows (4027359–4027370) remain, as
  `runs.spec.ts` leaves them.
- The three `next start` PIDs (23124, 96300, 123588) were stopped by PID. No Google call was made
  and production was not touched.

## Task 3 — danlo's review

danlo replied, verbatim, **"approved + fix 1"** on 2026-09-25.
- **Fix 1** (`0456186`, `fix(04-33)`): an exceeded-estimate stop with 0 tiles still subdividing no
  longer says "0 tiles … listed below". The "Show the tiles still subdividing" button and the
  empty "(0)" Tiles-card list are also gone.
  - Test `an exceeded-estimate stop with no tile still subdividing points at no empty list` was
    watched red first. Mutating the tiles-card guard reds it by name.
  - Unit lane 672 passed; `tsc` 0; `eslint` 0.
  - The `run-report-partial-*` screenshots predate the fix and were not re-shot.
- **Item 2a, optional, not taken:** the Google Maps tag on our own truncated-tile / Tiles-card
  data. Recorded in `deferred-items.md` as noted-not-taken.
- **Noted, no action:** the org label shows the local dev `bis-…` name. The fixture attached a
  restaurant to a roofing search, which is a seed artifact.

## Task 4 — 04-VALIDATION closed (`8707957`)

- Per-Task Verification Map: **86 rows — 86 ✅, 0 ⚠️, 0 ❌**, read from the SUMMARYs of
  04-01…04-32 and this plan's own commits. No `⬜ pending` remains.
- The caveats carried under the table leave no row's own check unproven: cross-plan DB-lane noise
  in 04-01/16/17, 04-02's planted-probe build proof, specs run later by 04-28/04-30, Pitfall 11
  closed by 04-26, 04-31's deploy done by 04-32, and 04-32's `pure_sab` plan-text deviation.
- Wave 0 checklist (7) and sign-off (6) are ticked. Frontmatter: `status: complete`,
  `nyquist_compliant: true`, `wave_0_complete: true`.
- Manual-only table: the first-invoice check (per-`pageToken` billing) is **still open** and
  tracked in `deferred-items.md` (research A1/A2).
- Approval: `approved 2026-09-25 — M26–M53 logged in docs/measurements/04-gate-mutations.md;
  screens approved by danlo`.

## Commits

| Task | sha | message |
|---|---|---|
| 1 | `2558916` | docs(04-33): log gate mutations M26-M53 against the live code and local DB |
| 2 | `d127b1c` | docs(04-33): both-theme screenshots of the Phase 4 screens on the built app |
| 3 (fix 1) | `0456186` | fix(04-33): an exceeded-estimate stop with nothing mid-split points at no empty list |
| 4 | `8707957` | docs(04-33): close 04-VALIDATION — 86/86 task rows green, Wave 0 and sign-off ticked |

## Deviations from Plan

- **M50 / M50b and M32 / M36:** see Task 1. The research table's pairing and literal forms were
  corrected in the log, and nothing was "strengthened" by reflex.
- **Fix 1 was not re-shot.** The plan's acceptance reads "the listed changes were made and
  re-shot". The change is proven by a named unit test watched red first, so the partial
  screenshots show the pre-fix wording.

## Known Stubs

None.

## Self-check

- [x] 28 rows `^| M[2-5][0-9]` in the mutation log; `git diff --stat -- src drizzle` empty after Task 1
- [x] 32 PNGs in `docs/measurements/04-screens/`, each listed in the README
- [x] danlo's reply recorded verbatim; fix 1 committed with its red-first test
- [x] `nyquist_compliant: true` and `status: complete` in 04-VALIDATION; 0 `⬜ pending` rows
- [x] commits 2558916, d127b1c, 0456186, 8707957 present in `git log`
