// import express from 'express';
import crypto from 'crypto';
import * as linkify from 'linkifyjs';
import { actorMatchesUsername, parseJSON } from '../../util';
import { signAndSend, getInboxFromActorProfile } from '../../activitypub';

import { signedGetJSON } from '../../signature';
import { Request, Response } from 'express';
import * as apDb from '../../activity-pub-db';
import * as tvDb from '../../tvshow-db';

// const router = express.Router();

async function sendAcceptMessage(thebody, name, domain, req, res, targetDomain) {
  const guid = crypto.randomBytes(16).toString('hex');
  const message = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${domain}/u/${name}/accept/${guid}`,
    type: 'Accept',
    actor: `https://${domain}/u/${name}`,
    object: thebody,
  };

  try {
    // prefer the actor URL from the object, fall back to the outer actor
    const inboxActor = message.object?.actor || thebody.actor || req.body?.actor;
    const inbox = await getInboxFromActorProfile(inboxActor);

    return signAndSend(message, name, domain, apDb, targetDomain, inbox);
  } catch (e) {
    console.log('sendAcceptMessage error', e?.message || e);
    throw e;
  }
}

async function handleFollowRequest(req, res) {
  const domain = req.app.get('domain');

  const myURL = new URL(req.body.actor);
  const targetDomain = myURL.hostname;
  const name = req.body.object.replace(`https://${domain}/u/`, '');

  try {
    await sendAcceptMessage(req.body, name, domain, req, res, targetDomain);
  } catch (e) {
    console.log('failed to send Accept for follow request', e?.message || e);
  }
  // Add the user to the DB of accounts that follow the account

  // get the followers JSON for the user
  const oldFollowersText = (await apDb.getFollowers()) || '[]';

  // update followers
  let followers = parseJSON(oldFollowersText);
  if (followers) {
    followers.push(req.body.actor);
    // unique items
    followers = [...new Set(followers)];
  } else {
    followers = [req.body.actor];
  }
  const newFollowersText = JSON.stringify(followers);
  try {
    // update into DB
    await apDb.setFollowers(newFollowersText);

    console.log('updated followers!');
  } catch (e) {
    console.log('error storing followers after follow', e);
  }

  return res.status(200);
}

async function handleUnfollow(req, res) {
  const domain = req.app.get('domain');

  const myURL = new URL(req.body.actor);
  const targetDomain = myURL.hostname;
  const name = req.body.object.object.replace(`https://${domain}/u/`, '');

  try {
    await sendAcceptMessage(req.body, name, domain, req, res, targetDomain);
  } catch (e) {
    console.log('failed to send Accept for unfollow', e?.message || e);
  }

  // get the followers JSON for the user
  const oldFollowersText = (await apDb.getFollowers()) || '[]';

  // update followers
  const followers = parseJSON(oldFollowersText);
  if (followers) {
    followers.forEach((follower, idx) => {
      if (follower === req.body.actor) {
        followers.splice(idx, 1);
      }
    });
  }

  const newFollowersText = JSON.stringify(followers);

  try {
    await apDb.setFollowers(newFollowersText);
    return res.sendStatus(200);
  } catch (e) {
    console.log('error storing followers after unfollow', e);
    return res.status(500);
  }
}

async function handleFollowAccepted(req, res) {
  const oldFollowingText = (await apDb.getFollowing()) || '[]';

  let follows = parseJSON(oldFollowingText);

  if (follows) {
    follows.push(req.body.actor);
    // unique items
    follows = [...new Set(follows)];
  } else {
    follows = [req.body.actor];
  }
  const newFollowingText = JSON.stringify(follows);

  try {
    // update into DB
    await apDb.setFollowing(newFollowingText);

    console.log('updated following!');
    return res.status(200);
  } catch (e) {
    console.log('error storing follows after follow action', e);
    return res.status(500);
  }
}

async function handleComment(req: Request<{}, {}, { actor: string; object: { id: string; content: string } }>, res: Response, inReplyToGuid) {
  const id = await apDb.getIdFromMessageGuid(inReplyToGuid);

  if (typeof id !== 'string') {
    console.log("couldn't find the id this message is related to");
    return res.sendStatus(400);
  }

  const permissions = await apDb.getPermissions(id);
  const globalPermissions = await apDb.getGlobalPermissions();

  const blocks = permissions?.blocked?.split('\n') || [];
  const globalBlocks = globalPermissions?.blocked?.split('\n') || [];

  const allows = permissions?.allowed?.split('\n') || [];
  const globalAllows = globalPermissions?.allowed?.split('\n') || [];

  const blocklist = blocks.concat(globalBlocks).filter((x) => x.match(/^@([^@]+)@(.+)$/));
  const allowlist = allows.concat(globalAllows).filter((x) => x.match(/^@([^@]+)@(.+)$/));

  if (blocklist.length > 0 && blocklist.map((username) => actorMatchesUsername(req.body.actor, username)).some((x) => x)) {
    console.log(`Actor ${req.body.actor} matches a blocklist item, ignoring comment`);
    return res.sendStatus(403);
  }

  const response = await signedGetJSON(req.body.actor);
  const data = (await response.json()) as { preferredUsername: string };

  const actorDomain = new URL(req.body.actor)?.hostname;
  const actorUsername = data.preferredUsername;
  const actor = `@${actorUsername}@${actorDomain}`;

  const commentUrl = req.body.object.id;
  let visible = 0;
  if (allowlist.map((username) => actorMatchesUsername(req.body.actor, username)).some((x) => x)) {
    console.log(`Actor ${req.body.actor} matches an allowlist item, marking comment visible`);
    visible = 1;
  }

  tvDb.createComment(id, actor, commentUrl, req.body.object.content, visible);

  return res.status(200);
}

async function handleFollowedPost(req, res) {
  const urls = linkify.find(req.body.object.content);
  if (urls?.length > 0) {
    // store this for now
    // TODO: determine if the actor is in your current follow list!

    const response = await signedGetJSON(`${req.body.actor}.json`);
    const data = (await response.json()) as { preferredUsername: string };

    const actorDomain = new URL(req.body.actor)?.hostname;
    const actorUsername = data.preferredUsername;
    const actor = `@${actorUsername}@${actorDomain}`;

    const commentUrl = req.body.object.id;

    tvDb.createComment(undefined, actor, commentUrl, req.body.object.content, 0);
  }

  return res.status(200);
}

async function handleDeleteRequest(req, res) {
  console.log(JSON.stringify(req.body));

  const commentId = req.body?.object?.id;

  if (commentId) {
    await tvDb.deleteComment(commentId);
  }

  return res.status(200);
}

export const inboxRoute = async (req, res) => {
  if (typeof req.body.object === 'string' && req.body.type === 'Follow') {
    return handleFollowRequest(req, res);
  }

  if (req.body.type === 'Undo' && req.body.object?.type === 'Follow') {
    return handleUnfollow(req, res);
  }
  if (req.body.type === 'Accept' && req.body.object?.type === 'Follow') {
    return handleFollowAccepted(req, res);
  }
  if (req.body.type === 'Delete') {
    return handleDeleteRequest(req, res);
  }
  if (req.body.type === 'Create' && req.body.object?.type === 'Note') {
    console.log(JSON.stringify(req.body));

    const domain = req.app.get('domain');
    const inReplyToGuid = req.body.object?.inReplyTo?.match(`https://${domain}/m/(.+)`)?.[1];

    if (inReplyToGuid) {
      return handleComment(req, res, inReplyToGuid);
    }
    // store incoming posts that quote our content so we can list/revoke them
    try {
      const hasQuote = !!(req.body.quoteUrl || req.body.quote || req.body.object?.quoteUrl || req.body.object?.quote);
      if (hasQuote) {
        const guid = crypto.randomBytes(16).toString('hex');
        try {
          await apDb.insertMessage(guid, null, JSON.stringify(req.body));
        } catch (e) {
          console.log('failed to store incoming quote message', e);
        }

        try {
          // Auto-accept the quote so Mastodon-like clients treat it as approved.
          const myDomain = req.app.get('domain');
          const myAccount = req.app.get('account');
          const myURL = new URL(req.body.actor);
          const targetDomain = myURL.hostname;
          // sendAcceptMessage expects the local account name as `name`
          await sendAcceptMessage(req.body, myAccount, myDomain, req, res, targetDomain);
        } catch (e) {
          console.log('failed to send Accept for incoming quote', e);
        }
      }
    } catch (e) {
      console.log('error checking/storing/sending accept for quote in inbox', e);
    }

    return handleFollowedPost(req, res);
  }
  return res.sendStatus(400);
};

// router.post('/', inboxRoute);

// export default router;
