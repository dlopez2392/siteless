/**
 * FOUND-06, the SQL half. The same claim as tests/unit/time.test.ts, asserted in the
 * place the day bucket is actually computed.
 *
 * Both halves are needed and neither substitutes for the other: TypeScript proves the
 * rendered label, SQL proves the GROUP BY. A dashboard that counts leads per day does the
 * bucketing in Postgres, and `(created_at at time zone 'America/Chicago')::date` is the
 * only spelling that gives the right answer — a bare `created_at::date` silently buckets
 * in UTC and moves every evening lead into tomorrow.
 *
 * Read-only: no DDL, no migrations, nothing this test needs to exist in the schema. Every
 * value is a literal, so it runs before the tenancy tables land and keeps running after.
 */
import { describe, expect, it } from 'vitest';
import { withRollback } from './_fixtures';

describe('timezone discipline in SQL', () => {
  it('one instant, two zones, opposite verdicts', async () => {
    await withRollback(async (c) => {
      // Formatted to text IN SQL, on purpose. A `date` handed back through pg becomes a
      // JS Date at midnight — which is the very bug this test exists to catch, so
      // comparing Date objects here would be asserting through the defect.
      const { rows } = await c.query<{ utc_bucket: string; chicago_bucket: string }>(
        `select to_char((timestamptz '2026-09-21T01:00:00Z' at time zone 'UTC')::date,
                        'YYYY-MM-DD') as utc_bucket,
                to_char((timestamptz '2026-09-21T01:00:00Z' at time zone 'America/Chicago')::date,
                        'YYYY-MM-DD') as chicago_bucket`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.utc_bucket).toBe('2026-09-21'); // the wrong answer
      expect(rows[0]?.chicago_bucket).toBe('2026-09-20'); // the right one
      // Half a pair each: if the zone argument were being ignored these would agree.
      expect(rows[0]?.utc_bucket).not.toBe(rows[0]?.chicago_bucket);
    });
  });

  it('DST: the offset is not a constant, so "subtract six hours" is wrong twice a year', async () => {
    await withRollback(async (c) => {
      // Two wall-clock times in America/Chicago that a fixed -6 offset gets wrong.
      // Spring forward: 2026-03-08 02:30 local does not exist — Postgres resolves it
      // forward. Fall back: 2026-11-01 01:30 local happens twice — Postgres picks the
      // first (CDT, -5). [VERIFIED: executed, 01-RESEARCH.md Example 6]
      const { rows } = await c.query<{ dst_gap: string; dst_ambiguous: string }>(
        `select to_char((timestamp '2026-03-08 02:30' at time zone 'America/Chicago')
                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as dst_gap,
                to_char((timestamp '2026-11-01 01:30' at time zone 'America/Chicago')
                          at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as dst_ambiguous`,
      );

      // 08:30Z, not 08:30 minus a constant: the gap hour resolves forward to CDT (-5).
      expect(rows[0]?.dst_gap).toBe('2026-03-08T08:30:00Z');
      // 07:30Z: the ambiguous hour resolves to its FIRST occurrence, still CDT (-5),
      // not the CST (-6) repeat. A fixed -6 would have said 07:30 for the gap too.
      expect(rows[0]?.dst_ambiguous).toBe('2026-11-01T07:30:00Z');
    });
  });
});
