import { describe, expect, test, vi } from 'vitest';
import { TVMazeProvider } from './tvmaze-provider';
import { ProviderError } from '../base/provider-errors';

// like a connection to TVMaze that stalls rather than failing
vi.mock('node-tvmaze', () => ({
  default: {
    show: () => new Promise(() => {}),
    seasons: async () => [],
  },
}));

describe('TVMazeProvider', () => {
  const provider = new TVMazeProvider({ type: 'tvmaze', timeout: 20 });

  test('a request that stalls fails once it times out, rather than hanging', async () => {
    const error = await provider.getShow(1).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toBe('TVMaze getShow failed for id 1: timed out after 20ms');
  });

  test('a request that answers in time is unaffected', async () => {
    expect(await provider.getSeasons(1)).toEqual([]);
  });
});
