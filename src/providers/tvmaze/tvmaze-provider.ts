// TVMaze provider implementation wrapping node-tvmaze package

import tvMaze from 'node-tvmaze';
import {
  ITVDataProvider,
  SearchResult,
  ProviderShow,
  ProviderEpisode,
  ProviderSeason,
  ProviderConfig,
} from '../types';
import { TVMazeMapper } from './tvmaze-mapper';
import { ProviderError } from '../base/provider-errors';

// node-tvmaze's requests have no timeout, a stalled connection would otherwise hang whatever is waiting on it
const DEFAULT_TIMEOUT_MS = 10 * 1000;

export class TVMazeProvider implements ITVDataProvider {
  readonly providerName = 'TVMaze';
  readonly providerVersion = '1.0.0';

  private mapper: TVMazeMapper;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.mapper = new TVMazeMapper();
  }

  // the request itself isn't cancelled, node-tvmaze has no way to, it's only no longer waited on
  // any, like what node-tvmaze resolves to, it has no types
  private withTimeout(request: Promise<any>): Promise<any> {
    const ms = this.config.timeout ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    });
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const results = await this.withTimeout(tvMaze.search(query));
      return results.map((result) => this.mapper.toSearchResult(result));
    } catch (error: any) {
      throw new ProviderError(`TVMaze search failed: ${error.message}`, error);
    }
  }

  async getShow(id: number | string): Promise<ProviderShow> {
    try {
      const show = await this.withTimeout(tvMaze.show(Number(id)));
      return this.mapper.toProviderShow(show);
    } catch (error: any) {
      throw new ProviderError(
        `TVMaze getShow failed for id ${id}: ${error.message}`,
        error
      );
    }
  }

  async getSeasons(showId: number | string): Promise<ProviderSeason[]> {
    try {
      const seasons = await this.withTimeout(tvMaze.seasons(Number(showId)));
      return seasons.map((season) => this.mapper.toProviderSeason(season));
    } catch (error: any) {
      throw new ProviderError(
        `TVMaze getSeasons failed for show ${showId}: ${error.message}`,
        error
      );
    }
  }

  async getEpisodes(
    showId: number | string,
    includeSpecials = false
  ): Promise<ProviderEpisode[]> {
    try {
      const episodes = await this.withTimeout(tvMaze.episodes(Number(showId), includeSpecials));
      return episodes.map((episode) => this.mapper.toProviderEpisode(episode));
    } catch (error: any) {
      throw new ProviderError(
        `TVMaze getEpisodes failed for show ${showId}: ${error.message}`,
        error
      );
    }
  }

  async getSeasonEpisodes(
    seasonId: number | string
  ): Promise<ProviderEpisode[]> {
    try {
      const episodes = await this.withTimeout(tvMaze.seasonEpisodes(Number(seasonId)));
      return episodes.map((episode) => this.mapper.toProviderEpisode(episode));
    } catch (error: any) {
      throw new ProviderError(
        `TVMaze getSeasonEpisodes failed for season ${seasonId}: ${error.message}`,
        error
      );
    }
  }
}
