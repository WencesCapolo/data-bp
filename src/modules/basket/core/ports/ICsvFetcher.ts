export type CsvAuthOverride = 'inherit' | 'none' | 'bearer' | 'query-token';

export interface CsvFetchOptions {
  since?: Date;
  extraParams?: Record<string, string>;
  /** Override the fetcher's default auth mode for this single call. */
  auth?: CsvAuthOverride;
  /** Skip the configured sinceParam — useful when endpoint uses a relative window param. */
  omitSince?: boolean;
  /** Override Cookie header for this call (e.g. Control Panel session). */
  cookie?: string;
}

export type CsvRow = Record<string, string>;

export interface ICsvFetcher {
  streamRows<T extends CsvRow>(
    resource: string,
    options?: CsvFetchOptions
  ): AsyncGenerator<T, void, unknown>;
}
