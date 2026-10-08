import { describe, it, expect } from 'vitest';
import { calculateDaysUntilAirDate, localDateString, formatDate, isEpisodeAired, countAiredEpisodes } from './util';

describe('calculateDaysUntilAirDate', () => {
  it('should return 0 for an episode airing today', () => {
    const today = new Date('2026-02-26T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-02-26', today);
    expect(result).toBe(0);
  });

  it('should return 0 for an episode that aired earlier today (UTC)', () => {
    const today = new Date('2026-02-26T20:00:00Z');
    const result = calculateDaysUntilAirDate('2026-02-26', today);
    expect(result).toBe(0);
  });

  it('should return 1 for an episode airing tomorrow', () => {
    const today = new Date('2026-02-26T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-02-27', today);
    expect(result).toBe(1);
  });

  it('should return 2 for an episode airing in 2 days', () => {
    const today = new Date('2026-02-26T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-02-28', today);
    expect(result).toBe(2);
  });

  it('should return 7 for an episode airing in a week', () => {
    const today = new Date('2026-02-26T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-03-05', today);
    expect(result).toBe(7);
  });

  it('should return negative values for episodes that aired in the past', () => {
    const today = new Date('2026-02-26T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-02-25', today);
    expect(result).toBe(-1);
  });

  it('should handle month boundaries', () => {
    const today = new Date('2026-02-28T12:00:00Z');
    const result = calculateDaysUntilAirDate('2026-03-01', today);
    expect(result).toBe(1);
  });

  it('should handle year boundaries', () => {
    const today = new Date('2026-12-31T12:00:00Z');
    const result = calculateDaysUntilAirDate('2027-01-01', today);
    expect(result).toBe(1);
  });

  it('should correctly handle DMV-style shows airing at midnight UTC (airstamp next day, airdate today)', () => {
    // Show airs 2026-03-30 US time (8:30 PM ET = 00:30 UTC Mar 31).
    // airdate is "2026-03-30", today is 2026-03-27 → should be 3 days
    const today = new Date('2026-03-27T10:00:00Z');
    const result = calculateDaysUntilAirDate('2026-03-30', today);
    expect(result).toBe(3);
  });
});

describe('calculateDaysUntilAirDate in a configured timezone', () => {
  it('should count from the local day once UTC has rolled over to tomorrow', () => {
    // 9pm at UTC-5 on Oct 6 is already Oct 7 in UTC
    const now = new Date('2026-10-07T02:00:00Z');
    expect(calculateDaysUntilAirDate('2026-10-07', now, -5)).toBe(1);
    expect(calculateDaysUntilAirDate('2026-10-07', now, 0)).toBe(0);
  });

  it('should count from the local day when it is ahead of UTC', () => {
    // 1am at UTC+3 on Oct 8 is still Oct 7 in UTC
    const now = new Date('2026-10-07T22:00:00Z');
    expect(calculateDaysUntilAirDate('2026-10-08', now, 3)).toBe(0);
  });
});

describe('localDateString', () => {
  it('should shift the instant by the timezone offset', () => {
    const instant = new Date('2026-10-08T00:30:00Z');
    expect(localDateString(instant, 0)).toBe('2026-10-08');
    expect(localDateString(instant, -5)).toBe('2026-10-07');
  });
});

describe('formatDate', () => {
  it('should keep the calendar day of a date-only string', () => {
    expect(formatDate('2026-05-20')).toBe('May 20th, 2026');
    expect(formatDate('2026-01-01')).toBe('January 1st, 2026');
    expect(formatDate('2026-12-31')).toBe('December 31st, 2026');
  });

  it('should use the right ordinal suffix', () => {
    expect(formatDate('2026-03-02')).toBe('March 2nd, 2026');
    expect(formatDate('2026-03-03')).toBe('March 3rd, 2026');
    expect(formatDate('2026-03-11')).toBe('March 11th, 2026');
    expect(formatDate('2026-03-22')).toBe('March 22nd, 2026');
  });

  it('should format a local date and time', () => {
    expect(formatDate('2026-05-20 21:15:00')).toBe('May 20th, 2026');
  });

  it('should return an empty string for missing, invalid or impossible dates', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatDate('2026-02-31')).toBe('');
  });
});

describe('isEpisodeAired', () => {
  const airstamp = '2026-04-09T12:00:00+00:00';

  it('should return false shortly before airing (was rounded to aired)', () => {
    expect(isEpisodeAired(airstamp, new Date('2026-04-09T01:00:00Z'))).toBe(false);
    expect(isEpisodeAired(airstamp, new Date('2026-04-09T11:59:00Z'))).toBe(false);
  });

  it('should return true at and after air time', () => {
    expect(isEpisodeAired(airstamp, new Date('2026-04-09T12:00:00Z'))).toBe(true);
    expect(isEpisodeAired(airstamp, new Date('2026-04-10T00:00:00Z'))).toBe(true);
  });

  it('should respect the airstamp timezone offset', () => {
    // 20:00 at -04:00 is 00:00 UTC the next day
    const now = new Date('2026-04-09T23:00:00Z');
    expect(isEpisodeAired('2026-04-09T20:00:00-04:00', now)).toBe(false);
  });

  it('should return false for a missing or invalid airstamp', () => {
    const now = new Date('2026-04-09T12:00:00Z');
    expect(isEpisodeAired(null, now)).toBe(false);
    expect(isEpisodeAired(undefined, now)).toBe(false);
    expect(isEpisodeAired('', now)).toBe(false);
    expect(isEpisodeAired('not a date', now)).toBe(false);
  });
});

describe('countAiredEpisodes', () => {
  const now = new Date('2026-04-09T12:00:00Z');

  it('should count aired numbered episodes only', () => {
    const episodes = [
      { number: 1, airstamp: '2026-04-01T12:00:00+00:00' },
      { number: 2, airstamp: '2026-04-09T12:00:00+00:00' },
      { number: null, airstamp: '2026-04-01T12:00:00+00:00' }, // special
      { number: 3, airstamp: '' },
    ];
    expect(countAiredEpisodes(episodes, now)).toBe(2);
  });

  it('should not count an episode airing later the same day', () => {
    // the old refresh code swapped the airstamp hour for the current hour, counting this as aired
    expect(countAiredEpisodes([{ number: 1, airstamp: '2026-04-09T23:00:00+00:00' }], now)).toBe(0);
  });
});
