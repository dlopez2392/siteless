/**
 * Phase 4 plan 09. The Places schema's guarantees as DATABASE FACTS (drizzle/0026 + 0027).
 *
 *   * D-10 — observations are append-only: by grant for a tenant session (42501 "permission
 *     denied for table place_observations"), and by a raising trigger even for the owner (55000).
 *   * D-12 — coordinates: authenticated cannot read them at all (42501, M37), and none can be
 *     kept past 30 days (23514 pc_expiry_within_30_days).
 *   * D-09 — the host class cannot disagree with the boolean (po_host_class_agrees).
 *   * D-15 / T-4-02 — one active run per org (23505 runs_one_active_per_org).
 *   * D-05 / D-08 — the signal view counts ATTACHED listings only (M43), is true if ANY attached
 *     listing's LATEST observation is true, and is tenant-scoped through security_invoker.
 *   * T-4-12 — runs.ceiling_requests is outside the UPDATE column grant.
 *   * T-4-05 / M18 — businesses gains no Places-derived column.
 *
 * Every refusal is its own `withRollback` (a refusal aborts the transaction; the next
 * statement reports 25P02), pinned by SQLSTATE AND message or constraint name, and paired
 * with a positive control proving the same session could do the neighbouring legitimate
 * thing — so the refusal is the grant/trigger/constraint and not a broken fixture.
 *
 * Mutations (live DB, reverted): M37 `grant select on place_coordinates to authenticated` →
 * "authenticated cannot read place coordinates" red. M43 recreate the view without
 * `where a.status = 'attached'` → "a tentative attachment is excluded from the signal" red.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedAttachmentWithObservation,
  seedPlacesRun,
  seedPlacesSpine,
  seedRunSearch,
} from './_places-fixtures';

/** Org A with the spine, a running run, and ortiz attached to one place with one observation. */
async function seedOneObservation(c: Client, opts: { withCoordinates?: boolean } = {}) {
  const { a, b } = await seedTwoOrgs(c);
  const spine = await seedPlacesSpine(c, a);
  const run = await seedPlacesRun(c, a);
  const seeded = await seedAttachmentWithObservation(c, {
    orgId: a,
    businessId: spine.ortiz,
    placeId: 'synthetic-place-ortiz',
    runId: run.runId,
    status: 'attached',
    hadWebsiteUri: false,
    hostClass: 'none',
    withCoordinates: opts.withCoordinates ?? false,
  });
  return { a, b, spine, run, ...seeded };
}

type SignalRow = {
  business_id: string;
  had_website_uri: boolean;
  host_class: string;
  listings: number;
};

describe('places schema', () => {
  it('place observations are append-only: update is refused', () =>
    withRollback(async (c) => {
      await seedOneObservation(c);
      await actAs(c, CLAIMS_A);
      // Positive control: the tenant session SEES its observation, so the refusal below is
      // the grant, not RLS filtering the row out of reach.
      const seen = await c.query('select id from place_observations');
      expect(seen.rowCount).toBe(1);
      const attempt = c.query('update place_observations set had_website_uri = true');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table place_observations/);
    }));

  it('place observations are append-only: delete is refused', () =>
    withRollback(async (c) => {
      await seedOneObservation(c);
      await actAs(c, CLAIMS_A);
      const seen = await c.query('select id from place_observations');
      expect(seen.rowCount).toBe(1);
      const attempt = c.query('delete from place_observations');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table place_observations/);
    }));

  it('the append-only trigger refuses even the owner', () =>
    withRollback(async (c) => {
      const { observationId } = await seedOneObservation(c);
      // Still the owner: bypasses grants and RLS, but not triggers. Positive control — the
      // owner just INSERTED this row, so the refusal is the UPDATE arm and nothing broader.
      const seen = await c.query('select 1 from place_observations where id = $1', [observationId]);
      expect(seen.rowCount).toBe(1);
      const attempt = c.query(
        "update place_observations set had_website_uri = true, host_class = 'social' where id = $1",
        [observationId],
      );
      await expect(attempt).rejects.toMatchObject({ code: '55000' });
      await expect(attempt).rejects.toThrow(/append-only/);
    }));

  it('authenticated cannot read place coordinates', () =>
    withRollback(async (c) => {
      const { coordinateId } = await seedOneObservation(c, { withCoordinates: true });
      // The row exists (owner view), so the refusal is not an empty table reading as "fine".
      const held = await c.query('select 1 from place_coordinates where id = $1', [coordinateId]);
      expect(held.rowCount).toBe(1);
      await actAs(c, CLAIMS_A);
      // Positive control: the same tenant session reads the observation the coordinate hangs
      // off — the session is healthy; only the coordinates are out of reach.
      const obs = await c.query('select id from place_observations');
      expect(obs.rowCount).toBe(1);
      const attempt = c.query('select * from place_coordinates');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table place_coordinates/);
    }));

  it('a coordinate cannot be kept past 30 days', () =>
    withRollback(async (c) => {
      const { a, spine, run } = await seedOneObservation(c);
      // Two further observations, so the positive control and the refusal never share the
      // one-coordinate-per-observation unique key.
      const ok = await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-place-garza',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      const late = await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.valley,
        placeId: 'synthetic-place-valley',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      const INSERT = `insert into place_coordinates (org_id, observation_id, lat, lng, observed_at, expires_at)
                      values ($1, $2, 26.2, -98.2, now(), now() + $3::interval)`;
      // Positive control: EXACTLY 30 days is the longest the CHECK allows, and is accepted.
      const accepted = await c.query(INSERT, [a, ok.observationId, '30 days']);
      expect(accepted.rowCount).toBe(1);
      const attempt = c.query(INSERT, [a, late.observationId, '31 days']);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pc_expiry_within_30_days',
      });
    }));

  it("an observation's host class agrees with its boolean", () =>
    withRollback(async (c) => {
      const { a, spine, attachmentId } = await seedOneObservation(c);
      const INSERT = `insert into place_observations (org_id, business_id, place_id, run_id, attachment_id,
                                                      had_website_uri, host_class, sku, pure_sab)
                      values ($1, $2, $3, $4, $5, $6, $7, 'ts_enterprise', false)`;
      // Positive control: a consistent pair (a website, classed social) inserts. A different
      // run keeps the (run, business, place) unique key out of the way.
      const run2 = await seedPlacesRun(c, a, { status: 'complete' });
      const accepted = await c.query(INSERT, [
        a,
        spine.ortiz,
        'synthetic-place-ortiz',
        run2.runId,
        attachmentId,
        true,
        'social',
      ]);
      expect(accepted.rowCount).toBe(1);
      const run3 = await seedPlacesRun(c, a, { status: 'complete' });
      const attempt = c.query(INSERT, [
        a,
        spine.ortiz,
        'synthetic-place-ortiz',
        run3.runId,
        attachmentId,
        false,
        'social',
      ]);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'po_host_class_agrees',
      });
    }));

  it('one active run per org', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      await seedPlacesRun(c, a, { status: 'queued' });
      // Positive controls: a finished run in org A, and a queued run in org B, are both fine —
      // the index is per org and only over queued/running.
      await seedPlacesRun(c, a, { status: 'complete' });
      await seedPlacesRun(c, b, { status: 'queued' });
      const attempt = seedPlacesRun(c, a, { status: 'queued' });
      await expect(attempt).rejects.toMatchObject({
        code: '23505',
        constraint: 'runs_one_active_per_org',
      });
    }));

  it('a tentative attachment is excluded from the signal', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a);
      // garza: ONLY a tentative listing, whose latest observation says it HAS a website.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-place-garza',
        runId: run.runId,
        status: 'tentative',
        hadWebsiteUri: true,
        hostClass: 'other',
      });
      // valley: a rejected listing, also saying true.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.valley,
        placeId: 'synthetic-place-valley',
        runId: run.runId,
        status: 'rejected',
        hadWebsiteUri: true,
        hostClass: 'other',
      });
      // Positive control: ortiz is attached, so the view is live for this session.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-place-ortiz',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      await actAs(c, CLAIMS_A);
      const { rows } = await c.query<SignalRow>(
        'select business_id, had_website_uri, host_class, listings from business_place_signal',
      );
      expect(rows.map((r) => r.business_id)).toEqual([spine.ortiz]);
      expect(rows[0]).toMatchObject({ had_website_uri: false, host_class: 'none', listings: 1 });
    }));

  it("the signal is true if any attached listing's latest observation is true", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const older = await seedPlacesRun(c, a, { status: 'complete' });
      const latest = await seedPlacesRun(c, a, { status: 'running' });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
      const now = new Date();
      // ortiz: two attached listings — one says no website, the other says social. ANY → true.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-place-ortiz-1',
        runId: latest.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: now,
      });
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-place-ortiz-2',
        runId: latest.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'social',
        observedAt: now,
      });
      // garza: ONE listing whose OLDER observation had a website and whose LATEST does not.
      // Only the latest counts, so it contributes false.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-place-garza',
        runId: older.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'business_site_dead',
        observedAt: twoDaysAgo,
      });
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-place-garza',
        runId: latest.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
        observedAt: now,
      });
      await actAs(c, CLAIMS_A);
      const { rows } = await c.query<SignalRow>(
        'select business_id, had_website_uri, host_class, listings from business_place_signal',
      );
      const byId = Object.fromEntries(rows.map((r) => [r.business_id, r]));
      expect(rows).toHaveLength(2);
      expect(byId[spine.ortiz]).toMatchObject({
        had_website_uri: true,
        host_class: 'social',
        listings: 2,
      });
      expect(byId[spine.garza]).toMatchObject({
        had_website_uri: false,
        host_class: 'none',
        listings: 1,
      });
    }));

  // A-WR-04. No merge definer touches place_attachments, so a listing that attached BEFORE its
  // business was merged away stays keyed to the loser. The signal resolves live roots instead:
  // the survivor's verdict input includes the loser's attached listings, and the loser (hidden
  // everywhere once merged) has no row of its own. An unmerge restores both, with no data moved.
  it("a merged business's attached listing counts toward its survivor's signal", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a);
      // garza (the survivor) has a listing with no website; ortiz (the loser) has one WITH a
      // website, attached before the merge.
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.garza,
        placeId: 'synthetic-place-garza',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spine.ortiz,
        placeId: 'synthetic-place-ortiz',
        runId: run.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'social',
      });
      await c.query(`update businesses set merged_into_id = $1, status = 'merged' where id = $2`, [
        spine.garza,
        spine.ortiz,
      ]);
      await actAs(c, CLAIMS_A);
      const { rows } = await c.query<SignalRow>(
        `select business_id, had_website_uri, host_class, listings from business_place_signal
          where business_id = any($1::uuid[])`,
        [[spine.garza, spine.ortiz]],
      );
      // Not a false "no website": the survivor carries the loser's listing.
      expect(rows).toEqual([
        { business_id: spine.garza, had_website_uri: true, host_class: 'social', listings: 2 },
      ]);
    }));

  it('the signal view is tenant-scoped', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      const spineA = await seedPlacesSpine(c, a);
      const runA = await seedPlacesRun(c, a);
      await seedAttachmentWithObservation(c, {
        orgId: a,
        businessId: spineA.ortiz,
        placeId: 'synthetic-place-ortiz',
        runId: runA.runId,
        status: 'attached',
        hadWebsiteUri: false,
        hostClass: 'none',
      });
      // Org B's own signal row: the positive control that B's session reads the view at all.
      const bBiz = await seedPlacesSpine(c, b);
      const runB = await seedPlacesRun(c, b);
      await seedAttachmentWithObservation(c, {
        orgId: b,
        businessId: bBiz.valley,
        placeId: 'synthetic-place-valley-b',
        runId: runB.runId,
        status: 'attached',
        hadWebsiteUri: true,
        hostClass: 'directory',
      });
      await actAs(c, CLAIMS_B);
      const { rows } = await c.query<{ org_id: string; business_id: string }>(
        'select org_id, business_id from business_place_signal',
      );
      expect(rows).toEqual([{ org_id: b, business_id: bBiz.valley }]);
      const leak = await c.query('select 1 from business_place_signal where org_id = $1', [a]);
      expect(leak.rowCount).toBe(0);
    }));

  it('grants: runs heartbeat_at is updatable and ceiling_requests is not', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{
        heartbeat_at: boolean;
        workflow_run_id: boolean;
        ceiling_requests: boolean;
        status: boolean;
      }>(`
        select has_column_privilege('authenticated','public.runs','heartbeat_at','UPDATE')     as heartbeat_at,
               has_column_privilege('authenticated','public.runs','workflow_run_id','UPDATE')  as workflow_run_id,
               has_column_privilege('authenticated','public.runs','ceiling_requests','UPDATE') as ceiling_requests,
               has_column_privilege('authenticated','public.runs','status','UPDATE')           as status`);
      expect(rows[0]).toEqual({
        heartbeat_at: true,
        workflow_run_id: true,
        ceiling_requests: false,
        // Positive control: the 0013 grant is intact beside the two new columns.
        status: true,
      });

      // The attempt, not only the catalog: stamping a heartbeat on its own run succeeds, and
      // raising its own ceiling is refused by the column grant.
      const { a } = await seedTwoOrgs(c);
      const run = await seedPlacesRun(c, a, { ceilingRequests: 20 });
      await actAs(c, CLAIMS_A);
      const beat = await c.query('update runs set heartbeat_at = now() where id = $1', [run.runId]);
      expect(beat.rowCount).toBe(1);
      const attempt = c.query('update runs set ceiling_requests = 999 where id = $1', [run.runId]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table runs/);
    }));

  // Not one of the plan's twelve proofs: a smoke test of the shared fixture 04-15/04-18/04-20
  // seed with, so a broken seedRunSearch fails HERE, named, and not three plans downstream.
  it('fixtures: seedRunSearch shares one tile across runs and records one search per run', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const older = await seedPlacesRun(c, a, { status: 'complete' });
      const latest = await seedPlacesRun(c, a);
      const tileKey = 'city:48215/McAllen|plumber|r';
      const first = await seedRunSearch(c, a, older.runId, { tileKey, placesType: 'plumber' });
      const second = await seedRunSearch(c, a, latest.runId, { tileKey, placesType: 'plumber' });
      expect(second.tileId).toBe(first.tileId);
      const { rows } = await c.query<{
        unit_kind: string;
        unit_id: string;
        quad_path: string;
        searches: number;
      }>(
        `select t.unit_kind, t.unit_id, t.quad_path,
                (select count(*)::int from run_searches s where s.tile_id = t.id) as searches
           from place_tiles t where t.id = $1`,
        [first.tileId],
      );
      expect(rows).toEqual([
        { unit_kind: 'city', unit_id: '48215/McAllen', quad_path: 'r', searches: 2 },
      ]);
      const cell = await c.query<{ cell_key: string }>(
        'select cell_key from run_searches where id = $1',
        [first.runSearchId],
      );
      expect(cell.rows[0]?.cell_key).toBe('home_services/48215/McAllen');
    }));

  it('businesses gains no Places-derived column', () =>
    withRollback(async (c) => {
      const COLS = `select column_name from information_schema.columns
                     where table_schema = 'public' and table_name = 'businesses'
                       and column_name like any ($1::text[])`;
      // Positive control: the predicate genuinely matches on this table.
      const control = await c.query(COLS, [['%name%']]);
      expect(control.rowCount).toBeGreaterThan(0);
      const { rows } = await c.query<{ column_name: string }>(COLS, [
        ['%website%', '%place%', '%host_class%', '%sab%'],
      ]);
      // No google_places provenance pair either (M18's composite FK stays untouched): every
      // *_source_id pair on businesses predates Phase 4.
      expect(rows.map((r) => r.column_name)).toEqual([]);
    }));
});
