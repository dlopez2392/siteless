/**
 * The meter's mode gate (D-02, M28, M29) — pure, and first.
 *
 * `modeAllows` decides whether a Places request may even be RESERVED. It runs before any SQL,
 * so a kill switch set to `off`, an `ids_only` deployment asked for an Enterprise mask, or a
 * deployment with no key costs nothing and leaves no reservation behind.
 *
 * 🔴 `@/db/client` is mocked because importing it parses src/env.ts, which throws without the
 * server environment — and this lane must run with none (CI's unit job has no database).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({ withWorkerOrg: vi.fn() }));

vi.mock('@/db/client', () => ({ db: {} }));
vi.mock('@/db/with-worker-org', () => ({ withWorkerOrg: seams.withWorkerOrg }));

import { modeAllows, reservePage, type PlacesMode } from '@/lib/places/meter';

beforeEach(() => {
  seams.withWorkerOrg.mockReset();
  seams.withWorkerOrg.mockRejectedValue(new Error('the database was reached'));
});

describe('the Places mode gate', () => {
  it('ids_only refuses an Enterprise mask', () => {
    expect(modeAllows('ids_only', 'ts_enterprise', true)).toBe('mode_forbids_sku');
    // Every paid Text Search tier, not only the one the sweep uses.
    expect(modeAllows('ids_only', 'ts_pro', true)).toBe('mode_forbids_sku');
    expect(modeAllows('ids_only', 'ts_enterprise_atmosphere', true)).toBe('mode_forbids_sku');
    // The positive half: the free IDs-only mask is exactly what ids_only exists for.
    expect(modeAllows('ids_only', 'ts_essentials', true)).toBe(true);
  });

  it('off refuses every sku', () => {
    expect(modeAllows('off', 'ts_enterprise', true)).toBe('places_off');
    expect(modeAllows('off', 'ts_essentials', true)).toBe('places_off');
    expect(modeAllows('off', 'ts_pro', true)).toBe('places_off');
    // `off` wins over a missing key: the switch is the answer an operator set on purpose.
    expect(modeAllows('off', 'ts_enterprise', false)).toBe('places_off');
  });

  it('enterprise permits the full and the ids-only mask', () => {
    expect(modeAllows('enterprise', 'ts_enterprise', true)).toBe(true);
    expect(modeAllows('enterprise', 'ts_essentials', true)).toBe(true);
    // Only the two masks the adapter builds (src/lib/budget/field-mask-tier.ts). A Pro or an
    // Atmosphere mask is a request the estimate never priced.
    expect(modeAllows('enterprise', 'ts_pro', true)).toBe('mode_forbids_sku');
    expect(modeAllows('enterprise', 'ts_enterprise_atmosphere', true)).toBe('mode_forbids_sku');
  });

  it('a missing key is refused even in enterprise mode', () => {
    expect(modeAllows('enterprise', 'ts_enterprise', false)).toBe('places_key_missing');
    expect(modeAllows('ids_only', 'ts_essentials', false)).toBe('places_key_missing');
  });

  it('an unknown mode refuses rather than defaulting open', () => {
    // A value that slipped past env parsing (a cast, a stale deployment) must not read as on.
    expect(modeAllows('Enterprise' as PlacesMode, 'ts_enterprise', true)).toBe('places_off');
  });

  it('a refused mode never reaches the database', async () => {
    const ctx = { clerkOrgId: 'org_A', runId: '00000000-0000-4000-8000-000000000001' };
    const base = { searchId: '00000000-0000-4000-8000-000000000002', page: 1 as const };
    await expect(
      reservePage(ctx, { ...base, sku: 'ts_enterprise', mode: 'off', keyConfigured: true }),
    ).resolves.toEqual({ kind: 'refused', reason: 'places_off' });
    await expect(
      reservePage(ctx, { ...base, sku: 'ts_enterprise', mode: 'ids_only', keyConfigured: true }),
    ).resolves.toEqual({ kind: 'refused', reason: 'mode_forbids_sku' });
    await expect(
      reservePage(ctx, { ...base, sku: 'ts_enterprise', mode: 'enterprise', keyConfigured: false }),
    ).resolves.toEqual({ kind: 'refused', reason: 'places_key_missing' });
    expect(seams.withWorkerOrg).not.toHaveBeenCalled();

    // The control: a permitted mode DOES reach the (here: refusing) database seam, so the
    // assertion above is about the gate and not about a seam that is never wired.
    await expect(
      reservePage(ctx, { ...base, sku: 'ts_enterprise', mode: 'enterprise', keyConfigured: true }),
    ).rejects.toThrow('the database was reached');
    expect(seams.withWorkerOrg).toHaveBeenCalledTimes(1);
  });
});
