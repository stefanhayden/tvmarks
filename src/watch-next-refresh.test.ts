import { describe, expect, test, beforeAll } from 'vitest';
import * as tvDb from './tvshow-db';
import { refreshWatchNext } from './routes/admin';

const hoursFromNow = (n: number) => new Date(Date.now() + n * 36e5).toISOString();
const sqlDate = (iso: string) => iso.split('T').join(' ').split('.')[0];

const addEpisodes = async (showId: number, airstamps: string[], watchedCount: number) => {
  for (const [i, airstamp] of airstamps.entries()) {
    await tvDb.createEpisode({
      id: showId * 100 + i,
      show_id: showId,
      season: 1,
      number: i + 1,
      airstamp,
      watched_status: i < watchedCount ? 'WATCHED' : null,
      watched_at: i < watchedCount ? sqlDate(hoursFromNow(-24 * 200)) : null,
    } as Parameters<typeof tvDb.createEpisode>[0]);
  }
};

const categoryIds = async () => ({
  upToDate: (await tvDb.getShowsUpToDate()).map((s) => s.id),
  completed: (await tvDb.getShowsCompleted()).map((s) => s.id),
  toWatch: (await tvDb.getShowsToWatch()).map((s) => s.id),
  abandoned: (await tvDb.getShowsAbandoned()).map((s) => s.id),
});

// caught up for months, then a new episode airs
describe('refreshWatchNext', () => {
  beforeAll(async () => {
    await tvDb.init(':memory:');

    const old = hoursFromNow(-24 * 200);
    const shows = [
      { id: 1, status: 'Running', airstamps: [old, old, hoursFromNow(-1)] }, // new episode just aired
      { id: 2, status: 'Running', airstamps: [old, old, hoursFromNow(6)] }, // airs later today
      { id: 3, status: 'Ended', airstamps: [old, old, hoursFromNow(-1)] }, // finale just aired
    ];
    for (const { id, status, airstamps } of shows) {
      await tvDb.createShow({
        id,
        status,
        episodes_count: 3,
        aired_episodes_count: 2,
        watched_episodes_count: 2,
        last_watched_date: sqlDate(old),
        next_episode_towatch_airdate: airstamps[2],
        abandoned: 0,
      } as tvDb.Show);
      await addEpisodes(id, airstamps, 2);
    }
  });

  test('before refresh the shows are caught up', async () => {
    const ids = await categoryIds();
    expect(ids.upToDate.sort()).toEqual([1, 2]);
    expect(ids.completed).toEqual([3]);
  });

  test('after refresh, shows with a newly aired episode move to watch next', async () => {
    await refreshWatchNext();
    const ids = await categoryIds();
    expect(ids.toWatch.sort()).toEqual([1, 3]);
    expect(ids.upToDate).toEqual([2]);
    expect(ids.completed).toEqual([]);
    expect(ids.abandoned).toEqual([]);
  });
});
