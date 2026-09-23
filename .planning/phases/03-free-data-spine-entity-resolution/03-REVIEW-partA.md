---
phase: 03-free-data-spine-entity-resolution
slice: A (database / SQL / ingest / resolve / server-action core)
reviewed: 2026-09-23T10:45:01Z
head: 93bf4cd (gsd/phase-03-free-data-spine-entity-resolution)
depth: standard
files_reviewed: 33
files_reviewed_list:
  - drizzle/0021_extensions.sql
  - drizzle/0022_spine_tables.sql
  - drizzle/0023_spine_constraints_grants.sql
  - drizzle/0024_merge_functions.sql
  - scripts/ingest-comptroller.ts
  - scripts/ingest-overture.ts
  - scripts/refresh-outlet-counts.ts
  - scripts/resolve.ts
  - scripts/seed.ts
  - src/db/drizzle-executor.ts
  - src/db/schema/business-aliases.ts
  - src/db/schema/business-merges.ts
  - src/db/schema/businesses.ts
  - src/db/schema/index.ts
  - src/db/schema/ingest-runs.ts
  - src/db/schema/merge-candidates.ts
  - src/db/schema/overture-categories.ts
  - src/db/schema/source-records.ts
  - src/lib/ingest/etl-actor.ts
  - src/lib/ingest/run-report.ts
  - src/lib/ingest/upsert.ts
  - src/lib/resolve/block.ts
  - src/lib/resolve/chain.ts
  - src/lib/resolve/merge.ts
  - src/lib/resolve/score.ts
  - src/lib/resolve/survivorship.ts
  - src/server/actions/_merge-decisions.ts
  - src/server/actions/record-review-decision.ts
  - src/server/actions/unmerge-business.ts
  - src/server/queries/budget.ts
  - src/server/queries/businesses.ts
  - src/server/queries/review-queue.ts
  - src/server/queries/sources.ts
findings:
  critical: 3
  warning: 10
  info: 7
  total: 20
status: issues_found
---

# Phase 3: Code Review Report, Slice A (DB / SQL / ingest / resolve / actions)

**Reviewed:** 2026-09-23T10:45:01Z
**Depth:** standard, plus call-chain tracing where a finding depended on a caller (merge.ts to 0024, upsert.ts to both ingests, the actions to the definers)
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The tenancy plumbing mostly holds up. Every owner-tier statement I traced carries the org predicate, with one exception (A-WR-08). Every `select … into` in the three definers is followed by a not-found guard. The drizzle executor binds arrays as one literal and refuses a `Date`. The payload contract between the Overture ingest and `sourceRecordView` also holds: `lon` → `lng`, and the phone is the first entry that normalizes.

The real problems are in the merge lifecycle. Survivorship, the ingests and unmerge each write the same business columns, but each follows its own rules:

- **A-CR-01, suspected race #1: confirmed.** Worse than suspected: a reviewer can overwrite a "Different" decision with no precise timing needed. Only the action's pending read has to happen before the other commit.
- **A-CR-02:** a normal re-ingest reverts D-14 survivorship on every merge winner whose source changed. Provenance then points at a record whose payload says something else.
- **A-CR-03:** survivorship never carries `cluster_key` across a merge, because the view never populates it. A merged business can drop out of the lead funnel (D-02).

Suspected issues from the brief, confirmed or refuted:

| # | Suspicion | Verdict |
|---|---|---|
| 1 | Reviewer race turns Different into a merge | **Confirmed.** A-CR-01 |
| 2 | Definer hygiene | Org checks, FOUND guards, grants and absence of dynamic SQL: **fine**. `search_path` omits `pg_temp`: A-WR-02. The composite FK is tenancy-blind, and `authenticated` can write `businesses` directly: A-WR-01 |
| 3 | Owner-tier org predicate | **Fine**, except `finishRun`: A-WR-08 |
| 4 | Array / Date / timestamptz binding | **Fine** everywhere in scope. Arrays go through `jsonb_to_recordset` or a single literal, every instant goes through epoch text, and no `Date` is bound |
| 5 | businesses.ts | Nothing is concatenated from user input. The search string is bound and like-escaped, and limit/offset are clamped and bound. The `as materialized` CTE is correct. `source_records.business_id` is unindexed: **confirmed**, A-IN-02. Unqualified `unaccent`: A-IN-01. The list's source column is wrong for merged winners: A-WR-09 |
| 6 | Payload contract, per-merge scan | Contract **fine**. The per-merge scan is real but is performance only: A-IN-02 |
| 7 | Idempotency | The payload-hash gate is correct as a gate but blocks re-derivation (A-WR-06). The Census guard only covers unchanged rows (A-CR-02, A-WR-07). Closure duplicate folding is **fine**, but `closed_at` has two writers with different tie rules: A-WR-04 |

## Critical Issues

### A-CR-01: A reviewer's "Same business" silently overwrites a "Different" (suspected race #1, confirmed)

**File:** `drizzle/0024_merge_functions.sql:195-205`, `drizzle/0024_merge_functions.sql:272-274`, `src/server/actions/_merge-decisions.ts:80-94`

**Issue:** Three facts combine:
1. `decideCandidate` checks `decision = 'pending'` with a plain SELECT under RLS. It cannot lock the row: `authenticated` has SELECT only on `merge_candidates`, and `FOR UPDATE` needs UPDATE privilege.
2. `app.record_merge` reads the candidate with no lock. It refuses a `distinct` pair only when `p_reason = 'auto'` (line 203), so a `review` merge of a distinct pair passes.
3. The closing `update merge_candidates set decision = 'merged'` (line 272) has no `decision = 'pending'` predicate and no FOUND check.

Scenario, on two phones or a double-submit:
- Reviewer B's action reads the pair as pending.
- Reviewer A's "Different" commits `distinct`.
- B's `record_merge` then reads `distinct`, lets it through because the reason is `review`, merges the two businesses, and overwrites the candidate to `merged`.

A's decision is lost without a trace. Nothing in `business_merges` or `events` records that a distinct ruling was overridden. The reverse order is safe: `record_candidate_decision` filters on `decision = 'pending'`, so under READ COMMITTED its re-check sees `merged` and it raises 55000.

**Fix:** make the definer the lock-holder and refuse any non-pending pair for both reasons. Re-merging a pair that was ruled distinct should become an explicit, audited re-open.
```sql
select id, decision, left_id, right_id into v_candidate, v_decision, v_left, v_right
  from merge_candidates where id = p_candidate_id and org_id = v_org
  for update;                                   -- serialises against record_candidate_decision
if v_candidate is null then raise exception 'record_merge: candidate not in this org' using errcode = '42501'; end if;
if v_decision = 'distinct' then
  raise exception 'record_merge: pair was marked distinct' using errcode = '55000';  -- both reasons
end if;
if v_decision = 'merged' then
  raise exception 'record_merge: candidate already decided' using errcode = '55000';
end if;
...
update merge_candidates set decision = 'merged', decided_by = v_actor, decided_at = now()
 where id = v_candidate and org_id = v_org and decision = 'pending';
if not found then raise exception 'record_merge: candidate already decided' using errcode = '55000'; end if;
```
Two follow-ups:
- `undo_merge` updates `merge_candidates` after it locks `businesses`, while the fixed `record_merge` locks the candidate first. Lock the candidate row(s) first in `undo_merge` as well, or add 40P01 to the retry lists, to avoid lock-order deadlocks.
- If deliberately re-merging an unmerged pair is wanted, add `record_candidate_decision(p, 'reopen')` (distinct → pending, attributed). Don't leave the loophole in `record_merge`.

The existing test 'never auto-re-merges' (`tests/db/merge-unmerge.test.ts:170`) stays valid. Add one named test for reviewer-after-distinct.

### A-CR-02: A changed source record overwrites merged businesses with single-source values, reverting D-14 survivorship

**File:** `src/lib/ingest/upsert.ts:307-333`, `scripts/ingest-comptroller.ts:592-595`, `scripts/ingest-comptroller.ts:756-765` (`WRITE_LOCATION`), `scripts/ingest-overture.ts:388-393`

**Issue:** `upsertBusinessFromSource` resolves the target business as `source_records.business_id`, the business that record originally created. When the payload hash moved, it writes that one record's derived columns directly onto that business. The code never asks whether the business is a merge winner or has been merged away:

- **The creator is the winner.** Example: a Comptroller business that absorbed an Overture record. Any change in the permit payload rewrites `display_name` and `display_name_source_id` (always cited, `upsert.ts:268`) back to the Comptroller `outlet_name`. It also rewrites `legal_name`, `street`/`street_num`/`street_norm`/`unit`/`postal`/`city` with `address_source_id`, and `cluster_key`. All of these replace the Overture values survivorship chose. D-14 says the Comptroller name is used "ONLY when no Overture parent exists". `WRITE_LOCATION` does the same to location: when a Census record changes (its reference data moves coordinates between benchmarks), it overwrites the winner's Overture lat/lng. The header comment at `ingest-comptroller.ts:642-647` fixed only the *unchanged* half of that bug.
- **The creator is a merged-away loser.** Example: the Overture record of a Comptroller-won merge. The update lands on the dead loser row, and the winner keeps the old phone and name. Its `phone_source_id`/`display_name_source_id` still cite that record, whose payload now says something different. The detail page's inline source tag (D-18) then asserts a provenance that is false.

This happens on an ordinary monthly re-run, with no concurrency involved. The winner's next `winner_fields_before` snapshot captures the corrupted state, so unmerge "restores" it too.

**Fix:** re-derive through the one survivorship function whenever the record's business belongs to a cluster, and write the root:
```ts
// upsert.ts, after the gate: find the cluster
const { rows: [b] } = await tx.query<{ root: string; clustered: boolean }>(
  `select coalesce(b.merged_into_id, b.id) as root,
          (b.merged_into_id is not null
           or exists (select 1 from businesses m where m.org_id = $2 and m.merged_into_id = b.id)) as clustered
     from businesses b where b.id = $1 and b.org_id = $2`, [existing, opts.orgId]);
if (b.clustered) {
  // readParents over every member of root, survivorshipJson(survive(parents)),
  // written to the root through app.apply_survivorship (owner may call it) —
  // and the loser row left alone.
}
```
Route the census path (`WRITE_LOCATION`) through the same function. Add named tests: "changed Comptroller payload on a merge winner keeps the Overture display_name", and "changed Overture payload of a loser updates the winner".

### A-CR-03: `cluster_key` is never derived by survivorship, so a merge drops the Overture-mapped cluster

**File:** `src/lib/resolve/merge.ts:116-189`, `src/lib/resolve/survivorship.ts:181-196`, `src/lib/resolve/merge.ts:261-262`

**Issue:** `survive()` derives `clusterKey` from `SourceRecordView.clusterKey` ("Overture first, then any parent"). `sourceRecordView` never sets it:
- `emptyView` sets it to null, and none of the four cases assigns it.
- The Overture payload has no cluster (the ingest looks it up in `overture_category_map` and writes it only to `businesses`).
- The Comptroller case does not map `outlet_naics_code`.

So `derived.clusterKey` is always undefined, `survivorshipJson` omits `cluster_key`, and the winner keeps whatever cluster it had. The survivorship header documents a rule that never runs.

Scenario: a Comptroller permit whose NAICS falls outside every seeded range (`cluster_key NULL`) merges with its Overture twin, whose `basic_category` maps to `food_hospitality`. The Comptroller row wins on the older `created_at`. The merged business ends with `basic_category = 'restaurant'` and `cluster_key = NULL`. Under D-02 it never enters the lead funnel, and `/businesses?cluster=food_hospitality` stops listing it. The reverse also happens: an Overture winner with an unmapped category loses the Comptroller NAICS cluster.

**Fix:** carry the cluster into the view. The cheapest way is to resolve it in `readParents`: left join `overture_category_map` on `payload->>'basic_category'` (org row first, then the built-in), and apply the NAICS ranges for `tx_comptroller`. Alternatively, store the resolved `cluster_key` inside the source payload at ingest (a hash change, one-time). Then pin a unit test: survive() over {Comptroller unmapped, Overture mapped} yields the Overture cluster.

## Warnings

### A-WR-01: `authenticated` still holds INSERT/UPDATE/DELETE on `businesses` and `source_records`, which bypasses the definers and their tenancy check

**File:** `drizzle/0008_revoke_platform_grants.sql:46` (inherited), `drizzle/0024_merge_functions.sql:64-68`, `drizzle/0023_spine_constraints_grants.sql:98-117`

**Issue:** 0023 makes the four new spine tables SELECT-only, and 0024's header says merges happen "only" through the definers. But the merge state lives on `businesses` (`merged_into_id`, `status`, `external_key`, the six `*_source_id`), and `authenticated` still has full DML there from 0008's blanket grant. The same holds for `source_records`. An org session that reaches the grant layer can:
- set `merged_into_id` or `status` with no `business_merges` row and no attributed actor, which defeats T-3-08;
- point `location_source_id` at **another tenant's** durable source record. The composite FK checks `(id, retention_class)`, not org, and bypasses RLS. 0024:64-68 names exactly this hole but closes it only inside `apply_survivorship`.

0008's own premise is that a browser session reaches the grant layer (Supabase third-party auth plus the Data API). No app-tier code writes either table: I found no `update|insert|delete` on them under `src/server`, and the only writers are the owner-tier ingest and resolve scripts.

**Fix:** new custom migration:
```sql
revoke insert, update, delete on businesses, source_records from authenticated;
```
Update `tests/db/grants-audit.test.ts` to match. Add a 42501 test for `update businesses set merged_into_id = …` as a Clerk user.

### A-WR-02: The definers' `set search_path = public` leaves `pg_temp` searched first for relations

**File:** `drizzle/0024_merge_functions.sql:44,71,154,291,404` (same pattern in every earlier definer)

**Issue:** When `pg_temp` is not listed, PostgreSQL searches it **before** `public` for tables. A session that can create a temp table named `businesses` or `merge_candidates` and then call `app.record_merge` makes the definer read and write the temp table as the owner. This is the documented definer pitfall (CVE-2007-2138). Exploitation needs arbitrary SQL as `authenticated`, which the app does not hand out today, so this is hygiene rather than a live hole. It matters most in the one migration whose definers write merge state.

**Fix:** `set search_path = public, pg_temp` on the three definers and two helpers, and ideally on every earlier definer too, in one sweep.

### A-WR-03: Stale candidates stay in the review queue: sides already merged, and ≥95 `skipped_distinct` pairs

**File:** `scripts/resolve.ts:615-636`, `src/server/queries/review-queue.ts:156-163`

**Issue:**
1. The resolve pass handles "both sides are now one root" only for the ≥95 queue. A pending 80–94 pair whose two sides were merged via other edges stays pending. So does a pair where one side is a merged-away loser. The queue shows the loser's stale single-record fields and asks "Same business?" about a pair that is already one business. Answering "Different" writes `distinct` inside a single cluster.
2. `mergeCandidate` returns `skipped_distinct` without changing the decision. The ≥95 candidate stays `pending` forever and ranks **first** in the queue (score desc). After an unmerge, the other edges between the two clusters surface there, and the reviewer is never told this pair was ruled distinct. One tap on "Same" re-merges what was just unmerged, which undermines the intent of D-20.

**Fix:** at the end of stage 5:
- mark `merged` any pending candidate whose two roots coincide;
- mark `skipped_distinct` candidates `distinct`, or give them a `blocked_by` feature the card renders;
- in `readReviewQueue`, join both sides and require `merged_into_id is null` (or render the roots).

### A-WR-04: `closed_at` has two writers with different tie rules, so it flip-flops and emits spurious events

**File:** `src/lib/resolve/survivorship.ts:178`, `scripts/ingest-comptroller.ts:924-949`

**Issue:** `survive()` picks the first closure in canonical order. Closures have null confidence, so that is the **smallest uuid**, not the latest date. `CLOSURE_UPDATE_SQL` picks `order by closed_at desc`. After a merge whose clusters carry two closures, the merge writes one date. The next closures run rewrites it to the other date (a `businesses` event on an unchanged feed, which breaks DATA-04's "zero events on re-run"). The next merge or unmerge flips it back. Separately, neither writer ever clears `closed_at` when the closure record disappears from the feed.

**Fix:** in `survive()`, choose the closure with the max `closedAt` (tie → id), matching the SQL. Pin that with a test on two closures. Decide explicitly, and write down, whether a closure that is now `gone` should stop closing the business.

### A-WR-05: Unmerge restores the winner from a snapshot and erases legitimate post-merge changes

**File:** `drizzle/0024_merge_functions.sql:337-338`

**Issue:** `winner_fields_before` is correct only if nothing but merges touched the winner in between, and the LIFO check covers merges only. Concrete case:
- Winner W is a Comptroller business with key K.
- After the merge, the closures run sets `W.closed_at` from W's **own** closure record.
- Unmerging restores `closed_at = NULL` from the snapshot.

W then reads as active and can surface as a lead until the next closures run. The same thing happens to a Census location written after the merge.

**Fix:** re-derive the winner the way the loser is re-derived: survive() over the parents of the winner's remaining cluster, meaning every member minus the loser's subtree. Keep the snapshot for audit only. At minimum, re-run the closure rule for the winner inside `undo_merge`.

### A-WR-06: The payload-hash gate also blocks re-derivation, contradicting D-02's "a mapping change, not a re-ingest"

**File:** `src/lib/ingest/upsert.ts:316-319`, `scripts/ingest-overture.ts:391`, `scripts/ingest-comptroller.ts:478-507`

**Issue:** `cluster_key` (from `overture_category_map` and `clusters.json` NAICS ranges), `name_norm` (normalizer version) and `city` (the `cities.name_variants` fold) all derive from inputs outside the payload hash. When one of those changes and the payload does not, the business is never updated. Not even a full re-ingest applies a remap. D-02 promises that adding a cluster is a mapping change.

**Fix:** either:
- include the derivation inputs in the gate. Hash `{payload, derived}`, or compare the derived columns with `is distinct from` in the UPDATE's WHERE so an unchanged derivation still writes nothing; or
- add an explicit `--rederive` pass that recomputes `cluster_key` from the current map in one set-based UPDATE.

### A-WR-07: A Census No_Match after an address change leaves the old coordinates on the business

**File:** `scripts/ingest-comptroller.ts:667-670`, `scripts/ingest-comptroller.ts:698-733`

**Issue:** "No_Match writes nothing" is right for a transient failure but wrong when the permit's address changed. Scenario:
- The permit moves from 100 Main St to 900 Elm St.
- The permits pass rewrites `street`/`postal`, but `lat`/`lng` are deliberately left undefined.
- The new address comes back No_Match.
- The business keeps the old point, still citing the old census record, whose `payload.input` names the old address.

The distance tiers, the 500 m geo gate and the 25 km rule then score the new address at the old location.

**Fix:** when the outcome is No_Match or Tie and the stored census record's `payload.input` differs from the current input, null `lat`/`lng`/`location_source_id`/`location_match_type` on the business. Don't do this on ChunkFailed. Count it in stats as `location_cleared`.

### A-WR-08: `finishRun` updates `ingest_runs` without an org predicate

**File:** `src/lib/ingest/run-report.ts:121-126`

**Issue:** This is the one owner-tier write in scope that is not org-scoped (`where id = $1`). The owner bypasses RLS, so a wrong `runId` (a future scheduler reusing ids, or a copy-paste in a desk script) would complete **another org's** run row. The event would then be emitted under the current org's claim, pointing at a foreign row. It is not exploitable today because `runId` always comes from this run's `startRun`, but it breaks the invariant this phase depends on.

**Fix:** `where id = $1 and org_id = app.current_org_id()`, which is already non-null here because `emit_event` requires it. Or take `orgId` as a parameter, as `PERSIST_STATEWIDE` does.

### A-WR-09: The `/businesses` list's "sources" column omits the sources a merged winner absorbed

**File:** `src/server/queries/businesses.ts:190-204`

**Issue:** `srcs` reads only records whose `business_id` is the row itself, plus Census and closure records by the row's own `comptroller_key`. The detail view (`:540-565`) also includes every business merged into it. A Comptroller winner whose `display_name` comes from its absorbed Overture twin therefore lists only "Comptroller" in the list but "Comptroller · Overture" on the detail page. D-17 says the list shows the sources present.

**Fix:** build a `members` set in `srcs` (`page p join businesses m on m.org_id = p.org_id and (m.id = p.id or m.merged_into_id = p.id)`) and join `source_records` through `m.id` / `m.comptroller_key`, grouping by `p.id`.

### A-WR-10: Stage 5 aborts the whole resolve pass on any refusal other than 40001

**File:** `scripts/resolve.ts:653-667`

**Issue:** Only `40001` is retried. A `55000` from a reviewer deciding the same pair mid-pass would kill the remaining merge loop after minutes of blocking and scoring. That includes the refusals A-CR-01's fix adds. The same goes for a `40P01` deadlock between `record_merge` and `undo_merge`, which lock `businesses` and `merge_candidates` in opposite orders. The run report event is then never emitted, because it comes after stage 5.

**Fix:** map `55000` to `not_pending` and continue. Retry `40P01` like `40001`. Wrap the pass so a failure still emits the partial stats event.

## Info

### A-IN-01: `unaccent` and `pg_trgm` are installed into `public` and called unqualified

**File:** `drizzle/0021_extensions.sql:9-11`, `src/server/queries/businesses.ts:120-121`

**Issue:** `create extension` with no schema lands in `public` on Supabase. The call works only because `public` is on every role's `search_path`. One-argument `unaccent()` also resolves its dictionary through `search_path`. Supabase's advisor flags `extension_in_public`, and ARCHITECTURE.md already adopted `with schema extensions` for PostGIS.

**Fix:** `create extension … with schema extensions`, then call `extensions.unaccent('extensions.unaccent', …)`. Qualify the `%`/`<->`/`similarity` uses, or pin `search_path` on the desk connections.

### A-IN-02: Performance, noted and out of v1 scope

**File:** `drizzle/0023_spine_constraints_grants.sql` (no index), `src/lib/resolve/merge.ts:334-336`, `src/lib/resolve/merge.ts:209`, `src/server/queries/businesses.ts:119-123`

**Issue:**
- `source_records.business_id` has no index. `readParents` on every merge and unmerge, and the detail page's `members` query, seq-scan about 141k rows.
- `coalesce(merged_into_id, id) = $1` cannot use any index, so every `mergePair` scans the org's about 92k businesses. Because merges are flattened, the equivalent `id = $1 or merged_into_id = $1` can use `businesses_merged_idx`.
- The search predicate is two `unaccent()` calls per row. The `external_key = upper($q)` branch of the OR is moot, since the ilike arms already force a seq scan.

**Fix:** `create index source_records_business_idx on source_records (org_id, business_id) where business_id is not null`, and rewrite the member predicate as above.

### A-IN-03: 0022 adds `external_key text NOT NULL` with no default

**File:** `drizzle/0022_spine_tables.sql:98`

**Issue:** The migration fails (`23502`) against any database whose `businesses` table has rows. That is harmless if prod's table is empty, but it is not checked.

**Fix:** run a pre-flight `select count(*) from businesses` on prod before `db:migrate:prod`, per the separate-read-first rule.

### A-IN-04: A killed desk run shows as `running` on `/sources` forever

**File:** `src/server/queries/sources.ts:107-126`, `scripts/ingest-comptroller.ts:280-306`

**Issue:** SIGINT or a crash skips the `catch`. The latest run by `started_at` stays `running` with zero counts and hides the previous complete run's ledger line until the next run.

**Fix:** show the latest *finished* run's counts beside an in-progress indicator. Alternatively, have startRun mark older `running` rows for the same source `stopped`.

### A-IN-05: `ingest-overture` ignores unknown flags and drops the partial tally on failure

**File:** `scripts/ingest-overture.ts:91-114`, `scripts/ingest-overture.ts:420-425`

**Issue:** The other two scripts refuse unknown flags. Here, `--limit=50` or `--dry-run` is silently ignored and becomes a full 57k-row write. The failure record also writes `emptyTally()` instead of the rows already committed, whereas the Comptroller ingest keeps them.

**Fix:** copy `parseIngestArgs`'s unknown-flag refusal, and pass the live `tally` into the failed `finishRun`.

### A-IN-06: `name_norm` is not updated on merge

**File:** `drizzle/0024_merge_functions.sql:38-39`

**Issue:** The winner keeps its own normalized spelling, and the loser leaves blocking (`merged_into_id is null`). A later third duplicate that matches only the absorbed record's spelling (typically the Overture name) is no longer blocked against the cluster. This is a deliberate exclusion, but its effect on recall is not written down.

**Fix:** document it. Alternatively, let B3 probe from merged rows while pairing to their roots.

### A-IN-07: `undo_merge` reads the merge row without locking it

**File:** `drizzle/0024_merge_functions.sql:306-316`

**Issue:** When two concurrent unmerges hit the same merge, the second caller locks the businesses after the first commits, but its `v_merge` is stale. It then fails with "undo the later merge first" (55000). That is safe, but the message is wrong: the unmerge dialog shows "undo the later merge first" instead of "already undone".

**Fix:** `select * into v_merge … for update`.

---

_Reviewed: 2026-09-23T10:45:01Z_
_Reviewer: Claude (gsd-code-reviewer), slice A_
_Depth: standard_
