---
phase: 04-places-transient-verifier
plan: 29
subsystem: legal-gate
tags: [PLACE-02, PLACE-06, D-01, legal, places-persistence, field-mask, match-features, record-guard]
requires:
  - phase: 04-12
    provides: PlaceSchema (src/lib/places/response.ts) — the strict businessStatus enum retired here
  - phase: 04-15
    provides: toPageRecord (src/lib/places/page-record.ts) + app.record_places_page / app.places_features_ok
  - phase: 04-19
    provides: scripts/lib/anonymize-places.ts + scripts/lib/record-guard.ts assertLegalRecord
  - phase: 04-24
    provides: GoogleListingCard + placesChips (the review chips re-derived here)
provides:
  - "docs/legal/places-persistence.md — the D-01 enumeration (115 columns), revised after two scope reductions"
  - "PROJECT.md Key Decisions row 'D-01 Places legal gate — danlo-risk-call' — the row assertLegalRecord reads"
  - "Enterprise field mask without places.types / places.businessStatus; fixtures refuse both keys"
  - "place_attachments.features persists integer points + signals/rule enums + 0/1 flags only; nameSim/distanceM memory-only"
affects: [04-30, 04-31, 04-32, 04-33, phase-06, phase-09]
tech-stack:
  added: []
  patterns:
    - "Memory-only keys are dropped by name at the last TypeScript hand (toPageRecord); everything else outside the allow-list still throws"
    - "A fixture validator refuses named keys (NEVER_KEPT) ahead of the generic unknown-key check, so the refusal says why"
key-files:
  created:
    - .planning/phases/04-places-transient-verifier/04-29-SUMMARY.md
  modified:
    - docs/legal/places-persistence.md
    - .planning/PROJECT.md
    - .planning/STATE.md
    - src/lib/budget/field-mask-tier.ts
    - src/lib/places/response.ts
    - src/lib/places/page-record.ts
    - src/lib/ui/places-format.ts
    - src/lib/ui/copy.ts
    - src/db/schema/place-attachments.ts
    - scripts/lib/anonymize-places.ts
    - scripts/record-places-fixtures.ts
    - tests/unit/msw/places.ts
    - tests/unit/msw/fixtures/README.md
    - tests/unit/msw/fixtures/places-{child-12,match-page,saturated-p1,saturated-p2,saturated-p3}.json
key-decisions:
  - "D-01 Places legal gate — danlo-risk-call, scoped to Phase 4's hand-run vertical slice; counsel's written answer required before Phase 9 or any external customer"
  - "places.types / places.businessStatus no longer requested (no reader in src/); they stay in the PRO tier table so fieldMaskTier() can still price them"
  - "nameSim / distanceM are memory-only; persisted features are the 11 keys name/phone/address/distance/cluster/signals/rule/city/sab/listingPhone/listingLocation"
  - "No migration: app.places_features_ok still admits nameSim/distanceM (numbers-only wall); toPageRecord is the keep-out, pinned by a unit test and a DB read-back"
  - "Google-listing review chips name the scorer's band ('name match' / 'name similar' / 'different name'; 'within 100 m' / 'within 500 m' / 'within 2 km') instead of the figure — a deviation from 04-UI-SPEC line 535, flagged for danlo's review"
requirements-completed: []
duration: ~75min
completed: 2026-09-23
---

# Phase 4 Plan 29: D-01 Places legal gate Summary

**D-01 is recorded as danlo's written risk call, scoped to the Phase 4 vertical slice. Before the
decision, two cuts narrowed what Siteless takes from Google: the Places request no longer asks for
`types`/`businessStatus`, and `nameSim`/`distanceM` are no longer stored. The call was made
against the enumeration as it stood after those cuts.**

## The decision (Task 2, recorded verbatim)

**Option:** `danlo-risk-call`

**Where it came from.** danlo asked Claude for a recommendation. Claude drafted the rationale
below, and danlo adopted it verbatim on 2026-09-23 with "Go with your recommendations". Claude
wrote the text; the decision and the risk are danlo's.

> "I accept the risk for Phase 4's hand-run vertical slice only — one city × one cluster, internal
> use, within Google's free tier — against docs/legal/places-persistence.md as of 2026-09-23.
> Siteless is an internal lead tool, not a listings or directory service; it persists place_id,
> 30-day coordinates, and derived signals only, with no Google text. PLACES_MODE stays the kill
> switch. Counsel's written answer on §3.2.3(c) and (d)(iii) is required before any scheduled or
> recurring sweep (Phase 9) or any external customer."

The same "Go with your recommendations" also approved the two cuts (Jobs A1/A2 below). Both were
committed before the decision was recorded, and the decision covers the document **as of
`5a74bba`**, which already describes them.

## Tasks / commits

| Task | What | Commit |
| --- | --- | --- |
| 1 | Generated the persistence enumeration from the live schema (115 columns) | `2c2e8b5` (earlier session) |
| pre-decision A1 | fix(04): stop requesting unused Places types/businessStatus | `53e5650` |
| pre-decision A2 | fix(04): persist only integer match signals, not Google-derived nameSim/distanceM | `dc8e057` |
| pre-decision B | docs(04-29): persistence list after the scope reductions | `5a74bba` |
| 2 | Checkpoint: danlo's decision (above) | — (no code) |
| 3 | Recorded D-01 in PROJECT.md Key Decisions + STATE.md | `4f4767d` |

### A1: `types` / `businessStatus` removed (`53e5650`)

- **Grep before removal.** `grep -rnw "types\|businessStatus"` over `src/` found them only in
  two places: their own declarations in `field-mask-tier.ts` (the PRO list and the mask), and the
  `PlaceSchema` fields in `response.ts`. The `BUSINESS_STATUS` hits in `src/components` and
  `src/lib/ui/copy.ts` are our own merged/active labels, unrelated. `ParsedPlace` has one
  consumer, `client.ts`, and it passes `places` through without touching either field.
  `match.ts` `PlacesResultLike` never names them. **No reader.**
- **Mask.** Both removed from `PLACES_TEXT_SEARCH_FIELD_MASK`, which still prices as
  `ts_enterprise` (because of `websiteUri`). Both stay in the `PRO` tier table.
- **Schema.** `PlaceSchema` is a plain `z.object`, which strips unknown keys (not `.strict()` or
  `.passthrough()`). Dropping both fields also retires the strict-enum `bad_shape` risk that
  04-12/04-19 raised for `BUSINESS_STATUS_UNSPECIFIED`. The recorder's KNOWN RISK comment and
  its `bad_shape` message were updated to match.
- **Anonymizer and fixtures.**
  - `anonymizePage` no longer copies either field.
  - `assertAnonymizedPage` refuses either key by name (`NEVER_KEPT`).
  - The msw harness refuses them at load in every `places-*.json`, synthetic or recorded.
  - The 5 synthetic fixtures were stripped of both keys (79 `businessStatus` lines, 79 `types`
    lines).
  - Updated `README.md`.
- **Tests.**
  - New: "the Places mask requests no field nothing reads" (exact mask pin) and "a fixture
    carrying types or businessStatus is refused".
  - Updated: `places-msw` FULL_MASK and the recorder DB test's originals list.
- **Mutations.**
  - Validator accepts the keys (NEVER_KEPT loop removed, keys added to PLACE_KEYS): "a fixture
    carrying types or businessStatus is refused" goes red. Reverted, and `diff` confirmed
    identical to the pre-mutation file.
  - `places.types` re-added to the mask: "the Places mask requests no field nothing reads" goes
    red. Reverted.
  - **M11** (append `places.reviews`): still reds both named tests, "fieldMaskTier atmosphere:
    appending places.reviews raises the tier" and "price book atmosphere: the ledger price
    follows the mask". It also now reds two further mask pins. Reverted.

### A2: `nameSim` / `distanceM` memory-only (`dc8e057`)

- **Persisted `features` keys (11):**
  - integer points: `name`, `phone`, `address`, `distance`, `cluster`;
  - enums: `signals`, `rule`;
  - 0/1 flags: `city`, `sab`, `listingPhone`, `listingLocation`.

  `toPageRecord` drops exactly `MEMORY_ONLY_FEATURE_KEYS = ['nameSim','distanceM']`. Any other
  unknown key still throws, and the points keys must now be integers.
- **No migration.** `app.places_features_ok` / `pa_features_numeric` still admit the two keys as
  numbers. That CHECK is a numbers-only wall, and `toPageRecord` is the keep-out. The legal doc
  states this plainly.
- **What the UI read.** `placesChips` (the Google-listing review card) was the ONLY consumer of
  persisted place features. It read `nameSim` for "name 0.84" and `distanceM` for "140 m apart".
  It now derives both chips from the persisted integers:
  - name: the `name` signal → "name match"; points > 0 → "name similar"; 0 → "different name";
  - distance: the tier → "within 100 m" / "within 500 m" / "within 2 km";
  - 0 distance points → no chip (beyond 2 km and a coarse location look the same in the stored
    points). A listing with no pin still says "no location on the listing".

  Phase 3's pair chips (`review-format.ts`, `candidate_pairs.features`) are untouched.
  `src/lib/resolve/*` is untouched.
- **Tests.**
  - New: "persisted place features carry no nameSim or distanceM". It runs through the real
    matcher: the in-memory features have both keys, the record has neither.
  - The chips contract test now runs through `toPageRecord`.
  - The 04-15 writer test reads the stored row back and asserts neither key.
  - Fixtures that seeded `{nameSim: 1}` directly now use integer-only shapes:
    `tests/db/places-writer.test.ts` (sticky confirm), `review-queue-google.test.ts`,
    `sources-transient.test.ts`, `_places-fixtures.ts`.
- **Mutation.** Put `nameSim` back in `FEATURE_KEYS` and out of the memory-only list. Red by
  name: "persisted place features carry no nameSim or distanceM", plus "page record drops
  feature keys outside the allow-list" and "the matcher's features render as chips". Reverted,
  and `diff` confirmed identical.

### Gate after Job A (on the A1 + A2 tree, before the A2 commit)

| Lane | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint . --ignore-pattern ".claude/**"` | exit 0 |
| `npx vitest run tests/unit` | 82 files, **625 passed** |
| `npx vitest run --config vitest.db.config.ts --pool=forks` | 42 files, **375 passed** |
| `npx vitest run --config vitest.workflow.config.ts` | 2 files, **13 passed** |
| `npx next build` | exit 0, "workflows build complete (8 steps, **1 workflow**)" |
| unit lane re-run after build | 82 files, **625 passed** |

Branch `gsd/phase-04-places-transient-verifier`, HEAD `53e5650` + the A2 working tree, printed
after the DB gate.

### B: persistence doc (`5a74bba`)

- Re-queried `information_schema.columns` on the local `siteless_test` inside
  `begin read only`. Result: **115 columns** (16 + 14 + 10 + 22 + 10 + 26 + 9 + 8), drizzle
  journal 30. **Document count = query count = 115**, with no schema change.
- Added "Changes before the decision (2026-09-23)", which names `53e5650` and `dc8e057`.
- Revised the numbered sections:
  - **§1.1:** 11 persisted keys. `name` points are a coarsened monotone function of similarity
    (46 values). `distance` is a 4-value tier. The DB CHECK still admits 13 keys.
  - **§2 / §4:** `types` / `businessStatus` moved to "not requested at all", with the exact mask
    listed.
  - **§3 / §6 Q5:** fixtures can no longer carry Google enums, so real place ids are the only
    fixture question left. The owner / `service_role` coordinate item is kept.
  - **§5:** the chips now name bands.
  - **§6 Q1:** `nameSim` / `distanceM` removed from the derived-values list.

### Task 3: record (`4f4767d`)

**The PROJECT.md Key Decisions row, as written:**

| Decision | Rationale | Outcome |
| --- | --- | --- |
| D-01 Places legal gate — danlo-risk-call | "I accept the risk for Phase 4's hand-run vertical slice only — one city × one cluster, internal use, within Google's free tier — against docs/legal/places-persistence.md as of 2026-09-23. Siteless is an internal lead tool, not a listings or directory service; it persists place_id, 30-day coordinates, and derived signals only, with no Google text. PLACES_MODE stays the kill switch. Counsel's written answer on §3.2.3(c) and (d)(iii) is required before any scheduled or recurring sweep (Phase 9) or any external customer." (drafted by Claude at danlo's request; adopted verbatim by danlo 2026-09-23) — covers docs/legal/places-persistence.md as of 5a74bba | PLACES_MODE may be set to ids_only/enterprise for the Phase 4 vertical slice only; counsel required before Phase 9 or any external customer |

**STATE.md.**

- The "Legal read owed…" blocker is now a struck-through RESOLVED pointer to the row.
- New open concern: "Counsel's written answer on Maps Terms §3.2.3(c)/(d)(iii) required before
  Phase 9 (scheduler) or any external customer — D-01 scope."

**Guard.** The plan's command,
`node --conditions=react-server --import tsx -e "import('./scripts/lib/record-guard.ts').then(m => m.assertLegalRecord(require('fs').readFileSync('.planning/PROJECT.md','utf8')))"`,
gives **exit 0**. Control: the same call on the pre-row `PROJECT.md` (`git show HEAD:`) gives
**exit 1**, "record-places: PROJECT.md Key Decisions has no D-01 Places row…".

## Deviations from Plan

### Auto-fixed / scope notes

1. **[Rule 1 - conflict in the brief] The persisted-features cut changed two review chips.** The
   brief said to keep what `placesChips` reads plus the integer components. But `placesChips`
   read exactly the two keys the brief removes. The explicit requirement ("nameSim and distanceM
   stay in memory", plus the named test) takes precedence, so the chips were re-derived from the
   persisted integers.
   - This is a **deviation from 04-UI-SPEC line 535**, which names "name 0.84" and "140 m apart"
     for the Google card.
   - It needs danlo's review before merge.
   - Files: `src/lib/ui/places-format.ts`, `src/lib/ui/copy.ts`. Commit `dc8e057`.
2. **[Rule 2] Points keys must be integers.** `toPageRecord` now refuses a non-integer under
   `name`/`phone`/`address`/`distance`/`cluster`, so a continuous value cannot ride in under a
   points key. Commit `dc8e057`.
3. **[Rule 2] Harness-level refusal.** `tests/unit/msw/places.ts` refuses `types` /
   `businessStatus` in ANY `places-*.json`, not only in anonymized ones. A synthetic fixture
   must not serve a field the real API is never asked for. Commit `53e5650`.
4. **Plan order.** Task 1 was committed in an earlier session. The decision was taken in the
   orchestrator's session, not at a fresh checkpoint here. Jobs A/B ran between Task 1 and
   Task 3 at danlo's instruction.

### Not changed (out of scope, logged)

- PROJECT.md's first Key Decisions row still reads "— Pending (legal read on the derived boolean
  in parallel)". D-01's row now answers it for Phase 4 only. It was left for danlo or the phase
  transition to update.
- Prettier `--check` warns on every CRLF working-copy file (`core.autocrlf=true`, LF expected).
  This is pre-existing and repo-wide. Every file touched here passes `--end-of-line auto`. Two
  pre-existing formatting nits (`src/lib/ui/copy.ts:428`,
  `tests/db/review-queue-google.test.ts:124`) are on lines this plan did not write.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. The changes only narrow what is requested and
persisted.

## Next

- 04-31 (GCP project + BUDG-03 + the one free IDs-only verification call) is now unblocked by the
  recorder guard.
- **danlo should eyeball the Google-card chip wording before the branch merges.**

## Self-Check: PASSED

Commits 2c2e8b5, 53e5650, dc8e057, 5a74bba, 4f4767d exist; docs/legal/places-persistence.md and this SUMMARY exist; no file deletions since 2c2e8b5; the D-01 row is present at PROJECT.md line 113.
