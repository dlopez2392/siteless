-- Phase 4 code review (04-REVIEW-partA / partB), slice A: the SQL half of the fixes. Every
-- section names the finding it closes. Hand-written via `pnpm db:custom` (generate --custom);
-- drizzle-kit stays the single migration authority (D-09). No column is added or dropped, so
-- the 0030 snapshot equals 0029's.
--
-- 🔴 RE-RUNNABLE ON PURPOSE. Every statement is `create or replace`, `drop … if exists` then
-- create, or a revoke/grant — so the migration applies cleanly to a database where a section
-- was already applied by hand while it was being written (the local test database), and
-- identically to production, where none of it exists yet.
--
-- Definer discipline (0024, 0025, 0028, 0029), restated for every function this file touches:
-- search_path = public, pg_temp on the same statement; the org from app.current_org_id(),
-- never a parameter; every caller-supplied uuid re-read with org_id = v_org; an explicit
-- `if not found` after every `select … into`; refusal messages never echo a caller value.
-- 🔴 `revoke … from public` alone does nothing useful: 0000_bootstrap's default privileges hand
-- every new app.* function an EXPLICIT execute grant for authenticated, anon and service_role,
-- so each role is named, and the grants are re-asserted for every function replaced here.
--
-- 🔴 PG17-compatible SQL only (tests/unit/pg17-compat.test.ts): production is 17.6.

-- ===========================================================================
-- 1. A-WR-06 — app.places_features_ok is the legal line: 11 keys, integer points.
-- ===========================================================================
--
-- Since 2026-09-23 the persisted feature set is src/lib/places/page-record.ts FEATURE_KEYS (11):
-- name, phone, address, distance, cluster (INTEGER points — cluster may be negative, -10 for a
-- different cluster), signals, rule, city, sab, listingPhone, listingLocation. The continuous,
-- Google-derived nameSim and distanceM are memory-only and are now refused here too (`else
-- false`), so a regression in toPageRecord can no longer persist them silently. A non-integer
-- under a points key is refused: a continuous similarity cannot hide under `name`.
--
-- The constraint is DROPPED and RE-ADDED around the new body so existing rows are re-validated
-- against it (a bare `create or replace` would leave any old row unchecked). Production held
-- zero place_attachments rows at 0029 (no Places call has been made); the pre-flight read in
-- the fix report confirms it before apply.
alter table place_attachments drop constraint if exists pa_features_numeric;
--> statement-breakpoint

create or replace function app.places_features_ok(f jsonb) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when f is null or jsonb_typeof(f) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(f) e
       where not (
         case
           when e.key in ('name', 'phone', 'address', 'distance', 'cluster')
             then case
                    when jsonb_typeof(e.value) <> 'number' then false
                    else (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric)
                  end
           when e.key = 'signals'
             then case
                    when jsonb_typeof(e.value) <> 'array' then false
                    else not exists (
                      select 1 from jsonb_array_elements(e.value) s
                       where jsonb_typeof(s) <> 'string'
                          or (s #>> '{}') not in ('name', 'phone', 'address', 'distance'))
                  end
           when e.key = 'rule'
             then case
                    when jsonb_typeof(e.value) <> 'string' then false
                    else (e.value #>> '{}') in ('phone_locality_name', 'phone_locality_review',
                                                'over_25km', 'sab_phone_city')
                  end
           when e.key in ('city', 'sab', 'listingPhone', 'listingLocation')
             then e.value in ('0'::jsonb, '1'::jsonb)
           else false
         end))
  end
$$;
--> statement-breakpoint

alter table place_attachments add constraint pa_features_numeric check (app.places_features_ok(features));
--> statement-breakpoint

revoke execute on function app.places_features_ok(jsonb) from public, anon, service_role;
--> statement-breakpoint

grant execute on function app.places_features_ok(jsonb) to authenticated;
--> statement-breakpoint

comment on function app.places_features_ok(jsonb) is
  'T-3-11 / T-4-05 / M36 / A-WR-06. True iff a place_attachments.features value is an object whose keys are drawn from the 11 persisted feature keys (src/lib/places/page-record.ts FEATURE_KEYS): name, phone, address, distance, cluster as INTEGER points; signals, an array of name|phone|address|distance; rule, one of four enums; city, sab, listingPhone, listingLocation as 0|1. The continuous nameSim / distanceM are memory-only and refused. Backs the pa_features_numeric CHECK: the legal line (D-13) holds at the table even if the application regresses.';
--> statement-breakpoint
