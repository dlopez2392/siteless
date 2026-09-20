# Architecture Research

**Domain:** Multi-source local-business discovery + web-presence verification SaaS (lead generation)
**Researched:** 2026-09-20
**Confidence:** HIGH on platform limits, Google ToS, and unit costs (official docs). MEDIUM on the composed architecture (synthesis of standard patterns + verified primitives). LOW/flagged where noted.

---

## The one finding that shapes everything

Google's Maps Platform Terms prohibit using Maps Content to "create or augment your own mapping-related dataset ... including a mapping or navigation dataset, **business listings database, mailing list, or telemarketing list**." Caching of Places content is disallowed "except as expressly permitted"; the **`place_id` is the single field exempt from the caching restriction and storable indefinitely**, and lat/lng may be cached for **30 consecutive calendar days**.

A naive build — "call Places, INSERT the response into `businesses`, sell the leads" — is the exact shape the clause names. The architecture below is built so that the *legal* structure and the *good engineering* structure are the same structure:

- **Google is a detector, not a store.** Places responses land in a TTL'd, auto-purged cache. The only durable Google artifact is `place_id`.
- **The canonical business record is sourced from non-Google data** — Overture (CDLA-Permissive 2.0), TX Comptroller (public record), OSM, and the business's own website/social pages found by your own verification pass. A database constraint enforces that every durable field cites a durable source.
- **Receipts are your own content.** "I called Places at 03:14 CT and the response for `place_id X` had no `websiteUri`" is an observation of your own API call. That is the product, and it is safe to keep.

This is not a compliance footnote bolted on later. It reorders the roadmap: the free-data ingest is a *prerequisite* for having a durable record at all, not an enrichment nice-to-have.

> ⚠️ **Flag for danlo (LOW confidence, needs a human call):** whether a *derived verdict* over Places content ("Places had no website for this place_id") is itself "Content" is a grey area. The design keeps you on the safe side of every clause that is unambiguous. Get a 30-minute legal read before the first paid outreach, not before the first commit.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                                  │
│  ┌────────────────────────┐      ┌────────────────────────────────────┐  │
│  │ Triage PWA (mobile)    │      │ Desk app (Next.js RSC)             │  │
│  │ offline outbox, tel:   │      │ searches, deep dive, dashboard     │  │
│  └───────────┬────────────┘      └──────────────┬─────────────────────┘  │
├──────────────┴────────────────────────────────── ┴───────────────────────┤
│  EDGE / API  (Next.js App Router on Vercel, Clerk-authenticated)          │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌────────────────┐  │
│  │ Triage API   │ │ Search admin │ │ Cron tick     │ │ Sync relay     │  │
│  │ (idempotent) │ │              │ │ (CRON_SECRET) │ │ (outbox drain) │  │
│  └──────┬───────┘ └──────┬───────┘ └───────┬───────┘ └───────┬────────┘  │
├─────────┴────────────────┴─────────────────┴─────────────────┴───────────┤
│  ORCHESTRATION  (Vercel Workflows — durable, resumable, no run cap)       │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ run-search workflow:  plan tiles → enumerate → resolve → verify →   │  │
│  │                       classify → score → surface                    │  │
│  │ every step: reserve budget → call → settle → write receipt          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│  DOMAIN SERVICES  (pure-ish TypeScript modules, unit-testable)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Source   │ │ Entity   │ │ Verifi-  │ │Classifier│ │ Scorer        │  │
│  │ Adapters │→│Resolution│→│ cation   │→│ (pure,   │→│ (pure,        │  │
│  │ (5)      │ │ (dedupe) │ │ Workers  │ │versioned)│ │ versioned)    │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│       │            │            │            │              │            │
│  ┌────┴────────────┴────────────┴────────────┴──────────────┴────────┐   │
│  │ Budget Governor — reserve / settle / price book / cost ledger     │   │
│  └───────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│  DATA  (Supabase Postgres, RLS on every tenant table, org_id everywhere)  │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ │
│  │businesses│ │source_records│ │verifications│ │ leads    │ │cost_     │ │
│  │(durable) │ │(durable |    │ │+ receipts   │ │+ actions │ │ledger    │ │
│  │          │ │ ephemeral30d)│ │(append-only)│ │+feedback │ │(append)  │ │
│  └──────────┘ └──────────────┘ └────────────┘ └──────────┘ └──────────┘ │
│  pg_cron: purge expired Google payloads · sweep stale reservations        │
├──────────────────────────────────────────────────────────────────────────┤
│  EXTERNAL                                                                 │
│  Places API(New)·Firecrawl·Overture(S3)·TX Comptroller·OSM·Yelp?·BIS CRM  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Boundary rule (what it may NOT do) | Typical implementation |
|-----------|----------------|-------------------------------------|------------------------|
| **Source adapters** | Turn one external source into `source_records` rows with provenance + a cost estimate | May not write `businesses`, may not classify, may not decide budget | One module per source implementing a single `SourceAdapter` interface |
| **Normalizer** | Name/phone/address/geo → comparable canonical forms | Pure. No I/O, no DB | `src/lib/normalize/*` — the most-unit-tested code in the repo |
| **Entity resolution** | Block, score, merge `source_records` into one `businesses` row; keep merges reversible | May not call external APIs; may not delete a losing row | SQL blocking keys + pg_trgm + a weighted scorer |
| **Verification workers** | Gather *evidence* about web presence and write immutable receipts | **May not decide the verdict.** May not spend without a reservation | `web_search`, `http_probe`, `dns_probe`, `parked_detect`, `social_detect` |
| **Classifier** | Pure function: receipts → one of 5 verdicts + confidence + rule that fired | No I/O. No spending. No randomness. No LLM in v1 | Ordered rule table, `classifier_version` stamped on every output |
| **Scorer** | Pure function: business + classification + signals → 0-100 + components | Same as classifier | `score_version` stamped; components stored for the "why" panel |
| **Budget governor** | Atomically reserve, then settle, every unit of external spend against a monthly cap | Nothing spends money without going through it | Two Postgres functions + an append-only ledger |
| **Scheduler** | Decide which searches are due in *local* time, start one durable run each, exactly once per local date | May not do the work itself; may not exceed 10s | Vercel Cron → tiny tick route → `start(runSearch)` |
| **Run orchestrator** | Durable, resumable execution of a run's stages, with batched steps | May not fan out one step per business | Vercel Workflow `'use workflow'` |
| **Triage API** | Org-scoped read of the queue; idempotent accept/reject/snooze | May not call BIS inline | Route handlers + Supabase `userDb` (RLS applies) |
| **PWA** | Offline-tolerant triage, tap-to-call, receipts one tap away | May not be the source of truth for state | Next.js App Router + Serwist SW + IndexedDB outbox |
| **CRM sync** | At-least-once delivery of accepted leads to BIS with an idempotency key | May not run inside the user's request | Transactional outbox + `FOR UPDATE SKIP LOCKED` relay |
| **Observability** | `runs` stats, cost-per-verified-lead, FP rate, source contribution | — | `runs` + `events` tables + Vercel Workflow traces |

---

## Data Model Sketch

Naming convention carried from BIS's scar tissue: **`name_internal` is the operator's label, `display_name` is what a human could ever see.** Never one column for both.

### Tenancy spine (mirrors BIS `0001_tenancy.sql`)

```sql
orgs(id, clerk_org_id text unique, name_internal, display_name, created_at)
users(id, clerk_user_id text unique, email, name)
memberships(id, org_id, user_id, role check in ('admin','member'))
events(id bigint identity, org_id, type, actor_type, actor_id, payload jsonb, created_at)  -- APPEND-ONLY
```

### Search definition (reference rows are global; `org_id IS NULL` = built-in)

```sql
industry_clusters(id, org_id NULL, key, label, ticket_band, default_place_types text[])
industry_terms(id, org_id NULL, cluster_id, term, google_place_type)
geo_presets(id, org_id NULL, name, kind in ('city_list','county','radius'),
            cities text[], county_fips, center geography(Point), radius_m,
            bbox geography(Polygon))
searches(id, org_id, name_internal, display_name, cluster_ids uuid[], geo_preset_id,
         schedule_cron, timezone default 'America/Chicago', enabled,
         monthly_cap_micro_usd, created_by, created_at)
search_tiles(id, org_id, search_id, geohash text, bbox geography, place_type,
             last_enumerated_at, result_count, saturated bool)
```

`org_id IS NULL` is how "RGV presets ship built-in" and "every table carries org_id" coexist. The RLS read policy is `org_id is null or org_id = app.current_org_id()`; the write policy is `org_id = app.current_org_id()`, so nobody can mutate a built-in.

### Runs

```sql
runs(id, org_id, search_id, local_date date, trigger in ('cron','manual','backfill'),
     status, started_at, finished_at, error, stats jsonb, cost_micro_usd, workflow_run_id)
create unique index runs_one_cron_per_local_date
  on runs (search_id, local_date) where trigger = 'cron';   -- cron double-fire guard
```

### Sources and raw payloads — where the ToS lives in the schema

```sql
source_records(
  id, org_id, source_key,            -- google_places | overture | osm | tx_comptroller
                                     -- | county_dba | yelp | firecrawl | http_probe | dns_probe
  external_id text,                  -- place_id | GERS id | taxpayer number | osm id | url
  business_id uuid null,             -- set after entity resolution
  payload jsonb, payload_hash,
  retention_class text check (retention_class in ('durable','ephemeral')),
  fetched_at, expires_at, run_id,

  constraint sr_ephemeral_has_expiry
    check ((retention_class = 'ephemeral') = (expires_at is not null)),
  constraint sr_google_is_ephemeral
    check (source_key <> 'google_places' or retention_class = 'ephemeral'),
  constraint sr_durable_uniq unique (id, retention_class)     -- enables the FK trick below
);
create index sr_expiry on source_records (expires_at) where expires_at is not null;

google_place_refs(id, org_id, business_id, place_id text, first_seen_at, last_seen_at,
                  last_observed_no_website_at,
                  unique (org_id, place_id));                  -- DURABLE. place_id only.
```

`sr_google_is_ephemeral` makes the Google retention rule a database invariant rather than a code convention somebody forgets in month four. A pg_cron job deletes `where expires_at < now()` nightly — set the TTL to **21 days, not 30**, so a missed purge run is not a breach.

### Canonical business — provenance as a constraint

```sql
businesses(
  id, org_id, display_name, name_norm,
  phone_e164, addr_line, addr_norm, city, county, state, postal,
  location geography(Point), gers_id text, industry_cluster_id,
  status in ('active','merged','closed'), merged_into_id,
  first_seen_at, last_seen_at,

  name_source_id uuid, phone_source_id uuid, addr_source_id uuid, location_source_id uuid,
  name_src_ret text generated always as ('durable') stored,
  -- …one generated column per provenance FK…
  foreign key (name_source_id, name_src_ret) references source_records(id, retention_class),
  foreign key (phone_source_id, phone_src_ret) references source_records(id, retention_class)
  -- etc.
);
```

That composite-FK trick is the whole compliance story in six lines: **a durable field can only cite a durable source record.** If the only thing that knows this roofer's phone number is a Google payload, the column stays NULL and the UI shows "phone from Google, not stored" — or you get it from Comptroller/Overture/the business's own site and it becomes durable.

```sql
business_aliases(id, org_id, business_id, source_key, external_id, name_seen, confidence)
merge_candidates(id, org_id, a_id, b_id, score numeric, features jsonb,
                 decision in ('pending','merged','distinct'), decided_by, decided_at)
business_merges(id, org_id, winner_id, loser_id, reason, merged_by, merged_at, undone_at)
```

Merges are rows, never deletes. The false-positive loop needs to unmerge.

### Verification and receipts — append-only, the product's trust anchor

```sql
verification_jobs(id, org_id, business_id, run_id, kind, priority int,
                  state in ('queued','claimed','done','failed'),
                  claimed_at, claim_expires_at, attempts, next_attempt_at, last_error)

verifications(id, org_id, business_id, run_id, kind, started_at, finished_at,
              outcome jsonb, cost_micro_usd, reservation_id)              -- APPEND-ONLY

receipts(id, org_id, verification_id, business_id, kind,
         url, final_url, http_status, redirect_chain jsonb, dns_answer jsonb,
         matched_signals text[], evidence_text, captured_at)              -- APPEND-ONLY

classifications(id, org_id, business_id,
                classification in ('no_presence','social_only','directory_only',
                                   'real_site','dead_or_parked'),
                confidence numeric, classifier_version text, rule_key text,
                input_receipt_ids uuid[], decided_at)                     -- APPEND-ONLY
```

Append-only is enforced the way BIS enforces it on `events`: select/insert policies only, plus `revoke update, delete on … from authenticated`. A mutable receipt is worthless on a sales call.

### Leads, feedback, evaluation

```sql
lead_scores(id, org_id, business_id, score int, score_version, components jsonb, computed_at)
leads(id, org_id, business_id, search_id, first_surfaced_run_id,
      state in ('new','accepted','rejected','snoozed','synced','false_positive'),
      snoozed_until, assigned_to, current_classification_id, current_score_id, updated_at,
      unique (org_id, business_id))
lead_actions(id, org_id, lead_id, user_id, action, client_action_id uuid, note, created_at,
             unique (org_id, client_action_id))        -- the offline-replay idempotency key
lead_feedback(id, org_id, lead_id, business_id,
              kind in ('has_site','wrong_phone','closed','duplicate'),
              evidence_url, note, created_by, created_at)
evaluation_labels(id, org_id, business_id, label, source in ('human','spot_check'),
                  receipts_snapshot jsonb, labeled_at)   -- the classifier's regression set
```

### Sync

```sql
sync_targets(id, org_id, key, base_url, secret_ref, enabled)
sync_events(id, org_id, lead_id, target_key, kind, payload jsonb,
            state in ('pending','in_flight','delivered','failed'),
            attempts int, next_attempt_at, last_status, last_response,
            idempotency_key uuid unique, created_at, delivered_at)
```

### Cost

```sql
source_price_book(id, org_id NULL, source_key, sku, unit, micro_usd_per_unit,
                  effective_from, effective_to)        -- price changes never rewrite history
budget_periods(id, org_id, period_start date, period_end date,
               cap_micro_usd bigint, reserved_micro_usd bigint, spent_micro_usd bigint,
               hard_stop bool default true, unique (org_id, period_start))
cost_reservations(id, org_id, budget_period_id, run_id, source_key, sku,
                  est_micro_usd bigint, expires_at, settled_at)
cost_ledger(id, org_id, budget_period_id, run_id, verification_id, source_key, sku,
            units numeric, micro_usd bigint, request_id text unique, occurred_at)  -- APPEND-ONLY
```

**Integer micro-USD, never floats.** `request_id` unique makes settlement idempotent under retry.

### RLS strategy

Mirror BIS exactly — it is already proven against Clerk, and the test harness ports over:

```sql
create schema app;

create or replace function app.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.orgs
   where clerk_org_id = coalesce(app.jwt()->'o'->>'id', app.jwt()->>'org_id')
$$;

grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;
alter default privileges in schema app grant execute on functions to authenticated, anon, service_role;
```

Five rules, each earned:

1. **`coalesce(jwt->'o'->>'id', jwt->>'org_id')`.** Clerk session-token **v2** (the default for a new 2026 app) nests org claims under `o` as `{"o":{"id":"org_…","rol":"admin","slg":"…"}}`. BIS reads the flat v1 `org_id`. Copying BIS's helper verbatim into a new Clerk app yields NULL → `current_org_id()` NULL → every policy false → **zero rows with no error**. This is the single highest-probability silent failure in the whole build.
2. **`grant usage on schema app`** to every role. Without it, policies raise "permission denied for schema app" instead of evaluating. BIS learned this in its isolation suite (migration `0002`).
3. **Wrap helpers in `(select …)`** — `using (org_id = (select app.current_org_id()))`. Postgres runs it as an initPlan and caches per statement instead of per row.
4. **Every index leads with `org_id`.** `(org_id, …)` composite, always.
5. **Workers use the service role and still set `org_id` on every write.** RLS is the backstop for user-facing paths, not the writer's memory. And per BIS's hardest lesson: *service-role test fixtures are blind to column grants.* Port `withRollback` + `actAs` (set `request.jwt.claims`, `set local role authenticated`) from `bis-platform/packages/db/src/test/db.ts` in the very first data phase — including the v2 claim shape `{"o":{"id":"org_…"}}`.

**PostGIS gotcha:** `create extension postgis with schema extensions` — never into `public`, or `spatial_ref_sys` is exposed through the Data API.

---

## Data Flow

### End to end

```
 Vercel Cron (UTC, best-effort, may double-fire, never retries)
        │  GET /api/cron/tick   Authorization: Bearer CRON_SECRET
        ▼
 [tick]  for each enabled search:
         local_date = now() in search.timezone          ← NOT the UTC date
         insert runs(search_id, local_date, 'cron') on conflict do nothing
         if inserted → start(runSearch, {runId})        ← returns immediately
        │
        ▼
 ┌─ Vercel Workflow: runSearch ─────────────────────────────────────────────┐
 │                                                                           │
 │ step planTiles      geo_preset → tiles (geohash × place_type)             │
 │       │                                                                   │
 │ step enumerate[b]   ── reserve ─→ Places Text Search (Enterprise mask)    │
 │       │              ← settle ──  ≤20 places/call, ≤60/query, pageToken   │
 │       │              writes source_records(google_places, ephemeral, +21d)│
 │       │              writes google_place_refs(place_id)  ← durable        │
 │       │                                                                   │
 │ step corroborate    Overture + Comptroller + OSM (already bulk-loaded)    │
 │       │              writes source_records(durable)                        │
 │       │                                                                   │
 │ step resolve[b]     normalize → block → score → upsert businesses         │
 │       │              durable fields cite durable sources (FK-enforced)    │
 │       │              ambiguous pairs → merge_candidates (human review)    │
 │       │                                                                   │
 │ step enqueueVerify  candidates = no websiteUri ∧ not already verified     │
 │       │                          ∧ predicted score ≥ threshold            │
 │       │              insert verification_jobs                              │
 │       │                                                                   │
 │ step verify[b]      claim N jobs  FOR UPDATE SKIP LOCKED                  │
 │       │  ┌────────── cheapest-first ladder, short-circuit on decisive ───┐│
 │       │  │ 0. free: Overture websites[]/socials[], OSM website tag   $0  ││
 │       │  │ 1. free: DNS + HTTP probe of any URL already known        $0  ││
 │       │  │ 2. paid: Firecrawl search "<name>" "<city>" TX        ~$0.006 ││
 │       │  │ 3. paid: fetch/scrape each candidate URL             ~$0.003 ││
 │       │  │ 4. free: parked/placeholder/social classification of the above││
 │       │  └───────────────────────────────────────────────────────────────┘│
 │       │              every probe → verifications + receipts (append-only) │
 │       │              every paid probe → reserve → call → settle → ledger  │
 │       │                                                                   │
 │ step classify       PURE. receipts → verdict + confidence + rule_key      │
 │ step score          PURE. → lead_scores                                   │
 │ step surface        upsert leads(state='new'); stats → runs               │
 └───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 Triage PWA  ── GET /api/triage (RLS-scoped)  → IndexedDB prefetch
              ── accept/reject/snooze, offline → IndexedDB outbox
              ── Background Sync replay, each carrying client_action_id (UUID)
        │
        ▼
 [accept] ONE transaction:  leads.state='accepted'
                          + lead_actions(client_action_id)          ← idempotent
                          + sync_events(idempotency_key)            ← outbox
        │
        ▼
 Relay (cron */5)  claim FOR UPDATE SKIP LOCKED → POST BIS /api/inbound-lead
                   Idempotency-Key: sync_events.id
                   2xx → delivered · 4xx → failed (no retry) · 5xx/timeout →
                   attempts++, next_attempt_at = now() + backoff(attempts) + jitter
```

### The false-positive feedback loop

This is the product's core value, so it gets its own flow — and it is *cheap* only because evidence and verdict are separate components.

```
 Human in triage: "actually has a site"  →  lead_feedback(kind='has_site', evidence_url)
        │
        ├─→ leads.state = 'false_positive'   (immediately out of the queue)
        │
        ├─→ verification_jobs(priority=HIGH, kind='http_probe', url=evidence_url)
        │       → receipts row proving the site exists   ← evidence, not opinion
        │       → classifications row (classifier_version, rule_key='human_override')
        │
        ├─→ evaluation_labels(business_id, label='real_site', receipts_snapshot)
        │
        ▼
 Nightly: fp_rate per (classifier_version × source × industry × city) → dashboard
        │
        ▼
 Classifier v2 proposed
        │
        ▼
 REPLAY v2 over every evaluation_labels row's stored receipts.   $0 spent.
 Promote only if fp_rate improves and no previously-correct label regresses.
```

**The replay costs nothing** because `classifications` is a pure function of `receipts`, and receipts are durable and immutable. If you instead let the classifier decide *while* fetching (the obvious shortcut), every classifier change requires re-crawling — and on a $50/month budget you would simply never tune it. Separating evidence-gathering from verdict-rendering is the single design decision that makes the measured-false-positive-rate promise affordable.

---

## Architectural Patterns

### Pattern 1: Uniform Source Adapter with a cost estimate in the interface

**What:** every source implements the same shape, and `estimateCost` is part of the contract so the budget governor can reserve *before* anything is called.
**When:** all five sources, including the free ones (they return `0n`).
**Trade-offs:** slightly awkward for bulk-file sources (Overture/Comptroller run in CI, not on Vercel) — model those as a separate `BulkLoader` interface rather than bending `SourceAdapter` around them.

```typescript
// src/server/sources/types.ts
export interface SourceAdapter<Q, R> {
  readonly key: SourceKey;
  readonly retention: 'durable' | 'ephemeral';
  readonly ephemeralTtlDays?: number;              // required when retention==='ephemeral'
  estimateCost(query: Q): { sku: string; units: number; microUsd: bigint };
  fetch(query: Q, ctx: FetchCtx): Promise<SourceResult<R>>;   // returns raw payloads + actual units
  toRecords(result: SourceResult<R>): SourceRecordDraft[];
}
```

Prompt rules are wishes; tool contracts are enforcement. Making `estimateCost` mandatory means a new adapter *cannot* be written that spends money outside the meter.

### Pattern 2: Reserve → call → settle (race-free cap, no advisory lock)

**What:** a single conditional `UPDATE` on one row per org per month is the entire concurrency control.
**When:** every external call that costs anything.
**Trade-offs:** serializes all spending for one org on one row. At our volume (thousands of calls/month) that is free; at 10k+ concurrent writers you would shard the counter.

```sql
create or replace function app.reserve_budget(
  p_org uuid, p_period date, p_micro bigint,
  p_run uuid, p_source text, p_sku text, p_ttl interval default '10 minutes'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_period uuid; v_res uuid;
begin
  update public.budget_periods
     set reserved_micro_usd = reserved_micro_usd + p_micro
   where org_id = p_org
     and period_start = p_period
     and spent_micro_usd + reserved_micro_usd + p_micro <= cap_micro_usd
  returning id into v_period;

  if v_period is null then return null; end if;            -- denied, cap would break

  insert into public.cost_reservations
      (org_id, budget_period_id, run_id, source_key, sku, est_micro_usd, expires_at)
  values (p_org, v_period, p_run, p_source, p_sku, p_micro, now() + p_ttl)
  returning id into v_res;
  return v_res;
end $$;
```

**Why this cannot race** (verified against the PostgreSQL manual, READ COMMITTED):

> "If the first updater commits, the second updater … will attempt to apply its operation to the updated version of the row. **The search condition of the command (the `WHERE` clause) is re-evaluated to see if the updated version of the row still matches the search condition.**"

So a concurrent reserver blocks on the row lock, then re-checks `spent + reserved + n <= cap` against the *committed new* value. Zero rows returned = denied. No `SELECT` then `UPDATE`, no advisory lock, no SERIALIZABLE retry loop.

Settlement is a separate idempotent function: insert `cost_ledger` with `on conflict (request_id) do nothing`, and only if a row was actually inserted, move `reserved → spent` and stamp `cost_reservations.settled_at`. A pg_cron sweeper releases reservations past `expires_at` with `settled_at is null` (a crashed worker must not permanently consume budget).

**Estimate the worst case.** Reserve the full SKU price for a Text Search even though a page might return 3 results; settle down to actual. Under-reserving is the only way to breach the cap.

### Pattern 3: Evidence / verdict separation (the replayable classifier)

**What:** workers write receipts and *never* set a classification. A pure, versioned function reads receipts and emits a classification.
**When:** always. This is the load-bearing pattern.
**Trade-offs:** one extra table and one extra pass. Buys free re-classification, a real regression suite, and an auditable "why" for every lead.

```typescript
// src/server/classify/v1.ts  — pure, no imports from db/ or sources/
export const CLASSIFIER_VERSION = 'v1.3.0';

export function classify(receipts: Receipt[]): Classification {
  // ordered rules; first match wins; the rule key is stored with the verdict
  for (const rule of RULES) {
    const hit = rule.match(receipts);
    if (hit) return { classification: rule.verdict, confidence: hit.confidence,
                      ruleKey: rule.key, inputReceiptIds: hit.receiptIds,
                      classifierVersion: CLASSIFIER_VERSION };
  }
  return { classification: 'no_presence', confidence: 0.6, ruleKey: 'default_no_evidence',
           inputReceiptIds: receipts.map(r => r.id), classifierVersion: CLASSIFIER_VERSION };
}
```

Rule ladder, highest-priority first (each cites specific receipt kinds):

| Rule key | Fires when | Verdict |
|---|---|---|
| `live_own_domain` | HTTP 200, final host ∉ social/directory set, body not parked/placeholder, ≥2 internal links | `real_site` |
| `parked_ns` | authoritative NS or CNAME on a known parking provider (Sedo, Bodis, Afternic, HugeDomains…) | `dead_or_parked` |
| `parked_body` | body matches parking/for-sale/registrar-default text or ad-syndicator script | `dead_or_parked` |
| `placeholder_template` | default Wix/WordPress/GoDaddy "coming soon" markers | `dead_or_parked` |
| `dns_nxdomain` / `conn_refused` / `5xx_persistent` | domain resolves to nothing, or 3 probes over 2 runs all fail | `dead_or_parked` |
| `social_only` | ≥1 live facebook/instagram/linktr.ee page, no live own-domain site | `social_only` |
| `directory_only` | only yelp/yellowpages/GBP/nextdoor URLs found | `directory_only` |
| `default_no_evidence` | search returned nothing attributable | `no_presence` |

Parked-domain detection is best done **DNS-first**: authoritative-nameserver/IP matching against parking-service sets is reported around 92.8% accurate *without fetching the page* — which is also the cheapest probe you have. Body-text heuristics are the second pass.

### Pattern 4: Postgres as the work queue (so the claim and the reservation share a transaction)

**What:** `verification_jobs` claimed with `FOR UPDATE SKIP LOCKED` rather than an external broker.
**When:** all per-business fan-out work.
**Trade-offs:** you give up a managed broker's ergonomics. You gain the thing that actually matters here.

```sql
with claimed as (
  select id from verification_jobs
   where org_id = $1 and state = 'queued' and next_attempt_at <= now()
   order by priority desc, next_attempt_at
   for update skip locked
   limit $2
)
update verification_jobs j
   set state = 'claimed', claimed_at = now(), claim_expires_at = now() + interval '10 min',
       attempts = attempts + 1
  from claimed c where j.id = c.id
returning j.*;
```

**The argument for Postgres over Vercel Queues / pgmq here:** the budget reservation, the job claim, the receipt, and the ledger entry all want to be in one transaction. Vercel Queues is an excellent primitive (at-least-once, idempotency keys, 7-day TTL, unlimited topics) but it is **in public beta** and it lives outside your database, so "claim a job and reserve its budget atomically" becomes a two-phase problem you have to solve yourself. Since every job already writes to Postgres anyway, the queue costs one table.

Use Vercel Workflows for *orchestration* (durable, resumable, survives deploys) and Postgres for *work distribution*. That split is the recommendation.

### Pattern 5: Transactional outbox for the BIS handoff

**What:** accepting a lead writes the state change and the sync intent in one transaction; a relay delivers.
**When:** the BIS push, and any future integration.
**Trade-offs:** at-least-once, so BIS must dedupe. That is BIS's job and BIS already has contact-dedupe machinery.

```typescript
// inside one transaction — the HTTP call is NOT here
await tx.leads.update(leadId, { state: 'accepted' });
await tx.lead_actions.insert({ leadId, action: 'accept', clientActionId });
await tx.sync_events.insert({
  leadId, targetKey: 'bis', kind: 'lead.accepted',
  idempotencyKey: crypto.randomUUID(),
  payload: { /* contact fields + tags: source:siteless, industry, city, score */ },
});
```

The relay sends `Idempotency-Key: <sync_events.id>`. **Specify that header in the BIS-side endpoint contract before either side is built** — "the lead got created twice in the CRM" is the failure everyone regrets.

### Pattern 6: Offline-safe idempotent mutation

**What:** every triage action carries a client-generated UUID; the server's unique index makes replay a no-op.
**When:** all PWA writes.

```typescript
// client: queued in IndexedDB, replayed by Background Sync
const clientActionId = crypto.randomUUID();
await enqueue({ url: '/api/triage/accept', body: { leadId, clientActionId } });

// server
insert into lead_actions (org_id, lead_id, user_id, action, client_action_id)
values (…) on conflict (org_id, client_action_id) do nothing;
```

Without this, a phone that went through a dead zone in Rio Grande City double-accepts and double-pushes to BIS.

---

## Where Jobs Run

| Work | Runs on | Why there | Hard limits that bind |
|---|---|---|---|
| Nightly tick | **Vercel Cron** → route handler | 100 crons/project on every plan; simplest possible trigger | **UTC only**; Hobby = **once per day and fired anywhere within the hour**; Pro fires within the minute; **no retry on failure**; may occasionally fire twice or not at all |
| Run orchestration | **Vercel Workflow** (`'use workflow'`) | No max run duration, no max sleep, survives deploys and crashes, per-step traces in Observability | 10,000 steps and 25,000 events per run; 50 MB payload per step; 240s max replay time; Hobby retains run state 1 day, Pro 7 days |
| Per-batch fetch / verify | **`'use step'`, Node.js runtime** | Needs `node:dns`; needs real HTTP with redirect inspection | Fluid compute: Hobby 300s max, Pro 300s default / 800s max / 1800s beta; 4.5 MB request+response body |
| Work distribution | **Postgres `verification_jobs`** + `SKIP LOCKED` | Claim + budget reserve in one transaction | — |
| Bulk ingest: Overture GeoParquet, TX Comptroller `FTACT.zip` | **GitHub Actions**, monthly, DuckDB with a bbox pushdown → upsert to Supabase | Multi-GB files blow the 250 MB bundle and the function memory ceiling; this is offline batch work, not request-response | Runner disk/time; keep the bbox tight (RGV first) |
| Retention purge, reservation sweep, FP-rate rollup | **Supabase `pg_cron`** | Pure SQL, no network, no function invocation, cannot be skipped by a Vercel cron miss | — |
| Outbox relay | **Vercel Cron every 5 min** → relay route | Small, idempotent, bounded | Same as cron above |

**Three cron facts that will bite if ignored:**

1. **Vercel cron is UTC-only.** "Nightly at 2am RGV" is `0 8 * * *` in winter and `0 7 * * *` in summer. Do **not** chase DST in the cron expression — schedule the tick hourly (Pro) or at a fixed UTC hour, and let the *handler* compute `local_date` in `America/Chicago` and skip if a run for that local date already exists. The partial unique index on `runs(search_id, local_date) where trigger='cron'` is the whole DST defence.
2. **Cron never retries and may double-fire.** The tick must be idempotent reconciliation ("start runs for every search whose local_date has no run yet"), never "do tonight's work".
3. **Hobby fires anywhere within the hour and only once a day.** If the nightly window matters, that alone justifies Vercel Pro — which you also need for >300s steps and 7-day workflow retention.

---

## Cost Model (drives the cap, and the cap drives the schedule)

Verified unit prices, 2026-09:

| Source | SKU | Price | Free allowance | Yield |
|---|---|---|---|---|
| Places API (New) | Text Search **Essentials (IDs Only)** | **$0, unlimited** | — | place_ids only — no `websiteUri` |
| Places API (New) | Text Search **Pro** | $32 / 1K | 5,000 / mo (Pro tier) | name, address, location, types, businessStatus |
| Places API (New) | Text Search **Enterprise** | $35 / 1K | 1,000 / mo (Enterprise tier) | **+ `websiteUri`, `nationalPhoneNumber`, `rating`, `userRatingCount`** |
| Places API (New) | Place Details **Enterprise** | $20 / 1K | 1,000 / mo | one place |
| Places API (New) | Place Details **Essentials** | $5 / 1K | 10,000 / mo | one place, basic fields |
| Firecrawl | search | 2–10 credits / 10 results | 1,000 credits/mo free; Hobby $16 → 5,000 | ~$0.006–0.032 / search |
| Firecrawl | scrape | 1 credit / page | same pool | ~$0.003 / page |
| Overture, OSM, TX Comptroller | bulk | **$0** | — | enumeration + durable provenance |
| Yelp Fusion | business search | ~$8–15 / 1K, **no free tier since 2024** | — | defer; see below |

Three consequences the roadmap should absorb:

1. **`websiteUri` — the entire primary signal — is an Enterprise-SKU field.** There is no cheap way to ask "does this business have a website" from Google.
2. **Text Search Enterprise is ~11× cheaper *per business* than enumerate-then-detail.** One $0.035 call returns up to 20 places *with* `websiteUri`, `rating`, `userRatingCount`, and phone → **~1,750 µUSD per business**. Place Details Enterprise is $0.020 **per business** → 20,000 µUSD. Enumerate with a fat Text Search field mask; reserve Place Details for refreshing a single known `place_id`.
3. **Verification, not discovery, is the budget.** Fully verifying one business ≈ 1,750 (Places share) + ~6,400 (one web search) + ~6,400 (two page fetches) ≈ **~14,500 µUSD ≈ $0.0145**. At $50/month all-in — minus $16 if you take Firecrawl Hobby — that is roughly **2,300–3,400 fully verified businesses per month**, which comfortably covers the RGV and makes "cost per verified lead" a headline number that is actually ~1.5¢.

That arithmetic is why the verification ladder must short-circuit: every business resolved for free by Overture's `websites[]`/`socials[]` array or a DNS probe is 12,800 µUSD that buys another business. And it is why `search_tiles` tracks saturation — re-enumerating a tile that returned the same 20 places last night is pure waste.

**Yelp:** paid-only since 2024, no free tier, and its unique coverage overlaps Overture (which already ingests Meta/Microsoft/Foursquare data and carries a `socials` array). **Defer Yelp to a later milestone** and make the decision on measured coverage gap, not on the assumption that Yelp-only businesses are invisible otherwise.

---

## Entity Resolution: normalize → block → score → merge

Do not attempt fuzzy matching across all pairs: 22,000 records is 242M comparisons per pass. Blocking is not an optimization, it is the algorithm.

**Normalize** (pure functions, the most-tested module in the repo):
- name → lowercase, strip diacritics, strip punctuation, strip legal suffixes (`llc|inc|co|ltd|corp`) and generic trade words, collapse whitespace
- phone → E.164 (`+1` + 10 digits); reject non-US and 555 ranges
- address → leading street number + normalized street (`st`≡`street`, `ste`≡`suite`), + ZIP5
- geo → `ST_GeoHash(location, 6)` (≈1.2 km cell) — PostGIS, no extra extension

**Block** on generated, indexed columns (a pair must share ≥1 key to be compared):

| Key | Definition | Catches |
|---|---|---|
| `bk_phone` | E.164 digits | the strongest single signal |
| `bk_gers` | Overture GERS id | free, stable across monthly releases |
| `bk_place` | Google `place_id` | durable and exact |
| `bk_addr` | `street_number \|\| '|' \|\| postal` | same storefront, different name spelling |
| `bk_geoname` | `geohash6 \|\| '|' \|\| left(name_norm, 4)` | same name, nearby, no phone |

Plus a `gin (name_norm gin_trgm_ops)` index for similarity *within* a block. pg_trgm has been reported at ~99% recall / ~99% precision on exactly this problem in pure SQL — no ML, no vector store.

**Score** with explicit weights (phone exact ≫ address exact > name trigram > geo distance > category agreement), store the feature vector in `merge_candidates.features`. Three bands: auto-merge, human review, distinct. **Start the auto-merge threshold conservatively high** — an over-merge silently destroys a lead and is much harder to notice than a duplicate.

**Merge** by writing `business_merges` and setting `status='merged', merged_into_id`. Never delete. The false-positive loop and the "duplicate" feedback kind both need to unmerge.

---

## Recommended Project Structure

**One Next.js app, not a pnpm monorepo.** BIS is a monorepo because it has multiple deployables; Siteless has one. A single root removes the entire class of "wrong workspace cwd" failure that has cost real commits and gate runs — and the build has to be drivable from a phone, where `cd` mistakes are least recoverable.

```
prospector/
├── supabase/migrations/            # 0001_tenancy.sql, 0002_app_grants.sql, …
├── src/
│   ├── app/
│   │   ├── (app)/                  # Clerk-protected
│   │   │   ├── triage/             # mobile-first; the only client-heavy route
│   │   │   ├── searches/           # setup + presets (desk)
│   │   │   ├── leads/[id]/         # deep dive + receipts drawer
│   │   │   └── dashboard/          # cost/verified-lead, FP rate, coverage
│   │   └── api/
│   │       ├── cron/tick/route.ts        # CRON_SECRET-gated, <10s, idempotent
│   │       ├── cron/relay/route.ts       # outbox drain
│   │       ├── triage/[action]/route.ts  # idempotent on client_action_id
│   │       └── webhooks/clerk/route.ts   # org/user mirror into orgs/users
│   ├── server/
│   │   ├── db/            # userDb(token) | serviceDb(); one module per table group
│   │   ├── sources/       # types.ts + google-places.ts overture.ts tx-comptroller.ts
│   │   │                  # osm.ts yelp.ts  — ONE interface, no exceptions
│   │   ├── resolve/       # normalize.ts blocking.ts score.ts merge.ts
│   │   ├── verify/        # web-search.ts http-probe.ts dns.ts parked.ts social.ts
│   │   ├── classify/      # rules/v1.ts index.ts        ← PURE, no db/ import
│   │   ├── score/         # v1.ts                        ← PURE, no db/ import
│   │   ├── budget/        # reserve.ts settle.ts price-book.ts
│   │   ├── sync/          # outbox.ts targets/bis.ts
│   │   └── workflows/     # run-search.ts ('use workflow') + steps/
│   └── lib/               # phone.ts address.ts geo.ts tz.ts  (pure, shared)
├── scripts/ingest/        # duckdb-overture.ts, comptroller.ts  — CI only, never Vercel
└── .github/workflows/     # ci.yml, ingest-overture.yml (monthly), ingest-comptroller.yml
```

**Structure rationale:**

- **`sources/` is a hard boundary.** Every adapter returns `SourceRecordDraft[]` and nothing else. No adapter imports `classify/` or writes `businesses`. This is what makes "add Yelp later" a one-file change and "prove no Google field leaked into a durable column" a reviewable question.
- **`classify/` and `score/` must not import `db/`.** Enforce it with an ESLint `no-restricted-imports` rule, not a convention. The moment the classifier can read the database, replay stops being reproducible.
- **`scripts/ingest/` is outside `src/`** so nobody accidentally bundles DuckDB into a Vercel function and hits the 250 MB limit.
- **`workflows/` colocates the `'use workflow'` module** — workflow and step names derive from file path + function name, so moving the file renames the workflow.

---

## Suggested Build Order

Dependencies are real; the ordering below is a dependency graph, not a preference.

```
 ┌─────────────────────────────────────────────────────────────┐
 │ 0. Foundations                                              │
 │    Next.js + Clerk + Supabase project + orgs/users/         │
 │    memberships + app.jwt()/app.current_org_id() (v2 claims!)│
 │    + withRollback/actAs RLS harness + CI                    │
 └───────────────┬─────────────────────────────────────────────┘
                 │  everything depends on this
     ┌───────────┴───────────┐
     ▼                       ▼
 ┌───────────────────┐  ┌─────────────────────────────────────┐
 │ 1. Budget         │  │ 2. Free-data spine                  │
 │    price book,    │  │    Overture + TX Comptroller bulk   │
 │    budget_periods,│  │    ingest (CI/DuckDB) → source_      │
 │    reserve/settle,│  │    records(durable) → normalize →    │
 │    cost_ledger,   │  │    blocking → businesses (+ the      │
 │    concurrency    │  │    provenance FK constraint)         │
 │    test           │  └──────────────┬──────────────────────┘
 └────────┬──────────┘                 │
          │  nothing may spend         │  the durable record must exist
          │  before this exists        │  before Google is called
          └───────────┬────────────────┘
                      ▼
          ┌────────────────────────────────────────┐
          │ 3. Places adapter                      │
          │    Text Search Enterprise field mask,  │
          │    source_records(ephemeral,+21d),     │
          │    google_place_refs, pg_cron purge,   │
          │    tile planner + saturation           │
          └──────────────┬─────────────────────────┘
                         ▼
          ┌────────────────────────────────────────┐
          │ 4. Verification + receipts             │
          │    job queue (SKIP LOCKED), the cheap- │
          │    est-first ladder, DNS/HTTP/parked/  │
          │    social probes, Firecrawl adapter,   │
          │    append-only receipts                │
          └──────────────┬─────────────────────────┘
                         ▼
          ┌────────────────────────────────────────┐
          │ 5. Classifier + scorer (PURE)          │
          │    5 verdicts, rule table, versions,   │
          │    replay CLI over stored receipts     │
          └──────────────┬─────────────────────────┘
                         │
      ┌──────────────────┼──────────────────────┐
      ▼                  ▼                      ▼
 ┌──────────┐   ┌──────────────────┐   ┌──────────────────┐
 │ 6. Sched-│   │ 7. Triage PWA    │   │ 9. CRM outbox    │
 │ uler     │   │    + triage API  │   │    → BIS         │
 │ cron→    │   │    offline, tel:,│   │    (needs BIS    │
 │ workflow │   │    receipts      │   │     endpoint)    │
 └────┬─────┘   └────────┬─────────┘   └──────────────────┘
      │                  ▼
      │         ┌──────────────────────────────────┐
      └────────▶│ 8. FP loop + eval set + dashboard│
                │    cost/verified-lead, FP rate    │
                └──────────────────────────────────┘
```

**Hard ordering constraints (the ones a roadmap must not reshuffle):**

1. **Budget before the first paid call.** Phase 1 precedes phase 3. Shipping the Places adapter with a "we'll add the cap later" TODO is how a nightly crawl across four clusters produces a surprise invoice. The cap is a feature of the first paid call, not of the scheduler.
2. **Free-data spine before Places.** Phase 2 precedes phase 3 — because the *durable* business record cannot legally be built from Places, so there must be somewhere for a durable name/address/phone to come from before the Google adapter has anything to attach a `place_id` to.
3. **Receipts before classifier.** Phase 4 precedes 5, and the classifier reads only from `receipts`. If they are built together the purity boundary will not survive.
4. **A manual vertical slice before the scheduler.** Run phases 1→5 end-to-end on **one city × one industry, triggered by hand**, and eyeball 50 verdicts, *before* building phase 6. The value proposition is a trustworthy verdict; the scheduler is logistics. A nightly crawl that produces confident nonsense is worse than no crawl.
5. **Triage before the FP loop.** Phase 7 precedes 8 — the loop needs human labels, and humans need a screen.
6. **The BIS endpoint is an external dependency on phase 9.** It can be specified (request shape + `Idempotency-Key` semantics) in parallel from day one, and *should* be, since it is the only piece of work that lives in another repo.

**Research-flag guidance for the roadmap:**

| Phase | Needs deeper research? | Why |
|---|---|---|
| 0 Foundations | No | BIS's `0001_tenancy.sql` is the template; only the v2 claim shape is new |
| 1 Budget | No | Pattern verified; the concurrency test is the deliverable |
| 2 Free-data spine | **Yes** | Overture has "duplicates, a high junk rate, and low property completeness"; Comptroller is entity-level not location-level. Actual RGV coverage and the confidence threshold must be measured, not assumed |
| 3 Places | Light | ToS/pricing settled here; tile-saturation tuning is empirical |
| 4 Verification | **Yes** | Parking-provider signature lists, Firecrawl's real per-search credit cost (docs say 2 *and* 10 credits/10 results in different places), and RGV-specific noise (Spanish-language names, shared strip-mall addresses) |
| 5 Classifier | **Yes** | Rule thresholds are the product. Budget a tuning loop, not a build |
| 6 Scheduler | No | Cron semantics settled above |
| 7 PWA | **Yes** (`/gsd-ui-phase`) | Offline triage UX is the design risk |
| 8 FP loop | No | Falls out of the architecture |
| 9 CRM sync | Light | Outbox is settled; the BIS contract needs agreement |

---

## Scaling Considerations

| Scale | What changes |
|---|---|
| **RGV pilot** — 1 org, 4 clusters × ~20 cities | ~20–60k businesses, ~200k source_records, ~300k receipts. Trivial for one Supabase instance. **The binding constraint is the $50 API budget, not the database.** |
| **Texas-wide** — 1 org | ~1–3M businesses. Partition `source_records` and `receipts` by month. ER must go incremental (new/changed records only, never a full re-pass). Verification becomes explicitly demand-driven: 3M × $0.0145 = $43k, so you verify only what a search surfaces *and* what pre-scores above threshold |
| **Multi-org** | Per-org `businesses` duplicates crawl cost across tenants. The fix is a shared global layer keyed on `gers_id` + `place_id` with per-org `leads` on top — **do not build it in v1**, but keep those two columns as the join keys that make it possible without a migration from hell |

**Scaling priorities, in the order they will actually bite:**

1. **API budget** (immediately). Mitigation: the free-first verification ladder, tile saturation tracking, and never re-verifying a business whose last verdict is <30 days old and unchanged.
2. **Entity-resolution pair explosion** (at ~100k businesses). Mitigation: blocking discipline; an unblocked similarity query is the query that takes down the nightly run.
3. **RLS plan quality on large tables** (at ~1M rows). Mitigation: `(select app.current_org_id())` for initPlan caching and `org_id` as the leading column of every composite index — both from day one, because retrofitting them means re-reviewing every policy.
4. **Workflow event volume** (if fan-out is per-business). Mitigation: batch. See anti-pattern 2.

---

## Anti-Patterns

### 1. Persisting Places fields in the canonical record

**What people do:** `INSERT INTO businesses (name, address, phone, rating) SELECT … FROM places_response`.
**Why it's wrong:** it is the precise shape of the prohibited "business listings database ... created or augmented" from Maps Content, and it is also just stale data you cannot refresh for free.
**Do this instead:** `place_id` in `google_place_refs` (durable), payload in `source_records` with `retention_class='ephemeral'` and a 21-day `expires_at`, durable fields sourced from Overture/Comptroller/the business's own site, with the provenance FK making it impossible to cheat. Show "Powered by Google" wherever Places-derived content is displayed.

### 2. One workflow step per business

**What people do:** `for (const biz of businesses) await verifyStep(biz)` inside the workflow.
**Why it's wrong:** 25,000 events and 10,000 steps per run are hard limits, and a normal step costs ~3 events. 5,000 businesses ≈ 15,000 events in one run — and runs over 2,000 events replay slowly, so the whole run gets progressively more expensive to resume.
**Do this instead:** batch (one step per tile, one step per 25 verifications), and use child workflows per city or per cluster. Vercel's own docs recommend child workflows to keep replay fast.

### 3. Check-then-spend budgeting

**What people do:** `const spent = await getSpent(); if (spent + cost < cap) await callApi();`
**Why it's wrong:** two workers read the same balance and both proceed. With a nightly fan-out this is not a rare race, it is the normal case.
**Do this instead:** the single conditional `UPDATE … WHERE spent + reserved + n <= cap RETURNING id`. Zero rows = denied.

### 4. An LLM as the v1 classifier

**What people do:** hand the search results to a model and ask "does this business have a website?"
**Why it's wrong:** non-deterministic (so replay proves nothing), per-lead cost on a $50 budget, and the receipt becomes "the model said so" — which is exactly the thing that does not survive a sales call where the prospect says "we've had a site since 2019."
**Do this instead:** deterministic ordered rules with a stored `rule_key`. If a model is ever added, it must write a *receipt* that the rules then consume, so the verdict stays replayable.

### 5. Calling BIS inside the accept request

**What people do:** `await updateLead(); await fetch(BIS_URL, …)`.
**Why it's wrong:** the classic dual-write. A timeout leaves the lead accepted and never synced, with no record that a send was ever owed.
**Do this instead:** outbox row in the same transaction; relay delivers with an idempotency key and visible retry state.

### 6. Trusting `websiteUri === undefined` as the verdict

**What people do:** ship "no website" the moment Places omits the field.
**Why it's wrong:** it is the false positive the whole product exists to eliminate, and it burns credibility on the first call.
**Do this instead:** absence of `websiteUri` sets `verification_jobs`, never `classifications`. Only a receipt can produce a verdict. (A `google_place_refs.last_observed_no_website_at` timestamp records the *trigger*, not the *conclusion*.)

### 7. Cron in UTC pretending to be local midnight

**What people do:** `"0 6 * * *"` and call it 1am Texas time.
**Why it's wrong:** it drifts an hour twice a year, and RGV is `America/Chicago`. Worse, "did tonight's run happen?" becomes unanswerable.
**Do this instead:** compute `local_date` in the handler; key `runs` on it; make the tick a reconciliation ("start a run for every search lacking one for its current local date"). Pin zone **and** locale in every test that touches this.

### 8. Mutable verifications

**What people do:** `UPDATE verifications SET outcome = … WHERE business_id = …` on the next run.
**Why it's wrong:** the receipt is the product. A receipt that can be silently rewritten proves nothing, and the classifier replay loses its ground truth.
**Do this instead:** append-only, with `revoke update, delete … from authenticated` as the belt to the policy's braces — the same shape BIS uses on `events`.

### 9. Deleting the losing row on merge

**What people do:** `DELETE FROM businesses WHERE id = loser_id`.
**Why it's wrong:** unmergeable, and the leads/receipts attached to the loser vanish or orphan.
**Do this instead:** `status='merged', merged_into_id` plus a `business_merges` row. Over-merging is the failure mode nobody notices; make it reversible.

### 10. Service-role tests as proof that RLS works

**What people do:** write the data-layer test suite against the service role and call the tenancy work done.
**Why it's wrong:** the service role bypasses RLS *and* is blind to column grants — the suite is green and the policy is wrong. This has already cost BIS real incidents.
**Do this instead:** port `withRollback` + `actAs` from BIS and pin the SQLSTATE (`42501` for a grant refusal, not `status >= 400`). One refused statement per `withRollback` — the first refusal aborts the transaction and the next reports `25P02`.

---

## Integration Points

### External services

| Service | Integration pattern | Gotchas |
|---|---|---|
| **Places API (New)** | REST + `X-Goog-FieldMask`; Text Search Enterprise mask for enumeration; Place Details Enterprise only for single-place refresh | Billed at the **highest** SKU any requested field belongs to — one stray field promotes the whole call. Text Search caps at 60 results over 3 pages (20/page, `pageToken`); Nearby Search caps at **20 with no pagination**, so tiling + type-splitting is mandatory. Attribution required when displaying without a Google map |
| **Firecrawl** | REST search + scrape; own app key (the Claude MCP connector is not the app's key) | Credit cost per search is documented as both 2 and 10 credits/10 results depending on retention mode — **measure it on day one and put the measured number in `source_price_book`** |
| **Overture Maps** | Monthly GeoParquet on S3; DuckDB with a bbox predicate pushdown, in CI | CDLA-Permissive 2.0. `websites[]`, `socials[]`, `phones[]`, `confidence` per place. Known duplicates and junk — filter on `confidence`. Joining to OSM may pull the result under ODbL |
| **TX Comptroller** | Monthly `FTACT.zip` (Active Franchise Taxpayer File) or data.texas.gov CSV | Entity-level, not storefront-level; mailing address ≠ business location. Good for corroboration and for DBA names, weak for geocoding |
| **OSM** | Overpass or the Overture-bundled copy | ODbL — attribution and share-alike. Prefer taking OSM *via* Overture to keep one ingest path |
| **Yelp Fusion** | REST | Paid-only since 2024 (~$8–15/1K), no free tier. **Defer**; decide on measured coverage gap |
| **Clerk** | Native Supabase third-party auth (`accessToken()` callback). JWT templates deprecated since 2025-04-01 | Session token **v2** nests org claims under `o`. `auth.uid()` is unusable (Clerk ids are strings, not UUIDs) — always `auth.jwt()->>'sub'` / the `o.id` path. Mirror org/user into `orgs`/`users` via a Clerk webhook |
| **Supabase** | `userDb(token)` for anything a user reaches, `serviceDb()` for workers | Own project — **never** BIS's `tlbkbmlrfafquucsmsmm`. PostGIS into `extensions`, not `public` |
| **Vercel** | Cron → tick → Workflow; Node runtime for DNS | Pro plan is effectively required (sub-hour cron accuracy, >300s steps, 7-day workflow retention) |
| **BIS CRM** | Outbound HTTPS POST with `Idempotency-Key`, retried from the outbox | Contract must be agreed before either side builds. Tag payload with `source:siteless`, industry, city, score. BIS must dedupe |

### Internal boundaries

| Boundary | Communication | Rule |
|---|---|---|
| Adapters → Resolution | `SourceRecordDraft[]` rows in Postgres | Adapters never write `businesses` |
| Resolution → Verification | `verification_jobs` rows | Resolution never probes the network |
| Verification → Classifier | `receipts` rows only | Workers never write `classifications` |
| Classifier → Scorer | `classifications` rows | Both pure; neither imports `db/` |
| Scorer → Triage | `leads` + `lead_scores` | Triage never recomputes a score |
| Triage → CRM | `sync_events` outbox | Triage never calls BIS |
| Everything → Budget | `reserve()` / `settle()` | No external call outside the meter |

---

## Sources

**HIGH confidence — official documentation**

- [Places API (New) policies](https://developers.google.com/maps/documentation/places/web-service/policies) — place ID exempt from caching restrictions, storable indefinitely; attribution rules
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) — lat/lng cacheable 30 consecutive calendar days; place_id per API policies
- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms/) — §3.2.3 no scraping / no caching; prohibition on creating or augmenting a "business listings database, mailing list, or telemarketing list"
- [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search) — 60 results max, 20/page, `pageToken`; field-mask→SKU mapping (`websiteUri`/`rating`/`userRatingCount`/`nationalPhoneNumber` = Enterprise)
- [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search) — max 20 results, no pagination, 50km radius cap, 50 types
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) — Text Search Pro $32/1K, Enterprise $35/1K; Place Details Essentials $5 / Pro $17 / Enterprise $20 per 1K
- [March 2025 pricing changes](https://developers.google.com/maps/billing-and-pricing/march-2025) — $200 credit replaced by per-SKU free caps: 10,000 Essentials / 5,000 Pro / 1,000 Enterprise
- [Vercel Workflows](https://vercel.com/docs/workflows) and [pricing/limits](https://vercel.com/docs/workflows/pricing) — no run-duration or sleep cap; 10,000 steps, 25,000 events, 50 MB payload, 240s replay; Hobby 50k events/mo, retention 1 day (Hobby) / 7 days (Pro)
- [Vercel Queues](https://vercel.com/docs/queues) and [pricing/limits](https://vercel.com/docs/queues/pricing) — **public beta**; at-least-once, idempotency keys, TTL 60s–7d, visibility timeout ≤60 min
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) and [managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — UTC only; Hobby once/day fired anywhere in the hour; **no retry**; best-effort delivery, may double-fire; `CRON_SECRET`
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations) — Fluid: Hobby 300s, Pro 300s default / 800s max / 1800s beta; 4.5 MB body; 250 MB bundle
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — READ COMMITTED re-evaluates the `WHERE` clause against the updated row version (the atomicity guarantee behind the budget gate)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) + [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance) — wrap helpers in `(select …)` for initPlan caching; index filter columns
- [Supabase PostGIS](https://supabase.com/docs/guides/database/extensions/postgis) — install into `extensions`, never `public`
- [Supabase Queues](https://supabase.com/docs/guides/queues) / pgmq, pg_cron, pg_net available on hosted
- [Clerk ↔ Supabase native integration](https://supabase.com/docs/guides/auth/third-party/clerk) and [Clerk's guide](https://clerk.com/docs/guides/development/integrations/databases/supabase) — `accessToken()` callback, `role: authenticated` claim, `auth.uid()` unusable with Clerk string ids
- [Clerk Session Token JWT v2](https://clerk.com/changelog/2025-04-14-session-token-jwt-v2) — org claims nested under `o`
- [Overture Places guide](https://docs.overturemaps.org/guides/places/) — CDLA-Permissive 2.0, GERS ids, `websites`/`socials`/`phones`/`confidence`, monthly releases, known duplicate/junk caveats
- [Firecrawl pricing](https://www.firecrawl.dev/pricing) and [search API](https://docs.firecrawl.dev/api-reference/endpoint/search) — Free 1,000 credits/mo, Hobby $16/5,000; scrape 1 credit/page; **search documented as both 2 and 10 credits/10 results — verify**
- [Texas Open Data Portal — Active Franchise Tax Permit Holders](https://data.texas.gov/dataset/Active-Franchise-Tax-Permit-Holders/9cir-efmm) and the Comptroller's monthly `FTACT.zip`

**MEDIUM confidence — multiple credible secondary sources**

- [Parking Sensors: Analyzing and Detecting Parked Domains (NDSS)](https://www.ndss-symposium.org/wp-content/uploads/2017/09/01_2_2.pdf) and [authoritative-DNS parked-domain detection, ~92.8% accuracy](https://dl.acm.org/doi/10.1145/3425329.3425335) — DNS-first parking detection
- [Entity resolution in Postgres with pg_trgm](https://concepttocloud.com/news/entity-resolution-in-postgres-trigrams-vs-embeddings) and [a worked normalize→block→score pipeline](https://github.com/blackdiamondcyber-png/entity-resolution-postgres) — ~99% recall/precision on business records in pure SQL
- [Transactional outbox with `FOR UPDATE SKIP LOCKED`](https://milanjovanovic.tech/blog/implementing-the-outbox-pattern)
- [Yelp Fusion paid-tier transition, 2024](https://techcrunch.com/2024/08/02/yelps-lack-of-transparency-around-api-charges-angers-developers/) — no free tier
- [Serwist for Next.js offline PWAs](https://blog.logrocket.com/nextjs-16-pwa-offline-support/) and [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Google Places API terms, practitioner reading](https://bizcollect.dev/blog/google-places-api-terms) — corroborates the "no lead database from Places content" reading

**Prior art inspected directly (HIGH confidence, in-repo)**

- `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0001_tenancy.sql` — `app.jwt()`, `app.current_account_id()`, org-scoped policies, append-only `events` with `revoke update, delete`
- `C:\Users\danlo\bis-platform\packages\db\supabase\migrations\0002_app_schema_grants.sql` — `grant usage on schema app`, without which every policy errors instead of evaluating
- `C:\Users\danlo\bis-platform\packages\db\src\test\db.ts` — `withRollback` / `actAs` RLS harness (port this)
- `C:\Users\danlo\bis-platform\packages\db\src\user-client.ts` — `userDb(accessToken)` vs `serviceDb()` split

**LOW confidence / open**

- Whether a derived verdict over Places content is itself "Content" under §3.2.3 — needs a human legal read
- Firecrawl's actual per-search credit cost — docs conflict; measure
- Overture's real RGV coverage and the right `confidence` cut-off — measure in Phase 2
- Whether Yelp adds coverage Overture's Meta-sourced `socials` does not — measure before paying

---
*Architecture research for: multi-source local-business discovery + web-presence verification*
*Researched: 2026-09-20*
