import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

export interface CsvStreamOptions {
  delimiter?: string;
  bom?: boolean;
}

export async function* streamCsvFile<T extends Record<string, string>>(
  filePath: string,
  options: CsvStreamOptions = {},
): AsyncGenerator<T, void, unknown> {
  const stream = createReadStream(filePath);
  const parser = stream.pipe(
    parse({
      delimiter: options.delimiter ?? ';',
      bom: options.bom ?? true,
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
