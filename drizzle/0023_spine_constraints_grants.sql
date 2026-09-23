-- The half of migration 0022 that drizzle-kit's differ cannot emit: the three new composite
-- provenance FKs, the external key's uniqueness and shape, the blocking and lookup indexes
-- (partial, and one with an operator class), the explicit DML grants every new table needs,
-- the trigger attachments, and the table comments that record what deliberately has no
-- app.log_event.
--
-- Hand-written via `pnpm db:custom --name=spine_constraints_grants` (generate --custom).
-- drizzle-kit remains the single migration authority (D-09) — nothing here was applied by any
-- other tool, and no generated file was hand-edited.
--
-- NOT HERE: the sr_source_key_known CHECK swap. Plan 03-05 expected to hand-write it, but
-- drizzle-kit 0.31.10 DID emit it into 0022 (a DROP CONSTRAINT near the top, the widened
-- ADD CONSTRAINT near the end), because the CHECK lives in src/db/schema/source-records.ts.
-- Repeating it here would be a pointless drop-and-re-add of an identical constraint.

-- 1. THE THREE NEW COMPOSITE PROVENANCE FKs (FOUND-05 / DATA-03: durable cites durable).
--
-- Same shape as 0006's three. Each `_src_ret` twin is GENERATED ALWAYS AS ('durable') STORED,
-- so the pair can only resolve against sr_durable_uniq (id, retention_class) on a source
-- record whose retention_class is 'durable'. A field whose only source is ephemeral cannot be
-- set at all; it stays NULL and the UI says "not stored".
alter table businesses add constraint businesses_address_src_fk
  foreign key (address_source_id, address_src_ret) references source_records (id, retention_class);
--> statement-breakpoint

-- 🔴 THIS is the constraint that stops a Places sweep's ephemeral lat/lng becoming the durable
-- businesses.lat/lng in Phase 4 (T-3-06). A google_places source record is ephemeral by
-- sr_google_is_ephemeral, so citing it from location_source_id is refused with 23503. Its test
-- ships now (tests/db/retention.test.ts 'location cites durable'), so Phase 4's legal boundary
-- is already proven before Phase 4 exists. Mutation M18 drops it.
alter table businesses add constraint businesses_location_src_fk
  foreign key (location_source_id, location_src_ret) references source_records (id, retention_class);
--> statement-breakpoint

-- closed_at is set only by a Comptroller closure record (durable). Overture's
-- 'permanently_closed' lives in operating_status and never writes closed_at.
alter table businesses add constraint businesses_closed_at_src_fk
  foreign key (closed_at_source_id, closed_at_src_ret) references source_records (id, retention_class);
--> statement-breakpoint

-- 2. THE EXTERNAL KEY (D-19, DEDUP-03, T-3-13).
--
-- Unique PER ORG, not globally: two tenants may independently draw the same SL-XXXXXX. The
-- insert path is `on conflict (org_id, external_key) do nothing returning id`, retried with a
-- fresh key. The key is never a foreign key and never a route parameter — every FK targets
-- businesses(id).
create unique index businesses_external_key_uniq on businesses (org_id, external_key);
--> statement-breakpoint

-- The shape CHECK keeps a hand-written row from introducing I / L / O / U and defeating the
-- read-aloud property the key exists for (Crockford base32, six characters).
alter table businesses add constraint businesses_external_key_shape
  check (external_key ~ '^SL-[0-9A-HJKMNP-TV-Z]{6}$');
--> statement-breakpoint

-- 3. THE BLOCKING AND LOOKUP INDEXES.
--
-- The GIN trigram index is why 03-01 (pg_trgm) had to land first. 367 ms to build on 57k rows.
-- It cannot carry org_id without btree_gin (available on local and production, NOT installed).
-- v1 is one org; the resolver's LATERAL still filters `o.org_id = c.org_id` and the recheck is
-- free. Adding btree_gin is the multi-org upgrade, not this phase's work.
create index businesses_name_trgm on businesses using gin (name_norm gin_trgm_ops);
--> statement-breakpoint

-- Blocker B1: exact phone.
create index businesses_phone_idx on businesses (org_id, phone_e164) where phone_e164 is not null;
--> statement-breakpoint

-- Blocker B2': (zip5, street_num), gated by similarity.
create index businesses_addr_idx on businesses (org_id, postal, street_num) where postal is not null;
--> statement-breakpoint

-- D-11 chain grouping.
create index businesses_chain_idx on businesses (org_id, chain_key) where chain_key is not null;
--> statement-breakpoint

-- "What was merged into this business" — the detail view's merge history.
create index businesses_merged_idx on businesses (org_id, merged_into_id) where merged_into_id is not null;
--> statement-breakpoint

-- The Comptroller ingest's idempotent lookup by 'taxpayer_number-outlet_number'.
create index businesses_comptroller_key_idx on businesses (org_id, comptroller_key) where comptroller_key is not null;
--> statement-breakpoint

-- DATA-04: the idempotent upsert target. A re-run of an ingest finds its own source record by
-- (org_id, source_key, external_id) instead of inserting a second one.
create unique index source_records_ext_uniq on source_records (org_id, source_key, external_id) where external_id is not null;
--> statement-breakpoint

-- One LIVE alias per key. A released alias (unmerge) no longer claims the key.
create unique index business_aliases_key_uniq on business_aliases (org_id, external_key) where released_at is null;
--> statement-breakpoint

-- A business can be merged away only once at a time. An undone merge stays as a row.
create unique index business_merges_loser_uniq on business_merges (org_id, loser_id) where undone_at is null;
--> statement-breakpoint

-- 4. EXPLICIT DML GRANTS. A new table inherits NOTHING.
--
-- Migration 0008 retired the platform default ACL for anon and authenticated on tables in
-- public. A table created without its grant fails loudly with `42501 permission denied for
-- table <t>` on the first user-role statement — the INTENDED failure mode. See
-- .planning/CONVENTIONS.md § Grants. authenticated gets DML and nothing else; anon nothing.
grant select on ingest_runs, merge_candidates, business_merges, business_aliases to authenticated;
--> statement-breakpoint

-- 🔴 SELECT-ONLY, including merge_candidates. This deliberately departs from 03-RESEARCH's
-- "select, update" suggestion for merge_candidates: the review queue DOES write a decision to
-- it, but every decision goes through a SECURITY DEFINER (03-11) that reads the actor itself,
-- so decided_by and merged_by cannot be forged (T-3-08). A direct UPDATE grant would let a
-- session write `decided_by = 'user_someone_else'`. ingest_runs is written by the desk ETL;
-- business_merges and business_aliases only by the merge/unmerge definers.
--
-- The revoke is not redundant with "a new table inherits nothing" — it is 0008 step 5's and
-- 0015's belt-and-braces: a later blanket `grant all on all tables in schema public` would
-- silently re-open all four, and a revoke that is not written down cannot be re-asserted.
revoke insert, update, delete on ingest_runs, merge_candidates, business_merges, business_aliases from authenticated;
--> statement-breakpoint

-- The reference-table line, exactly as 0013 grants the six Phase 2 reference tables. Safe:
-- referencePolicies() excludes org_id IS NULL built-ins from every write policy (T-3-07), so a
-- tenant's statement has no built-in row to reach; a tenant's own mappings are ordinary rows.
grant select, insert, update, delete on overture_category_map to authenticated;
--> statement-breakpoint

-- 5. TRIGGER ATTACHMENT, copying 0013's loop.
--
-- app.log_event goes on business_merges ONLY: state-bearing, low volume (~10,000 rows), and a
-- merge is exactly the change somebody later needs attributed. It resolves the org from the
-- row's own org_id, so a definer-run merge with no Clerk claim still logs correctly.
--
-- app.touch_updated_at goes on all five new tables. BEFORE UPDATE, never AFTER: it mutates NEW
-- and returns it, and an AFTER attachment recurses.
do $$ declare t text;
begin
  foreach t in array array['business_merges'] loop
    execute format(
      'create trigger %I_event after insert or update or delete on %I
         for each row execute function app.log_event()', t, t);
  end loop;
  foreach t in array array['ingest_runs','merge_candidates','business_merges','business_aliases','overture_category_map'] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
--> statement-breakpoint

-- 6. WHAT DELIBERATELY HAS NO app.log_event TRIGGER, AND WHY.
--
-- EVENT_LOGGED in tests/db/event-trigger.test.ts asserts set equality in BOTH directions, so a
-- surprise extra trigger is as red as a missing one. These comments are where a future reader
-- learns each exclusion was a decision, not an oversight.
comment on table ingest_runs is
  'No app.log_event by design: the run''s own row IS the event, and a row trigger would duplicate it on every counter update. The one run-level event goes through app.emit_event(''ingest_runs'', run_id, ''complete'', stats). SELECT-only for authenticated (0023).';
--> statement-breakpoint

comment on table merge_candidates is
  'No app.log_event by design: ~30,000 rows per resolve pass, the source_records write-amplification argument (CONVENTIONS § Audit). The decision becomes audited state in business_merges. SELECT-only for authenticated: decisions go through a SECURITY DEFINER so decided_by cannot be forged (T-3-08). Skip = skipped_at, not a third decision value.';
--> statement-breakpoint

comment on table business_aliases is
  'No app.log_event by design: every row is derived from a business_merges row, which is logged. businesses.merged_into_id is the source of truth; this is the indexed SL-key lookup. external_key is never a foreign key (T-3-13).';
--> statement-breakpoint

comment on table overture_category_map is
  'No app.log_event by design: reference rows. Built-ins carry org_id IS NULL and their history is the seed script in version control; app.log_event would also fail the seed (events.org_id is NOT NULL). unique nulls not distinct (org_id, basic_category) keeps the seed idempotent.';
--> statement-breakpoint

-- Recorded in the catalog as well as here, because this is the one constraint in the schema
-- whose removal would be a legal breach rather than a data-quality bug.
comment on constraint businesses_location_src_fk on businesses is
  'T-3-06: location may only cite a DURABLE source record. A google_places record is ephemeral (sr_google_is_ephemeral), so a Places lat/lng can never become the durable businesses.lat/lng.';
--> statement-breakpoint

comment on column businesses.name_norm is
  'INTERNAL (D-12). The normalized match key. Never displayed, never exported, never in a push payload; PublicBusiness omits it and tests/unit/no-internal-leak.test.ts scans for it.';
