# Phase 3 gate mutations M13–M25, as run

Plan 03-22 Task 1, 2026-09-23. Branch `gsd/phase-03-free-data-spine-entity-resolution`, HEAD
`f8cce1a` throughout (printed after every run). No other agent was running.

**Method.** One mutation at a time, never two. Source mutations were applied to the committed
file by an exact-one-match replacer (it refuses if the anchor matches 0 or 2+ times, and it
normalizes the anchor to the file's line endings; most of `src/` is CRLF). DB mutations were
applied to the **live local database** (`siteless_test`, which holds danlo's 91,872-row spine),
never to a migration file. After each mutation the **whole** relevant suite ran with
`--reporter=verbose`, and both the failing names and the PASS list were read. A source mutation
runs both suites. A catalog mutation runs the DB suite only, because nothing under `tests/unit`
opens a database connection (grep for `TEST_DATABASE_URL|withRollback|new Client|postgres(`
under `tests/unit` returns nothing).

**Baseline before any mutation:** unit **291/291**, db **193/193**, once a pre-existing flake had
been fixed (see "Found on the way in" below).

**Capture before any mutation** (the revert evidence is a comparison against this):
`pg_indexes` + `pg_constraint` (with `pg_get_constraintdef`, `convalidated`, `condeferrable`)
for `businesses`; `information_schema.role_table_grants` and `column_privileges` for
`ingest_runs`; `md5(pg_get_functiondef)` for every function in schema `app`
(`record_merge` = `c91f499c10624ffd53aa40d654e9c1f0`, 5768 chars; `undo_merge` =
`81cbfbff8b22b0ddcaefb034ae893c50`, 4587 chars); and the `businesses_location_src_fk`
constraint **comment** (a `drop constraint` silently deletes it). After the last revert the
same query over the same objects was **byte-identical** to the capture (`diff` empty), the
comment was identical, `count(*) from businesses` was still 91,872, `git diff --stat` was
empty, and `$PNPM test:unit` was 291/291 and `$PNPM test:db` 193/193.

## The log

Columns: **#** · **what was changed** · **where** · **test NAME that went red** · **stayed green
(the named controls)** · **revert evidence**. "Plan" means 03-VALIDATION's *must red, exactly*
column.

| # | What was changed | Where | Went red, by NAME | Stayed green (named) | Revert evidence |
|---|---|---|---|---|---|
| **M13** | The R1 clause `if (distanceM !== null && distanceM > 25_000) { return … 'distinct' }` deleted | `src/lib/resolve/score.ts:345-351` | unit 2 failed / 289: `score() structural rules > never merges across 25 km`; `merge-pairs fixture > merge-pairs fixture P06` (`expected {score:50, band:'ignore'} to deeply equal {score:0, band:'distinct'}`). db 193/193 | `merge-pairs fixture P01–P05, P07–P10`, all nine | `git checkout --`; `git diff --stat` empty; the literal `distanceM > 25_000` is back (grep count 1) |
| **M14** | The R5 line `if (signals < 2) s = Math.min(s, 94);` deleted | `score.ts:378` | unit 1 failed / 290: `score() structural rules > one signal cannot reach 95`, **at line 176, the re-tuned half** (`expected 100 to be 94`, weights `nameMax: 70`). db 193/193 | The committed-weights half of the same test (P08 = 75) and all ten fixture pairs | `git checkout --`; diff empty; the line is back (grep count 1) |
| **M15** | The R6 line `if (!geoGate(a, b, distanceM)) s = Math.min(s, 94);` deleted | `score.ts:381` | unit 2 failed / 289: `score() structural rules > no geo gate caps at 94`; `merge-pairs fixture > merge-pairs fixture P09` (`expected {score:95, band:'merge'} to … {score:94, band:'review'}`). db 193/193 | The other nine fixture pairs; `a Census Non_Exact location never satisfies the geo gate` (it calls `geoGate()` directly) | `git checkout --`; diff empty |
| **M16** | `TOLL_FREE_NPAS` emptied (`new Set<string>([])`), so `phoneE164()` treats every NPA as blockable. This is the variant the test file's header names | `src/lib/normalize/phone.ts:26` | unit 3 failed / 288: `phoneE164 > phoneE164 toll-free parses but is not blockable` (line 151); `toll-free is not an identifier` (line 180); **and** `DATA-02: overtureRowToSourceRecord > duckdb list shape: the four measured phone forms and the toll-free switchboard` (`overture-transform.test.ts:203`, `expected true to be false` on `derived.phoneBlockable`). db 193/193 | `phoneE164 parses a formatted local number and it is blockable` and the rest of `normalize.test.ts` | `git checkout --`; diff empty; the seven-NPA literal is back |
| **M17** | `drop index public.businesses_external_key_uniq` | live local DB | db **40 failed** / 153. `the external key (D-19) > external key is unique per org` (`promise resolved … instead of rejecting`), **plus 39 tests failing with `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`**. Those are every test that inserts a business through the shipped path `on conflict (org_id, external_key) do nothing`: all 16 in `merge-unmerge`, 5 in `ingest-idempotency`, 3 in `provenance-render`, 2 insert-retry tests in `external-key`, 3 in `chain-closures`, 7 in `review-actions`, plus `texas-side`, `alias-consistency` and `geocode-rerun` | `external key shape refuses the ambiguous glyphs`, `external key shape refuses lowercase`, `positive control: a well-formed Crockford key inserts`, `external key is not a FK` | Recreated verbatim. `pg_indexes` reads `CREATE UNIQUE INDEX businesses_external_key_uniq ON public.businesses USING btree (org_id, external_key)`, identical to the capture, with `indisvalid = true` over 91,872 rows |
| **M18** | `alter table public.businesses drop constraint businesses_location_src_fk` | live local DB | db 1 failed / 192: `Places retention is a database constraint > location cites durable: an ephemeral google_places source is refused` (`promise resolved "Result{ command: 'INSERT' …}" instead of rejecting`) | `positive control: location cites durable source and is accepted`; `address cites durable: …refused` + its control; `closed_at cites durable: …refused` + its control; `durable cites durable: a durable field citing an ephemeral source is refused` | Re-added as `foreign key (location_source_id, location_src_ret) references public.source_records (id, retention_class)`, **and its T-3-06 comment re-applied**. `pg_constraint`: six `businesses_%_src_fk`, all `convalidated = true` (every row re-validated). `pg_get_constraintdef` and `obj_description` are identical to the capture |
| **M19** | `alter table public.businesses drop constraint businesses_closed_at_src_fk` | live local DB | db 1 failed / 192: `closed_at cites durable: an ephemeral google_places source is refused` | `positive control: closed_at cites durable source and is accepted`; both location tests; both address tests; `durable cites durable` | Re-added verbatim (this one has no comment). Six `_src_fk` rows, validated; the def is identical to the capture |
| **M20** (as written) | `payload_hash` added to the `source_records` upsert's conflict target: `on conflict (org_id, source_key, external_id, payload_hash) where external_id is not null` | `src/lib/ingest/upsert.ts:121` | db **39 failed** / 154, **all `42P10`**: Postgres rejects the statement outright because no unique index matches that target. So every test that seeds through the shipped upsert fails, which is the same 39 as M17's `42P10` set. That includes all five DATA-04 tests: `re-run is idempotent`, **`payload hash diff`**, `gone is not a delete`, `one run-level event`, `two zones`. unit 291/291 | Nothing that ingests. It is not a discriminating mutation (see finding F3) | `git checkout --`; diff empty |
| **M20b** (03-09's behavioural form) | The business-write gate `if (existing !== null && !opts.changed) return {wrote:false…}` deleted | `upsert.ts:317-319` | db 2 failed / 191: `DATA-04: the ingest write path > re-run is idempotent` (`expected 24 to be 12`); `payload hash diff` (`expected 24 to be 13`) | `gone is not a delete`, `one run-level event`, `two zones`, and the 4 ETL-tier tests in the same file | `git checkout --`; diff empty |
| **M21** | Step 4 of `app.undo_merge` removed (the `update merge_candidates set decision = 'distinct' …`) via `create or replace` built from 0024's own statement | live local DB (`drizzle/0024_merge_functions.sql:380` is the source) | db **3 failed** / 190: `merge and unmerge (DEDUP-02) > never auto-re-merges` (`expected {decision:'merged'} to … {decision:'distinct'}`); `the resolve pass > an unmerged pair is never re-proposed` (`expected 'merged' to be 'distinct'`); `review actions, as a Clerk user > unmerge restores through the definer and a second unmerge is a conflict` | `merge and unmerge (DEDUP-02) > unmerge restores` (the plan's named control) | Restored from 0024's statement **with CR stripped** (see finding F5). `md5(pg_get_functiondef('app.undo_merge'))` = `81cbfbff8b22b0ddcaefb034ae893c50`, 4587 chars, equal to the capture |
| **M22** | `grant update on public.ingest_runs to authenticated` | live local DB | db 1 failed / 192: `grants audit > the four select-only spine tables hold no write privilege` (`grants-audit.test.ts:381`) | The other 9 `grants audit` tests, including `authenticated holds exactly the DML each Phase 2 table needs` and `authenticated keeps the DML the policies rely on` | `revoke update …`. `role_table_grants` for `authenticated` on `ingest_runs` returns `SELECT` and nothing else; `column_privileges` returns no non-SELECT row |
| **M22b** (Phase 2's M12b shape) | `grant update (status) on public.ingest_runs to authenticated`, a **column-level** grant | live local DB | db 1 failed / 192: the same `the four select-only spine tables hold no write privilege` | the same 9 | `revoke update (status) …`. Table-level: `SELECT` only; column-level: no non-SELECT row |
| **M23** | `r.addr_country !== 'US' \|\| r.addr_region !== 'TX'` became `r.addr_region !== 'TX'` | `src/lib/overture/transform.ts:153` | unit 1 failed / 290: `DATA-02: overtureRowToSourceRecord > texas side filter` (`Reynosa e9644774…: expected {sourceKey:'overture'…} to … {skipped:'not_texas'}`). db 1 failed / 192: `criterion 5: the Texas side > a naive-RGV-bbox radius search returns no Mexican-side row` (first fails on the skipped-count guard, `expected 10 to be 11`, as 03-09 recorded) | The other `overtureRowToSourceRecord` tests (`duckdb list shape`, `geometry not bbox`, `release recorded` …) | `git checkout --`; diff empty; the two-halved condition is back |
| **M24** | `and o.name_norm % c.name_norm` became `and unaccent(o.name_norm) % c.name_norm` | `src/lib/resolve/block.ts:251` | unit 1 failed / 290: `the normalizer is the only normalizer > SQL never normalizes` (`src/lib/resolve/block.ts:251 and unaccent(o.name_norm) % c.name_norm`). **db 1 failed / 192: `candidate blocking > the lateral blocker uses the trigram index`**: the EXPLAIN loses `businesses_name_trgm` and falls back to a bitmap scan on `businesses_org_idx` plus a sort | Every other `blocking.test.ts` test | `git checkout --`; diff empty |
| **M25a** (script re-point) | In `mergeCandidate`, `(select coalesce(merged_into_id, id) from businesses where id = mc.left_id …) as left_root` (and `right_root`) became `select id` | `scripts/resolve.ts:583-586` | db 1 failed / 192 on the full-suite run: `the resolve pass > a chain-flagged pair is never auto-merged` (`expected … to match object {decision:'pending', score:95}`). Re-running `resolve-pass.test.ts` 6 more times under the same mutation: the chain test failed **6/6**; `the pass is deterministic` failed **2/6** (see F7). unit 291/291 | `merge and unmerge (DEDUP-02) > three-way cluster`; `the resolve pass > a three-way cluster merges to one winner through the pass`; `every parent survives` | `git checkout --`; diff empty |
| **M25b** (definer re-point, **matches the plan's M25**) | In `app.record_merge`, `select coalesce(merged_into_id, id) into v_winner` / `into v_loser` became `select id into …` (the pair check's own re-point left intact, as 03-11 did) via `create or replace` | live local DB (`0024:183`, `:189`) | db 2 failed / 191: `merge and unmerge (DEDUP-02) > three-way cluster`; `the resolve pass > a three-way cluster merges to one winner through the pass`. Both raise `record_merge: candidate does not name this pair` (22023) | `merge and unmerge (DEDUP-02) > every parent survives` (the plan's named control) | Restored from 0024's statement with CR stripped. `md5(pg_get_functiondef('app.record_merge'))` = `c91f499c10624ffd53aa40d654e9c1f0`, 5768 chars, equal to the capture |

## Against the plan's "must red — exactly"

| # | Plan | As run | Verdict |
|---|---|---|---|
| M13 | `never merges across 25 km` only; the other nine pairs green | that test + P06, which **is** the 25 km pair; the other nine green | **matches** (P06 is R1's own fixture row, not one of "the other nine") |
| M14 | `one signal cannot reach 95` only | exactly that, but only through the re-tuned weight table | **matches, with F1** |
| M15 | `no geo gate caps at 94` only | that + P09, R6's own fixture row | **matches**, same shape as M13 |
| M16 | the two, independent | the two + the transform's `duckdb list shape … toll-free switchboard` | **over-red by one, benign** (F2) |
| M17 | `external key is unique per org` only; shape CHECK green | that + 39 `42P10`; shape CHECK green | **over-red, structural** (F3) |
| M18 | `location cites durable` only | exactly that | **matches** |
| M19 | `closed_at cites durable` only | exactly that | **matches** |
| M20 | `re-run is idempotent` + `gone is not a delete`; `payload hash diff` green | 39 `42P10`, `payload hash diff` included. The discriminating form M20b reds `re-run is idempotent` + `payload hash diff`; `gone is not a delete` stays green | **the prediction is wrong in both directions** (F3, F4) |
| M21 | `never auto-re-merges` only; `unmerge restores` green | that + the same property at two more layers; `unmerge restores` green | **over-red, benign** (F6) |
| M22 | the grants matrix only | exactly `the four select-only spine tables hold no write privilege`, also under the column-level form | **matches**, and the M12b hole is closed for these tables |
| M23 | `texas side filter` + `no Mexican-side result` | exactly those two (the second's real name is `a naive-RGV-bbox radius search returns no Mexican-side row`) | **matches** |
| M24 | `SQL never normalizes` only | that + `the lateral blocker uses the trigram index` | **over-red, and informative** (F8) |
| M25 | `three-way cluster` only; `every parent survives` green | definer form: `three-way cluster` + its resolve-pass twin; `every parent survives` green. Script form: never reds `three-way cluster` | **M25b matches, over-red by its composition twin** (F6, F7) |

**No mutation reds nothing.** Every guard M13–M25 names has at least one test that dies by name
when the guard is removed. Nothing here is a Phase 2 M12b.

## Findings

**F1 — R5 is arithmetically redundant under the committed weights (M14).** With the weights as
committed, the largest one-signal sum is 94 (03-02 measured this), so R5 never binds on a real
pair. The test pins R5 where it *would* bind, under `nameMax: 70`, and that half is what died. The
guard is kept on purpose: it is what stops a future re-tune from letting one signal auto-merge.

**F2 — M16's third red is a downstream pin, not a second guard.** `overture-transform.test.ts`
asserts that the transform carries `phoneE164`'s verdict into `derived.phoneBlockable`. It shares
no refusal with the two normalizer tests. It consumes the same function one layer up, so it
correctly dies with it. The two normalizer tests are independent assertions (line 151 and line
180) over one guard, the set.

**F3 — M17 and M20-as-written are not discriminating mutations, and the cause is structural.**
Both remove the unique index an `ON CONFLICT` target needs, so Postgres refuses the shipped
upserts with `42P10` before any invariant is reached, and every fixture that seeds through the
real write path fails. That is a property of `insert … on conflict`, not two guards sharing a
refusal. Each mutation still reds its named test **by the right cause**: M17's
`external key is unique per org` is the one test that fails on uniqueness rather than `42P10`.
M20 as written can never be the right mutation, because a conflict target naming a column with no
matching unique index cannot even run. M20b, which deletes the gate, is the discriminating form.

**F4 — `gone is not a delete` is not M20's test.** No form of M20 kills it (M20b leaves it
green; M20-as-written kills everything). It guards an **absence**: nothing in the ingest path
deletes a `source_records` or `businesses` row, and the test fails the moment something does.
A mutation that kills it would have to *add* a delete. The plan's pairing of it with
`re-run is idempotent` was a mis-prediction. `payload hash diff` is M20b's second test, because it
pins "exactly the one changed row wrote an event".

**F5 — Restoring a function "from the migration file" byte-for-byte is not a restore on this
machine.** `drizzle/0024_merge_functions.sql` is CRLF in the working tree (git `autocrlf`), and the
catalog was built from LF text. The first restore of `app.undo_merge` from the file's bytes gave
`md5 facc5537…`, 4692 chars, carrying **105 CRs**: functionally identical but not the same
object. Stripping CR gave `81cbfbff…`, 4587 chars, equal to the capture. Only the md5 comparison
caught it; the suite would have stayed green. The same LF restore was used for `record_merge`.

**F6 — Three over-reds are the same property pinned at more than one layer, written after
03-VALIDATION's predictions.** M21 kills `never auto-re-merges` (definer), `an unmerged pair is
never re-proposed` (resolve pass, 03-14) and `unmerge restores through the definer and a second
unmerge is a conflict` (server action, 03-15). M25b kills `three-way cluster` (definer) and
`a three-way cluster merges to one winner through the pass` (03-14). Every red names the same
`decision='distinct'` row, or the same `22023`. None of them is a second guard sharing a refusal
with the first, so no split is warranted. The plan's controls (`unmerge restores`,
`every parent survives`) stayed green by name.

**F7 — The script's re-point (M25a) is covered deterministically only by the chain test. Its
distinct-across-clusters consequence is caught by chance.** The resolve pass's distinct check
builds its member set from `left_root`/`right_root`. With the re-point removed, the check misses
a `distinct` decision that spans the cluster **only when** the second edge's raw side is the
loser rather than the root. That depends on the random uuid order of `seedTriple`. Measured:
`the pass is deterministic` failed 2 of 6 runs under M25a, and green 5 of 7 overall, counting the
full-suite run. 03-14 recorded it as a red, which it is only sometimes. `a chain-flagged pair is
never auto-merged` does kill M25a 6/6, so the re-point is not dead code. But the
distinct-spanning-cluster behaviour lacks a deterministic test. **Recommended (not done here,
because this plan measures and does not change tests):** a resolve-pass test that orders the
triple's ids so the second edge's raw left side is always the loser, then asserts
`skipped_distinct: 1`. Recorded for 03-22 Task 3's deferred items.

**F8 — M24's second red is a second, independent guard, not a shared refusal.**
`SQL never normalizes` is a text gate (grep). `the lateral blocker uses the trigram index` is a
planner gate (EXPLAIN): wrapping the indexed column in a function makes the GIN index unusable.
Both die for different reasons, and each would survive the other's absence. 03-10 recorded M24 as
"only `SQL never normalizes`" because it ran the unit suite alone. Against the DB suite, the
performance guard dies too, as it should.

## Found on the way in

**Baseline flake, fixed before any mutation (commit `f8cce1a`).** The first `$PNPM test:db` was
192/193: `review decision core, as a Clerk user > a recorded merge names the true winner and
loser for the toast` failed (`loserName: "Riverside Stone"`), then passed on an immediate re-run.
The cause: `seedComptrollerSide` back-dates the Comptroller business by one day, and the test
back-dated the Overture side to `now() - 1 day`. That is the **same instant** inside one
transaction, so the winner rule (older `created_at`, then smaller id) fell through to a random
uuid, a ~50% flake. It was fixed by back-dating two days. It then went 6/6 green in isolation and
green in every full run since. Left unfixed, it would have reported a random extra red under
every DB mutation.
