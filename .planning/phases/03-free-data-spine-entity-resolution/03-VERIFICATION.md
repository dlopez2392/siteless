---
phase: 03-free-data-spine-entity-resolution
verified: 2026-09-23T19:30:00Z
status: passed
score: 5/5 roadmap success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "3/5 (2 BLOCKER gaps: B-CR-01, A-CR-02; 3 WARNING: A-CR-01, A-CR-03, C-CR-01)"
  gaps_closed:
    - "B-CR-01: name normalizer strips legal tokens ('l', 'c', 'co') at any position, not just a trailing legal-suffix run — collapsed distinct RGV initials-led businesses onto one key (criterion 3 / DEDUP-04)"
    - "A-CR-02: re-ingest writes to the source record's originally-created business with no merge-cluster check, silently reverting D-14 survivorship on a merge winner or corrupting a dead loser row (criterion 1 / phase goal 'durable record' / DATA-04)"
    - "A-CR-01 (WARNING): concurrent reviewer race — a 'Same business' could silently overwrite a 'Different' with no lock and no audit trace"
    - "A-CR-03 (WARNING): cluster_key never populated by survivorship — a merged business could silently drop out of the lead funnel"
    - "C-CR-01 (WARNING): no error boundary anywhere — a rejected server action crashed the whole app to Next's generic error page"
  gaps_remaining: []
  regressions: []
deferred: []
human_verification: []
---

# Phase 3: Free-Data Spine & Entity Resolution Verification Report

**Phase Goal:** A durable, license-clean canonical business record for the RGV — Comptroller plus Overture, deduped into one lead per business with per-field provenance — existing before any Google call is made.
**Verified:** 2026-09-23T19:30:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (`/gsd-code-review 3 --fix`, `03-REVIEW-FIX.md`)

## Re-verification Summary

The first verification (2026-09-23T18:00:00Z, at HEAD `1dde7c4`) found `status: gaps_found` (3/5):
two BLOCKER gaps (B-CR-01 name-normalizer defect, A-CR-02 re-ingest-reverts-survivorship defect)
and three WARNING-level confirmed-live criticals (A-CR-01 reviewer race, A-CR-03 dropped
`cluster_key`, C-CR-01 missing error boundary).

Since then, at HEAD `6dc42b5` (three commits past `8f12c56`, the consolidated fix report):
- All 32 CRITICAL + WARNING findings from `03-REVIEW.md` were fixed across three parallel
  `gsd-code-fixer` worktrees, one atomic `fix(03): <ID>` commit each, merged by the orchestrator
  (`475090a` closes one seam defect the merge itself exposed: `chainKeyOf` was re-adding a trade
  word `nameNorm` now keeps, verified fixed below).
- Migration `drizzle/0025_review_fixes_spine.sql` (445 lines: `record_merge`/`undo_merge`
  locking + pending-only closes, the `authenticated` DML revoke on `businesses`/`source_records`,
  the `pg_temp` search-path sweep, and the new write-gated `app.apply_survivorship_if_changed`)
  is applied **locally only** — production is a separate, human-gated `pnpm db:migrate:prod` step,
  not yet run (see Deployment Follow-ups below).
- The local spine (91,872 businesses) was re-derived and re-resolved against the corrected
  normalizer (`docs/measurements/03-desk-run.md`, "Post-review re-derive and resolve"):
  `name_norm` rewritten on 1,842 rows (2.0%), survivorship rewritten on 1,666 rows, resolve
  re-scored 4,325 pairs, 16 new auto-merges, review queue moved 7,975 → 7,847.

This re-verification independently re-derived nothing and re-ran no ingest/resolve (per
instructions); it read the fix commits and the new/changed source against the review's claims,
read the named tests that pin each fix, and **ran them** — both to confirm they pass now and,
for the two BLOCKER gaps, to confirm the test's own text/mechanics would have caught the original
defect (the tests literally reconstruct the review's broken scenarios: a changed Comptroller
payload on a merge winner, a changed Overture payload on a merge loser, a changed Census answer
on a merge winner, `"C & L Plumbing"` vs `"Plumbing"`, etc.). It also independently re-ran the
full gate (typecheck, lint, unit, db, build) rather than trusting `03-REVIEW-FIX.md`'s reported
numbers.

**Gate, independently re-run at HEAD `6dc42b5` (working tree clean, nothing touched by this
verification):**

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| `eslint .` | clean, 0 errors |
| `vitest run tests/unit` | 46 files / **340/340** passed |
| `vitest run --config vitest.db.config.ts --pool=forks tests/db` | 30 files / **222/222** passed |
| `next build` | exit 0, all 15 app routes + `/api/health` compiled |

These numbers match `03-REVIEW-FIX.md`'s claimed "Combined gate on `475090a`: typecheck ✓ · lint
✓ · build ✓ · unit 340/340 · db 222/222" exactly, independently reproduced three commits later at
`6dc42b5` (the two commits in between are docs-only: the fix report and the desk-run record).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A re-runnable ingest loads TX Comptroller + Overture for the four RGV counties, TX-side only, and a re-run reports added/changed/unchanged instead of duplicating rows | ✓ VERIFIED (gap closed) | A-CR-02 fixed: `src/lib/ingest/upsert.ts:363-386` — a business in a merge cluster no longer takes one record's values directly; only its own non-survivorship columns (`name_norm`, `comptroller_key`, `primary_source`) go on the business it created, and the cluster root is re-derived through `rederiveRoot` (`src/lib/resolve/rederive.ts`, new) using the same `survive()` a merge uses, write-gated through `app.apply_survivorship_if_changed` (drizzle/0025). Read the code directly (not trusted from the report) and confirmed the write-gate logic. `tests/db/reingest-merged.test.ts` — 5/5 tests pass, reconstructing exactly the review's three broken scenarios (Comptroller payload change on a winner, Overture payload change on a loser, Census/WRITE_LOCATION change on a winner) plus the two idempotency-preserving cases (unchanged re-ingest writes nothing; re-deriving an unchanged cluster writes nothing) |
| 2 | Any business record shows which source supplied each field, and a durable field can only cite a durable source | ✓ VERIFIED | Unaffected by the gaps directly, but the FK-level guarantee (`tests/db/retention.test.ts`) is now free of the earlier caveat: since A-CR-02 is fixed, a provenance tag can no longer point at a record whose payload has silently drifted from what the business shows. Confirmed via the full db suite pass (222/222 includes `retention.test.ts`) |
| 3 | The same business from both sources resolves into one lead at ≥95 confidence on a trusted identifier (80–95 review, <80 ignored), with names/addresses/phones normalized first | ✓ VERIFIED (gap closed) | B-CR-01 fixed: `src/lib/normalize/name.ts` — `LEGAL` no longer contains bare `l`/`c`; legal-form tokens strip only as a trailing run (`stripTrailingLegal`) or a whole dotted sequence (`LEGAL_SEQUENCES`) matched at the end. Read the full file directly. `tests/unit/normalize.test.ts` — ran it: 51/51 pass, including the three named `B-CR-01` tests that literally assert `nameNorm('C & L Plumbing') === 'c l plumbing'` and `!== nameNorm('Plumbing')`, `nameNorm('C&C Auto Repair') !== nameNorm('Auto Repair')`, `nameNorm('Co-Op Feed') === 'co op feed'`, and that a genuine trailing legal run (`Smith Co`, `Smith Co Inc`, `Smith Co., Inc.`) still strips. B-WR-01 (suite/unit comparison) and B-WR-04 (toll-free phone pick) — the two companion normalization defects the original review flagged as feeding the same false-95 risk — are also fixed and tested (`score.ts` unit comparison, `pickPhone()` in `transform.ts`/`merge.ts`). The already-computed spine was re-derived against the fixed normalizer and re-resolved (`docs/measurements/03-desk-run.md`), not merely fixed prospectively |
| 4 | A merge can be undone, every parent record survives, and the external lead key is unchanged by merge/unmerge | ✓ VERIFIED (2 WARNING gaps closed) | A-CR-01 fixed: `drizzle/0025` `app.record_merge` now reads the candidate `FOR UPDATE` (the same lock `record_candidate_decision`'s UPDATE takes), refuses `distinct`/non-`pending` for any reason, and the closing UPDATE is `decision = 'pending'`-scoped with a FOUND check. `tests/db/merge-unmerge.test.ts` — ran it: 20/20 pass, including the named `'a reviewer "Same business" after a "Different" is refused, never a silent overwrite'` and `'a candidate already merged is refused by name, not re-merged'`. A-CR-03 fixed: `src/lib/resolve/derivation.ts` (new) centralizes `cluster_key` derivation so ingest and survivorship agree; `'a merge keeps the Overture-mapped cluster when the Comptroller winner has none'` passes in the same run. `tests/db/external-key.test.ts` (unaffected by these gaps) continues to hold under the full db-suite pass |
| 5 | A city/county/radius search never returns a Mexican-side result, proven against a naive bounding box that is 42% Mexico | ✓ VERIFIED | Unaffected by any of the fixed gaps; `tests/db/texas-side.test.ts` continues to pass as part of the full 222/222 db-suite run |

**Score:** 5/5 roadmap success criteria verified.

### Fixed-Gap Detail: was the defect real, and does the fix actually close it?

For each of the two BLOCKER gaps, the fix was checked at three levels: (a) read the changed
source directly — not the fix report's prose; (b) read the named test and confirm its assertions
actually reconstruct the review's broken scenario; (c) run the test and watch it pass at the
current HEAD.

| Gap | Source checked | Named test | Ran it | Would the test have failed on the pre-fix code? |
|---|---|---|---|---|
| B-CR-01 | `src/lib/normalize/name.ts:67-166` — `LEGAL` set, `stripTrailingLegal`, `LEGAL_SEQUENCES` | `tests/unit/normalize.test.ts` "nameNorm B-CR-01: initials are identity, not legal suffixes" / "co is kept…" / "a trailing legal run still strips" | ✓ 51/51 pass | Yes — on the pre-fix normalizer (bare `l`/`c`/`co` in `LEGAL`, stripped at every position), `nameNorm('C & L Plumbing')` reduces to `'plumbing'`, identical to `nameNorm('Plumbing')`; the test's `.not.toBe(...)` assertion is the review's exact reported collision |
| A-CR-02 | `src/lib/ingest/upsert.ts:341-422` `upsertBusinessFromSource`; `src/lib/resolve/rederive.ts` (new) `clusterOf`/`rederiveRoot`; `drizzle/0025` `app.apply_survivorship_if_changed` | `tests/db/reingest-merged.test.ts` (5 tests) | ✓ 5/5 pass | Yes — on the pre-fix code the write target was `source_records.business_id` with no cluster check; a changed Comptroller payload would `update businesses set display_name = ...` directly on the winner, reverting the Overture name the merge chose. The test's positive control (`merged.display_name` is `'Riverside Stone'`, Overture's, right after the merge) followed by the assertion that it is UNCHANGED after the re-ingest is exactly this scenario |

Both fixes are also exercised against real (not fixture) data: the local spine's `rederive` +
`resolve` re-run (`docs/measurements/03-desk-run.md`) applied the corrected normalizer to 91,872
real businesses and re-scored the affected candidate pairs — this is evidence beyond the unit/db
fixtures that the fix behaves correctly at the scale and shape of the actual RGV data, not just
the review's synthetic examples.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/normalize/name.ts` | Trailing-only legal-suffix strip (B-CR-01) | ✓ VERIFIED | Read directly; `LEGAL` set no longer carries bare single letters; strip logic is `stripTrailingLegal` + `LEGAL_SEQUENCES`, called only from the trailing position |
| `src/lib/ingest/upsert.ts` | Merge-cluster-aware write path (A-CR-02) | ✓ VERIFIED | `upsertBusinessFromSource` checks `clusterOf` before writing; survivorship-owned columns route through `rederiveRoot`, not a direct write |
| `src/lib/resolve/rederive.ts` | New: cluster-root re-derivation shared by ingest and the rederive pass | ✓ VERIFIED, WIRED | Imported by `upsert.ts` (ingest) and `scripts/rederive.ts` (batch pass); both call `rederiveRoot` |
| `drizzle/0025_review_fixes_spine.sql` | Lock/refuse fixes for `record_merge`/`undo_merge`, DML revoke, `pg_temp` sweep, `apply_survivorship_if_changed` | ✓ VERIFIED, APPLIED LOCALLY | Read in full (445 lines); applied to the local test DB (`__drizzle_migrations` id 29, confirmed by the passing db suite against this schema); **not yet applied to production** — see Deployment Follow-ups |
| `src/lib/resolve/chain.ts` | `chainKeyOf` — trade-word-preserving chain identity, seam-fixed post-merge | ✓ VERIFIED | `chainKeyOf` only prepends trade words `nameNorm` actually removed (checked against `kept`, the current `name_norm`'s own tokens) — the `475090a` seam fix. Confirmed by reading the function and its guarding comment referencing the seam bug directly |
| `tests/db/reingest-merged.test.ts` | New: pins A-CR-02 | ✓ VERIFIED, RAN | 5/5 pass against local DB |
| `tests/db/rederive.test.ts` | New: pins the rederive pass (A-WR-06) | ✓ VERIFIED, RAN | 6/6 pass against local DB |
| `tests/unit/normalize.test.ts` | Extended: pins B-CR-01, B-WR-02, B-WR-03, B-WR-05 | ✓ VERIFIED, RAN | 51/51 pass |
| `tests/unit/payload-contract.test.ts` | Extended: pins A-CR-03 cluster_key parity | ✓ VERIFIED, RAN | 5/5 pass |
| `src/app/(app)/error.tsx`, `.../review/error.tsx`, `.../businesses/[id]/error.tsx` | New: error boundaries (C-CR-01) | ✓ VERIFIED, WIRED, SUBSTANTIVE | Read `(app)/error.tsx` directly — renders `RouteError` with real copy (`UNEXPECTED_ERROR`), not a stub; `next build` compiles all three segments |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `upsertBusinessFromSource` | `clusterOf` / `rederiveRoot` | direct import, called before any survivorship-owned column write | ✓ WIRED | Confirmed by reading `upsert.ts:6, 370-386` and by the passing `reingest-merged.test.ts` |
| `scripts/ingest-comptroller.ts` (`WRITE_LOCATION`) | `rederiveRoot` | same cluster-aware path, per `03-REVIEW-FIX.md` and confirmed by `'a changed Census answer on a merge winner keeps the Overture location'` passing | ✓ WIRED | Test exercises the real `runGeocodePass` from `scripts/ingest-comptroller.ts`, not a stand-in |
| `app.record_merge` (0025) | `merge_candidates` row lock | `for update` in the candidate SELECT | ✓ WIRED | Read directly in the migration SQL; `tests/db/merge-unmerge.test.ts` "refused, never a silent overwrite" passes |
| `chainKeyOf` | `name_norm` | trade words only re-added when absent from the current `name_norm` tokens | ✓ WIRED | Read `chain.ts:89-103`; `chainKeyOverrides` calls it per live business and only overrides when the result differs |
| Local spine | corrected normalizer | `pnpm rederive` then `pnpm resolve`, run once against 91,872 real businesses | ✓ FLOWING | `docs/measurements/03-desk-run.md` "Post-review re-derive and resolve" — 1,842 `name_norm` rewrites, 1,666 survivorship rewrites, 16 new auto-merges, review queue 7,975 → 7,847. This is real-data evidence the fix propagates to stored keys, not just to new writes |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| DATA-01 | 03-03, 03-07, 03-12 | ✓ SATISFIED | Unaffected by the gaps; unaffected by the fixes; confirmed via the passing db suite |
| DATA-02 | 03-08, 03-13 | ✓ SATISFIED | Unaffected by the gaps; confirmed via the passing db suite |
| DATA-03 | 03-05, 03-15, 03-19 | ✓ SATISFIED (caveat resolved) | Retention/provenance FKs solid as before; the post-re-ingest staleness risk (A-CR-02) is fixed |
| DATA-04 | 03-09, 03-20 | ✓ SATISFIED (gap closed) | A-CR-02 fixed and tested; idempotency now holds through the ordinary "payload changed on a merged business" case, not only the no-change case |
| DEDUP-01 | 03-02, 03-10, 03-14, 03-20 | ✓ SATISFIED (gap closed) | B-CR-01 fixed and tested; the tiering mechanism was already sound, its normalized-name input is now correct |
| DEDUP-02 | 03-11 | ✓ SATISFIED (caveats resolved) | A-CR-01 (reviewer race) and A-CR-03 (cluster_key loss) both fixed and tested |
| DEDUP-03 | 03-02, 03-09 | ✓ SATISFIED | Unaffected by the gaps; confirmed via the passing db suite |
| DEDUP-04 | 03-06 | ✓ SATISFIED (gap closed) | B-CR-01 was literally this requirement's defect; fixed and tested with the review's own named collision cases |

No orphaned requirements.

### Anti-Patterns Found

None blocking. The full `eslint .` run at HEAD `6dc42b5` returned clean, and no `TODO`/stub
pattern was found in any of the files read for this re-verification (`name.ts`, `upsert.ts`,
`rederive.ts`, `chain.ts`, `drizzle/0025`, the three `error.tsx` boundaries).

### Deployment Follow-ups (not gaps — pending a human-gated production step)

These are explicitly **not** counted as gaps against this phase's goal achievement, per the
re-verification instructions — they are administrative/deploy steps gated on danlo's go-ahead,
not defects in the code:

1. **Migration `drizzle/0025_review_fixes_spine.sql` is applied locally only; production is
   still at 0024.** `pnpm db:migrate:prod` is the next step, and `03-REVIEW-FIX.md` documents the
   exact post-flight SQL to run afterward (confirms `undo_merge`'s new 3-arg signature, the DML
   revoke, the `pg_temp` sweep, and `record_merge`'s new `for update`). Production currently holds
   0 businesses (per the original verification's deployment evidence), so there is no live data
   at risk from the old functions in the interim — but the phase's "durable record" guarantee is
   not live in production until this runs.
2. **The corrected normalizer has been propagated to the LOCAL spine only** (`pnpm rederive` +
   `pnpm resolve`, both already run and measured — see `docs/measurements/03-desk-run.md`).
   Production has no businesses yet, so there is nothing to re-derive there; this step becomes
   relevant only after 0025 and a production ingest both run.
3. Both steps are already sequenced in `docs/runbooks/ingest.md` §7 and in `03-REVIEW-FIX.md`'s
   "Notes for the orchestrator" — nothing further needs to be planned, only executed by danlo.

## Human Verification Required

None. Unlike the first verification, this re-verification found no remaining BLOCKER or
uncertain-status item that needs a human decision to close — all two BLOCKER and three WARNING
findings from the prior report are fixed, named, and independently confirmed to pass at HEAD
`6dc42b5` (both by reading the source and by running the gate fresh). The two deploy follow-ups
above are known, well-understood, sequenced administrative actions, not verification
uncertainty — they are reported for tracking, not as a blocking human-verification item.

(Several individual review findings inside `03-REVIEW-FIX.md` — A-WR-03, A-WR-07, B-WR-05 — are
flagged by the fixers themselves as "requires human verification (logic)", meaning danlo may want
to review the product-level judgment calls they embed, such as which stale-candidate cases get
auto-marked `distinct`, or the exact bar for when a trade word stays in a chain key. These are
outside the scope of the two BLOCKER and three WARNING items this re-verification was asked to
check, are each backed by a named, passing test, and do not correspond to a failed roadmap
success criterion — they are noted here for completeness, not as a gap or a blocking item.)

## Gaps Summary

None remaining. Both BLOCKER gaps (B-CR-01, A-CR-02) and all three WARNING-classified criticals
(A-CR-01, A-CR-03, C-CR-01) from the initial verification are confirmed fixed at HEAD `6dc42b5`:
read directly against source, pinned by named tests that reconstruct the original review's exact
broken scenarios, run and confirmed passing (340/340 unit, 222/222 db), and — for the two
normalization-dependent gaps — propagated to the real local spine via `rederive` + `resolve` with
measured before/after counts. The full gate (typecheck, lint, unit, db, build) was independently
re-run for this verification, not trusted from `03-REVIEW-FIX.md`'s report, and matches.

The phase goal — a durable, license-clean canonical business record for the RGV, deduped into one
lead per business with per-field provenance — is achieved in the local codebase and spine. The one
remaining step before it is achieved **in production** is the human-gated `pnpm db:migrate:prod`
for migration 0025, tracked above as a deployment follow-up, not a gap.

---

*Verified: 2026-09-23T19:30:00Z*
*Verifier: Claude (gsd-verifier)*
