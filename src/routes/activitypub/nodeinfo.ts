// implementation of http://nodeinfo.diaspora.software/
// TODO: activeMonth and activeHalfyear should be dynamic, currently static
// TODO: enable override of nodeName and nodeDescription from settings
// homepage and repository may want to be updated for user-specific forks
// NB openRegistrations will always be false for a single-instance server

import express from 'express';
import { instanceType, instanceVersion } from '../../util.js';
import * as tvDb from '../../tvshow-db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const domain = req.app.get('domain');

  if (req.originalUrl === '/.well-known/nodeinfo') {
    const thisNode = {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
          href: `https://${domain}/nodeinfo/2.0`,
        },
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: `https://${domain}/nodeinfo/2.1`,
        },
      ],
    };
    res.json(thisNode);
  }

  if (req.originalUrl === '/nodeinfo/2.0') {
    const showCount = await tvDb.getShowCount();

    const nodeInfo = {
      version: 2.0,
      software: {
        name: instanceType,
        version: instanceVersion,
      },
      protocols: ['activitypub'],
      services: {
        outbound: ['atom1.0'],
        inbound: [],
      },
      usage: {
        users: {
          total: 1,
          activeMonth: 1,
          activeHalfyear: 1,
        },
        localPosts: showCount,
      },
      openRegistrations: false,
      metadata: {},
    };

    // spec says servers *should* set this, majority of implementations
    // appear to not bother with this detail, but we'll do right by the spec
    res.type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"');
    res.json(nodeInfo);
  }

  if (req.originalUrl === '/nodeinfo/2.1') {
    const showCount = await tvDb.getShowCount();

    const nodeInfo = {
      version: 2.1,
      software: {
        name: instanceType,
        version: instanceVersion,
        repository: 'https://github.com/stefanhayden/tvmarks',
        homepage: 'https://github.com/stefanhayden/tvmarks',
      },
      protocols: ['activitypub'],
      services: {
        outbound: ['atom1.0'],
        inbound: [],
      },
      usage: {
        users: {
          total: 1,
          activeMonth: 1,
          activeHalfyear: 1,
        },
        localPosts: showCount,
      },
      openRegistrations: false,
      metadata: {
        nodeName: 'Tvmarks',
        nodeDescription: 'A single-user tv tracking website designed to live on the Fediverse.',
      },
    };

    res.type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"');
    res.json(nodeInfo);
  }
});

export default router;
