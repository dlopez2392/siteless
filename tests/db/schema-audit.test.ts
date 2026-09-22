/**
 * D-10 + FOUND-06 + FOUND-04. These three tests exist to catch a LATER phase, not this
 * one: they enumerate the live database, so a table added in Phase 2 or 3 without org_id,
 * without RLS, or with a naked `timestamp` fails here rather than in production.
 *
 * Mutation: delete `...orgPolicies('businesses')` from src/db/schema/businesses.ts,
 * re-generate and re-apply — 'every public table is org-scoped and has RLS enabled' goes
 * red with businesses listed in `bad`.
 */
import { describe, expect, it } from 'vitest';
import { withRollback } from './_fixtures';

/**
 * A Set literal in the test file, deliberately NOT a config file: adding a table here is
 * a diff a reviewer sees. `orgs` IS the tenant root (it keys on id); the drizzle
 * bookkeeping table carries no tenant.
 */
const ALLOW_NO_ORG_ID = new Set(['orgs', '__drizzle_migrations']);

type AuditRow = {
  table_name: string;
  rls_enabled: boolean;
  has_org_id: boolean;
  policy_count: number;
};

const THREE_NAMES = ['display_name', 'internal_notes', 'legal_name'];

describe('schema audit', () => {
  it('every public table is org-scoped and has RLS enabled', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<AuditRow>(`
        select c.relname as table_name,
               c.relrowsecurity as rls_enabled,
               exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attname = 'org_id'
                          and a.attnum > 0 and not a.attisdropped) as has_org_id,
               (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
         order by c.relname`);
      expect(rows.length).toBeGreaterThan(0);
      const bad = rows.filter(
        (r) =>
          !r.rls_enabled ||
          r.policy_count === 0 ||
          (!r.has_org_id && !ALLOW_NO_ORG_ID.has(r.table_name)),
      );
      expect(bad).toEqual([]);
    }));

  it('every timestamp column in public is timestamptz', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(`select table_name, column_name, data_type
            from information_schema.columns
           where table_schema = 'public' and data_type like 'timestamp%'
           order by table_name, column_name`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((r) => r.data_type !== 'timestamp with time zone')).toEqual([]);
    }));

  it('businesses has three distinct name fields', () =>
    withRollback(async (c) => {
      const columnsOf = async (table: string) => {
        const { rows } = await c.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1`,
          [table],
        );
        return rows.map((r) => r.column_name);
      };
      // Three columns, not one. BIS's single accounts.name reached customers three times.
      const business = await columnsOf('businesses');
      expect(business.filter((n) => THREE_NAMES.includes(n)).sort()).toEqual(THREE_NAMES);
      const org = await columnsOf('orgs');
      expect(org.filter((n) => ['display_name', 'name_internal'].includes(n)).sort()).toEqual([
        'display_name',
        'name_internal',
      ]);
    }));
});
