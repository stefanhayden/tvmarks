import { describe, expect, test, vi, beforeEach } from 'vitest';
import { broadcastMessage } from './activitypub';
import { signedPostJSON } from './signature';

vi.mock('./util', async (importOriginal) => {
  const util = await importOriginal<typeof import('./util')>();
  return { ...util, actorInfo: { ...util.actorInfo, disabled: false } };
});
vi.mock('./signature', () => ({
  signedPostJSON: vi.fn(async () => ({ text: async () => '', status: 202 })),
  signedGetJSON: vi.fn(),
}));

const fakeDb = (guid?: string) => ({
  getFollowers: vi.fn(async () => JSON.stringify(['https://remote.example/u/friend'])),
  getPermissions: vi.fn(async () => undefined),
  getGlobalPermissions: vi.fn(async () => undefined),
  getGuidForId: vi.fn(async () => guid),
  insertMessage: vi.fn(),
});

const data = { id: 'show-1', path: 'show/1', url: 'https://www.tvmaze.com/shows/1/severance', description: 'new note', title: 'Severance', tags: ['drama'] };

describe('an update to a post', () => {
  beforeEach(() => {
    vi.mocked(signedPostJSON).mockClear();
  });

  test('replaces the stored note, so the post reads the same however it is fetched', async () => {
    const db = fakeDb('abc');
    await broadcastMessage(data, 'update', db, 'me', 'tv.example');
    expect(db.insertMessage).toHaveBeenCalledWith('abc', 'show-1', expect.stringContaining('#<span>drama</span>'));
    const stored = JSON.parse(db.insertMessage.mock.calls[0][2]);
    expect(stored.id).toBe('https://tv.example/m/abc');
    expect(stored.content).toContain('new note');
    expect(signedPostJSON).toHaveBeenCalled();
  });

  test('of something never posted sends nothing', async () => {
    const db = fakeDb(undefined);
    await broadcastMessage(data, 'update', db, 'me', 'tv.example');
    expect(db.insertMessage).not.toHaveBeenCalled();
    expect(signedPostJSON).not.toHaveBeenCalled();
  });
});
