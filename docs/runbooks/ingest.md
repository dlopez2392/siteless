# The desk ingest — Comptroller, Overture, resolve

This runbook loads the free data spine for the four RGV counties into one org. It runs three desk
scripts in order. Nothing in the deployed app calls Socrata, the Overture bucket or the Census
geocoder. These scripts are the only callers.

Follow the steps in order. Every step can be re-run.

The first real run is recorded in `docs/measurements/03-desk-run.md`. Check a new run's counts
against those numbers.

---

## 0. The launcher

Bare `pnpm` on this machine is a broken 11.9.0. Use the pinned 12.5.1 from the store:

```sh
PNPM="node /c/Users/danlo/AppData/Local/pnpm/store/v11/links/@/pnpm/12.5.1/2097cbb8d3fdcf63cc8ef1bd7c2ab483d4f3ab1ae34974b1097f9a70a69a4422/node_modules/pnpm/bin/pnpm.mjs"
```

🔴 `pnpm verify` does **not** run on this machine. It chains bare `pnpm`. Run its five parts
yourself, with the launcher above:

1. `$PNPM typecheck`
2. `$PNPM lint`
3. `$PNPM test:unit`
4. `$PNPM test:db`
5. `$PNPM build`

🔴 `$PNPM test:db -- -t "name"` does **not** filter. The whole suite runs and exits green. To run
one test, call vitest directly and read the test names in the output:

```sh
npx vitest run --config vitest.db.config.ts --pool=forks tests/db/ingest-idempotency.test.ts -t "re-run is idempotent" --reporter=verbose
```

## 1. Prerequisites

- `.env.local` holds `TEST_DATABASE_URL`. It points at the local `siteless_test` database
  (`docs/local-postgres.md`). Every script defaults to `--target=test`, and a test target refuses
  any Supabase host.
- Migrations are applied through `0025_review_fixes_spine.sql` (the review-03 fixes: the
  write-gated re-derivation helper the ingests call for merged businesses):

  ```sh
  $PNPM db:migrate
  ```

- The seed has run:

  ```sh
  $PNPM db:seed
  ```

  The seed loads the county codes, the cluster NAICS ranges, the city spellings and the 70
  built-in `overture_category_map` rows. The Overture ingest refuses to start when that map is
  empty. Without it, every row would land with no cluster and never reach the funnel.
- **The org's `clerk_org_id`.** Every script takes it as `--org=`. None of them ever falls back
  to "the only org". The org row must already exist. The app creates it the first time someone
  signs in to that Clerk org. List what the database has:

  ```sql
  select clerk_org_id, id, display_name from orgs order by created_at;
  ```

  Rows called `org_A`, `org_B`, `org_*_fixture` or `org_smoke_*` belong to tests. Never ingest
  into them.

## 1a. 🔴 The org-context preflight — run it and read the output before step 2

The ETL connects as the migration owner and sets no Clerk claims. `app.current_org_id()`
(`drizzle/0002_tenancy_functions.sql`) resolves the org from `request.jwt.claims` and nothing
else. Each script installs that claim at the top of every transaction (`resolveEtlOrg`). If the
claim resolves to nothing, every `finishRun()` and every auto-merge raises
`42501 emit_event: no current org`, and that happens only after the Census geocode has already
taken minutes.

Run this once, with the real `clerk_org_id`:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  begin;
  select set_config('app.actor_id','etl:preflight',true);
  select set_config('request.jwt.claims',
    json_build_object('o', json_build_object('id','<clerk_org_id>'))::text, true);
  select app.current_org_id() as org_id;
  rollback;"
```

`psql` is at `C:\Program Files\PostgreSQL\18\bin\psql.exe` and may not be on `PATH`.

🔴 The query must print a **non-null uuid**, and that uuid must equal `orgs.id` for the org.
A null means the `clerk_org_id` is not in `orgs`. Check the spelling against the query in
step 1. **Do not start the run on a null.**

The resolve script checks this again in code (stage 0, `preflight()`). The ingest scripts fail
on an unknown org in their first transaction, before any request goes out.

## 2. The three commands, in order

Run them from the repository root, one after another. Each prints its own report and writes it
to `ingest_runs`.

### 2.1 Comptroller — permits, Census geocode, closures

```sh
$PNPM ingest:comptroller --org=<clerk_org_id>
```

This is `tsx scripts/ingest-comptroller.ts`. It writes three `ingest_runs` rows:

| Source | What | Expect |
|---|---|---|
| `tx_comptroller` | `jrea-zgmq` active permits, padded county codes `031,108,214,245`, one 50,000-row request | ~**34,928** rows, fetched in ~2.5 s. Plus one statewide grouped request for D-11 (~11,600 names) |
| `census_geocoder` | every permit's **outlet** address through the Census batch geocoder, 1,000 rows per request, 3 in flight | ~5–9 min of network. Measured: **79.9 %** matched (27,903), 7,025 unlocated. Research had 70.9 %. Unlocated rows are expected, not a failure |
| `tx_comptroller_closures` | `3kx8-uryv`, **unpadded** county codes `31,108,214,245` | ~**21,509** rows over ~21,467 keys. The feed repeats some keys with different dates, and the script folds them to the latest date. `closed_at` is set by exact key match only |

🔴 The write path is one row at a time on one connection. The fetches take seconds. The writes
take most of the wall clock: **~13 min** for the first run on the local database, and ~6–8 min
for a re-run (mostly the Census network). Against production, add the network round trip for
every statement.

### 2.2 Overture — the RGV places

List the releases first. The bucket keeps **exactly one**:

```sh
$PNPM ingest:overture --org=<clerk_org_id>
```

With no `--release`, the script lists what the bucket holds and exits without reading any data.
Then run it with that release:

```sh
$PNPM ingest:overture --org=<clerk_org_id> --release=<YYYY-MM-DD.N>
```

This is `tsx scripts/ingest-overture.ts`. It writes one `overture` run.

| Step | Expect |
|---|---|
| bbox range-read through DuckDB | ~**98,960** rows in ~10 s |
| `country='US' AND region='TX'` | ~**56,944** kept, ~**41,532 (42.0 %)** dropped as Mexican-side |
| the write | one row at a time, 500 per transaction |

The run's `stats` carries the confidence distribution (rows per 0.1 band), `permanently_closed`,
the NULL `basic_category` count, and the unmapped `basic_category` tail with counts.

### 2.3 Resolve — block, score, auto-merge

Dry-run first. It writes the candidates and their scores and merges nothing:

```sh
$PNPM resolve --org=<clerk_org_id> --dry-run
```

Read the printed `bands` and any `skipped block` lines. Then run the real pass:

```sh
$PNPM resolve --org=<clerk_org_id>
```

This is `tsx scripts/resolve.ts`. The report is one `resolve` event (`app.emit_event`), not an
`ingest_runs` row. Measured on the first run (`03-desk-run.md`):

| | Expect |
|---|---|
| chains flagged | ~3,343 names / ~16,942 rows |
| candidates | ~**79,484**: phone 12,707 · address 15,113 · trigram 51,664. Research's 29,701 counted cross-source pairs only |
| `trigram plan` | `gin` |
| blocks refused over the 500-pair cap | ~171, all `addr:` (shopping centres), each named in the report |
| bands | ≥95 ~1,077 · 80–94 ~12,591 · <80 ~64,329 |
| wall clock | **~12 min** per pass. Stage 2 (B3) takes 6–12 min, and stage 5 takes ~6 min at ~343 ms per merge |

A second pass over the same spine inserts no new candidates and rewrites no scores.

🔴 If stage 2 throws `TrigramPlanError`, re-run once, because the ANALYZE it just ran may not have
settled yet. If it refuses a second time, stop and investigate the plan. **Never disable the
guard.** The refused plan is an O(n²) pass measured in hours.

## 3. What the run reports and where to read it

The four `/sources` rows are the latest `ingest_runs` row per `source_key`:

```sql
select source_key, status, added, changed, unchanged, gone, total_seen,
       source_version, finished_at - started_at as took
  from ingest_runs
 where org_id = (select id from orgs where clerk_org_id = '<clerk_org_id>')
 order by started_at;
```

The per-source detail is in `ingest_runs.stats`:

- `census_geocoder`: `matched, exact, non_exact, tie, no_match, chunks_failed, locations_written,
  location_cleared` (a No_Match or Tie for an address the permit moved to clears the old point)
- `tx_comptroller`: `unmapped_naics, city_unfolded, rejected_rows, statewide_names`
- `tx_comptroller_closures`: `businesses_closed, closed_via_merge_winner`
- `overture`: `confidence_bands, unmapped_basic_category, skipped, permanently_closed`

🔴 `tx_comptroller.stats` also holds `statewide_name_frequency`, a map of about 400 KB. Select the
keys you need instead of the whole `stats`.

The resolve report:

```sql
select occurred_at, after from events
 where action = 'resolve' order by occurred_at desc limit 1;
```

## 4. 🔴 Re-running is safe, and that is the point

Every pass is idempotent by external id. A source record whose payload hash has not changed is
counted `unchanged` and writes nothing. That means no `businesses` update and no `events` row.
A second run over unchanged sources reports **every row `unchanged`, `added = 0`,
`changed = 0`**, and adds zero `businesses` events.

`gone` counts records that an earlier run saw and this run did not. The run counts them and
deletes nothing.

What a re-run **does** write: `source_records.last_seen_at` on every record it saw (that is how
`gone` works, and it emits no event), plus exactly one `ingest_runs … complete` event per run.

Check it after any re-run:

```sql
select count(*) from events
 where org_id = (select id from orgs where clerk_org_id = '<clerk_org_id>')
   and entity_type = 'businesses' and occurred_at > '<re-run start>';   -- must be 0
```

`03-desk-run.md` proves this at full volume, and records the two defects the first attempt
found. One was duplicate keys in the closure feed. The other was the Census pass overwriting
merge-chosen locations.

## 5. 🔴 Three facts about Overture releases

1. **The bucket keeps exactly one release.** A pinned `--release` string records provenance. It
   does not guarantee you can fetch that release again. Once the next release lands, the old one
   is gone.
2. **`categories` is gone** from the September 2026 release. The script reads only
   `basic_category`, so it works on any release.
3. **The committed CI fixture** (`tests/unit/fixtures/overture-rgv-sample.json`, 193 real rows)
   is the only reproducible copy of any release. Re-cut it with
   `tsx scripts/ingest-overture.ts --release=<r> --sample=<path.json>`. That touches no
   database.

## 6. Production

Production gets the same three commands with `--target=prod`. That needs `SUPABASE_DB_URL`
pointed at the **session** pooler on `:5432`, and the scripts refuse anything else. Production
runs behind danlo's go-ahead only (plan 03-21). Never run them from a test session.

## 7. 🔴 When a derivation rule changes — the rederive pass

Section 4's guarantee has a cost. A re-run writes nothing for an unchanged payload, so a change
to anything that is **not in the payload** never reaches a stored row by re-ingesting:

- a normalizer fix (`src/lib/normalize/` — `name_norm`, `street_norm`, phone blockability),
- the Overture phone pick (`pickPhone`, `src/lib/overture/transform.ts`),
- a new or edited `overture_category_map` row, or a changed NAICS range in `clusters.json`
  (`cluster_key` — D-02's "adding a cluster is a mapping change, not a re-ingest"),
- a new `cities.name_variants` spelling (the Comptroller `city` fold).

Every one of those derivations lives in `src/lib/resolve/derivation.ts` (or is called from it),
and the ingests AND survivorship both go through it. When you change one, **bump
`DERIVATION_VERSION`** in that file, then run the rederive pass for each org:

```sh
$PNPM rederive --org=<clerk_org_id> --dry-run     # every batch rolled back; read the counts
$PNPM rederive --org=<clerk_org_id>
```

This is `tsx scripts/rederive.ts`. For every business it recomputes, from the STORED payloads:

1. `name_norm`, from the record that created the business (merged-away rows included — an
   unmerge re-derives a loser's other columns but never its `name_norm`);
2. every survivorship-owned column of every cluster **root**, through the same `survive()` a
   merge uses (a single-record business is a cluster of one).

It writes a row only when a value really differs (`app.apply_survivorship_if_changed`, 0025),
so a pass over an up-to-date spine writes **zero** rows and zero `businesses` events. The report
is one `rederive` event (`etl:rederive`) carrying `derivation_version`, `name_norm_written`,
`survivorship_written` and up to 20 sample root ids — open two or three on `/businesses/[id]`
and check the change is the one you meant.

🔴 **Then run `pnpm resolve --org=<clerk_org_id>`** whenever `name_norm_written > 0`. Chain flags
(`chain_key` is a `name_norm`), blocking and every pending candidate's score are computed from
`name_norm`; the resolve pass recomputes them.

🔴 Order after merging the review-03 normalizer fixes (B-CR-01 `name.ts`, B-WR-01..03): migrate,
then `rederive --dry-run`, read the counts, `rederive`, then `resolve --dry-run`, `resolve`.
Do it against the test database first; production is the same commands with `--target=prod`,
behind danlo's go-ahead.
