import express from 'express';
import fs from 'fs';
import path from 'path';
import tvMaze from 'node-tvmaze';
import escapeHTML from 'escape-html';
// eslint-disable-next-line import/no-unresolved, node/no-missing-import
import { stringify as csvStringify } from 'csv-stringify/sync'; // https://github.com/adaltas/node-csv/issues/323
import { domain, actorInfo, parseJSON, account } from '../util.js';
import { isAuthenticated } from '../session-auth.js';
import {
  lookupActorInfo,
  createFollowMessage,
  createUnfollowMessage,
  signAndSend,
  getInboxFromActorProfile,
  broadcastMessage,
} from '../activitypub.js';
import { downloadImage } from '../download-image.js';

const DATA_PATH = '/app/.data';

const imageDirectory = 'public/shows';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Add new show' },
  { href: '/admin/followers', label: 'Permissions & followers' },
  { href: '/admin/following', label: 'Federated follows' },
  { href: '/admin/update', label: 'Update Show data' },
  { href: '/admin/data', label: 'Data export' },
];

const router = express.Router();

router.get('/update', isAuthenticated, async (req, res) => {
  const params = req.query.raw ? {} : { title: 'Update Show data' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  const tvshowDb = req.app.get('tvshowDb');

  const updateHistory = await tvshowDb.getUpdateHistory();
  const isRecentlyUpdated = await tvshowDb.isRecentlyUpdated();

  params.updateHistory = updateHistory;
  params.isRecentlyUpdated = isRecentlyUpdated;

  return res.render('admin/update', params);
});

router.get('/followers', isAuthenticated, async (req, res) => {
  const params = req.query.raw ? {} : { title: 'Permissions & followers' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  const apDb = req.app.get('apDb');

  if (actorInfo.disabled) {
    return res.render('nonfederated', params);
  }

  const permissions = await apDb.getGlobalPermissions();

  try {
    const followers = await apDb.getFollowers();
    params.followers = JSON.parse(followers || '[]');
  } catch (e) {
    console.log('Error fetching followers for admin page');
  }

  try {
    const blocks = await apDb.getBlocks();
    params.blocks = JSON.parse(blocks || '[]');
  } catch (e) {
    console.log('Error fetching blocks for admin page');
  }

  params.allowed = permissions?.allowed || '';
  params.blocked = permissions?.blocked || '';

  return res.render('admin/followers', params);
});

router.get('/following', isAuthenticated, async (req, res) => {
  const params = req.query.raw ? {} : { title: 'Federated follows' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  const apDb = req.app.get('apDb');

  if (actorInfo.disabled) {
    return res.render('nonfederated', params);
  }

  try {
    const following = await apDb.getFollowing();
    params.following = JSON.parse(following || '[]');
  } catch (e) {
    console.log('Error fetching followers for admin page');
  }

  return res.render('admin/following', params);
});

router.get('/data', isAuthenticated, async (req, res) => {
  const params = req.query.raw ? {} : { title: 'Data export' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  return res.render('admin/data', params);
});

router.get('/tvshows.db', isAuthenticated, async (req, res) => {
  const filePath = `${DATA_PATH}/tvshows.db`;

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename="tvshows.db"');

  res.download(filePath);
});

router.get('/tvshows.csv', isAuthenticated, async (req, res) => {
  const tvshowDb = req.app.get('tvshowDb');
  const tvshows = await tvshowDb.getTvshowsForCSVExport();
  const result = csvStringify(tvshows, { quoted: true });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tvshows.csv"');

  res.send(result);
});

router.get('/activitypub.db', isAuthenticated, async (req, res) => {
  const filePath = `${DATA_PATH}/activitypub.db`;

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename="activitypub.db"');

  res.download(filePath);
});

router.post('/followers/block', isAuthenticated, async (req, res) => {
  const db = req.app.get('apDb');

  const oldFollowersText = (await db.getFollowers()) || '[]';

  // update followers
  const followers = parseJSON(oldFollowersText);
  if (followers) {
    followers.forEach((follower, idx) => {
      if (follower === req.body.actor) {
        followers.splice(idx, 1);
      }
    });
  }

  const newFollowersText = JSON.stringify(followers);

  try {
    await db.setFollowers(newFollowersText);
  } catch (e) {
    console.log('error storing followers after unfollow', e);
  }

  const oldBlocksText = (await db.getBlocks()) || '[]';

  let blocks = parseJSON(oldBlocksText);

  if (blocks) {
    blocks.push(req.body.actor);
    // unique items
    blocks = [...new Set(blocks)];
  } else {
    blocks = [req.body.actor];
  }
  const newBlocksText = JSON.stringify(blocks);

  try {
    // update into DB

    await db.setBlocks(newBlocksText);

    console.log('updated blocks!');
  } catch (e) {
    console.log('error storing blocks after block action', e);
  }

  res.redirect('/admin/followers');
});

router.post('/followers/unblock', isAuthenticated, async (req, res) => {
  const db = req.app.get('apDb');

  const oldBlocksText = (await db.getBlocks()) || '[]';

  const blocks = parseJSON(oldBlocksText);
  if (blocks) {
    blocks.forEach((block, idx) => {
      if (block === req.body.actor) {
        blocks.splice(idx, 1);
      }
    });
  }

  const newBlocksText = JSON.stringify(blocks);

  try {
    await db.setBlocks(newBlocksText);
  } catch (e) {
    console.log('error storing blocks after unblock action', e);
  }

  res.redirect('/admin/followers');
});

router.post('/following/follow', isAuthenticated, async (req, res) => {
  const db = req.app.get('apDb');
  const accountObj = req.app.get('account');

  const canonicalUrl = await lookupActorInfo(req.body.actor);

  try {
    const inbox = await getInboxFromActorProfile(canonicalUrl);

    if (inbox) {
      const followMessage = await createFollowMessage(accountObj, domain, canonicalUrl, db);
      signAndSend(followMessage, accountObj, domain, db, req.body.actor.split('@').slice(-1), inbox);
    }

    return res.redirect('/admin/following');
  } catch (e) {
    console.log(e.message);
    return res.status(500).send("Couldn't process follow request");
  }
});

router.post('/following/unfollow', isAuthenticated, async (req, res) => {
  const db = req.app.get('apDb');
  const accountObj = req.app.get('account');

  const oldFollowsText = (await db.getFollowing()) || '[]';

  const follows = parseJSON(oldFollowsText);
  if (follows) {
    follows.forEach((follow, idx) => {
      if (follow === req.body.actor) {
        follows.splice(idx, 1);
      }
    });

    const inbox = await getInboxFromActorProfile(req.body.actor);

    const unfollowMessage = createUnfollowMessage(accountObj, domain, req.body.actor, db);

    signAndSend(unfollowMessage, accountObj, domain, db, new URL(req.body.actor).hostname, inbox);

    const newFollowsText = JSON.stringify(follows);

    try {
      await db.setFollowing(newFollowsText);
    } catch (e) {
      console.log('error storing follows after unfollow action', e);
    }
    return res.redirect('/admin/following');
  }
  return res.status(500).send('Encountered an error processing existing following list');
});

router.post('/permissions', isAuthenticated, async (req, res) => {
  const apDb = req.app.get('apDb');

  await apDb.setGlobalPermissions(req.body.allowed, req.body.blocked);

  res.redirect('/admin');
});

router.post('/reset', isAuthenticated, async (req, res) => {
  const db = req.app.get('tvshowDb');

  await db.deleteAllShows();
  await db.deleteAllEpisodes();

  // delete all images
  fs.readdir(imageDirectory, (err, files) => {
    if (err) throw err;

    files.forEach((file) => {
      fs.unlink(path.join(imageDirectory, file), (err2) => {
        if (err2) throw err2;
      });
    });
  });

  res.redirect('/admin');
});

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const params = { title: 'Add new show' };
    if (req.query.query) {
      params.searchTv = await tvMaze.search(req.query.query);
      if (params.searchTv.length === 0) {
        params.error = 'No matches...';
      }
    }
    params.adminLinks = ADMIN_LINKS;
    params.currentPath = req.originalUrl;
    params.query = req.query.query;
    return res.render('admin/search_tv', params);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
});

export async function fetchMissingImage(req, showId) {
  const db = req.app.get('tvshowDb');
  const show = await db.getShow(showId);

  const updatedShow = await tvMaze.show(show.id);

  const fileExt = updatedShow.image.medium.split('.').reverse()[0];
  const showImagePath = `shows/${updatedShow.id}_${updatedShow.url.split('/').reverse()[0]}.${fileExt}`;
  await downloadImage(updatedShow.image.medium, showImagePath);

  await db.updateShowImage(updatedShow.id, {
    image: `/${showImagePath}`,
  });
}

router.post('/fetchMissingImage/:showId', isAuthenticated, async (req, res) => {
  try {
    if (!req.params.showId) {
      throw new Error('no show id provided');
    }

    await fetchMissingImage(req, req.params.showId);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
  return res.redirect(`/show/${req.params.showId}`);
});

// to to set a max images to stop request from timing out
export async function fetchMissingImages(req, maxImages = 50) {
  const db = req.app.get('tvshowDb');
  const shows = await db.getAllShows();
  let fetchedImages = 0;

  const showsPromises = shows.map(async (show) => {
    // CHECK IF IMAGE EXISTS
    if (fs.existsSync(path.join(imageDirectory, show.image))) {
      return;
    }
    if (fetchedImages === maxImages) {
      return;
    }

    const updatedShow = await tvMaze.show(show.id);

    const fileExt = updatedShow.image.medium.split('.').reverse()[0];
    const showImagePath = `shows/${updatedShow.id}_${updatedShow.url.split('/').reverse()[0]}.${fileExt}`;
    await downloadImage(updatedShow.image.medium, showImagePath);

    await db.updateShowImage(updatedShow.id, {
      image: `/${showImagePath}`,
    });
    fetchedImages += 1;
  });

  await Promise.all(showsPromises);
}

router.get('/fetchMissingImages', isAuthenticated, async (req, res) => {
  try {
    await fetchMissingImages(req);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
  return res.redirect('/admin/update');
});

export async function refreshWatchNext(req) {
  const db = req.app.get('tvshowDb');
  const shows = await db.getAllAiredEpisodesCountByShow();

  const showsToUpdate = shows
    .filter((s) => s.new_aired_episodes_count !== s.aired_episodes_count)
    .map((s) => ({ id: s.id, aired_episodes_count: s.new_aired_episodes_count }));

  await db.updateAllAiredCounts(showsToUpdate);
}

export async function refreshShowEpisodesData(req, showId) {
  const db = req.app.get('tvshowDb');
  // update data
  const updatedEpisodes = await tvMaze.episodes(showId, true);

  const currentEpisodesToUpdate = await db.getEpisodesByShowId(showId);

  const epPromises = updatedEpisodes.map(async (episode) => {
    const found = currentEpisodesToUpdate.find((e) => e.id === episode.id);
    const ep = episode;
    const data = {
      id: ep.id,
      show_id: showId,
      url: ep.url,
      name: ep.name,
      season: ep.season,
      number: ep.number,
      type: ep.type,
      airdate: ep.airdate,
      airtime: ep.airtime,
      airstamp: ep.airstamp,
      runtime: ep.runtime,
      image: ep.image?.medium,
      summary: ep.summary,
    };
    if (found) {
      console.log('ep found', data);
      return db.updateEpisode(ep.id, data);
    }
    return db.createEpisode(data);
  });

  return Promise.all(epPromises);
}

export async function refreshShowData(req) {
  const db = req.app.get('tvshowDb');
  // const isRecentlyUpdated = await db.isRecentlyUpdated();

  // if ((isRecentlyUpdated && !req.query.force) || !req.query.force) {
  //   return false;
  // }

  const shows = ((await db.getAllInProgressShows()) || []).slice(0, 5);
  console.log(
    'refresh shows: ',
    shows.map((s) => s.name),
  );
  const showPromises = shows.map(async (show) => {
    // update data
    const updatedShow = await tvMaze.show(show.id);
    const showSeasons = await tvMaze.seasons(show.id);

    // episodes to update
    const currentEpisodesToUpdate = await db.getRecentEpisodesByShowId(show.id);
    const firstEpToUpdate = currentEpisodesToUpdate[0];
    const seasonNumbers = [...new Set(currentEpisodesToUpdate.map((e) => e.season))];
    seasonNumbers.push(seasonNumbers.slice(-1)[0] + 1); // check for new seasons
    // filter out any seasons we don't find (like our check for new seasons)
    const seasonIds = seasonNumbers.map((number) => showSeasons.find((s) => s.number === number)?.id).filter((f) => !!f);

    const eps = (await Promise.all(seasonIds.map(async (seasonId) => tvMaze.seasonEpisodes(seasonId))))
      .flat()
      // seems silly but lets filter out eps that are before first eps returned from `getRecentEpisodesByShowId`
      .filter((f) => (f.season === firstEpToUpdate.season && f.number > firstEpToUpdate.number) || f.season > firstEpToUpdate.season);

    const epPromises = eps.map(async (episode) => {
      const found = currentEpisodesToUpdate.find((e) => e.id === episode.id);

      // console.log(show.name, { found: !!found }, { id: episode.id, name: episode.name, number: episode.number, season: episode.season });

      const ep = episode;
      const data = {
        id: ep.id,
        show_id: show.id,
        url: ep.url,
        name: ep.name,
        season: ep.season,
        number: ep.number,
        type: ep.type,
        airdate: ep.airdate,
        airtime: ep.airtime,
        airstamp: ep.airstamp,
        runtime: ep.runtime,
        image: ep.image?.medium,
        summary: ep.summary,
      };
      if (found) {
        return db.updateEpisode(ep.id, data);
      }
      return db.createEpisode(data);
    });

    await Promise.all(epPromises);

    // updated episodes
    const currentEpisodesWithNulls = await db.getEpisodesByShowId(show.id);
    const currentEpisodes = currentEpisodesWithNulls.filter((ep) => ep.number !== null);

    // try not updating iages for speed
    // let image;
    // if (updatedShow.image && updatedShow.image.medium) {
    //   const fileExt = updatedShow.image.medium.split('.').reverse()[0];
    //   const showImagePath = `shows/${updatedShow.id}_${updatedShow.url.split('/').reverse()[0]}.${fileExt}`;
    //   console.log(`download image for ${updatedShow.name}`);
    //   await downloadImage(updatedShow.image.medium, showImagePath);
    //   image = `/${showImagePath}`;
    // }

    const episodes_count = currentEpisodes.filter((ep) => ep.number !== null).length;
    const aired_episodes_count = currentEpisodes.filter((ep) => ep.number !== null && new Date(ep.airdate) < new Date()).length;
    const next_episode_towatch_airdate = currentEpisodes.find((ep) => ep.watched_status !== 'WATCHED')?.airdate || null;

    console.log(`update show data for ${updatedShow.name}`);
    await db.updateShow(updatedShow.id, {
      id: updatedShow.id,
      tvrage_id: updatedShow.externals.tvrage,
      thetvdb_id: updatedShow.externals.thetvdb,
      imdb_id: updatedShow.externals.imdb,
      url: updatedShow.url,
      summary: updatedShow.summary,
      name: updatedShow.name,
      type: updatedShow.type,
      language: updatedShow.language,
      status: updatedShow.status,
      runtime: updatedShow.runtime,
      averageRuntime: updatedShow.averageRuntime,
      premiered: updatedShow.premiered,
      ended: updatedShow.ended,
      officialSite: updatedShow.officialSite,
      network_name: updatedShow.network?.name,
      network_country: updatedShow.network?.country.name,
      network_country_code: updatedShow.network?.country.code,
      network_country_timezone: updatedShow.network?.country.timezone,
      // image: image,
      episodes_count,
      aired_episodes_count,
      next_episode_towatch_airdate,
    });
  });

  await Promise.all(showPromises);

  await db.setRecentlyUpdated();
  return shows;
}

router.get('/update_show_data', isAuthenticated, async (req, res) => {
  let shows = [];
  try {
    shows = await refreshShowData(req, res);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
  return req.query.raw ? res.json({ success: true, showsUpdated: shows.length }) : res.redirect('/admin/update');
});

router.post('/show/add/:showId', isAuthenticated, async (req, res) => {
  const apDb = req.app.get('apDb');
  const db = req.app.get('tvshowDb');
  try {
    if (!req.params.showId) {
      throw new Error('no show id provided');
    }
    const existingShow = await db.getShow(req.params.showId);
    if (existingShow) {
      return res.redirect(301, `/show/${existingShow.id}`);
    }

    // cleanup to be safe
    await db.deleteShow(req.params.showId);
    await db.deleteEpisodesByShow(req.params.showId);
    await db.deleteEpisodesByShow(null);

    const show = await tvMaze.show(req.params.showId);
    const episodes = await tvMaze.episodes(req.params.showId, true);

    const episodes_count = episodes.filter((ep) => ep.number !== null).length;
    const aired_episodes_count = episodes.filter((ep) => ep.number !== null && new Date(ep.airdate) < new Date()).length;
    const watched_episodes_count = 0;
    const last_watched_date = null;
    const next_episode_towatch_airdate = episodes.find((ep) => ep.season === 1 && ep.number === 1)?.airdate || null;

    const fileExt = show.image?.medium.split('.').reverse()[0];
    const showImagePath = `shows/${show.id}_${show.url.split('/').reverse()[0]}.${fileExt}`;
    if (show.image) {
      await downloadImage(show.image.medium, showImagePath);
    }
    await db.createShow({
      id: show.id,
      note: req.body.description,
      tvrage_id: show.externals.tvrage,
      thetvdb_id: show.externals.thetvdb,
      imdb_id: show.externals.imdb,
      url: show.url,
      summary: show.summary,
      name: show.name,
      type: show.type,
      language: show.language,
      status: show.status,
      runtime: show.runtime,
      averageRuntime: show.averageRuntime,
      premiered: show.premiered,
      ended: show.ended,
      officialSite: show.officialSite,
      network_name: show.network?.name,
      network_country: show.network?.country.name,
      network_country_code: show.network?.country.code,
      network_country_timezone: show.network?.country.timezone,
      image: show.image ? `/${showImagePath}` : null,
      episodes_count,
      aired_episodes_count,
      watched_episodes_count,
      last_watched_date,
      next_episode_towatch_airdate,
    });

    const epPromises = episodes.map(async (ep) => {
      await db.createEpisode({
        id: ep.id,
        show_id: req.params.showId,
        url: ep.url,
        name: ep.name,
        season: ep.season,
        number: ep.number,
        type: ep.type,
        airdate: ep.airdate,
        airtime: ep.airtime,
        airstamp: ep.airstamp,
        runtime: ep.runtime,
        image: ep.image?.medium,
        summary: ep.summary,
        watched_at: null,
      });
    });

    // await db.createEpisodes(
    //   episodes.map((ep) => ({
    //     id: ep.id,
    //     show_id: req.params.showId,
    //     url: ep.url,
    //     name: ep.name,
    //     season: ep.season,
    //     number: ep.number,
    //     type: ep.type,
    //     airdate: ep.airdate,
    //     airtime: ep.airtime,
    //     airstamp: ep.airstamp,
    //     runtime: ep.runtime,
    //     image: ep.image?.medium,
    //     summary: ep.summary,
    //     watched_at: null,
    //   })),
    // );

    await Promise.all(epPromises);

    const addedShow = await db.getShow(req.params.showId);

    // addedShow
    const data = {
      id: `show-${addedShow.id}`,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
      description: req.body.description,
      title: `Started Watching: <a href="https://${domain}/show/${addedShow.id}" rel="nofollow noopener noreferrer">${escapeHTML(
        addedShow.name,
      )}</a>`,
    };
    broadcastMessage(data, 'create', apDb, account, domain);

    return res.redirect(301, `/show/${show.id}`);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
});

router.post('/show/delete/:showId', isAuthenticated, async (req, res) => {
  const apDb = req.app.get('apDb');
  const db = req.app.get('tvshowDb');
  try {
    if (req.params.showId) {
      const show = await db.getShow(req.params.showId);
      if (show.image) {
        const directory = 'public';
        fs.unlink(path.join(directory, show.image), (err) => {
          if (err) throw err;
        });
      }
      db.deleteShow(req.params.showId);
      db.deleteEpisodesByShow(req.params.showId);

      broadcastMessage(show, 'delete', apDb, account, domain);
    }

    return res.redirect(301, `/admin`);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
});

export default router;
