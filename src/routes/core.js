import express from 'express';
import * as linkify from 'linkifyjs';
import { data, actorInfo } from '../util.js';
import { isAuthenticated } from '../session-auth.js';
import { refreshShowData } from './admin.js';

const router = express.Router();
export default router;

router.get('/', async (req, res) => {
  let params = {};

  if (req.session.loggedIn) {
    params.showDataRefreshed = await refreshShowData(req, res);
  }

  const tvshowDb = req.app.get('tvshowDb');

  const limit = Math.max(req.query?.limit || 1, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;
  // const shows = await tvshowDb.getShows(limit, offset);

  const [showsNotStarted, showsCompleted, showsUpToDate, showsToWatch, showsAbandoned] = await Promise.all([
    tvshowDb.getShowsNotStarted(),
    tvshowDb.getShowsCompleted(),
    tvshowDb.getShowsUpToDate(),
    tvshowDb.getShowsToWatch(),
    tvshowDb.getShowsAbandoned(),
  ]);

  const foundShows = showsNotStarted || showsCompleted || showsUpToDate || showsAbandoned || showsToWatch;

  params = {
    ...params,
    limit,
    foundShows,
    showsNotStarted,
    seeAllShowsNotStarted: showsNotStarted.length > limit,
    showsCompleted,
    seeAllShowsCompleted: showsCompleted.length > limit,
    showsUpToDate,
    seeAllShowsUpToDate: showsUpToDate.length > limit,
    showsAbandoned,
    seeAllShowsAbandoned: showsAbandoned.length > limit,
    showsToWatch,
    seeAllShowsToWatch: showsToWatch.length > limit,
    hideTitle: true
  };

  if (!foundShows) params.error = data.errorMessage;

  // params.title = title;
  params.pageInfo = {
    currentPage,
    offset,
    limit,
    hasPreviousPage: currentPage > 1,
    previousOffset: Math.max(offset - limit, 0),
  };

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('index', params);
});

router.get('/shows/:type', async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');
  const { type } = req.params;

  const limit = Math.max(req.query?.limit || 25, 1);
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

  let params = {
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
  // const bookmarksDb = req.app.get('bookmarksDb');

  const posts = await tvshowDb.getNetworkPosts();

  return res.render('network', { title: 'Your network', posts });
});

router.get('/index.xml', async (req, res) => {
  const params = {};
  const tvshowDb = req.app.get('tvshowDb');

  const shows = await tvshowDb.getShows(20, 0);
  if (!shows) params.error = data.errorMessage;

  if (shows && shows.length < 1) {
    params.setup = data.setupMessage;
  } else {
    params.shows = shows.map((show) => {
      const createdAt = new Date(`${show.created_at}Z`);
      return {
        ...show,
        created_at: createdAt.toISOString(),
      };
    });
    const lastUpdated = new Date(shows[0].created_at);
    params.last_updated = lastUpdated.toISOString();
  }

  params.feedTitle = req.app.get('site_name');
  params.layout = false;

  res.type('application/atom+xml');
  return res.render('shows-xml', params);
});
