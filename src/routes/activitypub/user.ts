import express, { Request, Response } from 'express';
import { synthesizeActivity } from '../../activitypub';
import { inboxRoute } from './inbox';
import * as apDb from '../../activity-pub-db';

const router = express.Router();

router.post('/:name/inbox', inboxRoute);

router.get('/:name', async (req, res) => {
  let { name } = req.params;
  if (!name) {
    return res.status(400).send('Bad request.');
  }

  if (!req.headers.accept?.includes('json')) {
    return res.redirect('/');
  }

  const domain = req.app.get('domain');
  const username = name;
  name = `${name}@${domain}`;

  const actor = await apDb.getActor();

  if (actor === undefined) {
    return res.status(404).send(`No actor record found for ${name}.`);
  }
  const tempActor = JSON.parse(actor);
  // Added this followers URI for Pleroma compatibility, see https://github.com/dariusk/rss-to-activitypub/issues/11#issuecomment-471390881
  // New Actors should have this followers URI but in case of migration from an old version this will add it in on the fly
  if (tempActor.followers === undefined) {
    tempActor.followers = `https://${domain}/u/${username}/followers`;
  }
  if (tempActor.outbox === undefined) {
    tempActor.outbox = `https://${domain}/u/${username}/outbox`;
  }
  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(tempActor);
});

router.get('/:name/followers', async (req, res) => {
  const { name } = req.params;
  if (!name) {
    return res.status(400).send('Bad request.');
  }

  const domain = req.app.get('domain');

  const followersJson = await apDb.getFollowers();
  let followers = [];
  if (followersJson) {
    followers = JSON.parse(followersJson);
  }

  const followersCollection = {
    type: 'OrderedCollection',
    totalItems: followers?.length || 0,
    id: `https://${domain}/u/${name}/followers`,
    first: {
      type: 'OrderedCollectionPage',
      totalItems: followers?.length || 0,
      partOf: `https://${domain}/u/${name}/followers`,
      orderedItems: followers,
      id: `https://${domain}/u/${name}/followers?page=1`,
    },
    '@context': ['https://www.w3.org/ns/activitystreams'],
  };
  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(followersCollection);
});

router.get('/:name/following', async (req, res) => {
  const { name } = req.params;
  if (!name) {
    return res.status(400).send('Bad request.');
  }

  const domain = req.app.get('domain');

  const followingText = (await apDb.getFollowing()) || '[]';
  const following = JSON.parse(followingText);

  const followingCollection = {
    type: 'OrderedCollection',
    totalItems: following?.length || 0,
    id: `https://${domain}/u/${name}/following`,
    first: {
      type: 'OrderedCollectionPage',
      totalItems: following?.length || 0,
      partOf: `https://${domain}/u/${name}/following`,
      orderedItems: following,
      id: `https://${domain}/u/${name}/following?page=1`,
    },
    '@context': ['https://www.w3.org/ns/activitystreams'],
  };
  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(followingCollection);
});

type CollectionPage = {
  type: string;
  partOf: string;
  orderedItems: unknown[];
  id: string;
  first: string;
  last: string;
  next?: string;
  prev?: string;
};

type OutboxCollection = {
  type: string;
  totalItems: number;
  '@context': string[];
  id: string;
  first: string;
  last: string;
};

router.get('/:name/outbox', async (req: Request<{}, {}, {}, { page: string }>, res: Response) => {
  const domain = req.app.get('domain');
  const account = req.app.get('account');

  function pageLink(p) {
    return `https://${domain}/u/${account}/outbox?page=${p}`;
  }

  const pageSize = 20;
  const totalCount = await apDb.getMessageCount();
  const lastPage = Math.ceil(totalCount / pageSize);

  if (req.query?.page === undefined) {
    // Send collection
    const outboxCollection: OutboxCollection = {
      type: 'OrderedCollection',
      totalItems: totalCount,
      id: `https://${domain}/u/${account}/outbox`,
      first: pageLink(1),
      last: pageLink(lastPage),
      '@context': ['https://www.w3.org/ns/activitystreams'],
    };

    return res.json(outboxCollection);
  }

  if (!/^\d+$/.test(req.query.page)) {
    return res.status(400).send('Invalid page number');
  }

  const page = parseInt(req.query.page, 10);
  if (page < 1 || page > lastPage) return res.status(400).send('Invalid page number');

  const offset = (page - 1) * pageSize;
  const notes = await apDb.getMessages(offset, pageSize);
  const activities = notes.map((n) => synthesizeActivity(JSON.parse(n.message)));

  const collectionPage: CollectionPage = {
    type: 'OrderedCollectionPage',
    partOf: `https://${domain}/u/${account}/outbox`,
    orderedItems: activities,
    id: pageLink(page),
    first: pageLink(1),
    last: pageLink(lastPage),
  };

  if (page + 1 <= lastPage) {
    collectionPage.next = pageLink(page + 1);
  }

  if (page > 1) {
    collectionPage.prev = pageLink(page - 1);
  }
  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(collectionPage);
});

// Quote authorization route - serves authorization stamps for approved quotes
// This is referenced in Accept activities sent by the inbox when auto-approving quotes
router.get('/:name/quoteAuth/:guid', async (req: Request<{ name: string; guid: string }, {}, {}, { remote?: string; local?: string }>, res: Response) => {
  const { name, guid } = req.params;
  const { remote, local } = req.query;

  if (!name || !guid) {
    return res.status(400).send('Bad request.');
  }

  const domain = req.app.get('domain');
  const account = req.app.get('account');

  // Verify the account name matches
  if (name !== account) {
    return res.status(404).send('Not found.');
  }

  // The authorization is stateless and encoded in the URL.
  // If we have the local guid, we can verify the quote exists in our database
  if (local) {
    try {
      const message = await apDb.getMessage(local);
      if (!message) {
        return res.status(404).send('Quote authorization not found.');
      }
    } catch (e) {
      console.log('Error verifying quote authorization:', e);
      return res.status(500).send('Server error.');
    }
  }

  // Build the QuoteAuthorization object as per FEP-044f
  // This tells remote servers that the quote has been approved
  const authorizationUrl = `https://${domain}/u/${name}/quoteAuth/${guid}${remote || local ? '?' : ''}${remote ? `remote=${encodeURIComponent(remote)}` : ''}${remote && local ? '&' : ''}${local ? `local=${encodeURIComponent(local)}` : ''}`;

  const quoteAuthorization = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: authorizationUrl,
    type: 'QuoteAuthorization',
    attributedTo: `https://${domain}/u/${account}`,
    ...(remote && { interactionTarget: remote }),
    ...(local && { interactingObject: `https://${domain}/m/${local}` }),
  };

  res.setHeader('Content-Type', 'application/activity+json');
  return res.json(quoteAuthorization);
});

export default router;
