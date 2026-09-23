---
phase: 03-free-data-spine-entity-resolution
plan: 12
subsystem: ingest
tags: [etl, socrata, census-geocoder, closures, desk-script, d-01, d-03, d-08, d-11]
requires:
  - phase: 03-03
    provides: "Socrata client (socrataQuery, socrataRowsUpdatedAt, quote, padded/unpaddedCountyCode), permits + closures transforms, msw Socrata replay"
  - phase: 03-06
    provides: "nameNorm / addressKey normalizers"
  - phase: 03-07
    provides: "geocodeBatch, locationMatchType, CENSUS_BATCH_CHUNK, BatchOutcome"
  - phase: 03-09
    provides: "upsertSourceRecord / upsertBusinessFromSource, startRun / countGone / finishRun, setEtlActor + resolveEtlOrg"
provides:
  - "scripts/ingest-comptroller.ts: the Comptroller desk ingest writing three /sources rows (tx_comptroller, census_geocoder, tx_comptroller_closures)"
  - "parseIngestArgs + IngestOrgRequiredError: the --org gate (T-3-01)"
  - "etlTransactions: every transaction opens with setEtlActor then resolveEtlOrg"
  - "CLOSURE_UPDATE_SQL + applyClosures: D-03 exact-key closure write, resolved to the merge winner"
  - "src/lib/socrata/statewide-names.ts: fetchStatewideNameFrequency (D-11 'across Texas'), foldStatewideRows, STATEWIDE_NAMES_QUERY"
affects: [03-10, 03-15, 03-17, 03-20, 03-22]
tech-stack:
  added: []
  patterns:
    - "Desk-script transaction runner: BEGIN, then setEtlActor, then resolveEtlOrg, first in every transaction; `nested` swaps to SAVEPOINTs so a rolled-back smoke can drive the same code"
    - "Query-shape tests: a capture handler installed in front of the shared replay handler, asserting on the request the client was handed and answering []"
    - "A large derived artifact (the statewide map) is written onto the run row AFTER finishRun, so it stays out of the run's events.after"
key-files:
  created:
    - scripts/ingest-comptroller.ts
    - src/lib/socrata/statewide-names.ts
    - tests/unit/ingest-comptroller.test.ts
  modified: []
key-decisions:
  - "The statewide name-frequency request is PRACTICAL (measured live: 11,647 groups, 548 KB, 1.8 s, one page), so FLAG_CHAIN keeps 'in Texas' and the 'in the RGV' fallback was not taken"
  - "The statewide map is persisted as ingest_runs.stats.statewide_name_frequency on the tx_comptroller run. It is not a new table: that would be a migration, which this plan does not own. chainDetectionSql (03-10) can read it via jsonb_each_text until a table exists"
  - "The closure date is read IN SQL from the stored payload: (payload->>'out_of_business_date')::timestamp at time zone $2, with $2 = APP_TZ. source_records has no closed_at column, so the research SQL's sr.closed_at cannot run as written"
  - "Rows that fail validation (permits and closures) are counted and sampled into stats.rejected_rows / rejected_sample, not thrown. One malformed row does not abort a 35k-row run"
  - "Every run re-geocodes every permit. A cached skip would make census_geocoder `gone` meaningless. `gone` here means a record that matched before and does not match now"
  - "A No_Match, Tie or ChunkFailed writes nothing, so a transient failure never erases a location an earlier run found. A changed permit re-ingest leaves lat/lng undefined, so it keeps the Census location"
requirements-completed: [DATA-01, DATA-03, DATA-04]
metrics:
  duration: ~45min
  started: 2026-09-23T02:00:00Z
  completed: 2026-09-23T02:45:00Z
  tasks: 3
  files: 3
---

# Phase 3 Plan 12: Comptroller desk ingest — permits, Census batch geocode, closures, statewide chain names Summary

**`tsx scripts/ingest-comptroller.ts --org=<clerk_org_id>` writes three of the four `/sources` rows in one desk run: RGV active permits (`jrea-zgmq`, padded county codes), the Census batch geocode, and the closure feed (`3kx8-uryv`, unpadded codes). `closed_at` is set by exact key only and lands on the merge winner. One grouped statewide request makes D-11's "Chain · n in Texas" honest. Measured live, it is a single 548 KB page. The script refuses to start without an explicit org, and every transaction installs both the ETL actor and the org claim.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3, each committed atomically
- **Files:** 3 created, 0 modified

## Accomplishments

- **Argument gate (T-3-01).** `parseIngestArgs` throws `IngestOrgRequiredError` when `--org` is absent, empty or whitespace. The message names `--org` and says the script never defaults to "the only org". The test spies `fetch` to prove the throw happens before any I/O. Unknown flags (`--orgs=`) are refused rather than ignored. The `--target` checks copy `resolveSeedTarget` in shape and message: test refuses Supabase hosts, and prod needs the 5432 session pooler.
- **Per-transaction ETL context.** `etlTransactions(client, clerkOrgId)` is the only way the script opens a transaction. Its first two statements are always `setEtlActor` then `resolveEtlOrg`. That applies to every 500-row batch, every `startRun`, every `finishRun` and the closure update. `grep -c` gives 4 lines for each helper.
- **Pass 1, permits.** The `$where` is built from the SEEDED county codes (`counties.json` `isRgv`) through `quote(paddedCountyCode())`. It is checked for equality against `PERMITS_RGV_WHERE`, with `$order=taxpayer_number,outlet_number` and `$limit=50000`. Each row goes through `permitRowSchema`, `comptrollerRowToSourceRecord`, `nameNorm` and `addressKey(outlet_address, outlet_zip_code)`. `taxpayer_address` never appears. `outlet_city` is folded through the seeded `cities.name_variants` per county. `cluster_key` comes from `clusters.json`'s half-open ranges. Stats cover `unmapped_naics`, `city_unfolded`, `rejected_rows`, `businesses_inserted/updated` and `statewide_names`.
- **Pass 2, Census geocode.** This is its own `census_geocoder` run. `geocodeBatch` is fed the outlet address for each row, keyed by the Comptroller key. Each Match becomes a durable `census_geocoder` source record, and its business gets `lat/lng`, `location_source_id` and `location_match_type` (`census_exact` / `census_non_exact`). An `is distinct from` guard means a re-run writes nothing. Stats: `{matched, exact, non_exact, tie, no_match, submitted, no_address, chunks_failed, chunk_failed_rows, chunk_failure_reasons, locations_written}`.
- **Pass 3, closures.** This is its own `tx_comptroller_closures` run (`3kx8-uryv`). The `$where` uses `RGV_UNPADDED_COUNTY_CODES`, cross-checked against `unpaddedCountyCode()` over the seed and against `CLOSURES_RGV_WHERE`. The external id is `tp_number-loc_number`, the permits key shape. `CLOSURE_UPDATE_SQL` matches only on exact `external_id = comptroller_key`, resolves the target with `coalesce(merged_into_id, id)`, and takes the latest date via `distinct on` when several closures hit one winner. The floating date is read in `APP_TZ` in SQL, and the statement is idempotent. Stats: `businesses_closed` and `closed_via_merge_winner`.
- **Statewide chain names (D-11).** `fetchStatewideNameFrequency()` issues `$select=outlet_name,count(1) as n`, `$where=outlet_county_code between '001' and '254'`, `$group=outlet_name`, `$having=count(1)>=3`, `$order=outlet_name`. The result is a zod-validated `Map` keyed by `nameNorm`, with raw spellings summed.

## Task Commits

1. **Task 1: arg gate + permits pass.** `1ef4362` (feat)
2. **Task 2: Census batch geocode + closure passes.** `b839b33` (feat)
3. **Task 3: statewide name frequency + the unit tests.** `d684d72` (feat)

## Verification

- `npx vitest run tests/unit/ingest-comptroller.test.ts --reporter=verbose` passes 6/6 (test names read, not just the exit code):
  - `ingest-comptroller refuses to start without an org`
  - `ingest-comptroller refuses an unknown flag rather than dropping it` (extra)
  - `permits are queried with padded county codes`
  - `closures are queried with unpadded county codes`
  - `statewide name frequency uses the county sentinel`
  - `release recorded: every emitted source record carries the rowsUpdatedAt ISO version`
- Full unit suite: **29 files, 199 tests, all green**. That includes `CI never reaches the network` (scripts/ is outside its walk, and `statewide-names.ts` names no host), the socrata `naics prefix` gate (which now also scans `statewide-names.ts`) and `no-google-credential`.
- `tsc --noEmit` exits 0, `eslint .` exits 0, `next build` exits 0, and prettier is clean on all three files.

### Mutation checks (each reverted; each revert confirmed byte-identical with `cmp`)

| Mutation | Red, by test name |
|---|---|
| Delete the `IngestOrgRequiredError` throw | `ingest-comptroller refuses to start without an org` |
| Closures query sent with `'031'` in place of `'31'` | `closures are queried with unpadded county codes` (plus `release recorded`, which goes through the same builder) |
| `STATEWIDE_CHAIN_THRESHOLD` 3 → 2 | `statewide name frequency uses the county sentinel` |
| Permit record `sourceVersion` → `'unversioned'` | `release recorded…` → `expected 'unversioned' to be '2026-09-19T08:05:21.000Z'` |
| Permits query sent with `'31'` in place of `'031'` | `permits are queried with padded county codes` (plus `release recorded`) |
| Closure target `coalesce(merged_into_id, id)` → `id` | DB smoke: `ASSERT FAILED: merged-away closure landed on the winner, not the loser` |

### DB smoke (local test DB, one outer transaction, ROLLED BACK)

This was not a live-source run. `node_modules/.cache/03-12/smoke.mts` (gitignored, not committed) drove the three shipped pass functions through `etlTransactions(..., { nested: true })`. It used a dedicated fixture org `org_smoke_0312`, the 40 recorded permit rows, a fake geocoder (2 Exact, 1 Non_Exact, 1 Tie, 1 ChunkFailed, the rest No_Match) and synthetic closure records. **26 assertions passed**, among them:

- A re-run is all `unchanged`, with **zero** new `businesses` events. The geocode re-run writes no location and no event.
- Every `tx_comptroller` record carries the source version.
- Three businesses are located, each citing a **durable** `census_geocoder` record. A *changed* permit re-ingest keeps its Census location.
- The closure on `32006170057-5` closes that business. A suffix neighbour `…-50` matches nothing. A closure on a merged-away business lands on the winner, not the loser. A re-apply writes nothing.
- The floating date is read in Chicago: `1993-03-03` → `06:00Z` (CST) and `2024-07-15` → `05:00Z` (CDT). The SQL epoch equals `closureRowToSourceRecord`'s TypeScript `closedAt` in both zones.
- The statewide map is persisted at `stats.statewide_name_frequency` and does **not** appear in the run's `events.after`.
- Six runs, all `complete`, exactly one `ingest_runs` event each, attributed `etl:ingest-comptroller`.
- After the rollback, **0** smoke orgs remain.

### Deferred to the orchestrator's post-merge gate

- **`$PNPM test:db -t "closure exact match"`** (Task 2's `<verify>`). The test lives in `tests/db/chain-closures.test.ts`, which sibling **03-10 is writing in parallel** and which does not exist in this base. I did not create it. The closure write path follows the D-03 contract that test pins: a `tx_comptroller_closures` source record whose `external_id` equals `businesses.comptroller_key` (`taxpayer_number-outlet_number`, one `comptrollerExternalId` builder for both feeds) sets `closed_at` on that business only, by exact text equality, and resolves through `coalesce(merged_into_id, id)`. **Reconciliation note:** if 03-10's test re-types the research SQL, note that `set closed_at = sr.closed_at` references a `source_records.closed_at` column that **does not exist**. It will need to read `payload->>'out_of_business_date'` as `CLOSURE_UPDATE_SQL` does, or import `applyClosures` / `CLOSURE_UPDATE_SQL` from `scripts/ingest-comptroller.ts`. Both are exported, and the module has no import-time side effects.
- **Full `test:db`.** I did not run it. Siblings 03-10, 03-11 and 03-13 share the local test DB, and `seedTwoOrgs` inserts fixed `clerk_org_id`s (`org_A`/`org_B`), so concurrent runs contend on that unique index. This plan adds no DB test and changes no module a DB test imports.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The research/plan closure SQL references a column that does not exist.** Found during Task 2.
- **Issue:** `set closed_at = sr.closed_at` and `b.closed_at is distinct from sr.closed_at` read `source_records.closed_at`, but `source_records` has no such column.
- **Fix:** read the closure date from the stored payload as `(sr.payload->>'out_of_business_date')::timestamp at time zone $2` with `$2 = APP_TZ`. That is the same Chicago wall-time reading `closureRowToSourceRecord` makes, and the smoke shows the two agree in CST and CDT. The statement also resolves the merge winner, as the plan's prose requires, and uses `distinct on` so several closures on one winner give a deterministic result.
- **Files:** `scripts/ingest-comptroller.ts`. **Commit:** `b839b33`.

**2. [Rule 2 - Missing critical] Malformed rows are counted rather than thrown.** Found during Task 1.
- The plan says `permitRowSchema.parse` per row. With `parse`, one malformed row would abort a 35k-row run.
- **Fix:** `safeParse`. Rejects are counted and sampled (≤10, key and issue only) into `stats.rejected_rows` / `rejected_sample`. The same applies to closures. Zod still validates every row before it reaches the driver (T-3-03).
- **Commit:** `1ef4362` / `b839b33`.

**3. [Rule 2 - Missing critical] Unknown CLI flags are refused.** Found during Task 1. Without this, a typo such as `--orgs=` would be silently dropped. **Commit:** `1ef4362`.

### Decisions within plan latitude

- **Where the statewide map is stored.** The plan says "the ingest stores the result", and 03-RESEARCH says to "seed a statewide name-frequency table". No such table exists, and creating one is a migration. That is out of scope here (03-11 owns 0024; a new table is Rule 4). So the map lives on the `tx_comptroller` run as `stats.statewide_name_frequency` (~11.6k entries). It is written after `finishRun` so it stays out of the event trail. The report keeps a summary, `stats.statewide_names = {names, outlets, threshold}`. **Follow-ups:**
  - 03-10's `chainDetectionSql` expects an optional *table name*, so it needs a jsonb source, or a table in a later migration.
  - 03-15/03-17 should select specific `stats` keys, not the whole blob.
- **The statewide fallback was not taken.** I measured the request live: three read-only GETs to the public API, no script run, no budget. It is valid SoQL, returns 11,647 groups covering 82,305 outlets in one 548 KB page in 1.8 s, and `$offset=20000` returns `[]`. `FLAG_CHAIN` keeps "in Texas". One known under-count is written into the module header: `$having` filters raw spellings *before* the `nameNorm` fold.
- **`--limit`** slices the fetched rows of each feed. The one-request fetch itself is unchanged.
- **Geocoder `source_version`** is `Public_AR_Current`, the benchmark `geocodeBatch` queries.
- **`chunks_failed`** counts distinct 1,000-row chunks (computed from submission position). `chunk_failed_rows` and `chunk_failure_reasons` sit alongside it.

## Known Stubs

None.

## Threat Flags

None. The script adds no endpoint. Its two network hosts remain the module constants in `client.ts` and `census-batch.ts` (T-3-05). Every SoQL value is a literal or built from seeded codes through `quote()` (T-3-04). Every SQL value is a bound parameter.

## Risks for 03-20 (the live desk run)

- **Wall clock against production.** The shared write path is per-row: roughly 3–4 round trips per permit, 2 per geocode match and 1 per closure, sequential on one connection. At ~40 ms RTT to the session pooler, that is on the order of **1.5–2 hours** for the full run, with the Census batch another ~6–8 min. It is correct, but budget for it, or consider running the passes on parallel connections later.
- The `tx_comptroller` run row will carry a ~400 KB `stats`. See the follow-up above.

## Self-Check: PASSED

- `scripts/ingest-comptroller.ts`, `src/lib/socrata/statewide-names.ts` and `tests/unit/ingest-comptroller.test.ts` are all present.
- Commits `1ef4362`, `b839b33` and `d684d72` are all present in `git log`.
