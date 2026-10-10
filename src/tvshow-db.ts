/**
 * Module handles database management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */

// Utilities we need
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { stripHtml } from 'string-strip-html';
import { timeSince, account, domain, dataDir } from './util';
import { createStreamingServiceMatcher, defaultStreamingServices, StreamingService, StreamingServiceSource } from './streaming-services';

export type Show = {
  id: number;
  tvrage_id: number;
  thetvdb_id: number;
  imdb_id: string;
  url: string;
  summary: string;
  name: string;
  type: string;
  language: string;
  status: 'Ended' | 'In Development' | 'Running' | 'To Be Determined';
  runtime: number;
  averageRuntime: number;
  premiered: string;
  ended: string;
  officialSite: string;
  network_name: string;
  network_country: string;
  network_country_code: string;
  network_country_timezone: string;
  image: string;
  note: string;
  episodes_count: number;
  aired_episodes_count: number;
  watched_episodes_count: number;
  last_watched_date: string | null;
  next_episode_towatch_airdate: string | null;
  last_watched_episode_id: number | null;
  abandoned: number | boolean; // 1 |  0 -- this is how the DB does true / false
  streaming_service?: string | null; // slug from the streaming_services table
  streaming_service_source?: StreamingServiceSource | null; // null until a service is guessed or the viewer decides
  created_at: string;
  updated_at: string;
};

type Episode = {
  id: number;
  show_id: number;
  url: string;
  name: string;
  season: number;
  number: number;
  type: string;
  airdate: string;
  airtime: string;
  airstamp: string;
  runtime: number;
  image: string;
  summary: string;
  note: string;
  created_at: string;
  updated_at: string;
  watched_at: string | null;
  watched_status: string;
};

type Comment = {
  id: number;
  name: string;
  url: string;
  content: string;
  created_at: string;
  visible: 0 | 1;
  resource_id: string;
};

const ACCOUNT_MENTION_REGEX = new RegExp(`^@${account}@${domain} `);

const timezone_offset = process.env.TIMEZONE_OFFSET || '+0';
const timezoneMod = `${timezone_offset} hour`;

let db: Database<sqlite3.Database, sqlite3.Statement> | undefined;

// for now, strip the HTML when we retrieve it from the DB, just so that we keep as much data as possible
// if we ultimately decide that we don't want to do something fancier with keeping bold, italics, etc but
// discarding Mastodon's presentational HTML tags, then we'll remove this and handle that at the time comments get stored
export function stripHtmlFromComment(comment) {
  return { ...comment, content: stripHtml(comment.content).result };
}

export function stripMentionFromComment(comment) {
  return {
    ...comment,
    content: comment.content.replace(ACCOUNT_MENTION_REGEX, ''),
  };
}

export function generateLinkedDisplayName(comment) {
  const match = comment.name.match(/^@([^@]+)@(.+)$/);
  return {
    linked_display_name: `<a href="http://${match[2]}/@${match[1]}">${match[1]}</a>`,
    ...comment,
  };
}



export function insertRelativeTimestamp(object) {
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

export function massageComment(comment) {
  return generateLinkedDisplayName(stripMentionFromComment(stripHtmlFromComment(insertRelativeTimestamp(comment))));
}

/*
  We're using the sqlite wrapper so that we can make async / await connections
  - https://www.npmjs.com/package/sqlite
  */
export const init = async (dbFile = `${dataDir}/tvshows.db`) => {
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
              streaming_service TEXT DEFAULT NULL,
              streaming_service_source TEXT DEFAULT NULL, -- "manual", "network"
              
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

        // databases created before streaming services were tracked
        const columns = await db.all<{ name: string }[]>('PRAGMA table_info(shows)');
        if (!columns.some((column) => column.name === 'streaming_service')) {
          await db.run('ALTER TABLE shows ADD COLUMN streaming_service TEXT DEFAULT NULL');
          console.log('Column shows.streaming_service added');
        }
        // databases created before guessed services were told apart from picked ones
        if (!columns.some((column) => column.name === 'streaming_service_source')) {
          await db.run('ALTER TABLE shows ADD COLUMN streaming_service_source TEXT DEFAULT NULL');
          await db.run(`UPDATE shows SET streaming_service_source = 'manual' WHERE streaming_service IS NOT NULL`);
          console.log('Column shows.streaming_service_source added');
        }
      }

      // reminders that a streaming service is no longer in use, kept until dismissed
      await db.run(
        `CREATE TABLE IF NOT EXISTS subscription_notices (
            service TEXT PRIMARY KEY,
            show_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );`,
      );

      // the services a show can be assigned, the built in ones plus any added from the admin page
      await db.run(
        `CREATE TABLE IF NOT EXISTS streaming_services (
            slug TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT,
            text_color TEXT,
            builtin BOOLEAN DEFAULT 0,
            shows_count INTEGER DEFAULT 0 -- cached, see refreshStreamingServiceCounts
          );`,
      );
      // A built in service that has since been dropped from the defaults goes away if no show uses it.
      // One still in use becomes a custom service, so it can be removed from the admin page.
      const builtinSlugs = defaultStreamingServices.map(() => '?').join(',');
      await db.run(
        `DELETE FROM streaming_services
          WHERE builtin = 1 AND slug NOT IN (${builtinSlugs})
            AND NOT EXISTS (SELECT 1 FROM shows WHERE shows.streaming_service = streaming_services.slug)`,
        ...defaultStreamingServices.map((service) => service.slug),
      );
      await db.run(
        `UPDATE streaming_services SET builtin = 0 WHERE builtin = 1 AND slug NOT IN (${builtinSlugs})`,
        ...defaultStreamingServices.map((service) => service.slug),
      );
      for (const service of defaultStreamingServices) {
        await db.run(
          `INSERT OR IGNORE INTO streaming_services (slug, name, color, text_color, builtin) VALUES (?, ?, ?, ?, 1)`,
          service.slug,
          service.name,
          service.color,
          service.textColor,
        );
      }
      // cheap, and picks up shows that predate guessing as well as newly added services and aliases
      await guessStreamingServices();
      await refreshStreamingServiceCounts();

      // return db;
    } catch (dbError) {
      console.error('failed init', dbError);
    }
  });
};

export const getShowCount = async () => {
  const result = await db.get<{ count: number }>('SELECT count(id) as count FROM shows');
  return result?.count;
};

export const getShows = async (limit = 10, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    // const subQueryFilter = `episodes.show_id = shows.id AND episodes.number IS NOT NULL`;
    const results = await db.all<Show[]>(`select * from shows ORDER BY updated_at DESC LIMIT ? OFFSET ?`, limit, offset);
    return results;
  } catch (dbError) {
    // Database connection error
    console.error('failed getShows', dbError);
  }
  return undefined;
};

export const getShowsNotStarted = async (limit = 24, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    const results = await db.all<Show[]>(
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

export const getShowsCompleted = async (limit = 24, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    const results = await db.all<Show[]>(
      `SELECT * from shows
        WHERE aired_episodes_count <= watched_episodes_count
        AND watched_episodes_count > 0
        AND status == 'Ended'
        AND abandoned != 1
        ORDER BY last_watched_date DESC LIMIT ? OFFSET ?`,
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

// shared so "in progress" below always agrees with the homepage categories
const showsToWatchCondition = `
            shows.abandoned != 1 AND
            shows.watched_episodes_count > 0 AND
            shows.aired_episodes_count > shows.watched_episodes_count AND
            (
              DateTime(shows.next_episode_towatch_airdate) > date('now', '-3 month', '${timezoneMod}') OR
              shows.last_watched_date > date('now', '-3 month', '${timezoneMod}')
            )`;

const showsUpToDateCondition = `
          (
            (DateTime(shows.next_episode_towatch_airdate) > DateTime('now', '${timezoneMod}') AND shows.aired_episodes_count == shows.watched_episodes_count)
            OR
            shows.aired_episodes_count <= shows.watched_episodes_count
          )
          AND shows.watched_episodes_count != 0
          AND shows.status IS NOT 'Ended'
          AND shows.abandoned != 1`;

export const getShowsToWatch = async (limit = 24, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    const results = await db.all<Show[]>(
      `select *
        from shows
          WHERE ${showsToWatchCondition}
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

export const getShowsUpToDate = async (limit = 24, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    const results = await db.all<Show[]>(
      `SELECT *
          from shows
        WHERE ${showsUpToDateCondition}
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

export const getShowsAbandoned = async (limit = 24, offset = 0) => {
  // We use a try catch block in case of db errors
  try {
    const results = await db.all<Show[]>(
      `select * from shows
          WHERE
            watched_episodes_count > 0 AND
            (
              abandoned == 1
              OR
              (
                aired_episodes_count > watched_episodes_count AND
                (last_watched_date IS NULL OR last_watched_date < date('now', '-3 month', '${timezoneMod}')) AND
                (next_episode_towatch_airdate IS NULL OR DateTime(next_episode_towatch_airdate) < date('now', '-3 month', '${timezoneMod}'))
              )
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

export const getTvshowsForCSVExport = async () => {
  // We use a try catch block in case of db errors
  try {
    const headers = ['name', 'url', 'note', 'status', 'premiered', 'ended', 'episodes_count', 'watched_episodes_count', 'created_at', 'updated_at'];
    const selectHeaders = headers.join(',');
    // This will create an object where the keys and values match. This will
    // allow the csv stringifier to interpret this as a header row.
    const columnTitles = Object.fromEntries(headers.map((header) => [header, header]));
    const results = await db.all(`SELECT ${selectHeaders} from shows`);
    return [columnTitles].concat(results);
  } catch (dbError) {
    // Database connection error
    console.error('failed getTvshowsForCSVExport', dbError);
  }
  return [];
};

export const getShow = async (id) => {
  try {
    const result = await db.get<Show>(`SELECT * from shows WHERE id = ?`, id);
    return result;
  } catch (dbError) {
    console.error('failed getShow', dbError);
  }
  return undefined;
};

export const getEpisodes = async () => {
  try {
    const result = await db.all<Episode[]>('SELECT episodes.* from episodes');
    return result;
  } catch (dbError) {
    console.error('failed getEpisodes', dbError);
  }
  return undefined;
};

export const getEpisode = async (id) => {
  try {
    const result = await db.get<Episode>('SELECT episodes.* from episodes WHERE episodes.id = ?', id);
    return result;
  } catch (dbError) {
    console.error('failed to getEpisode', id, dbError);
  }
  return undefined;
};

export const getEpisodesByShowId = async (showId) => {
  try {
    const result = await db.all<Episode[]>('SELECT episodes.* from episodes WHERE episodes.show_id = ? ORDER BY season, number ASC', showId);
    return result;
  } catch (dbError) {
    console.error('failed getEpisodesByShowId', dbError);
  }
  return undefined;
};

export const getRecentEpisodesByShowId = async (showId) => {
  try {
    const result = await db.all<Episode[]>(
      `SELECT episodes.* from episodes WHERE datetime(airstamp) > datetime(CURRENT_TIMESTAMP, '-3 year', '${timezoneMod}') AND episodes.show_id = ? ORDER BY season, number ASC`,
      showId,
    );
    return result;
  } catch (dbError) {
    console.error('failed getRecentEpisodesByShowId', dbError);
  }
  return undefined;
};

export const getUpcomingEpisodes = async (limit = 24, offset = 0, includeAbandoned = false) => {
  try {
    const result = await db.all(
      `SELECT
        episodes.*,
        shows.name as show_name,
        shows.image as show_image,
        shows.abandoned as show_abandoned
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE
        episodes.airstamp IS NOT NULL
        AND episodes.airstamp != ''
        AND DateTime(episodes.airstamp) > DateTime('now')
        ${includeAbandoned ? '' : 'AND shows.abandoned IS NOT 1'}
      ORDER BY episodes.airstamp ASC
      LIMIT ? OFFSET ?`,
      limit,
      offset,
    );
    return result;
  } catch (dbError) {
    console.error('failed getUpcomingEpisodes', dbError);
  }
  return undefined;
};

// how far ahead a scheduled episode still counts as something to watch
export const WATCH_SOON_DAYS = 30;
const watchSoonCondition = `
        episodes.number IS NOT NULL
        AND episodes.watched_status IS NOT 'WATCHED'
        AND episodes.airstamp IS NOT NULL
        AND episodes.airstamp != ''
        AND DateTime(episodes.airstamp) <= DateTime('now', '+${WATCH_SOON_DAYS} day')`;

// Shows that are keeping a streaming service in use: in Watch Next or Up To Date, and part way through a season.
// Part way through means the season of the furthest watched episode has a later episode to watch soon,
// so a season that hasn't been started and episodes that were skipped don't count.
export const getShowIdsInProgress = async (service?: string) => {
  try {
    const result = await db.all<{ show_id: number }[]>(
      `SELECT DISTINCT episodes.show_id FROM episodes
      INNER JOIN shows ON shows.id = episodes.show_id
      INNER JOIN episodes last_watched ON last_watched.id = shows.last_watched_episode_id
      WHERE
        episodes.season = last_watched.season
        AND episodes.number > last_watched.number
        AND ${watchSoonCondition}
        AND ((${showsToWatchCondition}) OR (${showsUpToDateCondition}))
        AND ($service IS NULL OR shows.streaming_service = $service)`,
      { $service: service ?? null },
    );
    return result.map((row) => row.show_id);
  } catch (dbError) {
    console.error('failed getShowIdsInProgress', dbError);
  }
  return undefined;
};

// unwatched episodes of a show, in any season, that have aired or will air soon
export const getEpisodesToWatchSoonCount = async (showId: string | number) => {
  try {
    const result = await db.get<{ count: number }>(`SELECT count(id) as count FROM episodes WHERE show_id = ? AND ${watchSoonCondition}`, showId);
    return result.count;
  } catch (dbError) {
    console.error('failed getEpisodesToWatchSoonCount', dbError);
  }
  return undefined;
};

export type StoredStreamingService = StreamingService & { builtin: number; shows_count: number };

const streamingServiceColumns = 'slug, name, color, text_color as textColor, builtin, shows_count';

// "None" first, then the services used by the most shows
export const getStreamingServices = async () => {
  try {
    return await db.all<StoredStreamingService[]>(
      `SELECT ${streamingServiceColumns} FROM streaming_services ORDER BY slug = 'none' DESC, shows_count DESC, rowid ASC`,
    );
  } catch (dbError) {
    console.error('failed getStreamingServices', dbError);
  }
  return undefined;
};

export const getStreamingService = async (slug?: string | null) => {
  if (!slug) return undefined;
  try {
    return await db.get<StoredStreamingService>(`SELECT ${streamingServiceColumns} FROM streaming_services WHERE slug = ?`, slug);
  } catch (dbError) {
    console.error('failed getStreamingService', dbError);
  }
  return undefined;
};

export const createStreamingService = async (service: StreamingService) => {
  try {
    await db.run(
      `INSERT INTO streaming_services (slug, name, color, text_color, builtin) VALUES (?, ?, ?, ?, 0)`,
      service.slug,
      service.name,
      service.color,
      service.textColor,
    );
    // shows on a network of this name can now be matched
    await guessStreamingServices();
    return await getStreamingService(service.slug);
  } catch (dbError) {
    console.error('failed createStreamingService', dbError);
  }
  return undefined;
};

// only services added from the admin page can be removed, their shows go back to being guessed from the network
export const deleteStreamingService = async (slug: string) => {
  try {
    const result = await db.run(`DELETE FROM streaming_services WHERE slug = ? AND builtin = 0`, slug);
    if (!result.changes) return false;
    await db.run(`UPDATE shows SET streaming_service = NULL, streaming_service_source = NULL WHERE streaming_service = ?`, slug);
    await guessStreamingServices();
    await db.run(`DELETE FROM subscription_notices WHERE service = ?`, slug);
    return true;
  } catch (dbError) {
    console.error('failed deleteStreamingService', dbError);
  }
  return false;
};

// shows_count is a cache of how many shows use each service, so the picker can sort without counting every time
export const refreshStreamingServiceCounts = async (slugs?: (string | null | undefined)[]) => {
  try {
    const only = slugs?.filter(Boolean);
    if (only && only.length === 0) return;
    await db.run(
      `UPDATE streaming_services
        SET shows_count = (SELECT count(id) FROM shows WHERE shows.streaming_service = streaming_services.slug)
        ${only ? `WHERE slug IN (${only.map(() => '?').join(',')})` : ''}`,
      ...(only || []),
    );
  } catch (dbError) {
    console.error('failed refreshStreamingServiceCounts', dbError);
  }
};

// The viewer's own choice, which a guess never replaces.
// Without a service the show goes back to being guessed from its network; "None" is the choice for having no service.
export const setShowStreamingService = async (showId: string | number, slug: string | null) => {
  try {
    const previous = await db.get<Pick<Show, 'streaming_service' | 'network_name'>>(`SELECT streaming_service, network_name FROM shows WHERE id = ?`, showId);
    if (!previous) return;

    let service = slug;
    if (!slug) {
      const services = await getStreamingServices();
      if (!services) return;
      service = createStreamingServiceMatcher(services)(previous.network_name)?.slug || null;
    }
    const source: StreamingServiceSource | null = slug ? 'manual' : service ? 'network' : null;
    await db.run(`UPDATE shows SET streaming_service = ?, streaming_service_source = ? WHERE id = ?`, service, source, showId);
    await refreshStreamingServiceCounts([previous.streaming_service, service]);
  } catch (dbError) {
    console.error('failed setShowStreamingService', dbError);
  }
};

// only an earlier guess or no service at all can be replaced by a guess, never the viewer's own choice.
// A service with no source was stored before guesses were tracked, so it is the viewer's too.
const guessableCondition = `(streaming_service_source = 'network' OR (streaming_service IS NULL AND streaming_service_source IS NULL))`;

// Guesses the streaming service from the network for every show the viewer hasn't decided on, or for just one show.
// A guessed service is treated like any other from then on, and follows the network if that changes.
// createShow and updateShow call this when they write a network, so it only needs calling when the services change.
const guessStreamingServices = async (showId?: string | number) => {
  try {
    const services = await getStreamingServices();
    // without the services every guess would look like it no longer matches
    if (!services) return;
    const match = createStreamingServiceMatcher(services);

    const shows = await db.all<Pick<Show, 'id' | 'network_name' | 'streaming_service'>[]>(
      // a show without a network keeps what it has, the provider leaving the network out isn't a reason to drop a guess
      `SELECT id, network_name, streaming_service FROM shows
        WHERE ${guessableCondition} AND network_name IS NOT NULL AND network_name != '' AND ($id IS NULL OR id = $id)`,
      { $id: showId ?? null },
    );
    const changes = shows
      .map((show) => ({ id: show.id, from: show.streaming_service || null, to: match(show.network_name)?.slug || null }))
      .filter((change) => change.from !== change.to);

    // one statement per batch, so there is no transaction left open on the shared connection
    // 5 parameters per change, kept under the 999 that older SQLite builds allow
    for (let i = 0; i < changes.length; i += 150) {
      const batch = changes.slice(i, i + 150);
      await db.run(
        `UPDATE shows SET
            streaming_service = CASE id ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END,
            streaming_service_source = CASE id ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END
          WHERE id IN (${batch.map(() => '?').join(',')}) AND ${guessableCondition}`,
        ...batch.flatMap((change) => [change.id, change.to]),
        ...batch.flatMap((change) => [change.id, change.to ? 'network' : null]),
        ...batch.map((change) => change.id),
      );
    }
    if (changes.length > 0) await refreshStreamingServiceCounts(changes.flatMap((change) => [change.from, change.to]));
  } catch (dbError) {
    console.error('failed guessStreamingServices', dbError);
  }
};

// Services of shows watched in the last three months and not flagged abandoned.
// Three months is the same window after which the homepage treats an unfinished show as abandoned.
export const getRecentlyUsedServices = async () => {
  try {
    const result = await db.all<{ streaming_service: string }[]>(
      `SELECT DISTINCT streaming_service FROM shows
        WHERE streaming_service IS NOT NULL
          AND abandoned IS NOT 1
          AND last_watched_date > date('now', '-3 month', '${timezoneMod}')`,
    );
    return result.map((row) => row.streaming_service);
  } catch (dbError) {
    console.error('failed getRecentlyUsedServices', dbError);
  }
  return undefined;
};

export const getSubscriptionNotices = async () => {
  try {
    return await db.all<{ service: string; show_id: number; show_name: string | null; created_at: string }[]>(
      `SELECT subscription_notices.*, shows.name as show_name
        FROM subscription_notices
        LEFT JOIN shows ON shows.id = subscription_notices.show_id
        ORDER BY subscription_notices.created_at DESC`,
    );
  } catch (dbError) {
    console.error('failed getSubscriptionNotices', dbError);
  }
  return undefined;
};

export const setSubscriptionNotice = async (service: string, showId: number) => {
  try {
    await db.run(`INSERT OR REPLACE INTO subscription_notices (service, show_id) VALUES (?, ?)`, service, showId);
  } catch (dbError) {
    console.error('failed setSubscriptionNotice', dbError);
  }
};

export const deleteSubscriptionNotice = async (service: string) => {
  try {
    await db.run(`DELETE FROM subscription_notices WHERE service = ?`, service);
  } catch (dbError) {
    console.error('failed deleteSubscriptionNotice', dbError);
  }
};

export const getRecentlyWatchedEpisodes = async (limit = 24, offset = 0) => {
  try {
    const result = await db.all(
      `SELECT
        episodes.*,
        shows.name as show_name,
        shows.image as show_image
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE
        episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
      ORDER BY episodes.watched_at DESC
      LIMIT ? OFFSET ?`,
      limit,
      offset,
    );
    return result;
  } catch (dbError) {
    console.error('failed getRecentlyWatchedEpisodes', dbError);
  }
  return undefined;
};

export const updateEpisodeWatchStatus = async (id: number | string, status: 'WATCHED' | null) => {
  try {
    await db.run(
      `UPDATE episodes SET watched_status = ?, watched_at = ${status === 'WATCHED' ? `DateTime('now', '${timezoneMod}')` : null} WHERE id = ?`,
      status,
      id,
    );

    return await db.get<Episode>('SELECT * from episodes WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed updateEpisodeWatchStatus', dbError);
  }
  return undefined;
};

export const updateEpisodeNote = async (id: string, note: string) => {
  try {
    await db.run(`UPDATE episodes SET note = ? WHERE id = ?`, note, id);

    return await db.get<Episode>('SELECT * from episodes WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed updateEpisodeNote', dbError);
  }
  return undefined;
};

export const createShow = async (body: Omit<Show, 'last_watched_episode_id' | 'created_at' | 'updated_at'>) => {
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
    if (body.network_name) await guessStreamingServices(result.lastID);
    return getShow(result.lastID);
  } catch (dbError) {
    console.error('failed createShow', dbError);
  }
  return undefined;
};

export const updateShow = async (id: string, body: Partial<Show>) => {
  try {
    const keys = Object.keys(body);
    const data = keys.reduce((acc, val) => {
      acc[`$${val}`] = body[val];
      return acc;
    }, {});

    const writesNetwork = 'network_name' in body;
    const previous = writesNetwork ? await db.get<Pick<Show, 'network_name'>>('SELECT network_name from shows WHERE id = ?', id) : undefined;

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
    // the guessed streaming service follows the network
    if (writesNetwork && (previous?.network_name || null) !== (body.network_name || null)) await guessStreamingServices(id);

    return await db.get<Show>('SELECT * from shows WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed updateShow', dbError);
  }
  return undefined;
};

export const updateAllAiredCounts = async (updates: Pick<Show, 'id' | 'aired_episodes_count'>[]) => {
  if (updates.length === 0) return;

  await db.run(`
      UPDATE  shows
      SET     aired_episodes_count = CASE id ${updates.map((u) => `WHEN ${u.id} THEN '${u.aired_episodes_count}' \n`).join(' ')}
        END
      WHERE   id IN (${updates.map((u) => `'${u.id}'`).join(', ')})
    `);
};

export const updateShowNote = async (id: string, body: Pick<Show, 'note'>) => {
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

export const updateShowImage = async (id: string, body: Pick<Show, 'image'>) => {
  try {
    await db.run(`UPDATE shows SET image=$image WHERE id = $id`, {
      $id: id,
      $image: body.image,
    });

    return await db.get<Show>('SELECT * from shows WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed updateShowImage', dbError);
  }
  return undefined;
};

export const deleteShow = async (id: string) => {
  try {
    await db.run('DELETE from shows WHERE id = ?', id);
    await refreshStreamingServiceCounts();
  } catch (dbError) {
    console.error('failed deleteShow', dbError);
  }
};

export const createEpisode = async (body: Omit<Episode, 'note' | 'created_at' | 'updated_at'>) => {
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

export const createEpisodes = async (body: Episode[]) => {
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

export const updateEpisode = async (id, body) => {
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

    return await db.get<Show>('SELECT * from shows WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed to update', id, body, dbError);
  }
  return undefined;
};

export const deleteEpisode = async (id) => {
  try {
    await db.run('DELETE from episodes WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed deleteEpisode', dbError);
  }
};

export const deleteEpisodesByShow = async (showId) => {
  try {
    await db.run('DELETE from episodes WHERE show_id = ?', showId);
  } catch (dbError) {
    console.error('failed deleteEpisodesByShow', dbError);
  }
};

export const getNetworkPosts = async () => {
  try {
    const result = await db.all('SELECT * from comments WHERE resource_id IS NULL ORDER BY created_at DESC');

    return result;
  } catch (dbError) {
    console.error('failed getNetworkPosts', dbError);
  }
  return undefined;
};

export const createComment = async (showEpisodeId, name, url, content, visible = 0) => {
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

export const deleteComment = async (resourceId) => {
  try {
    console.log('deleteComment', resourceId);
    return await db.run('DELETE FROM comments WHERE resource_id = ?', resourceId);
  } catch (dbError) {
    console.error('failed deleteComment', dbError);
  }
  return undefined;
};

export const deleteCommentById = async (id) => {
  try {
    return await db.run('DELETE FROM comments WHERE id = ?', id);
  } catch (dbError) {
    console.error('failed deleteCommentById', dbError);
  }
  return undefined;
};

export const toggleCommentVisibility = async (commentId) => {
  try {
    await db.run('UPDATE comments SET visible = ((visible | 1) - (visible & 1)) WHERE id = ?', commentId);
  } catch (dbError) {
    console.error('failed toggleCommentVisibility', dbError);
  }
};

export const getAllComments = async (showEpisodeId) => {
  try {
    const results = await db.all<Comment[]>('SELECT * FROM comments WHERE resource_id = ?', showEpisodeId);
    return results.map((c) => massageComment(c));
  } catch (dbError) {
    console.error('failed getAllComments', dbError);
  }
  return undefined;
};

export const getVisibleComments = async (showEpisodeId) => {
  try {
    const results = await db.all<Comment[]>('SELECT * FROM comments WHERE visible = 1 AND resource_id = ?', showEpisodeId);
    return results.map((c) => massageComment(c));
  } catch (dbError) {
    console.error('failed getVisibleComments', dbError);
  }
  return undefined;
};

export const deleteHiddenComments = async (showEpisodeId) => {
  try {
    await db.run('DELETE FROM comments WHERE visible = 0 AND resource_id = ?', showEpisodeId);
  } catch (dbError) {
    console.error('failed deleteHiddenComments', dbError);
  }
};

export const deleteAllShows = async () => {
  try {
    // Delete the shows
    await db.run('DELETE from shows');
    await refreshStreamingServiceCounts();

    // Return empty array
    return [];
  } catch (dbError) {
    console.error('failed deleteAllShows', dbError);
  }
  return undefined;
};

export const deleteAllEpisodes = async () => {
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

export const getAllInProgressShows = async () => {
  try {
    return await db.all(`
        SELECT * FROM shows 
        WHERE status IS NOT 'Ended'
        AND DateTime(updated_at) <= DateTime('now', '-4 hour')
        ORDER BY last_watched_date, updated_at DESC
      `);
  } catch (dbError) {
    console.error('failed getAllInProgressShows', dbError);
  }
  return undefined;
};

export const getAllShows = async () => {
  try {
    return await db.all(`
        SELECT * FROM shows 
        ORDER BY last_watched_date, updated_at DESC
      `);
  } catch (dbError) {
    console.error('failed getAllShows', dbError);
  }
  return undefined;
};

export const getAllAiredEpisodesCountByShow = async () => {
  try {
    return await db.all(`
        SELECT shows.id, shows.name, shows.aired_episodes_count, count(CASE WHEN episodes.show_id == shows.id THEN 1 END ) as new_aired_episodes_count
        FROM shows
        LEFT JOIN episodes ON shows.id == episodes.show_id
        WHERE
          episodes.number IS NOT NULL
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

export const getWatchedYears = async () => {
  try {
    const rows = await db.all<{ year: string }[]>(`
      SELECT DISTINCT strftime('%Y', watched_at) as year
      FROM episodes
      WHERE watched_status = 'WATCHED' AND watched_at IS NOT NULL
      ORDER BY year ASC
    `);
    return rows.map((r) => Number(r.year));
  } catch (dbError) {
    console.error('failed getWatchedYears', dbError);
  }
  return [];
};

export const getStats = async (year: number) => {
  const y = String(year);
  try {
    const yearSummary = await db.get(`
      SELECT
        COUNT(*) as episodes_watched,
        SUM(COALESCE(runtime, 0)) as minutes_watched,
        COUNT(DISTINCT show_id) as shows_watched
      FROM episodes
      WHERE watched_status = 'WATCHED'
        AND watched_at IS NOT NULL
        AND strftime('%Y', watched_at) = ?
    `, y);

    const byMonth = await db.all(`
      SELECT
        CAST(strftime('%m', watched_at) AS INTEGER) as month_num,
        COUNT(*) as episodes,
        SUM(COALESCE(runtime, 0)) as minutes
      FROM episodes
      WHERE watched_status = 'WATCHED'
        AND watched_at IS NOT NULL
        AND strftime('%Y', watched_at) = ?
      GROUP BY month_num
      ORDER BY month_num
    `, y);

    const topShows = await db.all(`
      SELECT
        shows.id, shows.name, shows.image,
        COUNT(*) as episodes_watched,
        SUM(COALESCE(episodes.runtime, 0)) as minutes_watched
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
        AND strftime('%Y', episodes.watched_at) = ?
      GROUP BY shows.id
      ORDER BY episodes_watched DESC
      LIMIT 20
    `, y);

    const byNetwork = await db.all(`
      SELECT shows.network_name, COUNT(DISTINCT shows.id) as shows_count, COUNT(episodes.id) as episodes_count
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
        AND strftime('%Y', episodes.watched_at) = ?
        AND shows.network_name IS NOT NULL AND shows.network_name != ''
      GROUP BY shows.network_name
      ORDER BY episodes_count DESC
      LIMIT 10
    `, y);

    const byType = await db.all(`
      SELECT shows.type, COUNT(DISTINCT shows.id) as shows_count, COUNT(episodes.id) as episodes_count
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
        AND strftime('%Y', episodes.watched_at) = ?
        AND shows.type IS NOT NULL AND shows.type != ''
      GROUP BY shows.type
      ORDER BY episodes_count DESC
    `, y);

    const byDecade = await db.all(`
      SELECT
        (CAST(strftime('%Y', shows.premiered) AS INTEGER) / 10) * 10 as decade,
        COUNT(DISTINCT shows.id) as shows_count,
        COUNT(episodes.id) as episodes_count
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      WHERE episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
        AND strftime('%Y', episodes.watched_at) = ?
        AND shows.premiered IS NOT NULL AND shows.premiered != ''
      GROUP BY decade
      ORDER BY decade DESC
    `, y);

    const byDay = await db.all(`
      SELECT
        strftime('%Y-%m-%d', watched_at) as day,
        COUNT(*) as episodes
      FROM episodes
      WHERE watched_status = 'WATCHED'
        AND watched_at IS NOT NULL
        AND strftime('%Y', watched_at) = ?
      GROUP BY day
      ORDER BY day
    `, y);

    // by the service each show is on today, shows without one are grouped under a null slug
    const byService = await db.all<
      { slug: string | null; name: string | null; color: string | null; textColor: string | null; shows_count: number; episodes_count: number; minutes: number }[]
    >(`
      SELECT
        streaming_services.slug, streaming_services.name, streaming_services.color, streaming_services.text_color as textColor,
        COUNT(DISTINCT shows.id) as shows_count,
        COUNT(episodes.id) as episodes_count,
        SUM(COALESCE(episodes.runtime, 0)) as minutes
      FROM episodes
      INNER JOIN shows ON episodes.show_id = shows.id
      LEFT JOIN streaming_services ON streaming_services.slug = shows.streaming_service
      WHERE episodes.watched_status = 'WATCHED'
        AND episodes.watched_at IS NOT NULL
        AND strftime('%Y', episodes.watched_at) = ?
      GROUP BY streaming_services.slug
      ORDER BY streaming_services.slug IS NULL, episodes_count DESC
    `, y);

    return { yearSummary, byMonth, topShows, byNetwork, byType, byDecade, byDay, byService };
  } catch (dbError) {
    console.error('failed getStats', dbError);
  }
  return undefined;
};

export const searchShowsByName = async (query: string) => {
  try {
    const results = await db.all<Show[]>(
      `SELECT * FROM shows WHERE name LIKE ? ORDER BY name ASC`,
      `%${query}%`
    );
    return results;
  } catch (dbError) {
    console.error('failed searchShowsByName', dbError);
  }
  return [];
};
