/**
 * `scripts/ingest-comptroller.ts` — the Comptroller desk ingest (DATA-01, D-03, D-08, D-11).
 *
 * msw-driven: every request below is answered by `./msw/server.ts` (`onUnhandledRequest:
 * 'error'`) or by a capture handler installed in this file. 🔴 These tests assert on the
 * REQUEST the client was handed, never on a live response — CI never reaches the network.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { IngestOrgRequiredError, parseIngestArgs } from '../../scripts/ingest-comptroller';
import { resetSocrata, server, startReplayServer } from './msw/server';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetSocrata();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

describe('the argument gate (T-3-01)', () => {
  it('ingest-comptroller refuses to start without an org', () => {
    // Spied, so "before any I/O" is asserted rather than assumed: the gate must throw
    // before a single request is attempted.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    for (const argv of [[], ['--target=test'], ['--org='], ['--org=   '], ['--limit=5']]) {
      let thrown: unknown;
      try {
        parseIngestArgs(argv);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, JSON.stringify(argv)).toBeInstanceOf(IngestOrgRequiredError);
      expect((thrown as Error).message).toContain('--org');
      expect((thrown as Error).message).toContain('never defaults');
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // Positive control: an explicit org passes, and the org is carried verbatim.
    expect(parseIngestArgs(['--org=org_2abcDEF'])).toEqual({
      clerkOrgId: 'org_2abcDEF',
      target: 'test',
      limit: undefined,
    });
  });

  it('ingest-comptroller refuses an unknown flag rather than dropping it', () => {
    expect(() => parseIngestArgs(['--orgs=org_x'])).toThrow(/unknown argument/);
    expect(() => parseIngestArgs(['--org=org_x', '--target=staging'])).toThrow(/unknown target/);
    expect(() => parseIngestArgs(['--org=org_x', '--limit=0'])).toThrow(/positive integer/);
    expect(parseIngestArgs(['--org=org_x', '--target=prod', '--limit=25'])).toEqual({
      clerkOrgId: 'org_x',
      target: 'prod',
      limit: 25,
    });
  });
});
