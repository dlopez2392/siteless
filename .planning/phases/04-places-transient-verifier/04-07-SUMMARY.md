---
phase: 04-places-transient-verifier
plan: 07
subsystem: ui-copy
tags: [copy, ui-spec, stopped-reasons, run-kinds, places-format, attribution, server-safe]
requires:
  - phase: 04-03
    provides: HOST_CLASSES / HostClass (src/lib/places/host-class.ts)
  - phase: 04-05
    provides: StopReason / FailReason (src/workflows/places-sweep/reducer.ts)
  - phase: 04-06
    provides: PlaceFeatures (src/lib/places/match.ts), read structurally
  - phase: 04-08
    provides: GoogleMapsTag with an inline 'Google Maps' literal (handoff)
provides:
  - STOPPED_REASONS / StoppedReason / RUN_KINDS / RunKind / RUN_KIND_LABEL (run-tone.ts)
  - STOPPED_REASON and the whole Phase 4 copy section (copy.ts)
  - HOST_CLASS_SENTENCE / HOST_CLASS_SHORT_LABEL (copy.ts)
  - signalSentence / hostClassLabel / HOST_CLASS_ORDER / placesChips / PlacesChip / mapsUrlFor (places-format.ts)
  - 04-UI-SPEC Amendment 1 (copy gaps settled)
affects: [04-14, 04-17, 04-21, 04-23, 04-24, 04-25, 04-26, 04-27, 04-28, 04-31]
tech-stack:
  added: []
  patterns:
    - "Phase 4 copy functions take counts as numbers (formatCount inside) and money as µUSD (formatUsd inside); instants and durations arrive pre-formatted"
    - "Drift test = compile-time Assert over the reducer's unions + exhaustive `satisfies Record<…, true>` list + a walk of every `stopped_reason = '…'` literal in drizzle/ and src/"
key-files:
  created:
    - src/lib/ui/places-format.ts
    - tests/unit/places-format.test.ts
  modified:
    - src/lib/ui/run-tone.ts
    - src/lib/ui/copy.ts
    - src/components/places/google-maps-tag.tsx
    - tests/unit/ui-maps.test.ts
    - .planning/phases/04-places-transient-verifier/04-UI-SPEC.md
key-decisions:
  - "Phase 4 copy formats its own numbers: counts go through formatCount and money through formatUsd inside copy.ts, so a caller cannot pass in '1284' or '$2.3'. Dates and durations stay pre-formatted (formatLocal at the call site)"
  - "RUN_MODE_REFUSED renders the mode as words ('switched off' / 'switched to IDs-only mode' / 'switched to Enterprise mode'), never the env value"
  - "RUN_NEVER_STARTED is a constant and RUN_ABANDONED(cost) takes only the cost; the preset name belongs to the action RUN_OPEN_PRESET(name), not the body. The minute figures interpolate RUN_NEVER_STARTED_AFTER_MINUTES / RUN_ABANDONED_AFTER_MINUTES"
  - "RUN_NO_GEOMETRY accepts one name or a list ('A, B and C … tile them'), because 04-26 calls it with a list of names"
  - "google_daily_quota is warning (partial), not destructive: the second wall working as designed (D-19)"
  - "placesChips renders no zip chip: the listing's address is never stored, so there's no postcode to compare"
metrics:
  duration: ~55m
  completed: 2026-09-23
  tasks: 3
  files: 7
---

# Phase 4 Plan 07: Phase 4 copy, run-kind and stopped-reason maps, Places formatters Summary

All Phase 4 user-facing strings now live in `copy.ts`, a server-safe module. The research round's copy gaps are settled and recorded as UI-SPEC Amendment 1. `run-tone.ts` gains the `STOPPED_REASONS` and `RUN_KINDS` unions, and a drift test pins them to the places-sweep reducer at compile time. `places-format.ts` is the one formatter for host-class sentences and labels, the Google-listing chips and the Maps link.

## What was built

- **`src/lib/ui/run-tone.ts`**
  - `STOPPED_REASONS` has eight keys: the reducer's six `StopReason | FailReason`, plus `never_started` and `abandoned`.
  - Also new: `StoppedReason`, `RUN_KINDS`, `RunKind`, and `RUN_KIND_LABEL` ("Full sweep", "This week's partition", "Change check").
- **`src/lib/ui/copy.ts` Phase 4 section** (`// ─── Phase 4 (04-UI-SPEC § Copy Table) ───`)
  - It covers every Copy Table row and every § States Empty/Error string. Constants are named by screen prefix: `GOOGLE_MAPS_TAG`, `RUN_REPORT_*`, `RUN_SUMMARY_*`, `RUN_STOP_*`, `RUN_TRUNCATION_*`, `RUN_*` cards and columns, `RUN_ANNOUNCE_*`, `PRESET_*`, `PLACES_MODE_NOTICE_{OFF,IDS_ONLY}_*`, `RUN_DRAWER_*`, `REVIEW_FILTER*`, `REVIEW_REMAINING_*`, `REVIEW_GOOGLE_*`, `PLACES_CHIP`, `REJECT_*`, `BUSINESS_GOOGLE_*`, `DETACH_*`, `SOURCES_TRANSIENT_*`, `SECOND_WALL_*`, `SECOND_WALL_SET_*` and `TOAST_*`.
  - `STOPPED_REASON` is a `Record<StoppedReason, string>`.
  - `HOST_CLASS_SENTENCE` covers all six classes. `HOST_CLASS_SHORT_LABEL` covers the five non-`none` classes.
  - Gap strings: `RUN_STOP_DAILY_QUOTA`, `RUN_FAILED_ERROR`, `RUN_NEVER_STARTED`, `RUN_ABANDONED`, `RUN_ALREADY_IN_PROGRESS`, `RUN_OPEN_RUNNING`, `RUN_NO_GEOMETRY`, and `RUN_ESTIMATE_LINE` with the D-18 request ceiling.
  - `PHASE4_RUN_NOTICE` is left in place; 04-26 retires it.
- **`src/lib/ui/places-format.ts`**, which has no client directive, no `server-only` and no `Intl`:
  - `signalSentence`, `hostClassLabel` and `HOST_CLASS_ORDER`;
  - `placesChips(features: unknown): PlacesChip[]`, which reads 0|1 flags strictly and never throws on malformed jsonb;
  - `mapsUrlFor(placeId, name, city | null)`, with a fixed origin and every component encoded.
  - Its header binds every importer to `GoogleMapsTag` (Rule 28).
- **`GoogleMapsTag`** now renders `{GOOGLE_MAPS_TAG}` from `copy.ts`. This completes the 04-08 handoff; the inline literal and its comment are gone.
- **04-UI-SPEC Amendment 1** is inserted before § Checker Sign-Off. It lists each settled string with its tone and way out, plus the D-18 and D-19 rationale and the mode-refusal wording.

## Tests (named, each seen red, then green)

`tests/unit/ui-maps.test.ts` (13 tests; 5 new):
- "every run kind has a label"
- "the reducer's stop and fail reasons are stopped reasons" has three layers:
  - a compile-time `Assert<StopReason | FailReason extends StoppedReason ? true : false>`;
  - an exhaustive `satisfies Record<StopReason | FailReason, true>` runtime list;
  - a walk of every `stopped_reason = '<key>'` literal in `drizzle/*.sql` and `src/`. This walk is two-sided: it must find `never_started` (migration 0027) and `budget_cap_reached` (`queue-run.ts`).
- "every stopped reason the executor can write has copy"
- "phase 4 copy matches the UI-SPEC copy table"
- "the settled copy gaps name the number and say what happened to the money"

`tests/unit/places-format.test.ts` (4 tests): "signal sentence for every host class", "host class labels are fixed and ordered", "google chips read the numeric features", "the maps link is built from the place id and our own names only".

`tests/unit/google-maps-tag.test.tsx` "the google maps tag is exact text with translate=no" stayed green after the swap.

### Mutation checks (each applied, the named test went red, reverted, diff clean)

| Mutation | Red test |
|---|---|
| drop `google_daily_quota` from `STOPPED_REASONS` | "the reducer's stop and fail reasons…" (runtime) **and** `tsc` TS2322/TS2344 at the Assert line |
| `partition` label → "This weeks partition" | "every run kind has a label" |
| `never_started` → `never_startedX` | "the reducer's stop and fail reasons…" ("never_started is written but has no copy") |
| `GOOGLE_MAPS_TAG` → "Google maps" | "phase 4 copy matches…" **and** google-maps-tag "exact text with translate=no" |
| truncation heading singular → "tiles" | "phase 4 copy matches…" |
| `STOPPED_REASON.google_daily_quota` → the raw key | "every stopped reason… has copy" ("renders a machine key") |
| `RUN_ESTIMATE_LINE` drops "· {n} requests" | "the settled copy gaps…" |
| `mapsUrlFor` place id unencoded | "the maps link is built…" |
| `flag(f.city) === 1` → `f.city` (truthy) | "google chips read the numeric features" |
| swap `social`/`directory` in `HOST_CLASS_ORDER` | "host class labels are fixed and ordered" |
| social sentence loses ", not a website" | "signal sentence for every host class" |

## Gates

- `npx tsc --noEmit`: exit 0
- `npx eslint src tests scripts`: clean
- `npx vitest run tests/unit`: **60 files, 442 tests passed**
- prettier `--check --end-of-line auto` is clean on every new or edited region. See Deferred for the two pre-existing lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] My own test over-asserted on `abandoned`**
- **Found during:** Task 2 GREEN
- **Issue:** I added `expect(sentence).not.toContain(reason)` to the stopped-reason test. The plan's verbatim sentence "…was marked abandoned." contains the key `abandoned`, which is also an ordinary English word.
- **Fix:** I removed that line. The underscore check is what detects a raw machine key, and it stays.
- **Commit:** 19e7ab3

### Signature adjustments to fit downstream callers (Rule 3)

These plans consume the copy, so their call sites decided the shapes:
- `RUN_NO_GEOMETRY(units: string | readonly string[])`, because 04-26 calls `RUN_NO_GEOMETRY(names)`.
- `RUN_NEVER_STARTED` is a constant, not `(presetName)`, and `RUN_ABANDONED(cost)` does not take `(cost, presetName)`. The preset name only ever appears in the action, `RUN_OPEN_PRESET(name)`, and an unused parameter fails lint.
- `RUN_MODE_REFUSED(mode: 'off' | 'ids_only' | 'enterprise')` renders words, as recorded in the amendment.

### Additions beyond the plan's list

- **The unset second-wall strings** `SECOND_WALL_TITLE`, `SECOND_WALL_NEEDS_BADGE` and `SECOND_WALL_CONSOLE_LINK`. 04-31 references `SECOND_WALL_*`. The two derivation paragraphs contain inline `<strong>` runs, so they stay with 04-31's markup.
- **`REVIEW_CLEAR_BODY_WITH_GOOGLE`** is new. Phase 3's `REVIEW_CLEAR_BODY` is untouched, so 04-24 switches over when it wires the Google kind.
- **Two extra tests:** "the settled copy gaps…" and the writer walk inside the reducer test.

## Merge notes for the orchestrator / downstream plans

- **Money parameters are µUSD (`bigint | number`), never pre-formatted strings.** 04-23's text shows `RUN_ESTIMATE_LINE(lo, hi, formatUsd(RUN_CEILING_MULTIPLIER × hi), ceilingRequests)`. Pass the µUSD value instead; `tsc` refuses a string.
- **Counts are numbers.** Dates and durations are strings pre-formatted with `formatLocal`.
- **`PLACES_MODE` in the notices is plain text.** The spec's backticks were typesetting. If a screen wants code styling, it can wrap the token itself.
- **Rule 35's existing leak is not fixed here.** `src/components/spend/by-run.tsx` `stoppedReasonOf()` still prints the raw key. This plan did not own that file. Whichever plan edits `by-run.tsx` (04-14's `RunStatusBadge` extraction) should switch it to `STOPPED_REASON[reason]`.
- **`copy.ts` is now ~1,800 lines.** Parallel UI plans should only import from it. Any new string should come back through this section so the file doesn't become a merge hotspot.

## Deferred Issues

- Two lines were already not prettier-clean at base `31c88dc`, outside this plan's regions: `copy.ts` `FLAG_CHAIN_LABEL` and the `run-tone.ts` `BadgeTone` union. `prettier --write` reflowed them, and I restored them to keep the diff scoped. They are out of scope.

## Known Stubs

None. Every export is final copy or a pure formatter; nothing renders placeholder data.

## Threat Flags

None. The mitigations for T-4-11, T-4-05 and T-4-13 are implemented as planned: an encoded, fixed-origin Maps URL; no Google-text parameters; and a header that binds importers to `GoogleMapsTag`.

## TDD Gate Compliance

Each task has a `test(04-07)` RED commit followed by a `feat(04-07)` GREEN commit: 324424e → 1af8304, 6cbb2c0 → 19e7ab3, 78706af → 30dd7ac. As the plan specified, Task 1's "every stopped reason… has copy" stayed red, and `tsc` failed on the missing `STOPPED_REASON` import, until Task 2 landed.

## Self-Check: PASSED

- FOUND: src/lib/ui/places-format.ts, tests/unit/places-format.test.ts, src/lib/ui/run-tone.ts, src/lib/ui/copy.ts, src/components/places/google-maps-tag.tsx, tests/unit/ui-maps.test.ts, 04-UI-SPEC.md (`## Amendment 1`)
- FOUND commits: 324424e, 1af8304, 6cbb2c0, 19e7ab3, 78706af, 30dd7ac
- Acceptance greps all matched: `export const STOPPED_REASONS` (8 keys), `StopReason | FailReason` in ui-maps.test.ts, `export const STOPPED_REASON: Record<StoppedReason, string>`, `## Amendment 1`, `PHASE4_RUN_NOTICE` still present, and `encodeURIComponent` in places-format.ts.
