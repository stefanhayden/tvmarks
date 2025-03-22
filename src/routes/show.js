import express from 'express';
import { data, account, domain, removeEmpty } from '../util.js';
import { broadcastMessage } from '../activitypub.js';

const router = express.Router();
export default router;

router.get('/:showId', async (req, res) => {
  const params = {};
  const now = new Date((new Date()).toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const tvshowDb = req.app.get('tvshowDb');

  const show = await tvshowDb.getShow(req.params.showId);
  params.show = show;

  const episodes = (await tvshowDb.getEpisodesByShowId(req.params.showId)).map((e) => {
    const days_untill = Math.round((now - new Date(e.airdate)) / (24 * 60 * 60 * 1000));
    return {
      ...e,
      isWatched: e.watched_status === 'WATCHED',
      not_aired: new Date(e.airdate) > now,
      days_untill: days_untill < 0 ? Math.abs(days_untill) : 0,
    };
  });

  // GROUP BY SEASON
  params.seasons = [];
  const seasons = episodes.reduce((acc, val) => (val.season > acc ? val.season : acc), 1);
  for (var seasonId = 1; seasonId <= seasons; seasonId++) {
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
    params.seasons.forEach((s) =>
      s.episodes.forEach((e) => {
        if (show.last_watched_episode_id === e.id && new Date(e.airdate) < now) {
          params.show.watchNextEpisode = e;
        }
      }),
    );
  }

  params.title = show.name;

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('show', params);
});


router.post('/:showId/episode/:episodeId/status', async (req, res) => {
  const apDb = req.app.get('apDb');
  const tvshowDb = req.app.get('tvshowDb');
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;
  const updatedEp = await tvshowDb.updateEpisodeWatchStatus(req.params.episodeId, status);

  const addedShow = await tvshowDb.getShow(req.params.showId);
  if (status) {
    if (addedShow.aired_episodes_count === addedShow.watched_episodes_count && addedShow.status === 'Ended') {
      addedShow.actionType = 'finishedShow';
      addedShow.actionValue = updatedEp;
      addedShow.description = req.body.description;
      broadcastMessage(addedShow, 'create', apDb, account, domain);
    } else {
      addedShow.actionType = 'addedEpisode';
      addedShow.actionValue = updatedEp;
      addedShow.description = req.body.description;
      broadcastMessage(addedShow, 'create', apDb, account, domain);
    }
  }

  if (req.body.returnHash) {
    res.redirect(301, `/show/${req.params.showId}#${req.body.returnHash}`);
  } else {
    res.redirect(301, `/show/${req.params.showId}#season${updatedEp.season}`);
  }
});

router.post('/:showId/season/:seasonId/status', async (req, res) => {
  const apDb = req.app.get('apDb');
  const tvshowDb = req.app.get('tvshowDb');
  const status = req.body.status === 'WATCHED' ? 'WATCHED' : null;
  const allSeasonEps = await tvshowDb.getEpisodesByShowId(req.params.showId);

  const thisSeasonEps =
    req.params.seasonId === 'SPECIAL'
      ? allSeasonEps.filter((val) => val.number === null && (new Date() > new Date(val.airdate) || status === null))
      : allSeasonEps.filter(
          (val) => val.season === Number(req.params.seasonId) && val.number !== null && (new Date() > new Date(val.airdate) || status === null),
        );

  await Promise.all(thisSeasonEps.map((val) => tvshowDb.updateEpisodeWatchStatus(val.id, status)));

  const addedShow = await tvshowDb.getShow(req.params.showId);
  const finishedShow = { ...addedShow };
  if (status && req.params.seasonId !== 'SPECIAL') {
    addedShow.actionType = 'addedSeason';
    addedShow.actionValue = req.params.seasonId;
    addedShow.description = req.body.description;
    broadcastMessage(addedShow, 'create', apDb, account, domain);

    if (addedShow.aired_episodes_count === addedShow.watched_episodes_count && addedShow.status === 'Ended') {
      finishedShow.actionType = 'finishedShow';
      finishedShow.description = req.body.description;
      broadcastMessage(finishedShow, 'create', apDb, account, domain);
    }
  }

  res.redirect(301, `/show/${req.params.showId}#season${req.params.seasonId}`);
});


router.get('/:showId/episode/:episodeId', async (req, res) => {
  const params = {};

  const tvshowDb = req.app.get('tvshowDb');

  const show = await tvshowDb.getShow(req.params.showId);
  const episode = await tvshowDb.getEpisode(req.params.episodeId).then((e) => {
    const days_untill = Math.round((new Date() - new Date(e.airdate)) / (24 * 60 * 60 * 1000));
    return {
      ...e,
      isWatched: e.watched_status === 'WATCHED',
      not_aired: new Date(e.airdate) > new Date(),
      days_untill: days_untill < 0 ? Math.abs(days_untill) : 0,
      show,
    };
  
  })
  params.hideTitle = true;
  params.episode = episode;
  
  res.render('episode', params);
})
