---
phase: 03-free-data-spine-entity-resolution
verified: 2026-09-23T18:00:00Z
status: gaps_found
score: 3/5 roadmap success criteria fully verified (2 blocked by confirmed, unfixed code-review criticals)
overrides_applied: 0
gaps:
  - truth: "Names, addresses and phones are normalized before matching, so a ≥95 auto-merge is trustworthy (DEDUP-01, DEDUP-04; roadmap success criterion 3)"
    status: failed
    reason: >
      B-CR-01 (03-REVIEW.md, confirmed live at HEAD 1dde7c4 by direct grep of
      src/lib/normalize/name.ts:67-84): the LEGAL token set contains the bare single letters
      'l' and 'c' and the token 'co', and the strip runs at every token position, not only on
      a trailing legal-suffix run. Reviewer-executed probes (reproduced independently in this
      verification) show "C & L Plumbing" -> "plumbing", "C&C Auto Repair" -> "auto repair"
      (identical to "Auto Repair"), "Co-Op Feed" -> "op feed". Combined with the unit/suite
      being stripped from the address blocking key with no downstream re-check (B-WR-01), the
      review traces a concrete path to score 95 (three independent signals: name 1.0 sim,
      address full match, distance/cluster) for two DISTINCT businesses at one strip mall
      sharing an initials-led name pattern that is common among RGV trades. The same key
      collision produces false chain badges (B-WR-05 compounds this for surname+trade names).
      This is a DEDUP-04 defect (normalization is not correct) that directly undermines the
      roadmap's stated guarantee that "the same business ... resolves into one lead at ≥95
      confidence on a trusted identifier" — the fixture fed to `merge-pairs.json` does not
      cover this shape, so the automated 298/298 + 194/194 unit/db pass does not catch it.
    artifacts:
      - path: "src/lib/normalize/name.ts"
        issue: "LEGAL set strips 'l', 'c', 'co' at any token position rather than only a trailing legal-suffix run (lines 67-84, confirmed unfixed)"
    missing:
      - "Fix nameNorm to strip legal-suffix tokens only from a trailing run, per the review's proposed diff"
      - "Named tests: 'C & L Plumbing' != 'Plumbing', 'C&C Auto Repair' != 'Auto Repair', 'Co-Op Feed' keeps 'co'"
      - "Recompute name_norm (and re-run the resolve pass) for every existing row once fixed, since stored keys were built with the defective normalizer"
  - truth: "A re-run of the ingest is idempotent and never silently corrupts an already-merged business's survivorship-chosen fields — the canonical record stays durable across runs (DATA-04; phase goal 'durable ... canonical business record')"
    status: failed
    reason: >
      A-CR-02 (03-REVIEW.md, confirmed live at HEAD 1dde7c4 by direct read of
      src/lib/ingest/upsert.ts:307-333): `upsertBusinessFromSource` resolves its write target as
      `source_records.business_id` — whichever business that source record originally
      created — and never checks whether that business is a merge winner or has since been
      merged away. On an ordinary re-ingest where a source payload changes for a business that
      has been merged, this silently overwrites D-14 survivorship-chosen fields
      (display_name, legal_name, address, cluster_key) on the winner with the single-source
      value, or writes to a dead loser row whose provenance the winner still cites (making the
      detail page's inline source tag, D-18, assert a false provenance). The desk run's three
      re-runs (docs/measurements/03-desk-run.md) never exercised this path because no source
      payload changed between runs after the 1,077 merges — but the analogous, narrower
      WRITE_LOCATION defect (same root cause, the Census location write) WAS hit during the
      desk run ("Run 2 was not clean: 908 businesses events") and had to be repaired by hand.
      The full-column version of the bug (this finding) remains unfixed and will trigger on the
      first realistic monthly re-run against a live spine, which is precisely the scenario
      criterion 1's "re-runnable ... reports added/changed/unchanged" and the phase's premise
      that Phase 4 depends on ("durable record must exist before a place_id can attach to
      anything" — ROADMAP.md ordering constraint 2) require to hold.
    artifacts:
      - path: "src/lib/ingest/upsert.ts"
        issue: "upsertBusinessFromSource writes to the source record's original creator business with no merge-cluster check (lines 307-333)"
      - path: "scripts/ingest-comptroller.ts"
        issue: "WRITE_LOCATION path (lines 756-765) has the same root cause; the desk run hit and locally repaired one instance of it"
    missing:
      - "Route every derived-column write through survivorship whenever the record's business belongs to a merge cluster (winner or loser), per the review's proposed fix"
      - "Named tests: 'changed Comptroller payload on a merge winner keeps the Overture display_name', 'changed Overture payload of a loser updates the winner'"
deferred: []
human_verification: []
---

# Phase 3: Free-Data Spine & Entity Resolution Verification Report

**Phase Goal:** A durable, license-clean canonical business record for the RGV — Comptroller plus Overture, deduped into one lead per business with per-field provenance — existing before any Google call is made.
**Verified:** 2026-09-23T18:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Method

Read all 22 PLAN.md / SUMMARY.md pairs, REQUIREMENTS.md, 03-CONTEXT.md, 03-RESEARCH.md,
03-VALIDATION.md, 03-REVIEW.md (all three slices), deferred-items.md, docs/measurements/03-desk-run.md,
docs/deploy.md, and 01-/02-VERIFICATION.md for regression context. Confirmed the branch's HEAD
(`1dde7c4`) is the code-review-report commit only — no fix commits follow it — by `git log`.
Independently reproduced all five 03-REVIEW.md CRITICAL findings against the live source at HEAD
by direct `grep`/`Read` of the named files and line ranges (not by trusting the review's prose):
all five are confirmed present and unfixed. Did not re-run the test suite (orchestrator already
ran it fresh: unit 298/298, db 194/194, typecheck/lint/build green) or the desk run (already run
and its numbers committed at `docs/measurements/03-desk-run.md`).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A re-runnable ingest loads TX Comptroller + Overture for the four RGV counties, TX-side only, and a re-run reports added/changed/unchanged instead of duplicating rows | ⚠️ VERIFIED, WITH A CONFIRMED LATENT DEFECT | `docs/measurements/03-desk-run.md` "Run 3 — the clean proof": three re-runs against a fixed ~92k-row local spine, all four sources report `added 0 / changed 0`, zero `businesses` events, zero updated rows. **But** this proof never exercised a changed source payload on a merged business — see Gap 2 (A-CR-02): that exact, ordinary case silently corrupts survivorship on a re-run, confirmed by code trace and by the desk run's own repair of the narrower WRITE_LOCATION instance of the same bug |
| 2 | Any business record shows which source supplied each field, and a durable field can only cite a durable source | ✓ VERIFIED, WITH THE SAME CAVEAT | `tests/db/retention.test.ts` — three "cites durable" pairs (address, location, closed_at), each `23503` with a positive control, each independently red under mutations M18/M19 (`docs/measurements/03-gate-mutations.md`). `sr_source_key_known` admits the four new keys and refuses an unknown one (`23514`). Provenance renders inline on every detail-view field (D-18), tested. The FK-level guarantee holds; but Gap 2 means the *value* a provenance tag points to can silently become stale/wrong after a re-ingest on a merged business — the tag would still be technically true (cites a real durable record) while the record's payload has moved |
| 3 | The same business from both sources resolves into one lead at ≥95 confidence on a trusted identifier (80–95 review, <80 ignored), with names/addresses/phones normalized first | ✗ FAILED | Gap 1 (B-CR-01): the name normalizer strips identity-carrying tokens ('l', 'c', 'co') at any position, not just a trailing legal-suffix run — confirmed live in `src/lib/normalize/name.ts:67-84`. This is a DEDUP-04 defect that the review traces to a concrete false-95 auto-merge path for two distinct businesses. The mechanism (scorer, weights, geo gate, chain cap) is otherwise sound and extensively tested (298/298 unit incl. the ten-pair fixture, desk run tuning against 79,484 real candidate pairs) — but the normalization input to that mechanism is confirmed broken for a naming pattern common in the RGV trades this product targets |
| 4 | A merge can be undone, every parent record survives, and the external lead key is unchanged by merge/unmerge | ⚠️ VERIFIED STRUCTURALLY, WITH TWO CONFIRMED CONCURRENCY/DATA GAPS | `tests/db/merge-unmerge.test.ts` — every parent's `source_records.business_id` unchanged after merge; unmerge restores from `winner_fields_before` and the loser's own source records; unmerged pairs never auto-re-merge; three-way clusters merge to one winner; the desk run performed 1,077 real auto-merges with all parents intact. External key: alias-on-merge / restore-on-unmerge tested (`tests/db/external-key.test.ts`). **But** A-CR-01 (confirmed live: `drizzle/0024_merge_functions.sql`'s closing `update merge_candidates set decision='merged' ... where id=v_candidate and org_id=v_org` — no `decision='pending'` predicate, no lock on the earlier read) lets a concurrent "Same business" silently overwrite a "Different" ruling with no audit trace; A-CR-03 (confirmed live: `cluster_key` is never populated in `sourceRecordView`, only `basicCategory` is) means a merged business can silently drop `cluster_key` and leave the lead funnel D-02 promises it stays in |
| 5 | A city/county/radius search never returns a Mexican-side result, proven against a naive bounding box that is 42% Mexico | ✓ VERIFIED | `tests/db/texas-side.test.ts` "no Mexican-side row" — a 60km radius fixture containing Reynosa/Matamoros/Río Bravo returns >20 TX rows and zero MX rows; independently red under M23. Desk run measured the real Overture bbox read: 98,960 rows -> 56,944 TX-side (42.5% dropped), matching the roadmap's 42% figure almost exactly. `country='US' AND region='TX'` confirmed as the only filter, tested against a fixture carrying `country='MX' AND region='TX'` specifically |

**Score:** 3/5 fully verified; 2/5 verified-with-a-confirmed-defect that breaks the criterion's underlying guarantee (not just an edge case — both are traced to concrete, realistic scenarios: a common RGV name pattern, and an ordinary monthly re-run).

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| DATA-01 | 03-03, 03-07, 03-12 | ✓ SATISFIED | Comptroller ingest tested + desk-run confirmed: 34,928 permits exact match to research, per-field provenance, closures feed unpadded-county-code tested |
| DATA-02 | 03-08, 03-13 | ✓ SATISFIED | Overture ingest tested + desk-run confirmed: 56,944 TX-side rows, `.items` shape, geometry not bbox, `basic_category` only, release recorded |
| DATA-03 | 03-05, 03-15, 03-19 | ⚠️ SATISFIED WITH CAVEAT | Retention/provenance FKs and rendering solid; undermined post-re-ingest by Gap 2 (A-CR-02) |
| DATA-04 | 03-09, 03-20 | ✗ BLOCKED | Gap 2 (A-CR-02) — idempotency holds only when no source payload changes for a merged business; that is the ordinary case a monthly re-run will hit |
| DEDUP-01 | 03-02, 03-10, 03-14, 03-20 | ✗ BLOCKED | Gap 1 (B-CR-01) — the tiering mechanism is sound; its normalized-name input is not |
| DEDUP-02 | 03-11 | ⚠️ SATISFIED WITH CAVEAT | Structural survival and unmerge both hold and are tested; A-CR-01 (reviewer race) and A-CR-03 (cluster_key loss) are confirmed, unfixed defects on the same write paths |
| DEDUP-03 | 03-02, 03-09 | ✓ SATISFIED | External key uniqueness, shape, and merge/unmerge alias behavior all tested |
| DEDUP-04 | 03-06 | ✗ BLOCKED | Gap 1 (B-CR-01) is literally this requirement's defect: "normalized ... before matching" is not correct for a common naming pattern |

No orphaned requirements: all eight phase requirement IDs (DATA-01…04, DEDUP-01…04) appear in at
least one plan's `requirements:` frontmatter and in REQUIREMENTS.md's traceability table under
Phase 3.

### Code Review Findings vs. Success Criteria (03-REVIEW.md, all 5 CRITICALs confirmed still live at HEAD `1dde7c4`)

| ID | Finding | Confirmed live? | Breaks which criterion | Classification |
|---|---|---|---|---|
| A-CR-01 | Concurrent reviewer race: "Same" can silently overwrite "Different" | ✓ (no `for update` on the candidate read; closing UPDATE has no `decision='pending'` predicate) | Criterion 4 (review-queue decision integrity / audit trail) — does not break "every parent survives" or "key unchanged" literally, but a lost, unaudited "Different" ruling undermines the review queue's trustworthiness | WARNING — needs a decision (see below) |
| A-CR-02 | Re-ingest reverts survivorship on merge winners / writes to merged-away losers | ✓ (`upsert.ts:307-333` resolves target from `source_records.business_id` with no merge-cluster check) | Criterion 1 (re-runnable/durable) and the phase goal itself ("durable ... canonical business record") | **BLOCKER — Gap 2 above** |
| A-CR-03 | `cluster_key` never populated by survivorship; a merge can silently drop a business from the lead funnel | ✓ (`merge.ts` only sets `basicCategory` from Overture payload; `clusterKey` stays null in every branch) | Not literally criterion 4's wording ("every parent record survives" — parent rows do survive), but undermines D-02's "unmapped rows ... never enter the lead funnel" guarantee for merged rows, which Phase 6 will read | WARNING |
| B-CR-01 | Name normalizer strips `l`/`c`/`co` anywhere, not just trailing legal-suffix runs | ✓ (`name.ts:67-84`, `LEGAL` set) | Criterion 3 (confidence guarantee) and DEDUP-04 directly | **BLOCKER — Gap 1 above** |
| C-CR-01 | No error boundary anywhere (`error.tsx`/`global-error.tsx` absent) | ✓ (`find src/app -iname error.tsx -o -iname global-error.tsx` returns nothing) | No literal success criterion, but a routine network blip during a review decision or unmerge replaces the whole review-queue screen with Next's generic crash page; the spec's own error copy is unreachable | WARNING |

Beyond the five CRITICALs, 03-REVIEW.md documents 27 WARNING and 22 INFO findings across the three
slices (grant hygiene, closure tie-breaking, unmerge snapshot staleness, address/phone
normalization edge cases — RM/FM road prefixes, phone extensions, Census coordinate validation
accepting a missing half as 0 — UI copy duplication, and several performance notes already
partially measured and recorded in `deferred-items.md`). None of these individually breaks a
stated success criterion; collectively they represent real, unaddressed debt in the merge
lifecycle and the normalizer that the phase's own code reviewer flagged with `status: issues_found`
in its own report frontmatter (03-REVIEW.md was never re-run after any fix — HEAD is the review
commit itself).

### Deployment & Desk-Run Evidence (independently spot-checked)

- Production Supabase (`jahgeqshuesndyscnmjo`): migrations 0021–0024 applied 2026-09-23 per
  `docs/deploy.md` §"Phase 3 (plan 03-21)"; pre-flight confirmed `businesses` was empty before the
  `external_key NOT NULL` column was added (would otherwise `23502`); post-flight parity confirmed
  against local (RLS tables 21/21, policies 76/76, triggers 25/25, `app.*` functions 18/18, indexes
  74/74); seed run twice, second run `0 inserted` for every table; `businesses` remains 0 rows —
  consistent with D-01 (spine loaded locally only this phase).
- Deployed e2e at commit `8acee7c` (verified via `/api/health`): 20 passed / 5 skipped (deliberate
  self-skips) / 0 failed, including `sources`, `businesses`, `touch targets`, and the signed-in
  smoke.
- Local desk run (`docs/measurements/03-desk-run.md`): full-scale real ingest (34,928 Comptroller +
  27,903 geocoded + 21,467 closure keys + 56,944 Overture), 79,484 candidate pairs, 1,077
  auto-merges, review queue tuned by danlo to 7,975 after the desk run (cutoff 0.3, phone-lift floor
  0.3). The desk run itself caught and fixed two real defects during execution (a closure
  duplicate-key ordering bug, and the WRITE_LOCATION re-run defect that is the narrow instance of
  Gap 2) — this is good evidence the desk-run discipline works, but it also demonstrates that the
  fuller version of the same bug class (A-CR-02, covering every derived column, not just location)
  was not caught because the desk run's re-runs happened to have zero payload changes.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/lib/normalize/name.ts` | 67-84 | Overly broad token strip (`LEGAL` set matches at any position) | 🛑 Blocker | False auto-merges / false chain flags for common RGV name patterns (Gap 1) |
| `src/lib/ingest/upsert.ts` | 307-333 | Write path ignores merge-cluster membership | 🛑 Blocker | Re-ingest silently reverts survivorship on merge winners / corrupts losers (Gap 2) |
| `drizzle/0024_merge_functions.sql` | ~193-221, ~268-271 | Unlocked read + unconditional final UPDATE in `app.record_merge` | ⚠️ Warning | Concurrent "Same"/"Different" race, silent loss of a reviewer decision (A-CR-01) |
| `src/lib/resolve/merge.ts` | 53-190 | `clusterKey` never assigned outside `emptyView`'s `null` | ⚠️ Warning | Merged business can silently drop `cluster_key` and leave the lead funnel (A-CR-03) |
| `src/app` (repo-wide) | — | No `error.tsx` / `global-error.tsx` anywhere | ⚠️ Warning | A rejected server action or failed read during review/unmerge crashes the whole app to Next's generic error page (C-CR-01) |

## Human Verification Required

None required beyond what danlo already signed off during execution (the confidence cutoff,
blocking threshold, the ten-pair fixture, and the four-screen visual review — all recorded in
`docs/measurements/03-desk-run.md` and `03-VALIDATION.md`). The two BLOCKER gaps below are concrete
code defects with named fixes, not ambiguous items needing human judgment — they need a decision on
**whether to fix them before this phase closes, or accept them as an explicitly overridden,
tracked deferral** (as Phase 2 did for BUDG-03), given Phase 4 is gated on this phase's "durable
record" premise.

## Gaps Summary

The phase delivered a large, carefully tested amount of real infrastructure — two full-scale,
idempotent-by-design ingests measured against real RGV data, a three-tier entity-resolution engine
tuned against 79,484 real candidate pairs with danlo's own review of the confidence distribution,
a reversible merge system with audited events, and a geo-bounding proof that matches the roadmap's
42%-Mexico figure almost exactly. The validation discipline (59 tasks, 13 gate mutations plus 4
variants, all watched red by name and reverted) is real and thorough, and the desk run itself found
and fixed two genuine defects during execution.

However, the phase's own code review (`03-REVIEW.md`, three independent slices, `status:
issues_found` in its own frontmatter) found five CRITICAL defects, and none has been fixed —
HEAD (`1dde7c4`) is the review-report commit itself, with no follow-up commits. Two of the five
were independently reproduced in this verification by direct inspection of the live source and
directly threaten the phase's stated success criteria rather than being edge-case debt:

1. **B-CR-01** breaks name normalization for a naming pattern common among RGV trades (initials —
   "C & L", "J.C.", "A&C"), tracing to false ≥95 auto-merges of distinct businesses. This is
   exactly what success criterion 3 and requirement DEDUP-04 promise will not happen.
2. **A-CR-02** silently reverts D-14 survivorship on merge winners (or corrupts provenance on
   losers) the first time an ordinary re-ingest hits a source payload change on a merged business —
   the case the desk run's clean re-run proof did not happen to exercise, but which its own repair
   of the narrower WRITE_LOCATION instance of the same bug shows is real. This undermines the
   phase's central promise — a *durable* canonical record — on which Phase 4 is explicitly ordered
   to depend (ROADMAP.md ordering constraint 2).

Three further CRITICAL/near-criterion findings (A-CR-01 reviewer race, A-CR-03 dropped
`cluster_key`, C-CR-01 missing error boundary) are real, confirmed, unfixed defects that do not
literally break a stated success criterion's wording but materially weaken the guarantees those
criteria rest on, and are reported as WARNINGs above.

This phase should not be considered goal-achieved until at minimum the two BLOCKER gaps are
resolved (or explicitly overridden by danlo with a recorded reason, per the Phase 2 BUDG-03
precedent) — a closure plan for B-CR-01 and A-CR-02, including the re-derivation of already-computed
`name_norm` values and a re-run of the resolve pass against the corrected normalizer, is the
recommended next step.

---

*Verified: 2026-09-23T18:00:00Z*
*Verifier: Claude (gsd-verifier)*
