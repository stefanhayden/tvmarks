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
    refreshShowData(req, res)
  }

  const tvshowDb = req.app.get('tvshowDb');

  const limit = Math.max(req.query?.limit || 100, 1);
  const offset = Math.max(req.query?.offset || 0, 0);
  const currentPage = (limit + offset) / limit;
  const shows = await tvshowDb.getShows(limit, offset);
  const showsNotStarted = await tvshowDb.getShowsNotStarted();
  const showsCompleted = await tvshowDb.getShowsCompleted();
  const showsUpToDate = await tvshowDb.getShowsUpToDate();
  const showsAbandoned = await tvshowDb.getShowsAbandoned();
  const showsToWatch = await tvshowDb.getShowsToWatch()

  params = {
    ...params,
    showsNotStarted,
    showsCompleted,
    showsUpToDate,
    showsAbandoned,
    showsToWatch,
  };

  if (!shows) params.error = data.errorMessage;

  // Check in case the data is empty or not setup yet
  if (shows && shows.length < 1) {
    params.setup = data.setupMessage;
  }

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

router.get('/about', async (req, res) => {
  res.render('about', {
    title: 'About',
    actorInfo,
    domain: req.app.get('domain'),
  });
});

router.get('/network', isAuthenticated, async (req, res) => {
  const bookmarksDb = req.app.get('bookmarksDb');

  const posts = await bookmarksDb.getNetworkPosts();

  // TODO: make quickadd able to select from list of links in post
  const linksInPosts = posts.map((post) => ({
    ...post,
    href: linkify.find(post.content)?.[0]?.href,
  }));

  return res.render('network', { title: 'Your network', posts: linksInPosts });
});

router.get('/index.xml', async (req, res) => {
  const params = {};
  const bookmarksDb = req.app.get('bookmarksDb');

  const bookmarks = await bookmarksDb.getBookmarks(20, 0);
  if (!bookmarks) params.error = data.errorMessage;

  if (bookmarks && bookmarks.length < 1) {
    params.setup = data.setupMessage;
  } else {
    params.bookmarks = bookmarks.map((bookmark) => {
      const tagArray = bookmark.tags?.split(' ').map((b) => b.slice(1)) ?? [];
      const createdAt = new Date(`${bookmark.created_at}Z`);
      return {
        tag_array: tagArray,
        ...bookmark,
        created_at: createdAt.toISOString(),
      };
    });
    const lastUpdated = new Date(bookmarks[0].created_at);
    params.last_updated = lastUpdated.toISOString();
  }

  params.feedTitle = req.app.get('site_name');
  params.layout = false;

  res.type('application/atom+xml');
  return res.render('bookmarks-xml', params);
});

router.get('/tagged/*.xml', async (req, res) => {
  const tags = req.params[0].split('/');

  const params = {};
  const bookmarksDb = req.app.get('bookmarksDb');

  const bookmarks = await bookmarksDb.getBookmarksForTags(tags, 20, 0);

  if (!bookmarks) params.error = data.errorMessage;

  if (bookmarks && bookmarks.length < 1) {
    params.setup = data.setupMessage;
  } else {
    params.bookmarks = bookmarks.map((bookmark) => {
      const tagArray = bookmark.tags.split(' ').map((b) => b.slice(1));
      return { tag_array: tagArray, ...bookmark };
    });
    params.last_updated = bookmarks[0].created_at;
  }

  params.feedTitle = `${req.app.get('site_name')}: Bookmarks tagged '${tags.join(' and ')}'`;
  params.layout = false;

  res.type('application/atom+xml');
  return res.render('bookmarks-xml', params);
});
