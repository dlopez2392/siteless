---
phase: 03-free-data-spine-entity-resolution
reviewed: 2026-09-23
head: 93bf4cd (gsd/phase-03-free-data-spine-entity-resolution)
depth: standard
method: three parallel gsd-code-reviewer slices (A db/sql/ingest/resolve/server; B pure libs; C UI), consolidated by the orchestrator
files_reviewed: 90
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
  - .gitattributes
  - .vercelignore
  - package.json
  - src/env.ts
  - src/lib/export/public-business.ts
  - src/lib/geocode/census-batch.ts
  - src/lib/ids/external-key.ts
  - src/lib/instant.ts
  - src/lib/normalize/address.ts
  - src/lib/normalize/index.ts
  - src/lib/normalize/name.ts
  - src/lib/normalize/phone.ts
  - src/lib/overture/transform.ts
  - src/lib/socrata/client.ts
  - src/lib/socrata/closures.ts
  - src/lib/socrata/permits.ts
  - src/lib/socrata/statewide-names.ts
  - src/lib/time.ts
  - src/seed/data/overture-categories.json
  - src/seed/types.ts
  - src/app/(app)/businesses/[id]/loading.tsx
  - src/app/(app)/businesses/[id]/not-found.tsx
  - src/app/(app)/businesses/[id]/page.tsx
  - src/app/(app)/businesses/page.tsx
  - src/app/(app)/review/page.tsx
  - src/app/(app)/sources/page.tsx
  - src/components/app-shell/app-sidebar.tsx
  - src/components/app-shell/mobile-tab-bar.tsx
  - src/components/app-shell/more-sheet.tsx
  - src/components/app-shell/top-bar.tsx
  - src/components/business-detail/copy-lead-key.tsx
  - src/components/business-detail/detail-header.tsx
  - src/components/business-detail/fields-and-sources.tsx
  - src/components/business-detail/merge-history.tsx
  - src/components/business-detail/source-records.tsx
  - src/components/business-detail/unmerge-dialog.tsx
  - src/components/business-list/business-cards.tsx
  - src/components/business-list/business-filters.tsx
  - src/components/business-list/business-table.tsx
  - src/components/business-list/businesses-empty.tsx
  - src/components/business-list/businesses-skeleton.tsx
  - src/components/flags/closed-badge.tsx
  - src/components/review/candidate-pair.tsx
  - src/components/review/review-actions.tsx
  - src/components/review/review-empty.tsx
  - src/components/review/review-skeleton.tsx
  - src/components/review/signal-chips.tsx
  - src/components/review/thumb-bar.tsx
  - src/components/sources/attribution-block.tsx
  - src/components/sources/confidence-distribution.tsx
  - src/components/sources/copy-command-button.tsx
  - src/components/sources/source-ledger.tsx
  - src/components/sources/sources-skeleton.tsx
  - src/components/ui/sheet.tsx
  - src/lib/ui/copy.ts
  - src/lib/ui/review-format.ts
  - src/lib/ui/run-tone.ts
findings:
  critical: 5
  warning: 27
  info: 22
  total: 54
status: issues_found
---

# Phase 3 Code Review — consolidated

Standard depth, 90 source files (tests, fixtures, docs and generated drizzle metadata excluded), reviewed as three
slices in parallel. Finding IDs carry their slice prefix (A-/B-/C-). Per-slice originals:
`03-REVIEW-partA.md`, `03-REVIEW-partB.md`, `03-REVIEW-partC.md`.

## Blockers (5)

| ID | Where | Defect |
|---|---|---|
| A-CR-01 | drizzle/0024 `app.record_merge` | Concurrent reviewer race: a recorded "Different" can be silently overwritten by a merge (candidate read unlocked; distinct refused only for `auto`; final update has no pending check) |
| A-CR-02 | src/lib/ingest/upsert.ts:307-333, scripts/ingest-comptroller.ts:756-765 | A changed source row re-writes the business it originally created, ignoring merges — re-ingest undoes survivorship on winners and writes to merged-away rows |
| A-CR-03 | src/lib/resolve/merge.ts (`sourceRecordView`) | `clusterKey` never populated → survivorship's cluster rule is dead; a merged business can lose `cluster_key` and silently leave the funnel |
| B-CR-01 | src/lib/normalize/name.ts:67-84 | Legal-suffix strip removes `l`/`c`/`co` tokens ANYWHERE (`C & L Plumbing` → `plumbing`) → false 95 auto-merges and false chain badges; stored keys must be recomputed after the fix |
| C-CR-01 | review-actions.tsx:89-107, unmerge-dialog.tsx:111-124; no error.tsx anywhere | Rejected server action / read failure (e.g. phone loses signal) hits no error boundary → whole app replaced by Next's generic error page; failure copy is unreachable |


# Slice A — database / SQL / ingest / resolve / server actions


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


# Slice B — pure libraries


# Phase 3: Code Review Report, Slice B (pure libraries)

**Reviewed:** 2026-09-23
**Depth:** standard, plus executed probes (`tsx` against the real modules) for every normalizer/parser claim below
**Files Reviewed:** 20
**Status:** issues_found

## Summary

These areas came out clean: the Socrata host/dataset/param guards, the county padding split (`031` for permits vs `31` for closures, both regex-pinned), NAICS as numeric range predicates, `$order` enforcement with unique sort keys at the callers, the Chicago reading of closure dates (probed under `TZ=UTC`: `1993-03-03` becomes `06:00Z`, a July date becomes `05:00Z`), the rule that Census rows are matched by ID with lng first and `Non_Exact` never promoted, the Crockford key (uniform `b % 32`, `getRandomValues`, the pattern matches the alphabet), `env.ts` (server-only, no NEXT_PUBLIC_, `||` empty-string handling), `time.ts`, `.vercelignore`, `.gitattributes`, and the seed map (70 unique categories, every `cluster_key` valid, nothing both mapped and decided-unmapped, row sums close).

The defects are in the **normalizers**, and they are behavioural. `nameNorm` deletes identity-carrying tokens. The address key throws the unit away and nothing downstream checks it again. The phone key drops extensions. Taken together, these let two distinct businesses in one strip mall reach score 95 and auto-merge. They also give independent businesses a false chain badge. Every finding below was reproduced by running the module, not by reading it.

## Critical Issues

### B-CR-01: `nameNorm` strips the single letters `l` and `c`, and `co`, anywhere in a name. Distinct businesses get identical keys and can auto-merge

**File:** `src/lib/normalize/name.ts:67-84` (the `LEGAL` set), used at `:143`
**Issue:** `'l'`, `'c'` and `'co'` are in `LEGAL` so that "L.L.C." folds away. The token filter runs at every position, though, not only on a trailing legal-form run. Probed:

| raw | name_norm |
|---|---|
| `C & L Plumbing` | `plumbing` |
| `L & C Tire Shop` | `tire shop` |
| `C&C Auto Repair` | `auto repair` (identical to `Auto Repair`) |
| `The L Bar` | `bar` |
| `Co-Op Feed` | `op feed` |

`name_norm` is the input to both the dedupe and the chain detector, so there are two ways this does damage:

1. **False auto-merge.** Take `L & C Auto Repair, STE 5` and `C & C Auto Repair, STE 7` at the same street number. The name similarity is 1.0, which gives 45. The suite is stripped from the address key (see B-WR-01), so the address scores 30 in full. Distance ≤100 m adds 15 and the same cluster adds 5, for **95**, with three independent signals. That is an auto-merge of two different businesses, and only the chain cap stops it, if three such names happen to exist.
2. **False chain badge.** `chain.ts` groups on `name_norm` equality, and `foldStatewideRows` sums raw names into the same key. Probed: `foldStatewideRows([C & L PLUMBING ×3, PLUMBING ×3])` gives `plumbing → 6`. An independent "C & L Plumbing" in the RGV is badged "Chain · 6 in Texas", and every legitimate merge for it is capped at 94.

The names this hits are initial-led ("C & L", "J.C.", "A&C"), which are very common among the RGV trades this product targets.
**Fix:** Strip legal forms only as a trailing run, and remove single letters only when they came from a dotted legal abbreviation. For example, collapse `l.l.c.` / `l l c` into `llc` before tokenising, then drop `LEGAL` tokens only from the end of the token list:
```ts
const LEGAL = new Set(['llc','inc','co','ltd','corp','dba','lp','llp','pllc','plc','incorporated','company','corporation']);
const pre = foldDiacritics(raw).toLowerCase()
  .replace(/\bl\.?\s*l\.?\s*c\b\.?/g, ' llc ')   // "L.L.C." / "L L C" → llc
  .replace(/\bl\.?\s*l\.?\s*p\b\.?/g, ' llp ')
  .replace(/[^a-z0-9]+/g, ' ');
let tokens = pre.split(' ').filter(Boolean).filter((t) => !STOP.has(t) && !TRADE.has(t));
while (tokens.length > 1 && LEGAL.has(tokens.at(-1)!)) tokens = tokens.slice(0, -1); // trailing only
```
Add named tests: `C & L Plumbing ≠ Plumbing`, `C&C Auto Repair ≠ Auto Repair`, `Co-Op Feed` keeps `co`. Because this changes stored keys, `name_norm` must be re-written for every row (re-run the transform) before the next resolve pass.

## Warnings

### B-WR-01: The suite/unit is removed from the key and nothing downstream compares it, so two tenants of one building score a full address match

**File:** `src/lib/normalize/address.ts:88-92` (consumed by `src/lib/resolve/score.ts:247-251`)
**Issue:** Probed: `1100 E EXPRESSWAY 83 BLDG A STE 5` and `1100 E EXPY 83 BLDG B STE 5` both come out as `{streetNum:'1100', streetNorm:'e expy 83'}`, with units `BLDG A STE 5` and `BLDG B STE 5`. `addressFull` compares only num + norm + postal, so a pair whose units are both known and different still gets the full 30 points and counts as an independent `address` signal. The header's rationale (keep the unit on the record so the detail view can tell tenants apart) protects the display, not the merge. B-CR-01 shows this path reaching 95.
**Fix:** Keep the unit out of the blocking key, but normalise it (`unitNorm`: upper-case, fold `SUITE`→`STE`, drop `#`/punctuation) and have the scorer deny `addressFull`, and the `address` signal, when both sides carry a unit and the normalised units differ:
```ts
if (present(a.unitNorm) && present(b.unitNorm) && a.unitNorm !== b.unitNorm) return w.addressNumPostal; // not full, not a signal
```
A named test: two suites at one street number never produce `signals` containing `'address'`.

### B-WR-02: Street names that start with a unit designator are parsed as units and `streetNorm` is lost

**File:** `src/lib/normalize/address.ts:61-62` (`UNIT_RE`)
**Issue:** Probed:
- `12345 RM 620 N` gives `streetNorm: null, unit: 'RM 620 N'`
- `100 LOT 5 RD` gives `streetNorm: null, unit: 'LOT 5 RD'`
- `1201 W UNIT RD` gives `streetNorm: 'w', unit: 'UNIT RD'`
- `500 N APT BLVD` gives `streetNorm: 'n'`
- `6 SPC ST` gives `streetNorm: null`

`RM` is Texas's Ranch-to-Market road prefix (RM 620, RM 1431, RM 2222). It is as common in central Texas as `FM` is in the RGV, and the project is scoped to scale to Texas. Every such address loses its street key: `streetNorm: null` makes `addressFull` impossible, so real duplicates on those roads never get the address signal. A key like `'w'` will also match any other `W …` street.
**Fix:** Remove `RM` from the designator list; `ROOM` is essentially never written `RM` in commercial addresses, and a Texas road prefix is. Refuse a unit match when the identifier is followed by a street-suffix token (`RD|ST|AVE|BLVD|DR|LN|…` or their long forms), or when the remainder before the match would be empty or a lone directional. Add the five probes above as table rows.

### B-WR-03: Phone extensions are silently dropped, so a shared switchboard becomes a trusted blocking identifier

**File:** `src/lib/normalize/phone.ts:37-44`
**Issue:** Probed: `(956) 423-1234 ext 12` and `956-423-1234 x5` both return `{e164:'+19564231234', blockable:true}`. The file's own reasoning is that a number shared across businesses (a switchboard) is not an identity. That is why toll-free numbers are excluded, and an explicit extension is direct evidence of the same thing. Two practices in one medical building on one PBX, with names at or above 0.6 similarity ("Garcia Family Dental" / "Garcia Pediatric Dental"), meet R3 (exact phone + same ZIP + name ≥0.6) and are lifted to **95**, an auto-merge.
**Fix:** Return `blockable: false` whenever `p.ext` is set, and keep `e164` for dialling:
```ts
return { e164: p.number, blockable: !TOLL_FREE_NPAS.has(npa) && !p.ext };
```
A named test: `'956-423-1234 x5'` is not blockable.

### B-WR-04: The Overture phone pick takes the first valid number even when it is toll-free, hiding a blockable local number behind it

**File:** `src/lib/overture/transform.ts:168` (mirrored in `src/lib/resolve/merge.ts:93-96`)
**Issue:** `phones.map(phoneE164).find(p => p.e164 !== null)` picks `+18004879643` (blockable `false`) from `['+18004879643', '+19564231234']`. The local number, which would have been the B1 blocking key and the R3 identifier, is never considered. Chain franchisees commonly list the corporate 800 number first. They then drop out of phone blocking entirely, while the stored/displayed phone is the corporate switchboard.
**Fix:** Prefer the first blockable key, and fall back to the first valid one:
```ts
const keys = phones.map((p) => phoneE164(p));
const phone = keys.find((k) => k.blockable) ?? keys.find((k) => k.e164 !== null) ?? NO_PHONE;
```
Apply the same change to `firstPhone` in `merge.ts` so survivorship and ingest agree. That second change is slice A's file, but it must change in lockstep.

### B-WR-05: Stripping trade words, combined with chain detection by name equality, flags unrelated independents as chains

**File:** `src/lib/normalize/name.ts:90, 143`, and `src/lib/socrata/statewide-names.ts:211-213`
**Issue:** Probed: `Taqueria Garcia` and `Garcia` both normalise to `garcia`. So do "Panaderia Garcia" and "Carniceria Garcia". Three unrelated family businesses sharing a surname are therefore flagged `chain_key='garcia'` (`chain.ts` counts `name_norm` equality ≥3), with the badge "Chain · 3 in Texas". Each also loses auto-merge (R2 cap 94) against its own true duplicate. In the RGV, surname-plus-trade names are the dominant naming pattern. D-12's trade-word strip makes sense for **similarity**, but it is wrong as an **identity** key for chain detection.
**Fix:** Give chain detection (and the statewide fold) a key that keeps trade words. For example, `nameNormDetail` returns `chainNorm` (legal suffixes and stopwords stripped, trade words kept), stored in its own column. Alternatively, do not flag a chain whose `name_norm` is a single token that was reached by removing a trade word.

### B-WR-06: `instantOf('')` returns 1970-01-01, the exact silent epoch the doc says it refuses

**File:** `src/lib/instant.ts:20-27`
**Issue:** `Number('')` and `Number('   ')` are `0`, which is finite, so the function returns `new Date(0)`. Probed: `instantOf('')` gives `1970-01-01T00:00:00.000Z`. `requireInstant` docs say "an empty value means the cast in the SELECT was forgotten … Rendering the epoch instead would be the product lying". An empty string is exactly the value it lets through.
**Fix:**
```ts
if (epochMs === null) return null;
if (epochMs.trim() === '') throw new Error('instantOf: empty string where epoch milliseconds were expected');
```
Add a test for `''`.

### B-WR-07: Census coordinate validation accepts a missing half as `0`

**File:** `src/lib/geocode/census-batch.ts:185, 195-208`
**Issue:** `f[5].split(',').map(Number)` turns an empty half into `0`, which passes `isFinite` and the ±90/±180 checks. Probed: a `Match` line with `"-97.6,"` returns `{kind:'Match', lat:0, lng:-97.6}`, and `","` returns `(0,0)`. The header promises "never as a `Match` carrying `undefined` or `NaN`"; a missing coordinate becomes a real point on the equator. That point is then written to `businesses.lat/lng`, and the 25 km rule marks the business `distinct` from everything.
**Fix:** Require non-empty numeric text for each half. Also bound the result to Texas (or at least `lat > 0 && lng < 0`), which also catches an axis swap more tightly than ±90:
```ts
const parts = f[5].split(',').map((s) => s.trim());
if (parts.some((s) => s === '' || !/^-?\d+(\.\d+)?$/.test(s))) return badShape(id);
const [lng, lat] = parts.map(Number);
if (!(lat > 25 && lat < 37 && lng > -107 && lng < -93)) return badShape(id);
```

### B-WR-08: One unparseable response line fails all 1,000 rows of its chunk, and retrying cannot help

**File:** `src/lib/geocode/census-batch.ts:284-292`
**Issue:** Any single `bad_shape` line (an unescaped `"` in the echoed input, which makes `parseQuotedCsvLine` return `null`, or a new status value) discards the whole response. The failure is deterministic, so all three attempts fail the same way (2 s + 8 s + three full uploads), and all 1,000 rows become `ChunkFailed`, unlocated. `csvField` doubles `"` in the request, but nothing guarantees the service escapes the echo in its response. One Comptroller address carrying a quote mark would cost ~1,000 geocodes on every run.
**Fix:** Salvage what can be salvaged. Keep every line that parses and names an expected ID. Mark only unparseable IDs `bad_shape`, identified by elimination against `expected`. Treat the chunk as failed only on a count mismatch or duplicate IDs. Also strip `"` from street/city in `csvField`, since it carries no geocoding meaning.

### B-WR-09: The closure schema requires `loc_name`, so a closed outlet with a blank or long name is never marked closed

**File:** `src/lib/socrata/closures.ts:300`
**Issue:** The D-03 closure match needs only `tp_number`, `loc_number` and `out_of_business_date`. The caller (`scripts/ingest-comptroller.ts:880-893`) never uses `legalName`. Even so, `loc_name: z.string().min(1).max(200)` makes a missing name (Socrata omits nulls) or a name over 200 characters reject the row. The business then stays `active` in the spine and is served as a live lead, which is exactly what D-03 exists to prevent. Rejections are only sampled, 10 at most, in the run stats.
**Fix:** `loc_name: z.string().max(500).optional()`, with `legalName: row.loc_name ?? null` in the source record. Validate what matters for the match, and keep everything else optional.

### B-WR-10: `PublicBusiness` is a type-only projection, and it omits `chainKey`, which is as internal as `name_norm`

**File:** `src/lib/export/public-business.ts:14-17, 26-57`
**Issue:**
1. The header says "the internal field is not on the value they are handed", but `Omit<>` removes nothing at runtime. A full Drizzle row (or `BusinessLike`) held in a variable is assignable to `PublicBusiness`, because excess-property checks apply only to object literals. A builder that spreads or `JSON.stringify`s its argument therefore emits `internalNotes`. The sentinel test only catches this if the fixture it feeds is the wide object and the builder is registered.
2. `chain.ts:13-17` states that `chain_key` is literally `name_norm` and "exactly as INTERNAL". `BusinessLike` does not declare `chainKey`, so it is neither omitted by the type nor canaried by `tests/unit/no-internal-leak.test.ts`. A builder handed the real row leaks the normalised match key under a different name.

**Fix:** Add a runtime projection and make the registry call builders only through it:
```ts
export function toPublicBusiness(b: BusinessLike): PublicBusiness {
  return { id: b.id, orgId: b.orgId, legalName: b.legalName, displayName: b.displayName,
           phoneE164: b.phoneE164, city: b.city, status: b.status };
}
```
Add `chainKey: string | null` to `BusinessLike` and to the omitted set, and add a `CHAIN_KEY` canary to the sentinel.

## Info

### B-IN-01: `hadStoreNumber` has no consumer, yet the doc says the scorer reads it

**File:** `src/lib/normalize/name.ts:94-101, 145-148`
**Issue:** `grep -rn hadStoreNumber src scripts` finds nothing outside `name.ts`. The "smartstyle 8 vs smartstyle" forgiveness the comment promises does not exist. It also sets `true` for `Route 66` and `Studio 2025`.
**Fix:** Either wire it into `score()` (and persist it), or delete the field and correct the comment.

### B-IN-02: `UNIT_RE` is quadratic on runs of commas/whitespace, and Overture `freeform` has no length cap

**File:** `src/lib/normalize/address.ts:61-62`, and `src/lib/overture/transform.ts:73`
**Issue:** Probed: `'1 ' + ', '.repeat(20000) + 'X'` takes **2.7 s** in `addressKey`. Comptroller addresses are capped at 200 by zod; the Overture `street` is `z.string().nullable()` with no max. This is not exploitable at realistic lengths, but it contradicts the T-3-12 linearity claim.
**Fix:** Add `street: z.string().max(300).nullable()` in the Overture schema, and/or collapse `[\s,]+` runs before matching.

### B-IN-03: Missing folds that matter for RGV addresses

**File:** `src/lib/normalize/address.ts:26-53, 64`
**Issue:** Probed: `W BUSINESS 83` gives `w business 83`, but `W BUS 83` gives `w bus 83`. Business 83 runs through every RGV city. `FARM TO MARKET 1015` is not folded to `fm 1015`, and `N FIRST ST` gives `n first st` while `N 1ST ST` gives `n 1st st`. `123A MAIN ST` gives `streetNum: null, streetNorm: '123a main st'`, while `123 A MAIN ST` gives `'123'` / `'a main st'`. Each of these silently zeroes the address signal for a true duplicate.
**Fix:** Add `BUSINESS→BUS`, the multi-token `FARM TO MARKET`/`FARM-TO-MARKET`→`FM` (fold before tokenising), and ordinal words→`1ST…`. Let `LEADING_NUMBER` accept `^(\d+)([A-Z])?\b` and fold the letter into the unit.

### B-IN-04: One malformed statewide group throws away the whole chain map

**File:** `src/lib/socrata/statewide-names.ts:192, 210`
**Issue:** `groupRowSchema.parse` throws on a single `outlet_name` over 200 characters, so the entire 11,647-name map is lost for that run, and the run falls back to the last good one. This is by design ("throws rather than silently shrinking"), but a name-length limit is not a shape violation.
**Fix:** Raise `max` to e.g. 500. Alternatively, skip-and-count oversize names in the returned stats.

### B-IN-05: `socrataCount` returns `NaN` without checking it

**File:** `src/lib/socrata/client.ts:169-171`
**Issue:** `Number(n)` on a non-numeric `n` returns `NaN` into the seed counts.
**Fix:** `const v = Number(n); if (!Number.isInteger(v) || v < 0) throw …`.

### B-IN-06: Short NAICS codes pass validation but can never be clustered

**File:** `src/lib/socrata/permits.ts:58, 87-94`
**Issue:** The regex accepts 2–6 digits, but the cluster ranges are 6-digit (`812100–812200`). A 4-digit `8121` compares as `8121` and lands in no cluster, silently, and the numeric `$where` has the same blind spot. Whether short codes exist in `jrea-zgmq` was not measured.
**Fix:** Either restrict the regex to `^\d{6}$` so a short code shows up as a rejection, or right-pad to 6 digits before `clusterFor` and count how many were padded in the run stats.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), slice B_
_Depth: standard_


# Slice C — UI


# Phase 3: Code Review Report, Slice C (UI)

**Reviewed:** 2026-09-23
**Depth:** standard (plus targeted cross-file reads of `src/server/queries/{businesses,review-queue}.ts`, `src/server/actions/{record-review-decision,unmerge-business,_result}.ts`, `src/app/(app)/layout.tsx`, `src/app/layout.tsx`, `src/components/ui/{item,badge}.tsx`)
**Files Reviewed:** 37
**Status:** issues_found

## Summary

I checked each known defect class in the brief against the code:

- **Client-reference trap (Rule 5): clean.** Every server component that imports from a `"use client"` module imports components only: `BusinessTable`/`BusinessesShowMore`, `SearchRetryButton`, `ReviewActions`/`ReviewAdvance`, `ThumbBar`, `UnmergeDialog`, `CopyLeadKeyButton`, `CopyCommandButton`, `ConfidenceDistribution`. The shared data (`LEDGER_SOURCES`, `COUNT_KINDS`, the helpers in `business-cards`, copy, run-tone and review-format) lives in modules with no directive. The one latent hazard is C-IN-05.
- **Form-reset / Rule 20: clean.** Review decisions and unmerge both use `onClick` inside `useTransition`. The queue advances, and the dialog closes, only on `ok: true`.
- **One `withOrg` per request: clean.** Each page opens exactly one, and nothing is nested. The Clerk call runs after the transaction, not inside it.
- **Tailwind `[--x]`: clean.** Grep found no hits.
- **Direct `Intl` in components: clean.** Only the two routes build pinned-locale formatters.
- **Internal annotation, `name_norm`, legal/display swap: clean.** None is selected or rendered.
- **URL params:** clamped and validated. `isUuid` runs before any read.

The blocker is error handling. The app has no `error.tsx` or `global-error.tsx`. A server action that rejects (the likeliest failure on a phone), or a read that throws, replaces the whole screen with Next's generic "Application error". The spec's error copy for those cases exists in `copy.ts` but can never render.

## Critical Issues

### C-CR-01: No error boundary anywhere. A network failure during a review decision or an unmerge crashes the whole app, and the spec'd error states can't be reached

**Files:**
- `src/components/review/review-actions.tsx:89-107`
- `src/components/business-detail/unmerge-dialog.tsx:111-124`
- `src/app/(app)/review/page.tsx:58-60`
- `src/app/(app)/businesses/[id]/page.tsx:105-107`

**Issue:**
- `find src/app -name error.tsx -o -name global-error.tsx` returns nothing, and there is no `ErrorBoundary` anywhere in `src`.
- `decide()` and `confirm()` do `await recordReviewDecision(...)` / `await unmergeBusiness(...)` inside `startTransition(async …)` with no `try/catch`. The action returns `{ok:false}` only for failures caught on the server. When the request itself fails, the promise rejects. That covers a phone losing signal mid-tap, a Vercel 5xx or timeout, and a deploy that invalidates the action id.
- In React 19 an error thrown inside a transition goes to the nearest error boundary. With no `error.tsx`, that is Next's built-in "Application error: a client-side exception has occurred" page. The queue, the pair and the tab bar are all gone.
- The spec's own row for this exact case ("That decision didn't reach the server… Try again · Reload the queue", UI-SPEC § Error) is only shown for server-side DB failures.
- The two read paths fail the same way. `listReviewQueue` in `ReviewRegion` and `getBusinessDetail` in the detail page are not caught, so a DB error (for example the `->> chain_key)::int` cast in the chain lateral) produces the same generic crash.
- As a result, `REVIEW_LOAD_FAILED` and `SPINE_UNEXPECTED_ERROR` in `copy.ts` are defined and referenced by no file (checked with grep).

No decision is lost, because Rule 20 holds and the pair is still pending. But on the phone-first primary screen, a routine connectivity blip becomes a full app crash.

**Fix:** catch the rejection in both transitions and map it to the refusal UI:
```tsx
startTransition(async () => {
  let result;
  try {
    result = await recordReviewDecision({ candidateId, decision });
  } catch {
    setRefusal({ message: REVIEW_DECISION_FAILED, retryable: true, decision });
    return;
  }
  if (!result.ok) { /* existing branch */ }
  ...
});
```
Do the same in `unmerge-dialog.tsx`, using `setError(UNMERGE_FAILED)`. Then add segment boundaries:
- `src/app/(app)/review/error.tsx` rendering `REVIEW_LOAD_FAILED` with "Try again" (`reset()`) and "Open sources".
- `src/app/(app)/businesses/[id]/error.tsx` rendering `SPINE_UNEXPECTED_ERROR('this business')`.
- A generic `src/app/(app)/error.tsx`.

## Warnings

### C-WR-01: The Clerk `getUserList` call on every detail render has no timeout, so a slow Clerk API blocks the whole page, and the fallback can print a reviewer's email

**File:** `src/app/(app)/businesses/[id]/page.tsx:77-95, 109`

**Issue:**
- `actorNames()` is awaited before anything renders. It is server-only (good), runs outside the `withOrg` (good), and a thrown error falls back to raw ids (good). But it has no timeout. If Clerk's Backend API is slow or rate-limited (it is called once per page view, with no caching), `/businesses/[id]` hangs until the SDK gives up. The unmerge action and every field on the page go with it, all for cosmetic names.
- Cross-org exposure is bounded: only ids stamped on this org's `business_merges` are looked up. However, `primaryEmailAddress` is the third fallback, so a user with no full name or username has their email printed as "Reviewed by jane@…" to every org member, including the `Member` role.
- `limit: ids.length` is fine until one business has more than 500 distinct actors, which Clerk rejects. That case falls back to raw ids.

**Fix:**
```ts
const lookup = client.users.getUserList({ userId: ids, limit: Math.min(ids.length, 100) });
const { data } = await Promise.race([
  lookup,
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('clerk timeout')), 1500)),
]);
```
- Drop the email fallback, or show initials only.
- Better still, stream the names: render the rows with ids first and put the names inside a `Suspense`.

### C-WR-02: The chain flag is rendered three different ways, including string surgery on a copy function

**Files:**
- `src/components/review/candidate-pair.tsx:113-117`
- `src/app/(app)/businesses/[id]/page.tsx:139-144`

**Issue:** The same fact comes out in three spellings:
- `/review`, statewide count: `FLAG_CHAIN(n)` → "Chain · 1284 in Texas". The count skips the pinned-locale formatter, so there is no grouping separator.
- `/review`, local count: `FLAG_CHAIN(n).replace(' in Texas', '')` → "Chain · 1284". The `replace` edits the output of a copy function, so any rewording of `FLAG_CHAIN` (for example "…statewide") silently brings back the overclaim this code exists to prevent.
- Detail page, local count: an inline `Chain · ${…} in the RGV`. This literal is not in `copy.ts`, which breaks Rule 5 ("every string lands in copy.ts").

So one business reads "Chain · 12" on `/review` and "Chain · 12 in the RGV" on its detail page, and statewide counts read "1284" on `/review` but "1,284" on the detail page.

**Fix:**
- Add `FLAG_CHAIN_LOCAL(n, shown)` to `copy.ts`.
- Use `statewide ? FLAG_CHAIN(n, formatCount(n)) : FLAG_CHAIN_LOCAL(n, formatCount(n))` in both places.
- Delete the `.replace`.

### C-WR-03: The detail header's Chain and Merged away badges have drifted to the Badge default 12/500, the same defect `ClosedBadge` was created to fix

**File:** `src/components/business-detail/detail-header.tsx:96-105`

**Issue:**
- `<Badge variant="outline">{chainLabel}</Badge>` and `<Badge variant="secondary">Merged away</Badge>` carry no typography classes. They render the primitive's `h-5 text-xs font-medium` (checked in `ui/badge.tsx:7`).
- They sit beside `ClosedBadge` (`h-auto px-2 py-1 text-sm font-semibold`), whose own header comment records that the detail header "had drifted to the Badge default 12/500, below the type scale (03-22)".
- `/review`'s chain badge and `/businesses`' merged-away badge both use the 14/600 treatment, so only this header is off-scale.
- `tests/unit/closed-badge.test.tsx` only pins `ClosedBadge`, which is why this passed.

**Fix:** Add `className="h-auto px-2 py-1 text-sm font-semibold tabular-nums"` to both, or better, extract a shared `FlagBadge` like `ClosedBadge` and pin it in the same test.

### C-WR-04: On phone, `/sources` renders `role="list"` with no `listitem` children (an ARIA required-children violation)

**Files:**
- `src/components/sources/source-ledger.tsx:281-290`
- `src/components/sources/sources-skeleton.tsx:70-72`

**Issue:**
- `ItemGroup` renders `role="list"` (`ui/item.tsx:11`), but `Item` is a plain `div` with no role. The phone ledger and its skeleton put four `Item`s directly under `ItemGroup`.
- Screen readers announce a list of zero or unknown items, and axe flags `aria-required-children` / `listitem`.
- `business-cards.tsx:250` already fixed exactly this with a `role="listitem"` wrapper, so the pattern exists in the codebase but wasn't applied here.

**Fix:** Wrap each `Item` in `<div role="listitem">`, as `business-cards.tsx` does, or pass `role="listitem"` on the `Item` itself.

### C-WR-05: An unmerge refusal offers "Try again" for conflicts that can never succeed, and leaves the stale Unmerge button on the page

**File:** `src/components/business-detail/unmerge-dialog.tsx:115-118, 145-169`

**Issue:**
- Every `!result.ok` shows the same Alert with "Try again" and "Open sources". For `conflict/already_undone` (someone else already undid it) and `conflict/later_merge_first`, a retry sends the same request and gets the same refusal.
- `UNMERGE_ALREADY_UNDONE` tells the user to "Reload to see the current merge history", but no reload action is offered.
- The page is never refreshed on failure. After dismissing, the row still reads as an active merge with a live Unmerge button, so the user can repeat the loop indefinitely.
- `review-actions.tsx` solved this with `isRetryable()` plus a "Reload the queue" action. The unmerge path did not reuse that pattern.

**Fix:**
- Carry `code` and `detail.reason` into the error state.
- Show "Try again" only when `code === 'unexpected' || reason === 'concurrent_merge'`.
- On any `conflict` / `not_found`, call `router.refresh()` so the row re-renders as undone, and offer a "Reload" action in place of retry.

### C-WR-06: The Skip and Different helper sentences in the Copy Table are never rendered, even though "Different" is permanent and deliberately unconfirmed

**File:** `src/components/review/review-actions.tsx:159-186` (constants at `src/lib/ui/copy.ts:396-398`)

**Issue:**
- UI-SPEC § Copy Table lists `/review` "Skip helper" and "Different helper". Grep shows `REVIEW_SKIP_HELPER` and `REVIEW_DIFFERENT_HELPER` are referenced by no file.
- Rule 23 removes any confirmation from "Different", yet the action is permanent: "records these two as separate for good — they will never auto-merge". The helper sentence is the only disclosure the spec gives the reviewer, and it isn't shown.

**Fix:**
- Render both helpers as Label 14/400 muted text beneath the action row. On phone they can go inside the thumb bar under row 2; `ThumbBar` already measures its own height.
- Link them with `aria-describedby` on the Different and Skip buttons.

### C-WR-07: Success toasts will likely cover the phone thumb bar right after each decision

**Files:**
- `src/components/review/review-actions.tsx:100-104`
- `src/components/review/thumb-bar.tsx:47`
- `src/app/layout.tsx:49` (`<Toaster />` with defaults)

**Issue:**
- `<Toaster />` uses sonner's defaults: `bottom-right`, which becomes a full-width bottom stack under 600px with a 16px mobile offset, at a very high z-index.
- The thumb bar is fixed at `bottom: 4rem + safe-area`, with its "Different / Skip" row roughly 80–128px from the bottom.
- `TOAST_MERGED` quotes two business names and wraps to two or three lines (about 80–100px). That puts it over the lower action row for its roughly 4s lifetime, which is exactly when the reviewer reaches for the next pair.
- I have not measured this on the built app. It is inferred from sonner's defaults and the bar's geometry.

**Fix:**
- Verify with a 390×844 screenshot of the built app, per Rule 8.
- Then set `<Toaster position="top-center" />`, or `mobileOffset={{ bottom: 'calc(4rem + env(safe-area-inset-bottom) + <bar height>)' }}` on `/review`.

## Info

### C-IN-01: The bad-id copy was never wired up: a malformed id shows "No business with that id"

**File:** `src/app/(app)/businesses/[id]/page.tsx:103`, `not-found.tsx:30`

UI-SPEC § Error gives a malformed id its own sentence (`BUSINESS_BAD_ID`: "the lead key is for reading aloud, not for the address bar"). That constant is referenced by no file. `isUuid` failing calls `notFound()`, which renders `BUSINESS_NOT_FOUND`.

A malformed segment reveals nothing about existence, so T-3-09 does not require collapsing the two. That matters because pasting `SL-7F3K2` into the URL is the likely mistake. **Fix:** pass a flag (for example, render an inline `Empty` with `BUSINESS_BAD_ID` instead of calling `notFound()` when `!isUuid(id)`), or record the divergence in the spec.

### C-IN-02: The header's "merged into" link can read "X merged into X"

**File:** `src/components/business-detail/detail-header.tsx:76-84`

`MERGE_ROW(displayName, mergedInto.displayName)` repeats the 03-22 defect that `merge-history.tsx` fixed with `MERGE_SIDE(key, source)`: after survivorship both names are often equal. **Fix:** name the survivor by its lead key, using `MERGE_SIDE`.

### C-IN-03: Duplicate formatters that disagree

**Files:**
- `src/lib/ui/review-format.ts:58-63, 70-73`
- `src/components/business-detail/fields-and-sources.tsx:74-76`
- `src/app/(app)/businesses/page.tsx:123`
- `src/app/(app)/businesses/[id]/page.tsx:139`

`formatCount` exists twice, in `lib/time.ts` and `review-format.ts`, and both routes build a third `Intl.NumberFormat`. There are also two phone formatters:
- `displayPhone` parses with default region `'US'`.
- `phoneDisplay` parses with no default region.

So a stored value lacking `+1` is formatted on `/review` but shown raw on the detail page. Rule 26 names a single phone formatter. **Fix:** keep one `formatCount` (in `lib/time`) and one `displayPhone`, and import them everywhere.

### C-IN-04: User-facing strings outside `copy.ts` (Rule 5)

These literals live in component or route files:
- `[id]/page.tsx:143`: "in the RGV"
- `fields-and-sources.tsx:150,153`: "Issued", "First sales"
- `source-records.tsx:28-32`: `RECORD_LABEL`
- `confidence-distribution.tsx:60`: "No confidence"
- `copy-command-button.tsx:24-26`: "Copied: …"
- `source-ledger.tsx:218`: `UNRECORDED_ERROR`
- `top-bar.tsx:30`: "Open navigation"

Several are self-documented as "copy gaps". **Fix:** move them into `copy.ts` now that the phase owns that file again.

### C-IN-05: `app-sidebar.tsx` is a `"use client"` module that exports data

**File:** `src/components/app-shell/app-sidebar.tsx:74, 105, 133, 136`

`LEADS_NAV`, `OPERATIONS_NAV`, `NAV_ITEMS` and `isNavActive` are exported from a client module. Every current importer is client-side (checked with grep), so this is not a live bug. It is, however, the exact trap Rule 5 describes: the first server component that imports `NAV_ITEMS` (a breadcrumb, a sitemap) gets `undefined` with every gate green. **Fix:** move the nav tables and `isNavActive` to a server-safe `src/lib/ui/nav.ts`. The `Icon` component references are fine in a shared module.

### C-IN-06: The unmerge dialog uses `disabled` while pending, so focus drops to `<body>` inside a modal

**File:** `src/components/business-detail/unmerge-dialog.tsx:181, 200`

The focused confirm button becomes `disabled`, so the browser blurs it, and Radix's FocusScope does not restore focus to a removed or disabled target. `review-actions.tsx:216-218` deliberately uses `aria-disabled` for this reason. **Fix:** use `aria-disabled` plus a guard in `onClick`, as `DecisionButton` does.

### C-IN-07: Orphaned doc comment

**File:** `src/app/(app)/businesses/[id]/page.tsx:52-53`

"Merge actors that are a Clerk user…" is attached to nothing: the next declaration, `sourceTagOf`, has its own comment. It is left over from an edit. **Fix:** move it onto `clerkUserIds` or delete it.

### C-IN-08: Skipping the last remaining pair is a visible no-op

**File:** `src/components/review/review-actions.tsx:100-106`, with ordering in `src/server/queries/review-queue.ts:162`

With one pending pair, Skip records `skipped_at`, `router.refresh()` returns the same `candidateId`, and nothing changes: no animation, no focus move, no toast, same count. That is indistinguishable from a dropped tap. **Fix:** when `decision === 'skip'` and the refreshed id equals the old one, show a quiet toast. Or render `REVIEW_SKIP_HELPER` (see C-WR-06) so the behaviour is explained.

### C-IN-09: The cluster Select shows a blank trigger for a URL cluster it has no option for

**File:** `src/components/business-list/business-filters.tsx:97, 246-266`

`urlCluster` is taken raw from the URL. The server ignores a key that fails `CLUSTER_KEY` (treating it as "any"), but the client still binds `value="Foo!"`. Radix Select then renders an empty trigger, not "Any cluster". The same happens before the cluster promise resolves, or for good if the list read failed (options stay `[]`). **Fix:** fall back to `ANY` when `urlCluster` is neither `ANY`/`NO_CLUSTER` nor present in `clusterOptions` once they have loaded. While loading, render the option label from the URL, not a blank.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), slice C_
_Depth: standard_
