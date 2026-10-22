import fetch from 'node-fetch';
import crypto from 'crypto';
import escapeHTML from 'escape-html';

import { signedGetJSON, signedPostJSON } from './signature';
import { actorInfo, actorMatchesUsername, episodeHashtags, parseHashtags, cleanHashtag } from './util';

// "#TheOffice" from a show's TVMaze url, like https://www.tvmaze.com/shows/526/the-office. Unlike a hashtag typed in, a
// show named only with numbers, like 24, keeps one
export function showHashtag(showUrl: string): string | undefined {
  const slug = String(showUrl || '').split('/').reverse()[0];
  const tag = slug
    .split('-')
    .map((val) => val.charAt(0).toUpperCase() + val.slice(1))
    .join('');
  return cleanHashtag(tag) || undefined;
}

type PostedShow = { id: number | string; name: string; url: string; note?: string | null; tags?: string | null };
type PostedEpisode = { id: number | string; season: number; number: number; note?: string | null; tags?: string | null };

// the post for adding a show, also used to update it when the show's note or hashtags change
export const showPostData = (show: PostedShow, domain: string) => ({
  id: `show-${show.id}`,
  path: `show/${show.id}`,
  url: show.url,
  description: show.note || '',
  title: `Started following: <a href="https://${domain}/show/${show.id}" rel="nofollow noopener noreferrer">${escapeHTML(show.name)}</a>`,
  tags: parseHashtags(show.tags),
});

// the post for watching an episode
export const episodePostData = (show: PostedShow, episode: PostedEpisode, domain: string) => ({
  id: `show-${show.id}-episode-${episode.id}`,
  path: `show/${show.id}`,
  url: show.url,
  description: episode.note || '',
  title: `<a href="https://${domain}/show/${show.id}" rel="nofollow noopener noreferrer">${escapeHTML(show.name)}</a>: Watched s${episode.season}e${
    episode.number
  }`,
  tags: episodeHashtags(show, episode),
});

export const taggedUrl = (domain: string, tag: string) => `https://${domain}/tagged/${encodeURIComponent(tag)}`;

// every post is tagged #tvmarks and with its show, plus the hashtags given to the show or episode. The given ones are
// also written into the post so they show up in it, a post's tag list alone is easy to miss
function hashtagsFor(domain: string, showUrl: string, showPath: string, tags: string[] = []) {
  const automatic = [
    { type: 'Hashtag', href: `https://${domain}/`, name: '#tvmarks' },
    ...[showHashtag(showUrl)].filter(Boolean).map((tag) => ({ type: 'Hashtag', href: `https://${domain}/${showPath}`, name: `#${tag}` })),
  ];
  // a given hashtag that is also an automatic one links where the automatic one does, in the tag list and the post alike
  const hrefOf = (tag: string) => automatic.find((auto) => auto.name.toLowerCase() === `#${tag.toLowerCase()}`)?.href;
  const given = tags.filter((tag) => !hrefOf(tag));
  return {
    tag: [...automatic, ...given.map((tag) => ({ type: 'Hashtag', href: taggedUrl(domain, tag), name: `#${tag}` }))],
    content: tags.length
      ? `<p>${tags
          .map((tag) => `<a href="${hrefOf(tag) || taggedUrl(domain, tag)}" class="mention hashtag" rel="tag">#<span>${escapeHTML(tag)}</span></a>`)
          .join(' ')}</p>`
      : '',
  };
}

function getGuidFromPermalink(urlString) {
  return urlString.match(/(?:\/m\/)([a-zA-Z0-9+/]+)/)[1];
}

export async function signAndSend(message, name, domain, db, targetDomain, inbox) {
  try {
    const response = await signedPostJSON(inbox, {
      body: JSON.stringify(message),
    });
    const data = await response.text();

    console.log(`---`, JSON.stringify(message));
    console.log(`Sent message to an inbox at ${targetDomain}!`);
    console.log('Response Status Code:', response.status);
    console.log('Response body:', data);
    return response;
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Stacktrace: ', error.stack);
    return error;
  }
}

export function createNoteObject(data, account, domain) {
  const guidNote = crypto.randomBytes(16).toString('hex');
  const d = new Date();

  let description = escapeHTML(data.description || '');

  if (description?.trim().length > 0) {
    description = description ? `<br/><br/>${description?.trim().replace('\n', '<br/>') || ''}` : '';
  }

  const hashtags = hashtagsFor(domain, data.url, data.path, data.tags);
  const content = `<p><strong>${data.title}</strong>${description}</p>${hashtags.content}`;
  const noteMessage = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        quoteUrl: 'as:quoteUrl',
        gts: 'https://gotosocial.org/ns#',
        interactionPolicy: { '@id': 'gts:interactionPolicy', '@type': '@id' },
        canQuote: { '@id': 'gts:canQuote', '@type': '@id' },
        automaticApproval: { '@id': 'gts:automaticApproval', '@type': '@id' },
      },
    ],
    id: `https://${domain}/m/${guidNote}`,
    type: 'Note',
    published: d.toISOString(),
    attributedTo: `https://${domain}/u/${account}`,
    content,
    contentMap: {
      EN: content,
    },
    url: `https://${domain}/${data.path}`,
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    tag: hashtags.tag,
    // allow quoting per FEP-044f; Mastodon and other implementations will
    // respect this interaction policy when rendering the note.
    interactionPolicy: {
      canQuote: {
        automaticApproval: ['https://www.w3.org/ns/activitystreams#Public'],
      },
    },
    // note: `quoteUrl` must not live inside the Note itself for broadcast
    // posts — that causes receivers (eg. Mastodon) to embed the quoted
    // object inside the original Note. Instead, `quoteUrl` should be
    // attached to the Activity (Create/Update) top-level object.
  };

  return noteMessage;
}

export function createEpisodeNoteObject(episode, show, account, domain) {
  const d = new Date(episode.airstamp || new Date());

  let description = escapeHTML(episode.note || '');
  if (description?.trim().length > 0) {
    description = `<br/><br/>${description?.trim().replace('\n', '<br/>') || ''}`;
  }

  const episodeTitle = `${escapeHTML(show.name)}: Watched s${episode.season}e${episode.number}`;
  const hashtags = hashtagsFor(domain, show.url, `show/${show.id}`, episodeHashtags(show, episode));
  const content = `<p><strong>${episodeTitle}</strong>${description}</p>${hashtags.content}`;

  const noteMessage = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        quoteUrl: 'as:quoteUrl',
        gts: 'https://gotosocial.org/ns#',
        interactionPolicy: { '@id': 'gts:interactionPolicy', '@type': '@id' },
        canQuote: { '@id': 'gts:canQuote', '@type': '@id' },
        automaticApproval: { '@id': 'gts:automaticApproval', '@type': '@id' },
      },
    ],
    id: `https://${domain}/show/${show.id}/episode/${episode.id}`,
    type: 'Note',
    published: d.toISOString(),
    attributedTo: `https://${domain}/u/${account}`,
    content,
    contentMap: {
      EN: content,
    },
    inReplyTo: show.url,
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    url: `https://${domain}/show/${show.id}/episode/${episode.id}`,
    tag: hashtags.tag,
    // allow quoting per FEP-044f
    interactionPolicy: {
      canQuote: {
        automaticApproval: ['https://www.w3.org/ns/activitystreams#Public'],
      },
    },
    // see note above — do not include `quoteUrl` inside the Note object
  };

  return noteMessage;
}

function createMessage(noteObject, dataId, account, domain, db, quoteUrl = null) {
  const guidCreate = crypto.randomBytes(16).toString('hex');

  const message = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      // include Mastodon's client quote namespace so receivers like Mastodon
      // can understand the `quote` attribute
      'https://joinmastodon.org/ns',
      { quoteUrl: 'as:quoteUrl' },
    ],
    id: `https://${domain}/m/${guidCreate}`,
    type: 'Create',
    actor: `https://${domain}/u/${account}`,
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    object: noteObject,
    ...(quoteUrl && {
      quoteUrl,
      quote: {
        type: 'Quote',
        id: quoteUrl,
        url: quoteUrl,
      },
    }),
  };

  db.insertMessage(getGuidFromPermalink(noteObject.id), dataId, JSON.stringify(noteObject));

  return message;
}

async function createUpdateMessage(data, account, domain, db, quoteUrl = null) {
  const guid = await db.getGuidForId(data.id);
  // never posted, like something from before the site federated
  if (!guid) return null;

  const note = {
    ...createNoteObject(data, account, domain),
    id: `https://${domain}/m/${guid}`,
    updated: new Date().toISOString(),
  };
  // the stored note is what /m/<guid> serves, so it says what the update says
  await db.insertMessage(guid, data.id, JSON.stringify(note));

  const updateMessage = {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1', 'https://joinmastodon.org/ns', { quoteUrl: 'as:quoteUrl' }],
    summary: `${account} updated the show`,
    type: 'Update',
    actor: `https://${domain}/u/${account}`,
    object: note,
    ...(quoteUrl && {
      quoteUrl,
      quote: {
        type: 'Quote',
        id: quoteUrl,
        url: quoteUrl,
      },
    }),
  };

  return updateMessage;
}

async function createDeleteMessage(show, account, domain, db) {
  const guid = await db.findMessageGuid(show.id);
  await db.deleteMessage(guid);

  const deleteMessage = {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id: `https://${domain}/m/${guid}`,
    type: 'Delete',
    actor: `https://${domain}/u/${account}`,
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    object: {
      type: 'Tombstone',
      id: `https://${domain}/m/${guid}`,
    },
  };

  return deleteMessage;
}

export async function createFollowMessage(account, domain, target, db) {
  const guid = crypto.randomBytes(16).toString('hex');
  const followMessage = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${domain}/m/${guid}`,
    type: 'Follow',
    actor: `https://${domain}/u/${account}`,
    object: target,
  };

  db.insertMessage(guid, null, JSON.stringify(followMessage));

  return followMessage;
}

export async function createUnfollowMessage(account, domain, target, db) {
  const undoGuid = crypto.randomBytes(16).toString('hex');

  const messageRows = await db.findMessage(target);

  const followMessages = messageRows?.filter((row) => {
    const message = JSON.parse(row.message || '{}');
    return message.type === 'Follow' && message.object === target;
  });

  if (followMessages?.length > 0) {
    const undoMessage = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Undo',
      id: undoGuid,
      actor: `${domain}/u/${account}`,
      object: followMessages.slice(-1).message,
    };
    return undoMessage;
  }
  console.log('tried to find a Follow record in order to unfollow, but failed');
  return null;
}

export async function getInboxFromActorProfile(profileUrl) {
  const response = await signedGetJSON(`${profileUrl}`);
  const data = await response.json() as { inbox?: string };

  if (data?.inbox) {
    return data.inbox;
  }
  throw new Error(`Couldn't find inbox at supplied profile url ${profileUrl}`);
}

// actorUsername format is @username@domain
export async function lookupActorInfo(actorUsername) {
  const parsedDomain = actorUsername.split('@').slice(-1);
  const parsedUsername = actorUsername.split('@').slice(-2, -1);
  try {
    const response = await fetch(`https://${parsedDomain}/.well-known/webfinger?resource=acct:${parsedUsername}@${parsedDomain}`);
    const data = (await response.json()) as { links: { rel: string; href: string }[] };
    const selfLink = data.links.find((o) => o.rel === 'self');
    if (!selfLink || !selfLink.href) {
      throw new Error();
    }

    return selfLink.href;
  } catch (e) {
    console.log("couldn't look up canonical actor info", e);
    return null;
  }
}

export async function broadcastMessage(data, action, db, account, domain, quoteUrl = null) {
  if (actorInfo.disabled) {
    return; // no fediverse setup, so no purpose trying to send messages
  }

  const result = await db.getFollowers();
  const followers = JSON.parse(result);

  if (followers === null) {
    console.log(`No followers for account ${account}@${domain}`);
  } else {
    const showPermissions = await db.getPermissions(data.id);
    const globalPermissions = await db.getGlobalPermissions();
    const blocklist =
      showPermissions?.blocked
        ?.split('\n')
        ?.concat(globalPermissions?.blocked?.split('\n'))
        .filter((x) => x?.match(/^@([^@]+)@(.+)$/)) || [];

    // Filter out blocked users from the followers list
    const allowedFollowers = followers.filter((actor) => {
      const isBlocked = blocklist.some((username) => actorMatchesUsername(actor, username));
      return !isBlocked;
    });

    const noteObject = createNoteObject(data, account, domain);
    let message;
    switch (action) {
      case 'create':
        message = createMessage(noteObject, data.id, account, domain, db, quoteUrl);
        break;
      case 'update':
        message = await createUpdateMessage(data, account, domain, db, quoteUrl);
        break;
      case 'delete':
        message = await createDeleteMessage(data, account, domain, db);
        break;
      default:
        console.log('unsupported action!');
        return;
    }
    if (!message) return;

    console.log(`sending this message to all followers: ${JSON.stringify(message)}`);
    console.log('followers', allowedFollowers);
    for (const follower of allowedFollowers) {
      const inbox = `${follower}/inbox`;
      const myURL = new URL(follower);
      const targetDomain = myURL.host;

      signAndSend(message, account, domain, db, targetDomain, inbox);
    }
  }
}

export function synthesizeActivity(note) {
  return {
    // Fake activity URI adds a "a-" prefix to the Note/message guid
    id: note.id.replace('/m/', '/m/a-'),
    type: 'Create',
    published: note.published,
    actor: note.attributedTo,
    object: note,
  };
}
