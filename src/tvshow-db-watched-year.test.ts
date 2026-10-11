import { expect, test } from 'vitest';
import * as tvDb from './tvshow-db';

test('watched episodes of a show move to another year, keeping the day they were watched', async () => {
  await tvDb.init(':memory:');
  const episode = (id: number, show_id: number, number: number | null, watched_at: string | null, watched = true) =>
    ({ id, show_id, season: 1, number, watched_status: watched ? 'WATCHED' : null, watched_at }) as unknown as Parameters<typeof tvDb.createEpisode>[0];

  await tvDb.createShow({ id: 1, name: 'Show', last_watched_date: '2026-10-10 20:00:00' } as tvDb.Show);
  await tvDb.createShow({ id: 2, name: 'Other show' } as tvDb.Show);
  await tvDb.createEpisode(episode(1, 1, 1, '2026-10-09 21:30:00'));
  await tvDb.createEpisode(episode(2, 1, 2, '2024-02-29 08:00:00'));
  // watched before watch dates were stored
  await tvDb.createEpisode(episode(3, 1, 3, null));
  await tvDb.createEpisode(episode(4, 1, 4, null, false));
  // a special, watched last
  await tvDb.createEpisode(episode(5, 1, null, '2026-12-25 10:00:00'));
  await tvDb.createEpisode(episode(6, 2, 1, '2026-10-10 20:00:00'));

  expect(await tvDb.setShowWatchedYear(1, 2019)).toBe(4);

  const watchedAt = async (id: number) => (await tvDb.getEpisode(id)).watched_at;
  expect(await watchedAt(1)).toBe('2019-10-09 21:30:00');
  // 2019 had no 29th of February
  expect(await watchedAt(2)).toBe('2019-03-01 08:00:00');
  expect(await watchedAt(3)).toBe('2019-01-01 00:00:00');
  expect(await watchedAt(4)).toBeNull();
  expect(await watchedAt(5)).toBe('2019-12-25 10:00:00');
  // other shows are untouched
  expect(await watchedAt(6)).toBe('2026-10-10 20:00:00');

  // the show was last watched when its latest regular episode now says
  expect((await tvDb.getShow(1)).last_watched_date).toBe('2019-10-09 21:30:00');

  // and none of it counts towards this year's stats any more
  expect((await tvDb.getStats(2026)).yearSummary.shows_watched).toBe(1);
  expect((await tvDb.getStats(2019)).yearSummary.episodes_watched).toBe(4);
});
