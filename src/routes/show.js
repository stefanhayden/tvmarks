import express from "express";
import { data, account, domain, removeEmpty } from "../util.js";
import { isAuthenticated } from '../session-auth.js';
import { broadcastMessage } from "../activitypub.js";
import escapeHTML from "escape-html";

const router = express.Router();
export default router;

router.get("/:showId", async (req, res) => {
  const params = {};
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  const tvshowDb = req.app.get("tvshowDb");
  const apDb = req.app.get("apDb");

  const show = await tvshowDb.getShow(req.params.showId);
  params.show = show;
  
  const comments = isAuthenticated ? 
        await tvshowDb.getAllComments(`show-${req.params.showId}`)
        : await tvshowDb.getVisibleComments(`show-${req.params.showId}`);
  console.log('---comments', comments)
  params.comments = comments;

  const episodes = (await tvshowDb.getEpisodesByShowId(req.params.showId)).map(
    (e) => {
      const days_untill = Math.round(
        (now - new Date(e.airdate)) / (24 * 60 * 60 * 1000)
      );
      return {
        ...e,
        isWatched: e.watched_status === "WATCHED",
        not_aired: new Date(e.airdate) > now,
        days_untill: days_untill < 0 ? Math.abs(days_untill) : 0,
      };
    }
  );

  // GROUP BY SEASON
  params.seasons = [];
  const seasons = episodes.reduce(
    (acc, val) => (val.season > acc ? val.season : acc),
    1
  );
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
      title: "Specials",
      showId: show.id,
      seasonId: "SPECIAL",
      isWatched: specials.every((val) => val.isWatched),
      episodes: specials,
    });
  }

  if (show.last_watched_episode_id) {
    params.seasons.forEach((s) =>
      s.episodes.forEach((e) => {
        if (
          show.last_watched_episode_id === e.id &&
          new Date(e.airdate) < now
        ) {
          params.show.watchNextEpisode = e;
        }
      })
    );
  }
  
  
  const permissions = await apDb.getPermissions(`show-${show.id}`);
  params.allowed = permissions?.allowed;
  params.blocked = permissions?.blocked;

  params.title = show.name;

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render("show", params);
});

router.post("/:showId/episode/:episodeId/status", async (req, res) => {
  const apDb = req.app.get("apDb");
  const tvshowDb = req.app.get("tvshowDb");
  const status = req.body.status === "WATCHED" ? "WATCHED" : null;
  const updatedEp = await tvshowDb.updateEpisodeWatchStatus(
    req.params.episodeId,
    status
  );

  const addedShow = await tvshowDb.getShow(req.params.showId);
  if (status) {
    // watched ep
    const data = {
      id: `show-${addedShow.id}-episode-${updatedEp.id}`,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
      description: updatedEp.note || "",
      title: `<a href="https://${domain}/show/${
        addedShow.id
      }" rel="nofollow noopener noreferrer">${escapeHTML(
        addedShow.name
      )}</a>: Watched s${updatedEp.season}e${updatedEp.number}`,
    };
    broadcastMessage(data, "create", apDb, account, domain);
  } else {
    // unwatched episode
    const data = {
      id: `show-${addedShow.id}-episode-${updatedEp.id}`,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
    };
    broadcastMessage(data, "delete", apDb, account, domain);
  }

  if (req.body.returnHash) {
    res.redirect(301, `/show/${req.params.showId}#${req.body.returnHash}`);
  } else {
    res.redirect(301, `/show/${req.params.showId}#season${updatedEp.season}`);
  }
});


router.post("/:showId/episode/:episodeId/update", async (req, res) => {
  const apDb = req.app.get("apDb");
  const tvshowDb = req.app.get("tvshowDb");
  const note = req.body.note;
  const updatedEp = await tvshowDb.updateEpisodeNote(
    req.params.episodeId,
    note
  );

  const addedShow = await tvshowDb.getShow(req.params.showId);
  const id = `show-${addedShow.id}-episode-${updatedEp.id}`;
  if (updatedEp.watched_status === 'WATCHED') {
    const data = {
      id,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
      description: req.body.note || "",
      title: `<a href="https://${domain}/show/${
        addedShow.id
      }" rel="nofollow noopener noreferrer">${escapeHTML(
        addedShow.name
      )}</a>: Watched s${updatedEp.season}e${updatedEp.number}`,
    };
    broadcastMessage(data, "update", apDb, account, domain);
  }
  
  await apDb.setPermissions(id, req.body.allowed || '', req.body.blocked || '');

  if (req.body.returnHash) {
    res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
  } else {
    res.redirect(301, `/show/${req.params.showId}/episode/${req.params.episodeId}`);
  }
});

router.post("/:showId/season/:seasonId/status", async (req, res) => {
  const apDb = req.app.get("apDb");
  const tvshowDb = req.app.get("tvshowDb");
  const status = req.body.status === "WATCHED" ? "WATCHED" : null;
  const comment = req.body.comment;
  const allSeasonEps = await tvshowDb.getEpisodesByShowId(req.params.showId);

  const thisSeasonEps =
    req.params.seasonId === "SPECIAL"
      ? allSeasonEps.filter(
          (val) =>
            val.number === null &&
            (new Date() > new Date(val.airdate) || status === null)
        )
      : allSeasonEps.filter(
          (val) =>
            val.season === Number(req.params.seasonId) &&
            val.number !== null &&
            (new Date() > new Date(val.airdate) || status === null)
        );

  await Promise.all(
    thisSeasonEps.map((val) =>
      tvshowDb.updateEpisodeWatchStatus(val.id, status)
    )
  );

  res.redirect(301, `/show/${req.params.showId}#season${req.params.seasonId}`);
});

router.get("/:showId/episode/:episodeId", async (req, res) => {
  const params = {};

  const tvshowDb = req.app.get("tvshowDb");
  const apDb = req.app.get('apDb');

  const show = await tvshowDb.getShow(req.params.showId);
  const episode = await tvshowDb.getEpisode(req.params.episodeId).then((e) => {
    const days_untill = Math.round(
      (new Date() - new Date(e.airdate)) / (24 * 60 * 60 * 1000)
    );
    return {
      ...e,
      isWatched: e.watched_status === "WATCHED",
      not_aired: new Date(e.airdate) > new Date(),
      days_untill: days_untill < 0 ? Math.abs(days_untill) : 0,
      show,
    };
  });
  params.hideTitle = true;
  params.episode = episode;
  
  
  const comments = await tvshowDb.getAllComments(`show-${req.params.showId}-episode-${req.params.episodeId}`);
  params.comments = comments;
  
  const permissions = await apDb.getPermissions(`show-${req.params.showId}-episode-${req.params.episodeId}`);
  params.allowed = permissions?.allowed;
  params.blocked = permissions?.blocked;

  res.render("episode", params);
});

router.post('/:showId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId } = req.params;
  const tvshowDb = req.app.get("tvshowDb");

  await tvshowDb.deleteHiddenComments(`show-${showId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}`);
});

router.post('/:showId/episode/:episodeId/delete_hidden_comments', isAuthenticated, async (req, res) => {
  const params = {};
  const { showId, episodeId } = req.params;
  const tvshowDb = req.app.get("tvshowDb");

  await tvshowDb.deleteHiddenComments(`show-${showId}-episode-${episodeId}`);

  return req.query.raw ? res.send(params) : res.redirect(`/show/${showId}/episode/${episodeId}`);
});
