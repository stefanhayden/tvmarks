import { beforeEach, expect, test } from 'vitest';
import * as tvDb from './tvshow-db';
import { addSubscriptionNoticeIfUnused, getCurrentSubscriptionNotices } from './subscription-notices';

const dateFormat = (d: Date) => d.toISOString().split('T').join(' ').split('.')[0];
const daysFromNow = (n: number) => new Date(Date.now() + n * 864e5);

let nextEpisodeId = 1;

// a show on a service, with one season of episodes given as [aired days from now, watched]
const seed = async (id: number, service: string | null, episodes: [number, boolean][]) => {
  await tvDb.createShow({ id, name: `Show ${id}`, status: 'Running' } as tvDb.Show);
  let lastWatched: number | null = null;
  for (const [index, [days, watched]] of episodes.entries()) {
    const episodeId = nextEpisodeId++;
    await tvDb.createEpisode({ id: episodeId, show_id: id, season: 1, number: index + 1, airstamp: daysFromNow(days).toISOString() } as Parameters<
      typeof tvDb.createEpisode
    >[0]);
    if (watched) {
      await tvDb.updateEpisodeWatchStatus(episodeId, 'WATCHED');
      lastWatched = episodeId;
    }
  }
  await tvDb.updateShow(String(id), {
    streaming_service: service,
    aired_episodes_count: episodes.filter(([days]) => days < 0).length,
    watched_episodes_count: episodes.filter(([, watched]) => watched).length,
    last_watched_date: lastWatched ? dateFormat(daysFromNow(-1)) : null,
    last_watched_episode_id: lastWatched,
  });
};

const stored = async () => (await tvDb.getSubscriptionNotices()).map((notice) => [notice.service, notice.show_id]);
const shown = async () => (await getCurrentSubscriptionNotices()).map((notice) => [notice.service.slug, notice.show_id]);

beforeEach(async () => {
  await tvDb.init(':memory:');
});

test('finishing the only show in progress on a service leaves a notice', async () => {
  await seed(1, 'netflix', [
    [-20, true],
    [-10, true],
  ]);
  await addSubscriptionNoticeIfUnused(1);
  expect(await stored()).toEqual([['netflix', 1]]);
  expect(await shown()).toEqual([['netflix', 1]]);
});

test('no notice while the show has an episode within 30 days or another show is in progress', async () => {
  await seed(1, 'netflix', [
    [-10, true],
    [7, false],
  ]);
  await seed(2, 'hulu', [[-10, true]]);
  await seed(3, 'hulu', [
    [-10, true],
    [-5, false],
  ]);
  // next episode is more than 30 days out
  await seed(4, 'peacock', [
    [-10, true],
    [45, false],
  ]);
  await seed(5, null, [[-10, true]]);

  for (const id of [1, 2, 3, 4, 5]) await addSubscriptionNoticeIfUnused(id);
  expect(await stored()).toEqual([['peacock', 4]]);
});

test('the notice goes away when another show on the service is started', async () => {
  await seed(1, 'netflix', [[-10, true]]);
  await addSubscriptionNoticeIfUnused(1);

  // a show in progress on another service changes nothing
  await seed(2, 'hulu', [
    [-10, true],
    [-5, false],
  ]);
  expect(await shown()).toEqual([['netflix', 1]]);

  await seed(3, 'netflix', [
    [-10, true],
    [-5, false],
  ]);
  expect(await shown()).toEqual([]);
  expect(await stored()).toEqual([]);
});

test('the notice goes away when its show changes service, gets something to watch, is unwatched or is deleted', async () => {
  const finish = async (id: number, service: string) => {
    await seed(id, service, [[-10, true]]);
    await addSubscriptionNoticeIfUnused(id);
  };
  await finish(1, 'netflix');
  await finish(2, 'hulu');
  await finish(3, 'peacock');
  await finish(4, 'starz');
  await finish(5, 'tubi');
  expect((await shown()).length).toBe(5);

  await tvDb.updateShow('1', { streaming_service: 'cable' });
  await tvDb.createEpisode({ id: 1000, show_id: 2, season: 2, number: 1, airstamp: daysFromNow(-1).toISOString() } as Parameters<typeof tvDb.createEpisode>[0]);
  await tvDb.updateShow('3', { watched_episodes_count: 0 });
  await tvDb.deleteShow('4');

  expect(await shown()).toEqual([['tubi', 5]]);
  expect(await stored()).toEqual([['tubi', 5]]);
});

test('a dismissed notice stays gone', async () => {
  await seed(1, 'netflix', [[-10, true]]);
  await addSubscriptionNoticeIfUnused(1);
  await tvDb.deleteSubscriptionNotice('netflix');

  expect(await shown()).toEqual([]);
});
