import express from 'express';
import { data, actorInfo, calculateDaysUntilAirDate } from '../util';
import { isAuthenticated } from '../session-auth';
import { refreshShowData, refreshWatchNext } from './admin';
import * as tvDb from '../tvshow-db';

const router = express.Router();
export default router;

router.get<{}, {}, {}, { raw?: boolean }, {}>('/', async (req, res) => {
  let params = {};

  if ('loggedIn' in req.session && req.session.loggedIn) {
    // params.showDataRefreshed = await refreshShowData(req, res);
    await refreshShowData();
    await refreshWatchNext();
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
    isLoggedIn: 'loggedIn' in req.session && req.session.loggedIn,
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

router.get<{}, {}, {}, { raw?: boolean; limit?: number; offset?: number }>('/upcoming', async (req, res) => {
  const limit = Math.max(req.query?.limit || 24, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;

  const episodes = await tvDb.getUpcomingEpisodes(limit, offset);

  // Calculate days until air date for each episode
  const episodesWithDays = episodes?.map((episode) => ({
    ...episode,
    days_until: calculateDaysUntilAirDate(episode.airstamp),
  }));

  const params: {
    episodes: any;
    offset: number;
    limit: number;
    error?: string;
    title?: string;
    pagination?: Pagination;
  } = {
    episodes: episodesWithDays,
    offset,
    limit,
  };

  if (!episodes) params.error = data.errorMessage;

  params.title = 'Upcoming Episodes';
  const pagination: Pagination = {
    url: '/upcoming',
    currentPage,
    offset,
    limit,
    hasPreviousPage: currentPage > 1,
    hasNextPage: episodes.length === limit,
    nextOffset: Math.min(offset + limit),
    previousOffset: Math.max(offset - limit, 0),
  };
  params.pagination = pagination;

  return req.query.raw ? res.send(params) : res.render('upcoming', params);
});

router.get<{}, {}, {}, { raw?: boolean; limit?: number; offset?: number }>('/watched', async (req, res) => {
  const limit = Math.max(req.query?.limit || 24, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;

  const episodes = await tvDb.getRecentlyWatchedEpisodes(limit, offset);

  const params: {
    episodes: any;
    offset: number;
    limit: number;
    error?: string;
    title?: string;
    pagination?: Pagination;
  } = {
    episodes,
    offset,
    limit,
  };

  if (!episodes) params.error = data.errorMessage;

  params.title = 'Watched Episodes';
  const pagination: Pagination = {
    url: '/watched',
    currentPage,
    offset,
    limit,
    hasPreviousPage: currentPage > 1,
    hasNextPage: episodes.length === limit,
    nextOffset: Math.min(offset + limit),
    previousOffset: Math.max(offset - limit, 0),
  };
  params.pagination = pagination;

  return req.query.raw ? res.send(params) : res.render('watched', params);
});

router.get<{}, {}, {}, { year?: string }>('/stats', async (req, res) => {
  const currentYear = new Date().getFullYear();
  const year = req.query.year ? parseInt(req.query.year, 10) : currentYear;
  const [stats, watchedYears] = await Promise.all([tvDb.getStats(year), tvDb.getWatchedYears()]);

  if (!stats) {
    return res.render('stats', { title: '', error: 'Could not load stats.' });
  }

  const { yearSummary, byMonth, topShows, byNetwork, byType } = stats;

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonth = year === currentYear ? new Date().getMonth() + 1 : 12;

  const prevYears = watchedYears.filter((y) => y < year);
  const prevYear = prevYears.length > 0 ? prevYears[prevYears.length - 1] : null;
  const nextYear = watchedYears.find((y) => y > year) ?? null;

  // Build a full 12-month array, filling zeros for months with no data
  const byMonthMap = new Map(byMonth.map((m) => [m.month_num, m]));
  const maxEpisodes = byMonth.length > 0 ? Math.max(...byMonth.map((m) => m.episodes)) : 1;
  const maxMinutes = byMonth.length > 0 ? Math.max(...byMonth.map((m) => m.minutes || 0)) : 1;
  const maxShowEpisodes = topShows.length > 0 ? Math.max(...topShows.map((s) => s.episodes_watched)) : 1;

  const months = MONTH_NAMES.slice(0, currentMonth).map((name, i) => {
    const num = i + 1;
    const data = byMonthMap.get(num);
    const minutes = data?.minutes || 0;
    const episodes = data?.episodes || 0;
    return {
      name,
      num,
      episodes,
      hours: Math.round(minutes / 60),
      episodesPercent: Math.round((episodes / maxEpisodes) * 100),
      hoursPercent: Math.round((minutes / maxMinutes) * 100),
    };
  });

  return res.render('stats', {
    title: `${year} Stats`,
    selectedYear: year,
    prevYear,
    nextYear,
    summary: {
      episodes_watched: yearSummary.episodes_watched || 0,
      hours_watched: Math.round((yearSummary.minutes_watched || 0) / 60),
      shows_watched: yearSummary.shows_watched || 0,
    },
    months,
    topShows: topShows.map((s) => ({
      ...s,
      hours: Math.round((s.minutes_watched || 0) / 60),
      percent: Math.round((s.episodes_watched / maxShowEpisodes) * 100),
    })),
    byNetwork,
    byType,
  });
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
        name: 'Find shows',
        url: '/admin',
      },
      {
        name: 'My Network',
        url: '/network',
      },
    ],
  });
});
