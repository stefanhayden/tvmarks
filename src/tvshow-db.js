/**
 * Module handles database management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */

// Utilities we need
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { stripHtml } from 'string-strip-html';
import { timeSince, account, domain, dataDir } from './util.js';

const ACCOUNT_MENTION_REGEX = new RegExp(`^@${account}@${domain} `);

const timezone_offset = process.env.TIMEZONE_OFFSET || '+0';
const timezoneMod = `${timezone_offset} hour`;

export function initTvshowDb(dbFile = `${dataDir}/tvshows.db`) {
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
              
              episodes_count INTEGER DEFAULT 0,
              aired_episodes_count INTEGER DEFAULT 0,
              watched_episodes_count INTEGER DEFAULT 0,
              last_watched_date DATETIME DEFAULT NULL,
              next_episode_towatch_airdate DATETIME DEFAULT NULL,
              last_watched_episode_id INTEGER DEFAULT NULL,
              abandoned BOOLEAN DEFAULT FALSE,
              
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

          console.log('Update shows created');
        } else {
          console.log('Yes DB exists.. lets continue to app...');
        }

        // return db;
      } catch (dbError) {
        console.error('failed init', dbError);
      }
    });
  };

  const getWatchStats = async () => {
    const result = await db.get(`
      SELECT
        COUNT(CASE WHEN watched_status = 'WATCHED' then 1 ELSE NULL END) as "watched_episodes",
        SUM(CASE WHEN watched_status = 'WATCHED' then runtime ELSE NULL END) as "watched_minutes",
        COUNT(CASE WHEN watched_status = 'WATCHED' then NULL ELSE 1 END) as "not_watched_episodes",
        SUM(CASE WHEN watched_status!= 'WATCHED' then NULL ELSE runtime END) as "minutes_to_watch"
      FROM episodes
    `);
    return result;
  };

  const getEpisodeCount = async () => {
    const result = await db.get('SELECT count(id) as totalEpisodes, sum(runtime) as totalMinutes FROM episodes');
    return result;
  };

  const getShowCount = async () => {
    const result = await db.get('SELECT count(id) as count FROM shows');
    return result?.count;
  };

  const getShows = async (limit = 10, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      // const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
      const results = await db.all(`select * from shows ORDER BY updated_at DESC LIMIT ? OFFSET ?`, limit, offset);
      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShows', dbError);
    }
    return undefined;
  };

  const getShowsNotStarted = async (limit = 24, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const results = await db.all(
        `SELECT * from shows
        WHERE watched_episodes_count == 0
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );

      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShowsNotStarted', dbError);
    }
    return undefined;
  };

  const getShowsCompleted = async (limit = 24, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const results = await db.all(
        `SELECT * from shows
        WHERE aired_episodes_count == watched_episodes_count
        AND status == 'Ended'
        ORDER BY last_watched_date, updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );

      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShowsCompleted', dbError);
    }
    return undefined;
  };

  const getShowsToWatch = async (limit = 24, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const results = await db.all(
        `select *
        from shows
          WHERE
            abandoned != 1 AND
            watched_episodes_count > 0 AND
            (
              DateTime(next_episode_towatch_airdate) <= DateTime('now', '${timezoneMod}') OR
              watched_episodes_count < aired_episodes_count
            ) AND
            (
              (
                (status == 'Ended' OR status == 'To Be Determined') AND
                last_watched_date > date('now', '-3 month', '${timezoneMod}')
              ) OR
              (
                status == 'Running' AND
                aired_episodes_count > watched_episodes_count AND
                (
                  DateTime(next_episode_towatch_airdate) > date('now', '-3 month', '${timezoneMod}') OR
                  last_watched_date > date('now', '-3 month', '${timezoneMod}')
                )
              )
            )
          ORDER BY last_watched_date DESC LIMIT ? OFFSET ?;
        `,
        limit,
        offset,
      );

      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShowsToWatch', dbError);
    }
    return undefined;
  };

  const getShowsUpToDate = async (limit = 24, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const results = await db.all(
        `SELECT *
          from shows
        WHERE 
          (
            (DateTime(next_episode_towatch_airdate) > DateTime('now', '${timezoneMod}') AND aired_episodes_count == watched_episodes_count)
            OR
            aired_episodes_count <= watched_episodes_count
          )
          AND watched_episodes_count != 0
          AND status != 'Ended'
        ORDER BY last_watched_date DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );

      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShowsUpToDate', dbError);
    }
    return undefined;
  };

  const getShowsAbandoned = async (limit = 24, offset = 0) => {
    // We use a try catch block in case of db errors
    try {
      const results = await db.all(
        `select * from shows
          WHERE
            watched_episodes_count > 0 AND
            DateTime(next_episode_towatch_airdate) <= date('now', '${timezoneMod}') AND
          (
            (
              status == 'Ended' AND last_watched_date < date('now', '-3 month', '${timezoneMod}')
            )
            OR
            (
              status == 'Running' AND
              DateTime(next_episode_towatch_airdate) < date('now', '-3 month', '${timezoneMod}') AND
              last_watched_date < date('now', '-3 month', '${timezoneMod}')
            )
            OR abandoned == 1
          )
          ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset,
      );

      return results;
    } catch (dbError) {
      // Database connection error
      console.error('failed getShowsAbandoned', dbError);
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
      console.error('failed getTvshowsForCSVExport', dbError);
    }
    return undefined;
  };

  const getShow = async (id) => {
    try {
      const result = await db.get(`SELECT * from shows WHERE id = ?`, id);
      return result;
    } catch (dbError) {
      console.error('failed getShow', dbError);
    }
    return undefined;
  };

  const getEpisodes = async () => {
    try {
      const result = await db.all('SELECT episodes.* from episodes');
      return result;
    } catch (dbError) {
      console.error('failed getEpisodes', dbError);
    }
    return undefined;
  };

  const getEpisode = async (id) => {
    try {
      const result = await db.get('SELECT episodes.* from episodes WHERE episodes.id = ?', id);
      return result;
    } catch (dbError) {
      console.error('failed to getEpisode', id, dbError);
    }
    return undefined;
  };

  const getEpisodesByShowId = async (showId) => {
    try {
      const result = await db.all('SELECT episodes.* from episodes WHERE episodes.show_id = ? ORDER BY season, number ASC', showId);
      return result;
    } catch (dbError) {
      console.error('failed getEpisodesByShowId', dbError);
    }
    return undefined;
  };

  const getRecentEpisodesByShowId = async (showId) => {
    try {
      const result = await db.all(
        `SELECT episodes.* from episodes WHERE datetime(airstamp) > datetime(CURRENT_TIMESTAMP, '-1 year', '${timezoneMod}') AND episodes.show_id = ? ORDER BY season, number ASC`,
        showId,
      );
      return result;
    } catch (dbError) {
      console.error('failed getRecentEpisodesByShowId', dbError);
    }
    return undefined;
  };

  const updateEpisodeWatchStatus = async (id, status) => {
    try {
      await db.run(
        `UPDATE episodes SET watched_status = ?, watched_at = ${status === 'WATCHED' ? `DateTime('now', '${timezoneMod}')` : null} WHERE id = ?`,
        status,
        id,
      );

      return await db.get('SELECT * from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed updateEpisodeWatchStatus', dbError);
    }
    return undefined;
  };

  const updateEpisodeNote = async (id, note) => {
    try {
      await db.run(`UPDATE episodes SET note = ? WHERE id = ?`, note, id);

      return await db.get('SELECT * from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed updateEpisodeNote', dbError);
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
          $episodes_count: body.episodes_count,
          $aired_episodes_count: body.aired_episodes_count,
          $watched_episodes_count: body.watched_episodes_count,
          $last_watched_date: body.last_watched_date,
          $next_episode_towatch_airdate: body.next_episode_towatch_airdate,
          $abandoned: body.abandoned,
        },
      );
      return getShow(result.lastID);
    } catch (dbError) {
      console.error('failed createShow', dbError);
    }
    return undefined;
  };

  const updateShow = async (id, body) => {
    try {
      const keys = Object.keys(body);
      const data = keys.reduce((acc, val) => {
        acc[`$${val}`] = body[val];
        return acc;
      }, {});

      await db.run(
        `UPDATE shows SET
          ${keys.map((v) => `${v}=$${v}`).join(',')}, 
          updated_at=DateTime('now') 
          WHERE id = $id`,
        {
          $id: id,
          ...data,
        },
      );

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed updateShow', dbError);
    }
    return undefined;
  };

  const updateAllAiredCounts = async (updates) => {
    if (updates.length === 0) return;

    await db.run(`
      UPDATE  shows
      SET     aired_episodes_count = CASE id ${updates.map((u) => `WHEN ${u.id} THEN '${u.aired_episodes_count}' \n`).join(' ')}
        END
      WHERE   id IN (${updates.map((u) => `'${u.id}'`).join(', ')})
    `);
  };

  const updateShowNote = async (id, body) => {
    try {
      await db.run(`UPDATE shows SET note=$note WHERE id = $id`, {
        $id: id,
        $note: body.note,
      });

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed updateShowNote', dbError);
    }
    return undefined;
  };

  const updateShowImage = async (id, body) => {
    try {
      await db.run(`UPDATE shows SET image=$image WHERE id = $id`, {
        $id: id,
        $image: body.image,
      });

      return await db.get('SELECT * from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed updateShowImage', dbError);
    }
    return undefined;
  };

  const deleteShow = async (id) => {
    try {
      await db.run('DELETE from shows WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed deleteShow', dbError);
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

      return result.lastID;
    } catch (dbError) {
      console.error('failed createEpisode', body, dbError);
    }
    return undefined;
  };

  const createEpisodes = async (body) => {
    try {
      const keys = Object.keys(body[0]);

      const result = await db.run(
        `INSERT INTO episodes 
      (
        ${keys.join(',')}, created_at, updated_at
      ) 
      VALUES ${body.map((b, rowIndex) => `(${keys.map((v) => `$${v}${rowIndex}`).join(',')}, DateTime('now'), DateTime('now'))`).join(', ')}`,
        body
          .map((b, i) => ({
            [`$id${i}`]: b.id,
            [`$show_id${i}`]: b.show_id,
            [`$url${i}`]: b.url,
            [`$name${i}`]: b.name,
            [`$season${i}`]: b.season,
            [`$number${i}`]: b.number,
            [`$type${i}`]: b.type,
            [`$airdate${i}`]: b.airdate,
            [`$airtime${i}`]: b.airtime,
            [`$airstamp${i}`]: b.airstamp,
            [`$runtime${i}`]: b.runtime,
            [`$image${i}`]: b.image,
            [`$summary${i}`]: b.summary,
            [`$watched_status${i}`]: b.watched_status,
            [`$watched_at${i}`]: b.watched_at,
          }))
          .flat(),
      );

      return result;
    } catch (dbError) {
      console.error('failed to update', body, dbError);
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
      console.error('failed to update', id, body, dbError);
    }
    return undefined;
  };

  const deleteEpisode = async (id) => {
    try {
      await db.run('DELETE from episodes WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed deleteEpisode', dbError);
    }
  };

  const deleteEpisodesByShow = async (showId) => {
    try {
      await db.run('DELETE from episodes WHERE show_id = ?', showId);
    } catch (dbError) {
      console.error('failed deleteEpisodesByShow', dbError);
    }
  };

  const getNetworkPosts = async () => {
    try {
      const result = await db.all('SELECT * from comments WHERE resource_id IS NULL ORDER BY created_at DESC');

      return result;
    } catch (dbError) {
      console.error('failed getNetworkPosts', dbError);
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
      console.error('failed createComment', dbError);
    }
  };

  const deleteComment = async (resourceId) => {
    try {
      console.log('deleteComment', resourceId);
      return await db.run('DELETE FROM comments WHERE resource_id = ?', resourceId);
    } catch (dbError) {
      console.error('failed deleteComment', dbError);
    }
    return undefined;
  };

  const deleteCommentById = async (id) => {
    try {
      return await db.run('DELETE FROM comments WHERE id = ?', id);
    } catch (dbError) {
      console.error('failed deleteCommentById', dbError);
    }
    return undefined;
  };

  const toggleCommentVisibility = async (commentId) => {
    try {
      await db.run('UPDATE comments SET visible = ((visible | 1) - (visible & 1)) WHERE id = ?', commentId);
    } catch (dbError) {
      console.error('failed toggleCommentVisibility', dbError);
    }
  };

  const getAllComments = async (showEpisodeId) => {
    try {
      const results = await db.all('SELECT * FROM comments WHERE resource_id = ?', showEpisodeId);
      return results.map((c) => massageComment(c));
    } catch (dbError) {
      console.error('failed getAllComments', dbError);
    }
    return undefined;
  };

  const getVisibleComments = async (showEpisodeId) => {
    try {
      const results = await db.all('SELECT * FROM comments WHERE visible = 1 AND resource_id = ?', showEpisodeId);
      return results.map((c) => massageComment(c));
    } catch (dbError) {
      console.error('failed getVisibleComments', dbError);
    }
    return undefined;
  };

  const deleteHiddenComments = async (showEpisodeId) => {
    try {
      await db.run('DELETE FROM comments WHERE visible = 0 AND resource_id = ?', showEpisodeId);
    } catch (dbError) {
      console.error('failed deleteHiddenComments', dbError);
    }
  };

  const deleteAllShows = async () => {
    try {
      // Delete the shows
      await db.run('DELETE from shows');

      // Return empty array
      return [];
    } catch (dbError) {
      console.error('failed deleteAllShows', dbError);
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
      console.error('failed deleteAllEpisodes', dbError);
    }
    return undefined;
  };

  const getAllInProgressShows = async () => {
    try {
      return await db.all(`
        SELECT * FROM shows 
        WHERE status != 'Ended'
        AND DateTime(updated_at) <= DateTime('now', '-1 day')
        ORDER BY last_watched_date, updated_at DESC
      `);
    } catch (dbError) {
      console.error('failed getAllInProgressShows', dbError);
    }
    return undefined;
  };

  const getAllAiredEpisodesCountByShow = async () => {
    try {
      return await db.all(`
        SELECT shows.id, shows.name, shows.aired_episodes_count, count(CASE WHEN episodes.show_id == shows.id THEN 1 END ) as new_aired_episodes_count
        FROM shows
        LEFT JOIN episodes ON shows.id == episodes.show_id
        WHERE 
          shows.status != 'Ended' 
          AND episodes.number IS NOT NULL 
          AND episodes.airstamp IS NOT NULL 
          AND episodes.airstamp != '' 
          AND DateTime(episodes.airstamp) <= DateTime('now')
        GROUP BY shows.id
      `);
    } catch (dbError) {
      console.error('failed getAllAiredEpisodesCountByShow', dbError);
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
    getEpisodeCount,
    getShowCount,
    getShow,
    getShows,
    getShowsNotStarted,
    getShowsCompleted,
    getShowsUpToDate,
    getShowsToWatch,
    getShowsAbandoned,
    getTvshowsForCSVExport,
    getEpisodes,
    getEpisode,
    getEpisodesByShowId,
    getRecentEpisodesByShowId,
    updateEpisodeWatchStatus,
    updateEpisodeNote,
    createShow,
    updateShow,
    updateShowNote,
    updateShowImage,
    updateAllAiredCounts,
    deleteShow,
    createEpisode,
    createEpisodes,
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
    getAllAiredEpisodesCountByShow,
    getNetworkPosts,
    getWatchStats,
  };
}
