/**
 * D-11 chain detection (src/lib/resolve/chain.ts) and the D-03 closure feed against the live
 * local database.
 *
 * 🔴 THE CLOSURE WRITE UNDER TEST IS 03-12's SHIPPED ONE — `applyClosures` /
 * `CLOSURE_UPDATE_SQL` in scripts/ingest-comptroller.ts — imported, never re-typed. A test that
 * copies the statement cannot catch the script drifting from it. (The research SQL set
 * `closed_at` from a `source_records.closed_at` column that does not exist; the shipped
 * statement reads `payload->>'out_of_business_date'` in America/Chicago.)
 *
 * 🔴 DESK-SCRIPT CONNECTION SHAPE: the owner connection with `setEtlActor` + `resolveEtlOrg`,
 * NO `actAs` — both statements run inside desk scripts (the resolve pass, the Comptroller
 * ingest), which have no Clerk session.
 *
 * Closures are seeded through the SHIPPED path: `closureRowToSourceRecord` (the D-03 transform)
 * → `upsertSourceRecord`, and permits through `comptrollerIngestInput` →
 * `upsertBusinessFromSource`, so the key equality under test is the one production builds.
 *
 * Tens of rows, all inside `withRollback`; nothing is committed.
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyClosures } from '../../scripts/ingest-comptroller';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import { upsertBusinessFromSource, upsertSourceRecord } from '@/lib/ingest/upsert';
import { detectChains } from '@/lib/resolve/chain';
import { nameNorm } from '@/lib/normalize';
import { closureRowSchema, closureRowToSourceRecord } from '@/lib/socrata/closures';
import { SQL_FRESH_EXTERNAL_KEY, seedTwoOrgs, withRollback } from './_fixtures';
import {
  asEtlExecutor,
  COMPTROLLER_FIXTURE,
  overtureIngestInput,
  OVERTURE_FIXTURE,
  seedComptrollerFixture,
  seedIngestRun,
} from './_ingest-fixtures';

/**
 * A `tx_comptroller` run carrying `stats.statewide_name_frequency`, exactly where 03-12's
 * `runPermitsPass` writes it (`stats || jsonb_build_object('statewide_name_frequency', …)`).
 */
async function seedStatewideRun(
  c: Client,
  orgId: string,
  frequency: Record<string, number>,
  status: 'complete' | 'failed' = 'complete',
): Promise<string> {
  const runId = await seedIngestRun(c, orgId, 'tx_comptroller');
  await c.query(
    `update ingest_runs
        set status = $2, finished_at = clock_timestamp(),
            stats = jsonb_build_object('statewide_name_frequency', $3::jsonb)
      where id = $1`,
    [runId, status, JSON.stringify(frequency)],
  );
  return runId;
}

async function asDeskScript(c: Client): Promise<{ a: string; b: string }> {
  const orgs = await seedTwoOrgs(c);
  const x = asEtlExecutor(c);
  await setEtlActor(x, 'resolve');
  expect(await resolveEtlOrg(x, 'org_A')).toBe(orgs.a);
  return orgs;
}

/** One business with a given normalized name (already normal), optionally merged away. */
async function named(c: Client, orgId: string, nameNorm: string, mergedInto: string | null = null): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into businesses (org_id, external_key, display_name, name_norm, merged_into_id)
     values ($1, ${SQL_FRESH_EXTERNAL_KEY}, $2, $2, $3) returning id`,
    [orgId, nameNorm, mergedInto],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('named: insert returned no row');
  return id;
}

const chainKeys = async (c: Client, ids: string[]): Promise<Map<string, string | null>> =>
  new Map(
    (
      await c.query<{ id: string; chain_key: string | null }>(
        'select id, chain_key from businesses where id = any($1::uuid[])',
        [ids],
      )
    ).rows.map((r) => [r.id, r.chain_key]),
  );

/** A closure source record through the shipped transform + upsert. */
async function seedClosure(
  c: Client,
  orgId: string,
  tp: string,
  loc: string,
  outOfBusiness: string,
): Promise<{ sourceRecordId: string; closedAtMs: number }> {
  const row = closureRowSchema.parse({
    tp_number: tp,
    loc_number: loc,
    loc_name: 'CLOSED OUTLET',
    loc_county: '108',
    out_of_business_date: outOfBusiness,
  });
  const rec = closureRowToSourceRecord(row, '2026-09-20T00:00:00.000Z');
  const sr = await upsertSourceRecord(asEtlExecutor(c), {
    orgId,
    sourceKey: rec.sourceKey,
    externalId: rec.externalId,
    payload: rec.payload,
    sourceVersion: rec.sourceVersion,
    seenAt: new Date(),
  });
  return { sourceRecordId: sr.id, closedAtMs: rec.closedAt.getTime() };
}

interface Closure {
  id: string;
  comptroller_key: string | null;
  closed_ms: string | null;
  closed_at_source_id: string | null;
}

const closures = async (c: Client, orgId: string): Promise<Map<string, Closure>> =>
  new Map(
    (
      await c.query<Closure>(
        `select id, comptroller_key, (extract(epoch from closed_at) * 1000)::bigint::text as closed_ms,
                closed_at_source_id
           from businesses where org_id = $1`,
        [orgId],
      )
    ).rows.map((r) => [r.id, r]),
  );

describe('chain detection', () => {
  it('chain_key >= 3', async () => {
    await withRollback(async (c) => {
      const { a, b } = await asDeskScript(c);
      const three = [
        await named(c, a, 'firestone complete auto care'),
        await named(c, a, 'firestone complete auto care'),
        await named(c, a, 'firestone complete auto care'),
      ];
      const two = [await named(c, a, 'tacos el guero'), await named(c, a, 'tacos el guero')];
      const one = await named(c, a, 'la estrella bakery');

      const r = await detectChains(asEtlExecutor(c), a);
      expect(r).toEqual({ names: 1, rows: 3, flagged: 3, cleared: 0, statewide: false });

      const keys = await chainKeys(c, [...three, ...two, one]);
      for (const id of three) expect(keys.get(id)).toBe('firestone complete auto care');
      for (const id of two) expect(keys.get(id)).toBeNull();
      expect(keys.get(one)).toBeNull();

      // Write-gated: a re-run over an unchanged spine touches nothing.
      expect(await detectChains(asEtlExecutor(c), a)).toEqual({
        names: 1, rows: 3, flagged: 0, cleared: 0, statewide: false,
      });

      // "Across Texas" (03-12's contract): the statewide frequency on the latest COMPLETE
      // tx_comptroller run makes a two-outlet RGV name a chain. Neither a FAILED run's map nor
      // ANOTHER ORG's may count — each names the one-outlet bakery, which must stay unflagged.
      await seedStatewideRun(c, a, { 'tacos el guero': 41 });
      await seedStatewideRun(c, a, { 'la estrella bakery': 12 }, 'failed');
      await seedStatewideRun(c, b, { 'la estrella bakery': 12 });
      expect(await detectChains(asEtlExecutor(c), a)).toEqual({
        names: 2, rows: 5, flagged: 2, cleared: 0, statewide: true,
      });
      const after = await chainKeys(c, [...two, one]);
      for (const id of two) expect(after.get(id)).toBe('tacos el guero');
      expect(after.get(one)).toBeNull();
    });
  });

  /**
   * B-WR-05, the chain-detection half (review 03). D-12 strips the generic trade words for
   * SIMILARITY, which is right; but chain detection grouped on that same key, so "Taqueria
   * Garcia", "Panaderia Garcia" and "Carniceria Garcia" — three unrelated family businesses,
   * the dominant RGV naming pattern — all became `garcia`, were flagged a chain ("Chain · 3 in
   * Texas") and each lost auto-merge against its own true duplicate. The chain key keeps the
   * trade words a name was reduced by; a statewide count keyed by the reduced name is not that
   * business's identity either.
   */
  it('surname-plus-trade names are not one chain; three of the same trade name are', async () => {
    await withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const raw = async (displayName: string) => {
        const r = await c.query<{ id: string }>(
          `insert into businesses (org_id, external_key, display_name, name_norm)
           values ($1, ${SQL_FRESH_EXTERNAL_KEY}, $2, $3) returning id`,
          [a, displayName, nameNorm(displayName)],
        );
        return r.rows[0]!.id;
      };
      const families = [
        await raw('Taqueria Garcia'),
        await raw('Panadería Garcia'),
        await raw('CARNICERIA GARCIA'),
      ];
      // Positive control on the premise: all three really share one normalized name.
      expect(['Taqueria Garcia', 'Panadería Garcia', 'CARNICERIA GARCIA'].map(nameNorm)).toEqual([
        'garcia',
        'garcia',
        'garcia',
      ]);
      // The statewide map says "garcia" is everywhere — it is the reduced name, not theirs.
      await seedStatewideRun(c, a, { garcia: 57 });

      const outlets = [
        await raw('Taqueria El Rey'),
        await raw('TAQUERIA EL REY'),
        await raw('Taquería El Rey'),
      ];
      await detectChains(asEtlExecutor(c), a);
      const keys = await chainKeys(c, [...families, ...outlets]);
      for (const id of families) expect(keys.get(id), 'a family business').toBeNull();
      // Three outlets of ONE trade name are a real local chain, keyed with the trade word.
      for (const id of outlets) expect(keys.get(id)).toBe('taqueria rey');
    });
  });

  it('chain detection skips merged-away rows', async () => {
    await withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const winner = await named(c, a, 'valley auto glass');
      const live2 = await named(c, a, 'valley auto glass');
      // Three rows share the name, but one is merged away: two LIVE members, not a chain.
      const merged = await named(c, a, 'valley auto glass', winner);

      expect(await detectChains(asEtlExecutor(c), a)).toEqual({
        names: 0, rows: 0, flagged: 0, cleared: 0, statewide: false,
      });
      const keys = await chainKeys(c, [winner, live2, merged]);
      expect([...keys.values()]).toEqual([null, null, null]);

      // A stale flag on a merged-away row is cleared, and a fourth live member makes it a chain
      // of three — flagged on the three live rows and NOT on the merged one.
      await c.query('update businesses set chain_key = $2 where id = $1', [merged, 'valley auto glass']);
      const live3 = await named(c, a, 'valley auto glass');
      expect(await detectChains(asEtlExecutor(c), a)).toEqual({
        names: 1, rows: 3, flagged: 3, cleared: 1, statewide: false,
      });
      const after = await chainKeys(c, [winner, live2, live3, merged]);
      expect(after.get(winner)).toBe('valley auto glass');
      expect(after.get(live2)).toBe('valley auto glass');
      expect(after.get(live3)).toBe('valley auto glass');
      expect(after.get(merged)).toBeNull();
    });
  });
});

describe('the closure feed', () => {
  it('closure exact match', async () => {
    await withRollback(async (c) => {
      const { a, b } = await asDeskScript(c);
      // COMPTROLLER_FIXTURE rows 0 and 1: one taxpayer, outlets 5 and 6 — keys differing only
      // in the outlet suffix.
      const seeded = await seedComptrollerFixture(c, a, COMPTROLLER_FIXTURE.slice(0, 3));
      const byKey = new Map(seeded.map((s) => [s.externalId, s.businessId]));
      expect([...byKey.keys()]).toEqual(['32006170057-5', '32006170057-6', '17412345678-1']);
      // The same permit in org B must stay open: the pass is org-scoped.
      const inB = await seedComptrollerFixture(c, b, COMPTROLLER_FIXTURE.slice(0, 1));

      // 31 December at Chicago midnight: read as UTC it would land in the PREVIOUS YEAR.
      const { sourceRecordId, closedAtMs } = await seedClosure(c, a, '32006170057', '5', '2023-12-31T00:00:00.000');
      expect(new Date(closedAtMs).toISOString()).toBe('2023-12-31T06:00:00.000Z');

      expect(await applyClosures(asEtlExecutor(c), a)).toEqual({ closed: 1, viaMerge: 0 });

      const rows = await closures(c, a);
      const hit = rows.get(byKey.get('32006170057-5')!)!;
      expect(Number(hit.closed_ms)).toBe(closedAtMs); // SQL's Chicago reading = the transform's
      expect(hit.closed_at_source_id).toBe(sourceRecordId);
      for (const [id, r] of rows) {
        if (id === hit.id) continue;
        expect(r.closed_ms, `${r.comptroller_key} must stay open`).toBeNull();
        expect(r.closed_at_source_id).toBeNull();
      }
      expect(rows.get(byKey.get('32006170057-6')!)?.closed_ms).toBeNull();
      const bRow = (await closures(c, b)).get(inB[0]!.businessId);
      expect(bRow?.closed_ms).toBeNull();

      // Write-gated: a re-run of an unchanged feed closes nothing new.
      expect(await applyClosures(asEtlExecutor(c), a)).toEqual({ closed: 0, viaMerge: 0 });
    });
  });

  it('closure applies to the merge winner', async () => {
    await withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const [loser] = await seedComptrollerFixture(c, a, COMPTROLLER_FIXTURE.slice(3, 4)); // 17498765432-1
      const winner = await named(c, a, 'la estrella bakery');
      await c.query('update businesses set merged_into_id = $2 where id = $1', [loser!.businessId, winner]);

      const { sourceRecordId, closedAtMs } = await seedClosure(c, a, '17498765432', '1', '2025-07-04T00:00:00.000');
      expect(new Date(closedAtMs).toISOString()).toBe('2025-07-04T05:00:00.000Z'); // CDT

      expect(await applyClosures(asEtlExecutor(c), a)).toEqual({ closed: 1, viaMerge: 1 });
      const rows = await closures(c, a);
      expect(Number(rows.get(winner)?.closed_ms)).toBe(closedAtMs);
      expect(rows.get(winner)?.closed_at_source_id).toBe(sourceRecordId);
      // The merged-away row is not the business anybody sees; it is not the one closed.
      expect(rows.get(loser!.businessId)?.closed_ms).toBeNull();
    });
  });

  it('overture permanently_closed does not write closed_at', async () => {
    await withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const x = asEtlExecutor(c);
      const input = overtureIngestInput(OVERTURE_FIXTURE[0]!);
      // Since 03-13 this runs the production transform, which returns null for a skipped row.
      if (input === null) throw new Error('fixture row 0 was skipped by the transform');
      input.derived.operatingStatus = 'permanently_closed';
      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'overture',
        externalId: input.externalId,
        payload: input.payload,
        sourceVersion: '2026-08-19.0',
        seenAt: new Date(),
      });
      const { businessId } = await upsertBusinessFromSource(x, sr.id, input.derived, { orgId: a, changed: sr.changed });
      // A real Comptroller closure elsewhere in the org, so the pass demonstrably ran.
      const [permit] = await seedComptrollerFixture(c, a, COMPTROLLER_FIXTURE.slice(4, 5)); // 32045678901-1
      await seedClosure(c, a, '32045678901', '1', '2024-02-01T00:00:00.000');

      expect(await applyClosures(x, a)).toEqual({ closed: 1, viaMerge: 0 });

      const row = (
        await c.query<{ operating_status: string | null; closed_at: string | null; closed_at_source_id: string | null }>(
          'select operating_status, closed_at, closed_at_source_id from businesses where id = $1',
          [businessId],
        )
      ).rows[0];
      // Stored and reportable — and NOT a closure (D-03, D-14: 3kx8-uryv is the only source).
      expect(row?.operating_status).toBe('permanently_closed');
      expect(row?.closed_at).toBeNull();
      expect(row?.closed_at_source_id).toBeNull();
      expect((await closures(c, a)).get(permit!.businessId)?.closed_ms).not.toBeNull();
    });
  });
});
