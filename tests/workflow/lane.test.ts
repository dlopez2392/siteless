/**
 * The workflow lane's own invariants (04-01).
 *
 * This lane is never allowed to be green by running zero files: `vitest run` over an
 * include glob that matches nothing is a pass, and a lane that proves nothing looks
 * exactly like a lane that proves everything. This file is the floor — it pins what
 * vitest.workflow.config.ts forces, so a config edit that drops a pin is red here.
 * 04-22 adds the real sweep test (a compiled placesSweep run against msw).
 */
import { describe, expect, it } from 'vitest';

describe('workflow lane', () => {
  it('the workflow lane pins zone, locale and a fake Places key', async () => {
    expect(process.env.TZ).toBe('UTC');
    expect(process.env.LANG).toBe('en_US.UTF-8');
    // The zone pin reached the process, not just the env var: 2026-01-01T00:00Z is
    // midnight here, and would be the previous evening in America/Chicago.
    expect(new Date(Date.UTC(2026, 0, 1)).getHours()).toBe(0);
    expect(process.env.GOOGLE_PLACES_API_KEY).toBe('test-key-not-real');
    expect(process.env.PLACES_MODE).toBe('enterprise');
    // The alias resolves to the no-op twin; the real entry's body is a bare throw.
    await expect(import('server-only')).resolves.toBeDefined();
  });
});
