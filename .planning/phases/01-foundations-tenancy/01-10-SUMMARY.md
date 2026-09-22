---
phase: 01-foundations-tenancy
plan: 10
subsystem: infra
tags: [vercel, supabase, drizzle-kit, postgres, pgbouncer, transaction-pooler, clerk, github-actions, secrets, rls, grants]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy (plan 02)
    provides: '.env.example and docs/local-postgres.md — the canonical variable names and the local-vs-production pooler split this plan carries to Vercel'
  - phase: 01-foundations-tenancy (plan 04)
    provides: 'scripts/db.ts — `db:migrate:prod`, which refuses any prod target that is not a Supabase SESSION pooler URL on 5432; the only permitted write path to the production schema (D-09)'
  - phase: 01-foundations-tenancy (plan 08)
    provides: '/api/health with its db/proxy probes and its leak scan — the smoke target plan 11 will hit on the deployed URL'
  - phase: 01-foundations-tenancy (plan 09)
    provides: 'migration 0007 (the final local migration) — the 8-row journal whose shape production had to match, and the events revoke whose production counterpart this plan found missing'
provides:
  - 'Vercel project `siteless` (prj_opbLb7HDhmwklBSXq1hF9Mj0zzNe) under team team_8zjV46sJxQDsVzikNQa1JaO2, linked to this directory and to github.com/dlopez2392/siteless, building on Node 24.x'
  - '.vercelignore — keeps .planning/, docs/, tests/, drizzle/, *.md and .github/ out of the bundle; `drizzle/` is the load-bearing exclusion (T-1-33: no build or preview deploy can apply a migration)'
  - 'docs/deploy.md — the reproducible Vercel + production-migration recipe, names only, including the three-URL table and the two vercel-CLI reading gotchas that cost time here'
  - 'The production Supabase schema (ref jahgeqshuesndyscnmjo), applied entirely by drizzle-kit, verified identical to local count for count'
  - 'Production `app_user` with a password, `login`, `NOINHERIT` — the runtime identity'
  - 'Six Vercel environment variables for Production AND Preview; SUPABASE_DB_URL and TEST_DATABASE_URL deliberately absent (T-1-03)'
  - 'Three GitHub Actions repository secrets for the e2e job; E2E_BASE_URL pending plan 11'
  - 'The Rule 4 finding that produced gap plan 01-12: Supabase pg_default_acl grants ALL on public tables to anon/authenticated, and TRUNCATE is exempt from RLS'
affects: [01-11-phase-verification, 01-12-revoke-platform-grants, phase-02-ui, phase-04-places-verifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Every Vercel command carries `--scope team_8zjV46sJxQDsVzikNQa1JaO2` explicitly: this account has more than one plausible target and a project created in the wrong scope builds, deploys, and is simply not the project anyone else is looking at'
    - 'Secret values move machine-to-service only: a Node script reads `.env.local`, passes URLs to `psql` through `spawnSync` argv, and pipes values to `vercel env add` / `gh secret set` over stdin — no value ever enters a shell command line, scrollback, or this file'
    - 'A production read is a SEPARATE command before any write; a mutating script is never re-run for its output'
    - 'Production-vs-local parity is asserted as a side-by-side of catalog counts, not as "the migration exited 0" — the migration exiting 0 is what a divergent database also does'
    - 'A catalog count used as an acceptance criterion must be schema-scoped: Supabase ships triggers in `realtime`/`storage` that a repo-local count never sees'

key-files:
  created:
    - .vercelignore
    - docs/deploy.md
  modified: []

key-decisions:
  - "Task 3 was executed as CLI, not dashboard, for every item: danlo chose the orchestrator's CLI path on all five sub-items. The plan text offered the Supabase SQL editor and the Vercel dashboard as the default; the CLI path keeps values out of a browser clipboard round-trip and makes each step's exit code the evidence."
  - "`.vercel/project.json` is the authoritative record of the team id, not `vercel teams ls`. The CLI prints the team SLUG in the column headed `id`, so the team id `team_8zjV46sJxQDsVzikNQa1JaO2` never appears in that output — it appears in `project.json`'s `orgId`. Recorded in docs/deploy.md §1 so the next person does not re-derive it."
  - "`Framework Preset: Other` on `vercel project inspect` is Vercel's auto-detect default, not a misconfiguration. Verified against `bis-platform`, a live Next.js deployment on the same team, which reports exactly the same thing. Left alone."
  - "The production trigger count is compared SCOPED to schema `public` (5 = 5). The plan's unscoped criterion returns 13 on production because Supabase ships 8 non-internal triggers in `realtime` and `storage`. The criterion is the defect, not the database."
  - "The commented `# PROD (Vercel only, plan 10):` line in `.env.local` holds the composed transaction-pooler URL while the ACTIVE `SUPABASE_DB_POOL_URL` stays the local `app_user@localhost` value — the same shape plan 02 established when it found the production pooler URL active locally. Production is recorded without being reachable by a local run."
  - "The Rule 4 TRUNCATE finding was NOT fixed in this plan. danlo chose 'fix now, before the deploy'; the fix is a migration, which is a schema change, which belongs in a plan with its own watched-failing guard — gap plan 01-12, wave 6, runs before plan 11 deploys."

patterns-established:
  - 'When a linked vendor CLI edits repo config as a side effect, diff it and prove the revert with the tool that reads the rule — `git check-ignore -v` names the winning pattern by file and line number, where `git status` only shows the outcome.'
  - 'An acceptance grep that quotes its own forbidden tokens matches itself. Run the literal criterion, then re-run it scoped to the surface that actually matters, and record BOTH with the reasoning — never edit documentation to satisfy a self-matching grep.'
  - 'Probe a privilege by attempting the statement inside a rolled-back transaction, with a control statement that must be refused. `has_table_privilege` says what the catalog holds; only the attempt says what the server does.'

requirements-completed: [FOUND-01, FOUND-05, FOUND-03]

# Metrics
duration: 28 min
completed: 2026-09-22
---

# Phase 1 Plan 10: Vercel Project, Production Migration and Environment Summary

**The Vercel project `siteless` created, linked and git-connected under the Pro team; the production Supabase schema applied by drizzle-kit alone and proven identical to local count for count; `app_user` given a password and six environment variables placed on Production and Preview — and, from the parity side-by-side, the discovery that Supabase's default ACL had handed `anon` and `authenticated` TRUNCATE on every tenant table.**

## Performance

- **Duration:** 28 min (includes the Task 3 human-action checkpoint turnaround)
- **Started:** 2026-09-22T03:28:00Z
- **Completed:** 2026-09-22T03:56:00Z
- **Tasks:** 3 of 3
- **Files modified:** 2 created in the repo (`.vercelignore`, `docs/deploy.md`); 1 gitignored (`.vercel/project.json`); production database and three external services

## Accomplishments

- A Vercel project exists under the correct team, linked to this directory and to `dlopez2392/siteless`, on Node 24.x, with the planning tree and — critically — the migration files excluded from the bundle.
- The production schema is live and was written by nothing but `drizzle-kit migrate`, with the pre-flight read proving `public` was empty first and the post-flight read proving parity with local on every dimension the plan named.
- Assumption A1 (Supabase's `postgres` can `SET ROLE authenticated`) is verified rather than assumed, which is what makes the RLS probes in this plan and in 01-12 possible at all.
- Every runtime credential is in place on Vercel and GitHub, and not one value was printed, pasted, committed, or passed on a command line.
- The parity check earned its keep: it found a production-only authorization hole that a green migration, a green build and a green local suite all agreed did not exist.

## Task Commits

1. **Task 1: Create and link the Vercel project** — `a691f11` (chore) — `.vercelignore`, `docs/deploy.md` (+ gitignored `.vercel/project.json`)
2. **Task 2: Apply the schema to production with drizzle-kit** — no commit; the plan declares `files: none`. This task writes to the production database, not to the repo.
3. **Task 3: Set the production `app_user` password and add the Vercel environment variables** — no commit; environment only. Vercel environment variables, the Supabase role password, and GitHub Actions secrets. Nothing in the repo changes by design (T-1-10).

**Plan metadata:** this SUMMARY (docs: complete Vercel project, production migration and environment)

---

## Task 1 — Vercel project: evidence

| Check | Command | Result |
| --- | --- | --- |
| Authenticated, correct account | `vercel whoami --scope team_8zjV46sJxQDsVzikNQa1JaO2` | `danlopez508-8452` |
| Team resolves | `vercel teams ls` | prints the team **slug** `danlopez508-8452s-projects` in the column headed `id` — the team **id** is not in this output |
| Scope is the right one | `vercel project ls --scope team_8zjV46sJxQDsVzikNQa1JaO2` | lists `bis-platform`, `bis-website`, `956woodworks` — the known projects of this team, so the scope is confirmed by its contents |
| Project created | `vercel project add siteless --scope …` | added |
| Directory linked | `vercel link --yes --project siteless --scope …` | linked |
| Link record | `.vercel/project.json` | `{"projectId":"prj_opbLb7HDhmwklBSXq1hF9Mj0zzNe","orgId":"team_8zjV46sJxQDsVzikNQa1JaO2","projectName":"siteless"}` — `orgId` is the authoritative team id |
| Git connected | `vercel git connect --yes --scope …` | `https://github.com/dlopez2392/siteless` Connected |
| Node version | `vercel project inspect siteless --scope …` | Node.js 24.x — assumption A6 satisfied by the platform default, nothing to set |
| Framework preset | `vercel project inspect siteless --scope …` | `Framework Preset: Other` — auto-detect default, matches `bis-platform`'s live Next.js config on the same team; not a misconfiguration |

Re-verified at SUMMARY time on the current tree:

- `vercel project ls --scope team_8zjV46sJxQDsVzikNQa1JaO2 \| grep -c siteless` → `1`
- `.vercelignore` contains `.planning/`, `drizzle/` and `tests/` → each `grep -c` → `1`
- `docs/deploy.md` credential grep → `0`
- `git status --short` does not list `.vercel` (gitignored)

## Task 2 — production migration: evidence

Target proven before anything was run: `host=aws-0-us-east-1.pooler.supabase.com port=5432 user_ref=jahgeqshuesndyscnmjo` — the **session** pooler, which is the only target `scripts/db.ts --target=prod` accepts. Proven by parsing the URL inside a Node script and printing the three components; the URL itself was passed to `psql` through `spawnSync` argv and appears in no transcript.

**Pre-flight read** (a separate command before any write):

| Probe | Production |
| --- | --- |
| `select version()` | PostgreSQL 17.6 |
| roles among (`anon`,`authenticated`,`service_role`,`app_user`,`postgres`) | `anon`, `authenticated`, `postgres`, `service_role` — **`app_user` absent**, as expected before migration 0000 |
| schemas among (`app`,`public`) | `public` only — `app` absent |
| tables in `public` | **0** |
| tables in `drizzle` | **0** |
| `app.*` functions | none |

No STOP condition: `public` held no application tables, so nothing other than drizzle-kit had written to this database. **D-09 intact.**

**Assumption A1 — VERIFIED.** Connected as `postgres`: `set role authenticated` → `current_user` = `authenticated`; `reset role` → `current_user` = `postgres`. The test fixtures' role-switching works on production, so no `grant authenticated to postgres` migration was needed.

**The migration.** `pnpm db:migrate:prod` exit 0. Second consecutive run exit 0 and applied nothing.

| Evidence | Value |
| --- | --- |
| `drizzle.__drizzle_migrations` row count | 8, identical after both runs |
| `first_created_at` | `1790043006920` — equals the journal `when` of `0000_bootstrap` |
| `last_created_at` | `1790046728009` — equals the journal `when` of `0007_event_triggers` |

The timestamps equalling the journal entries is the proof that these rows came from *these* migration files, not merely that eight rows exist.

No Supabase CLI, no MCP `apply_migration`, no dashboard SQL editor was used for any schema object. There is no `supabase/` directory in this repository.

### Post-flight: production vs local, side by side

| Dimension | Production | Local | Match |
| --- | --- | --- | --- |
| Tables in `public` | 4 (`orgs`, `businesses`, `source_records`, `events`) | 4 | ✅ |
| `relrowsecurity` on all four | `t` on all 4 | `t` on all 4 | ✅ |
| Policies, total | 12 | 12 | ✅ |
| Policies — `businesses` | 4 | 4 | ✅ |
| Policies — `events` | 2 | 2 | ✅ |
| Policies — `orgs` | 2 | 2 | ✅ |
| Policies — `source_records` | 4 | 4 | ✅ |
| Six named retention constraints | 6/6 | 6/6 | ✅ |
| Non-internal triggers **in schema `public`** | 5, all `tgenabled='O'` | 5, all `tgenabled='O'` | ✅ |
| Non-internal triggers, **unscoped** (the plan's literal query) | **13** | 5 | ⚠️ see below |
| `app.*` functions | 5, `security definer` flags identical | 5 | ✅ |
| `app_user` — `rolcanlogin, rolinherit` | `t, f` | `t, f` | ✅ |
| `drizzle.__drizzle_migrations` rows | 8 | 8 | ✅ |

The unscoped trigger count is the plan's criterion being wrong, not the database: Supabase ships 8 non-internal triggers in the `realtime` and `storage` schemas that a repo-local Postgres has never heard of. Scoped to `public`, the number the criterion meant, both databases return 5 and every one is ENABLED. Benign — recorded rather than "fixed", and captured as a plan-recipe defect below.

The triggers were checked for `tgenabled='O'` rather than mere existence, following plan 09's Rule 2 finding: `pg_trigger` keeps the row after `alter table … disable trigger`, so presence alone would have reported full attribution coverage while attribution was off.

## Manual verifications

**Provenance.** danlo answered the Task 3 human-action checkpoint on 2026-09-22 by choosing, for every item, the orchestrator's CLI path over the dashboard path. The orchestrator then performed each step with danlo's per-item approval, with no value ever printed: a Node script read `.env.local`, passed URLs to `psql` via `spawnSync` argv, and piped values to `vercel env add` and `gh secret set` over stdin.

**danlo's four-line status block, verbatim:**

```
app_user password: set
pool url: transaction pooler 6543 as app_user
vercel env: 6 names x (production, preview)
gh secrets: 3 set, E2E_BASE_URL pending
```

**What was done, step by step:**

1. A 40-character URL-safe random password was generated and `alter role app_user with login password …` was run on production over the **session** pooler as `postgres` → exit 0.
2. The transaction-pooler URL was composed (port **6543**, username `app_user` + the project ref, the new password) and **verified by using it**: `select current_user` over the transaction pooler returned `app_user`. The runtime identity is proven, not assumed.
3. The composed URL was recorded on the commented `# PROD (Vercel only, plan 10):` line in `.env.local`. The ACTIVE `SUPABASE_DB_POOL_URL` remains the local `app_user@localhost` value. danlo copies the password to his password manager from that file.
4. `vercel env add <NAME> production` and `… preview` (`--scope team_8zjV46sJxQDsVzikNQa1JaO2 --force`, value from stdin) for all six names — **twelve invocations, twelve `exit=0`**. `SUPABASE_DB_URL` and `TEST_DATABASE_URL` were NOT sent (T-1-03).
5. `gh secret set` on `dlopez2392/siteless` for `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `E2E_ADMIN_EMAIL` (= danlo's address) — three `exit=0`. The repository **variable** `E2E_BASE_URL` is intentionally pending until plan 11 knows the production URL.

### `vercel env ls --scope team_8zjV46sJxQDsVzikNQa1JaO2` — name × environment column, re-run at SUMMARY time

| name | environments | value |
| --- | --- | --- |
| `SUPABASE_DB_POOL_URL` | Preview | Encrypted |
| `SUPABASE_DB_POOL_URL` | Production | Encrypted |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preview | Encrypted |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production | Encrypted |
| `NEXT_PUBLIC_SUPABASE_URL` | Preview | Encrypted |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Encrypted |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Preview | Encrypted |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Production | Encrypted |
| `CLERK_SECRET_KEY` | Preview | Encrypted |
| `CLERK_SECRET_KEY` | Production | Encrypted |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Preview | Encrypted |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production | Encrypted |

Six names × two environments = twelve rows, every value `Encrypted`. **`SUPABASE_DB_URL` and `TEST_DATABASE_URL` are absent** — the acceptance criterion that carries T-1-03, and the whole reason the runtime cannot bypass RLS by owning the tables.

### GitHub, re-run at SUMMARY time

`gh secret list --repo dlopez2392/siteless`:

| secret | updated |
| --- | --- |
| `CLERK_SECRET_KEY` | 2026-09-22T03:49:45Z |
| `E2E_ADMIN_EMAIL` | 2026-09-22T03:49:47Z |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 2026-09-22T03:49:46Z |

`gh variable list --repo dlopez2392/siteless`: **empty**. `E2E_BASE_URL` is absent as expected — plan 11 sets it once the production URL exists.

### `.env.local` shape — counts only, no value read

| Assertion | Result |
| --- | --- |
| `grep -c '^# PROD (Vercel only, plan 10): SUPABASE_DB_POOL_URL='` | `1` |
| that line names `app_user` + the project ref | `1` |
| that line contains `:6543` | `1` |
| ACTIVE `grep '^SUPABASE_DB_POOL_URL=' \| grep -c localhost` | `1` |
| ACTIVE `SUPABASE_DB_POOL_URL` line count | `1` (exactly one active definition) |
| `grep -c '^VERCEL_OIDC_TOKEN'` | `1` (written by `vercel link`; gitignored, unused) |
| `git status --short` lists `.env.local` | **no** |
| `git check-ignore -v .env.local` | `.gitignore:4:.env.*` |
| `git check-ignore -v --no-index .env.example` | `.gitignore:5:!.env.example` — the negation still wins |

The last line is the standing proof that the `.gitignore` deviation below stayed reverted.

### Credential grep — both runs, with the reasoning

**Run 1, the plan's literal criterion.** `git grep -nE 'sk_|eyJ|://[^ ]*:[^ ]*@' -- . ':!pnpm-lock.yaml'` → **31 matching lines** across 15 files. The criterion says this must return nothing. It does not, and it never could:

| File | Lines | What they are |
| --- | --- | --- |
| `.env.example` | 1 | a comment showing the **local** dev URL (`app_user:app_user@localhost:5432`) |
| `.github/workflows/ci.yml` | 1 | `TEST_DATABASE_URL` for CI's own Postgres **service container** (`postgres:postgres@localhost:5432`) |
| `docs/local-postgres.md` | 1 | the same **local** dev URL, in the setup doc that exists to tell you to use it |
| `tests/db/with-org.test.ts` | 1 | the literal string `sk_test_unused_by_the_db_suite` — a placeholder whose own name says so |
| `.planning/**` (11 files) | 27 | plan and summary prose: local URLs in setup instructions, and — the bulk of them — **the criterion's own regex, and the token lists other plans forbid, quoted inside the documents that specify them** |

The dominant cause is self-matching: the regex contains `sk_`, so every plan or summary that writes the regex down matches it. `01-10-PLAN.md` alone contributes 5 lines for exactly this reason, four of which are the criterion quoting itself. This SUMMARY adds a few more, for the same unavoidable reason.

**Run 2, scoped to the surface that matters.** The tracked working tree, excluding `.planning/` (phase documentation), `.env.example` (a documented local placeholder), and the CI workflow's literal `postgres:postgres@localhost` service-container line:

```
docs/local-postgres.md:58:SUPABASE_DB_POOL_URL=postgres://app_user:app_user@localhost:5432/siteless_test
tests/db/with-org.test.ts:44:  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
```

**2 lines, both `localhost` or an explicitly-labelled unused placeholder.** Neither is a credential for anything that exists.

**Run 3, the check the criterion was actually trying to make.** Real credential shapes, anywhere tracked:

| Probe | Result |
| --- | --- |
| live or long Clerk / JWT keys (`sk_live_`, `pk_live_`, `sk_test_`/`pk_test_` + 20 chars, `eyJ` + 20 chars) | **none** |
| any userinfo-bearing URL whose host is not `localhost` | **none** |
| `pooler.supabase.com` in tracked files | 7 lines, every one prose — the D-04 guard text telling you never to point `TEST_DATABASE_URL` at such a host, and the research note naming the session-pooler *shape*. None carries a password. |

No production credential is in the repository. **T-1-10 holds.** No documentation was edited to satisfy the literal grep — see Deviation 2.

## Files Created/Modified

- `.vercelignore` — created. Excludes `.planning/`, `docs/`, `tests/`, `drizzle/`, `*.md`, `.github/`. `drizzle/` is load-bearing: with the migration files absent from the bundle, no build and no preview deploy can apply a migration against production (T-1-33).
- `docs/deploy.md` — created. The reproducible recipe: team scope, project creation and linking, the three-URL table with which pooler is used where, the production migration command and its pre/post-flight reads, the `app_user` password step, the six environment variables, the deploy, the smoke, and what is deliberately not in the bundle. Names only; its credential grep returns 0.
- `.vercel/project.json` — written by `vercel link`, gitignored. The authoritative record of `projectId` and `orgId`.
- Not in the repo: the production schema, the `app_user` password, twelve Vercel environment variables, three GitHub Actions secrets.

## Decisions Made

See `key-decisions` in the frontmatter. In short: CLI over dashboard for every Task 3 item; `.vercel/project.json` rather than `vercel teams ls` as the team-id record; `Framework Preset: Other` left alone because a live sibling project reports the same; the trigger comparison scoped to `public`; the production pool URL parked on a commented line in `.env.local` so it is recorded without being reachable by a local run; and the Rule 4 finding routed to its own plan rather than patched here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `vercel link` re-ignored `.env.example`; reverted**

- **Found during:** Task 1 (linking the directory)
- **Issue:** `vercel link` appends `.env*` to `.gitignore`. This repository already ignores `.env` and `.env.*` and then deliberately re-includes `.env.example` with a `!` negation. Because the last matching pattern wins, Vercel's broader `.env*` landed *after* the negation and silently re-ignored the one env file that is meant to be tracked. Proven with `git check-ignore -v`: the winning pattern was `.gitignore:17:.env*` after the link, where it had been `.gitignore:5:!.env.example` before.
- **Fix:** `git checkout -- .gitignore`. Documented in `docs/deploy.md` §2 as a numbered gotcha with the `git check-ignore -v` command that proves it either way, so the next person who runs `vercel link` catches it.
- **Files modified:** `.gitignore` (reverted to its committed state — net zero), `docs/deploy.md`
- **Verification:** `git check-ignore -v --no-index .env.example` → `.gitignore:5:!.env.example`. Re-confirmed at SUMMARY time (table above).
- **Committed in:** `a691f11` (the `docs/deploy.md` half; the `.gitignore` half is a revert, so it carries no diff)

**2. [Rule 1 — Bug] Three plan-recipe defects; the criteria were wrong, not the system**

- **Found during:** Tasks 1, 2 and 3
- **Issue (a):** Task 1's automated verify pipes `vercel project ls … 2>/dev/null | grep -q siteless`. The Vercel CLI writes its project listing to **stderr**, so `2>/dev/null` discards the very output being grepped — the check is blind and would pass or fail for the wrong reason.
- **Issue (b):** the same verify's `git status --short | grep -cv '.vercel'` is meant to prove `.vercel` is not listed, but the unanchored pattern also matches `.vercelignore`, which *is* a legitimately new file. The two are different things and the expression cannot tell them apart.
- **Issue (c):** Task 2's trigger criterion, `select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal`, is not scoped to a schema. It returns 13 on production because Supabase ships 8 non-internal triggers in `realtime` and `storage`, against 5 locally — a false mismatch on a criterion whose whole job is to detect real ones.
- **Issue (d):** Task 3's criterion `git grep -nE 'sk_|eyJ|://[^ ]*:[^ ]*@' -- . ':!pnpm-lock.yaml'` "returns nothing" is unsatisfiable: the regex contains `sk_`, so every document that writes the regex down matches it — including the plan that specifies it (5 lines) and this summary. It also cannot distinguish a documented `localhost` placeholder from a live credential.
- **Fix:** each intent was asserted directly instead of through the broken recipe — `vercel project ls` read without discarding stderr, `.vercel` vs `.vercelignore` distinguished by exact path, the trigger count scoped to `public`, and the credential grep run literally, then re-run scoped, then supplemented with a real-credential-shape scan (all three recorded above).
- **Files modified:** none. **No phase documentation was edited to make a grep pass** — the criterion is the bug, and rewriting `.env.example`, `ci.yml` or the `.planning/` tree to satisfy it would destroy real information to serve a broken check.
- **Verification:** the scoped and shape-based runs above; the `public`-scoped trigger comparison in the side-by-side.
- **Committed in:** n/a (no code change)

### Architectural finding escalated (Rule 4)

**3. [Rule 4 — Architectural] Supabase's default ACL grants `anon` and `authenticated` TRUNCATE on every tenant table, and TRUNCATE is exempt from RLS**

- **Found during:** Task 2 post-flight, by the production-vs-local privilege side-by-side
- **Issue:** Supabase ships `alter default privileges … grant all on tables to anon, authenticated, service_role` for schema `public`. Every table drizzle-kit created as `postgres` therefore inherited **full privileges** for `anon` and `authenticated` on production. Row-level security does not help: `TRUNCATE` is exempt from RLS by design, so a policy-scoped session can still erase every tenant's rows and the audit log. Migration 0007's `revoke update, delete on events from authenticated` landed correctly but never touched `anon` and never touched TRUNCATE. This contradicts **D-06** (events immutable by grant) and **T-1-03** ("no deployed code can bypass RLS").
- **Probes, all on production inside rolled-back transactions:**

  | Probe | Statement | Role | Result |
  | --- | --- | --- | --- |
  | P1 | `truncate public.events` | `authenticated` | **SUCCEEDED** |
  | P3 (control) | `update public.events` | `authenticated` | refused — `permission denied` (0007 works) |
  | P4 | `delete from public.events` | `anon` | `DELETE 0` — RLS filtered, so the grant was invisible to a DML probe |
  | P6 | `truncate orgs, businesses, source_records, events cascade` | `authenticated` | **SUCCEEDED** |
  | P7 | same | `anon` | **SUCCEEDED** |
  | P8 | row counts after P6 | — | `0, 0, 0, 0` |

  P3 and P4 are why this was not caught earlier: the DML path behaves exactly as designed. Only the TRUNCATE attempt reveals it.

- **Side-by-side, production vs local:**

  | Object / role | Production | Local |
  | --- | --- | --- |
  | `events` → `authenticated` | INSERT, REFERENCES, SELECT, TRIGGER, **TRUNCATE** | INSERT, SELECT |
  | all four tables → `anon` | full DML + **TRUNCATE** | none |

- **Disposition: CLOSED BY GAP PLAN `.planning/phases/01-foundations-tenancy/01-12-PLAN.md`** (type `gap_closure`, wave 6). danlo chose "fix now, before the deploy". The orchestrator committed 01-12 in `2abd654`; it runs immediately after this continuation and **before plan 11 deploys**. It adds migration `0008_revoke_platform_grants.sql` (applied by drizzle-kit to both databases, D-09), reproduces the platform condition on local so the guard can be watched failing for the real reason, adds `tests/db/grants-audit.test.ts` pinning SQLSTATE `42501`, and revokes the default ACL so future tables cannot inherit it.
- **Nothing was fixed in this plan.** The fix is a migration, which is a schema change, which belongs in a plan carrying its own watched-failing guard and its own mutation check.
- **Files modified:** none here.

### Note, not a deviation

`vercel link` also wrote a `VERCEL_OIDC_TOKEN` line into `.env.local`. It is left in place: the file is gitignored, the token is unused by this application, and removing it would only be re-added by the next `vercel link` or `vercel env pull`. Recorded so a future reader who greps `.env.local` is not surprised by a variable that appears in no plan and no `.env.example`.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug covering four separate recipe defects), 1 architectural finding escalated and routed to gap plan 01-12.
**Impact on plan:** No scope creep. The `.gitignore` revert protects a tracked file the whole phase depends on. The recipe defects changed how criteria were checked, never what was built, and explicitly did not change documentation to make a check pass. The Rule 4 finding is the plan's most valuable output and is the reason the parity side-by-side was specified at all — it is fixed by 01-12 before anything deploys.

## Issues Encountered

- **The Vercel CLI's own output is misleading in two places**, both resolved by reading a different source rather than guessing: `vercel teams ls` prints the team slug under a column headed `id`, and `vercel project inspect` reports `Framework Preset: Other` for a Next.js project. The first was resolved against `.vercel/project.json`'s `orgId`, the second against `bis-platform` — a live Next.js deployment on the same team that reports the identical preset. Both are written into `docs/deploy.md` §1 so they cost nobody else the same time.
- **A green migration proves nothing about a database's privilege surface.** `pnpm db:migrate:prod` exited 0 twice, `pnpm build` and the full local suite were green, and production was still wide open to TRUNCATE. The side-by-side is what found it, and only because it compared privileges rather than object counts alone.

## User Setup Required

Complete. Task 3 was the user-setup step and it is done: `app_user` has a password, six variables are on Vercel Production and Preview, three secrets are on GitHub Actions.

**One item outstanding by design:** the GitHub repository *variable* `E2E_BASE_URL` is not set. It cannot be until plan 11 produces the production URL. Plan 11 owns it.

## Next Phase Readiness

**Ready:**
- Everything plan 11's deployment needs, short of the deploy itself: a linked, git-connected Vercel project on Node 24; a migrated production schema verified identical to local; a runtime credential proven by connecting with it.
- `/api/health` (plan 08) is the smoke target and `docs/deploy.md` §8 records the exact commands and what each field proves.

**Blockers and concerns:**
- 🔴 **Gap plan 01-12 must run before plan 11 deploys.** Deploying onto the current production grant surface would ship an application whose `authenticated` sessions can truncate every tenant's rows and the audit log. 01-12 is wave 6, queued immediately after this plan.
- `E2E_BASE_URL` is pending and is plan 11's to set.
- A "password authentication failed" immediately after any Supabase password change can take two to three minutes to clear — recorded in `docs/deploy.md` §5 so nobody "fixes" a correct value.

## Self-Check

Files claimed created, verified present on disk:

- `.vercelignore` — FOUND
- `docs/deploy.md` — FOUND
- `.vercel/project.json` — FOUND (gitignored, as intended)
- `.planning/phases/01-foundations-tenancy/01-10-SUMMARY.md` — this file

Commits claimed, verified in `git log`:

- `a691f11` `chore(01-10): create and link the Vercel project siteless` — FOUND
- Tasks 2 and 3 are correctly commitless: the plan declares `files: none` for Task 2, and Task 3 touches only external services. No missing commit is implied.

External state re-verified at SUMMARY time, not taken from the checkpoint reply:

- `vercel env ls` — 12 rows, 6 names × (Production, Preview), all Encrypted; `SUPABASE_DB_URL` and `TEST_DATABASE_URL` absent — PASS
- `gh secret list` — 3 secrets — PASS
- `gh variable list` — empty, `E2E_BASE_URL` absent as expected — PASS
- `.env.local` shape counts (7 assertions) — PASS, no value read
- `git status --short` — empty; `.env.local` and `.vercel` not listed — PASS
- Credential grep, literal / scoped / shape-based — PASS (no credential in the repository)

## Self-Check: PASSED

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-22*
