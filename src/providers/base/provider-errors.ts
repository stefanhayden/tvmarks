// Common error types for TV data providers

export class ProviderError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ProviderError';
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProviderError);
    }
  }
}

export class NotFoundError extends ProviderError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'RateLimitError';
  }
}
