import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import * as tvDb from './tvshow-db';
import { refreshShowData } from './routes/admin';
import coreRoutes from './routes/core';
import { ProviderFactory } from './providers/provider-factory';
import { ProviderError } from './providers/base/provider-errors';

const mocked = vi.hoisted(() => ({ refreshFails: false, unsavableShowIds: new Set<string>() }));

vi.mock('./tvshow-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tvshow-db')>();
  return {
    ...actual,
    // shows are only picked for refresh hours after their last update, which a freshly created show never is
    getAllInProgressShows: async () => {
      if (mocked.refreshFails) throw new Error('database is locked');
      return actual.getAllShows();
    },
    // the db helpers log and resolve to nothing when a write fails
    updateShow: async (id, body) => (mocked.unsavableShowIds.has(String(id)) ? undefined : actual.updateShow(id, body)),
  };
});

const socketError = (what) => new ProviderError(`TVMaze ${what} failed: Client network socket disconnected`);

describe('refreshShowData', () => {
  let result: Awaited<ReturnType<typeof refreshShowData>>;

  beforeAll(async () => {
    await tvDb.init(':memory:');
    for (const id of [1, 2, 3, 4]) {
      await tvDb.createShow({ id, name: `old name ${id}`, status: 'Running', episodes_count: 0, abandoned: 0 } as tvDb.Show);
    }
    // stored before the refresh but not yet counted, like an episode written by a refresh that failed after it
    await tvDb.createEpisode({ id: 100, show_id: 1, season: 1, number: 1, airstamp: '2026-01-01T00:00:00+00:00' } as Parameters<
      typeof tvDb.createEpisode
    >[0]);
    mocked.unsavableShowIds.add('4');

    vi.spyOn(ProviderFactory, 'getProvider').mockReturnValue({
      getShow: async (id) => {
        if (Number(id) === 1) throw socketError(`getShow for id ${id}`);
        return { id: Number(id), name: `new name ${id}`, status: 'Running' };
      },
      getSeasons: async (id) => {
        if (Number(id) === 3) throw socketError(`getSeasons for show ${id}`);
        return [];
      },
      getSeasonEpisodes: async () => [],
    } as any);

    result = await refreshShowData();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    mocked.unsavableShowIds.clear();
  });

  test('a show the provider fails on is skipped and the rest still refresh', async () => {
    expect(result.refreshed.map((s) => s.id).sort()).toEqual([2, 3]);
    expect((await tvDb.getShow('1')).name).toBe('old name 1');
    expect((await tvDb.getShow('2')).name).toBe('new name 2');
  });

  test('a failed show still has its counts saved, which moves it to the back of the refresh queue', async () => {
    expect(result.failed.map((s) => s.id)).toContain(1);
    expect((await tvDb.getShow('1')).episodes_count).toBe(1);
  });

  test("a show's data is saved when only its seasons can't be fetched", async () => {
    expect((await tvDb.getShow('3')).name).toBe('new name 3');
  });

  test('a show that fails to save counts as failed', () => {
    expect(result.failed.map((s) => s.id).sort()).toEqual([1, 4]);
  });
});

describe('homepage', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await tvDb.init(':memory:');
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = { loggedIn: true };
      next();
    });
    app.use('/', coreRoutes);
    server = app.listen(0);
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    mocked.refreshFails = false;
    server.close();
  });

  test('still loads when refreshing shows fails', async () => {
    mocked.refreshFails = true;
    const res = await fetch(`${baseUrl}/?raw=1`);
    expect(res.status).toBe(200);
    expect((await res.json()).isLoggedIn).toBe(true);
  });
});
