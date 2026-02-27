// Centralized transformation from provider format to database format

import { ProviderEpisode } from '../types';

export class DatabaseMapper {
  static toEpisode(providerEpisode: ProviderEpisode, showId: number) {
    return {
      id: providerEpisode.id,
      show_id: showId,
      url: providerEpisode.url || '',
      name: providerEpisode.name,
      season: providerEpisode.season,
      number: providerEpisode.number,
      type: providerEpisode.type || '',
      airdate: providerEpisode.airdate || '',
      airtime: providerEpisode.airtime || '',
      airstamp: providerEpisode.airstamp || '',
      runtime: providerEpisode.runtime || null,
      image: providerEpisode.image?.medium || null,
      summary: providerEpisode.summary || '',
      watched_status: null,
      watched_at: undefined,
    };
  }
}
