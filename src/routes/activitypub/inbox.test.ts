import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as inboxMod from './inbox';
import * as apDb from '../../activity-pub-db';
import { signAndSend } from '../../activitypub';

// we'll reference methods directly on `inboxMod` so that
// monkey‑patching/assignment in tests updates the binding.

// stub database helpers to avoid touching sqlite during tests
vi.mock('../../activity-pub-db', () => ({
  insertMessage: vi.fn().mockResolvedValue(undefined),
  // every /m/<guid> lookup finds one of our Notes unless a test says otherwise
  getMessage: vi.fn().mockResolvedValue({ message: JSON.stringify({ type: 'Note' }) }),
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

  it('uses the quote authorization URL as the Accept id when supplied', async () => {
    const quoteAuthorizationId = 'https://example.com/u/bob/quoteAuth/abc123';
    const result = await inboxMod.sendAcceptMessage({ actor: 'https://remote/u/foo' }, 'bob', 'example.com', fakeReq, fakeRes, 'remote.com', {
      quoteAuthorizationId,
    });

    expect(result.message.id).toBe(quoteAuthorizationId);
  });
});

// additional tests for inboxRoute quote handling

const app = { get: (key: string) => ({ domain: 'example.com', account: 'alice' })[key] };
const ourPost = 'https://example.com/m/abc123';
const makeRes = (): any => ({ status: vi.fn().mockReturnThis(), sendStatus: vi.fn().mockReturnThis() });

const storedStamps = () =>
  vi
    .mocked(apDb.insertMessage)
    .mock.calls.map(([guid, , json]) => ({ guid, ...JSON.parse(json) }))
    .filter((record) => record.type === 'QuoteAuthorization');

beforeEach(() => {
  vi.mocked(apDb.insertMessage).mockClear();
  vi.mocked(apDb.getMessage).mockClear();
  vi.mocked(signAndSend).mockClear();
});

describe('inboxRoute quote approval', () => {
  const createActivity = (object: any, extra: any = {}): any => ({
    type: 'Create',
    actor: 'https://other.example/u/foo',
    object: { type: 'Note', id: 'https://other.example/notes/1', ...object },
    ...extra,
  });

  const deliver = async (body: any) => {
    const sendSpy = vi.fn().mockResolvedValue({ response: 'ok', message: {} });
    inboxMod.__test_overrideSendAcceptMessage(sendSpy);
    await inboxMod.inboxRoute({ body, app } as any, makeRes());
    return sendSpy;
  };

  it('sends an accept for just the Quote object when a Create containing one is received', async () => {
    const quoteObj = { type: 'Quote', id: ourPost, url: ourPost };
    const sendSpy = await deliver(createActivity({ quote: quoteObj }));

    expect(sendSpy).toHaveBeenCalled();
    expect(sendSpy.mock.calls[0][0]).toEqual(quoteObj);

    const [stamp] = storedStamps();
    expect(stamp).toMatchObject({ interactingObject: 'https://other.example/notes/1', interactionTarget: ourPost });
    expect(sendSpy.mock.calls[0][6]).toEqual({ quoteAuthorizationId: stamp.id });
  });

  it('does not crash when the incoming Note lacks a content field', async () => {
    const sendSpy = await deliver(createActivity({ quote: { type: 'Quote', id: ourPost, url: ourPost } }));
    expect(sendSpy).toHaveBeenCalled();
  });

  it('approves the same target the Accept names when the activity and the Note disagree', async () => {
    const sendSpy = await deliver(createActivity({ quoteUrl: 'https://example.com/m/other' }, { quoteUrl: ourPost }));

    expect(sendSpy.mock.calls[0][0]).toMatchObject({ id: ourPost });
    expect(storedStamps()[0].interactionTarget).toBe(ourPost);
  });

  it('accepts a quote object that only carries a url', async () => {
    await deliver(createActivity({ quote: { type: 'Quote', url: ourPost } }));
    expect(storedStamps()[0].interactionTarget).toBe(ourPost);
  });

  it.each([
    ['a post on another server', { quoteUrl: 'https://remote/quoted' }],
    ['something of ours that is not a post', { quoteUrl: 'https://example.com/u/alice' }],
    ['a malformed quote target', { quoteUrl: { x: 1 } }],
    ['a malformed quote list', { quoteUrl: [ourPost] }],
  ])('does not approve a quote of %s', async (_, object) => {
    const sendSpy = await deliver(createActivity(object));

    expect(sendSpy).not.toHaveBeenCalled();
    expect(storedStamps()).toEqual([]);
  });

  it('does not approve a quote of a post we never published', async () => {
    vi.mocked(apDb.getMessage).mockResolvedValueOnce(undefined);
    const sendSpy = await deliver(createActivity({ quoteUrl: 'https://example.com/m/doesnotexist' }));

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does not approve a quoting post hosted somewhere other than the sender', async () => {
    const sendSpy = await deliver(createActivity({ id: 'https://elsewhere.example/notes/9', quoteUrl: ourPost }));

    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('inboxRoute quote requests', () => {
  const quoteRequest = (extra: any = {}): any => ({
    type: 'QuoteRequest',
    id: 'https://other.example/requests/1',
    actor: 'https://other.example/u/foo',
    object: ourPost,
    instrument: { type: 'Note', id: 'https://other.example/notes/1' },
    ...extra,
  });

  const deliver = async (body: any) => {
    const res = makeRes();
    await inboxMod.inboxRoute({ body, app } as any, res);
    return res;
  };

  it('stores a stamp and sends an Accept pointing at it', async () => {
    const res = await deliver(quoteRequest());

    const [stamp] = storedStamps();
    expect(stamp).toMatchObject({
      id: `https://example.com/u/alice/quoteAuth/${stamp.guid}`,
      attributedTo: 'https://example.com/u/alice',
      interactingObject: 'https://other.example/notes/1',
      interactionTarget: ourPost,
    });

    const accept: any = vi.mocked(signAndSend).mock.calls[0][0];
    expect(accept).toMatchObject({ type: 'Accept', result: stamp.id });
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('normalises alternate spellings of our post to its canonical id', async () => {
    await deliver(quoteRequest({ object: 'http://EXAMPLE.com/m/abc123' }));
    expect(storedStamps()[0].interactionTarget).toBe(ourPost);
  });

  it('approves an Ask whose Quote object names our post', async () => {
    await deliver(
      quoteRequest({
        type: 'Ask',
        object: { type: 'Quote', id: 'https://other.example/quotes/1', quoteUrl: ourPost },
      }),
    );
    expect(storedStamps()[0].interactionTarget).toBe(ourPost);
  });

  it.each([
    ['our actor rather than a post', { object: 'https://example.com/u/alice' }],
    ['a post on another server', { object: 'https://remote/m/abc123' }],
    ['a quoting post the sender does not host', { instrument: 'https://elsewhere.example/notes/9' }],
    ['a malformed quoting post', { instrument: { id: { x: 1 } } }],
    ['no quoting post', { instrument: undefined }],
  ])('rejects a request naming %s', async (_, extra) => {
    const res = await deliver(quoteRequest(extra));

    expect(res.sendStatus).toHaveBeenCalledWith(400);
    expect(storedStamps()).toEqual([]);
    expect(signAndSend).not.toHaveBeenCalled();
  });
});
