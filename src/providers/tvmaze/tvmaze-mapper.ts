// Transform TVMaze-specific data to provider-agnostic format

import {
  SearchResult,
  ProviderShow,
  ProviderEpisode,
  ProviderSeason,
} from '../types';

export class TVMazeMapper {
  toSearchResult(result: any): SearchResult {
    return {
      id: result.show.id,
      name: result.show.name,
      url: result.show.url,
      image: result.show.image,
      network: result.show.network,
      summary: result.show.summary,
      premiered: result.show.premiered,
      status: result.show.status,
      score: result.score,
    };
  }

  toProviderShow(show: any): ProviderShow {
    return {
      id: show.id,
      name: show.name,
      url: show.url,
      summary: show.summary,
      type: show.type,
      language: show.language,
      status: show.status,
      runtime: show.runtime,
      averageRuntime: show.averageRuntime,
      premiered: show.premiered,
      ended: show.ended,
      officialSite: show.officialSite,
      network: show.network,
      image: show.image,
      externals: show.externals,
    };
  }

  toProviderEpisode(episode: any): ProviderEpisode {
    return {
      id: episode.id,
      url: episode.url,
      name: episode.name,
      season: episode.season,
      number: episode.number,
      type: episode.type,
      airdate: episode.airdate,
      airtime: episode.airtime,
      airstamp: episode.airstamp,
      runtime: episode.runtime,
      image: episode.image,
      summary: episode.summary,
    };
  }

  toProviderSeason(season: any): ProviderSeason {
    return {
      id: season.id,
      number: season.number,
      episodeOrder: season.episodeOrder,
      premiereDate: season.premiereDate,
      endDate: season.endDate,
    };
  }
}
