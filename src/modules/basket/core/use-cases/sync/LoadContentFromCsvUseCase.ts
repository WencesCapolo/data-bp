import type { IContentRepository } from '@basket/core/ports/IContentRepository';
import type { ContentProps } from '@basket/core/entities/Content';

const BATCH = 500;

export class LoadContentFromCsvUseCase {
  constructor(private readonly repo: IContentRepository) {}

  async execute(opts: { rows: AsyncIterable<ContentProps> }): Promise<{ inserted: number }> {
    let buf: ContentProps[] = [];
    let inserted = 0;
    for await (const row of opts.rows) {
      buf.push(row);
      if (buf.length >= BATCH) {
        inserted += await this.repo.upsertMany(buf);
        buf = [];
      }
    }
    if (buf.length > 0) inserted += await this.repo.upsertMany(buf);
    return { inserted };
  }
}
