import { describe, it, expect } from 'vitest';
import { calculateDaysUntilAirDate } from './util';

describe('calculateDaysUntilAirDate', () => {
  it('should return 0 for an episode airing today', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-26T20:00:00-05:00'; // Same day, later time
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(0);
  });

  it('should return 0 for an episode that already aired today', () => {
    const today = new Date('2026-02-26T20:00:00-05:00');
    const airstamp = '2026-02-26T08:00:00-05:00'; // Same day, earlier time
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(0);
  });

  it('should return 1 for an episode airing tomorrow', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-27T08:00:00-05:00'; // Next day
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });

  it('should return 2 for an episode airing in 2 days', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-28T20:00:00-05:00'; // 2 days from now
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(2);
  });

  it('should return 7 for an episode airing in a week', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-03-05T20:00:00-05:00'; // 7 days from now
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(7);
  });

  it('should handle episodes airing at midnight', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-27T00:00:00-05:00'; // Tomorrow at midnight
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });

  it('should handle episodes airing just before midnight', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-27T23:59:59-05:00'; // Tomorrow just before midnight
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });

  it('should handle different timezones correctly', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-27T08:00:00-08:00'; // Tomorrow in PST (3 hours behind EST)
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });

  it('should return negative values for episodes that aired in the past', () => {
    const today = new Date('2026-02-26T12:00:00-05:00');
    const airstamp = '2026-02-25T20:00:00-05:00'; // Yesterday
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(-1);
  });

  it('should handle month boundaries', () => {
    const today = new Date('2026-02-28T12:00:00-05:00'); // Last day of February
    const airstamp = '2026-03-01T08:00:00-05:00'; // First day of March
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });

  it('should handle year boundaries', () => {
    const today = new Date('2026-12-31T12:00:00-05:00'); // Last day of year
    const airstamp = '2027-01-01T08:00:00-05:00'; // First day of next year
    const result = calculateDaysUntilAirDate(airstamp, today);
    expect(result).toBe(1);
  });
});
