import express from 'express';
import escapeHTML from 'escape-html';
import { account, domain } from '../util';
import { isAuthenticated } from '../session-auth';
import { broadcastMessage, createEpisodeNoteObject, createNoteObject } from '../activitypub';
import { refreshShowEpisodesData } from './admin';
import * as apDb from '../activity-pub-db';
import * as tvDb from '../tvshow-db';

const router = express.Router();
export default router;

function isActivityPubRequested(req: express.Request): boolean {
  const acceptHeader = req.get('Accept') || '';
  return acceptHeader.includes('application/activity+json') || acceptHeader.includes('application/ld+json') || req.query.format === 'json';
}

type Seasons = {
  title: string;
  showId: string | number;
  seasonId: string | number;
  isWatched: boolean;
  episodes: unknown[];
};

router.get('/:showId', async (req, res) => {
  const params: {
    title?: string;
    show?: any;
    openGraph?: { image: string };
    hideTitle?: boolean;
    episode?: unknown;
    comments?: unknown;
    comment_count?: number;
    allowed?: unknown;
    blocked?: unknown;
    seasons?: Seasons[];
    activityUrl?: string;
  } = {};
  const now = new Date();

  const show = await tvDb.getShow(req.params.showId);

  if (!show) {
    return res.redirect(301, `/`);
  }

  params.show = show;

  if (show.image) {
    params.openGraph = {
      image: `https://${req.app.get('domain')}/${show.image}`,
    };
  }

  const comments =
    'loggedIn' in req.session && req.session.loggedIn
      ? await tvDb.getAllComments(`show-${req.params.showId}`)
      : await tvDb.getVisibleComments(`show-${req.params.showId}`);

  params.comments = comments;
  params.comment_count = comments.length || 0;

  const episodes = (await tvDb.getEpisodesByShowId(req.params.showId)).map((e) => {
    const daysUntill = e.airstamp ? Math.round((now.getTime() - new Date(e.airstamp).getTime()) / (24 * 60 * 60 * 1000)) : undefined;

    return {
      ...e,
      isWatched: e.watched_status === 'WATCHED',
      // not_aired: e.airstamp ? new Date(e.airstamp) > now : true,
      not_aired: daysUntill < 0,
      days_untill: daysUntill <= 0 ? Math.abs(daysUntill) : 'Unkown',
    };
  });

  // GROUP BY SEASON
  params.seasons = [];
  const seasons = episodes.reduce((acc, val) => (val.season > acc ? val.season : acc), 1);
  for (let seasonId = 1; seasonId <= seasons; seasonId += 1) {
    const eps = episodes.filter((val) => val.season === seasonId && val.number);
    params.seasons.push({
      title: `Season ${seasonId}`,
      showId: show.id,
      seasonId,
      isWatched: eps.every((val) => val.isWatched) && eps.length > 0,
      episodes: eps,
    });
  }

  const specials = episodes.filter((val) => !val.number);
  if (specials.length > 0) {
    params.seasons.push({
      title: 'Specials',
      showId: show.id,
      seasonId: 'SPECIAL',
      isWatched: specials.every((val) => val.isWatched),
      episodes: specials,
    });
  }

  if (show.last_watched_episode_id) {
    episodes.forEach((e) => {
      if (e.number !== null) {
        if (!params.show.watchNextEpisode && !e.isWatched && new Date(e.airstamp) < now) {
          params.show.watchNextEpisode = e;
        }
      }
    });
  }

  const permissions = await apDb.getPermissions(`show-${show.id}`);
  params.allowed = permissions?.allowed;
  params.blocked = permissions?.blocked;

  params.title = show.name;

  // Check if requesting ActivityPub format
  if (isActivityPubRequested(req)) {
    const noteObject = createNoteObject(
      {
        title: show.name,
        description: show.note || '',
        path: `show/${show.id}`,
        url: show.url || `https://${req.app.get('domain')}/show/${show.id}`,
        name: show.name,
      },
      account,
      domain,
    );
    res.set('Content-Type', 'application/activity+json');
    return res.json(noteObject);
  }

  // Add ActivityPub discovery link for HTML consumers
  params.activityUrl = `https://${req.app.get('domain')}/show/${show.id}?format=json`;

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('show', params);
});

const getEpisodeStatusUpdatedValues = (allEps) => {
  const aired_episodes_count =
    allEps.filter((ep) => {
      return ep.airstamp !== null && new Date(ep.airstamp) < new Date();
    })?.length || 0;
  const watched_episodes_count = allEps.filter((ep) => ep.watched_status === 'WATCHED')?.length || 0;

  // reversed to make it easy to find last watched episode
  const allEpsReversed = [...allEps].reverse();

  const last_watched_episode_index = allEpsReversed.findIndex((ep) => ep.watched_status === 'WATCHED');
  const last_watched_episode = allEpsReversed[last_watched_episode_index];
  const last_watched_date = last_watched_episode?.watched_at;
  const last_watched_episode_id = last_watched_episode?.id || null;

  const next_episode_towatch =
    allEpsReversed.find((ep, index) => last_watched_episode_index - 1 === index) || allEpsReversed.find((ep) => ep.watched_status !== 'WATCHED');
  const next_episode_towatch_airdate = next_episode_towatch?.airstamp || null;

  return {
    aired_episodes_count,
    watched_episodes_count,
    last_watched_date,
    last_watched_episode_id,
    next_episode_towatch_airdate,
    abandoned: 0,
  };
};

router.post('/:showId/episode/:episodeId/status', async (req, res) => {
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;

  const updatedEp = await tvDb.updateEpisodeWatchStatus(req.params.episodeId, status);
  const allEpsWithNulls = await tvDb.getEpisodesByShowId(req.params.showId);

  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);

  const updatedShow = await tvDb.updateShow(req.params.showId, getEpisodeStatusUpdatedValues(allEps));

  if (status) {
    // watched ep
    const data = {
      id: `show-${updatedShow.id}-episode-${updatedEp.id}`,
      path: `show/${updatedShow.id}`,
      url: updatedShow.url,
      description: updatedEp.note || '',
      title: `<a href="https://${domain}/show/${updatedShow.id}" rel="nofollow noopener noreferrer">${escapeHTML(updatedShow.name)}</a>: Watched s${
        updatedEp.season
      }e${updatedEp.number}`,
    };
    const quote = `https://${domain}/show/${updatedShow.id}/episode/${updatedEp.id}`;
    broadcastMessage(data, 'create', apDb, account, domain, quote);
  } else {
    const quote = `https://${domain}/show/${updatedShow.id}/episode/${updatedEp.id}`;
    // unwatched episode
    const data = {
      id: `show-${updatedShow.id}-episode-${updatedEp.id}`,
      path: `show/${updatedShow.id}`,
      url: updatedShow.url,
    };
    broadcastMessage(data, 'delete', apDb, account, domain, quote);
  }

  if (req.body.returnHash) {
    res.redirect(301, `/show/${req.params.showId}#${req.body.returnHash}`);
  } else {
    res.redirect(301, `/show/${req.params.showId}#season${updatedEp.season}`);
  }
});

router.post('/:showId/episode/:episodeId/update', async (req, res) => {
  const { note } = req.body;
  const updatedEp = await tvDb.updateEpisodeNote(req.params.episodeId, note);

  const addedShow = await tvDb.getShow(req.params.showId);
  const id = `show-${addedShow.id}-episode-${updatedEp.id}`;
  if (updatedEp.watched_status === 'WATCHED') {
    const data = {
      id,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
      description: req.body.note || '',
      title: `<a href="https://${domain}/show/${addedShow.id}" rel="nofollow noopener noreferrer">${escapeHTML(addedShow.name)}</a>: Watched s${
        updatedEp.season
      }e${updatedEp.number}`,
    };
    const quote = `https://${domain}/show/${addedShow.id}/episode/${updatedEp.id}`;
    broadcastMessage(data, 'update', apDb, account, domain, quote);
  }

  await apDb.setPermissions(id, req.body.allowed || '', req.body.blocked || '');

  if (req.body.returnHash) {
    return res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
  }
  return res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
});

router.post('/:showId/episode/:episodeId/delete', async (req, res) => {
  await tvDb.deleteEpisode(req.params.episodeId);

  const allEpsWithNulls = await tvDb.getEpisodesByShowId(req.params.showId);
  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);
  const aired_episodes_count = allEps.filter((ep) => new Date(ep.airstamp) < new Date())?.length || 0;
  const watched_episodes_count = allEps.filter((ep) => ep.watched_status === 'WATCHED')?.length || 0;

  await tvDb.updateShow(req.params.showId, {
    aired_episodes_count,
    watched_episodes_count,
  });

  return res.redirect(301, `/show/${req.params.showId}`);
});

router.post('/:showId/season/:seasonId/status', async (req, res) => {
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;
  const allSeasonEps = await tvDb.getEpisodesByShowId(req.params.showId);

  const thisSeasonEps =
    req.params.seasonId === 'SPECIAL'
      ? allSeasonEps.filter((val) => val.number === null && (new Date() > new Date(val.airstamp) || status === null))
      : allSeasonEps.filter(
          (val) => val.season === Number(req.params.seasonId) && val.number !== null && (new Date() > new Date(val.airstamp) || status === null),
        );

  await Promise.all(thisSeasonEps.map((val) => tvDb.updateEpisodeWatchStatus(val.id, status)));

  const allEpsWithNulls = await tvDb.getEpisodesByShowId(req.params.showId);
  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);

  await tvDb.updateShow(req.params.showId, getEpisodeStatusUpdatedValues(allEps));

  res.redirect(301, `/show/${req.params.showId}#season${req.params.seasonId}`);
});

router.get('/:showId/episode/:episodeId', async (req, res) => {
  const params: {
    openGraph?: { image: string };
    hideTitle?: boolean;
    episode?: unknown;
    comments?: unknown;
    comment_count?: number;
    allowed?: unknown;
    blocked?: unknown;
    activityUrl?: string;
  } = {};

  const show = await tvDb.getShow(req.params.showId);

  if (!show) {
    return res.redirect(`/`);
  }

  if (show.image) {
    params.openGraph = {
      image: `https://${req.app.get('domain')}/${show.image}`,
    };
  }

  const episode = await tvDb.getEpisode(req.params.episodeId).then((e) => {
    const daysUntill = Math.round((new Date().getTime() - new Date(e.airstamp).getTime()) / (24 * 60 * 60 * 1000));
    return {
      ...e,
      isWatched: e.watched_status === 'WATCHED',
      not_aired: new Date(e.airstamp) > new Date(),
      days_untill: daysUntill < 0 ? Math.abs(daysUntill) : 0,
      show,
    };
  });
  params.hideTitle = true;
  params.episode = episode;

  const comments =
    'loggedIn' in req.session && req.session.loggedIn
      ? await tvDb.getAllComments(`show-${req.params.showId}-episode-${req.params.episodeId}`)
      : await tvDb.getVisibleComments(`show-${req.params.showId}-episode-${req.params.episodeId}`);

  params.comments = comments;
  params.comment_count = comments.length || 0;

  const permissions = await apDb.getPermissions(`show-${req.params.showId}-episode-${req.params.episodeId}`);
  params.allowed = permissions?.allowed;
  params.blocked = permissions?.blocked;

  // Check if requesting ActivityPub format
  if (isActivityPubRequested(req)) {
    const noteObject = createEpisodeNoteObject(episode, show, account, domain);
    res.set('Content-Type', 'application/activity+json');
    return res.json(noteObject);
  }

  // Add ActivityPub discovery link for HTML consumers
  params.activityUrl = `https://${req.app.get('domain')}/show/${req.params.showId}/episode/${req.params.episodeId}?format=json`;

  return res.render('episode', params);
});

router.post('/:showId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId } = req.params;

  await tvDb.deleteHiddenComments(`show-${showId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}`);
});

router.post('/:showId/episode/:episodeId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId, episodeId } = req.params;

  await tvDb.deleteHiddenComments(`show-${showId}-episode-${episodeId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}/episode/${episodeId}`);
});

router.post('/:showId/abandon', isAuthenticated, async (req, res) => {
  const { showId } = req.params;

  const abandoned = req.body.abandon === 'TRUE';
  await tvDb.updateShow(showId, { abandoned });

  res.redirect(301, `/`);
});

router.post('/:showId/update', isAuthenticated, async (req, res) => {
  const { showId } = req.params;

  await tvDb.updateShowNote(showId, { note: req.body.note });

  // TODO - update fediverse post

  res.redirect(301, `/show/${showId}`);
});

router.post('/:showId/refresh', isAuthenticated, async (req, res) => {
  const { showId } = req.params;

  await refreshShowEpisodesData(req, showId);

  res.redirect(301, `/show/${showId}`);
});
