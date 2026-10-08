import crypto from 'crypto';
import * as apDb from './activity-pub-db';
import { parseJSON, uriOf } from './util';

// FEP-044f approval stamp. Third-party servers fetch it from the quoting
// post's `quoteAuthorization` URL and check both sides before showing a quote:
//   interactingObject = the remote post doing the quoting
//   interactionTarget = our post being quoted
export interface QuoteAuthorization {
  id: string;
  type: 'QuoteAuthorization';
  attributedTo: string;
  interactingObject: string;
  interactionTarget: string;
}

export const quoteAuthorizationContext = [
  'https://www.w3.org/ns/activitystreams',
  {
    QuoteAuthorization: 'https://w3id.org/fep/044f#QuoteAuthorization',
    gts: 'https://gotosocial.org/ns#',
    interactingObject: { '@id': 'gts:interactingObject', '@type': '@id' },
    interactionTarget: { '@id': 'gts:interactionTarget', '@type': '@id' },
  },
];

function parseUrl(uri: unknown): URL | null {
  try {
    const url = new URL(uri as string);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

async function getStoredObject(guid: string) {
  const row = await apDb.getMessage(guid);
  return row?.message ? parseJSON(row.message) : null;
}

// Resolves a URI to the canonical id of one of our stored posts, or
// undefined when it isn't one.
async function findOwnPostId(uri: unknown, domain: string): Promise<string | undefined> {
  const url = parseUrl(uri);
  const guid = url?.pathname.match(/^\/m\/([a-zA-Z0-9]+)$/)?.[1];
  if (!guid || url.host !== String(domain).toLowerCase()) {
    return undefined;
  }

  const note = await getStoredObject(guid);
  return note?.type === 'Note' ? `https://${domain}/m/${guid}` : undefined;
}

// Approves a quote and stores the stamp served at its `id`. Returns null,
// storing nothing, unless the target is one of our posts and the quoting post
// lives on the server of the actor asking.
export async function createQuoteAuthorization(opts: {
  actor: unknown;
  interactingObject: string | undefined;
  interactionTarget: string | undefined;
  domain: string;
  account: string;
}): Promise<QuoteAuthorization | null> {
  const { actor, interactingObject, domain, account } = opts;

  const quotingHost = parseUrl(interactingObject)?.host;
  if (!quotingHost || quotingHost !== parseUrl(actor)?.host) {
    return null;
  }

  const interactionTarget = await findOwnPostId(opts.interactionTarget, domain);
  if (!interactionTarget) {
    return null;
  }

  const guid = crypto.randomBytes(16).toString('hex');
  const stamp: QuoteAuthorization = {
    id: `https://${domain}/u/${account}/quoteAuth/${guid}`,
    type: 'QuoteAuthorization',
    attributedTo: `https://${domain}/u/${account}`,
    interactingObject,
    interactionTarget,
  };
  await apDb.insertMessage(guid, null, JSON.stringify(stamp));

  return stamp;
}

export async function getQuoteAuthorization(guid: string, domain: string, account: string): Promise<QuoteAuthorization | null> {
  const record = await getStoredObject(guid);

  if (record?.type === 'QuoteAuthorization') {
    return record;
  }

  // Approvals issued before stamps were stored kept the raw QuoteRequest
  // instead, and were handed out with the quoting post in a `remote` param.
  if (record?.type === 'QuoteRequest') {
    const interactingObject = uriOf(record.instrument);
    const interactionTarget = await findOwnPostId(uriOf(record.object), domain);
    if (!interactingObject || !interactionTarget) {
      return null;
    }

    return {
      id: `https://${domain}/u/${account}/quoteAuth/${guid}?remote=${encodeURIComponent(interactingObject)}`,
      type: 'QuoteAuthorization',
      attributedTo: `https://${domain}/u/${account}`,
      interactingObject,
      interactionTarget,
    };
  }

  return null;
}
