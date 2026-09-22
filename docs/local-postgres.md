# Local PostgreSQL 18 — the test database

This is the database the RLS / grant / constraint suite runs against. It is **local only**.
The Supabase project `siteless` (`jahgeqshuesndyscnmjo`) is production and is **never** a test
target (D-04).

Follow these steps in order. Everything here is done once.

---

## 1. Install

Download the PostgreSQL **18** Windows installer from
<https://www.postgresql.org/download/windows/> (EDB).

During setup:

- Keep **PostgreSQL Server**, **Command Line Tools** and **Stack Builder** checked.
- Port: `5432`.
- Locale: default.
- Choose a superuser password and keep it. You will need it in step 4.

No reboot is needed.

## 2. Confirm

Open a **new** PowerShell window (so `PATH` is refreshed) and run:

```powershell
psql --version
```

It must print `psql (PostgreSQL) 18.x`.

If `psql` is not found, add `C:\Program Files\PostgreSQL\18\bin` to `PATH` and reopen
PowerShell.

## 3. Create the test database

```powershell
psql -U postgres -c "create database siteless_test"
```

Confirm it exists:

```powershell
psql -U postgres -l
```

`siteless_test` must appear in the list.

## 4. Set `.env.local`

`.env.local` is gitignored — it is the only place a value ever lives. Add:

```
TEST_DATABASE_URL=postgres://postgres:<the superuser password>@localhost:5432/siteless_test
SUPABASE_DB_POOL_URL=postgres://app_user:app_user@localhost:5432/siteless_test
```

URL-encode the password if it contains any of `@ : / ? # [ ] %`.

The `app_user` role and its local password are created by `pnpm db:migrate` in plan 04 — the
`SUPABASE_DB_POOL_URL` line above is correct **before** the role exists, it simply cannot
connect yet.

## 5. Why not Docker

`docker` resolves nowhere on this machine and `wsl --status` reports "not installed"
(verified 2026-09-20). D-05a therefore replaces D-04's `supabase start` path with this native
install plus `drizzle/0000_bootstrap.sql`, which creates the `anon` / `authenticated` /
`service_role` / `app_user` roles and the `app` schema so that a bare Postgres looks like
Supabase.

CI's `postgres:18` service container runs the identical bootstrap. That is what makes dev and
CI byte-identical.

## 6. What this database must never be

`TEST_DATABASE_URL` pointing at `jahgeqshuesndyscnmjo` would run the RLS suite against
production. `scripts/db.ts` (plan 04) refuses any `--target=test` URL whose host matches
`supabase`.

Check the line before you use it:

```powershell
# must print nothing
Select-String -Path .env.local -Pattern '^TEST_DATABASE_URL=.*supabase'
```

---

## Do not install Supabase CLI

Do **not** install the Supabase CLI, and do **not** run `supabase db push` in this repo.
**drizzle-kit is the single migration authority (D-09)** — RLS policies are declared in the
schema next to their tables, and two migration systems pointed at one database is a
guaranteed drift bug.

The three database URLs are three distinct names and are never interchangeable:

| Name | Used by | Points at |
|---|---|---|
| `TEST_DATABASE_URL` | tests, local migrations | local PostgreSQL 18, `siteless_test` |
| `SUPABASE_DB_POOL_URL` | the runtime | local Postgres as `app_user` in dev; the transaction pooler (`:6543`, `prepare: false`) in production |
| `SUPABASE_DB_URL` | `drizzle-kit` against production only | the **session** pooler, `:5432` — never the IPv6-only `db.<ref>.supabase.co` direct address |
