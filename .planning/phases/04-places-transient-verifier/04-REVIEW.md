---
phase: 04-places-transient-verifier
reviewed: 2026-09-24
depth: standard (three parallel slices, cross-file data contracts traced)
files_reviewed: 204
status: issues_found
findings:
  critical: 7
  warning: 36
  info: 23
  total: 66
parts:
  - 04-REVIEW-partA.md  # database + server — 0 CR / 13 WR / 7 IN
  - 04-REVIEW-partB.md  # Places core + placesSweep workflow — 3 CR / 10 WR / 7 IN
  - 04-REVIEW-partC.md  # UI — 4 CR / 13 WR / 9 IN
---

# Phase 4 Code Review: consolidated

The review ran as three parallel `gsd-code-reviewer` slices over the 204 source, test and config files the phase changed. The phase scope was computed as `origin/main...HEAD`, excluding `.planning/`, markdown, drizzle snapshots and fixture JSON. Each part file holds the full findings, with line references and concrete fixes; this file indexes them.

## Critical (7)

| ID | Summary | Orchestrator check |
|---|---|---|
| B-CR-01 | `match.ts` marks a place out of area unless `formattedAddress` ends in `USA`. The request sends `regionCode: 'US'`, which makes Google leave the country off, so every real US result would be dropped and the anonymizer would flag it as Mexico. | **Confirmed in code** (match.ts L126, request.ts L103; every fixture ends in `, USA`) |
| B-CR-02 | Retries re-buy pages. `runSearchTile` always restarts at page 1, keeps no page tokens, and doesn't skip a search that is already `done`. Google bills twice and the 100/day quota runs down. | per partB |
| B-CR-03 | Two radius presets in one county with the same radius share tile keys, because the unit id has no centre. `plan_run_searches` doesn't refresh the rectangle, so tiles and memberships cross-contaminate. | per partB |
| C-CR-01 | `run-drawer.tsx` doesn't catch a rejected `queueRun`, so a network error or deploy replaces the preset page with the error screen, and the user can't tell whether a run started. | per partC |
| C-CR-02 | The version-history "Run version N" buttons ignore `PLACES_MODE`. In production (off) they are clickable, show a false "switched off after this page loaded" message, and loop. | Known 04-27 flag, now rated Critical |
| C-CR-03 | "Every tile was searched" shows on failed or stopped runs that found zero places, including a run that failed with no key. | per partC |
| C-CR-04 | Old run reports quote the current month's cap and reset date as if they were the run's own. | per partC |

## Warnings (36): see the part files

Highest consequence, all before D-04 (04-32):
- **A-WR-01** An auto-attached listing can be downgraded by a later, lower-scoring match. The result depends on step order, and a lost website becomes a false "no website" lead.
- **A-WR-02 / B-WR-03** A saturated change check marks members past the 60-result cap `gone`, which corrupts the history.
- **A-WR-03** Confirming one side of a tie leaves the partner tentative, so a place can be attached to two businesses.
- **A-WR-04** A merge leaves the loser's attachments behind, and the survivor's signal ignores them.
- **A-WR-05** The `events` audit rows copy every `place_attachments` change (`place_id` + features) forever. This is **not in `docs/legal/places-persistence.md`**, so the D-01 persistence list doesn't match the code.
- **A-WR-06** `pa_features_numeric` still admits `nameSim` and `distanceM`, which D-01 says are never stored. Only TypeScript enforces this today.
- **A-WR-07** `record_places_page` accepts an Essentials SKU, which would write false "no website" observations that can never be changed.
- **A-WR-08** Phase 4 now races the unlocked `settle_reservation` (0019): `settleInFlight` settles on replay while a page view releases the expired hold.
- **B-WR-01 / B-WR-02** Saturation counts only exactly 60 results, and the novelty rule stops dense tiles from splitting.
- **B-WR-07** `stepError` never sees a SQLSTATE, because `DrizzleQueryError` wraps it.
- **C-WR-01** The listing chips drop the address points and the "same ZIP" chip.
- **C-WR-02** Two Places-derived numbers render without the Google Maps tag.
- **C-WR-03** A failed live refresh blanks the whole run report.
- **C-WR-05** "Nothing is reserved" is false for the free check (1 µUSD hold).
- **C-WR-11** `spend.spec.ts` can pass without testing anything.

## Info (23): see the part files

Includes A-IN-01 (a change check records `pages_done = 1`; it is Info because nothing reads the column), A-IN-02 (run-report labels for change-check runs), the known accented-city SAB miss (B, `candidates.ts:145`, deferred: needs a folded-city column), and C-IN-01 (the tiered chip wording differs from UI-SPEC L535; this needs danlo's approval, including the trade-off that nothing warns when a listing is more than 2 km away).

## Confirmed sound

Across all three slices:
- **Tenancy:** every definer takes the org from the claims and re-checks every id, tie partners included.
- **Retention:** tenants cannot read `place_coordinates`; only `siteless_cron` can run the purge; the cron route uses a constant-time bearer check and refuses without its secret.
- **Money:** the admission hold is released and never settled, including on a `start()` failure. The mode gate runs before any reservation. The charged/released split and per-attempt request ids are correct. A daily-quota 429 stops the run as partial.
- **Matching:** the 95/80 bands work; merged businesses are excluded; the candidate query goes through `tx.execute`.
- **Stored data:** features are integer-only in TypeScript; no Google text reaches payloads, errors or logs; no NUL crosses a step boundary.
- **UI:** no server component imports data from a client module; no mutation uses a `<form action>`; dates are formatted in Chicago time with the locale pinned; no e2e spec clicks a run confirm.
