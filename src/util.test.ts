import { describe, it, expect } from 'vitest';
import { calculateDaysUntilAirDate } from './util';

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
