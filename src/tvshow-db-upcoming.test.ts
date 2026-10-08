import { expect, test, beforeAll, describe } from 'vitest';
import * as tvDb from './tvshow-db';

const hoursFromNow = (n: number) =>
  new Date(Date.now() + n * 36e5)
    .toISOString()
    .replace('.000Z', '+00:00')
    .replace(/\.\d+Z$/, '+00:00');

const episode = (id: number, show_id: number, airstamp: string) =>
  ({ id, show_id, name: `episode ${id}`, season: 1, number: id, airdate: airstamp.slice(0, 10), airstamp }) as Parameters<
    typeof tvDb.createEpisode
  >[0];

describe('getUpcomingEpisodes', () => {
  beforeAll(async () => {
    await tvDb.init(':memory:');

    await tvDb.createShow({ id: 1, name: 'watching', abandoned: 0 } as tvDb.Show);
    await tvDb.createShow({ id: 2, name: 'abandoned', abandoned: 1 } as tvDb.Show);
    await tvDb.createShow({ id: 3, name: 'unset', abandoned: null } as tvDb.Show);

    await tvDb.createEpisode(episode(1, 1, hoursFromNow(48)));
    await tvDb.createEpisode(episode(2, 2, hoursFromNow(24)));
    await tvDb.createEpisode(episode(3, 3, hoursFromNow(72)));
    // aired recently enough to still be "upcoming" if now were shifted by TIMEZONE_OFFSET
    await tvDb.createEpisode(episode(4, 1, hoursFromNow(-1)));
    await tvDb.createEpisode(episode(5, 1, hoursFromNow(1)));
    await tvDb.createEpisode(episode(6, 1, ''));
  });

  test('hides abandoned shows by default, soonest first', async () => {
    const episodes = await tvDb.getUpcomingEpisodes();
    expect(episodes.map((e) => e.id)).toEqual([5, 1, 3]);
  });

  test('includes abandoned shows when asked, and flags them', async () => {
    const episodes = await tvDb.getUpcomingEpisodes(24, 0, true);
    expect(episodes.map((e) => e.id)).toEqual([5, 2, 1, 3]);
    expect(episodes.filter((e) => e.show_abandoned).map((e) => e.id)).toEqual([2]);
  });

  test('leaves out episodes that have already aired or have no airstamp', async () => {
    const ids = (await tvDb.getUpcomingEpisodes(24, 0, true)).map((e) => e.id);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(6);
  });

  test('pages through results', async () => {
    const episodes = await tvDb.getUpcomingEpisodes(2, 1, true);
    expect(episodes.map((e) => e.id)).toEqual([2, 1]);
  });
});
