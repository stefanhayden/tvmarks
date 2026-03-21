// Factory for managing TV data provider instantiation

import { ITVDataProvider, ProviderConfig } from './types';
import { TVMazeProvider } from './tvmaze/tvmaze-provider';
import { ProviderError } from './base/provider-errors';

export class ProviderFactory {
  private static instance: ITVDataProvider | null = null;
  private static config: ProviderConfig | null = null;

  static initialize(config: ProviderConfig): void {
    this.config = config;
    this.instance = null;
  }

  static getProvider(): ITVDataProvider {
    if (!this.config) {
      throw new ProviderError(
        'Provider not initialized. Call ProviderFactory.initialize() first.'
      );
    }
    if (!this.instance) {
      this.instance = this.createProvider(this.config);
    }
    return this.instance;
  }

  private static createProvider(config: ProviderConfig): ITVDataProvider {
    switch (config.type) {
      case 'tvmaze':
        return new TVMazeProvider(config);
      case 'tmdb':
        throw new ProviderError('TMDB provider not yet implemented');
      case 'tvdb':
        throw new ProviderError('TVDB provider not yet implemented');
      default:
        throw new ProviderError(`Unknown provider type: ${config.type}`);
    }
  }

  static reset(): void {
    this.instance = null;
    this.config = null;
  }
}
