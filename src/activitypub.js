import fetch from 'node-fetch';
import crypto from 'crypto';
import escapeHTML from 'escape-html';

import { signedGetJSON, signedPostJSON } from './signature.js';
import { actorInfo, actorMatchesUsername } from './util.js';

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

  // let titleText = `<a href="https://${domain}/${data.path}" rel="nofollow noopener noreferrer">${data.name}</a>`;

  // const name = escapeHTML(data.name);
  let description = escapeHTML(data.description || '');

  if (description?.trim().length > 0) {
    description = description ? `<br/><br/>${description?.trim().replace('\n', '<br/>') || ''}` : '';
  }

  const content = `<p><strong>${data.title}</strong>${description}</p>`;
  const noteMessage = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${domain}/m/${guidNote}`,
    type: 'Note',
    published: d.toISOString(),
    attributedTo: `https://${domain}/u/${account}`,
    content,
    contentMap: {
      EN: content,
    },
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    tag: [
      {
        type: 'Hashtag',
        href: `https://${domain}/tagged/tvmarks`,
        name: '#tvmarks',
      },
    ],
  };

  try {
    const showHashTag = data.url
      .split('/')
      .reverse()[0]
      .split('-')
      .map((val) => String(val).charAt(0).toUpperCase() + String(val).slice(1))
      .join('');
    noteMessage.tag.push({
      type: 'Hashtag',
      href: `https://${domain}/tagged/${showHashTag}`,
      name: `#${showHashTag}`,
    });
  } catch (e) {
    console.error('failed to turn tvshow in to hashtag');
  }

  return noteMessage;
}

function createMessage(noteObject, dataId, account, domain, db) {
  const guidCreate = crypto.randomBytes(16).toString('hex');

  const message = {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id: `https://${domain}/m/${guidCreate}`,
    type: 'Create',
    actor: `https://${domain}/u/${account}`,
    to: [`https://${domain}/u/${account}/followers/`, 'https://www.w3.org/ns/activitystreams#Public'],
    object: noteObject,
  };

  db.insertMessage(getGuidFromPermalink(noteObject.id), dataId, JSON.stringify(noteObject));

  return message;
}

async function createUpdateMessage(data, account, domain, db) {
  const guid = await db.getGuidForId(data.id);

  const note = {
    ...createNoteObject(data, account, domain),
    id: `https://${domain}/m/${guid}`,
    updated: new Date().toISOString(),
  };

  const updateMessage = {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    summary: `${account} updated the show`,
    type: 'Update',
    actor: `https://${domain}/u/${account}`,
    object: note,
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

  console.log('result', messageRows);

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
  const data = await response.json();

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
    const data = await response.json();
    const selfLink = data.links.find((o) => o.rel === 'self');
    if (!selfLink || !selfLink.href) {
      throw new Error();
    }

    return selfLink.href;
  } catch (e) {
    console.log("couldn't look up canonical actor info");
    return null;
  }
}

export async function broadcastMessage(data, action, db, account, domain) {
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
        .filter((x) => !x?.match(/^@([^@]+)@(.+)$/)) || [];

    // now let's try to remove the blocked users
    followers.filter((actor) => {
      const matches = blocklist.forEach((username) => {
        actorMatchesUsername(actor, username);
      });

      return !matches?.some((x) => x);
    });

    const noteObject = createNoteObject(data, account, domain);
    let message;
    switch (action) {
      case 'create':
        message = createMessage(noteObject, data.id, account, domain, db);
        break;
      case 'update':
        message = await createUpdateMessage(data, account, domain, db);
        break;
      case 'delete':
        message = await createDeleteMessage(data, account, domain, db);
        break;
      default:
        console.log('unsupported action!');
        return;
    }

    console.log(`sending this message to all followers: ${JSON.stringify(message)}`);
    console.log('followers', followers);
    // eslint-disable-next-line no-restricted-syntax
    for (const follower of followers) {
      const inbox = `${follower}/inbox`;
      const myURL = new URL(follower);
      const targetDomain = myURL.host;
      console.log('test', {});
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
