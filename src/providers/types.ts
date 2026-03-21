// Core provider interfaces and types for TV data abstraction

export interface SearchResult {
  id: number;
  name: string;
  url: string;
  image?: {
    medium?: string;
    original?: string;
  };
  network?: {
    name?: string;
    country?: {
      name?: string;
      code?: string;
      timezone?: string;
    };
  };
  summary?: string;
  premiered?: string;
  status?: string;
  score?: number;
}

export interface ProviderShow {
  id: number;
  name: string;
  url: string;
  summary?: string;
  type?: string;
  language?: string;
  status?: 'Ended' | 'In Development' | 'Running' | 'To Be Determined';
  runtime?: number;
  averageRuntime?: number;
  premiered?: string;
  ended?: string;
  officialSite?: string;
  network?: {
    name?: string;
    country?: {
      name?: string;
      code?: string;
      timezone?: string;
    };
  };
  image?: {
    medium?: string;
    original?: string;
  };
  externals?: {
    tvrage?: number;
    thetvdb?: number;
    imdb?: string;
  };
}

export interface ProviderEpisode {
  id: number;
  url?: string;
  name: string;
  season: number;
  number: number;
  type?: string;
  airdate?: string;
  airtime?: string;
  airstamp?: string;
  runtime?: number;
  image?: {
    medium?: string;
    original?: string;
  };
  summary?: string;
}

export interface ProviderSeason {
  id: number;
  number: number;
  episodeOrder?: number;
  premiereDate?: string;
  endDate?: string;
}

export interface ITVDataProvider {
  readonly providerName: string;
  readonly providerVersion: string;

  search(query: string): Promise<SearchResult[]>;
  getShow(id: number | string): Promise<ProviderShow>;
  getSeasons(showId: number | string): Promise<ProviderSeason[]>;
  getEpisodes(
    showId: number | string,
    includeSpecials?: boolean
  ): Promise<ProviderEpisode[]>;
  getSeasonEpisodes(seasonId: number | string): Promise<ProviderEpisode[]>;
}

export interface ProviderConfig {
  type: 'tvmaze' | 'tmdb' | 'tvdb';
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  rateLimit?: {
    requests: number;
    perMs: number;
  };
}
