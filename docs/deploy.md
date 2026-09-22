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

After the run, read it again and compare against the local test database, count for count:
four tables with row-level security enabled, an equal policy count, the six retention
constraints, the five non-internal triggers, the five `app.*` functions, and `app_user` with
`login` and `NOINHERIT`. Then run `pnpm db:migrate:prod` a second time — it must apply
nothing. A mismatch means development and production have diverged, which is the exact
failure D-09 exists to prevent.

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
| Deployment id | `dpl_AxqqohtjnoFzhfJxSvUSWYtrFHkm` |
| Per-deployment URL | `https://siteless-dqfm2wzg8-danlopez508-8452s-projects.vercel.app` |
| Verified commit | `311e6b4574cc1973c6307b6d2b1dcb1f24dea876` (`311e6b4`), branch `main` |
| State | READY, target production, region `iad1` |
| First deployed | 2026-09-22 |

The first production deployment was `453c0c4` (`dpl_CAcqW8nAXa2nimyUp65kBsEcgMFQ`). It was
superseded the same day by `311e6b4`, which is the pending-session fix the e2e suite found
against it. The alias is unchanged and always points at the newest production deployment.

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
{"ok":true,"db":"up","proxy":"up","commit":"311e6b4574cc1973c6307b6d2b1dcb1f24dea876"}

$ curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' https://siteless-iota.vercel.app/
307 https://siteless-iota.vercel.app/sign-in
```

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
