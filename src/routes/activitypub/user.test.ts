import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quoteAuthRoute } from './user';
import * as apDb from '../../activity-pub-db';

// stub database helpers to avoid touching sqlite during tests
vi.mock('../../activity-pub-db', () => ({
  getMessage: vi.fn(),
}));

// stub out network helpers so we don't actually try to fetch anything
vi.mock('../../activitypub', () => ({
  synthesizeActivity: vi.fn(),
  signAndSend: vi.fn(),
  getInboxFromActorProfile: vi.fn(),
}));

const app = { get: (key: string) => ({ domain: 'example.com', account: 'alice' })[key] };
const quotingPost = 'https://other.example/notes/1';
const ourPost = 'https://example.com/m/abc123';

const stamp = {
  id: 'https://example.com/u/alice/quoteAuth/stamp1',
  type: 'QuoteAuthorization',
  attributedTo: 'https://example.com/u/alice',
  interactingObject: quotingPost,
  interactionTarget: ourPost,
};

let stored: Record<string, any>;

const fetchStamp = async (guid: string, opts: { name?: string; query?: any } = {}) => {
  const res: any = { setHeader: vi.fn() };
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  await quoteAuthRoute({ params: { name: opts.name || 'alice', guid }, query: opts.query || {}, app } as any, res);
  return res;
};

beforeEach(() => {
  stored = { abc123: { type: 'Note', id: ourPost } };
  vi.mocked(apDb.getMessage).mockImplementation(async (guid) => (stored[guid] ? { message: JSON.stringify(stored[guid]) } : undefined));
});

describe('quoteAuthRoute', () => {
  it('serves a stored stamp with the quoting post and our post the right way round', async () => {
    stored.stamp1 = stamp;
    const res = await fetchStamp('stamp1');

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/activity+json');
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject(stamp);
    expect(body['@context'][1]).toHaveProperty('interactingObject');
  });

  it('serves stamps issued before stamps were stored, under the URL they were issued with', async () => {
    stored.legacy1 = { type: 'QuoteRequest', actor: 'https://other.example/u/foo', object: ourPost, instrument: { type: 'Note', id: quotingPost } };
    const res = await fetchStamp('legacy1', { query: { remote: quotingPost } });

    expect(res.json.mock.calls[0][0]).toMatchObject({
      id: `https://example.com/u/alice/quoteAuth/legacy1?remote=${encodeURIComponent(quotingPost)}`,
      type: 'QuoteAuthorization',
      attributedTo: 'https://example.com/u/alice',
      interactingObject: quotingPost,
      interactionTarget: ourPost,
    });
  });

  it('ignores the query string when choosing which approval to serve', async () => {
    stored.stamp1 = stamp;

    const unknown = await fetchStamp('anything', { query: { local: 'stamp1', remote: 'https://evil.example/notes/1' } });
    expect(unknown.status).toHaveBeenCalledWith(404);

    const known = await fetchStamp('stamp1', { query: { local: ['a', 'b'], remote: 'https://evil.example/notes/1' } });
    expect(known.json.mock.calls[0][0]).toMatchObject(stamp);
  });

  it.each([
    ['an unknown guid', undefined],
    ['one of our own posts', { type: 'Note', id: ourPost }],
    ['a stored Create', { type: 'Create', object: { id: quotingPost, quoteUrl: ourPost } }],
    ['a legacy request for something that is not a post of ours', { type: 'QuoteRequest', object: 'https://example.com/u/alice', instrument: quotingPost }],
    ['a legacy request for a post we never published', { type: 'QuoteRequest', object: 'https://example.com/m/doesnotexist', instrument: quotingPost }],
    ['a legacy request with a malformed quoting post', { type: 'QuoteRequest', object: ourPost, instrument: { id: { x: 1 } } }],
    ['a legacy request with a malformed target', { type: 'QuoteRequest', object: [ourPost], instrument: quotingPost }],
  ])('returns 404 for %s', async (_, record) => {
    if (record) stored.guid1 = record;
    const res = await fetchStamp('guid1');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 404 for another account name', async () => {
    stored.stamp1 = stamp;
    const res = await fetchStamp('stamp1', { name: 'mallory' });
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
