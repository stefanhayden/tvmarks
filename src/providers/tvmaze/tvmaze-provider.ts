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

export class TVMazeProvider implements ITVDataProvider {
  readonly providerName = 'TVMaze';
  readonly providerVersion = '1.0.0';

  private mapper: TVMazeMapper;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.mapper = new TVMazeMapper();
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const results = await tvMaze.search(query);
      return results.map((result) => this.mapper.toSearchResult(result));
    } catch (error: any) {
      throw new ProviderError(`TVMaze search failed: ${error.message}`, error);
    }
  }

  async getShow(id: number | string): Promise<ProviderShow> {
    try {
      const show = await tvMaze.show(Number(id));
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
      const seasons = await tvMaze.seasons(Number(showId));
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
      const episodes = await tvMaze.episodes(Number(showId), includeSpecials);
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
      const episodes = await tvMaze.seasonEpisodes(Number(seasonId));
      return episodes.map((episode) => this.mapper.toProviderEpisode(episode));
    } catch (error: any) {
      throw new ProviderError(
        `TVMaze getSeasonEpisodes failed for season ${seasonId}: ${error.message}`,
        error
      );
    }
  }
}
