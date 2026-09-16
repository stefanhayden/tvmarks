import { expect, test, beforeAll, describe } from 'vitest';
import * as tvDb from './tvshow-db';

const dateFormat = (v) => v.split('T').join(' ').split('.')[0];

// const now = dateFormat(new Date().toISOString());
const past6Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString());
// const past4Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 4)).toISOString());
// const past3Months = dateFormat(new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString());
const past3Days = dateFormat(new Date(new Date().setDate(new Date().getDate() - 3)).toISOString());
// const nextWeek = dateFormat(new Date(new Date().setDate(new Date().getDate() + 7)).toISOString());
// const next2Week = dateFormat(new Date(new Date().setDate(new Date().getDate() + 14)).toISOString());

describe('tvshow-db', () => {
  beforeAll(async () => {
    await tvDb.init(':memory:');

    // NOT STARTED
    await tvDb.createShow({
      id: 1,
      episodes_count: 2,
      aired_episodes_count: 2,
      watched_episodes_count: 0,
      last_watched_date: null,
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // COMPLETED
    await tvDb.createShow({
      id: 2,
      status: 'Ended',
      episodes_count: 2,
      aired_episodes_count: 2,
      watched_episodes_count: 2,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: null,
    } as tvDb.Show);

    // COMPLETED - more watched then aired (firefly)
    await tvDb.createShow({
      id: 21,
      status: 'Ended',
      episodes_count: 2,
      aired_episodes_count: 2,
      watched_episodes_count: 3,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: null,
    } as tvDb.Show);

    // UP TO DATE
    await tvDb.createShow({
      id: 3,
      status: 'Running',
      episodes_count: 3,
      aired_episodes_count: 2,
      watched_episodes_count: 2,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // UP TO DATE
    // marked unaired shows as watched
    await tvDb.createShow({
      id: 31,
      status: 'Running',
      episodes_count: 4,
      aired_episodes_count: 2,
      watched_episodes_count: 2,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // TO WATCH #1
    await tvDb.createShow({
      id: 4,
      status: 'Running',
      episodes_count: 3,
      aired_episodes_count: 2,
      watched_episodes_count: 1,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // TO WATCH #2
    await tvDb.createShow({
      id: 41,
      status: 'Ended',
      episodes_count: 3,
      aired_episodes_count: 3,
      watched_episodes_count: 1,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // TO WATCH #3
    await tvDb.createShow({
      id: 42,
      status: 'To Be Determined',
      episodes_count: 3,
      aired_episodes_count: 3,
      watched_episodes_count: 1,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
    } as tvDb.Show);

    // ABANDONED
    // watched 1 episode 2 months after aired and was up to date
    // didn't watch new episodes for 4 months
    await tvDb.createShow({
      id: 5,
      status: 'Running',
      episodes_count: 5,
      aired_episodes_count: 3,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: past6Months.split(' ')[0],
    } as tvDb.Show);

    // ABANDONED #2
    // watched 1 episode 2 months after aired
    // didn't watch new episodes for 4 months
    await tvDb.createShow({
      id: 51,
      status: 'Ended',
      episodes_count: 5,
      aired_episodes_count: 5,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: past6Months.split(' ')[0],
    } as tvDb.Show);

    // ABANDONED #3
    // marked as abandoned
    await tvDb.createShow({
      id: 52,
      status: 'Ended',
      episodes_count: 5,
      aired_episodes_count: 5,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: past6Months.split(' ')[0],
      abandoned: 1,
    } as tvDb.Show);

    // ABANDONED #4
    // marked as abandoned, but no next episode to watch date is known
    // (e.g. between seasons) - should still show as abandoned
    await tvDb.createShow({
      id: 53,
      status: 'Running',
      episodes_count: 5,
      aired_episodes_count: 5,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: null,
      abandoned: 1,
    } as tvDb.Show);

    // ABANDONED #5
    // status isn't 'Running' or 'Ended', otherwise same as ABANDONED #1
    await tvDb.createShow({
      id: 54,
      status: 'In Development',
      episodes_count: 5,
      aired_episodes_count: 3,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: past6Months.split(' ')[0],
    } as tvDb.Show);

    // ABANDONED #6
    // not caught up, gone stale, but next episode to watch has no known
    // air date (e.g. refresh only looked at a season window with nothing
    // unwatched in it) - should still show as abandoned, not disappear
    await tvDb.createShow({
      id: 55,
      status: 'Running',
      episodes_count: 5,
      aired_episodes_count: 3,
      watched_episodes_count: 1,
      last_watched_date: past6Months.split(' ')[0],
      next_episode_towatch_airdate: null,
    } as tvDb.Show);

    // UP TO DATE + manually abandoned - should only show as abandoned,
    // not also as up to date
    await tvDb.createShow({
      id: 32,
      status: 'Running',
      episodes_count: 3,
      aired_episodes_count: 2,
      watched_episodes_count: 2,
      last_watched_date: past3Days.split(' ')[0],
      next_episode_towatch_airdate: past3Days.split(' ')[0],
      abandoned: 1,
    } as tvDb.Show);

    // ENDED show cancelled before anything aired - should only show as not
    // started, not also as completed
    await tvDb.createShow({
      id: 22,
      status: 'Ended',
      episodes_count: 0,
      aired_episodes_count: 0,
      watched_episodes_count: 0,
      last_watched_date: null,
      next_episode_towatch_airdate: null,
    } as tvDb.Show);
  });

  test('showsNotStarted', async () => {
    const showsNotStarted = await tvDb.getShowsNotStarted();

    const ids = showsNotStarted.map((s) => s.id);
    expect(ids.sort((a, b) => a - b)).toEqual([1, 22]);
  });

  test('getShowsCompleted', async () => {
    const getShowsCompleted = await tvDb.getShowsCompleted();

    // id 22 (Ended, 0 aired episodes) is NOT completed - nothing aired yet,
    // it belongs in "not started" only
    expect(getShowsCompleted?.length).toBe(2);
    expect(getShowsCompleted[0].id).toBe(2);
    expect(getShowsCompleted[1].id).toBe(21);
  });

  test('getShowsUpToDate', async () => {
    const getShowsUpToDate = await tvDb.getShowsUpToDate();

    // id 32 is caught up but manually abandoned, so it belongs in
    // "abandoned" only, not also "up to date"
    expect(getShowsUpToDate?.length).toBe(2);
    expect(getShowsUpToDate[0].id).toBe(3);
    expect(getShowsUpToDate[1].id).toBe(31);
  });

  test('getShowsToWatch', async () => {
    const getShowsToWatch = await tvDb.getShowsToWatch();

    expect(getShowsToWatch?.length).toBe(3);
    expect(getShowsToWatch[0].id).toBe(4);
    expect(getShowsToWatch[1].id).toBe(41);
    expect(getShowsToWatch[2].id).toBe(42);
  });

  test('getShowsAbandoned', async () => {
    const getShowsAbandoned = await tvDb.getShowsAbandoned();

    const ids = getShowsAbandoned.map((s) => s.id);
    expect(ids.sort((a, b) => a - b)).toEqual([5, 32, 51, 52, 53, 54, 55]);
  });
});
