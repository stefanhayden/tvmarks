import { describe, it, expect, vi } from 'vitest';
import { sendAcceptMessage } from './inbox';

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
    const result = await sendAcceptMessage(
      { actor: 'https://remote/u/foo' }, // thebody
      'alice',
      'example.com',
      fakeReq,
      fakeRes,
      'remote.com'
    );

    expect(result.message.id).toMatch(/^https:\/\/example\.com\/u\/alice\/accept\//);
    expect(result.message.id).not.toContain('quoteAuth');
  });

  it('embeds localGuid and remoteUri into a quoteAuth id when supplied', async () => {
    const local = 'local123';
    const remote = 'https://other/post/1';
    const result = await sendAcceptMessage(
      { actor: 'https://remote/u/foo' },
      'bob',
      'example.com',
      fakeReq,
      fakeRes,
      'remote.com',
      { localGuid: local, remoteUri: remote }
    );

    expect(result.message.id).toContain('quoteAuth/');
    expect(result.message.id).toMatch(/remote=https%3A%2F%2Fother%2Fpost%2F1/);
    expect(result.message.id).toMatch(/local=local123/);
  });
});
