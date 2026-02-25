// import express from 'express';
import crypto from 'crypto';
import * as linkify from 'linkifyjs';
import { actorMatchesUsername, parseJSON } from '../../util';
import { signAndSend, getInboxFromActorProfile } from '../../activitypub';

import { signedGetJSON } from '../../signature';
import { Request, Response } from 'express';
import * as apDb from '../../activity-pub-db';
import * as tvDb from '../../tvshow-db';

// helper type for options passed to sendAcceptMessage
interface SendAcceptOpts {
  localGuid?: string;
  remoteUri?: string;
}

// const router = express.Router();

export let sendAcceptMessage = async function (
  thebody: any,
  name: string,
  domain: string,
  req: Request,
  res: Response,
  targetDomain: string,
  opts: SendAcceptOpts = {},
): Promise<{ response: any; message: any }> {
  // opts may include `localGuid` (the stored id for a quote) and
  // `remoteUri` (the URI of the post being quoted).  When those values
  // are provided we embed them into the generated activity ID so that
  // clients such as PieFed can treat the URI itself as a
  // *stateless* QuoteAuthorization.  The receiver doesn't need to look
  // anything up in our database – the information necessary to revoke or
  // identify the permission is already encoded in the URL.
  const guid = crypto.randomBytes(16).toString('hex');

  let id = `https://${domain}/u/${name}/accept/${guid}`;
  if (opts.localGuid || opts.remoteUri) {
    // generate a quote‑approval style URI with query parameters
    const params = new URLSearchParams();
    if (opts.remoteUri) params.set('remote', opts.remoteUri);
    if (opts.localGuid) params.set('local', opts.localGuid);
    id = `https://${domain}/u/${name}/quoteAuth/${guid}?${params.toString()}`;
  }

  const message = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Accept',
    actor: `https://${domain}/u/${name}`,
    object: thebody,
  };

  try {
    // prefer the actor URL from the object, fall back to the outer actor
    const inboxActor = message.object?.actor || thebody.actor || req.body?.actor;
    const inbox = await getInboxFromActorProfile(inboxActor);

    const response = await signAndSend(message, name, domain, apDb, targetDomain, inbox);
    // return both response and message so callers (tests) can inspect the
    // constructed activity without needing to stub network behavior.
    return { response, message };
  } catch (e) {
    console.log('sendAcceptMessage error', e?.message || e);
    throw e;
  }
};

// test helper: allow overriding the internal binding during unit tests
// (ESM exports are read-only, so callers can't simply assign to
// `inboxMod.sendAcceptMessage`).
export function __test_overrideSendAcceptMessage(fn: typeof sendAcceptMessage) {
  sendAcceptMessage = fn;
}

async function handleFollowRequest(req: Request, res: Response) {
  const domain = req.app.get('domain');

  const myURL = new URL(req.body.actor);
  const targetDomain = myURL.hostname;
  const name = req.body.object.replace(`https://${domain}/u/`, '');

  try {
    // Accept the follow object itself
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

async function handleUnfollow(req: Request, res: Response) {
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

async function handleFollowAccepted(req: Request, res: Response) {
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

async function handleComment(
  req: Request<{}, {}, { actor: string; object: { id: string; content: string } }>,
  res: Response,
  inReplyToGuid: string | undefined,
) {
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

async function handleFollowedPost(req: Request, res: Response) {
  // ensure content is a string before passing to linkify; some
  // foreign servers send Notes with no `content` field, which would
  // cause `linkify.find(undefined)` to throw in its replace call.
  const content = typeof req.body.object?.content === 'string' ? req.body.object.content : '';
  const urls = linkify.find(content);
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

async function handleDeleteRequest(req: Request, res: Response) {
  console.log(JSON.stringify(req.body));

  const commentId = req.body?.object?.id;

  if (commentId) {
    await tvDb.deleteComment(commentId);
  }

  return res.status(200);
}

async function handleQuoteRequest(req: Request, res: Response) {
  // Mastodon sends QuoteRequest activities when a user wants to quote a post.
  // We automatically approve since we have automaticApproval set to Public.
  const domain = req.app.get('domain');
  const account = req.app.get('account');
  const myURL = new URL(req.body.actor);
  const targetDomain = myURL.hostname;

  try {
    // Extract the quoted status URI from the instrument field
    const instrumentUri = typeof req.body.instrument === 'string'
      ? req.body.instrument
      : req.body.instrument?.id;

    // Generate a unique GUID for this quote approval
    const guid = crypto.randomBytes(16).toString('hex');

    // Store the quote request in the database
    await apDb.insertMessage(guid, null, JSON.stringify(req.body));

    // Build the approval/authorization URI
    const approvalUri = `https://${domain}/u/${account}/quoteAuth/${guid}${instrumentUri ? `?remote=${encodeURIComponent(instrumentUri)}` : ''}`;

    // Build the Accept response with the result field Mastodon expects
    const acceptMessage = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${domain}/u/${account}/accept/${guid}`,
      type: 'Accept',
      actor: `https://${domain}/u/${account}`,
      object: req.body,
      // Mastodon expects the approval URI in the 'result' field
      result: approvalUri,
    };

    // Send the Accept to the requester's inbox
    const inbox = await getInboxFromActorProfile(req.body.actor);
    await signAndSend(acceptMessage, account, domain, apDb, targetDomain, inbox);

    console.log('Auto-approved QuoteRequest from', req.body.actor);
    console.log('Approval URI:', approvalUri);
    return res.sendStatus(200);
  } catch (e) {
    console.log('Error handling QuoteRequest:', e);
    return res.sendStatus(500);
  }
}

export const inboxRoute = async (req: Request, res: Response): Promise<any> => {
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
  // Handle QuoteRequest activities from Mastodon
  if (req.body.type === 'QuoteRequest') {
    return handleQuoteRequest(req, res);
  }
  // Handle Ask activities for quote requests (for other implementations)
  if (req.body.type === 'Ask' && (req.body.object?.type === 'Quote' || req.body.object?.quoteUrl)) {
    return handleQuoteRequest(req, res);
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
        // capture the quoted URI so we can embed it in the authorization
        const remoteUri = req.body.quoteUrl || req.body.quote?.id || req.body.object?.quoteUrl || req.body.object?.quote?.id || null;

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
          // sendAcceptMessage expects the local account name as `name`.
          // We want to approve *only* the Quote object, not the entire
          // Create activity; Mastodon sees the Accept for the Quote and
          // marks the post as approved.  Build a minimal object if needed.
          let acceptTarget: any = req.body;
          if (req.body.object?.quote) {
            acceptTarget = req.body.object.quote;
          } else if (remoteUri) {
            // fallback compose a Quote-like object if only a URL is
            // available (some implementations send only quoteUrl)
            acceptTarget = {
              type: 'Quote',
              id: remoteUri,
              url: remoteUri,
            };
          }

          await sendAcceptMessage(acceptTarget, myAccount, myDomain, req, res, targetDomain, {
            localGuid: guid,
            remoteUri,
          });
        } catch (e) {
          console.log('error sending accept message for quote in inbox', e);
        }
      } // close if (hasQuote)
    } catch (e) {
      console.log('error checking/storing/sending accept for quote in inbox', e);
    }

    return handleFollowedPost(req, res);
  }
  return res.sendStatus(400);
};
