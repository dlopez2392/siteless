---
phase: 04-places-transient-verifier
plan: 30
subsystem: deploy / production database / cron / e2e
tags: [production-migration, supabase, vercel, vercel-cron, retention, playwright]
requires:
  - 04-29 (D-01 legal gate recorded)
  - migrations 0026_places_tables, 0027_places_grants_triggers, 0028_places_meter_retention, 0029_places_writers
  - 04-17 (/api/cron/purge-places route contract), 04-26/04-27 (no spec clicks a run confirm)
provides:
  - production Supabase at journal 30 (0026-0029 applied once, second run a proven no-op) — NEVER RE-APPLY
  - production deployment dpl_GsSdZJYNe6oS7UcjSDHr29baJCzH serving 8218042 from the phase branch
  - CRON_SECRET on Vercel Production (Sensitive); purge cron 17 9 * * * registered
  - PLACES_MODE unset (= off) and no GOOGLE_PLACES_API_KEY anywhere
affects:
  - docs/deploy.md (Phase 4 migration row, "what the run taught", CRON_SECRET/PLACES_MODE, live deployment)
  - .planning/phases/04-places-transient-verifier/deferred-items.md (started in Task 1)
tech-stack:
  added: []
  patterns:
    - "Post-flight parity as member-for-member set diffs (constraints contype<>'n', columns, indexes, policies, grants, app.* functions, triggers, views, RLS flags), not counts"
    - "Sensitive Vercel secret: CSPRNG into a scratch file outside the repo, stdin into `vercel env add --sensitive`, used once for the smoke, deleted in the smoke's own command"
key-files:
  created:
    - .planning/phases/04-places-transient-verifier/04-30-SUMMARY.md
    - .planning/phases/04-places-transient-verifier/deferred-items.md
  modified:
    - docs/deploy.md
decisions:
  - "Task 2 answered by danlo 2026-09-24: apply. Verbatim reply \"Go with your recommendations\", given to the executor's recommendation of `apply`."
  - "CRON_SECRET stored Sensitive (not pullable); the smoke used the generated scratch file instead of `vercel env pull`, which cannot return a sensitive value"
  - "No db:seed:prod — Phase 4 adds no reference table; the stale general_contractor built-in stays (inert, deferred-items.md)"
metrics:
  duration: "Task 1 on 2026-09-23; Task 3 ~15 min on 2026-09-24 (11:08-11:23Z)"
  completed: 2026-09-24
  tasks: 3
  files: 3
---

# Phase 4 Plan 30: Production migrate, cron secret, deploy with Places off — Summary

Production went from journal 26 to 30 with one run of `db:migrate:prod`. The catalog then
confirmed the whole retention barrier and tenancy. A second migrate changed nothing. Parity
with local is exact across nine member-for-member sets. `CRON_SECRET` is set (Sensitive) and
`PLACES_MODE` stays unset (= off). `8218042` is live as `dpl_GsSdZJYNe6oS7UcjSDHr29baJCzH`,
and `/api/health` echoes that sha. The cron route returned 401 without the secret and 200
with it, and the purge cron is registered. The deployed e2e suite: 22 passed, 10
self-skipped, 0 failed.

## Task 1: read-only production pre-flight (2026-09-23, commit `8218042`)

The results were recorded in `deferred-items.md` and shown to danlo at the checkpoint. The
read was one `begin read only` transaction as the owner; `transaction_read_only` was `on` at
start and end.
1. journal = **26**, last `0025_review_fixes_spine`
2. active runs: **5 `queued`** in org `26491ff8…`, all older than 15 minutes, so 0027 fails
   all five. 04-09's blocker read came back empty.
3. roles: `app_user` present; `siteless_cron` absent
4. `businesses` = **0**
5. `general_contractor` `places_type` built-in present (`org_id IS NULL`). The plan's query
   names column `term`, but the real column is `value`. The first attempt raised `42703`
   inside the read-only transaction, so nothing was written.
6. PostgreSQL **17.6**

## Task 2: the gate (checkpoint:decision)

**danlo answered `apply` on 2026-09-24.** His verbatim reply was **"Go with your
recommendations"**, given to the executor's recommendation of `apply` (apply 0026–0029 and
deploy with `PLACES_MODE` off). No write happened before that reply.

## Task 3: migrate, verify, no-op, env, deploy, smoke, e2e

**Step 0: fresh gates immediately before the write.** Branch
`gsd/phase-04-places-transient-verifier`; HEAD `8218042`, the same before and after.
- The pre-flight re-ran read-only: journal 26; `index_blockers_0409` = `[]`; 5 stale queued
  runs. After 0027's data fix, no org can hold more than one active run.
- `npx vitest run tests/unit/pg17-compat.test.ts`: 2/2 passed
- `npx tsc --noEmit`: exit 0
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0
- `npx next build`: exit 0, "workflows build complete (8 steps, **1 workflow**)"

**Step 1: `$PNPM db:migrate:prod`, once.** It ran 11:11:14Z–11:11:27Z, exited 0 and printed
`[✓] migrations applied successfully!`. The applied set was 0026, 0027, 0028 and 0029, read
from the journal in step 2 rather than from that banner.

**Step 2: post-flight** on a separate, later `begin read only` connection, from the catalog:

| Check | Result |
|---|---|
| journal | **30**, ending `0029_places_writers` by name (last `created_at` 1790195198325) |
| the eight tables | all present: place_attachments, place_coordinates, place_observations, place_purge_runs, place_tile_members, place_tiles, run_place_outcomes, run_searches |
| `authenticated` table grants | exactly `SELECT` on the seven; **none** on `place_coordinates` |
| `has_table_privilege(…,'place_coordinates','SELECT')` | authenticated **false**, anon **false**; anon holds nothing on any new table |
| `has_column_privilege('authenticated','runs','ceiling_requests','UPDATE')` | **false** |
| `prosecdef` | **true** for all eight: decide_place_attachment, mark_run_search, places_transient_stats, plan_run_searches, purge_expired_place_coordinates, record_change_check, record_places_page, release_reservation |
| purge EXECUTE (`app.purge_expired_place_coordinates(text)`) | authenticated **false**, anon **false**, service_role **false**, siteless_cron **true** |
| `siteless_cron` | exists, NOLOGIN; `pg_has_role('app_user','siteless_cron','MEMBER')` **true** |
| `business_place_signal` reloptions | `{security_invoker=true}` |
| indexes | `runs_one_active_per_org` (`UNIQUE … (org_id) WHERE status = ANY ('queued','running')`) and `businesses_latlng_idx` present |
| constraints | `pa_features_numeric`, `pc_expiry_within_30_days` present |
| runs | 5 × `failed / never_started`, all 5 with `finished_at` |
| new-table row counts | all 0 |
| parity with local (public), member-for-member | constraints (`contype <> 'n'`) 167/167, columns 398/398, indexes 107/107, policies 108/108, table grants 267/267, `app.*` functions 29/29, triggers 32/32, views 1/1, RLS flags 29/29, with **0 only-prod and 0 only-local on every set** |

**Step 3: second run.** `$PNPM db:migrate:prod` exited 0, printing the same banner (which
drizzle-kit prints either way). A separate read-only read afterwards found the journal
**still 30**, with the last `created_at` unchanged, so the second run was a no-op.

**Step 4: env.**
- Before: Production held six names, and there was no `CRON_SECRET`, `PLACES_MODE` or
  `GOOGLE_PLACES_API_KEY`.
- `CRON_SECRET` came from `crypto.randomBytes(32)` as 64 hex characters (checked by length
  and hex pattern only). It was written to a scratch file in the session scratchpad, outside
  the repo, then fed on stdin to
  `vercel env add CRON_SECRET production --sensitive --scope team_8zjV46sJxQDsVzikNQa1JaO2`.
  The CLI answered `✓ Added CRON_SECRET · Production · Sensitive`. The value was never
  printed.
- After, `vercel env ls production` listed `CRON_SECRET, SUPABASE_DB_POOL_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL, CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
  `PLACES_MODE|GOOGLE_PLACES_API_KEY` matched **0** times across all environments.
- Fluid compute (research A10): `resourceConfig.fluid = true`, default timeout 300 s,
  region `iad1`.

**Step 5: deploy and smoke.**
- Pre-deploy checks: the tree was clean, no untracked or ignored `.ts` existed outside
  `.vercelignore`, `.claude/` is excluded, and `origin/main` had nothing ahead of HEAD
  (`origin/main` = `3dd2060`).
- `vercel deploy --prod --yes --scope team_8zjV46sJxQDsVzikNQa1JaO2` ran 11:14:09Z–11:15:12Z,
  exited 0 and returned **`dpl_GsSdZJYNe6oS7UcjSDHr29baJCzH`**: READY, target production,
  aliased to `https://siteless-iota.vercel.app`. The per-deployment URL is
  `https://siteless-6207dz148-danlopez508-8452s-projects.vercel.app`.
- The remote build printed "8 steps, 1 workflow" and every route, `/api/cron/purge-places`
  included. The CLI's "Error while parsing config file: pnpm-lock.yaml" is the known noise
  line (03-21).
- The build log names no sha, so the served commit is the evidence. The deployment record's
  `meta.githubCommitSha` = `8218042b382e1810f9e9c55d0d3a6846b3f15e8d` and `githubCommitRef` =
  the phase branch.
- The migrate→live gap was about 3m45s.

| Smoke | Result |
|---|---|
| `GET /api/health` | `200 {"ok":true,"db":"up","proxy":"up","commit":"8218042b382e1810f9e9c55d0d3a6846b3f15e8d"}`, equal to `git rev-parse HEAD` at deploy |
| signed-out `GET /` | `307 → /presets` |
| `GET /api/cron/purge-places`, no header | `401 {"ok":false,"reason":"unauthorized"}` (not 503, so the secret is present) |
| same, wrong bearer | `401 {"ok":false,"reason":"unauthorized"}` |
| same, `Authorization: Bearer <secret from the scratch file>` | `200 {"ok":true,"orgs":1,"rowsPurged":0}` |
| scratch secret file | deleted in the same command as the smoke; verified absent |
| side effect, read back read-only | one `place_purge_runs` row: org `26491ff8…`, `trigger = cron`, `rows_purged = 0`, 11:15:24Z; journal still 30 |
| cron registration (`/v9/projects/…`) | `crons.definitions` = `[{ path: /api/cron/purge-places, schedule: "17 9 * * *" }]`, `deploymentId = dpl_GsSdZJYNe6oS7UcjSDHr29baJCzH` (before: `definitions: []` on `dpl_2WgEDVgD1Rr8f2EhEaYdeDvfqvvb` / `main` `3dd2060`) |

**Step 6: deployed e2e.** `E2E_BASE_URL=https://siteless-iota.vercel.app npx playwright test`
exited 0: **22 passed, 10 skipped, 0 failed** in 1.1 minutes, on 1 worker with 0 retries.
HEAD was `8218042` before and after.
- PASS list:
  - setup `authenticate`
  - `budget banner: absent under 80 percent`
  - `businesses: search and filters render…`
  - both `no access` tests
  - `create preset: cities/county/radius`
  - `preset editor: the Texas row carries a computed multiplier`
  - `signs in and is org-scoped`
  - `sources: four static rows…`
  - **`sources: the transient card sits beside the four rows, never among them`**
  - `sources: at 390x844 the screen is reached only through the More sheet`
  - **`spend: month-to-date, the gauge and all three providers render`**
  - **`spend: the by-run tab reports its own state`**
  - **`spend: every listed run links to its report`**
  - the three `theme tokens` tests
  - the three `touch targets` tests
- SKIPPED, all deliberate self-skips against a deployed target:
  - `budget-banner` ×2
  - `preset-detail` ×3 (including "with places off, all three run actions are disabled")
  - `runs` ×4
  - `toast-clearance` ×1 (no business on production)
- **No spec clicks a run confirm.** `spend.spec.ts` and `runs.spec.ts` say so in their own
  headers. `preset-detail`'s only confirm click is `duplicate-confirm`, which duplicates a
  preset and cannot start a run, and that spec self-skips on a deployed target anyway.
- `presets.spec.ts` left three more `e2e-1790248608579-*` preset rows on production. There
  is still no delete path (`deferred-items.md`).

**Step 7: docs.** `docs/deploy.md` now covers:
- § 4: the Phase 4 migration-table row (never re-apply) and "Phase 4 (plan 04-30): what the
  run taught", which holds the gate, the four migrations, the queued-runs precondition, the
  pre-flight, the gates, the post-flight, the parity and the no-op
- "Phase 4: `CRON_SECRET` and `PLACES_MODE`": Production-only and Sensitive, the fail-closed
  contract, rotation with a redeploy, `PLACES_MODE` unset = off with a link to
  `runbooks/places.md` § 1, and Fluid compute
- § 6: a pointer to the seventh variable
- § 10: the new live deployment, history rows for `3dd2060` and `8218042`, and the
  branch-deploy caveat

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `8218042` | docs(04-30): start phase deferred-items from the read-only prod pre-flight |
| 3 | `dc4e4e0` | docs(04-30): record the Phase 4 production migrate, cron secret and deploy |
| — | (final) | docs(04-30): SUMMARY + STATE |

The deployed commit is `8218042`. `dc4e4e0` and the final commit change only `docs/` and
`.planning/`, which `.vercelignore` excludes from the bundle anyway, so the served app equals
HEAD's app.

## Deviations from Plan

1. **[Rule 3 - Blocking] The `CRON_SECRET` smoke used the generated scratch file, not
   `vercel env pull`.** The secret is stored **Sensitive**, and Vercel never returns a
   sensitive value to `env pull`. This is the "safer method" agreed at the checkpoint. The
   file sat in the session scratchpad outside the repo, was never printed, and was deleted
   in the smoke's own command.
2. **[Plan-text defect, recorded in Task 1] The pre-flight query in step 5 used column
   `term`; the real column is `value`.** The failed attempt was inside a read-only
   transaction and wrote nothing.
3. **The post-flight script's first run raised `42725`** (`text || "char"` on
   `pg_constraint.contype`) inside its `begin read only` transaction, so nothing was
   written. It was fixed with `::text` casts and re-run. This was a read, never a mutation,
   and it ran before the second migrate.
4. **"The build log names the intended sha" does not hold literally.** The build log names
   no sha (docs/deploy.md § 10). The evidence used instead is the deployment record's
   `meta.githubCommitSha` together with `/api/health`'s `commit`.
5. Beyond the plan: parity was checked **member-for-member across nine sets**, not by count,
   and a **wrong-bearer 401** probe was added to the no-header one.

## Threat mitigations (plan register)

- **T-4-16:** a read-only pre-flight, twice; human approval; the `scripts/db.ts` gate;
  a catalog post-flight; the no-op proven from the journal.
- **T-4-08:** the secret came from a CSPRNG and is not echoed; the route gives 401 without
  it and 401 with a wrong one.
- **T-4-01:** the value was never printed, the scratch file was outside the repo and is
  deleted, and the DB URLs were read in-process and never printed.
- **T-4-02:** `PLACES_MODE` and `GOOGLE_PLACES_API_KEY` are absent in every Vercel
  environment.
- **T-4-09:** no spec clicks a run confirm.

## Known risk (carried to STATE.md)

🔴 **Production runs the unmerged phase branch (`8218042`).**
- `origin/main` is `3dd2060`, and `vercel git connect` redeploys production on the next push
  to `main`.
- That redeploy would bring back the Phase 3 app and **drop the purge cron**, because
  `main`'s `vercel.json` has no `crons`.
- Nothing may land on `main` before the Phase 4 PR merges.
- The database stays at journal 30 regardless.

## Known Stubs

None. This plan changes docs and production state only.

## Self-Check: PASSED

- `.planning/phases/04-places-transient-verifier/deferred-items.md`: present (commit `8218042`)
- `docs/deploy.md` contains `CRON_SECRET` and `0029_places_writers`: present (commit `dc4e4e0`)
- Commits `8218042` and `dc4e4e0` are in `git log`
- Production journal = 30, read on its own read-only connection after the second migrate
- The served commit is `8218042…` (`/api/health`)
