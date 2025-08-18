import express from 'express';
import { data, actorInfo } from '../util.js';
import { isAuthenticated } from '../session-auth.js';
import { refreshShowData, refreshWatchNext } from './admin.js';
import * as tvDb from '../tvshow-db.js';

const router = express.Router();
export default router;

router.get<{}, {}, {}, { raw?: boolean }, {}>('/', async (req, res) => {
  let params = {};

  if ('loggedIn' in req.session && req.session.loggedIn) {
    // params.showDataRefreshed = await refreshShowData(req, res);
    await refreshShowData(req);
    await refreshWatchNext(req);
  }

  const limit = 8;
  const limitShowsToWatch = 24;

  const [showsToWatch, showsAbandoned, showsUpToDate, showsCompleted, showsNotStarted] = await Promise.all([
    tvDb.getShowsToWatch(limitShowsToWatch),
    tvDb.getShowsAbandoned(limit),
    tvDb.getShowsUpToDate(limit),
    tvDb.getShowsCompleted(limit),
    tvDb.getShowsNotStarted(limit),
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
    isReadyToLogin: !!process.env.SESSION_SECRET && !!process.env.ADMIN_KEY,
  };

  // Send the page options or raw JSON data if the client requested it
  return req.query.raw ? res.send(params) : res.render('index', params);
});

type Pagination = {
  url: string;
  currentPage: number;
  offset: number;
  limit: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  nextOffset: number;
  previousOffset: number;
};

router.get<{ type: string }, {}, {}, { raw?: boolean; limit?: number; offset?: number }>('/shows/:type', async (req, res) => {
  const { type } = req.params;

  const limit = Math.max(req.query?.limit || 24, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;
  const shows =
    type === 'watch-next'
      ? await tvDb.getShowsToWatch(limit, offset)
      : type === 'up-to-date'
        ? await tvDb.getShowsUpToDate(limit, offset)
        : type === 'not-started'
          ? await tvDb.getShowsNotStarted(limit, offset)
          : type === 'completed'
            ? await tvDb.getShowsCompleted(limit, offset)
            : type === 'abandoned'
              ? await tvDb.getShowsAbandoned(limit, offset)
              : [];

  const params: { shows: any; offset: number; limit: number; error?: string; title?: string; pagination?: Pagination } = {
    shows,
    offset,
    limit,
  };

  if (!shows) params.error = data.errorMessage;

  params.title = type.split('-').join(' ');
  const pagination: Pagination = {
    url: `/shows/${type}`,
    currentPage,
    offset,
    limit,
    hasPreviousPage: currentPage > 1,
    hasNextPage: shows.length === limit,
    nextOffset: Math.min(offset + limit),
    previousOffset: Math.max(offset - limit, 0),
  };
  params.pagination = pagination;

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
  const posts = await tvDb.getNetworkPosts();

  return res.render('network', { title: 'Your network', posts });
});

router.get('/manifest', async (req, res) => {
  const siteName = req.app.get('site_name');
  const domain = req.app.get('domain');

  return res.json({
    id: '/home',
    name: siteName,
    short_name: siteName,
    icons: [
      {
        src: `https://${domain}/tvmarksLogo.png?v=1742129685337`,
        sizes: '204x166',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: `https://${domain}/tvmarksAppLogo128.png?v=1742129685337`,
        sizes: '128x128',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    theme_color: '#fff1fc',
    background_color: '#fff1fc',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    shortcuts: [
      {
        name: 'Add new show',
        url: '/admin',
      },
      {
        name: 'My Network',
        url: '/network',
      },
    ],
  });
});
