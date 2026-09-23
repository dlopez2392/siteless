/**
 * The US Census BATCH geocoder client, replayed from the five recorded bodies. D-08.
 *
 * Every request here is served by `./msw/server.ts` from a file on disk;
 * `onUnhandledRequest: 'error'` turns an accidental live call into a failure.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { geocodeBatch, parseBatchLine } from '@/lib/geocode/census-batch';
import {
  CENSUS_BATCH_BODY,
  censusBatchRequests,
  failNextCensusBatches,
  RECORDED_BATCH_ROWS,
  resetCensus,
  server,
  startReplayServer,
} from './msw/server';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetCensus();
});
afterAll(() => {
  server.close();
});

const lines = (body: string): string[] => body.split('\n').filter((l) => l.length > 0);
const noSleep = async (): Promise<void> => {};

describe('the Census batch geocoder (D-08)', () => {
  it('census batch parses a ragged No_Match', () => {
    for (const line of lines(CENSUS_BATCH_BODY.no_match)) {
      expect(parseBatchLine(line)).toMatchObject({ kind: 'No_Match' });
    }
  });

  it('census batch parses a ragged Tie', () => {
    const [line] = lines(CENSUS_BATCH_BODY.tie);
    expect(parseBatchLine(line ?? '')).toEqual({ id: '1', kind: 'Tie' });
  });

  it('census batch pins the axis order', () => {
    const [line] = lines(CENSUS_BATCH_BODY.match);
    const out = parseBatchLine(line ?? '');
    if (out.kind !== 'Match') throw new Error(`expected a Match, got ${out.kind}`);
    expect(out.lng).toBeLessThan(-90);
    expect(out.lat).toBeGreaterThan(20);
    expect(out.lng).toBe(-97.672649743751);
    expect(out.lat).toBe(26.189604634647);
  });

  it('census batch rejoins by id', async () => {
    const rows = RECORDED_BATCH_ROWS.shuffled.map(({ id, street, city, zip }) => ({
      id,
      street,
      city,
      zip,
    }));
    const out = await geocodeBatch(rows, { sleep: noSleep });
    for (const line of lines(CENSUS_BATCH_BODY.shuffled)) {
      const expected = parseBatchLine(line);
      expect(out.get(expected.id)).toEqual(expect.objectContaining({ kind: expected.kind }));
    }
    expect(out.size).toBe(rows.length);
  });

  it('census batch retries and then records the chunk as failed', async () => {
    failNextCensusBatches(3, 'network');
    const rows = RECORDED_BATCH_ROWS.match.map(({ id, street, city, zip }) => ({
      id,
      street,
      city,
      zip,
    }));
    const out = await geocodeBatch(rows, { sleep: noSleep });
    expect(censusBatchRequests).toHaveLength(3);
    expect(out.get('32006170057-5')).toEqual({ kind: 'ChunkFailed', reason: 'unreachable' });
  });
});
