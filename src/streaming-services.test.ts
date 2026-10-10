import { expect, test } from 'vitest';
import * as tvDb from './tvshow-db';
import { defaultStreamingServices, groupShowsBySubscription, slugifyServiceName } from './streaming-services';

const show = (id: number, streaming_service: string | null = null) => ({ id, streaming_service });

test('a subscription is needed only while one of its shows is in progress', () => {
  // owned media ('none') is never a subscription and never needs a service picking
  const watching = [show(1, 'netflix'), show(2, 'hulu'), show(3), show(12, 'tubi'), show(13), show(14, 'none')];
  const upToDate = [show(4, 'netflix'), show(5, 'not-a-service'), show(9, 'netflix'), show(10, 'starz'), show(11)];
  // every show with a service, including the ones already listed above
  const others = [...watching, ...upToDate, show(6, 'netflix'), show(7, 'peacock'), show(8, 'peacock')].filter((s) => s.streaming_service);
  const inProgress = new Set([1, 2, 3, 4, 5, 6, 14]);

  const { needed, notNeeded, unassigned } = groupShowsBySubscription(defaultStreamingServices, { watching, upToDate, others }, inProgress);
  const ids = (list: { id: number }[]) => list.map((s) => s.id);

  expect(needed.map((g) => [g.service.slug, ids(g.watching), ids(g.upToDate), ids(g.betweenSeasons), ids(g.idle)])).toEqual([
    ['netflix', [1], [4], [9], [6]],
    ['hulu', [2], [], [], []],
  ]);
  // a season that hasn't been started doesn't keep a subscription in use, whether or not it has aired
  expect(notNeeded.map((g) => [g.service.slug, ids(g.betweenSeasons), ids(g.idle)])).toEqual([
    ['peacock', [], [7, 8]],
    ['starz', [10], []],
    ['tubi', [12], []],
  ]);
  expect(ids(unassigned)).toEqual([3, 5]);
});

test('a show is in progress while the season it is part way through has a later episode to watch soon', async () => {
  await tvDb.init(':memory:');
  const aired = '2026-01-01T00:00:00+00:00';
  const inDays = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
  const episode = (id: number, show_id: number, season: number, number: number | null, watched: boolean, airstamp: string | null = aired) =>
    ({ id, show_id, season, number, airstamp, watched_status: watched ? 'WATCHED' : null }) as unknown as Parameters<typeof tvDb.createEpisode>[0];
  // in Watch Next or Up To Date depending on the episodes, watched yesterday
  const seed = async (showId: number, lastWatched: number | null, episodes: ReturnType<typeof episode>[], extra: Partial<tvDb.Show> = {}) => {
    await tvDb.createShow({ id: showId, name: `Show ${showId}`, status: 'Running' } as tvDb.Show);
    for (const e of episodes) {
      await tvDb.createEpisode(e);
      await tvDb.updateEpisodeWatchStatus(e.id, e.watched_status as 'WATCHED' | null);
    }
    const numbered = episodes.filter((e) => e.number !== null);
    await tvDb.updateShow(String(showId), {
      last_watched_episode_id: lastWatched,
      aired_episodes_count: numbered.filter((e) => e.airstamp && new Date(e.airstamp) < new Date()).length,
      watched_episodes_count: numbered.filter((e) => e.watched_status).length,
      last_watched_date: lastWatched ? new Date(Date.now() - 864e5).toISOString().replace('T', ' ').split('.')[0] : null,
      streaming_service: 'netflix',
      ...extra,
    });
  };

  // part way through season 1
  await seed(1, 10, [episode(10, 1, 1, 1, true), episode(11, 1, 1, 2, false)]);
  // finished season 1, season 2 aired but not started
  await seed(2, 21, [episode(20, 2, 1, 1, true), episode(21, 2, 1, 2, true), episode(22, 2, 2, 1, false)]);
  // caught up mid season, next episode next week
  await seed(3, 30, [episode(30, 3, 1, 1, true), episode(31, 3, 1, 2, false, inDays(7))]);
  // rest of the season has no air date, and specials don't count
  await seed(4, 40, [episode(40, 4, 1, 1, true), episode(41, 4, 1, 2, false, null), episode(42, 4, 1, null, false)]);
  // not started
  await seed(5, null, [episode(50, 5, 1, 1, false)]);
  // skipped an episode but watched through the end of the season
  await seed(6, 62, [episode(60, 6, 1, 1, true), episode(61, 6, 1, 2, false), episode(62, 6, 1, 3, true)]);
  // caught up mid season, but the next episode is too far away
  await seed(7, 70, [episode(70, 7, 1, 1, true), episode(71, 7, 1, 2, false, inDays(45))]);
  // part way through a season, but abandoned
  await seed(8, 80, [episode(80, 8, 1, 1, true), episode(81, 8, 1, 2, false)], { abandoned: 1 });
  // part way through a season on another service
  await seed(9, 90, [episode(90, 9, 1, 1, true), episode(91, 9, 1, 2, false)], { streaming_service: 'hulu' });

  expect((await tvDb.getShowIdsInProgress()).sort()).toEqual([1, 3, 9]);
  expect((await tvDb.getShowIdsInProgress('netflix')).sort()).toEqual([1, 3]);
  expect(await tvDb.getShowIdsInProgress('peacock')).toEqual([]);
});

test('the streaming service is stored on the show', async () => {
  await tvDb.init(':memory:');
  await tvDb.createShow({ id: 1, name: 'Show' } as tvDb.Show);

  expect((await tvDb.getShow(1)).streaming_service).toBeNull();

  await tvDb.updateShow('1', { streaming_service: 'netflix' });
  expect((await tvDb.getShow(1)).streaming_service).toBe('netflix');
  expect((await tvDb.getShowsWithStreamingService()).map((s) => s.id)).toEqual([1]);

  await tvDb.updateShow('1', { streaming_service: null });
  expect(await tvDb.getShowsWithStreamingService()).toEqual([]);
});

test('services come from the database, None first and then by how many shows use them', async () => {
  await tvDb.init(':memory:');
  const slugs = async () => (await tvDb.getStreamingServices()).map((service) => service.slug);

  expect((await slugs()).slice(0, 3)).toEqual(['none', 'netflix', 'hbo-max']);

  for (const id of [1, 2, 3]) await tvDb.createShow({ id, name: `Show ${id}` } as tvDb.Show);
  await tvDb.setShowStreamingService(1, 'hulu');
  await tvDb.setShowStreamingService(2, 'hulu');
  await tvDb.setShowStreamingService(3, 'peacock');
  expect((await slugs()).slice(0, 4)).toEqual(['none', 'hulu', 'peacock', 'netflix']);

  // the cached count follows shows changing service and being deleted
  await tvDb.setShowStreamingService(1, 'peacock');
  await tvDb.deleteShow('2');
  expect((await tvDb.getStreamingService('hulu')).shows_count).toBe(0);
  expect((await slugs()).slice(0, 3)).toEqual(['none', 'peacock', 'netflix']);
});

test('services can be added and removed, built in ones cannot be removed', async () => {
  await tvDb.init(':memory:');
  expect(slugifyServiceName(' Paramount+ with Showtime! ')).toBe('paramount-plus-with-showtime');

  const added = await tvDb.createStreamingService({ slug: 'my-service', name: 'My Service', color: '#000000', textColor: '#ffffff' });
  expect(added).toMatchObject({ slug: 'my-service', name: 'My Service', textColor: '#ffffff', builtin: 0, shows_count: 0 });

  await tvDb.createShow({ id: 1, name: 'Show' } as tvDb.Show);
  await tvDb.setShowStreamingService(1, 'my-service');

  expect(await tvDb.deleteStreamingService('netflix')).toBe(false);
  expect(await tvDb.deleteStreamingService('my-service')).toBe(true);
  expect(await tvDb.getStreamingService('my-service')).toBeUndefined();
  expect((await tvDb.getShow(1)).streaming_service).toBeNull();
});
