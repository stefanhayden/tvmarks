import { describe, expect, test, beforeAll } from 'vitest';
import * as tvDb from './tvshow-db';

const episode = (id: number, airstamp: string) =>
  ({ id, show_id: 1, season: 1, number: id, airstamp }) as Parameters<typeof tvDb.createEpisode>[0];

describe('updateAllAiredCounts', () => {
  beforeAll(async () => {
    await tvDb.init(':memory:');
    await tvDb.createShow({ id: 1, name: 'show', aired_episodes_count: 0, abandoned: 0 } as tvDb.Show);
    await tvDb.createEpisode(episode(1, '2020-01-01T00:00:00+00:00'));
  });

  test('counts the aired episodes as it writes, not the count the show was picked with', async () => {
    // picked when one episode had aired, and a refresh added another before the write
    const picked = [{ id: 1, aired_episodes_count: 1 }];
    await tvDb.createEpisode(episode(2, '2020-01-08T00:00:00+00:00'));
    await tvDb.updateAllAiredCounts(picked);
    expect((await tvDb.getShow(1)).aired_episodes_count).toBe(2);
  });
});
