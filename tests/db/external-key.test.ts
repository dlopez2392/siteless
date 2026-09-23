/**
 * D-19 / DEDUP-03 against the live local database: the external lead key is unique PER ORG,
 * shape-checked to Crockford base32, and never a foreign key. Plus the insert path's
 * collision-retry loop (`upsertBusinessFromSource`), which is the index's only consumer.
 *
 * One refused statement per transaction: a refusal aborts it and the next statement reports
 * 25P02, not its own reason. Every refusal below is the LAST statement of its `withRollback`,
 * and every refusal is paired with a positive control that runs first.
 *
 * The "not a FK" guarantee is asserted here rather than in tests/unit/ so the three
 * external-key guarantees read together; it needs the catalog half anyway.
 *
 * M17 (`drop index businesses_external_key_uniq`) — executed 2026-09-22, see 03-09-SUMMARY.md.
 * It reds 'external key is unique per org' and, because the insert path's
 * `on conflict (org_id, external_key)` needs that index to infer a target (42P10 without it),
 * every test that inserts a business through the shipped path. The shape-CHECK tests stay green.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_KEY_PATTERN } from '@/lib/ids/external-key';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import {
  EXTERNAL_KEY_ATTEMPTS,
  upsertBusinessFromSource,
  upsertSourceRecord,
} from '@/lib/ingest/upsert';
import { seedTwoOrgs, withRollback } from './_fixtures';
import { asEtlExecutor, seedComptrollerFixture } from './_ingest-fixtures';

const INSERT_KEYED = `insert into businesses (org_id, external_key, display_name)
                      values ($1, $2, 'Key Test') returning id`;

describe('the external key (D-19)', () => {
  it('external key is unique per org', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c); // owner: the org_B insert is not an RLS question
      await c.query(INSERT_KEYED, [a, 'SL-7F3K2Q']);
      // POSITIVE CONTROL FIRST: the SAME key in a DIFFERENT org inserts cleanly. D-19 says
      // unique per org, not globally — a global index would refuse this line.
      const other = await c.query(INSERT_KEYED, [b, 'SL-7F3K2Q']);
      expect(other.rows).toHaveLength(1);
      // The refusal, last statement of the transaction.
      await expect(c.query(INSERT_KEYED, [a, 'SL-7F3K2Q'])).rejects.toMatchObject({
        code: '23505',
        constraint: 'businesses_external_key_uniq',
      });
    }));

  it('positive control: a well-formed Crockford key inserts', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      expect('SL-7F3K2Q').toMatch(EXTERNAL_KEY_PATTERN);
      const r = await c.query<{ external_key: string }>(
        `insert into businesses (org_id, external_key, display_name)
         values ($1, 'SL-7F3K2Q', 'Key Test') returning external_key`,
        [a],
      );
      expect(r.rows[0]?.external_key).toBe('SL-7F3K2Q');
    }));

  it('external key shape refuses the ambiguous glyphs', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // I, L, O, U — the four Crockford drops, the ones that get misread aloud.
      await expect(c.query(INSERT_KEYED, [a, 'SL-IL0OU1'])).rejects.toMatchObject({
        code: '23514',
        constraint: 'businesses_external_key_shape',
      });
    }));

  it('external key shape refuses lowercase', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await expect(c.query(INSERT_KEYED, [a, 'SL-7f3k2q'])).rejects.toMatchObject({
        code: '23514',
        constraint: 'businesses_external_key_shape',
      });
    }));

  it('external key is not a FK', () =>
    withRollback(async (c) => {
      // 1. THE CATALOG: no foreign key in the database has external_key on either side.
      const fkColumns = async (column: string) =>
        (
          await c.query<{ conname: string }>(
            `select c.conname
               from pg_constraint c
               join pg_attribute a
                 on (a.attrelid = c.conrelid  and a.attnum = any(c.conkey))
                 or (a.attrelid = c.confrelid and a.attnum = any(c.confkey))
              where c.contype = 'f' and a.attname = $1
              order by 1`,
            [column],
          )
        ).rows.map((r) => r.conname);
      // Positive control: the same query DOES find a known self-FK on businesses.
      expect(await fkColumns('merged_into_id')).toContain(
        'businesses_merged_into_id_businesses_id_fk',
      );
      expect(await fkColumns('external_key')).toEqual([]);

      // 2. THE SCHEMA SOURCE: no `.references(` in src/db/schema/** is declared on, or points
      //    at, an external_key column — so a future migration cannot be generated with one.
      const dir = 'src/db/schema';
      const files = nodeFs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
      expect(files.length).toBeGreaterThan(5); // a wrong directory cannot pass by reading nothing
      const owners: string[] = [];
      for (const f of files) {
        const src = nodeFs.readFileSync(nodePath.join(dir, f), 'utf8');
        for (let i = src.indexOf('.references('); i !== -1; i = src.indexOf('.references(', i + 1)) {
          const before = src.slice(0, i);
          const cols = [...before.matchAll(/\b[a-zA-Z]+\('([a-z0-9_]+)'/g)];
          const owner = cols[cols.length - 1]?.[1] ?? '?';
          const target = src.slice(i, src.indexOf(')', src.indexOf('=>', i)) + 1);
          owners.push(owner);
          expect({ file: f, owner, target }).not.toMatchObject({ owner: 'external_key' });
          expect(target).not.toMatch(/externalKey|external_key/);
        }
      }
      // Positive control on the scanner: it attributes a known reference to its column.
      expect(owners).toContain('merged_into_id');
      expect(owners).not.toContain('external_key');
    }));
});

describe('the insert path draws a fresh key on collision', () => {
  it('the insert path retries on an external key collision', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const x = asEtlExecutor(c);
      await setEtlActor(x, 'ingest-comptroller');
      await resolveEtlOrg(x, 'org_A');
      const [first] = await seedComptrollerFixture(c, a);
      const taken = (
        await c.query<{ k: string }>('select external_key as k from businesses where id = $1', [
          first!.businessId,
        ])
      ).rows[0]!.k;

      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        externalId: '99999999999-1',
        payload: { outlet_name: 'COLLISION TEST' },
        sourceVersion: null,
        seenAt: new Date(),
      });
      const draws = [taken, 'SL-7F3K2Q'];
      let drawn = 0;
      const b = await upsertBusinessFromSource(
        x,
        sr.id,
        { displayName: 'COLLISION TEST', primarySource: 'tx_comptroller' },
        { orgId: a, changed: sr.changed, keyGen: () => draws[drawn++]! },
      );
      expect(drawn).toBe(2); // the taken key was tried, refused silently, and redrawn
      expect(b).toMatchObject({ wrote: true, inserted: true });
      const row = await c.query<{ external_key: string; linked: string }>(
        `select b.external_key, sr.business_id as linked
           from businesses b join source_records sr on sr.business_id = b.id
          where b.id = $1`,
        [b.businessId],
      );
      expect(row.rows[0]).toEqual({ external_key: 'SL-7F3K2Q', linked: b.businessId });
    }));

  it('the insert path gives up after five collisions', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const x = asEtlExecutor(c);
      const [first] = await seedComptrollerFixture(c, a);
      const taken = (
        await c.query<{ k: string }>('select external_key as k from businesses where id = $1', [
          first!.businessId,
        ])
      ).rows[0]!.k;
      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        externalId: '99999999999-2',
        payload: { outlet_name: 'ALWAYS TAKEN' },
        sourceVersion: null,
        seenAt: new Date(),
      });
      let drawn = 0;
      await expect(
        upsertBusinessFromSource(
          x,
          sr.id,
          { displayName: 'ALWAYS TAKEN', primarySource: 'tx_comptroller' },
          {
            orgId: a,
            changed: sr.changed,
            keyGen: () => {
              drawn++;
              return taken;
            },
          },
        ),
      ).rejects.toMatchObject({ name: 'ExternalKeyExhaustedError' });
      expect(drawn).toBe(EXTERNAL_KEY_ATTEMPTS);
      // DO NOTHING aborts nothing: the transaction is still usable, and nothing was linked.
      const linked = await c.query('select business_id from source_records where id = $1', [sr.id]);
      expect(linked.rows[0]).toEqual({ business_id: null });
    }));
});
