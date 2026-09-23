# Deploying Siteless

How to take this repository from a clean checkout to a running production deployment.

> **Names only.** This file never carries a value. Every secret lives in `.env.local`
> (gitignored) on a developer machine, or in the Vercel / Supabase / GitHub dashboards.
> If you find yourself pasting a connection string or a key into this file, stop.

## 1. The accounts this deployment uses

| Thing               | Identifier                                                 |
| ------------------- | ---------------------------------------------------------- |
| Vercel team scope   | `team_8zjV46sJxQDsVzikNQa1JaO2` (slug `danlopez508-8452s-projects`) |
| Vercel project      | `siteless` (`prj_opbLb7HDhmwklBSXq1hF9Mj0zzNe`)             |
| Git repository      | `dlopez2392/siteless`, production branch `main`              |
| Supabase project    | `siteless`, ref `jahgeqshuesndyscnmjo`, region `us-east-1`   |
| Clerk application   | "Siteless"                                                   |

Pass `--scope team_8zjV46sJxQDsVzikNQa1JaO2` on **every** Vercel command. The account has
more than one plausible target and a project created in the wrong scope is a silent wrong
answer — it builds, it deploys, and it is simply not the project anyone else is looking at.

Two reading gotchas, both verified rather than assumed:

- `vercel teams ls` prints the team **slug** in the column headed `id`, so the team id above
  will never appear in that output. The authoritative check is `.vercel/project.json`, whose
  `orgId` field is the team id.
- `vercel project inspect` reports `Framework Preset: Other` for this project, and plan 10
  recorded that as Vercel's harmless auto-detect default because `bis-platform`, a live
  Next.js deployment on the same team, reports exactly the same thing. **Plan 11 proved it
  is not harmless.** With no framework declared, Vercel runs the build, `next build`
  succeeds and prints every route, and the deploy then fails with
  `No Output Directory named "dist" found` — because a frameworkless project is assumed to
  emit a static directory. `vercel.json` now declares `"framework": "nextjs"`, which
  overrides the project setting; the next build log says `Detected Next.js version: 16.3.5`
  and `Applying modifyConfig from Vercel`, neither of which appears without it. The setting
  lives in the repository rather than the dashboard so it is reviewable and survives the
  project being recreated.

## 2. Create and link the project (one time only)

```sh
vercel project add siteless --scope team_8zjV46sJxQDsVzikNQa1JaO2
vercel link --yes --project siteless --scope team_8zjV46sJxQDsVzikNQa1JaO2
vercel git connect --yes --scope team_8zjV46sJxQDsVzikNQa1JaO2
vercel project inspect siteless --scope team_8zjV46sJxQDsVzikNQa1JaO2   # Node.js Version must read 24.x
```

`vercel link` writes `.vercel/project.json`, which `.gitignore` already excludes. Confirm
with `git status --short` that `.vercel` is not listed.

> 🔴 `vercel link` also appends `.env*` to `.gitignore` and writes a `VERCEL_OIDC_TOKEN`
> line into `.env.local`. **Revert the `.gitignore` edit** (`git checkout -- .gitignore`).
> This repository already ignores `.env` and `.env.*` and then deliberately re-includes
> `.env.example`; because the last matching pattern wins, Vercel's broader `.env*` lands
> after that negation and silently re-ignores the one env file that is meant to be tracked.
> Prove it either way with `git check-ignore -v --no-index .env.example` — the matching
> pattern must be the `!.env.example` line.

## 3. The three database URLs, and which one is used where

| Variable               | Pooler mode | Port   | Connects as           | Used by                                         | Lives in                                  |
| ---------------------- | ----------- | ------ | --------------------- | ----------------------------------------------- | ----------------------------------------- |
| `SUPABASE_DB_URL`      | session     | `5432` | the project owner     | `pnpm db:migrate:prod` — migrations only         | `.env.local`, developer machine **only**   |
| `SUPABASE_DB_POOL_URL` | transaction | `6543` | `app_user` + the project ref | the Next.js runtime, opened with `prepare: false` | Vercel Production **and** Preview          |
| `TEST_DATABASE_URL`    | n/a (local) | `5432` | the local owner role  | the vitest db suite and `pnpm db:migrate`        | `.env.local` and CI **only**               |

Non-negotiable rules, each of which `scripts/db.ts` or a threat in the phase register exists
to enforce:

- **Never put `SUPABASE_DB_URL` or `TEST_DATABASE_URL` on Vercel.** The runtime must never
  hold the owner credential — an owner bypasses row-level security, so a single leaked or
  misused query would be unscoped. Nothing on Vercel migrates.
- **The runtime uses the transaction pooler on `6543`, as `app_user`.** Migrations use the
  session pooler on `5432`. `scripts/db.ts --target=prod` refuses anything that is not a
  Supabase session-pooler URL on `5432`, because the transaction pooler cannot run DDL
  reliably and prepared statements are unavailable there.
- **Never the direct `db.<ref>.supabase.co` address**, from Vercel or from GitHub Actions.
  It is IPv6-only without the IPv4 add-on and GitHub-hosted runners have no IPv6.
- **`TEST_DATABASE_URL` is never a Supabase host** (D-04). `scripts/db.ts --target=test`
  refuses one outright, so a mistyped variable cannot run the RLS suite's DDL against
  production.

## 4. Apply the schema to production

drizzle-kit is the single migration authority (D-09). There is no `supabase/` directory in
this repository, no Supabase CLI migration and no MCP `apply_migration`. Two migration
systems against one database is a guaranteed drift bug.

```sh
pnpm db:migrate:prod     # tsx scripts/db.ts migrate --target=prod
```

Before the first run, read the target rather than trusting it — `select version()`, the role
list, the schema list, and the table list for `public`. If `public` already holds application
tables, **stop**: something other than drizzle-kit has written to the database and D-09 is
already broken.

After the run, read it again — as a **separate, later, read-only connection**, never by
re-reading the migrating script's own output — and compare against the local test database
count for count: every table with row-level security enabled, an equal policy count, the
named constraints, the non-internal triggers **scoped to schema `public`**, the `app.*`
functions, and `app_user` with `login` and `NOINHERIT`. Then run `pnpm db:migrate:prod` a
second time — it must apply nothing. A mismatch means development and production have
diverged, which is the exact failure D-09 exists to prevent.

> 🔴 **Scope every catalog count to `public`.** Supabase ships its own non-internal triggers
> in `realtime` (1) and `storage` (7), so an unscoped trigger count reads 8 higher on
> production than on a local Postgres and a correct database looks broken. Plan 01-10 hit
> this first; plan 02-14 hit it again with the numbers 27 versus 19, and 19 versus 19 once
> scoped.

> 🔴 **`drizzle-kit migrate` prints `[✓] migrations applied successfully!` whether or not it
> applied anything.** The banner and the exit code are the same on a no-op run, so neither
> proves idempotency. Read `select count(*) from drizzle.__drizzle_migrations` before and
> after instead: it must be unchanged. (A re-applied `create table` would also have raised
> `42P07`, so a clean exit is a second witness — but the journal count is the direct one.)

### The migration files, by phase

| Phase | Files | Applied to production |
| ----- | ----- | --------------------- |
| 1 | `0000_bootstrap` … `0011_events_no_caller_insert` — twelve | 2026-09-22, plans 01-10 and 01-12 |
| 2 | `0012_eager_vertigo`, `0013_reference_policies_and_grants`, `0014_brown_phantom_reporter`, `0015_budget_grants_and_triggers`, `0016_budget_meter_functions` — five | 2026-09-22, plan 02-14 |
| 2 (fix waves) | `0017_strange_mathemanic` … `0020_yellow_ricochet` — four | 2026-09-22, with the Phase 2 merge |
| 3 | `0021_extensions`, `0022_spine_tables`, `0023_spine_constraints_grants`, `0024_merge_functions` — four | 2026-09-23, plan 03-21 (journal 21 → 25) |
| 3 (review fixes) | `0025_review_fixes_spine` — one (record_merge lock, DML revoke on businesses/source_records, `pg_temp` on all definers, `apply_survivorship_if_changed`, `undo_merge` new signature) | 2026-09-23, after `/gsd-code-review 3 --fix` (journal 25 → 26; second run no-op; deployed `8f05309`) |

### Phase 3 (plan 03-21): what the run taught

**The gate.** danlo answered the plan's `checkpoint:decision` on 2026-09-23 with **"Apply +
deploy"**: run `db:migrate:prod` once, then `db:seed:prod` twice (the second must report 0
inserted), verify from the catalog, `vercel --prod` from the branch, confirm the deployed sha,
smoke, then run the e2e suite on the real URL. That is the sequence below, and it is the
template for the next phase that ships a migration.

- 🔴 **`businesses` must be EMPTY before `0022` can apply, and before any later migration
  that adds a `NOT NULL` column with no default to a populated table.** `0022` adds
  `businesses.external_key text not null` with no default, which Postgres refuses on a table
  that has rows. The pre-flight read `select count(*) from businesses` was `0` on production,
  because no ingest has ever run there (D-01: the spine is loaded on the local database
  only). **The day an ingest runs against production, this stops being free**: the next such
  column needs a nullable add, a backfill and a `set not null`, across migrations.
- **The pre-flight read, before any write** (production, read-only transaction as the owner):
  PostgreSQL `17.6`; `businesses` = 0; installed extensions `pg_stat_statements`, `pgcrypto`,
  `uuid-ossp` (schema `extensions`), `supabase_vault`, `plpgsql`; `pg_trgm 1.6` and
  `unaccent 1.1` **available, not installed**; `drizzle.__drizzle_migrations` = 21; none of
  the new tables present. The migration role's `search_path` is `"$user", public, extensions`,
  and no schema named `postgres` exists, so `create extension` with no `schema` clause lands in
  **`public`**. `app_user` has no role-level `search_path` override.
- **Post-flight, from the catalog on a separate later connection:** `pg_trgm 1.6` and
  `unaccent 1.1` in schema `public`; all six `businesses_%_src_fk`; `businesses_name_trgm`
  and `businesses_external_key_uniq` among nine `businesses` indexes; `record_merge`,
  `undo_merge`, `record_candidate_decision` all `prosecdef = t` with
  `search_path=public`; `authenticated` holds exactly `SELECT` on `ingest_runs`,
  `merge_candidates`, `business_merges`, `business_aliases` (and the reference-table
  `SELECT, INSERT, UPDATE, DELETE` on `overture_category_map`, which RLS confines to the
  org's own rows); the journal at 25. Parity with local, all scoped to `public`: RLS tables
  21/21, policies 76/76, triggers 25/25, `app.*` functions 18/18, indexes 74/74.
- 🔴 **A `pg_constraint` count does NOT match across 17 and 18, and that is not drift.**
  Production read 111 and local 277. PostgreSQL 18 records every `NOT NULL` as a
  `contype = 'n'` row (166 of them locally) and 17 does not. By type, check/FK/PK/unique were
  26/49/21/15 on both. Compare constraint counts with `contype <> 'n'`.
- 🔴 **The unqualified `unaccent(` in `src/server/queries/businesses.ts` resolves only
  because the extensions landed in `public`.** Proven as the runtime role: the
  transaction-pooler URL Vercel holds (`app_user`, `search_path` `"$user", public` — note
  `extensions` is NOT on it), then `set local role authenticated` inside a rolled-back
  transaction, `select unaccent('Café'), similarity('taqueria','taqueria el'),
  app.distance_m(26.2,-98.2,26.3,-98.1)` returned `Cafe`, `0.75`, `14936.5…` with no schema
  qualification. Had Supabase put them in `extensions`, the runtime would have raised
  `42883` while every owner-role check passed. The fix for that would be a migration
  (`alter extension … set schema public`, or schema-qualified calls), never a hand edit.
- **The seed, twice:** the first run inserted **70** `overture_category_map` rows and updated
  the Phase 2 reference rows in place (254 counties, 4 clusters, 33 terms, 17 cities, 20
  outlet counts, 3 geo presets — all `0 inserted`); the second reported **`0 inserted, 70
  updated`** for `overture_category_map` and `0 inserted` for every table. Read back
  independently: 70 rows, 70 `org_id IS NULL`.
- **No ingest and no resolve ran against production** (D-01). `businesses` is still 0.

> 🔴 **`.claude/` is excluded from the upload (03-21).** Claude Code agent worktrees live at
> `.claude/worktrees/agent-*` — full checkouts, `.ts` included, untracked and not gitignored.
> The CLI uploads the working tree, so a stale one would ship a second `src/` for `next build`
> to type-check. Same class as `coverage/`.

Production Supabase is **PostgreSQL 17.6** while local and CI are 18. `NULLS NOT DISTINCT`,
stored generated columns and `FOR UPDATE ... SKIP LOCKED` are all fine there;
`RETURNING old.` / `RETURNING new.`, `uuidv7()` and virtual generated columns are not, and
`tests/unit/pg17-compat.test.ts` refuses them before they can reach a migration file. Run
that test and `pnpm test:db -t "server version"` immediately before any production migrate —
the point of the gate is that it is fresh, not that it once passed.

### The reference rows: `pnpm db:seed:prod`

```sh
pnpm db:seed:prod        # tsx scripts/seed.ts --target=prod
```

`scripts/seed.ts` loads the committed JSON under `src/seed/data/` into the six reference
tables as `org_id IS NULL` built-ins: 254 Texas counties, 4 industry clusters, 33 industry
terms, the 17 RGV cities, 20 outlet-count rows and 3 geo presets.

- **Run it after every migration that adds or changes a reference table**, and after any
  deliberate edit to a file under `src/seed/data/`. It is not part of `db:migrate:prod`;
  a migration that creates a reference table leaves it empty until this runs.
- **It is idempotent.** Every upsert names its constraint (`on conflict on constraint …`),
  which is what makes `NULLS NOT DISTINCT` apply to the `org_id IS NULL` built-ins. A second
  run must report **0 inserted** for every table. If it reports inserts, the unique
  constraint has lost `nulls not distinct` and the loader is doubling rows — stop.
- **It connects as the migration owner, deliberately.** `referencePolicies()` excludes
  `org_id IS NULL` from every write policy, so `authenticated` cannot write a built-in at
  all. That asymmetry is the whole mechanism behind "a tenant reads a built-in and can never
  change one".
- It runs the whole load in one transaction and exits non-zero if any reference table ends
  with zero built-in rows — a loader that wrote nothing and exited 0 is indistinguishable
  from a working one until the cost estimator prices everything at zero.

> 🔴 **`scripts/refresh-outlet-counts.ts` is never run in CI, and never against production
> without a fresh human review of the numbers it rewrites.** It re-queries Socrata and
> overwrites the committed `src/seed/data/outlet-counts.json` — the counts the budget
> estimator multiplies by. Run it locally, read the diff, commit the JSON, and only then
> `pnpm db:seed:prod`. Letting it run unattended would move production's cost estimates with
> no reviewed commit behind them.

## 5. Give `app_user` its password

Migration `0000_bootstrap` creates the `app_user` role, but a role has no password until one
is set on the project. Until then the runtime cannot connect at all.

In the Supabase dashboard for project `siteless`, SQL Editor:

```sql
alter role app_user with login password '<generate a long random one>';
```

Store it in a password manager. This is the **only** SQL run in the dashboard during phase 1
— it is a credential operation, not a schema change, so D-09 still holds.

Then compose `SUPABASE_DB_POOL_URL` from Dashboard → **Connect** → **Transaction pooler**:
take that URI, keep port `6543`, and change the username from the owner form to
`app_user.jahgeqshuesndyscnmjo`, with the password just set.

A "password authentication failed" immediately after any Supabase password change can take
two to three minutes to clear. Wait and retry; do not "fix" the value.

## 6. The six environment variables Vercel holds

Set each for **Production** and **Preview**, from the values already in `.env.local`:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` — the literal `/sign-in`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_DB_POOL_URL` — the transaction-pooler URL composed in section 5

Either the dashboard (Settings → Environment Variables) or the CLI, which reads the value
from standard input so it never reaches shell history:

```sh
vercel env add NEXT_PUBLIC_SUPABASE_URL production preview --scope team_8zjV46sJxQDsVzikNQa1JaO2
vercel env ls --scope team_8zjV46sJxQDsVzikNQa1JaO2      # names only; never print a value
```

GitHub Actions additionally needs the repository secrets `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `E2E_ADMIN_EMAIL`, plus a repository *variable*
`E2E_BASE_URL` pointing at the deployed URL.

## 7. Deploy

```sh
vercel deploy --prod --scope team_8zjV46sJxQDsVzikNQa1JaO2
```

A push is never assumed to have deployed. Read the build log, confirm the commit it names
equals `git rev-parse --short HEAD` taken before the deploy, and only then smoke it.

CI now enforces the same rule for the `e2e` job: because `vercel git connect` makes a push to
`main` start a deployment asynchronously, the job polls `/api/health` until its `commit`
field equals `GITHUB_SHA` before Playwright runs, and fails after ten minutes. Without it the
suite asserted against whatever the alias was still serving — the previous deployment — so a
regression was reported green by the very push that introduced it.

## 8. Smoke the deployment

```sh
curl -fsS "$DEPLOY_URL/api/health"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$DEPLOY_URL/"
```

`/api/health` must return HTTP 200 with `"ok":true`, `"db":"up"` and `"proxy":"up"`, and its
`commit` field must equal the recorded sha. `db:"up"` is the only proof that
`SUPABASE_DB_POOL_URL` is correct; `proxy:"up"` is the only proof that `clerkMiddleware()`
is running from the right directory in production, which is a failure that reproduces on
Vercel and not locally. The body must contain nothing resembling a connection string, a key
or the Supabase project ref.

The signed-out `GET /` must not return the org-scoped shell.

## 9. What is deliberately not in the bundle

`.vercelignore` keeps `.planning/`, `docs/`, `tests/`, `drizzle/`, `*.md`, `.github/` and the
three test-harness configs out of the deployment. `drizzle/` is the load-bearing one: with
the migration files absent, no build and no preview deploy can apply a migration, so
production DDL can only ever come from a developer machine running `pnpm db:migrate:prod`.

The test-harness configs were added to that list in plan 11, for a reason worth keeping:
`playwright.config.ts` imports `./tests/e2e/_required-env` at the top level, `tsconfig.json`
includes `**/*.ts`, and `next build` type-checks. Exclude the directory but ship the config
and the Vercel build compiles cleanly and then dies on
`TS2307: Cannot find module './tests/e2e/_required-env'` — a build error that cannot
reproduce locally, because locally `tests/` exists. **An exclusion is only as good as the
files that still reference across it.** The two vitest configs reach `tests/` through string
globs only and did not break; they are excluded with it because they are harness for an
excluded directory just the same.

## 10. The live production deployment

| Thing | Value |
| --- | --- |
| Production URL (use this) | `https://siteless-iota.vercel.app` |
| Other alias | `https://siteless-danlopez508-8452s-projects.vercel.app` |
| Deployment id | `dpl_3EwN5CwiKtnKyMAQvjkpAuXMLDry` |
| Per-deployment URL | `https://siteless-8c5xyiz7z-danlopez508-8452s-projects.vercel.app` |
| Verified commit | `8acee7c35e4122697530f18bee74b637e4c3924f` (`8acee7c`), branch `gsd/phase-03-free-data-spine-entity-resolution` (not yet pushed or merged) |
| State | READY, target production, region `iad1` |
| First deployed | 2026-09-22 |
| Phase 2 deployed | 2026-09-22, plan 02-15 |
| Phase 3 deployed | 2026-09-23, plan 03-21 |

### Deployment history

| Commit | Deployment id | Shipped | What it was |
| --- | --- | --- | --- |
| `453c0c4` | `dpl_CAcqW8nAXa2nimyUp65kBsEcgMFQ` | 2026-09-22, plan 01-11 | the first production deployment |
| `311e6b4` | `dpl_AxqqohtjnoFzhfJxSvUSWYtrFHkm` | 2026-09-22, plan 01-11 | the pending-session fix the e2e suite found against `453c0c4` |
| `6d6c52f` | `dpl_Dk71EVmgcaav2NwhgWQNd65EJBRy` | 2026-09-22, plan 02-15 | Phase 2 — the six new routes, the budget meter and the design system |
| `8acee7c` | `dpl_3EwN5CwiKtnKyMAQvjkpAuXMLDry` | 2026-09-23, plan 03-21 | Phase 3 — `/review`, `/sources`, `/businesses`, `/businesses/[id]`, the six-destination nav; CLI deploy from the phase branch after migrations 0021–0024 |

The alias is unchanged and always points at the newest production deployment.

🔴 **The Phase 3 deployment came from a feature branch, not `main`** (danlo's "Apply + deploy"
decision). Production now serves a commit `origin/main` does not contain. `vercel git connect`
means the **next push to `main` redeploys production from `main`** and rolls these four
screens back until the phase branch is merged. Merge the phase branch before anything else
lands on `main`.

The Phase 3 deployment was gated the same way at `8acee7c`: `typecheck`, `lint` and `build`
each exit 0 locally, then `vercel deploy --prod`, whose remote build printed all four new
routes. The CLI also printed `Error while parsing config file: "…\pnpm-lock.yaml"` before
uploading. The deployment still built and went READY, so that line is noise from the CLI's
own config probe, not a build failure. Smoke: `/api/health` →
`{"ok":true,"db":"up","proxy":"up","commit":"8acee7c35e4122697530f18bee74b637e4c3924f"}`;
signed-out `/` → `307 /presets`; signed-out `/sources`, `/businesses`, `/review` → `307` to
`/sign-in`. The full e2e suite then ran against the alias: **20 passed, 5 skipped, 0 failed**
(the skips are `preset-detail` ×3 and `budget-banner` ×2, both deliberate self-skips against a
deployed target), including `sources: desk`, `sources: phone`, `businesses`, both
`touch targets` and `signs in and is org-scoped` — the authenticated smoke.

The Phase 2 deployment was gated first: `typecheck`, `lint`, `test:unit` (76), `test:db` (90)
and `build` each run individually and each exit 0, with `git rev-parse --short HEAD` printed
before and after the five and identical (`6d6c52f`) — a parallel session moving the tree
mid-gate is how a gate goes silently green on a commit nobody meant to ship.

Use the **alias**, not the per-deployment URL. The per-deployment URL is covered by Vercel
deployment protection and answers `302` to an unauthenticated request, including on
`/api/health`; the production alias answers `200`. Point `E2E_BASE_URL` — in `.env.local`
and as the GitHub Actions repository variable — at the alias for the same reason.

The commit is verified from the running code, not from the build log: the build log names no
sha, so `/api/health` echoing `VERCEL_GIT_COMMIT_SHA` is the check. A CLI deploy from this
linked directory carries the local git metadata, so the sha it returns is the sha that was
`git rev-parse HEAD` before the deploy — and it is `main`'s local HEAD whether or not `main`
has been pushed.

```
$ curl -fsS https://siteless-iota.vercel.app/api/health
{"ok":true,"db":"up","proxy":"up","commit":"6d6c52f742c2cb5552ea4af533fc5706f55e33c2"}

$ curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' https://siteless-iota.vercel.app/
307 https://siteless-iota.vercel.app/presets
```

Since Phase 2 the signed-out `GET /` redirects to `/presets` rather than straight to
`/sign-in` — `/presets` is the app's home and it redirects to `/sign-in` in turn, so the
visitor still lands on the sign-in page and no route on the way there returns the org-scoped
shell. Plan 02-15 smoked all six new routes signed out; each answered `307` to
`/sign-in` and none carried `data-testid="org-id"` in its body, followed or unfollowed.

## 11. Two things the deployed app says that are expected, not defects

A browser on the deployed app logs:

```
Clerk: Clerk has been loaded with development keys. Development instances have strict
usage limits and should not be used when deploying your application to production.
```

That is correct and expected for phase 1: the Vercel project carries the Clerk
**development** instance keys, which is what makes an unattended e2e sign-in possible at
all. Moving to a Clerk production instance is its own piece of work with its own DNS step —
BIS's runbook records that the app subdomain must be an **A** record, because a CNAME
cannot have records beneath it and the vendor's "configure automatically" resolves that by
deleting the record the product lives on. Do not treat the banner as a bug to silence here.

A signed-out page load also logs `"useOrganizationList" requires an active user session`.
`ActivateSoleOrganization` is mounted in the root layout on purpose, so it is present on
`/sign-in` where there is no session yet. The component correctly does nothing in that
state; the warning is noise, not a failure.
