/**
 * Module handles database management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */

// Utilities we need
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
// unclear why eslint can't resolve this package
// eslint-disable-next-line import/no-unresolved, node/no-missing-import
import { stripHtml } from 'string-strip-html';
import { timeSince, account, domain } from './util.js';

const ACCOUNT_MENTION_REGEX = new RegExp(`^@${account}@${domain} `);

export function initTvshowDb(dbFile = './.data/tvshows.db') {
  let db;

  // for now, strip the HTML when we retrieve it from the DB, just so that we keep as much data as possible
  // if we ultimately decide that we don't want to do something fancier with keeping bold, italics, etc but
  // discarding Mastodon's presentational HTML tags, then we'll remove this and handle that at the time comments get stored
  function stripHtmlFromComment(comment) {
    return { ...comment, content: stripHtml(comment.content).result };
  }

  function stripMentionFromComment(comment) {
    return {
      ...comment,
      content: comment.content.replace(ACCOUNT_MENTION_REGEX, ''),
    };
  }

  function generateLinkedDisplayName(comment) {
    const match = comment.name.match(/^@([^@]+)@(.+)$/);
    return {
      linked_display_name: `<a href="http://${match[2]}/@${match[1]}">${match[1]}</a>`,
      ...comment,
    };
  }

  function addBookmarkDomain(bookmark) {
    return { domain: new URL(bookmark.url).hostname, ...bookmark };
  }

  function insertRelativeTimestamp(object) {
    // timestamps created by SQLite's CURRENT_TIMESTAMP are in UTC regardless
    // of server setting, but don't actually indicate a timezone in the string
    // that's returned. Had I known this, I probably would have avoided
    // CURRENT_TIMESTAMP altogether, but since lots of people already have
    // databases full of bookmarks, in lieu of a full-on migration to go along
    // with a code change that sees JS-generated timestamps at the time of
    // SQLite INSERTs, we can just append the UTC indicator to the string when parsing it.
    return {
      timestamp: timeSince(new Date(`${object.created_at}Z`).getTime()),
      ...object,
    };
  }

  function massageComment(comment) {
    return generateLinkedDisplayName(stripMentionFromComment(stripHtmlFromComment(insertRelativeTimestamp(comment))));
  }

  /*
  We're using the sqlite wrapper so that we can make async / await connections
  - https://www.npmjs.com/package/sqlite
  */
  const init = async () => {
    const exists = fs.existsSync(dbFile);
    return open({
      filename: dbFile,
      driver: sqlite3.Database,
    }).then(async (dBase) => {
      db = dBase;

      try {
        console.log('Does DB exist???');
        if (!exists) {
          console.log('Nope, lets create it!');
          // eslint-disable-next-line no-bitwise
          const newDb = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
              throw new Error(`unable to open or create database: ${err}`);
            }
          });

          newDb.close();

          // now do it again, using the async/await library
          await open({
            filename: dbFile,
            driver: sqlite3.Database,
          }).then(async () => {
            db = dBase;
          });

          // Database doesn't exist yet - create Bookmarks table
          await db.run(
            `CREATE TABLE shows (
              id INTEGER PRIMARY KEY,
              tvrage_id	INTEGER,
              thetvdb_id INTEGER,
              imdb_id	TEXT,
              url TEXT,
              summary TEXT,
              name TEXT, 
              type TEXT,
              language TEXT,
              status TEXT, -- "Ended", "In Development", "Running", "To Be Determined"
              runtime INTEGER, 
              averageRuntime INTEGER, 
              premiered TEXT, 
              ended	TEXT, 
              officialSite TEXT, 
              network_name TEXT, 
              network_country TEXT, 
              network_country_code TEXT, 
              network_country_timezone TEXT,
              image TEXT,
              note TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );`,
          );
          console.log('Table shows created');

          await db.run(
            `CREATE TABLE episodes (
              id INTEGER PRIMARY KEY,
              show_id INTEGER,
              url TEXT,
              name TEXT, 
              season INTEGER, 
              number INTEGER, 
              type TEXT,
              airdate	TEXT,
              airtime	TEXT,
              airstamp	DATETIME,
              runtime	INTEGER,
              image TEXT,
              summary TEXT,
              note TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              watched_at DATETIME DEFAULT NULL,
              watched_status TEXT
            );`,
          );
          console.log('Table episodes created');

          await db.run(
            `CREATE TABLE comments
              (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                url TEXT,
                content TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                visible integer BOOLEAN DEFAULT 0 NOT NULL CHECK (visible IN (0,1)),
                resource_id TEXT
              );`,
          );
          // stops duplicate commnents from being created
          await db.run('CREATE UNIQUE INDEX comments_url ON comments(url)');

          // track when last time we pulled in show data from 3rd party
          await db.run(
            `CREATE TABLE update_history (
              last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
            );`,
          );
          await db.run(`INSERT INTO update_history (last_checked) VALUES (CURRENT_DATE);`);
          console.log('Update shows created');
        } else {
          console.log('Yes DB exists.. lets continue to app...');
        }

        // return db;
      } catch (dbError) {
        console.error(dbError);
      }
    });
  };

  const getShowCount = async () => {
    const result = await db.get('SELECT count(id) as count FROM shows');
    return result?.count;
  };

  const getShows = async (limit = 10, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const timezoneMod = '-5 hour';
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const results = await db.all(
        `with all_shows as (
          SELECT shows.*,
          (SELECT count(*) from episodes where ${subQueryFilter}) episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < datetime(CURRENT_TIMESTAMP, 'localtime', '${timezoneMod}')) aired_episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') watched_episodes_count,
          (SELECT watched_at from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') last_watched_date
          from shows
        ),
        eps as (
          SELECT all_shows.*,
          (
            SELECT
              count(*) 
              from episodes 
            where 
              episodes.show_id = all_shows.id AND
              episodes.number IS NOT NULL AND
              episodes.airdate < CURRENT_DATE AND
              episodes.airdate < all_shows.last_watched_date
          ) aired_episodes_at_last_watched_date_count,
          (
            SELECT
              airdate 
              from episodes 
            where 
              episodes.show_id = all_shows.id AND
              episodes.number IS NOT NULL AND
              episodes.airdate > all_shows.last_watched_date 
              LIMIT 1
          ) next_episode_towatch_airdate
          from all_shows
        )
        select * from eps
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getShowsNotStarted = async (limit = 25, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const results = await db.all(
        `SELECT shows.* from shows
        WHERE (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') == 0
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getShowsCompleted = async (limit = 25, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      // episodes watched === episodes aired && show status == 'Ended'
      const results = await db.all(
        `SELECT shows.* from shows
        WHERE (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') == 
        (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < CURRENT_DATE)
        AND shows.status == 'Ended'
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getShowsUpToDate = async (limit = 25, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const timezoneMod = '-5 hour';
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;

      const results = await db.all(
        `with all_shows as (
          SELECT shows.*,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < datetime(CURRENT_TIMESTAMP, 'localtime', '${timezoneMod}')) aired_episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') watched_episodes_count
          from shows
        )
        SELECT all_shows.* from all_shows
        WHERE 
          all_shows.aired_episodes_count <= all_shows.watched_episodes_count
          AND all_shows.aired_episodes_count > 0
          AND all_shows.status != 'Ended'
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getShowsToWatch = async (limit = 25, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const timezoneMod = '-5 hour';
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const results = await db.all(
        `with all_shows as (
          SELECT shows.*,
          (SELECT count(*) from episodes where ${subQueryFilter}) episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < datetime(CURRENT_TIMESTAMP, 'localtime', '${timezoneMod}')) aired_episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') watched_episodes_count,
          (SELECT watched_at from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') last_watched_date
          from shows
        ),
        eps as (
          SELECT all_shows.*,
          (
            SELECT
              airdate 
              from episodes 
            where 
              episodes.show_id = all_shows.id AND
              episodes.number IS NOT NULL AND
              episodes.airdate > all_shows.last_watched_date 
              LIMIT 1
          ) next_episode_towatch_airdate
          from all_shows
        )
        select * from eps
        WHERE
          eps.watched_episodes_count > 0 AND
          eps.aired_episodes_count > eps.watched_episodes_count AND
          (
            (
              (eps.status == 'Ended' OR eps.status == 'To Be Determined') AND
              eps.last_watched_date > datetime('now', '-3 month')
            ) OR
            (
              eps.status == 'Running' AND
              (
                eps.next_episode_towatch_airdate > datetime('now', '-3 month') OR
                eps.last_watched_date > datetime('now', '-3 month')
              )
            )
          )
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getShowsAbandoned = async (limit = 25, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const results = await db.all(
        `with all_shows as (
          SELECT shows.*,
          (SELECT count(*) from episodes where ${subQueryFilter}) episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < CURRENT_DATE) aired_episodes_count,
          (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') watched_episodes_count,
          (SELECT watched_at from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') last_watched_date
          from shows
        ),
        eps as (
          SELECT all_shows.*,
          (
            SELECT
              airdate 
              from episodes 
            where 
              episodes.show_id = all_shows.id AND
              episodes.number IS NOT NULL AND
              episodes.airdate > all_shows.last_watched_date
              LIMIT 1
          ) next_episode_towatch_airdate
          from all_shows
        )
        select * from eps
        WHERE
          eps.watched_episodes_count > 0 AND
          eps.aired_episodes_count > eps.watched_episodes_count AND
          (
            (
              eps.status == 'Ended' AND eps.last_watched_date < datetime('now', '-3 month')
            )
            OR
            (
              eps.status == 'Running' AND
              eps.next_episode_towatch_airdate < datetime('now', '-3 month') AND
              eps.last_watched_date < datetime('now', '-3 month')
            )
          )
        ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );
      return results;
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getTvshowsForCSVExport = async () => {
    // We use a try catch block in case of db errors
    try {
      const headers = ['title', 'url', 'description', 'tags', 'created_at', 'updated_at'];
      const selectHeaders = headers.join(',');
      // This will create an object where the keys and values match. This will
      // allow the csv stringifier to interpret this as a header row.
      const columnTitles = Object.fromEntries(headers.map((header) => [header, header]));
      const results = await db.all(`SELECT ${selectHeaders} from bookmarks`);
      return [columnTitles].concat(results);
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return undefined;
  };

  const getUpdateHistory = async () => {
    try {
      const result = await db.get(`SELECT last_checked from update_history`);
      console.log(result);
      return result.last_checked;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const isRecentlyUpdated = async () => {
    try {
      const result = await db.get(`SELECT last_checked from update_history WHERE last_checked > datetime(CURRENT_TIMESTAMP, '-3 day')`);
      console.log('db isRecentlyUpdated', result);
      return !!result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const setRecentlyUpdated = async () => {
    try {
      const result = await db.get(`UPDATE update_history SET last_checked = CURRENT_TIMESTAMP`);
      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getShow = async (id) => {
    try {
      const timezoneMod = '-5 hour';
      const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const result = await db.get(
        `SELECT 
        shows.*,
        (SELECT count(*) from episodes where ${subQueryFilter}) episodes_count,
        (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.airdate < datetime(CURRENT_TIMESTAMP, 'localtime', '${timezoneMod}')) aired_episodes_count,
        (SELECT count(*) from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') watched_episodes_count,
        (SELECT watched_at from episodes where ${subQueryFilter} AND episodes.watched_status == 'WATCHED') last_watched_date,
        (SELECT id from episodes where ${subQueryFilter} AND episodes.watched_status IS NULL ) last_watched_episode_id
        from shows WHERE shows.id = ?`,
        id,
      );
      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getEpisodes = async () => {
    try {
      const result = await db.all('SELECT episodes.* from episodes');
      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getEpisode = async (id) => {
    try {
      const result = await db.get('SELECT episodes.* from episodes WHERE episodes.id = ?', id);
      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getEpisodesByShowId = async (showId) => {
    try {
      const result = await db.all('SELECT episodes.* from episodes WHERE episodes.show_id = ? ORDER BY number ASC', showId);
      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const updateEpisodeWatchStatus = async (id, status) => {
    try {
      await db.run(
        `UPDATE episodes SET watched_status = ?, watched_at = ${status === 'WATCHED' ? `DateTime('now')` : null} WHERE id = ?`,
        status,
        id,
      );

      return await db.get('SELECT * from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const updateEpisodeNote = async (id, note) => {
    try {
      await db.run(`UPDATE episodes SET note = ? WHERE id = ?`, note, id);

      return await db.get('SELECT * from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const createShow = async (body) => {
    try {
      const keys = Object.keys(body);

      const result = await db.run(
        `INSERT INTO shows 
      (
        ${keys.join(',')}, created_at, updated_at
      ) 
      VALUES (${keys.map((v) => `$${v}`).join(',')}, DateTime('now'), DateTime('now'))`,
        {
          $id: body.id,
          $note: body.note,
          $tvrage_id: body.tvrage_id,
          $thetvdb_id: body.thetvdb_id,
          $imdb_id: body.imdb_id,
          $url: body.url,
          $summary: body.summary,
          $name: body.name,
          $type: body.type,
          $language: body.language,
          $status: body.status,
          $runtime: body.runtime,
          $averageRuntime: body.averageRuntime,
          $premiered: body.premiered,
          $ended: body.ended,
          $officialSite: body.officialSite,
          $network_name: body.network_name,
          $network_country: body.network_country,
          $network_country_code: body.network_country_code,
          $network_country_timezone: body.network_country_timezone,
          $image: body.image,
        },
      );
      return getShow(result.lastID);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const updateShow = async (id, body) => {
    try {
      await db.run(
        `UPDATE shows SET tvrage_id=$tvrage_id, thetvdb_id=$thetvdb_id, imdb_id=$imdb_id,
        url=$url, summary=$summary, name=$name, type=$type, language=$language, status=$status,
        runtime=$runtime, averageRuntime=$averageRuntime, premiered=$premiered, ended=$ended,
        officialSite=$officialSite, network_name=$network_name, network_country=$network_country,
        network_country_code=$network_country_code, network_country_timezone=$network_country_timezone,
        image=$image, updated_at=DateTime('now') WHERE id = $id`,
        {
          $id: id,
          $tvrage_id: body.tvrage_id,
          $thetvdb_id: body.thetvdb_id,
          $imdb_id: body.imdb_id,
          $url: body.url,
          $summary: body.summary,
          $name: body.name,
          $type: body.type,
          $language: body.language,
          $status: body.status,
          $runtime: body.runtime,
          $averageRuntime: body.averageRuntime,
          $premiered: body.premiered,
          $ended: body.ended,
          $officialSite: body.officialSite,
          $network_name: body.network?.name,
          $network_country: body.network?.country,
          $network_country_code: body.network?.country?.code,
          $network_country_timezone: body.network?.country?.timezone,
          $image: body.image,
        },
      );

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const updateShowNote = async (id, body) => {
    try {
      await db.run(
        `UPDATE shows SET note=$note, updated_at=DateTime('now') WHERE id = $id`,
        {
          $id: id,
          $note: body.note,
        },
      );

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const deleteShow = async (id) => {
    try {
      await db.run('DELETE from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const createEpisode = async (body) => {
    try {
      const keys = Object.keys(body);
      const result = await db.run(
        `INSERT INTO episodes 
      (
        ${keys.join(',')}, created_at, updated_at
      ) 
      VALUES (${keys.map((v) => `$${v}`).join(',')}, DateTime('now'), DateTime('now'))`,
        {
          $id: body.id,
          $show_id: body.show_id,
          $url: body.url,
          $name: body.name,
          $season: body.season,
          $number: body.number,
          $type: body.type,
          $airdate: body.airdate,
          $airtime: body.airtime,
          $airstamp: body.airstamp,
          $runtime: body.runtime,
          $image: body.image,
          $summary: body.summary,
          $watched_status: body.watched_status,
          $watched_at: body.watched_at,
        },
      );

      return getEpisode(result.lastID);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const updateEpisode = async (id, body) => {
    try {
      await db.run(
        `UPDATE episodes SET show_id=$show_id, url=$url, name=$name, season=$season,
        number=$number, type=$type, airdate=$airdate, airtime=$airtime, airstamp=$airstamp,
        runtime=$runtime, image=$image, summary=$summary,
        updated_at=DateTime('now') WHERE id = $id`,
        {
          $id: id,
          $show_id: body.show_id,
          $url: body.url,
          $name: body.name,
          $season: body.season,
          $number: body.number,
          $type: body.type,
          $airdate: body.airdate,
          $airtime: body.airtime,
          $airstamp: body.airstamp,
          $runtime: body.runtime,
          $image: body.image,
          $summary: body.summary,
        },
      );

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const deleteEpisode = async (id) => {
    try {
      await db.run('DELETE from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const deleteEpisodesByShow = async (showId) => {
    try {
      await db.run('DELETE from episodes WHERE show_id = ?', showId);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const getNetworkPosts = async () => {
    try {
      const result = await db.all('SELECT * from comments WHERE resource_id IS NULL ORDER BY created_at DESC');

      return result;
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const createComment = async (showEpisodeId, name, url, content, visible = 0) => {
    try {
      await db.run(
        'INSERT INTO comments (name, url, content, resource_id, visible) VALUES (?, ?, ?, ?, ?)',
        name,
        url,
        content,
        showEpisodeId,
        visible,
      );
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const deleteComment = async (resourceId) => {
    try {
      console.log('deleteComment', resourceId)
      return await db.run('DELETE FROM comments WHERE resource_id = ?', resourceId);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const deleteCommentById = async (id) => {
    try {
      return await db.run('DELETE FROM comments WHERE id = ?', id);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const toggleCommentVisibility = async (commentId) => {
    try {
      await db.run('UPDATE comments SET visible = ((visible | 1) - (visible & 1)) WHERE id = ?', commentId);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const getAllComments = async (showEpisodeId) => {
    try {
      const results = await db.all('SELECT * FROM comments WHERE resource_id = ?', showEpisodeId);
      return results.map((c) => massageComment(c));
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getVisibleComments = async (showEpisodeId) => {
    try {
      const results = await db.all('SELECT * FROM comments WHERE visible = 1 AND resource_id = ?', showEpisodeId);
      return results.map((c) => massageComment(c));
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const deleteHiddenComments = async (showEpisodeId) => {
    try {
      await db.run('DELETE FROM comments WHERE visible = 0 AND resource_id = ?', showEpisodeId);
    } catch (dbError) {
      console.error(dbError);
    }
  };

  const deleteAllShows = async () => {
    try {
      // Delete the shows
      await db.run('DELETE from shows');

      // Return empty array
      return [];
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const deleteAllEpisodes = async () => {
    try {
      // Delete the episodes
      await db.run('DELETE FROM episodes');

      // Return empty array
      return [];
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  const getAllInProgressShows = async () => {
    try {
      return await db.all(`SELECT * FROM shows WHERE status != 'Ended'`);
      // return results.map((c) => massageComment(c));
    } catch (dbError) {
      console.error(dbError);
    }
    return undefined;
  };

  return {
    init,
    stripHtmlFromComment,
    stripMentionFromComment,
    generateLinkedDisplayName,
    addBookmarkDomain,
    insertRelativeTimestamp,
    getShowCount,
    getShow,
    getShows,
    getShowsNotStarted,
    getShowsCompleted,
    getShowsUpToDate,
    getShowsToWatch,
    getShowsAbandoned,
    getTvshowsForCSVExport,
    getUpdateHistory,
    setRecentlyUpdated,
    isRecentlyUpdated,
    getEpisodes,
    getEpisode,
    getEpisodesByShowId,
    updateEpisodeWatchStatus,
    updateEpisodeNote,
    createShow,
    updateShow,
    updateShowNote,
    deleteShow,
    createEpisode,
    updateEpisode,
    deleteEpisode,
    deleteEpisodesByShow,
    createComment,
    deleteComment,
    deleteCommentById,
    toggleCommentVisibility,
    getAllComments,
    getVisibleComments,
    deleteHiddenComments,
    deleteAllShows,
    deleteAllEpisodes,
    getAllInProgressShows,
    getNetworkPosts,
  };
}
