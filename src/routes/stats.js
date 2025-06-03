import express from 'express';

const router = express.Router();
export default router;

router.get('/', async (req, res) => {
  const params = {};
  params.title = 'Stats';

  const tvshowDb = req.app.get('tvshowDb');

  const showCount = await tvshowDb.getShowCount();
  params.showCount = showCount;

  const episodeCount = await tvshowDb.getEpisodeCount();
  params.totalEpisodes = episodeCount.totalEpisodes;
  params.totalMinutes = episodeCount.totalMinutes;

  const watchedStats = await tvshowDb.getWatchStats();
  console.log('watchedStats', watchedStats);

  params.watchedEpisodes = watchedStats.watched_episodes;
  params.watchedMinutes = watchedStats.watched_minutes;
  params.notWatchedEpisodes = watchedStats.not_watched_episodes;
  params.minutesToWatch = watchedStats.minutes_to_watch;

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('stats', params);
});
