import { describe, it, expect } from 'vitest';
import { getEpisodeStatusUpdatedValues } from './show';

const past = '2026-01-01T00:00:00+00:00';
const future = '2999-01-01T00:00:00+00:00';

const ep = (id: number, airstamp: string | null, watched_at: string | null = null) => ({
  id,
  season: 1,
  number: id,
  airstamp,
  watched_status: watched_at ? 'WATCHED' : null,
  watched_at,
});

describe('getEpisodeStatusUpdatedValues', () => {
  it('should point at the episode after the last watched one', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-02-01 10:00:00'), ep(2, past), ep(3, future)]);
    expect(result).toMatchObject({
      aired_episodes_count: 2,
      watched_episodes_count: 1,
      last_watched_episode_id: 1,
      last_watched_date: '2026-02-01 10:00:00',
      next_episode_towatch_airdate: past,
      abandoned: 0,
    });
  });

  it('should not count unaired or undated episodes as aired', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-02-01 10:00:00'), ep(2, future), ep(3, ''), ep(4, null)]);
    expect(result.aired_episodes_count).toBe(1);
  });

  it('should count episodes marked watched before airing', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-02-01 10:00:00'), ep(2, future, '2026-02-01 11:00:00')]);
    expect(result).toMatchObject({ aired_episodes_count: 1, watched_episodes_count: 2 });
  });

  it('should use the most recent watch date when catching up on earlier episodes', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-09-01 10:00:00'), ep(2, past), ep(3, past, '2026-01-01 10:00:00')]);
    expect(result.last_watched_date).toBe('2026-09-01 10:00:00');
    expect(result.last_watched_episode_id).toBe(3);
  });

  it('should fall back to an unwatched episode when the final episode is watched', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-02-01 10:00:00'), ep(2, past), ep(3, past, '2026-02-02 10:00:00')]);
    expect(result.next_episode_towatch_airdate).toBe(past);
  });

  it('should have no next episode when everything is watched', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past, '2026-02-01 10:00:00'), ep(2, past, '2026-02-02 10:00:00')]);
    expect(result.next_episode_towatch_airdate).toBeNull();
  });

  it('should reset to nothing watched when every episode is unwatched', () => {
    const result = getEpisodeStatusUpdatedValues([ep(1, past), ep(2, past)]);
    expect(result).toMatchObject({
      watched_episodes_count: 0,
      last_watched_date: null,
      last_watched_episode_id: null,
    });
  });
});
