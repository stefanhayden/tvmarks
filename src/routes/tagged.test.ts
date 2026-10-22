import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import * as tvDb from '../tvshow-db';
import coreRoutes from './core';

describe('tagged', () => {
  let server;
  let baseUrl;
  const request = (path: string) => fetch(`${baseUrl}${path}`, { redirect: 'manual' });

  beforeAll(async () => {
    await tvDb.init(':memory:');
    await tvDb.createShow({ id: 1, name: 'Severance', url: 'https://www.tvmaze.com/shows/1/severance', status: 'Running', abandoned: 0 } as tvDb.Show);
    await tvDb.createShow({ id: 2, name: 'The Office', url: 'https://www.tvmaze.com/shows/2/the-office', status: 'Ended', abandoned: 0 } as tvDb.Show);
    await tvDb.createEpisode({ id: 20, show_id: 2, season: 2, number: 1, name: 'The Dundies' } as Parameters<typeof tvDb.createEpisode>[0]);
    await tvDb.updateShow('1', { tags: 'SciFi mystery_box' });
    await tvDb.updateShow('2', { tags: 'comfy' });
    await tvDb.updateEpisodeDetails(20, { tags: 'scifi' });

    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = {};
      next();
    });
    app.use('/', coreRoutes);
    server = app.listen(0);
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  test('a show or episode is stored with the hashtags it was created with', async () => {
    await tvDb.createShow({ id: 3, name: 'Added', url: 'https://www.tvmaze.com/shows/3/added', tags: 'scifi new', abandoned: 0 } as tvDb.Show);
    await tvDb.createEpisode({ id: 30, show_id: 3, season: 1, number: 1, tags: 'pilot' } as Parameters<typeof tvDb.createEpisode>[0]);
    expect((await tvDb.getShow(3)).tags).toBe('scifi new');
    expect((await tvDb.getEpisode(30)).tags).toBe('pilot');
  });

  test('finds shows and episodes with a hashtag in any case', async () => {
    expect((await tvDb.getShowsTagged('scifi'))?.map((show) => show.id)).toEqual([3, 1]);
    expect((await tvDb.getEpisodesTagged('SCIFI'))?.map((episode) => episode.id)).toEqual([20]);
  });

  test('matches a hashtag with letters SQL only knows in one case', async () => {
    await tvDb.updateShow('2', { tags: 'comfy Télé' });
    expect((await tvDb.getShowsTagged('télé'))?.map((show) => show.id)).toEqual([2]);
  });

  test("matches a whole hashtag, _ isn't a wildcard", async () => {
    expect(await tvDb.getShowsTagged('mystery')).toEqual([]);
    expect(await tvDb.getShowsTagged('mystery_box')).toHaveLength(1);
    expect(await tvDb.getShowsTagged('mysteryxbox')).toEqual([]);
  });

  test('the tagged page lists them', async () => {
    const res = await request('/tagged/scifi?raw=1');
    const params = await res.json();
    expect(params.title).toBe('#scifi');
    expect(params.shows.map((show) => show.name)).toEqual(['Added', 'Severance']);
    expect(params.episodes.map((episode) => `${episode.show_name} ${episode.name}`)).toEqual(['The Office The Dundies']);
  });

  test("#tvmarks, which every post has, goes to the homepage", async () => {
    const res = await request('/tagged/tvmarks');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  test("a show's own hashtag goes to the show", async () => {
    const res = await request('/tagged/TheOffice');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/show/2');
  });

  test('an address with characters a hashtag can\'t hold goes to the tag it is', async () => {
    const res = await request('/tagged/sci-fi');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/tagged/scifi');
  });

  test('a show named only with numbers is found from its hashtag', async () => {
    await tvDb.createShow({ id: 24, name: '24', url: 'https://www.tvmaze.com/shows/24/24', abandoned: 0 } as tvDb.Show);
    const res = await request('/tagged/24');
    expect(res.headers.get('location')).toBe('/show/24');
  });

  test("a hashtag nothing has says so", async () => {
    const params = await (await request('/tagged/nothing?raw=1')).json();
    expect(params.shows).toEqual([]);
    expect(params.episodes).toEqual([]);
  });
});
