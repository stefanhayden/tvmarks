import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import * as tvDb from '../tvshow-db';
import showRoutes from './show';
import * as apDb from '../activity-pub-db';
import { broadcastMessage } from '../activitypub';

vi.mock('../activity-pub-db', () => ({
  getPermissions: vi.fn(async () => undefined),
  setPermissions: vi.fn(async () => undefined),
  getGuidForId: vi.fn(async () => undefined),
  getMessage: vi.fn(async () => undefined),
}));

vi.mock('../activitypub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../activitypub')>()),
  broadcastMessage: vi.fn(),
}));

vi.mock('./admin', () => ({
  refreshShowEpisodesData: vi.fn(async () => {
    throw new Error('TVMaze getEpisodes failed: Client network socket disconnected');
  }),
}));

describe('episode routes', () => {
  let server;
  let baseUrl;
  let loggedIn = true;

  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init });
  const post = (path: string, body: Record<string, string> = {}) =>
    // a string, the tests run in jsdom whose URLSearchParams some node versions' fetch won't take
    request(path, { method: 'POST', body: new URLSearchParams(body).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  beforeAll(async () => {
    await tvDb.init(':memory:');
    for (const id of [1, 5]) {
      await tvDb.createShow({ id, name: `show ${id}`, status: 'Running', abandoned: 0 } as tvDb.Show);
    }
    await tvDb.createEpisode({ id: 500, show_id: 5, season: 1, number: 1, airstamp: '2026-01-01T00:00:00+00:00' } as Parameters<
      typeof tvDb.createEpisode
    >[0]);

    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
      (req as any).session = { loggedIn };
      next();
    });
    app.use('/show', showRoutes);
    server = app.listen(0);
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  describe('logged out', () => {
    beforeAll(() => {
      loggedIn = false;
    });
    afterAll(() => {
      loggedIn = true;
    });

    test.each([
      ['/show/5/episode/500/status', { status: 'WATCHED' }],
      ['/show/5/episode/500/update', { note: 'not mine' }],
      ['/show/5/episode/500/delete', {}],
      ['/show/5/season/1/status', { status: 'WATCHED' }],
    ])('POST %s is sent to log in and changes nothing', async (path, body) => {
      const res = await post(path, body);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?sendTo=${encodeURIComponent(path)}`);

      const episode = await tvDb.getEpisode(500);
      expect(episode.watched_status).toBeNull();
      expect(episode.note).toBeNull();
    });
  });

  test("an episode that doesn't exist sends you to the show", async () => {
    const res = await request('/show/1/episode/999');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/show/1');
  });

  test("an episode of another show isn't shown under this one", async () => {
    const res = await request('/show/1/episode/500');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/show/1');
  });

  test('a federated server asking for a missing episode hears it is not found', async () => {
    const res = await request('/show/1/episode/999?format=json');
    expect(res.status).toBe(404);
  });

  test('marking an episode that no longer exists watched sends you to the show', async () => {
    const res = await post('/show/1/episode/999/status', { status: 'WATCHED' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/show/1');
  });

  test('saving a note on an episode that no longer exists sends you to the show', async () => {
    const res = await post('/show/1/episode/999/update', { note: 'great' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/show/1');
  });

  test('a failed refresh sends you back to the show to say so', async () => {
    const res = await post('/show/1/refresh');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/show/1?refresh=failed');
  });

  describe('hashtags', () => {
    test("saving a show's details keeps its hashtags", async () => {
      await post('/show/1/update', { note: 'love it', tags: '#scifi, #Rewatch #scifi' });
      expect(await tvDb.getShow(1)).toMatchObject({ note: 'love it', tags: 'scifi Rewatch' });
    });

    test('clearing the hashtags removes them', async () => {
      await post('/show/1/update', { note: 'love it', tags: '' });
      expect((await tvDb.getShow(1)).tags).toBeNull();
    });

    test("a show added before the site federated has no post to update", async () => {
      vi.mocked(broadcastMessage).mockClear();
      await post('/show/1/update', { note: 'love it', tags: '#scifi' });
      expect(broadcastMessage).not.toHaveBeenCalled();
    });

    test("saving a show's details updates the post from when it was added", async () => {
      vi.mocked(broadcastMessage).mockClear();
      vi.mocked(apDb.getGuidForId).mockResolvedValueOnce('abc');
      await post('/show/1/update', { note: 'love it', tags: '#scifi #comfy' });
      expect(broadcastMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'show-1', description: 'love it', tags: ['scifi', 'comfy'] }),
        'update',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    test("saving a show's details without changing them sends nothing", async () => {
      vi.mocked(broadcastMessage).mockClear();
      vi.mocked(apDb.getGuidForId).mockResolvedValue('abc');
      await post('/show/1/update', { note: 'love it', tags: '#scifi #comfy' });
      vi.mocked(apDb.getGuidForId).mockResolvedValue(undefined);
      expect(broadcastMessage).not.toHaveBeenCalled();
    });

    test("a show save that doesn't send hashtags leaves them alone", async () => {
      await post('/show/1/update', { note: 'still love it' });
      expect(await tvDb.getShow(1)).toMatchObject({ note: 'still love it', tags: 'scifi comfy' });
    });

    test("an episode save that doesn't send hashtags leaves them alone", async () => {
      await tvDb.updateEpisodeDetails(500, { tags: 'keep' });
      await post('/show/5/episode/500/update', { note: 'a note' });
      expect(await tvDb.getEpisode(500)).toMatchObject({ note: 'a note', tags: 'keep' });
    });

    test("saving another show's episode under this show changes nothing and posts nothing", async () => {
      vi.mocked(broadcastMessage).mockClear();
      const res = await post('/show/1/episode/500/update', { note: 'wrong show', tags: 'wrong' });
      expect(res.headers.get('location')).toBe('/show/1');
      expect(await tvDb.getEpisode(500)).not.toMatchObject({ note: 'wrong show' });
      expect(broadcastMessage).not.toHaveBeenCalled();
    });

    test("a posted episode fetched by a federated server reads as it was posted", async () => {
      const posted = { content: '<p>as posted</p>', contentMap: { EN: '<p>as posted</p>' }, tag: [{ type: 'Hashtag', name: '#scifi' }] };
      vi.mocked(apDb.getGuidForId).mockResolvedValueOnce('abc');
      vi.mocked(apDb.getMessage).mockResolvedValueOnce({ message: JSON.stringify(posted) });
      const note = await (await request('/show/5/episode/500?format=json')).json();
      expect(note).toMatchObject({ ...posted, id: expect.stringContaining('/show/5/episode/500') });
    });

    test("saving an episode's details keeps its hashtags", async () => {
      await post('/show/5/episode/500/update', { note: '', tags: 'finale' });
      expect((await tvDb.getEpisode(500)).tags).toBe('finale');
    });

    test("a watched episode's post carries its show's hashtags and its own", async () => {
      await post('/show/5/update', { note: '', tags: '#scifi' });
      vi.mocked(broadcastMessage).mockClear();
      await post('/show/5/episode/500/status', { status: 'WATCHED' });
      expect(broadcastMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'show-5-episode-500', tags: ['scifi', 'finale'] }),
        'create',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
