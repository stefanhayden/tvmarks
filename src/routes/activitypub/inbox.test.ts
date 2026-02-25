import { describe, it, expect, vi } from 'vitest';
import * as inboxMod from './inbox';

// we'll reference methods directly on `inboxMod` so that
// monkey‑patching/assignment in tests updates the binding.

// stub database helpers to avoid touching sqlite during tests
vi.mock('../../activity-pub-db', () => ({
  insertMessage: vi.fn().mockResolvedValue(undefined),
  getFollowers: vi.fn().mockResolvedValue('[]'),
  setFollowers: vi.fn().mockResolvedValue(undefined),
  getPermissions: vi.fn().mockResolvedValue(null),
  getGlobalPermissions: vi.fn().mockResolvedValue(null),
}));

// stub out network helpers so we don't actually try to fetch anything
vi.mock('../../activitypub', () => ({
  signAndSend: vi.fn().mockResolvedValue('SIGNED'),
  getInboxFromActorProfile: vi.fn().mockResolvedValue('https://foo.example/inbox'),
}));

// simple fake request/response objects; only `body` is looked at
const fakeReq: any = { body: {}, app: { get: () => null } };
const fakeRes: any = {};

describe('sendAcceptMessage', () => {
  it('generates a plain Accept id when no opts provided', async () => {
    const result = await inboxMod.sendAcceptMessage(
      { actor: 'https://remote/u/foo' }, // thebody
      'alice',
      'example.com',
      fakeReq,
      fakeRes,
      'remote.com',
    );

    expect(result.message.id).toMatch(/^https:\/\/example\.com\/u\/alice\/accept\//);
    expect(result.message.id).not.toContain('quoteAuth');
  });

  it('embeds localGuid and remoteUri into a quoteAuth id when supplied', async () => {
    const local = 'local123';
    const remote = 'https://other/post/1';
    const result = await inboxMod.sendAcceptMessage({ actor: 'https://remote/u/foo' }, 'bob', 'example.com', fakeReq, fakeRes, 'remote.com', {
      localGuid: local,
      remoteUri: remote,
    });

    expect(result.message.id).toContain('quoteAuth/');
    expect(result.message.id).toMatch(/remote=https%3A%2F%2Fother%2Fpost%2F1/);
    expect(result.message.id).toMatch(/local=local123/);
  });
});

// additional tests for inboxRoute quote handling

describe('inboxRoute quote approval', () => {
  it('sends an accept for just the Quote object when a Create containing one is received', async () => {
    // console.log removed; debugging
    const quoteObj = { type: 'Quote', id: 'https://remote/quoted', url: 'https://remote/quoted' };
    const createActivity: any = {
      type: 'Create',
      actor: 'https://other.example/u/foo',
      object: { type: 'Note', quote: quoteObj },
    };

    const req: any = { body: createActivity, app: { get: () => null } };
    const res: any = { status: vi.fn().mockReturnThis(), sendStatus: vi.fn().mockReturnThis() };

    // override internal binding via helper
    const sendSpy = vi.fn().mockResolvedValue({ response: 'ok', message: {} });
    inboxMod.__test_overrideSendAcceptMessage(sendSpy);

    await inboxMod.inboxRoute(req, res);

    expect(sendSpy).toHaveBeenCalled();
    const arg = sendSpy.mock.calls[0][0];
    expect(arg).toEqual(quoteObj);
  });

  it('does not crash when the incoming Note lacks a content field', async () => {
    const quoteObj = { type: 'Quote', id: 'https://remote/quoted', url: 'https://remote/quoted' };
    const createActivity: any = {
      type: 'Create',
      actor: 'https://other.example/u/foo',
      object: { type: 'Note', quote: quoteObj },
    };
    const req: any = { body: createActivity, app: { get: () => null } };
    const res: any = { status: vi.fn().mockReturnThis(), sendStatus: vi.fn().mockReturnThis() };

    const sendSpy = vi.fn().mockResolvedValue({ response: 'ok', message: {} });
    inboxMod.__test_overrideSendAcceptMessage(sendSpy);
    await inboxMod.inboxRoute(req, res);
    expect(sendSpy).toHaveBeenCalled();
  });
});
