import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * C-WR-01: the merge-history actor lookup on `/businesses/[id]`.
 *
 * Two defects, one test each:
 * - it had NO TIMEOUT, so a slow or rate-limited Clerk API held the whole detail page — every
 *   field and the unmerge action — hostage to cosmetic names;
 * - its third fallback was the user's primary EMAIL, printed as "Reviewed by jane@…" to every
 *   member of the org.
 *
 * Clerk is factory-mocked: nothing here reaches the network (tests/unit/no-network.test.ts).
 */
const getUserList = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList } }),
}));

import { ACTOR_LOOKUP_TIMEOUT_MS, actorNames } from '@/app/(app)/businesses/[id]/actor-names';

type FakeUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
};

function user(overrides: Partial<FakeUser> & { id: string }): FakeUser {
  return {
    firstName: null,
    lastName: null,
    fullName: null,
    username: null,
    primaryEmailAddress: null,
    ...overrides,
  };
}

beforeEach(() => {
  getUserList.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('actor names', () => {
  it('a Clerk lookup that never answers falls back to the raw ids once the budget runs out', async () => {
    vi.useFakeTimers();
    getUserList.mockReturnValue(new Promise(() => {}));

    let settled: Map<string, string> | undefined;
    void actorNames(['user_a']).then((m) => (settled = m));

    await vi.advanceTimersByTimeAsync(ACTOR_LOOKUP_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(Map);
    expect(settled!.size).toBe(0);
  });

  it('the budget is short enough not to hold the page', () => {
    expect(ACTOR_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  it('a user with no name and no username is never named by their email', async () => {
    getUserList.mockResolvedValue({
      data: [user({ id: 'user_a', primaryEmailAddress: { emailAddress: 'jane@example.com' } })],
    });
    const names = await actorNames(['user_a']);
    expect([...names.values()].join(' ')).not.toContain('@');
    expect(names.has('user_a')).toBe(false);
  });

  it('first and last name first, then the username', async () => {
    getUserList.mockResolvedValue({
      data: [
        user({
          id: 'user_a',
          firstName: 'Dan',
          lastName: 'López',
          fullName: 'Dan López',
          username: 'danlo',
          primaryEmailAddress: { emailAddress: 'dan@example.com' },
        }),
        user({ id: 'user_b', firstName: 'Ana', fullName: 'Ana' }),
        user({ id: 'user_c', username: 'rgv-rep', primaryEmailAddress: { emailAddress: 'r@x.co' } }),
      ],
    });
    const names = await actorNames(['user_a', 'user_b', 'user_c']);
    expect(names.get('user_a')).toBe('Dan López');
    expect(names.get('user_b')).toBe('Ana');
    expect(names.get('user_c')).toBe('rgv-rep');
  });

  it('a lookup that throws falls back to the raw ids', async () => {
    getUserList.mockRejectedValue(new Error('429'));
    const names = await actorNames(['user_a']);
    expect(names.size).toBe(0);
  });

  it('the page size stays inside what Clerk accepts', async () => {
    getUserList.mockResolvedValue({ data: [] });
    const ids = Array.from({ length: 700 }, (_, i) => `user_${i}`);
    await actorNames(ids);
    const { limit, userId } = getUserList.mock.calls[0]![0] as { limit: number; userId: string[] };
    expect(limit).toBeLessThanOrEqual(100);
    expect(userId.length).toBe(limit);
  });
});
