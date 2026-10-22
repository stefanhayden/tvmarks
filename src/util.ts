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

export const configuredTimezoneOffset = () => Number(process.env.TIMEZONE_OFFSET) || 0;

// YYYY-MM-DD of the given instant in the configured timezone (TIMEZONE_OFFSET hours from UTC)
export function localDateString(date: Date, timezoneOffset = configuredTimezoneOffset()): string {
  return new Date(date.getTime() + timezoneOffset * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Calculate the number of calendar days until an episode airs.
 * Returns 0 for episodes airing today, 1 for tomorrow, etc.
 * @param airdate - The episode's air date (YYYY-MM-DD)
 * @param referenceDate - Optional reference date (defaults to now)
 * @param timezoneOffset - Hours from UTC used to decide what "today" is (defaults to TIMEZONE_OFFSET)
 * @returns Number of days until the episode airs
 */
export function calculateDaysUntilAirDate(airdate: string, referenceDate?: Date, timezoneOffset?: number): number {
  const todayDateStr = localDateString(referenceDate || new Date(), timezoneOffset);
  const episodeTime = new Date(airdate + 'T00:00:00Z').getTime();
  const todayTime = new Date(todayDateStr + 'T00:00:00Z').getTime();
  return Math.round((episodeTime - todayTime) / (24 * 60 * 60 * 1000));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '';
  // a bare YYYY-MM-DD is parsed as UTC midnight, which can land on the previous day in local time
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const date = new Date(dateOnly ? `${dateString}T00:00:00` : dateString);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  // impossible dates like 02-31 would otherwise roll over into the next month
  if (dateOnly && day !== Number(dateString.slice(8))) return '';
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
  return `${MONTHS[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
}

// "Jan 22, 2027", short enough for a badge
export function formatShortDate(dateString: string | null | undefined): string {
  const date = formatDate(dateString);
  if (!date) return '';
  const [month, day, year] = date.split(' ');
  return `${month.slice(0, 3)} ${parseInt(day, 10)}, ${year}`;
}

// "2005 – 2013", "2019 – now" while it's still running, or just the year
export function yearRange(premiered?: string | null, ended?: string | null, status?: string | null): string {
  const start = premiered?.slice(0, 4);
  const end = ended?.slice(0, 4);
  if (!start) return '';
  if (end) return end === start ? start : `${start} – ${end}`;
  return status === 'Running' ? `${start} – now` : start;
}

// one word as a hashtag holds it: what isn't a letter, combining mark, number or _ taken out, and not starting with a mark
export const cleanHashtag = (word: string) =>
  String(word || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_]/gu, '')
    .replace(/^\p{M}+/u, '');

// hashtags typed as "#scifi #rewatch" or "scifi, rewatch", cleaned to what Mastodon accepts: letters with their combining
// marks (the vowel signs of हिन्दी, an accent typed separately), numbers and _, not only numbers. Repeats are dropped whatever
// their case, keeping the first spelling
export function parseHashtags(input: string | null | undefined): string[] {
  const seen = new Set<string>();
  return String(input || '')
    .split(/[\s,]+/)
    .map(cleanHashtag)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || /^\p{N}+$/u.test(tag) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// TVMaze's genres, and its show types that say something about a show, to suggest as hashtags for a show being added.
// "Scripted" and the like describe most shows so aren't worth a tag
const TAGGED_SHOW_TYPES = ['Animation', 'Documentary', 'Reality'];
export function suggestedHashtags(genres: string[] | null | undefined, type?: string | null): string[] {
  return parseHashtags([...(genres || []), ...(TAGGED_SHOW_TYPES.includes(type) ? [type] : [])].join(' '));
}

// hashtags are stored as words separated by spaces, without the #, so parseHashtags reads them back
export const storedHashtags = (tags: string[]): string | null => (tags.length ? tags.join(' ') : null);
export const hasHashtag = (stored: string | null | undefined, tag: string) =>
  parseHashtags(stored).some((t) => t.toLowerCase() === tag.toLowerCase());

// "#scifi #rewatch", for a field to edit them in
export const hashtagText = (tags: string[]) => tags.map((tag) => `#${tag}`).join(' ');

// an episode's post carries its show's hashtags and its own
export const episodeHashtags = (show: { tags?: string | null }, episode: { tags?: string | null }) =>
  parseHashtags(`${show.tags || ''} ${episode.tags || ''}`);

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

// one entry per show per air day, so a show dropping several episodes at once reads as one card. a group sits
// where its first episode was, and its episodes keep their order
export function groupEpisodesByShowAndDay<T extends { show_id: number; airs_on: string }>(episodes: T[]): { first: T; episodes: T[] }[] {
  const groups = new Map<string, { first: T; episodes: T[] }>();
  for (const episode of episodes) {
    const key = `${episode.show_id}|${episode.airs_on}`;
    const group = groups.get(key);
    if (group) group.episodes.push(episode);
    else groups.set(key, { first: episode, episodes: [episode] });
  }
  return [...groups.values()];
}

// "S2 | E1 – E8" for a run of episodes, specials (no number) only show their season
export function episodeRange(episodes: { season: number; number?: number | null }[]): string {
  const label = (ep: { season: number; number?: number | null }) => `S${ep.season}${ep.number ? ` | E${ep.number}` : ''}`;
  const numbered = episodes.filter((ep) => ep.number);
  const first = numbered[0] || episodes[0];
  const last = numbered[numbered.length - 1] || episodes[episodes.length - 1];
  if (!first) return '';
  if (first === last || !first.number || !last.number) return label(first);
  return first.season === last.season ? `${label(first)} – E${last.number}` : `${label(first)} – ${label(last)}`;
}

// show stats that follow from its numbered episodes
export const getEpisodeStatusUpdatedValues = (allEps) => {
  const aired_episodes_count = countAiredEpisodes(allEps);
  const watchedEps = allEps.filter((ep) => ep.watched_status === 'WATCHED');
  const watched_episodes_count = watchedEps.length;

  // reversed to make it easy to find last watched episode
  const allEpsReversed = [...allEps].reverse();

  const last_watched_episode_index = allEpsReversed.findIndex((ep) => ep.watched_status === 'WATCHED');
  const last_watched_episode = allEpsReversed[last_watched_episode_index];
  const last_watched_episode_id = last_watched_episode?.id || null;

  // most recent watch, not the furthest episode - rewatching earlier episodes still counts as activity
  const last_watched_date = watchedEps.reduce((latest, ep) => (ep.watched_at && (!latest || ep.watched_at > latest) ? ep.watched_at : latest), null);

  const next_episode_towatch =
    allEpsReversed.find((ep, index) => last_watched_episode_index - 1 === index) || allEpsReversed.find((ep) => ep.watched_status !== 'WATCHED');
  const next_episode_towatch_airdate = next_episode_towatch?.airstamp || null;

  return {
    aired_episodes_count,
    watched_episodes_count,
    last_watched_date,
    last_watched_episode_id,
    next_episode_towatch_airdate,
    abandoned: 0,
  };
};

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
