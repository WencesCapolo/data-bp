import type { ITournamentRepository } from '@basket/core/ports/ITournamentRepository';
import type { TournamentProps } from '@basket/core/entities/Tournament';

const BATCH_SIZE = 500;

export class LoadTournamentsFromCsvUseCase {
  constructor(private readonly repo: ITournamentRepository) {}

  async execute(opts: { rows: AsyncIterable<TournamentProps> }): Promise<{ inserted: number }> {
    let buffer: TournamentProps[] = [];
    let inserted = 0;
    for await (const row of opts.rows) {
      buffer.push(row);
      if (buffer.length >= BATCH_SIZE) {
        inserted += await this.repo.upsertMany(buffer);
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      inserted += await this.repo.upsertMany(buffer);
    }
    return { inserted };
  }
}
