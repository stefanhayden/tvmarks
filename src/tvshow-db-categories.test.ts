import { expect, test } from 'vitest';
import * as tvDb from './tvshow-db';

const dateFormat = (d: Date) => d.toISOString().split('T').join(' ').split('.')[0];
const daysFromNow = (n: number) => dateFormat(new Date(Date.now() + n * 864e5));

// every combination of show state must land in exactly one homepage category
test('every show appears in exactly one homepage category', async () => {
  await tvDb.init(':memory:');

  const statuses = ['Ended', 'Running', 'To Be Determined', 'In Development', null];
  const lastWatchedDates = [null, daysFromNow(-3), daysFromNow(-180)];
  const nextAirdates = [null, daysFromNow(7), daysFromNow(-3), daysFromNow(-180)];

  const states = new Map<number, object>();
  let id = 1;
  for (const status of statuses)
    for (const aired of [0, 2])
      for (const watched of [0, 1, 2, 3])
        for (const lastWatched of lastWatchedDates)
          for (const nextAirdate of nextAirdates)
            for (const abandoned of [0, 1]) {
              const state = {
                status,
                aired_episodes_count: aired,
                watched_episodes_count: watched,
                last_watched_date: lastWatched,
                next_episode_towatch_airdate: nextAirdate,
                abandoned,
              };
              states.set(id, state);
              await tvDb.createShow({ id, episodes_count: 3, ...state } as tvDb.Show);
              id++;
            }

  const all = states.size;
  const categories = await Promise.all([
    tvDb.getShowsNotStarted(all),
    tvDb.getShowsCompleted(all),
    tvDb.getShowsToWatch(all),
    tvDb.getShowsUpToDate(all),
    tvDb.getShowsAbandoned(all),
  ]);
  const names = ['notStarted', 'completed', 'toWatch', 'upToDate', 'abandoned'];
  const found = new Map<number, string[]>();
  categories.forEach((shows, i) => shows.forEach((s) => found.set(s.id, [...(found.get(s.id) || []), names[i]])));

  const wrong = [...states]
    .filter(([showId]) => found.get(showId)?.length !== 1)
    .map(([showId, state]) => ({ ...state, categories: found.get(showId) || [] }));
  expect(wrong).toEqual([]);
});
