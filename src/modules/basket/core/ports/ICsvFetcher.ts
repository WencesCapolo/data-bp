export interface CsvFetchOptions {
  since?: Date;
  extraParams?: Record<string, string>;
}

export type CsvRow = Record<string, string>;

export interface ICsvFetcher {
  streamRows<T extends CsvRow>(
    resource: string,
    options?: CsvFetchOptions
  ): AsyncGenerator<T, void, unknown>;
}
