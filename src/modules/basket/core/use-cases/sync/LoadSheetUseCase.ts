import type { ISheetsFetcher } from '@basket/core/ports/ISheetsFetcher';
import type { ISheetRowRepository, SheetRowProps } from '@basket/core/ports/ISheetRowRepository';

const BATCH = 500;

export interface LoadSheetParams {
  sheetName: string;       // logical name = 'incidents' | 'grilla' | 'total_matches'
  spreadsheetId: string;
  tab: string;
  idColumn?: string;       // if set + present, used as row_key; else fallback rowIndex
}

export class LoadSheetUseCase {
  constructor(
    private readonly fetcher: ISheetsFetcher,
    private readonly repo: ISheetRowRepository,
  ) {}

  async execute(p: LoadSheetParams): Promise<{ inserted: number }> {
    const dedup = new Map<string, SheetRowProps>();
    for await (const r of this.fetcher.streamRows(p.spreadsheetId, p.tab)) {
      const id = p.idColumn && r.values[p.idColumn]?.trim();
      const rowKey = id ? id : `r${r.rowIndex}`;
      // last-write-wins on duplicate id
      dedup.set(rowKey, { sheet: p.sheetName, rowKey, data: r.values });
    }
    const all = [...dedup.values()];
    let inserted = 0;
    for (let i = 0; i < all.length; i += BATCH) {
      inserted += await this.repo.upsertMany(all.slice(i, i + BATCH));
    }
    return { inserted };
  }
}
