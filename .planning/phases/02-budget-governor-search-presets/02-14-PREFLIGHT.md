# 02-14 Task 1 — Production pre-flight (READ ONLY)

Recorded before anything in this phase writes to production. Every connection below opened
`begin read only`; only names and counts were selected. No connection string, password or
key was printed or stored.

- **Taken:** 2026-09-22
- **Production target:** Supabase `jahgeqshuesndyscnmjo`, via `SUPABASE_DB_URL` (session
  pooler, port 5432 — the only pooler that can run migrations)
- **Local target:** `TEST_DATABASE_URL`

## Side by side

| Reading | Production | Local |
| --- | --- | --- |
| `version()` | **PostgreSQL 17.6** on x86_64-pc-linux-gnu, gcc 15.2.0, 64-bit | **PostgreSQL 18.6** on x86_64-windows, msvc-19.44.35228, 64-bit |
| `drizzle.__drizzle_migrations` rows | 12 (`0000_bootstrap` … `0011_events_no_caller_insert`) | 17 (`0000_bootstrap` … `0016_budget_meter_functions`) |
| `public` tables | 4 | 16 |
| `app.*` functions | 6 | 11 |
| `pg_policy` count | 12 | 56 |
| non-internal triggers | 13 | 19 |

**Production `public` tables (4):** `businesses`, `events`, `orgs`, `source_records`

**Production `app.*` functions (6):** `current_org_id`, `emit_event`, `ensure_org`, `jwt`,
`log_event`, `touch_updated_at`

**Local-only tables (12) — exactly this phase's set:** `budget_periods`, `cities`,
`cost_ledger`, `cost_reservations`, `counties`, `geo_presets`, `industry_clusters`,
`industry_terms`, `outlet_counts`, `runs`, `search_versions`, `searches`

**Local-only `app.*` functions (5) — exactly this phase's meter:** `current_org_role`,
`ensure_budget_period`, `reserve_budget`, `set_budget_cap`, `settle_reservation`

**The gap Task 2 closes:** +12 tables, +5 functions, +44 policies, +6 triggers, +5 migrations
(`0012_eager_vertigo`, `0013_reference_policies_and_grants`, `0014_brown_phantom_reporter`,
`0015_budget_grants_and_triggers`, `0016_budget_meter_functions`).

## STOP conditions — all clear

| # | Condition | Result |
| --- | --- | --- |
| 1 | Any of this phase's twelve tables already on production | **CLEAR** — none present |
| 2 | `public` holds only Phase 1's four tables | **CLEAR** — exactly those four, nothing more |
| 3 | Every applied migration exists in `drizzle/` | **CLEAR** — all 12 applied hashes match a committed file |

Nothing other than drizzle-kit has written to this database. D-09 holds. `ls supabase`
finds nothing (exit 2): there is no Supabase CLI migration directory in this repository.

## Portability gates, re-run immediately before the production write

Test **names** read from the output, not just the exit code:

```
pnpm test:unit -t "pg17"        -> 2 passed, exit 0
  ✓ pg17: no migration uses PostgreSQL 18-only syntax
  ✓ pg17: the comment-stripping guard is not self-invalidating

pnpm test:db   -t "server version" -> 1 passed, exit 0
  ✓ server version: the test database is at least PostgreSQL 17
```

## Findings worth carrying into Task 2

**1. `drizzle.__drizzle_migrations` has no `name` column.** The plan's pre-flight query
`select name from ...` cannot run. The real columns are `(id, hash, created_at)`, where
`hash` is the sha256 of the migration file's full text and `created_at` is the journal's
`when`. Applied migrations were therefore identified by hashing each `drizzle/<tag>.sql`
and matching. Idempotency on the second `db:migrate:prod` run is decided by `created_at`
versus the journal's `when`, not by the hash.

**2. The recorded hashes vary by line ending, not by content.** Production's `0000`–`0006`
were applied from CRLF text and `0007`–`0011` from LF text; locally all of `0000`–`0015`
hash as LF. This is a checkout artifact and carries no schema meaning — the same file, read
with different line endings, hashes differently.

**3. Local `0016_budget_meter_functions` matches no hashing variant of the committed file,
so the local database was migrated from a pre-commit draft.** `git log` shows the file has
exactly one commit (`4098e86`) and has never been edited since, and the working tree is
clean — so the committed text is final and it is the *local* row that is stale. Because
every Phase 2 gate ran against local while production will receive the committed file, this
was verified behaviourally rather than by hash: `pg_get_functiondef()` for all five
functions in the live local database was compared against the bodies in the committed
`0016`, normalised for whitespace and comments.

> **All five bodies are identical** — `current_org_role`, `ensure_budget_period`,
> `reserve_budget`, `settle_reservation`, `set_budget_cap`.

`0016` contains nothing but those five `create or replace function` statements and their
five `grant execute ... to authenticated` lines; the grants are verified directly in Task
2's post-flight. What was tested locally is what will be applied to production.

**4. The plan says production carries "Phase 1's five" `app.*` functions; it carries six.**
The sixth is `emit_event`. Local carries the same six plus this phase's five, so the pair is
consistent and the plan text is simply one stale. Not a defect.

**5. The literal credential criterion is unsatisfiable, as 01-10 already recorded.** The
regex `sk_|eyJ|://[^ ]*:[^ ]*@` contains `sk_`, so every plan or summary that writes the
regex down matches itself; `02-14-PLAN.md` contributes two such lines. The discriminating
scan 01-10 settled on was run instead:

| Scan | Result |
| --- | --- |
| live-shaped keys (`sk_live_`, `pk_live_`, `sk_test_`/`pk_test_` + 20 chars, `eyJ` + 20 chars) | only `pk_test_cGxhY2Vob2xkZXIuY2xlcmsuYWNjb3VudHMuZGV2JA==` in `.github/workflows/ci.yml`, which base64-decodes to `placeholder.clerk.accounts.dev$` |
| connection strings not pointing at `localhost` / `127.0.0.1` | one illustrative URL in `01-REVIEW.md` whose password is the literal `x` |
| the project ref in `src/`, `tests/`, `scripts/`, `drizzle/` | three explanatory D-04 comments; the ref is an identifier, not a credential, and `docs/deploy.md` already publishes it |

No real credential is present in the repository.
