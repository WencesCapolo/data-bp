import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { Agent, request } from 'node:https';
import type {
  ICsvFetcher,
  CsvFetchOptions,
  CsvRow,
} from '@basket/core/ports/ICsvFetcher';

export type CsvAuthMode = 'bearer' | 'query-token' | 'none';

export interface CsvApiFetcherConfig {
  baseUrl: string;
  authMode?: CsvAuthMode;
  apiKey?: string;
  tokenParam?: string;
  delimiter?: string;
  sinceParam?: string;
  staticParams?: Record<string, string>;
}

const v4Agent = new Agent({ family: 4, keepAlive: true });

export class CsvApiFetcher implements ICsvFetcher {
  constructor(private readonly cfg: CsvApiFetcherConfig) {}

  async *streamRows<T extends CsvRow>(
    resource: string,
    options: CsvFetchOptions = {},
  ): AsyncGenerator<T, void, unknown> {
    const url = new URL(this.buildUrl(resource, options));
    const headers: Record<string, string> = { accept: 'text/csv' };
    if ((this.cfg.authMode ?? 'bearer') === 'bearer' && this.cfg.apiKey) {
      headers.authorization = `Bearer ${this.cfg.apiKey}`;
    }

    const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'GET',
          headers,
          agent: v4Agent,
          timeout: 60_000,
        },
        resolve,
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`request timeout ${url.hostname}`)));
      req.end();
    });

    if (!res.statusCode || res.statusCode >= 400) {
      let body = '';
      for await (const chunk of res) body += String(chunk).slice(0, 500);
      throw new Error(
        `CSV fetch failed ${res.statusCode} ${redact(url.toString(), this.cfg.tokenParam)}: ${body.slice(0, 200)}`,
      );
    }

    const parser = (res as unknown as Readable).pipe(
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

  private buildUrl(resource: string, options: CsvFetchOptions): string {
    const url = new URL(resource, this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : this.cfg.baseUrl + '/');
    if (options.since) {
      url.searchParams.set(this.cfg.sinceParam ?? 'since', options.since.toISOString());
    }
    for (const [k, v] of Object.entries(this.cfg.staticParams ?? {})) {
      url.searchParams.set(k, v);
    }
    for (const [k, v] of Object.entries(options.extraParams ?? {})) {
      url.searchParams.set(k, v);
    }
    if (this.cfg.authMode === 'query-token' && this.cfg.apiKey) {
      url.searchParams.set(this.cfg.tokenParam ?? 'token', this.cfg.apiKey);
    }
    return url.toString();
  }
}

function redact(url: string, tokenParam?: string): string {
  if (!tokenParam) return url;
  return url.replace(new RegExp(`([?&]${tokenParam}=)[^&]+`), '$1***');
}
