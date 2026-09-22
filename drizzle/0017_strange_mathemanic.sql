-- CR-01. A version could be attached to ANOTHER TENANT'S preset, and no policy could
-- have stopped it.
--
-- 🔴 A ROW-LEVEL SECURITY POLICY SEES ONE ROW: THE ONE BEING WRITTEN. `search_versions_insert`
-- checks `org_id = app.current_org_id()`, which is satisfied by a row carrying the ATTACKER'S
-- own org while its `search_id` names the VICTIM'S preset. The parent is reached through a
-- foreign key, and PostgreSQL evaluates referential checks with the referenced table owner's
-- privileges — referential integrity deliberately does not run under the caller's policies,
-- or a row you cannot see could not be enforced against. So the single-column FK confirmed
-- "this search exists" and nothing more.
--
-- Measured against the local database before this migration (tests/db/versioned-presets.test.ts
-- › 'tenancy: a version cannot be attached to another org's search'): the INSERT returned a
-- row id. Consequences, each reachable from that one accepted statement:
--   * an EXISTENCE ORACLE on foreign preset ids (T-2-10) — a random uuid answers 23503 and a
--     real one answers ok;
--   * VERSION-NUMBER SQUATTING: insert the victim's next version number and every save they
--     attempt raises 23505 forever, because search_versions is append-only by GRANT
--     (migration 0013) and the product itself cannot clear the row;
--   * rows whose org_id disagrees with their parent's, with the attacker's actor id in the
--     audit trail of the victim's preset.
--
-- 🔴 THE FIX IS A COMPOSITE KEY, BECAUSE ONLY A COMPOSITE KEY CARRIES THE TENANT INTO THE
-- REFERENTIAL CHECK. `(search_id, org_id) -> searches (id, org_id)` is satisfiable only by a
-- parent in the SAME org, and it holds against hand-written SQL, a future action that forgets
-- its ownership read, and anything reaching the table outside src/server/actions/ — which is
-- what a single ownership SELECT in TypeScript can never claim. The application-side read in
-- `savePresetVersion` ships in the same commit so the caller gets the honest 404 copy instead
-- of a 23503 rendered as "something broke on our side"; this is the wall behind it.
--
-- The unique keys are the prerequisite, not the point: a composite FK needs a unique
-- constraint on the columns it references. `id` is already the primary key, so
-- `unique (id, org_id)` adds no row-level restriction whatsoever — it cannot refuse an insert
-- the primary key admits. It exists solely to be REFERENCEABLE.
--
-- Hand-written via `pnpm db:custom` (generate --custom). drizzle-kit remains the single
-- migration authority (D-09): these are constraints the differ cannot emit from the TS
-- schema, exactly like migration 0013's circular foreign key.
alter table searches
  add constraint searches_id_org_uniq unique (id, org_id);
--> statement-breakpoint

alter table search_versions
  add constraint search_versions_search_org_fk
  foreign key (search_id, org_id) references searches (id, org_id);
--> statement-breakpoint

-- The same treatment one level down. `runs.search_version_id` is reached by the same kind of
-- FK from the same kind of definer-and-action surface, and `queue-run.ts` reads the version
-- through RLS before writing — a correct action, which is precisely why the constraint is
-- worth having: it is what keeps that read from being the only thing standing between a run
-- and another tenant's version.
alter table search_versions
  add constraint search_versions_id_org_uniq unique (id, org_id);
--> statement-breakpoint

alter table runs
  add constraint runs_version_org_fk
  foreign key (search_version_id, org_id) references search_versions (id, org_id);
--> statement-breakpoint

comment on constraint search_versions_search_org_fk on search_versions is
  'CR-01. A version belongs to a search IN THE SAME ORG. RLS cannot express this: an insert policy sees only the new row, and a referential check runs with the referenced table owner''s privileges, so the single-column FK confirmed existence across tenants and nothing more.';
