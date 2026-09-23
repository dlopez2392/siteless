/**
 * The grant surface is a database property, asserted on whatever database the suite is
 * pointed at — dev, CI, or (read-only, by hand) production.
 *
 * Why this file exists: Supabase ships
 * `alter default privileges ... grant all on tables to anon, authenticated, service_role`
 * for schema `public`, so every table drizzle-kit created as `postgres` inherited FULL
 * privileges for `anon` and `authenticated` on the production project. Row-level security
 * does not help. TRUNCATE is exempt from RLS by design, so a policy-scoped session could
 * erase every tenant's rows and the audit log. 01-10's production-vs-local side-by-side
 * proved it: `truncate public.events` as `authenticated` SUCCEEDED, and so did
 * `truncate orgs, businesses, source_records, events cascade` as both `authenticated` and
 * `anon`. Migration 0007's `revoke update, delete on events from authenticated` landed
 * correctly and never touched `anon` and never touched TRUNCATE.
 *
 * Tests 3 and 4 reproduce probes P1 and P6 from that report as assertions. They attempt
 * the statement rather than reading the catalog: `has_table_privilege` says what the
 * catalog holds, only the attempt says what the server does.
 *
 * `actAsRole('authenticated')` deliberately carries NO claims. These are GRANT refusals,
 * not policy refusals — the point is that the refusal survives a session that has a
 * perfectly valid org claim, so the claim is left out entirely.
 *
 * Adding a table to `public` means adding its name to TENANT_TABLES below. A Set/array
 * literal in the test file, never a config file, so widening it is a diff a reviewer sees.
 *
 * Mutation: `grant truncate on public.events to authenticated;` against the live database
 * — 'a TRUNCATE of events as authenticated is refused with 42501' and 'authenticated holds
 * no TRUNCATE, REFERENCES or TRIGGER on any tenant table' both go red.
 */
import { describe, expect, it } from 'vitest';
import { actAsOwner, actAsRole, seedTwoOrgs, withRollback } from './_fixtures';

const TENANT_TABLES = [
  'orgs',
  'businesses',
  'source_records',
  'events',
  // Phase 2 plan 03. Six reference tables whose built-ins carry org_id IS NULL, the
  // versioned preset pair, and runs. Every one of them grants its own DML in
  // drizzle/0013 — since migration 0008 a new table inherits nothing — and the four
  // non-DML privileges below must be absent from all thirteen.
  'industry_clusters',
  'industry_terms',
  'counties',
  'cities',
  'geo_presets',
  'outlet_counts',
  'searches',
  'search_versions',
  'runs',
  // Phase 2 plan 05. The meter. All three grant SELECT and nothing else (drizzle/0015) —
  // every write is a SECURITY DEFINER function — so they are the first tables here whose
  // DML row in the matrix below is a single `true`.
  'budget_periods',
  'cost_reservations',
  'cost_ledger',
  // Phase 3 plan 05. The spine. Grants in drizzle/0023: the first four are SELECT-only
  // with INSERT/UPDATE/DELETE revoked (every writer is a desk ETL or a SECURITY DEFINER
  // that reads the actor itself — T-3-08); overture_category_map takes the full
  // reference-table DML line, safe because referencePolicies() excludes the built-ins.
  'ingest_runs', // Phase 3 plan 05. grant select; revoke insert, update, delete.
  'merge_candidates', // Phase 3 plan 05. grant select; revoke insert, update, delete.
  'business_merges', // Phase 3 plan 05. grant select; revoke insert, update, delete.
  'business_aliases', // Phase 3 plan 05. grant select; revoke insert, update, delete.
  'overture_category_map', // Phase 3 plan 05. grant select, insert, update, delete.
];

const valuesOf = (xs: string[]) => xs.map((x) => `('${x}')`).join(',');

/**
 * Every pair is returned with its verdict, never pre-filtered in SQL: the row COUNT is
 * then the control. A predicate typo that matches nothing returns zero rows and an
 * `expect(held).toEqual([])` over it would pass while asserting nothing.
 */
const privilegeMatrix = (role: string, privileges: string[]) => `
  select t.tbl, p.priv,
         has_table_privilege('${role}', 'public.' || t.tbl, p.priv) as held
    from (values ${valuesOf(TENANT_TABLES)}) as t(tbl)
   cross join (values ${valuesOf(privileges)}) as p(priv)
   order by 1, 2`;

type PrivRow = { tbl: string; priv: string; held: boolean };

/**
 * MAINTAIN (PostgreSQL 17+) is checked alongside the three the name lists. Migration 0008
 * reproduces the platform condition with `grant all`, and on PG 17/18 `all` includes
 * MAINTAIN — which Supabase's own default ACL predates and therefore never granted. Left
 * un-revoked, the fix would hand `authenticated` VACUUM FULL / CLUSTER on every tenant
 * table, i.e. an ACCESS EXCLUSIVE lock on demand. Same threat class as TRUNCATE (T-1-30).
 */
const NON_DML = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const ALL_DML = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];

describe('grants audit', () => {
  it('authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any tenant table', () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      // "any tenant table" is a claim about the database, not about this array. A table
      // added in Phase 2 or 3 without being listed here would leave the claim false and
      // the test green, so the list is checked against the live catalog first.
      const { rows: live } = await c.query<{ tbl: string }>(
        `select c.relname as tbl
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by 1`,
      );
      expect(live.map((r) => r.tbl)).toEqual([...TENANT_TABLES].sort());

      const { rows } = await c.query<PrivRow>(privilegeMatrix('authenticated', NON_DML));
      // 21 tables x 4 privileges. If this number moves, the enumeration stopped enumerating.
      expect(rows).toHaveLength(TENANT_TABLES.length * NON_DML.length);
      expect(rows.filter((r) => r.held)).toEqual([]);
    }));

  it('anon holds no privilege on any tenant table', () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      const { rows } = await c.query<PrivRow>(privilegeMatrix('anon', ALL_DML));
      expect(rows).toHaveLength(TENANT_TABLES.length * ALL_DML.length);
      expect(rows.filter((r) => r.held)).toEqual([]);
    }));

  it('a TRUNCATE of events as authenticated is refused with 42501', () =>
    withRollback(async (c) => {
      // Seed as the owner first, so the audit log this statement would erase is not empty.
      // A refusal proved over an empty table is a weaker claim than the threat deserves.
      await seedTwoOrgs(c);
      await actAsRole(c, 'authenticated');
      // ONE refused statement in this transaction. A refusal aborts the transaction and
      // any statement after it reports 25P02 instead of its own reason.
      const attempt = c.query('truncate public.events');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table events/);
    }));

  it('a cascading TRUNCATE of every tenant table as authenticated is refused with 42501', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAsRole(c, 'authenticated');
      // Its own transaction on purpose, for the same reason as above. This is 01-10's P6,
      // the probe that emptied all four tables on production.
      const attempt = c.query(
        'truncate public.orgs, public.businesses, public.source_records, public.events cascade',
      );
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
    }));

  it('the public schema default ACL grants nothing to anon or authenticated on tables', () =>
    withRollback(async (c) => {
      // A lateral aclexplode, not the inline `(aclexplode(x)).grantee` form: PostgreSQL 18
      // rejects that with "set-returning functions are not allowed in WHERE".
      //
      // Scoped to the roles that actually OWN tables in public — which is the set of roles
      // that create them, and therefore the only default ACLs that can reach a future
      // table here. On Supabase a second default ACL for public is owned by
      // `supabase_admin` and grants arwdDxtm to anon/authenticated; `postgres` is not a
      // member of supabase_admin and cannot alter it ("permission denied to change default
      // privileges", attempted on production and rolled back), and it is inert because
      // supabase_admin owns zero tables in public while drizzle-kit creates every table as
      // `postgres`. An unscoped assertion here would be red on production forever, for a
      // condition no migration this repo can write is able to change.
      const { rows } = await c.query<{ granted: number; total: number }>(`
        select count(*) filter (
                 where a.grantee in ('anon'::regrole, 'authenticated'::regrole)
               )::int as granted,
               count(*)::int as total
          from pg_default_acl d
         cross join lateral aclexplode(d.defaclacl) a
         where d.defaclnamespace = 'public'::regnamespace
           and d.defaclobjtype = 'r'
           and d.defaclrole in (
                 select distinct c.relowner
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r')`);
      // Control: the catalog read is live. Migration 0008 leaves service_role's default
      // privileges in place, so a zero here would mean the query found nothing at all.
      expect(rows[0]?.total).toBeGreaterThan(0);
      expect(rows[0]?.granted).toBe(0);
    }));

  it('authenticated keeps the DML the policies rely on', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        b_select: boolean;
        b_insert: boolean;
        b_update: boolean;
        b_delete: boolean;
        e_select: boolean;
        e_insert: boolean;
        e_update: boolean;
        e_delete: boolean;
      }>(`
        select has_table_privilege('authenticated','public.businesses','SELECT') as b_select,
               has_table_privilege('authenticated','public.businesses','INSERT') as b_insert,
               has_table_privilege('authenticated','public.businesses','UPDATE') as b_update,
               has_table_privilege('authenticated','public.businesses','DELETE') as b_delete,
               has_table_privilege('authenticated','public.events','SELECT')     as e_select,
               has_table_privilege('authenticated','public.events','INSERT')     as e_insert,
               has_table_privilege('authenticated','public.events','UPDATE')     as e_update,
               has_table_privilege('authenticated','public.events','DELETE')     as e_delete`);
      // Revoking too much is the other way to break this database: the policies are
      // evaluated only after the grant layer lets the statement through.
      expect(rows[0]).toEqual({
        b_select: true,
        b_insert: true,
        b_update: true,
        b_delete: true,
        e_select: true,
        // WR-01: revoked by 0011. Append-only protected the past and left the present
        // writable — a session could author an events row with any actor_id it liked. The
        // app-tier path is app.emit_event(), a SECURITY DEFINER that stamps the actor from
        // the claims and needs no grant; app.log_event() never needed one either.
        e_insert: false,
        // D-06 survives migration 0008's blanket `grant all` — 0008 re-asserts 0007.
        e_update: false,
        e_delete: false,
      });
    }));

  /**
   * The other direction for the twelve tables plans 02-03 and 02-05 add. The two above prove
   * `authenticated` holds nothing DANGEROUS; this proves it holds exactly what each
   * table's policies need and nothing more — which the audit could not otherwise see,
   * because since migration 0008 a new table inherits NO privileges at all and a migration
   * that forgets its grant produces a table nobody can read. That failure is loud in
   * production (`42501 permission denied for table <t>`) and completely silent here.
   *
   * The expectations are a literal, per table, for the same reason TENANT_TABLES is:
   * widening or narrowing a grant has to be a diff a reviewer sees.
   *
   *   * The six reference tables and `searches` take full DML. A built-in is protected by
   *     the referencePolicies() write policies excluding `org_id IS NULL`, not by
   *     withholding the grant — a tenant's own rows in those tables are ordinary rows.
   *   * `search_versions` is SELECT + INSERT only. T-2-12: immutability is a GRANT, so the
   *     refusal is `42501 permission denied for table search_versions` and not the silent
   *     zero-row filter a policy-only approach produces.
   *   * `runs` is SELECT + INSERT at table level, and UPDATE is a COLUMN grant (see the
   *     test below). No DELETE: a deleted run is deleted spend history.
   *   * The three plan 02-05 meter tables are SELECT and NOTHING ELSE. This is the whole
   *     of D-10 and half of T-2-03 stated as a grant: with no UPDATE on budget_periods a
   *     member cannot raise the cap by hand (the only path is app.set_budget_cap, which
   *     re-checks the admin role), and with no INSERT on cost_ledger the only writer is
   *     app.settle_reservation, which loads a reservation first. Every write to the meter
   *     is a SECURITY DEFINER function that resolves the caller from its own claims.
   *
   * Mutation: `revoke select on public.counties from authenticated;` against the live
   * database — this test goes red naming counties, and only this one.
   * Second mutation: `grant update on public.budget_periods to authenticated;` — this test
   * goes red naming budget_periods, and only this one.
   */
  it('authenticated holds exactly the DML each Phase 2 table needs', () =>
    withRollback(async (c) => {
      const EXPECTED: Record<string, [boolean, boolean, boolean, boolean]> = {
        // table:            SELECT INSERT UPDATE DELETE
        industry_clusters: [true, true, true, true],
        industry_terms: [true, true, true, true],
        counties: [true, true, true, true],
        cities: [true, true, true, true],
        geo_presets: [true, true, true, true],
        outlet_counts: [true, true, true, true],
        searches: [true, true, true, true],
        // Append-only by grant, exactly like events.
        search_versions: [true, true, false, false],
        // UPDATE is column-level, so the TABLE-level answer is false. DELETE is withheld.
        runs: [true, true, false, false],
        // The meter. SELECT only — no column grant either, unlike runs and orgs.
        budget_periods: [true, false, false, false],
        cost_reservations: [true, false, false, false],
        cost_ledger: [true, false, false, false],
      };
      const names = Object.keys(EXPECTED);
      const { rows } = await c.query<{ tbl: string; s: boolean; i: boolean; u: boolean; d: boolean }>(`
        select t.tbl,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT') as s,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT') as i,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'UPDATE') as u,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'DELETE') as d
          from (values ${names.map((n) => `('${n}')`).join(',')}) as t(tbl)
         order by 1`);
      // The row count is the control: a typo in a table name would raise, but a table
      // silently dropped from the literal would leave this green while asserting less.
      expect(rows).toHaveLength(names.length);
      const actual = Object.fromEntries(rows.map((r) => [r.tbl, [r.s, r.i, r.u, r.d]]));
      expect(actual).toEqual(EXPECTED);

      // D-10 says "no UPDATE grant on budget_periods AT ALL", and has_table_privilege
      // cannot say that: it reports false for runs and orgs too, both of which DO hold a
      // column-level UPDATE. Without this, migration 0015 could be softened to
      // `grant update (cap_micro_usd) on budget_periods to authenticated` — restoring
      // exactly the direct-write path app.set_budget_cap exists to be the only door to —
      // and every assertion above would stay green.
      //
      // 🔴 `search_versions` needs the SAME treatment, and did not have it until the Phase 2
      // gate (plan 02-15 T3) proved the gap by mutation. M12b —
      // `grant update (geo_payload) on public.search_versions to authenticated` — left the
      // ENTIRE 90-test suite green while `has_column_privilege('authenticated',
      // 'public.search_versions','geo_payload','UPDATE')` read TRUE, i.e. a tenant could
      // rewrite a stored version's geography. The table-level row above stays [t,t,f,f]
      // because a column grant is invisible to has_table_privilege, and
      // `versions immutable: UPDATE as authenticated is refused` stays green because it
      // updates `geo_kind`, which the column grant did not name. Append-only by grant has to
      // be asserted at the column level or it is not asserted at all (T-2-12, SRCH-03).
      const { rows: cols } = await c.query<{
        bp_any_update: boolean;
        cr_any_update: boolean;
        cl_any_insert: boolean;
        sv_any_update: boolean;
        runs_any_update: boolean;
      }>(`
        select has_any_column_privilege('authenticated','public.budget_periods','UPDATE')   as bp_any_update,
               has_any_column_privilege('authenticated','public.cost_reservations','UPDATE') as cr_any_update,
               has_any_column_privilege('authenticated','public.cost_ledger','INSERT')       as cl_any_insert,
               has_any_column_privilege('authenticated','public.search_versions','UPDATE')   as sv_any_update,
               has_any_column_privilege('authenticated','public.runs','UPDATE')              as runs_any_update`);
      expect(cols[0]).toEqual({
        bp_any_update: false,
        cr_any_update: false,
        cl_any_insert: false,
        // 🔴 UPDATE only. There is deliberately no `sv_any_delete` companion: PostgreSQL
        // has no column-level DELETE, and `has_any_column_privilege(...,'DELETE')` does not
        // return false for it — it raises `unrecognized privilege type: "DELETE"` and takes
        // the whole test with it. (Written, watched red exactly that way, corrected.) The
        // DELETE half of append-only is therefore fully covered by the table-level row
        // above plus `versions immutable: DELETE as authenticated is refused`.
        sv_any_update: false,
        // The positive control: has_any_column_privilege genuinely discriminates on this
        // database, so the four falses above are a finding and not a broken predicate.
        runs_any_update: true,
      });
    }));

  /**
   * Phase 3 plan 05, T-3-08. `business_merges.merged_by` and `merge_candidates.decided_by`
   * must be unforgeable, which means no tenant session may write either table directly —
   * every merge, unmerge and review decision goes through a SECURITY DEFINER (03-11) that
   * reads the actor itself. `ingest_runs` is written by the desk ETL and `business_aliases`
   * only by the merge definers.
   *
   * 🔴 has_table_privilege alone CANNOT see a column grant. That is how the Phase 2 M12b
   * defect survived 90 green tests: `grant update (geo_payload) on search_versions` left
   * the table-level answer false. So INSERT and UPDATE are asserted at the column level too.
   * DELETE has no column-level form — has_any_column_privilege(..., 'DELETE') RAISES
   * `unrecognized privilege type` rather than returning false (see the test above) — so the
   * table-level row is the whole DELETE assertion.
   *
   * Positive control: overture_category_map holds full DML on the same database, so the
   * falses below are a finding and not a predicate that returns false for everything.
   *
   * Mutation M22: `grant update on public.ingest_runs to authenticated;` — this test goes red
   * naming ingest_runs. Column variant: `grant update (score) on public.merge_candidates to
   * authenticated;` — red on the column half only.
   */
  it('the four select-only spine tables hold no write privilege', () =>
    withRollback(async (c) => {
      const SELECT_ONLY = ['ingest_runs', 'merge_candidates', 'business_merges', 'business_aliases'];
      const { rows } = await c.query<{
        tbl: string;
        s: boolean;
        i: boolean;
        u: boolean;
        d: boolean;
        col_i: boolean;
        col_u: boolean;
      }>(`
        select t.tbl,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT')      as s,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT')      as i,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'UPDATE')      as u,
               has_table_privilege('authenticated', 'public.' || t.tbl, 'DELETE')      as d,
               has_any_column_privilege('authenticated', 'public.' || t.tbl, 'INSERT') as col_i,
               has_any_column_privilege('authenticated', 'public.' || t.tbl, 'UPDATE') as col_u
          from (values ${valuesOf([...SELECT_ONLY, 'overture_category_map'])}) as t(tbl)
         order by 1`);
      // Row count is the control: a table silently dropped from the list would assert less.
      expect(rows).toHaveLength(SELECT_ONLY.length + 1);
      const actual = Object.fromEntries(
        rows.map((r) => [r.tbl, { s: r.s, i: r.i, u: r.u, d: r.d, col_i: r.col_i, col_u: r.col_u }]),
      );
      const selectOnly = { s: true, i: false, u: false, d: false, col_i: false, col_u: false };
      expect(actual).toEqual({
        ingest_runs: selectOnly,
        merge_candidates: selectOnly,
        business_merges: selectOnly,
        business_aliases: selectOnly,
        // The positive control.
        overture_category_map: { s: true, i: true, u: true, d: true, col_i: true, col_u: true },
      });
    }));

  /**
   * T-2-12, the half of SRCH-03 that no policy can express. A policy's WITH CHECK sees the
   * finished row and has no access to OLD, so it can say "the row still belongs to me" but
   * never "this column did not change". PostgreSQL checks a COLUMN privilege against the
   * statement's SET list before any policy runs, which is the only mechanism that can.
   *
   * `search_version_id` outside the grant is what makes "a past run still points at the
   * version that produced it" a database fact rather than a convention. The other half is
   * the FK's ON DELETE NO ACTION — the cited version cannot be deleted either — asserted
   * separately from pg_constraint.
   *
   * Mutation: `grant update (search_version_id) on runs to authenticated;` — this test
   * goes red on search_version_id alone.
   */
  it('a finished run cannot be re-pointed at another search version', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        tbl_update: boolean;
        any_col_update: boolean;
        search_version_id: boolean;
        org_id: boolean;
        status: boolean;
        cost_micro_usd: boolean;
        updated_by: boolean;
        fk_action: string;
      }>(`
        select has_table_privilege('authenticated','public.runs','UPDATE')                  as tbl_update,
               has_any_column_privilege('authenticated','public.runs','UPDATE')             as any_col_update,
               has_column_privilege('authenticated','public.runs','search_version_id','UPDATE') as search_version_id,
               has_column_privilege('authenticated','public.runs','org_id','UPDATE')        as org_id,
               has_column_privilege('authenticated','public.runs','status','UPDATE')        as status,
               has_column_privilege('authenticated','public.runs','cost_micro_usd','UPDATE') as cost_micro_usd,
               has_column_privilege('authenticated','public.runs','updated_by','UPDATE')    as updated_by,
               (select confdeltype::text from pg_constraint
                 where conname = 'runs_search_version_id_search_versions_id_fk')            as fk_action`);
      expect(rows[0]).toEqual({
        tbl_update: false,
        // The positive control: withholding UPDATE entirely would also satisfy the
        // assertion below while making the run executor unable to record a result.
        any_col_update: true,
        search_version_id: false,
        // org_id is withheld for the same reason it is on orgs — moving a row between
        // tenants is not an edit.
        org_id: false,
        status: true,
        cost_micro_usd: true,
        // Stamped by app.touch_updated_at() as the owner; a BEFORE trigger is not subject
        // to the column check, so attribution survives without being forgeable.
        updated_by: false,
        // 'a' = NO ACTION. 'c' would be CASCADE and 'n' SET NULL, either of which would
        // let a cited version disappear and take SRCH-03 with it.
        fk_action: 'a',
      });
    }));

  /**
   * CR-02. UPDATE on the tenant root is a COLUMN privilege, not a table privilege: the
   * orgs_update policy constrains `id` and cannot constrain `clerk_org_id`, so a member of
   * tenant A could re-key A onto another Clerk organisation and hand it A's data.
   *
   * has_table_privilege reports the TABLE-level grant only, which is why the three
   * functions are read side by side: table-level UPDATE must be gone, some column must
   * still be updatable (or the orgs_update policy is dead and the positive control in
   * rls-isolation.test.ts is the thing that would notice), and the key must not be among
   * them. updated_by is asserted absent too — app.touch_updated_at() stamps it as the
   * owner, so granting it would only let a caller forge its own attribution.
   */
  it('authenticated can update an orgs label but not its clerk_org_id', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        tbl_update: boolean;
        any_col_update: boolean;
        clerk_org_id: boolean;
        display_name: boolean;
        name_internal: boolean;
        timezone: boolean;
        id: boolean;
        updated_by: boolean;
      }>(`
        select has_table_privilege('authenticated','public.orgs','UPDATE')            as tbl_update,
               has_any_column_privilege('authenticated','public.orgs','UPDATE')       as any_col_update,
               has_column_privilege('authenticated','public.orgs','clerk_org_id','UPDATE') as clerk_org_id,
               has_column_privilege('authenticated','public.orgs','display_name','UPDATE')  as display_name,
               has_column_privilege('authenticated','public.orgs','name_internal','UPDATE') as name_internal,
               has_column_privilege('authenticated','public.orgs','timezone','UPDATE')      as timezone,
               has_column_privilege('authenticated','public.orgs','id','UPDATE')            as id,
               has_column_privilege('authenticated','public.orgs','updated_by','UPDATE')    as updated_by`);
      expect(rows[0]).toEqual({
        tbl_update: false,
        any_col_update: true,
        clerk_org_id: false,
        display_name: true,
        name_internal: true,
        timezone: true,
        id: false,
        updated_by: false,
      });
    }));
});
