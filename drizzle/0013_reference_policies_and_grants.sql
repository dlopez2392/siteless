-- The half of migration 0012 that drizzle-kit's differ cannot emit: the circular foreign
-- key, the explicit DML grants every new table now needs, search_versions' grant-level
-- immutability, and the audit trigger attachments.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09) — nothing here was applied by any other tool, and no
-- generated file was hand-edited.

-- 1. THE CIRCULAR FOREIGN KEY.
--
-- searches.current_version_id -> search_versions.id, while search_versions.search_id ->
-- searches.id. drizzle-kit cannot order circular DDL, so `current_version_id` is declared
-- in src/db/schema/searches.ts WITHOUT .references() and the constraint is added here,
-- after both tables exist.
--
-- ON DELETE SET NULL, not cascade: losing the pointer to a current version must not delete
-- the search itself. Note the asymmetry with runs.search_version_id, which is ON DELETE NO
-- ACTION — a version a RUN cites cannot be removed at all (SRCH-03), while a version a
-- search merely points AT as "current" can be, leaving the search alive with a null
-- pointer.
alter table searches add constraint searches_current_version_id_fk
  foreign key (current_version_id) references search_versions(id) on delete set null;
--> statement-breakpoint

-- 2. EXPLICIT DML GRANTS. A new table inherits NOTHING.
--
-- Migration 0008 retired the platform default ACL for anon and authenticated on tables in
-- public — including migration 0002's own `alter default privileges ... grant select,
-- insert, update, delete on tables to authenticated`. From 0008 onward the migration that
-- CREATES a table grants the DML its policies need explicitly, in that same migration,
-- exactly as it declares org_id, the policies and the _org_idx. A table created without
-- its grant fails loudly with `42501 permission denied for table <t>` on the first
-- user-role statement — the INTENDED failure mode, and the reason the default was retired
-- rather than narrowed. See .planning/CONVENTIONS.md § Grants.
--
-- authenticated gets DML and nothing else. Never truncate, references, trigger or
-- maintain — the four that either ignore RLS outright or hand out an ACCESS EXCLUSIVE lock
-- on a tenant table. anon gets nothing, on any table, ever: app_user is NOINHERIT and
-- holds authenticated alone, so anon is not a Siteless caller and its appearance in a
-- grant is a defect.

-- The six reference tables. Full DML is correct here even though built-ins must be
-- untouchable: the referencePolicies() write policies already carry
-- `org_id is not null and org_id = (select app.current_org_id())`, so a built-in is
-- outside the scope of insert, update and delete. A tenant's OWN rows in these tables are
-- ordinary tenant rows and need the ordinary grants.
grant select, insert, update, delete on industry_clusters, industry_terms, counties, cities, geo_presets, outlet_counts to authenticated;
--> statement-breakpoint

grant select, insert, update, delete on searches to authenticated;
--> statement-breakpoint

-- SEARCH_VERSIONS IS IMMUTABLE BY GRANT, NOT BY POLICY. This is migration 0007's events
-- treatment applied to the second append-only table in the schema, and the distinction is
-- the whole point: with only an RLS filter an UPDATE is silently filtered to zero rows and
-- reads to the caller as "nothing happened"; with the grant revoked it is
-- `42501 permission denied for table search_versions` — a refusal impossible to mistake
-- for an empty result, and a different MESSAGE from an RLS refusal's "new row violates
-- row-level security policy". Pin the message, not only the code.
--
-- A missing policy also denies by default today, but a later `for all` policy would
-- silently re-open it. A revoked grant cannot be widened by accident.
grant select, insert on search_versions to authenticated;
--> statement-breakpoint
revoke update, delete on search_versions from authenticated;
--> statement-breakpoint

-- RUNS: A COLUMN GRANT, following migration 0010's orgs precedent.
--
-- A policy's WITH CHECK sees the finished row and has no access to OLD, so it can express
-- "the row still belongs to me" but never "this column did not change". PostgreSQL checks
-- a column privilege against the statement's SET list BEFORE any policy is evaluated,
-- which is the only mechanism that can say it.
--
-- Leaving search_version_id outside this list is what makes T-2-12 a database fact rather
-- than a convention: a finished run cannot be re-pointed at a different version, so "this
-- run searched for X" stays answerable. Together with the FK's ON DELETE NO ACTION (the
-- cited version cannot be deleted either) that is SRCH-03, true by construction.
--
-- Also deliberately absent: org_id, id, created_at, updated_at, updated_by. A BEFORE
-- trigger is NOT subject to the column check, so app.touch_updated_at() still stamps
-- updated_at/updated_by although neither is granted — which is also what stops a caller
-- forging its own attribution. A column added to runs by a later migration inherits
-- nothing here and must be named explicitly if a tenant is meant to write it.
--
-- No DELETE on runs: this phase has no run-deletion path, and a deleted run is deleted
-- spend history.
grant select, insert on runs to authenticated;
--> statement-breakpoint
grant update (status, stopped_reason, cost_micro_usd, calls_count, started_at, finished_at) on runs to authenticated;
--> statement-breakpoint

-- 3. TRIGGER ATTACHMENT, copying migration 0007's loop.
--
-- app.log_event goes on searches and search_versions ONLY. Both are state-bearing: a
-- preset renamed or archived, and a version created, are exactly the changes somebody will
-- later need attributed. See the closing comment for what is deliberately excluded.
--
-- app.touch_updated_at goes on every MUTABLE table created by 0012. It must be BEFORE
-- UPDATE; an AFTER attachment recurses, because it mutates NEW and returns it.
-- search_versions is absent from the second list because it has no updated_at column and
-- no UPDATE path at all.
do $$ declare t text;
begin
  foreach t in array array['searches','search_versions'] loop
    execute format(
      'create trigger %I_event after insert or update or delete on %I
         for each row execute function app.log_event()', t, t);
  end loop;
  foreach t in array array['searches','runs','industry_clusters','industry_terms','counties','cities','geo_presets','outlet_counts'] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
--> statement-breakpoint

-- 4. WHAT DELIBERATELY HAS NO app.log_event TRIGGER, AND WHY.
--
-- EVENT_LOGGED in tests/db/event-trigger.test.ts asserts set equality in BOTH directions,
-- so a surprise extra trigger is as red as a missing one. These exclusions are decisions,
-- recorded here so the next reader does not "fix" them:
--
--   * The six reference tables (industry_clusters, industry_terms, counties, cities,
--     geo_presets, outlet_counts). app.log_event resolves app.current_org_id(), which is
--     NULL for the seed loader running as the owner with no Clerk claim, and events.org_id
--     is NOT NULL — a trigger here would fail the seed with 23502 not-null violation. The
--     built-ins are also shared reference data, not tenant state: their history is the
--     seed script in version control.
--
--   * runs. Run volume belongs to Phase 4 (the run executor) and Phase 9, and a row
--     trigger per run-status transition is the same write-amplification shape CONVENTIONS
--     § Audit excludes source_records for. A run's spend history is the cost ledger, and
--     the run-level event goes through app.emit_event() when Phase 4 needs one.
--
-- app.touch_updated_at is attached to all of them regardless — it is cheap, it writes no
-- events row, and it needs no org claim.
--
-- The DML-only rule is asserted from the other side too: tests/db/grants-audit.test.ts
-- reads has_table_privilege for TRUNCATE, REFERENCES, TRIGGER and MAINTAIN across every
-- table in public, so nothing granted above can quietly carry one of them.
comment on table search_versions is
  'Append-only. Immutable by GRANT (0013), not by policy: UPDATE/DELETE are revoked from authenticated, so a refusal is 42501 permission denied rather than a silent zero-row filter. unique(search_id, version) is the optimistic-concurrency lock.';
