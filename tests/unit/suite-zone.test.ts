import { describe, expect, it } from 'vitest';

describe('timezone pinning', () => {
  // If this goes red, vitest.config.ts lost its line-1 assignment or the pool changed
  // back to threads. Every other FOUND-06 assertion becomes vacuous when it does.
  it('the suite runs in a zone that can discriminate', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
