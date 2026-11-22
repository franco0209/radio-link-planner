/** Errors carry a code so the UI can show them in the user's language. */
export type ServiceErrorCode = 'rateLimited' | 'elevationHttp' | 'badResponse' | 'searchUnavailable';

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    public status?: number,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}
