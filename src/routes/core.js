import express from 'express';
import { data, actorInfo } from '../util.js';
import { isAuthenticated } from '../session-auth.js';
import { refreshShowData, refreshWatchNext } from './admin.js';

const router = express.Router();
export default router;

router.get('/', async (req, res) => {
  let params = {};

  if (req.session.loggedIn) {
    params.showDataRefreshed = await refreshShowData(req, res);
    await refreshWatchNext(req);
  }

  const tvshowDb = req.app.get('tvshowDb');

  const limit = 8;
  const limitShowsToWatch = 24;

  const [showsToWatch, showsAbandoned, showsUpToDate, showsCompleted, showsNotStarted] = await Promise.all([
    tvshowDb.getShowsToWatch(limitShowsToWatch),
    tvshowDb.getShowsAbandoned(limit),
    tvshowDb.getShowsUpToDate(limit),
    tvshowDb.getShowsCompleted(limit),
    tvshowDb.getShowsNotStarted(limit),
  ]);

  const foundShows =
    (showsToWatch?.length || showsNotStarted?.length || showsCompleted?.length || showsUpToDate?.length || showsAbandoned?.length || 0) > 0;

  params = {
    ...params,
    limit,
    foundShows,
    showsNotStarted,
    seeAllShowsNotStarted: showsNotStarted ? showsNotStarted.length === limit : false,
    showsCompleted,
    seeAllShowsCompleted: showsCompleted ? showsCompleted.length === limit : false,
    showsUpToDate,
    seeAllShowsUpToDate: showsUpToDate ? showsUpToDate.length === limit : false,
    showsAbandoned,
    seeAllShowsAbandoned: showsAbandoned ? showsAbandoned.length === limit : false,
    showsToWatch,
    seeAllShowsToWatch: showsToWatch ? showsToWatch.length === limitShowsToWatch : false,
    hideTitle: true,
    noSecret: !process.env.SESSION_SECRET,
    noAdminKey: !process.env.ADMIN_KEY,
    isReadyToLogin: !!process.env.SESSION_SECRET && !!process.env.ADMIN_KEY
  };

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('index', params);
});

router.get('/shows/:type', async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');
  const { type } = req.params;

  const limit = Math.max(req.query?.limit || 24, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;
  const shows =
    type === 'watch-next'
      ? await tvshowDb.getShowsToWatch(limit, offset)
      : type === 'up-to-date'
      ? await tvshowDb.getShowsUpToDate(limit, offset)
      : type === 'not-started'
      ? await tvshowDb.getShowsNotStarted(limit, offset)
      : type === 'completed'
      ? await tvshowDb.getShowsCompleted(limit, offset)
      : type === 'abandoned'
      ? await tvshowDb.getShowsAbandoned(limit, offset)
      : [];

  const params = {
    shows,
    offset,
    limit,
  };

  if (!shows) params.error = data.errorMessage;

  params.title = type.split('-').join(' ');
  params.pagination = {
    url: `/shows/${type}`,
    currentPage,
    offset,
    limit,
    hasPreviousPage: currentPage > 1,
    hasNextPage: shows.length === limit,
    nextOffset: Math.min(offset + limit),
    previousOffset: Math.max(offset - limit, 0),
  };

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('shows-by-type', params);
});

router.get('/about', async (req, res) => {
  res.render('about', {
    title: 'About',
    actorInfo,
    domain: req.app.get('domain'),
  });
});

router.get('/network', isAuthenticated, async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');
  const posts = await tvshowDb.getNetworkPosts();

  return res.render('network', { title: 'Your network', posts });
});
