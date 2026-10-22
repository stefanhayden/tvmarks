import { expect, test, beforeAll, describe } from 'vitest';
import * as tvDb from './tvshow-db';

const hoursFromNow = (n: number) =>
  new Date(Date.now() + n * 36e5)
    .toISOString()
    .replace('.000Z', '+00:00')
    .replace(/\.\d+Z$/, '+00:00');

const episode = (id: number, show_id: number, airstamp: string, season = 1) =>
  ({ id, show_id, name: `episode ${id}`, season, number: id, airdate: airstamp.slice(0, 10), airstamp }) as Parameters<
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

  describe('later seasons', () => {
    beforeAll(async () => {
      await tvDb.createShow({ id: 10, name: 'never started', abandoned: 0 } as tvDb.Show);
      await tvDb.createEpisode(episode(101, 10, hoursFromNow(-1000)));
      await tvDb.createEpisode(episode(102, 10, hoursFromNow(100), 2));

      await tvDb.createShow({ id: 11, name: 'started', abandoned: 0 } as tvDb.Show);
      await tvDb.createEpisode(episode(111, 11, hoursFromNow(-1000)));
      await tvDb.createEpisode(episode(112, 11, hoursFromNow(100), 2));
      await tvDb.updateEpisodeWatchStatus(111, 'WATCHED');
    });

    test('hides a later season of a show you never started', async () => {
      const ids = (await tvDb.getUpcomingEpisodes()).map((e) => e.id);
      expect(ids).not.toContain(102);
    });

    test('keeps a later season of a show you have started', async () => {
      const ids = (await tvDb.getUpcomingEpisodes()).map((e) => e.id);
      expect(ids).toContain(112);
    });

    test('includes a later season of a show you never started when asked, and flags it', async () => {
      const episodes = await tvDb.getUpcomingEpisodes(24, 0, true);
      expect(episodes.find((e) => e.id === 102)?.show_started).toBe(0);
      expect(episodes.find((e) => e.id === 112)?.show_started).toBe(1);
    });

    test('keeps the first season of a show you never started', async () => {
      // show 3 has no watched episodes and its season 1 episode is upcoming
      const ids = (await tvDb.getUpcomingEpisodes()).map((e) => e.id);
      expect(ids).toContain(3);
    });
  });

  describe('paging', () => {
    // noon UTC three weeks out, so episodes a few hours apart are on the same day whenever the tests run
    const noon = new Date();
    noon.setUTCDate(noon.getUTCDate() + 21);
    noon.setUTCHours(12, 0, 0, 0);
    const at = (hours: number) => new Date(noon.getTime() + hours * 36e5).toISOString().replace(/\.\d+Z$/, '+00:00');

    beforeAll(async () => {
      // a season dropped at once, a few hours after another show's episode on the same day
      await tvDb.createShow({ id: 20, name: 'dropped', abandoned: 0 } as tvDb.Show);
      for (const id of [201, 202, 203]) await tvDb.createEpisode(episode(id, 20, at(2)));
      await tvDb.createShow({ id: 21, name: 'weekly', abandoned: 0 } as tvDb.Show);
      await tvDb.createEpisode(episode(211, 21, at(0)));
      // no airdate, so its day comes from its airstamp
      await tvDb.createEpisode({ ...episode(212, 21, at(1)), airdate: '' });
    });

    test("counts show days, so a show's episodes on one day stay together", async () => {
      const all = await tvDb.getUpcomingEpisodes(100, 0);
      const days = [...new Set(all.map((e) => `${e.show_id} ${e.airs_on}`))];
      const page = days.findIndex((day) => day.startsWith('20 '));

      const episodes = await tvDb.getUpcomingEpisodes(1, page);
      expect(episodes.map((e) => e.id)).toEqual([201, 202, 203]);
    });

    test('works out the day of an episode with no airdate from when it airs', async () => {
      const episodes = await tvDb.getUpcomingEpisodes(100, 0);
      const weekly = episodes.filter((e) => e.show_id === 21);
      expect(weekly.map((e) => e.id)).toEqual([211, 212]);
      expect(new Set(weekly.map((e) => e.airs_on)).size).toBe(1);
    });
  });
});
