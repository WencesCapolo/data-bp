import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import type {
  ICsvFetcher,
  CsvFetchOptions,
  CsvRow,
} from '@basket/core/ports/ICsvFetcher';

export interface CsvApiFetcherConfig {
  baseUrl: string;
  apiKey?: string;
  delimiter?: string;
  sinceParam?: string;
}

export class CsvApiFetcher implements ICsvFetcher {
  constructor(private readonly cfg: CsvApiFetcherConfig) {}

  async *streamRows<T extends CsvRow>(
    resource: string,
    options: CsvFetchOptions = {},
  ): AsyncGenerator<T, void, unknown> {
    const url = this.buildUrl(resource, options.since);
    const headers: Record<string, string> = { accept: 'text/csv' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;

    const res = await fetch(url, { headers });
    if (!res.ok || !res.body) {
      throw new Error(`CSV fetch failed ${res.status} ${res.statusText} (${url})`);
    }

    const nodeStream = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    const parser = nodeStream.pipe(
      parse({
        delimiter: this.cfg.delimiter ?? ';',
        bom: true,
        columns: true,
        trim: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
      }),
    );

    for await (const record of parser) {
      yield record as T;
    }
  }

  private buildUrl(resource: string, since?: Date): string {
    const url = new URL(resource, this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : this.cfg.baseUrl + '/');
    if (since) {
      url.searchParams.set(this.cfg.sinceParam ?? 'since', since.toISOString());
    }
    return url.toString();
  }
}
