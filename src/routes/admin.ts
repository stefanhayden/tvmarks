import express from 'express';
import fs from 'fs';
import path from 'path';
import tvMaze from 'node-tvmaze';
import escapeHTML from 'escape-html';
import { stringify as csvStringify } from 'csv-stringify/sync'; // https://github.com/adaltas/node-csv/issues/323
import { domain, actorInfo, parseJSON, account, dataDir } from '../util';
import { isAuthenticated } from '../session-auth';
import { lookupActorInfo, createFollowMessage, createUnfollowMessage, signAndSend, getInboxFromActorProfile, broadcastMessage } from '../activitypub';
import { downloadImage } from '../download-image';
import * as apDb from '../activity-pub-db';
import * as tvDb from '../tvshow-db';

const timezone_offset = Number(process.env.TIMEZONE_OFFSET || '+0');

const imageDirectory = 'public/shows';

type adminLinkType = {
  href: string;
  label: string;
};

const ADMIN_LINKS: adminLinkType[] = [
  { href: '/admin', label: 'Find shows' },
  { href: '/admin/followers', label: 'Permissions & followers' },
  { href: '/admin/following', label: 'Federated follows' },
  { href: '/admin/update', label: 'Update Show data' },
  { href: '/admin/data', label: 'Data export' },
];

const router = express.Router();

router.get('/update', isAuthenticated, async (req, res) => {
  const params = (req.query.raw ? {} : { title: 'Update Show data' }) as {
    title?: string;
    adminLinks: adminLinkType[];
    currentPath: string;
  };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  return res.render('admin/update', params);
});

router.get('/followers', isAuthenticated, async (req, res) => {
  const params: {
    title?: string;
    adminLinks?: adminLinkType[];
    currentPath?: string;
    followers?: unknown[];
    blocks?: unknown[];
    allowed?: unknown;
    blocked?: unknown;
  } = req.query.raw ? {} : { title: 'Permissions & followers' };

  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  if (actorInfo.disabled) {
    return res.render('nonfederated', params);
  }

  const permissions = await apDb.getGlobalPermissions();

  try {
    const followers = await apDb.getFollowers();
    params.followers = JSON.parse(followers || '[]');
  } catch (e) {
    console.log('Error fetching followers for admin page', e);
  }

  try {
    const blocks = await apDb.getBlocks();
    params.blocks = JSON.parse(blocks || '[]');
  } catch (e) {
    console.log('Error fetching blocks for admin page', e);
  }

  params.allowed = permissions?.allowed || '';
  params.blocked = permissions?.blocked || '';

  return res.render('admin/followers', params);
});

router.get('/following', isAuthenticated, async (req, res) => {
  const params: {
    title?: string;
    adminLinks?: adminLinkType[];
    currentPath?: string;
    following?: unknown[];
  } = req.query.raw ? {} : { title: 'Federated follows' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  if (actorInfo.disabled) {
    return res.render('nonfederated', params);
  }

  try {
    const following = await apDb.getFollowing();
    params.following = JSON.parse(following || '[]');
  } catch (e) {
    console.log('Error fetching followers for admin page', e);
  }

  return res.render('admin/following', params);
});

router.get('/data', isAuthenticated, async (req, res) => {
  const params: {
    title?: string;
    adminLinks?: adminLinkType[];
    currentPath?: string;
  } = req.query.raw ? {} : { title: 'Data export' };
  params.adminLinks = ADMIN_LINKS;
  params.currentPath = req.originalUrl;

  return res.render('admin/data', params);
});

router.get('/tvshows.db', isAuthenticated, async (req, res) => {
  const filePath = `${dataDir}/tvshows.db`;

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename="tvshows.db"');

  res.download(filePath, 'tvshows.db', { dotfiles: 'allow' });
});

router.get('/tvshows.csv', isAuthenticated, async (req, res) => {
  const tvshows = await tvDb.getTvshowsForCSVExport();
  const result = csvStringify(tvshows, { quoted: true });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tvshows.csv"');

  res.send(result);
});

router.get('/activitypub.db', isAuthenticated, async (req, res) => {
  const filePath = `${dataDir}/activitypub.db`;

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename="activitypub.db"');

  res.download(filePath, 'activitypub.db', { dotfiles: 'allow' });
});

router.post('/followers/block', isAuthenticated, async (req, res) => {
  const oldFollowersText = (await apDb.getFollowers()) || '[]';

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
    await apDb.setFollowers(newFollowersText);
  } catch (e) {
    console.log('error storing followers after unfollow', e);
  }

  const oldBlocksText = (await apDb.getBlocks()) || '[]';

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

    await apDb.setBlocks(newBlocksText);

    console.log('updated blocks!');
  } catch (e) {
    console.log('error storing blocks after block action', e);
  }

  res.redirect('/admin/followers');
});

router.post('/followers/unblock', isAuthenticated, async (req, res) => {
  const oldBlocksText = (await apDb.getBlocks()) || '[]';

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
    await apDb.setBlocks(newBlocksText);
  } catch (e) {
    console.log('error storing blocks after unblock action', e);
  }

  res.redirect('/admin/followers');
});

router.post('/following/follow', isAuthenticated, async (req, res) => {
  const accountObj = req.app.get('account');

  const canonicalUrl = await lookupActorInfo(req.body.actor);

  try {
    const inbox = await getInboxFromActorProfile(canonicalUrl);

    if (inbox) {
      const followMessage = await createFollowMessage(accountObj, domain, canonicalUrl, apDb);
      signAndSend(followMessage, accountObj, domain, apDb, req.body.actor.split('@').slice(-1), inbox);
    }

    return res.redirect('/admin/following');
  } catch (e) {
    console.log(e.message);
    return res.status(500).send("Couldn't process follow request");
  }
});

router.post('/following/unfollow', isAuthenticated, async (req, res) => {
  const accountObj = req.app.get('account');

  const oldFollowsText = (await apDb.getFollowing()) || '[]';

  const follows = parseJSON(oldFollowsText);
  if (follows) {
    follows.forEach((follow, idx) => {
      if (follow === req.body.actor) {
        follows.splice(idx, 1);
      }
    });

    const inbox = await getInboxFromActorProfile(req.body.actor);

    const unfollowMessage = createUnfollowMessage(accountObj, domain, req.body.actor, apDb);

    signAndSend(unfollowMessage, accountObj, domain, apDb, new URL(req.body.actor).hostname, inbox);

    const newFollowsText = JSON.stringify(follows);

    try {
      await apDb.setFollowing(newFollowsText);
    } catch (e) {
      console.log('error storing follows after unfollow action', e);
    }
    return res.redirect('/admin/following');
  }
  return res.status(500).send('Encountered an error processing existing following list');
});

router.post('/permissions', isAuthenticated, async (req, res) => {
  await apDb.setGlobalPermissions(req.body.allowed, req.body.blocked);

  res.redirect('/admin');
});

router.post('/reset', isAuthenticated, async (req, res) => {
  await tvDb.deleteAllShows();
  await tvDb.deleteAllEpisodes();

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
    const params: {
      title: string;
      searchTv?: unknown[];
      error?: string;
      adminLinks?: adminLinkType[];
      currentPath?: string;
      query?: unknown;
    } = { title: 'Find shows' };
    if (req.query.query) {
      // Search both TVMaze and local database
      const [tvMazeResults, localShows] = await Promise.all([tvMaze.search(req.query.query), tvDb.searchShowsByName(req.query.query as string)]);

      // Create a map of local show IDs for quick lookup
      const localShowIds = new Set(localShows.map((show: { id: number }) => show.id));

      // Combine results: mark TVMaze results with whether they exist locally
      params.searchTv = tvMazeResults.map((result: { show: { id: number } }) => ({
        ...result,
        existsLocally: localShowIds.has(result.show.id),
      }));

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

export async function fetchMissingImage(req, res, showId) {
  const show = await tvDb.getShow(showId);

  const updatedShow = await tvMaze.show(show.id);

  try {
    const fileExt = updatedShow.image.medium.split('.').reverse()[0];
    const showImagePath = `${updatedShow.id}_${updatedShow.url.split('/').reverse()[0]}.${fileExt}`;
    await downloadImage(updatedShow.image.medium, showImagePath);

    return tvDb.updateShowImage(updatedShow.id, {
      image: `/shows/${showImagePath}`,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
}

router.post('/fetchMissingImage/:showId', isAuthenticated, async (req, res) => {
  try {
    if (!req.params.showId) {
      throw new Error('no show id provided');
    }

    await fetchMissingImage(req, res, req.params.showId);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
  return res.redirect(`/show/${req.params.showId}`);
});

// to to set a max images to stop request from timing out
export async function fetchMissingImages(req, maxImages = 50) {
  const shows = await tvDb.getAllInProgressShows();
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
    const showImagePath = `${updatedShow.id}_${updatedShow.url.split('/').reverse()[0]}.${fileExt}`;
    await downloadImage(updatedShow.image.medium, showImagePath);

    await tvDb.updateShowImage(updatedShow.id, {
      image: `/shows/${showImagePath}`,
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

export async function refreshWatchNext() {
  const shows = await tvDb.getAllAiredEpisodesCountByShow();

  const showsToUpdate = shows
    .filter((s) => s.new_aired_episodes_count !== s.aired_episodes_count)
    .map((s) => ({ id: s.id, aired_episodes_count: s.new_aired_episodes_count }));

  await tvDb.updateAllAiredCounts(showsToUpdate);
}

export async function refreshShowEpisodesData(_, showId) {
  // update data
  const updatedEpisodes = await tvMaze.episodes(showId, true);

  const currentEpisodesToUpdate = await tvDb.getEpisodesByShowId(showId);

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
      watched_status: null,
      watched_at: undefined,
    };
    if (found) {
      console.log('ep found', data);
      return tvDb.updateEpisode(ep.id, data);
    }
    return tvDb.createEpisode(data);
  });

  await Promise.all(epPromises);

  const currentEpisodesWithNulls = await tvDb.getEpisodesByShowId(showId);
  const currentEpisodes = currentEpisodesWithNulls.filter((ep) => ep.number !== null);
  const episodes_count = currentEpisodes.filter((ep) => ep.number !== null).length;
  const aired_episodes_count = currentEpisodes.filter((ep) => {
    const airstamp = new Date(new Date(ep.airstamp).setHours(new Date().getHours() + timezone_offset));
    return ep.number !== null && airstamp <= new Date();
  }).length;

  return tvDb.updateShow(showId, {
    episodes_count,
    aired_episodes_count,
  });
}

export async function refreshShowData() {
  const shows = ((await tvDb.getAllInProgressShows()) || []).slice(0, 5);
  console.log(
    'refresh shows: ',
    shows.map((s) => s.name),
  );
  const showPromises = shows.map(async (show) => {
    // update data
    const updatedShow = await tvMaze.show(show.id);
    const showSeasons = await tvMaze.seasons(show.id);

    // episodes to update
    const currentEpisodesToUpdate = await tvDb.getRecentEpisodesByShowId(show.id);
    const seasonNumbers: number[] = [...new Set<number>(currentEpisodesToUpdate.map((e) => e.season))];
    if (seasonNumbers.length > 0) {
      seasonNumbers.push(seasonNumbers.slice(-1)[0] + 1); // check for new seasons
    }

    // filter out any seasons we don't find (like our check for new seasons)
    const seasonIds = seasonNumbers.map((number) => showSeasons.find((s) => s.number === number)?.id).filter((f) => !!f);

    const eps = (
      await Promise.all(
        seasonIds.map(async (seasonId) =>
          tvMaze.seasonEpisodes(seasonId).catch((e) => {
            console.log(`failed getting season from tzmaze: ${seasonId}`, e);
            return [];
          }),
        ),
      )
    ).flat();

    const epPromises = eps.map(async (episode) => {
      const found = currentEpisodesToUpdate.find((e) => e.id === episode.id);

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
        watched_at: undefined,
        watched_status: null,
      };
      if (found) {
        return tvDb.updateEpisode(ep.id, data);
      }
      return tvDb.createEpisode(data);
    });

    await Promise.all(epPromises);

    // updated episodes
    const currentEpisodesWithNulls = await tvDb.getEpisodesByShowId(show.id);
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
    const aired_episodes_count = currentEpisodes.filter((ep) => {
      const airstamp = new Date(new Date(ep.airstamp).setHours(new Date().getHours() + timezone_offset));
      return ep.number !== null && airstamp <= new Date();
    }).length;

    // const aired_episodes_count = currentEpisodes.filter((ep) => ep.number !== null && new Date(ep.airstamp) < new Date()).length;
    const next_episode_towatch_airdate = currentEpisodes.find((ep) => ep.watched_status !== 'WATCHED')?.airdate || null;

    console.log(`update show data for ${updatedShow.name}`);
    await tvDb.updateShow(updatedShow.id, {
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

  return shows;
}

router.get('/update_show_data', isAuthenticated, async (req, res) => {
  let shows = [];
  try {
    shows = await refreshShowData();
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
  return req.query.raw
    ? res.json({ success: true, updatedCount: shows.length, shows: shows.map((show) => show.name) })
    : res.redirect('/admin/update');
});

router.post('/show/add/:showId', isAuthenticated, async (req, res) => {
  try {
    if (!req.params.showId) {
      throw new Error('no show id provided');
    }
    const existingShow = await tvDb.getShow(req.params.showId);
    if (existingShow) {
      return res.redirect(301, `/show/${existingShow.id}`);
    }

    // cleanup to be safe
    await tvDb.deleteShow(req.params.showId);
    await tvDb.deleteEpisodesByShow(req.params.showId);
    await tvDb.deleteEpisodesByShow(null);

    const show = await tvMaze.show(req.params.showId);
    const episodes = await tvMaze.episodes(req.params.showId, true);

    const episodes_count = episodes.filter((ep) => ep.number !== null).length;
    const aired_episodes_count = episodes.filter((ep) => ep.number !== null && new Date(ep.airdate) < new Date()).length;
    const watched_episodes_count = 0;
    const last_watched_date = null;
    const next_episode_towatch_airdate = episodes.find((ep) => ep.season === 1 && ep.number === 1)?.airdate || null;

    const fileExt = show.image?.medium.split('.').reverse()[0];
    const showImagePath = `${show.id}_${show.url.split('/').reverse()[0]}.${fileExt}`;
    if (show.image) {
      await downloadImage(show.image.medium, showImagePath);
    }
    await tvDb.createShow({
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
      image: show.image ? `/shows/${showImagePath}` : null,
      episodes_count,
      aired_episodes_count,
      watched_episodes_count,
      last_watched_date,
      next_episode_towatch_airdate,
      abandoned: false,
    });

    const epPromises = episodes.map(async (ep) => {
      await tvDb.createEpisode({
        id: ep.id,
        show_id: parseInt(req.params.showId),
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
        watched_status: undefined,
      });
    });

    await Promise.all(epPromises);

    const addedShow = await tvDb.getShow(req.params.showId);

    // addedShow
    const data = {
      id: `show-${addedShow.id}`,
      path: `show/${addedShow.id}`,
      url: addedShow.url,
      description: req.body.description,
      title: `Started following: <a href="https://${domain}/show/${addedShow.id}" rel="nofollow noopener noreferrer">${escapeHTML(
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
  try {
    if (req.params.showId) {
      const show = await tvDb.getShow(req.params.showId);
      if (show.image) {
        const directory = 'public';
        fs.unlink(path.join(directory, show.image), (err) => {
          if (err) console.log('no image to delete', err);
        });
      }
      tvDb.deleteShow(req.params.showId);
      tvDb.deleteEpisodesByShow(req.params.showId);

      const data = {
        id: `show-${show.id}`,
        path: `show/${show.id}`,
        url: show.url,
      };
      broadcastMessage(data, 'delete', apDb, account, domain);
    }

    return res.redirect(301, `/admin`);
  } catch (err) {
    console.log(err);
    return res.status(500).send('Internal Server Error');
  }
});

export default router;
