import fs from 'fs';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import packageJson from '../package.json';

dotenv.config();

export const dataDir = process.env.DATA_DIR || '.data';

export const data = {
  errorMessage: 'Whoops! Error connecting to the database–please try again!',
  setupMessage: "🚧 Whoops! Looks like the database isn't setup yet! 🚧",
};

let actorFileData:
  | {
      disabled: false;
      avatar: string;
      username: string;
      displayName: string;
      description: string;
    }
  | { disabled: true } = { disabled: true };

if (process.env.USERNAME && process.env.PUBLIC_BASE_URL) {
  const { AVATAR, USERNAME, DISPLAY_NAME, DESCRIPTION } = process.env;
  const username = USERNAME.slice(0, 1) === '@' ? USERNAME.slice(1) : USERNAME;
  actorFileData = {
    disabled: false,
    avatar: AVATAR || 'https://cdn.glitch.global/5aacd173-98f2-4f1f-83c1-d07815d82bf3/tvmarksLogo.png?v=1742129685337',
    username,
    displayName: DISPLAY_NAME || 'My Tvmarks',
    description: DESCRIPTION || 'An ActivityPub tv tracking and sharing site built with Tvmarks',
  };
} else {
  actorFileData = { disabled: true };
}

export const actorInfo = actorFileData;
export const account = actorInfo.disabled === false ? actorInfo.username : 'tvmarks';

export const domain = (() => {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL;
  }

  console.log("didn't find a PUBLIC_BASE_URL or PROJECT_DOMAIN in env, assuming localhost");
  return 'localhost';
})();

export const instanceType = packageJson.name || 'tvmarks';
export const instanceVersion = packageJson.version || 'undefined';

export function timeSince(ms: number) {
  const timestamp = new Date(ms);
  const now = new Date(new Date().toUTCString());
  const secondsPast = (now.getTime() - timestamp.getTime()) / 1000;
  if (secondsPast < 60) {
    return `${secondsPast}s ago`;
  }
  if (secondsPast < 3600) {
    return `${secondsPast / 60}m ago`;
  }
  if (secondsPast <= 86400) {
    return `${secondsPast / 3600}h ago`;
  }
  if (secondsPast > 86400) {
    const day = timestamp.getDate();
    const month = timestamp
      .toDateString()
      .match(/ [a-zA-Z]*/)[0]
      .replace(' ', '');
    const year = timestamp.getFullYear() === now.getFullYear() ? '' : ` ${timestamp.getFullYear()}`;
    return `${day} ${month}${year}`;
  }
  return undefined;
}

const getActualRequestDurationInMilliseconds = (start) => {
  const NS_PER_SEC = 1e9; //  convert to nanoseconds
  const NS_TO_MS = 1e6; // convert to milliseconds
  const diff = process.hrtime(start);
  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};

export function removeEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== ''));
}

export function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log('parseJSON', e);
    return null;
  }
}

// ActivityPub properties can be a bare URI or an object carrying one
export function uriOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { id, url, href } = value as Record<string, unknown>;
    return [id, url, href].find((v): v is string => typeof v === 'string');
  }
  return undefined;
}

// The URI of the post being quoted, whether the quote is declared on the
// activity or on the object it wraps
export function quoteTargetOf(activity: any): string | undefined {
  return [activity?.quoteUrl, activity?.quote, activity?.object?.quoteUrl, activity?.object?.quote].map(uriOf).find(Boolean);
}

// I like being able to refer to people like I would on Mastodon
// i.e. @username@instance.tld. But lots of activitypub stuff treats the
// identifier for an actor as the URL that represents their profile,
// i.e https://instance.tld/user/username.
// this function takes the two and tries to determine via some terrifying
// and brittle regex work if they're the same.
export function actorMatchesUsername(actor: string, username: string) {
  if (!username) {
    return false;
  }
  const result = username.match(/^@([^@]+)@(.+)$/);
  if (result?.length !== 3) {
    console.log(`match on ${username} isn't parseable. Blocks should be specified as @username@domain.tld.`);
    return false;
  }
  const actorAccount = result[1];
  const actorDomain = result[2];

  const actorResult = actor.match(/^https?:\/\/([^/]+)\/u(ser)?s?\/(.+)$/);
  if (actorResult?.length !== 4) {
    console.log(`found an unparseable actor: ${actor}. Report this to https://github.com/stefanhayden/tvmarks/issues !`);
  }

  return actorAccount === actorResult[3] && actorDomain === actorResult[1];
}

export function replaceEmptyText(currentValue: string, defaultValue: string) {
  if (!currentValue || currentValue?.trim().replace(/\n/g, '') === '') {
    return defaultValue;
  }
  return currentValue;
}

/**
 * Calculate the number of calendar days until an episode airs.
 * Returns 0 for episodes airing today, 1 for tomorrow, etc.
 * @param airstamp - The episode's air timestamp (ISO string)
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Number of days until the episode airs
 */
export function calculateDaysUntilAirDate(airdate: string, referenceDate?: Date): number {
  const today = referenceDate || new Date();
  const todayDateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  const episodeTime = new Date(airdate + 'T00:00:00Z').getTime();
  const todayTime = new Date(todayDateStr + 'T00:00:00Z').getTime();
  return Math.round((episodeTime - todayTime) / (24 * 60 * 60 * 1000));
}

// episodes with no airstamp are treated as not aired
export function isEpisodeAired(airstamp: string | null | undefined, referenceDate?: Date): boolean {
  if (!airstamp) return false;
  const airTime = new Date(airstamp).getTime();
  return !Number.isNaN(airTime) && airTime <= (referenceDate || new Date()).getTime();
}

// specials (no episode number) are not counted
export function countAiredEpisodes(episodes: { number?: number | null; airstamp?: string | null }[], referenceDate?: Date): number {
  return episodes.filter((ep) => ep.number !== null && isEpisodeAired(ep.airstamp, referenceDate)).length;
}

export function simpleLogger(req, res, next) {
  // middleware function
  const currentDatetime = new Date();
  const formattedDate = `${currentDatetime.getFullYear()}-${
    currentDatetime.getMonth() + 1
  }-${currentDatetime.getDate()} ${currentDatetime.getHours()}:${currentDatetime.getMinutes()}:${currentDatetime.getSeconds()}`;
  const { method } = req;
  const { url } = req;
  const status = res.statusCode;
  const start = process.hrtime();
  const durationInMilliseconds = getActualRequestDurationInMilliseconds(start);

  const log = `[${chalk.blue(formattedDate)}] ${method}:${url} ${status} ${chalk.red(`${durationInMilliseconds.toLocaleString()}ms`)}`;
  console.log(log);
  if (process.env.LOGGING_ENABLED === 'true') {
    fs.appendFile('request_logs.txt', `${log}\n`, (err) => {
      if (err) {
        console.log(err);
      }
    });
  }
  next();
}
