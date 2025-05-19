import express from 'express';
import escapeHTML from 'escape-html';
import { account, domain } from '../util.js';
import { isAuthenticated } from '../session-auth.js';
import { broadcastMessage } from '../activitypub.js';
import { refreshShowEpisodesData } from './admin.js';

const router = express.Router();
export default router;

router.get('/:showId', async (req, res) => {
  const params = {};
  const now = new Date();

  const tvshowDb = req.app.get('tvshowDb');
  const apDb = req.app.get('apDb');

  const show = await tvshowDb.getShow(req.params.showId);

  if (!show) {
    return res.redirect(301, `/`);
  }

  params.show = show;
  const comments = req.session.loggedIn
    ? await tvshowDb.getAllComments(`show-${req.params.showId}`)
    : await tvshowDb.getVisibleComments(`show-${req.params.showId}`);

  params.comments = comments;
  params.comment_count = comments.length || 0;

  const episodes = (await tvshowDb.getEpisodesByShowId(req.params.showId)).map((e) => {
    const daysUntill = e.airstamp ? Math.round((now - new Date(e.airstamp)) / (24 * 60 * 60 * 1000)) : undefined;

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
      isWatched: eps.every((val) => val.isWatched),
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
        console.log('test', params.show.watchNextEpisode, e.airstamp,new Date(e.airstamp), now)
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
  const apDb = req.app.get('apDb');
  const tvshowDb = req.app.get('tvshowDb');
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;

  const updatedEp = await tvshowDb.updateEpisodeWatchStatus(req.params.episodeId, status);
  const allEpsWithNulls = await tvshowDb.getEpisodesByShowId(req.params.showId);

  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);

  const updatedShow = await tvshowDb.updateShow(req.params.showId, getEpisodeStatusUpdatedValues(allEps));

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
    broadcastMessage(data, 'create', apDb, account, domain);
  } else {
    // unwatched episode
    const data = {
      id: `show-${updatedShow.id}-episode-${updatedEp.id}`,
      path: `show/${updatedShow.id}`,
      url: updatedShow.url,
    };
    broadcastMessage(data, 'delete', apDb, account, domain);
  }

  if (req.body.returnHash) {
    res.redirect(301, `/show/${req.params.showId}#${req.body.returnHash}`);
  } else {
    res.redirect(301, `/show/${req.params.showId}#season${updatedEp.season}`);
  }
});

router.post('/:showId/episode/:episodeId/update', async (req, res) => {
  const apDb = req.app.get('apDb');
  const tvshowDb = req.app.get('tvshowDb');
  const { note } = req.body;
  const updatedEp = await tvshowDb.updateEpisodeNote(req.params.episodeId, note);

  const addedShow = await tvshowDb.getShow(req.params.showId);
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
    broadcastMessage(data, 'update', apDb, account, domain);
  }

  await apDb.setPermissions(id, req.body.allowed || '', req.body.blocked || '');

  if (req.body.returnHash) {
    return res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
  }
  return res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
});

router.post('/:showId/episode/:episodeId/delete', async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');

  await tvshowDb.deleteEpisode(req.params.episodeId);

  const allEpsWithNulls = await tvshowDb.getEpisodesByShowId(req.params.showId);
  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);
  const aired_episodes_count = allEps.filter((ep) => new Date(ep.airstamp) < new Date())?.length || 0;
  const watched_episodes_count = allEps.filter((ep) => ep.watched_status === 'WATCHED')?.length || 0;

  await tvshowDb.updateShow(req.params.showId, {
    aired_episodes_count,
    watched_episodes_count,
  });

  return res.redirect(301, `/show/${req.params.showId}`);
});

router.post('/:showId/season/:seasonId/status', async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;
  const allSeasonEps = await tvshowDb.getEpisodesByShowId(req.params.showId);

  const thisSeasonEps =
    req.params.seasonId === 'SPECIAL'
      ? allSeasonEps.filter((val) => val.number === null && (new Date() > new Date(val.airstamp) || status === null))
      : allSeasonEps.filter(
          (val) => val.season === Number(req.params.seasonId) && val.number !== null && (new Date() > new Date(val.airstamp) || status === null),
        );

  await Promise.all(thisSeasonEps.map((val) => tvshowDb.updateEpisodeWatchStatus(val.id, status)));

  const allEpsWithNulls = await tvshowDb.getEpisodesByShowId(req.params.showId);
  const allEps = allEpsWithNulls.filter((ep) => ep.number !== null);

  await tvshowDb.updateShow(req.params.showId, getEpisodeStatusUpdatedValues(allEps));

  res.redirect(301, `/show/${req.params.showId}#season${req.params.seasonId}`);
});

router.get('/:showId/episode/:episodeId', async (req, res) => {
  const params = {};

  const tvshowDb = req.app.get('tvshowDb');
  const apDb = req.app.get('apDb');

  const show = await tvshowDb.getShow(req.params.showId);

  if (!show) {
    return res.redirect(`/`);
  }

  const episode = await tvshowDb.getEpisode(req.params.episodeId).then((e) => {
    const daysUntill = Math.round((new Date() - new Date(e.airstamp)) / (24 * 60 * 60 * 1000));
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

  const comments = req.session.loggedIn
    ? await tvshowDb.getAllComments(`show-${req.params.showId}-episode-${req.params.episodeId}`)
    : await tvshowDb.getVisibleComments(`show-${req.params.showId}-episode-${req.params.episodeId}`);

  params.comments = comments;
  params.comment_count = comments.length || 0;

  const permissions = await apDb.getPermissions(`show-${req.params.showId}-episode-${req.params.episodeId}`);
  params.allowed = permissions?.allowed;
  params.blocked = permissions?.blocked;

  return res.render('episode', params);
});

router.post('/:showId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId } = req.params;
  const tvshowDb = req.app.get('tvshowDb');

  await tvshowDb.deleteHiddenComments(`show-${showId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}`);
});

router.post('/:showId/episode/:episodeId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId, episodeId } = req.params;
  const tvshowDb = req.app.get('tvshowDb');

  await tvshowDb.deleteHiddenComments(`show-${showId}-episode-${episodeId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}/episode/${episodeId}`);
});

router.post('/:showId/abandon', isAuthenticated, async (req, res) => {
  const { showId } = req.params;
  const tvshowDb = req.app.get('tvshowDb');

  const abandoned = req.body.abandon === 'TRUE';
  await tvshowDb.updateShow(showId, { abandoned });

  res.redirect(301, `/`);
});

router.post('/:showId/update', isAuthenticated, async (req, res) => {
  const { showId } = req.params;
  const tvshowDb = req.app.get('tvshowDb');

  await tvshowDb.updateShowNote(showId, { note: req.body.note });

  // TODO - update fediverse post

  res.redirect(301, `/show/${showId}`);
});

router.post('/:showId/refresh', isAuthenticated, async (req, res) => {
  const { showId } = req.params;

  await refreshShowEpisodesData(req, showId);

  res.redirect(301, `/show/${showId}`);
});
