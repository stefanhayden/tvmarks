import { expect, test } from 'vitest';
import * as tvDb from './tvshow-db';
import { createStreamingServiceMatcher, defaultStreamingServices, groupShowsBySubscription, slugifyServiceName } from './streaming-services';

const show = (id: number, streaming_service: string | null = null) => ({ id, streaming_service });

test('a subscription is needed only while one of its shows is in progress', () => {
  // owned media ('none') is never a subscription and never needs a service picking
  const watching = [show(1, 'netflix'), show(2, 'hulu'), show(3), show(12, 'tubi'), show(13), show(14, 'none')];
  const upToDate = [show(4, 'netflix'), show(5, 'not-a-service'), show(9, 'netflix'), show(10, 'starz'), show(11)];
  const notStarted = [show(6, 'netflix'), show(7, 'peacock'), show(8, 'peacock'), show(15)];
  const inProgress = new Set([1, 2, 3, 4, 5, 6, 14]);

  const { needed, notNeeded, unassigned } = groupShowsBySubscription(defaultStreamingServices, { watching, upToDate, notStarted }, inProgress);
  const ids = (list: { id: number }[]) => list.map((s) => s.id);

  expect(needed.map((g) => [g.service.slug, ids(g.watching), ids(g.upToDate), ids(g.betweenSeasons), ids(g.notStarted)])).toEqual([
    ['netflix', [1], [4], [9], [6]],
    ['hulu', [2], [], [], []],
  ]);
  // a season that hasn't been started doesn't keep a subscription in use, whether or not it has aired
  expect(notNeeded.map((g) => [g.service.slug, ids(g.betweenSeasons), ids(g.notStarted)])).toEqual([
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

  await tvDb.updateShow('1', { streaming_service: null });
  expect((await tvDb.getShow(1)).streaming_service).toBeNull();
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

test('stats count the episodes watched this year on each service', async () => {
  await tvDb.init(':memory:');
  const year = new Date().getFullYear();
  let episodeId = 1;
  const seed = async (id: number, service: string | null, watched: number) => {
    await tvDb.createShow({ id, name: `Show ${id}` } as tvDb.Show);
    await tvDb.setShowStreamingService(id, service);
    for (let i = 0; i < watched; i++) {
      const id_ = episodeId++;
      await tvDb.createEpisode({ id: id_, show_id: id, season: 1, number: i + 1, runtime: 60 } as Parameters<typeof tvDb.createEpisode>[0]);
      await tvDb.updateEpisodeWatchStatus(id_, 'WATCHED');
    }
  };
  await seed(1, 'hulu', 1);
  await seed(2, 'netflix', 2);
  await seed(3, 'netflix', 1);
  await seed(4, null, 5);

  const { byService } = await tvDb.getStats(year);
  // most watched first, shows without a service last
  expect(byService.map((s) => [s.slug, s.shows_count, s.episodes_count, s.minutes])).toEqual([
    ['netflix', 2, 3, 180],
    ['hulu', 1, 1, 60],
    [null, 1, 5, 300],
  ]);
});

test('a network matches the streaming service it is watched on', () => {
  const matcher = createStreamingServiceMatcher(defaultStreamingServices);
  const match = (network: string | null) => matcher(network)?.slug;

  expect(match('Netflix')).toBe('netflix');
  expect(match('STARZ')).toBe('starz');
  expect(match('Disney+')).toBe('disney-plus');
  expect(match('BBC iPlayer')).toBe('bbc-iplayer');
  // known by another name
  expect(match('HBO')).toBe('hbo-max');
  expect(match('Paramount+ with Showtime')).toBe('paramount-plus');
  // broadcast networks and the non-network choices are left for the viewer
  expect(match('NBC')).toBeUndefined();
  expect(match('PBS')).toBeUndefined();
  expect(match('Channel 4')).toBeUndefined();
  expect(match('None')).toBeUndefined();
  expect(match('')).toBeUndefined();
  expect(match(null)).toBeUndefined();
});

test('a custom service named like the network wins over an alias', () => {
  const showtime = { slug: 'showtime', name: 'Showtime', color: '#000000', textColor: '#ffffff' };
  expect(createStreamingServiceMatcher([...defaultStreamingServices, showtime])('Showtime')?.slug).toBe('showtime');
  expect(createStreamingServiceMatcher(defaultStreamingServices)('constructor')).toBeUndefined();
  // matching by slug alone relies on this
  for (const service of defaultStreamingServices) expect(slugifyServiceName(service.name)).toBe(service.slug);
});

test('a service is guessed from the network until the viewer decides', async () => {
  await tvDb.init(':memory:');
  const service = async (id: number) => {
    const show = await tvDb.getShow(id);
    return [show.streaming_service, show.streaming_service_source];
  };
  await tvDb.createShow({ id: 1, name: 'Matched', network_name: 'HBO' } as tvDb.Show);
  await tvDb.createShow({ id: 2, name: 'Broadcast', network_name: 'NBC' } as tvDb.Show);
  await tvDb.createShow({ id: 3, name: 'Picked', network_name: 'Netflix' } as tvDb.Show);
  await tvDb.createShow({ id: 4, name: 'Cleared', network_name: 'Netflix' } as tvDb.Show);
  await tvDb.setShowStreamingService(3, 'none');
  await tvDb.setShowStreamingService(4, null);

  expect(await service(1)).toEqual(['hbo-max', 'network']);
  expect(await service(2)).toEqual([null, null]);
  expect(await service(3)).toEqual(['none', 'manual']);
  // without a service of the viewer's own, the show goes back to being guessed
  expect(await service(4)).toEqual(['netflix', 'network']);

  // a guess counts like any other service
  expect((await tvDb.getStreamingService('hbo-max')).shows_count).toBe(1);

  // a guess follows the network
  await tvDb.updateShow('1', { network_name: 'Netflix' });
  expect(await service(1)).toEqual(['netflix', 'network']);
  await tvDb.updateShow('1', { network_name: 'NBC' });
  expect(await service(1)).toEqual([null, null]);

  // the provider leaving the network out keeps the guess
  await tvDb.updateShow('1', { network_name: 'HBO' });
  await tvDb.updateShow('1', { network_name: undefined });
  expect(await service(1)).toEqual(['hbo-max', 'network']);

  // confirming a guess makes it the viewer's
  await tvDb.updateShow('1', { network_name: 'HBO' });
  await tvDb.setShowStreamingService(1, 'hbo-max');
  expect(await service(1)).toEqual(['hbo-max', 'manual']);
  expect((await tvDb.getStreamingService('hbo-max')).shows_count).toBe(1);
  expect((await tvDb.getStreamingService('netflix')).shows_count).toBe(1);

  // services of shows watched recently and not abandoned count as recently used, guessed or not
  expect(await tvDb.getRecentlyUsedServices()).toEqual([]);
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  await tvDb.updateShow('1', { last_watched_date: now });
  await tvDb.updateShow('3', { last_watched_date: now, abandoned: 1 });
  await tvDb.updateShow('4', { last_watched_date: now });
  expect((await tvDb.getRecentlyUsedServices()).sort()).toEqual(['hbo-max', 'netflix']);
});

test('removing a custom service sends its shows back to being guessed', async () => {
  await tvDb.init(':memory:');
  await tvDb.createShow({ id: 1, name: 'Picked', network_name: 'Netflix' } as tvDb.Show);
  await tvDb.createShow({ id: 2, name: 'Guessed', network_name: 'Showtime' } as tvDb.Show);
  await tvDb.createShow({ id: 3, name: 'Broadcast', network_name: 'NBC' } as tvDb.Show);
  expect((await tvDb.getShow(2)).streaming_service).toBe('paramount-plus');

  // adding a service named like a network picks up the shows on it
  await tvDb.createStreamingService({ slug: 'showtime', name: 'Showtime', color: '#000000', textColor: '#ffffff' });
  expect((await tvDb.getShow(2)).streaming_service).toBe('showtime');
  await tvDb.setShowStreamingService(1, 'showtime');
  await tvDb.setShowStreamingService(3, 'showtime');

  await tvDb.deleteStreamingService('showtime');
  expect((await tvDb.getShow(1)).streaming_service).toBe('netflix');
  expect((await tvDb.getShow(2)).streaming_service).toBe('paramount-plus');
  const broadcast = await tvDb.getShow(3);
  expect([broadcast.streaming_service, broadcast.streaming_service_source]).toEqual([null, null]);
});

test('a service stored without a source is treated as the viewer\'s', async () => {
  await tvDb.init(':memory:');
  await tvDb.createShow({ id: 1, name: 'Show' } as tvDb.Show);
  await tvDb.updateShow('1', { streaming_service: 'netflix' });
  await tvDb.updateShow('1', { network_name: 'HBO' });
  expect((await tvDb.getShow(1)).streaming_service).toBe('netflix');
});

test('a service can be listed when it has no shows left to list', () => {
  const { needed, notNeeded } = groupShowsBySubscription(defaultStreamingServices, { watching: [], upToDate: [], notStarted: [] }, new Set(), ['starz', 'none']);
  expect(needed).toEqual([]);
  expect(notNeeded.map((g) => g.service.slug)).toEqual(['starz']);
});

test('there is no built in catch-all service, custom ones cover that', async () => {
  await tvDb.init(':memory:');
  expect(await tvDb.getStreamingService('other')).toBeUndefined();
  expect((await tvDb.getStreamingServices()).slice(-1)[0].slug).toBe('cable');
});
