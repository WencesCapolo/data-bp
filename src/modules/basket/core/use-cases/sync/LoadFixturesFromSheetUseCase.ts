import type { ISheetsFetcher } from '@basket/core/ports/ISheetsFetcher';
import type { IFixtureMatchRepository } from '@basket/core/ports/IFixtureMatchRepository';
import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';

const BATCH = 500;

export interface LoadFixturesParams {
  sourceSheet: string;     // logical slug (e.g. 'fixture_lnb_ar')
  spreadsheetId: string;
  tab: string;
  seasonStartYear?: number;
}

export class LoadFixturesFromSheetUseCase {
  constructor(
    private readonly fetcher: ISheetsFetcher,
    private readonly repo: IFixtureMatchRepository,
    private readonly mapRow: (row: Record<string, string>, sourceSheet: string, seasonStartYear?: number) => FixtureMatchProps | null,
  ) {}

  async execute(p: LoadFixturesParams): Promise<{ inserted: number }> {
    let buf: FixtureMatchProps[] = [];
    let inserted = 0;
    for await (const r of this.fetcher.streamRows(p.spreadsheetId, p.tab)) {
      const mapped = this.mapRow(r.values, p.sourceSheet, p.seasonStartYear);
      if (!mapped) continue;
      buf.push(mapped);
      if (buf.length >= BATCH) {
        inserted += await this.repo.upsertMany(buf);
        buf = [];
      }
    }
    if (buf.length > 0) inserted += await this.repo.upsertMany(buf);
    return { inserted };
  }
}
