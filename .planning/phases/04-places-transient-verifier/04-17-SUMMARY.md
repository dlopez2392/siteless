---
phase: 04-places-transient-verifier
plan: 17
subsystem: places-retention / sources-ui / ops
tags: [D-12, PLACE-02, M50, vercel-cron, retention, sources, runbook]
requires:
  - 04-02 (src/env.ts CRON_SECRET optional, min 16)
  - 04-07 (SOURCES_TRANSIENT_* copy, TOAST_PURGE_COMMAND_COPIED)
  - 04-09 / 04-11 (drizzle/0026–0028: place_coordinates, place_purge_runs, siteless_cron,
    app.purge_expired_place_coordinates, app.places_transient_stats; src/db/with-cron-role.ts)
provides:
  - GET /api/cron/purge-places (timing-safe Bearer CRON_SECRET, fixed-enum bodies)
  - vercel.json crons (the repo's first) — 17 9 * * *
  - scripts/purge-places.ts + `pnpm purge:places --target=test|prod`
  - src/lib/places/purge-status.ts (TransientStats, PURGE_OVERDUE_HOURS, purgeOverdue, PURGE_PLACES_COMMAND)
  - readTransientStats / listSourcesPage in src/server/queries/sources.ts
  - TransientCard / TransientCardSkeleton on /sources
  - docs/runbooks/places.md
affects:
  - src/app/(app)/sources/page.tsx (now calls listSourcesPage)
  - src/components/sources/copy-command-button.tsx (optional label / copiedMessage)
  - src/lib/ui/copy.ts (one copy-gap function added)
tech-stack:
  added: []
  patterns:
    - "cron route: env secret → 503 when unset; Buffer length check before timingSafeEqual; error NAME-only log"
    - "secondary read inside the page's one withOrg runs in a SAVEPOINT so its failure never aborts the primary read"
    - "one DOM tree re-flowed by CSS (phone rows / lg five columns) so each testid exists once"
key-files:
  created:
    - src/app/api/cron/purge-places/route.ts
    - scripts/purge-places.ts
    - src/lib/places/purge-status.ts
    - src/components/sources/transient-card.tsx
    - docs/runbooks/places.md
    - tests/unit/purge-route.test.ts
    - tests/unit/transient-card.test.tsx
    - tests/db/sources-transient.test.ts
  modified:
    - vercel.json
    - package.json
    - src/server/queries/sources.ts
    - src/app/(app)/sources/page.tsx
    - src/components/sources/copy-command-button.tsx
    - src/lib/ui/copy.ts
    - tests/e2e/sources.spec.ts
decisions:
  - "The transient read runs in a savepoint inside listSourcesPage's one withOrg: a failed definer call leaves the ledger standing and the card shows its own error (transient: null)."
  - "purgeOverdue also fires when the purge has NEVER run and a held coordinate is > 36 h old (the CRON_SECRET-never-set case), with its own copy SOURCES_TRANSIENT_PURGE_NEVER_RAN."
  - "The five figures are one tree re-flowed at lg (five right-aligned columns) — no desk/phone twins, so each sources-transient-* testid exists once."
  - "The desk script connects as the migration owner (not siteless_cron) with trigger 'desk'; --target defaults to test, prod requires the flag + session pooler :5432."
metrics:
  duration: ~32 min
  completed: 2026-09-23
  tasks: 3
  files: 15
---

# Phase 4 Plan 17: TTL purge made real and observable Summary

The daily purge now runs on its own: a timing-safe `Bearer CRON_SECRET` Vercel Cron route runs it through `siteless_cron`, and `/sources` gains a dashed "Google Places (transient)" card. The card shows five figures plus a 36-hour purge-overdue warning with a copyable `pnpm purge:places --target=prod` desk fallback. A Places runbook covers the kill switch, the key, the daily quota, the purge and fixtures.

## What was built

**Task 1 — cron route, schedule, desk script (M50)** · `4c59fcf` (RED) → `3156b6b` (GREEN)
- `src/app/api/cron/purge-places/route.ts`: `dynamic = 'force-dynamic'`. The route answers 503 `not_configured` when `CRON_SECRET` is unset, so it fails closed. A missing, wrong or different-length header gets 401 `unauthorized`: the length is checked before `timingSafeEqual`, which throws on unequal buffers. With the right secret it returns 200 `{ ok, orgs, rowsPurged }`, where rowsPurged is the SUM of `purged_rows` over the one-row-per-org result, never a row count. A failure returns 500 `purge_failed` and logs the error NAME only.
- `vercel.json` — `"crons": [{ "path": "/api/cron/purge-places", "schedule": "17 9 * * *" }]`.
- `scripts/purge-places.ts` + `"purge:places"` script. It uses resolve.ts's `--target` gate (defaults to test; prod needs the explicit flag plus the Supabase session pooler on :5432) and refuses unknown flags before any I/O. It runs `app.purge_expired_place_coordinates('desk')` as the owner and prints per-org counts plus the total.
- **Proxy check (plan read_first):** `src/proxy.ts` is a bare `clerkMiddleware()` with no protect or matcher-based auth, so an unauthenticated GET reaches the handler. The bearer check in the route IS the authorization (recorded in the route header).

**Task 2 — the transient card, its query, the overdue rule** · `0da3628` (RED) → `7548141` (GREEN)
- `src/lib/places/purge-status.ts` (pure): `TransientStats`, `PURGE_OVERDUE_HOURS = 36`, `purgeOverdue`, `wholeHoursSince` / `wholeDaysSince`, `PURGE_PLACES_COMMAND`.
- `sources.ts`: `readTransientStats(tx)` reads the bigint text from `app.places_transient_stats()`, turns it into numbers and refuses non-counts. Epoch-ms values go through `instantOf`. `listSourcesPage(claims)` runs `readSources` and then `readTransientStats` in ONE `withOrg`, with the transient read in a savepoint. `SOURCE_KEYS` still has exactly four entries.
- `transient-card.tsx` (server component): a shadcn `Card` with `border border-dashed border-border ring-0`, the title and subtitle, and five figures. Their testids are `sources-transient-place-ids` / `-coordinates` / `-purged` (with `data-count`), `-oldest` (with `data-days`) and `-last-purge`. The Chicago-pinned date goes through `formatLocal` and the counts through `formatCount`.
- Card states:
  - An inline empty state ("No Google Places call yet" → "Open presets").
  - Its own load failure (`SOURCES_TRANSIENT_LOAD_FAILED` → "Try again").
  - The overdue warning `Alert` (`triangle-alert`), with `CopyCommandButton` `sources-transient-purge-copy` labelled "Copy the purge command" and the toast "Purge command copied".
  - A skeleton that paints the title and the five labels.
- `page.tsx`: the card sits below the ledger and above the gone explainer. The Suspense fallback is the ledger skeleton plus the card skeleton. A ledger load failure renders `SourcesLoadFailed` plus the card's own error state.

**Task 3 — deployed spec + runbook** · `75dbbb4`
- `tests/e2e/sources.spec.ts`: a new desk test. `sources-transient` is visible; `place-ids`, `coordinates` and `purged` each carry `data-count` matching `^\d+$`; `oldest` and `last-purge` are visible. Still exactly 4 `sources-row-*` rows, and no ledger hook inside the card. Fixture-free: no `TEST_DATABASE_URL`, no `getByText`.
- `docs/runbooks/places.md`: Kill switch (D-02), The key, Daily quota (D-19), Coordinate purge (D-12), Fixtures (D-20). Its grep count for `PLACES_MODE|CRON_SECRET|google_daily_quota|purge:places` is 7.

## Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src tests scripts` | exit 0 |
| Unit lane `npx vitest run tests/unit` | **65 files, 494 tests, all passed** |
| `tests/unit/purge-route.test.ts` | 7/7, all six plan names in the PASS list plus "is dynamic" |
| `tests/unit/transient-card.test.tsx` | 12/12, including "purge overdue when expired rows await purge", "… more than 36 hours old", "not overdue when fresh", "not overdue before any call", "the transient card renders its five figures before any call", "the transient card is not a ledger row", "oldest coordinates read in days with the 30-day limit", "the overdue alert offers the desk purge command" |
| `tests/unit/sources-ledger.test.tsx` | green (22 tests with transient-card) |
| DB `tests/db/sources-transient.test.ts` | 2/2: "transient stats are read in the sources page's one transaction", "a failed transient read leaves the ledger standing" |
| DB `tests/db/run-report.test.ts` (the /sources DB test) | 3/3 green; `readSources` signature unchanged |
| Full DB lane | 245 passed / **12 failed, all cross-plan noise** (see below) |
| Desk statement | `purge_expired_place_coordinates('desk')` executed as the owner on `siteless_test` inside BEGIN…ROLLBACK: 2 org rows, 0 purged, 2 `desk` purge-run rows, 0 left after the rollback |
| Desk script gate | `--foo` and `--target=staging` both refused before any I/O |
| `npx playwright test --list` | the new spec parses and lists (4 tests in 2 files) |
| `next build` | **NOT run**: 1.9 GB free RAM with 3 parallel agents. tsc + lint are green, and the client-reference trap was checked by hand: the only client import is `CopyCommandButton`, which gets plain strings. 04-30 builds. |
| e2e against the deploy | **NOT run**: Phase 4 is not deployed, and the spec needs 0026–0029 in prod. Written, typechecked and listed. 04-30 runs it. |

### Mutation checks (each applied → red on the named test → reverted → `git status` clean)

| # | Mutation | Red test |
|---|---|---|
| M1 | drop the length check before `timingSafeEqual` | "refuses a secret of a different length without throwing", "refuses a missing header" |
| M2 | unset secret no longer refused | "the purge route refuses without the cron secret" |
| M3 | `rowsPurged = rows.length` (count instead of sum) | "the purge route purges with the right secret" |
| M4 | log `e.message` instead of `e.name` | "the purge route never echoes the secret or an error message" |
| MA | transient read without the savepoint | DB "a failed transient read leaves the ledger standing" |
| MB | drop the `expiredAwaitingPurge > 0` rule | "purge overdue when expired rows await purge" |
| MC | drop `data-days` | "oldest coordinates read in days with the 30-day limit" |
| MD | `toLocaleString` without the pinned zone | "the overdue alert offers the desk purge command" (Sep 22 Chicago vs Sep 23 UTC) |
| ME | `lastPurgeMs` read from `oldest_coordinate_ms` | DB "transient stats are read in the sources page's one transaction" |

## Deviations from Plan

### Auto-fixed / added

1. **[Rule 2 - Correctness] The transient read runs in a savepoint.** The plan's "a load failure … never breaks the ledger" can't hold inside one transaction: a failed statement aborts it (25P02). `listSourcesPage` wraps `readTransientStats` in `tx.transaction(...)`, which is a savepoint on the same connection and not a second `withOrg`, so no pool hang. On failure it logs the error name and returns `transient: null`. The type is `TransientStats | null`. A DB test proves it: the definer is revoked inside the rolled-back transaction → 4 ledger rows and null. Commit `7548141`.
2. **[Rule 2 - Copy gap] `SOURCES_TRANSIENT_PURGE_NEVER_RAN(hours, count)` added to copy.ts.** The plan's `purgeOverdue` fires when the purge has never run, but `SOURCES_TRANSIENT_PURGE_OVERDUE(date, …)` needs a "last ran {date}". The realistic trigger is a deploy without `CRON_SECRET`, exactly when danlo needs the warning. It uses the same voice and the same way out. **Flag for danlo's copy review.** The handoff said to add only what the plan specifies; this is the one addition. Commit `7548141`.
3. **[Rule 2 - Spec fidelity] `CopyCommandButton` gained optional `label` / `copiedMessage` string props.** The button used to render only "Copy the command". The spec names "Copy the purge command", and copy.ts already had `TOAST_PURGE_COMMAND_COPIED` (04-07). This is additive: existing ledger call sites are unchanged. The file wasn't in `files_modified`. Commit `7548141`.
4. **[Rule 3] DB test fixtures are SQL-built.** `seedAttachmentWithObservation` binds a JS `Date`, which the runtime driver refuses (drizzle-executor). It also writes `features {rule:'fixture'}`, which the test DB's `pa_features_numeric` constraint from 0029 rejects. The new test seeds with `now() - make_interval(...)` and `{"nameSim":1}`.
5. **Extra tests beyond the plan list:** "is dynamic", "purge overdue when the purge never ran…", "the overdue alert names a purge that never ran", "shows its own load failure", "skeleton paints the title and the five labels", and DB "a failed transient read leaves the ledger standing".

Not done: running the desk script itself against the DB. It commits append-only `place_purge_runs` rows to the shared test DB. The exact statement was proven inside a rolled-back transaction instead.

## Cross-plan noise (recorded, not fixed)

- **12 DB failures in `places-definers.test.ts` (3) and `places-schema.test.ts` (9).** All are `place_attachments violates check constraint "pa_features_numeric"`. The shared `siteless_test` DB already has 0029 (applied by 04-15), and `tests/db/_places-fixtures.ts::seedAttachmentWithObservation` still writes `features: { rule: 'fixture', nameSim: 1 }`. The constraint isn't in this worktree's migrations. It belongs to **04-15**, which must make the fixture numeric-only.

## For 04-30 / 04-31 (deploy)

1. **Set `CRON_SECRET`** (≥16 chars, random) in Vercel **Production** env before or with the deploy. Without it the route answers 503 on every tick. Once a held coordinate passes 36 h, `/sources` shows the never-ran overdue warning.
2. **Apply 0026–0029 to prod before deploying this code.** Without `app.places_transient_stats()`, the card shows its own load failure (the ledger stands) and the cron answers 500.
3. `app_user` must hold `siteless_cron` (0027 grants it). `withCronRole` has **no DB test through the app client** (the route test mocks it; the definer tests use `set local role` on a pg client). The first real proof is a 200 in the Vercel cron log.
4. **Smoke:**
   - `curl -i <deploy>/api/cron/purge-places` with no header should return 401, or 503 if the secret is unset.
   - Then trigger the job from Vercel → Cron Jobs → Run; expect 200 `{ok:true, orgs:N, rowsPurged:M}`.
   - Then `/sources` should show "Last purge" set and "Rows purged".
5. Run `tests/e2e/sources.spec.ts` against the deployed URL once 0026–0029 are in prod.
6. `next build` has not been run on this branch (memory); the phase verify / 04-30 must.
7. `vercel.json` now declares a cron. Vercel creates it on the production deploy, and it will show under Project → Cron Jobs.

## Merge notes

- `src/lib/ui/copy.ts`: one insertion just above `SOURCES_TRANSIENT_PURGE_COPY`. It conflicts only if another plan edits the transient block.
- `package.json`: one script line after `"rederive"`. `vercel.json`: `crons` added. The lockfile is unchanged.
- `src/server/queries/sources.ts`: `listSources` is kept, now with no call site. The page uses `listSourcesPage`.

## Threat model

- T-4-08 is mitigated: M1/M2 prove the timing-safe gate and that an unset secret is refused.
- T-4-05 is mitigated: M4 proves the bodies are fixed-enum and the log names the error only.
- T-4-07 goes through `withCronRole`.
- T-4-04 is mitigated by the daily purge, the overdue alert and the desk fallback.
- No new surface beyond the plan's register.

## Known Stubs

None. Every figure comes from `app.places_transient_stats()`. The zeros, "None held" and "Never run" are specified static structure (Rule 27), not stubs.

## TDD Gate Compliance

Task 1: `test(04-17)` `4c59fcf` → `feat(04-17)` `3156b6b`. Task 2: `test(04-17)` `0da3628` → `feat(04-17)` `7548141`. Both went RED for the right reason (module not found, then `listSourcesPage is not a function`). No refactor commits.

## Self-Check: PASSED

- The created files exist: route.ts, purge-places.ts, purge-status.ts, transient-card.tsx, places.md, and the three test files.
- Commits `4c59fcf`, `3156b6b`, `0da3628`, `7548141` and `75dbbb4` are present in `git log`.
