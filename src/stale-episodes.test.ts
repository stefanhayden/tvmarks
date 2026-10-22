import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import * as tvDb from './tvshow-db';

const watchedAt = '2026-01-01 10:00:00';

const addEpisode = async (id: number, showId: number, season: number, number: number | null, watched = false, note?: string) => {
  await tvDb.createEpisode({
    id,
    show_id: showId,
    season,
    number,
    airstamp: '2026-01-01T00:00:00+00:00',
    watched_status: watched ? 'WATCHED' : null,
    watched_at: watched ? watchedAt : null,
  } as Parameters<typeof tvDb.createEpisode>[0]);
  if (note) await tvDb.updateEpisodeDetails(id, { note });
};

const episodeIds = async (showId: number) => (await tvDb.getEpisodesByShowId(showId)).map((ep) => ep.id).sort();

// a file database so rows can be aged from outside, episodes added in a test are otherwise all added in the same second
let dir: string;
let dbFile: string;
const useFileDb = async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvmarks-'));
  dbFile = path.join(dir, 'tvshows.db');
  await tvDb.init(dbFile);
};
const ageEpisodes = async (ids: number[]) => {
  const raw = await open({ filename: dbFile, driver: sqlite3.Database });
  await raw.run(
    `UPDATE episodes SET created_at = DateTime('now', '-30 day'), updated_at = DateTime('now', '-2 day') WHERE id IN (${ids.join(',')})`,
  );
  await raw.close();
};
const removeFileDb = () => fs.rmSync(dir, { recursive: true, force: true });

// the provider swapped placeholder episodes for ones with new ids
describe('removeEpisodesMissingFromProvider', () => {
  beforeAll(async () => {
    await useFileDb();
    await tvDb.createShow({ id: 1, status: 'Running', watched_episodes_count: 5, abandoned: 1 } as tvDb.Show);

    await addEpisode(101, 1, 1, 1, true);
    await addEpisode(102, 1, 1, 2); // placeholder
    await addEpisode(103, 1, 1, 3, true, 'placeholder note'); // placeholder that got watched
    await tvDb.updateEpisodeDetails(103, { tags: 'premiere comfy' });
    await addEpisode(104, 1, 1, 4, true); // watched, gone, nothing replaced it
    await addEpisode(105, 1, 1, 5); // unwatched, gone
    await addEpisode(106, 1, 1, 6, true); // watched, gone, and a later episode was renumbered into its place
    await addEpisode(107, 1, 1, 6); // that renumbered episode
    await addEpisode(150, 1, 1, null); // special
    await addEpisode(201, 1, 2, 1); // season that wasn't fetched
    await tvDb.updateShow('1', { last_watched_episode_id: 106 });
    await ageEpisodes([101, 102, 103, 104, 105, 106, 107, 150, 201]);

    await addEpisode(112, 1, 1, 2); // replacements
    await addEpisode(113, 1, 1, 3, false, 'real note');
    await tvDb.updateEpisodeDetails(113, { tags: 'Comfy' });
    await addEpisode(108, 1, 1, 8); // added by a refresh running alongside

    await tvDb.removeEpisodesMissingFromProvider(1, [101, 107, 112, 113], {
      seasons: [1],
      startedAt: new Date(Date.now() - 36e5).toISOString(),
    });
  });

  afterAll(removeFileDb);

  test('removes episodes the provider no longer lists', async () => {
    expect(await episodeIds(1)).toEqual([101, 104, 106, 107, 108, 112, 113, 150, 201]);
  });

  test('moves the watch, note and hashtags to the replacement', async () => {
    expect(await tvDb.getEpisode(113)).toMatchObject({
      watched_status: 'WATCHED',
      watched_at: watchedAt,
      note: 'real note\n\nplaceholder note',
      tags: 'Comfy premiere',
    });
    expect((await tvDb.getEpisode(112)).watched_status).toBeNull();
  });

  test('a renumbered episode does not take the watch', async () => {
    expect((await tvDb.getEpisode(106)).watched_status).toBe('WATCHED');
    expect((await tvDb.getEpisode(107)).watched_status).toBeNull();
  });

  test('updates the show to match', async () => {
    expect(await tvDb.getShow(1)).toMatchObject({
      watched_episodes_count: 4,
      episodes_count: 8,
      abandoned: 1,
    });
  });
});

// duplicates left behind before refreshes removed them are cleaned up on startup
describe('removeDuplicateEpisodes', () => {
  beforeAll(async () => {
    await useFileDb();
    await tvDb.createShow({ id: 2, status: 'Running', watched_episodes_count: 1 } as tvDb.Show);
    await addEpisode(301, 2, 1, 1, true); // stale copy, watched
    await addEpisode(303, 2, 1, 2); // two copies refreshed together
    await addEpisode(304, 2, 1, 2);
    await ageEpisodes([301]);
    await addEpisode(302, 2, 1, 1); // copy the provider still lists

    await tvDb.init(dbFile);
  });

  afterAll(removeFileDb);

  test('keeps the most recently refreshed copy and its watch', async () => {
    expect(await episodeIds(2)).toEqual([302, 303, 304]);
    expect((await tvDb.getEpisode(302)).watched_status).toBe('WATCHED');
    expect(await tvDb.getShow(2)).toMatchObject({ watched_episodes_count: 1, last_watched_episode_id: 302 });
  });
});
