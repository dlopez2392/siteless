/**
 * B-WR-07 / B-CR-02: what a places-sweep step does with an error it did not write
 * (src/workflows/places-sweep/step-errors.ts).
 *
 * 🔴 THE ERROR UNDER TEST IS DRIZZLE'S OWN. drizzle-orm 0.45 wraps every failed `tx.execute` in a
 * `DrizzleQueryError` whose `name` is `Error`, which has no `code`, and whose `message` quotes the
 * query AND its params (`Failed query: … params: …`). Some params are derived from a Places
 * response. A test that fed the helper a bare `{ code }` object would be looser than what the
 * database path really throws — which is how the SQLSTATE branch went dead unnoticed.
 */
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import { PageRecordRefusal } from '@/lib/places/page-record';
import {
  isDeterministicFault,
  sqlstateOf,
  stepError,
} from '@/workflows/places-sweep/step-errors';

/** A postgres.js error as the driver throws it: `name` PostgresError, a SQLSTATE `code`. */
function pgError(code: string): Error {
  const e = new Error('record_places_page: placeId is not a place id') as Error & {
    code: string;
  };
  e.name = 'PostgresError';
  e.code = code;
  return e;
}

/** What `tx.execute` really throws: the driver error on `.cause`, the params in the message. */
function drizzleWrapped(code: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'select app.record_places_page($1::uuid, $2::jsonb)',
    ['00000000-0000-0000-0000-000000000000', '{"name":"SENTINEL Ortiz Plumbing"}'],
    pgError(code),
  );
}

describe('places-sweep step errors', () => {
  it("a drizzle-wrapped query error reports the database's SQLSTATE", () => {
    const e = drizzleWrapped('22023');
    // The shape that made the old helper blind: no code of its own, name "Error".
    expect((e as unknown as { code?: unknown }).code).toBeUndefined();
    expect(e.name).toBe('Error');

    expect(sqlstateOf(e)).toBe('22023');
    const out = stepError(e);
    expect(out.message).toBe('step_error:22023');
    // Never the query's params: they can carry Places-derived text.
    expect(out.message).not.toContain('SENTINEL');
    expect(out.message).not.toContain('Failed query');
  });

  it('a bare driver error, and an error with no SQLSTATE, still reduce safely', () => {
    expect(stepError(pgError('40001')).message).toBe('step_error:40001');
    expect(stepError(new TypeError('boom SENTINEL')).message).toBe('step_error:TypeError');
    expect(stepError('SENTINEL string').message).toBe('step_error:unknown');
    // A `code` that is not a SQLSTATE (a Node errno string) is not reported as one.
    const errno = Object.assign(new Error('x'), { code: 'ECONNRESET' });
    expect(sqlstateOf(errno)).toBeNull();
  });

  it('a deterministic database refusal is fatal and a transient one is not', () => {
    // Classes 22 (data), 23 (integrity) and 42 (syntax / privilege): the same statement on a
    // retry fails the same way — after a Places page was already bought (B-CR-02).
    for (const code of ['22023', '23514', '23505', '42501', '42P01']) {
      expect(isDeterministicFault(drizzleWrapped(code)), code).toBe(true);
    }
    // Serialization, deadlock, connection and shutdown faults can succeed on a retry.
    for (const code of ['40001', '40P01', '08006', '57P01', '53300']) {
      expect(isDeterministicFault(drizzleWrapped(code)), code).toBe(false);
    }
    expect(isDeterministicFault(new Error('network'))).toBe(false);
  });

  it('a page-record refusal is fatal', () => {
    expect(isDeterministicFault(new PageRecordRefusal('toPageRecord: page must be 1, 2 or 3'))).toBe(
      true,
    );
  });
});
