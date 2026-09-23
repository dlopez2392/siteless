---
phase: 03-free-data-spine-entity-resolution
plan: 01
subsystem: database
tags: [pg_trgm, unaccent, haversine, drizzle-kit, duckdb, libphonenumber-js, vercelignore]
requires: []
provides:
  - "pg_trgm 1.6 + unaccent 1.1 on the test database (migration 0021)"
  - "app.distance_m(lat1, lon1, lat2, lon2) -> metres; immutable parallel safe; replaces PostGIS"
  - "@duckdb/node-api 1.5.5-r.5 (devDependency) and libphonenumber-js 1.13.13 (dependency)"
  - "package.json scripts ingest:comptroller, ingest:overture, resolve (targets land in 03-12..03-14)"
  - ".vercelignore excludes coverage/"
affects: [03-05, 03-06, 03-12, 03-13, 03-14, resolver, blocker, normalizer]
tech-stack:
  added: ["@duckdb/node-api@1.5.5-r.5 (dev)", "libphonenumber-js@1.13.13", "pg_trgm 1.6", "unaccent 1.1"]
  patterns: ["pure-SQL haversine instead of a spatial extension", "set local pg_trgm.similarity_threshold in every transaction that uses %"]
key-files:
  created:
    - drizzle/0021_extensions.sql
    - drizzle/meta/0021_snapshot.json
    - tests/db/extensions.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - .vercelignore
    - drizzle/meta/_journal.json
key-decisions:
  - ".vercelignore already existed with load-bearing exclusions; coverage/ was APPENDED, not written over"
  - "Added a `comment on function app.distance_m` statement (repo convention: custom migrations end in a comment-on) — gives 4 breakpoints between 5 statements"
  - "Distance expectation kept at the plan's 142343 +/-100; the function returns 142,330 m on the plan's coordinates (13 m inside tolerance)"
requirements-completed: [DEDUP-01, DEDUP-04]
duration: ~12min
completed: 2026-09-22
---

# Phase 3 Plan 01: Extensions + app.distance_m Summary

**Migration 0021 installs `pg_trgm 1.6` and `unaccent 1.1` and ships a pure-SQL haversine `app.distance_m()` in place of PostGIS. It also adds `@duckdb/node-api` (dev only) and `libphonenumber-js`, three Phase 3 script entries, and a `coverage/` exclusion in `.vercelignore`.**

## Performance

- **Duration:** about 12 min (19:44 to 19:56 CDT)
- **Tasks:** 3/3
- **Files:** 3 created, 4 modified

## Accomplishments

- **Extensions, measured on the test DB:** `pg_trgm 1.6` and `unaccent 1.1`, both in `public`, on PostgreSQL 18.6. The test names both versions.
- **`app.distance_m`:** `provolatile=i`, `proparallel=s`, `prosecdef=false`, and `authenticated` can execute it. Measured values:
  - Brownsville to Rio Grande City: **142,330.3 m**
  - McAllen to Edinburg: **12,795.3 m**
  - Identical point: **0**
- **No drift:** `db:generate` after migrate printed "No schema changes, nothing to migrate".
- **Packages:** the lockfile carries all 8 `@duckdb/node-bindings-*` platform packages, including `linux-x64` for CI.

## Task Commits

1. **Task 1: packages, script entries, `.vercelignore`** (`c8d1195`, chore)
2. **Task 2: migration 0021 + `app.distance_m`** (`b665fb0`, feat)
3. **Task 3: `tests/db/extensions.test.ts`** (`bcdec69`, test)

## Verification (every command run, output read)

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0, run after Task 1 and again after Task 3 |
| `pnpm lint` | exit 0 |
| `pnpm db:migrate` | "migrations applied successfully"; `__drizzle_migrations` id 24 added |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db -t "extensions"` | **3 passed, 102 skipped.** The PASS list names all three: `extensions are installed at the pinned versions`, `app.distance_m matches the measured RGV distances`, `pg_trgm similarity is available to the blocker` |
| `pnpm test:db` (full) | **16 files, 105 tests passed** (was 15/102 before this plan; no regression) |
| `pnpm test:unit` | **20 files, 81 tests passed** (includes `no-google-credential`, T-3-14) |
| `pnpm build` | not run. Not in this plan's verification list, and `pnpm verify` is not runnable here (Pitfall 15) |

### Mutation checks (live test DB, each one reverted and the revert checked)

| Mutation | Tests that went red | Revert checked by |
|---|---|---|
| M1 `drop extension unaccent` | only `extensions are installed at the pinned versions` (diff: the missing `unaccent 1.1` row) | `pg_extension` lists `unaccent 1.1` again |
| M2 `app.distance_m` with lat and lon swapped | only `app.distance_m matches the measured RGV distances` (`expected 4937.5 to be less than or equal to 100`) | `pg_get_functiondef` identical to the saved original (`true`); 142,330.3 m again |
| M3 `drop extension pg_trgm` | `extensions are installed…` plus `pg_trgm similarity is available…` (`function similarity(unknown, unknown) does not exist`); the distance test stayed green | `pg_extension` lists `pg_trgm 1.6` again |

`git diff --stat` stayed empty through all three: the mutations touched only the database, never the migration file. Full suite green after the reverts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `.vercelignore` already existed, so writing it fresh would have caused a regression**
- **Found during:** Task 1
- **Issue:** The plan said to *create* `.vercelignore` containing only `coverage/`. The file already exists from 01-10 and 01-11. It excludes `.planning/`, `docs/`, `tests/`, `drizzle/`, `*.md` and `.github/`, plus the three harness configs. Replacing it with one line would ship `tests/` again, which brings back the TS2307 `next build` failure on Vercel that 219acba fixed. It would also put migration files in the deploy bundle.
- **Fix:** Appended `coverage/` with a comment explaining why. The criterion "`cat .vercelignore` prints exactly `coverage/`" therefore cannot hold literally. What it is meant to prove, that `coverage/` is excluded, does hold (`grep -n '^coverage/$'` returns line 30).
- **Commit:** `c8d1195`

**2. [Plan inconsistency] Statement-breakpoint count**
- **Found during:** Task 2
- **Issue:** The plan's SQL has 4 statements, so 3 separators. Its acceptance criterion requires 4.
- **Fix:** Added a fifth statement, `comment on function app.distance_m(...)`, which records the argument order, unit and radius in the catalog. Custom migrations 0013 and 0015 end the same way. There is no trailing separator, which also follows repo convention. `grep -c` now returns 4. The comment string avoids the word "PostGIS", so `grep -in postgis` only matches the `--` rationale comment lines 14–15.
- **Commit:** `b665fb0`

**3. [Plan inconsistency] `pnpm test:db -- -t "extensions"` ignores the filter under pnpm 12**
- **Found during:** Task 3
- **Issue:** pnpm 12.5.1 passes `--` through literally, and vitest then drops the `-t`. The verify command as written ran all 105 tests and exited green, which says nothing about the filter.
- **Fix:** Ran `pnpm test:db -t "extensions"` (no `--`) and read the PASS list: 3 passed, 102 skipped. The `describe` title includes "extensions" so the filter picks up all three tests. **Later plans that copy the `-- -t` form get the same silent no-op.**

### Notes (no change made)

- **`anon` also has EXECUTE on `app.distance_m`.** `0000_bootstrap.sql:54` sets `alter default privileges in schema app grant execute on functions to authenticated, anon, service_role`, so every `app.*` function starts that way. The explicit `grant … to authenticated` in 0021 therefore duplicates the default privileges, and no mutation could make it fail. For that reason there is no test on the grant (it would be theatre). This function is pure maths over its arguments and touches no table, which is consistent with T-3-05's `accept`.
- **Measured value vs research value:** 142,330 m against the research's 142,343 m. The difference is 13 m, inside the ±100 m tolerance, so the committed expectation is unchanged. The test header records both values and the coordinates used.
- **Open question A1 is still open.** It gets answered by the first CI `db` job run on `postgres:18` after this lands. If `create extension pg_trgm` fails there, STOP. The fallback (drop `unaccent`, block on `(postal, left(name_norm,4))`) is a plan change.
- **For 03-13:** `scripts/` is not in `.vercelignore`, so `next build` on Vercel will type-check `scripts/ingest-overture.ts`. That still works, because Vercel installs devDependencies and `@duckdb/node-api` resolves. The rule that it never gets imported from `src/` is still enforced only by convention.

## Threat Flags

None. No new endpoint, auth path or trust-boundary surface beyond the plan's threat model.

## Known Stubs

None. The three `package.json` script entries point at files that 03-12, 03-13 and 03-14 will create. The plan intends this: they do nothing until then.

## Self-Check: PASSED

- FOUND: drizzle/0021_extensions.sql, drizzle/meta/0021_snapshot.json, tests/db/extensions.test.ts, .vercelignore (coverage/ at line 30)
- FOUND commits: c8d1195, b665fb0, bcdec69
- STATE.md / ROADMAP.md untouched
