import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/cron/purge-places` (04-17, D-12, M50) — the bearer gate and the fixed-enum bodies.
 *
 * Route code, not step code: `@/env` and `@/db/with-cron-role` are mocked here, and the real
 * purge (its grant, its idempotence, its one-row-per-org result) is proven against the database
 * in `tests/db/places-definers.test.ts`. What this file proves is the part no database test can
 * see — who gets as far as `withCronRole` at all, and what the response body is allowed to say.
 *
 * `withCronRole` is mocked to RUN the route's callback against a fake transaction whose
 * `execute` answers with the purge's row shape, so the route's own sum-and-count is exercised,
 * not skipped.
 */

const SECRET = 'cron-secret-for-tests-0123456789';

const envState: { CRON_SECRET: string | undefined } = { CRON_SECRET: SECRET };
vi.mock('@/env', () => ({
  env: new Proxy({}, { get: (_t, key) => (key === 'CRON_SECRET' ? envState.CRON_SECRET : undefined) }),
}));

type PurgeRow = { purged_org: string; purged_rows: number };
const purge: { rows: PurgeRow[]; error: Error | null } = { rows: [], error: null };
const withCronRole = vi.fn(async (fn: (tx: { execute: () => Promise<PurgeRow[]> }) => unknown) => {
  if (purge.error) throw purge.error;
  return fn({ execute: async () => purge.rows });
});
vi.mock('@/db/with-cron-role', () => ({ withCronRole }));

const { GET, dynamic } = await import('@/app/api/cron/purge-places/route');

function call(authorization?: string): Promise<Response> {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return GET(new Request('http://localhost/api/cron/purge-places', { headers }));
}

beforeEach(() => {
  envState.CRON_SECRET = SECRET;
  purge.rows = [];
  purge.error = null;
  withCronRole.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('purge route', () => {
  it('the purge route is dynamic', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('the purge route refuses without the cron secret', async () => {
    envState.CRON_SECRET = undefined;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_configured' });
    expect(withCronRole).not.toHaveBeenCalled();
  });

  it('the purge route refuses a wrong secret', async () => {
    // Same length as the real header, so this reaches timingSafeEqual rather than the
    // length check.
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith('9') ? '8' : '9');
    const res = await call(`Bearer ${wrong}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: 'unauthorized' });
    expect(withCronRole).not.toHaveBeenCalled();
  });

  it('the purge route refuses a secret of a different length without throwing', async () => {
    // timingSafeEqual THROWS a RangeError on unequal lengths; the route must answer 401 first.
    for (const header of [`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, SECRET, 'Bearer ']) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, reason: 'unauthorized' });
    }
    expect(withCronRole).not.toHaveBeenCalled();
  });

  it('the purge route refuses a missing header', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: 'unauthorized' });
    expect(withCronRole).not.toHaveBeenCalled();
  });

  it('the purge route purges with the right secret', async () => {
    // One row PER ORG, zero included (0028): rows are summed, never counted as "purged".
    purge.rows = [
      { purged_org: '00000000-0000-4000-8000-00000000000a', purged_rows: 3 },
      { purged_org: '00000000-0000-4000-8000-00000000000b', purged_rows: 0 },
    ];
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orgs: 2, rowsPurged: 3 });
    expect(withCronRole).toHaveBeenCalledTimes(1);
  });

  it('the purge route never echoes the secret or an error message', async () => {
    const leak = `connection to db.example failed: password ${SECRET} rejected`;
    purge.error = new Error(leak);
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });

    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false, reason: 'purge_failed' });
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('connection to db.example');
    // The log carries the error NAME only — never the message, never the secret.
    expect(logged).toHaveLength(1);
    const line = JSON.stringify(logged[0]);
    expect(line).toContain('Error');
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain('connection to db.example');
  });
});
