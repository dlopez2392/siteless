---
phase: 03-free-data-spine-entity-resolution
plan: 17
subsystem: /sources screen (ingest run ledger)
tags: [ui, rsc, ledger, tone-map, attribution, no-chart-library]
requires:
  - 03-04 (copy.ts strings for /sources, the nav entry)
  - 03-15 (src/server/queries/sources.ts — listSources / SourceLedgerRow, confidence_bands only)
provides:
  - src/app/(app)/sources/page.tsx (the /sources route)
  - src/components/sources/source-ledger.tsx (SourceLedger, LEDGER_SOURCES, ledgerRows, COUNT_KINDS)
  - src/components/sources/confidence-distribution.tsx (ConfidenceDistribution, client)
  - src/components/sources/attribution-block.tsx (AttributionBlock)
  - src/components/sources/sources-skeleton.tsx (SourcesSkeleton)
  - src/components/sources/copy-command-button.tsx (CopyCommandButton, client)
  - src/lib/ui/run-tone.ts IngestRunStatus / INGEST_RUN_TONE / INGEST_RUN_LABEL / INGEST_RUN_STATUSES
  - src/lib/time.ts formatCount (pinned-locale integer formatter)
affects: [03-22 (both-theme screenshots of the real screen), e2e specs for /sources]
tech-stack:
  added: []
  patterns:
    - "static-structure rows looked up by key, never iterated from the query (Executor Rule 27)"
    - "desk and phone trees carry distinct testids (-card / -mobile suffix)"
    - "tiny client islands (copy button, collapsible) inside a server-rendered ledger"
key-files:
  created:
    - src/app/(app)/sources/page.tsx
    - src/components/sources/source-ledger.tsx
    - src/components/sources/confidence-distribution.tsx
    - src/components/sources/attribution-block.tsx
    - src/components/sources/sources-skeleton.tsx
    - src/components/sources/copy-command-button.tsx
    - tests/unit/sources-ledger.test.tsx
  modified:
    - src/lib/ui/run-tone.ts
    - src/lib/time.ts
    - tests/unit/ui-maps.test.ts
    - tests/unit/time.test.ts
decisions:
  - "INGEST_RUN_TONE.running stays 'accent-outline' (shared vocabulary, per plan), but the ledger paints that tone as a neutral outline: 03-UI-SPEC § Color lists the /sources ledger among the places accent does not appear"
  - "Desk testids follow the spec (sources-table / sources-row-{key} / sources-count-{key}-{kind} / sources-confidence-toggle); the phone tree uses sources-cards / sources-card-{key} / sources-card-count-{key}-{kind} / sources-confidence-toggle-mobile, so no hook matches two live elements"
  - "Counts format through a new formatCount in src/lib/time.ts, so no component under src/components/sources calls Intl"
  - "The Overture expansion row is omitted entirely when the run recorded no confidence_bands"
metrics:
  duration: ~75 min
  completed: 2026-09-23
  tasks: 2
  files: 11
---

# Phase 3 Plan 17: The /sources run ledger Summary

`/sources` now renders as a ledger. Each of the four sources is one row. Each row shows the version ingested, the last run in Chicago time, and the four right-aligned `tabular-nums` counts (added, changed, unchanged, gone), each with `data-count`. The Overture row expands into its measured confidence distribution, built from `Progress` and painted divs with no chart library. The foot of the page carries the CDLA-Permissive 2.0 / public-domain / Census attribution, which says none of the data is Google's. Ingest status reuses the Phase 2 tone vocabulary; there is no second tone map.

## What was built

**Task 1: tone map and ledger** (`b72c645`)
- **`run-tone.ts`** gains `IngestRunStatus`, `INGEST_RUN_TONE`, `INGEST_RUN_LABEL` and `INGEST_RUN_STATUSES` next to the Phase 2 maps. It shares `BadgeTone`, and `stopped` reads "Stopped early". The file still has no client directive.
- **`ui-maps.test.ts` › `ingest run tone covers every status`** checks three things:
  - the union equals the `ir_status_known` CHECK list parsed from `drizzle/`;
  - every status has a tone and a word, and the labels equal `copy.ts`'s `SOURCES_RUN_STATUS`;
  - the ingest tones come from the Phase 2 vocabulary (`stopped` gets the same tone as `partial`).
- **`page.tsx`** is an RSC with `force-dynamic` and makes one `listSources(orgClaims())` call, which is one `withOrg`.
  - The title and subtitle paint outside `Suspense`. The fallback is `SourcesSkeleton`, which shows the four real source names with 14px skeleton counts.
  - "No ingest has run yet" renders above the four rows, not in place of them. Its action is an outline link, because the screen has no primary CTA.
  - A load failure renders `SOURCES_LOAD_FAILED` with "Try again". Framework control flow passes through `unstable_rethrow`.
  - The `gone` explainer and the attribution block are static, so they paint even when the load fails.
- **`source-ledger.tsx`** (server component). The rows come from the static `LEDGER_SOURCES` list, and the query's rows are looked up by key. A source missing from the query renders as "Never run" with zeroed counts.
  - Desk: a `Table` on a `Card`, with the header row on the `--sidebar` chrome surface. The source cell holds the name, the dataset id and the status badge.
  - Phone: one `Item` per source, with the name at Heading 20/600, version and last-run rows, and the counts as a 2×2 grid at Body 16/600 tabular.
  - A `failed` run shows a destructive-surface `Alert` inside its own row: `INGEST_RUN_FAILED(name, rows, error, script)` plus "Copy the command". A `stopped` run shows the warning-surface `Alert` with `INGEST_RUN_STOPPED`. The script is `INGEST_COMMAND.overture` for Overture and `INGEST_COMMAND.comptroller` for the other three, since the closure and geocode passes belong to the Comptroller script.
- **`copy-command-button.tsx`** is a small client island. It is an outline button, 44px tall, and it copies exactly the string the alert sentence names.
- **`time.ts` › `formatCount`** formats integers with the locale pinned. It has its own test, `formatCount pins the locale`.

**Task 2: distribution and attribution** (`95a4207`)
- **`confidence-distribution.tsx`** (client) has a closed-by-default `Collapsible`. The trigger reads "Show the confidence distribution" / "Hide the confidence distribution".
  - The height transition is Radix plus tw-animate's `animate-collapsible-*` at 200ms, and it is off under reduced motion. The `motion` library is not used.
  - There is one row per `stats.confidence_bands` key, sorted highest first (`=1.0`, then `0.9–1.0` … `0.0–0.1`, then the no-confidence bucket, then any unrecognised key rendered as itself). Each row shows the label, a `Progress` share bar (a `--muted-foreground` fill on a `--muted` track), the count and the share.
  - A painted 1px marker sits above the first band that lies wholly below `OVERTURE_CONFIDENCE_CUTOFF`. Below the bands is `SOURCES_CUTOFF_LINE("0.50")`.
  - Counts pass through `Number()` and a clamp, and the bar value is clamped to 0–100 (T-3-03). The expected measured shape is recorded in a comment.
- **`attribution-block.tsx`** is a `Card` on `--muted` with muted foreground and `data-testid="sources-attribution"`. It imports `ATTRIBUTION_HEADING`, `ATTRIBUTION_BODY` and `ATTRIBUTION_FOOTNOTE`; none of the text is inlined.
  - Contrast was measured: `--muted-foreground` on `--muted` is 4.80:1 in light and 5.73:1 in dark.
- **`tests/unit/sources-ledger.test.tsx`** (dom lane, 7 tests) covers:
  - four rows before any run;
  - `data-count` pins with the formatted "57,012";
  - the last run rendering "Sep 20, 8:00 PM" for 01:00Z while the suite runs in UTC;
  - failed and stopped alerts inside their rows, with third-party error text rendered as text and not markup;
  - the distribution's order, clamp, cutoff line and marker position;
  - a null-bands render that is empty;
  - the skeleton's static names;
  - the verbatim attribution.

**Polish from the real-screen check** (`5a089a0`)
- Each band is its own grid, so `auto` figure columns made the share-bar tracks end at different x positions. The figure columns now have fixed widths per breakpoint.
- The table primitive's `has-aria-expanded:bg-muted/50` greyed only the distribution row, which split it visually from the Overture line above. That row now stays on the card surface.

## How the screen was checked

- **Built app, signed in, real data, both themes, desk and phone.**
  - I ran `next build` then `next start -p 3117` with `SUPABASE_DB_POOL_URL` overridden to the local `siteless_test` for that process only (`.env.local` untouched, never prod). I signed in through `@clerk/testing` against the dev Clerk instance.
  - A scratch Playwright probe, since deleted, captured desk 1280×1000 and phone 390×844 in light and dark. Each capture asserted `innerHeight > 0` and `visibilityState === 'visible'`.
  - The rows were real: sibling 03-20's local load produced four `Complete` runs.
    - Permits: 34,928 unchanged.
    - Closures: 13 changed and 21,454 unchanged.
    - Overture: 56,944 added, release `2026-08-19.0`.
    - Census: 27,903 unchanged.
  - The distribution showed `0.9–1.0` = 35,270 (61.9%), `0.8–0.9` = 4,920 and `0.7–0.8` = 3,973, which matches the 03-RESEARCH measurement exactly. The cutoff marker sat between 0.5–0.6 and 0.4–0.5.
  - In all four captures:
    - no visible element in `<main>` painted either accent value (`rgb(15, 118, 110)` / `rgb(45, 212, 191)`);
    - there was no horizontal overflow;
    - desk counts computed to `text-align: right` and `font-variant-numeric: tabular-nums`;
    - the attribution background was the painted `--muted` (`rgb(231, 235, 236)` in light, `rgb(29, 39, 42)` in dark).
- **Apparent clip, not a defect.** The first full-page capture showed the open distribution cut off. Measured, the content is `client == scroll` (353px desk, 373px phone) and stays fully open after a real 20px viewport resize. Playwright's full-page capture restarts the CSS animation mid-shot, so later captures use the viewport.
- The formal both-theme review screenshots belong to 03-22.

## Watched red (mutation → red test; each reverted, file confirmed identical to its backup)

| Mutation | Red |
|---|---|
| `INGEST_RUN_LABEL.stopped` → `'Stopped'` | `ingest run tone covers every status` (`expected 'Stopped' to be 'Stopped early'`) |
| `'stopped'` removed from `INGEST_RUN_STATUSES` | `ingest run tone covers every status` (CHECK list mismatch) |
| `formatCount` locale → `undefined` | `formatCount pins the locale` (`expected undefined to be 'en-US'`) |
| `ledgerRows` keeps only sources the query returned | `sources ledger renders four rows before any run`, `sources ledger pins counts…` |
| band `safeCount` clamp removed | `confidence distribution opens to clamped bands and the cutoff line` |

## Gates (final tree `5a089a0`, branch `worktree-agent-a6e1f257aed1f4f00`)

- `pnpm typecheck` exit 0. `pnpm lint` exit 0. `pnpm build` exit 0, and `/sources` is listed as `ƒ` (dynamic).
- `pnpm test:unit`: **35 files, 243 tests, all pass** (the baseline was 234; +1 ui-maps, +1 time, +7 sources-ledger).
- Named tests were filtered with `npx vitest run <file> -t … --reporter=verbose` and I read the names.
- No DB tests: this plan adds no query code.

## Acceptance criteria

All pass except two literal greps, explained below.

- `'Stopped early'` is in run-tone.ts, and run-tone.ts has no client directive.
- `data-count=` and `tabular-nums` are in the ledger.
- No `Intl.` under `src/components/sources/`, and no "Refresh sources" anywhere in `src/`.
- No `recharts` in `src/` or `package.json`.
- `data-testid="sources-attribution"` is present, and the block imports `ATTRIBUTION_BODY`.
- `tabular-nums` and `OVERTURE_CONFIDENCE_CUTOFF` are in the distribution.
- The verification grep `bg-card|rounded-|border border-` hits only the shadcn `Item` primitive, twice (ledger and skeleton).

The two exceptions:

1. **`grep -c 'data-testid="sources-row-'` returns 0.** The row testid is a JSX template literal, ``data-testid={`sources-row-${sourceKey}`}``, generated for all four keys from `LEDGER_SOURCES`. The render test checks all four.
2. **`grep -n "motion" confidence-distribution.tsx` is not empty.** The hits are Tailwind's `motion-reduce:` variant on the collapsible and the chevron, plus one comment line explaining that. There is no import of the `motion` library. Every Tailwind spelling of the reduced-motion variant contains the word, and dropping it would break the UI-SPEC requirement to disable the animation under reduced motion.

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 3 - Blocking] `formatCount` added to `src/lib/time.ts`, with a test in `tests/unit/time.test.ts`.** No pinned-locale integer formatter existed, and the acceptance criterion forbids `Intl.` in `src/components/sources/`. Existing components call `Intl.NumberFormat(APP_LOCALE)` inline. Commit `b72c645`.
2. **[Rule 3] `src/components/sources/copy-command-button.tsx` added.** "Copy the command" needs a clipboard click handler. A client island keeps the ledger a server component. Commit `b72c645`.
3. **[Rule 2 - Correctness] `tests/unit/sources-ledger.test.tsx` added.** The plan's checks are greps, and a grep cannot see that four rows render with no data, or that bars clamp. Commit `95a4207`.
4. **[Rule 2] Distinct phone testids** (`sources-cards`, `sources-card-{key}`, `sources-card-count-{key}-{kind}`, `sources-card-status-{key}`, `sources-confidence-toggle-mobile`). The desk and phone trees are both in the DOM, and one testid on two elements is the recorded silent-`.first()` failure (02-10).
5. **[Rule 2] Load-failure state** (`SOURCES_LOAD_FAILED` + "Try again") and the page-level empty state. Both are in the UI-SPEC state tables but not in the plan's task text.
6. **[Rule 1] Two visual defects found on the built-app capture:** the ragged bar tracks and the grey expanded row. Fixed in `5a089a0`.
7. **The `running` tone renders neutral on this screen.** The plan fixes `running: 'accent-outline'` in the shared map, and the UI-SPEC says the /sources ledger carries no accent. The map follows the plan, the ledger's class map paints that tone as a neutral outline, and the word "Running" still distinguishes it.
8. **Static dataset ids.** `jrea-zgmq` and `3kx8-uryv` render on the two Comptroller rows even before a run. After a run, the run's own `dataset_id` wins; the local Overture run recorded `theme=places/type=place`, and that is what renders.
9. **Socrata versions render as a Chicago date.** A `source_version` that is an ISO instant (Socrata `rowsUpdatedAt`) renders through `formatLocal` as "Sep 19, 2026". An Overture release or `Public_AR_Current` renders verbatim.

### Copy gaps (recorded; `src/lib/ui/copy.ts` NOT edited)

- **Clipboard success toast.** No string exists. A local `Copied: {command}` lives in `copy-command-button.tsx`.
- **A failed run with no recorded error text.** A local `no error text was recorded` lives in `source-ledger.tsx`, and fills `INGEST_RUN_FAILED`'s `{error}`.
- **The no-confidence band label.** A local `No confidence` lives in `confidence-distribution.tsx`. The numeric band labels ("0.9–1.0", "1.0") are derived from the keys, not copy.
- **"Running" badge word.** It lives in `INGEST_RUN_LABEL` as the plan specifies. `copy.ts`'s `SOURCES_RUN_STATUS` has only the three terminal words, and the test pins those three to each other.
- **Never-run version cell.** It renders "—". The spec fixes "Never run" for the last-run cell only.

## Known Stubs

None. Every figure on the screen comes from `listSources`. The four static rows are specified structure, not stubs.

## Threat Flags

None beyond the plan's register.
- T-3-09: one `withOrg` behind the layout's `requireOrg()`.
- T-3-03: React text nodes only, and no `dangerouslySetInnerHTML`. The test proves error markup renders as text. Counts and bars are clamped.
- T-3-11: counts, versions, status and error text only.
- T-3-14: the attribution block is present and verbatim.

## Self-Check: PASSED

- FOUND: src/app/(app)/sources/page.tsx, src/components/sources/{source-ledger,confidence-distribution,attribution-block,sources-skeleton,copy-command-button}.tsx, tests/unit/sources-ledger.test.tsx
- FOUND commits: b72c645, 95a4207, 5a089a0
- No file deletions in `822b3c7..HEAD`. STATE.md and ROADMAP.md were not touched. The scratch probe was deleted and the 3117 server was stopped (my PID only).
