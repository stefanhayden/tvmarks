import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import * as tvDb from '../tvshow-db';
import showRoutes from './show';

vi.mock('../activity-pub-db', () => ({
  getPermissions: vi.fn(async () => undefined),
  setPermissions: vi.fn(async () => undefined),
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
    request(path, { method: 'POST', body: new URLSearchParams(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

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
});
