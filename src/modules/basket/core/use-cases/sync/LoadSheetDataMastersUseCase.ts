import type { ISheetsFetcher } from '@basket/core/ports/ISheetsFetcher';
import type { ISheetDataMasterRepository } from '@basket/core/ports/ISheetDataMasterRepository';
import { parseDataSheet } from '@basket/infrastructure/sync/sheetDataMapper';

export interface LoadDataMastersParams {
  workbookLabel: string;
  spreadsheetId: string;
  tab: string;
}

export interface LoadDataMastersResult {
  teams: number;
  cambios: number;
  dias: number;
}

export class LoadSheetDataMastersUseCase {
  constructor(
    private readonly fetcher: ISheetsFetcher,
    private readonly repo: ISheetDataMasterRepository,
  ) {}

  async execute(p: LoadDataMastersParams): Promise<LoadDataMastersResult> {
    const grid = await this.fetcher.getValues(p.spreadsheetId, p.tab);
    const parsed = parseDataSheet(grid, p.workbookLabel);
    const teams = await this.repo.upsertTeams(parsed.teams);
    const cambios = await this.repo.upsertCambios(parsed.cambios);
    const dias = await this.repo.upsertDias(parsed.dias);
    return { teams, cambios, dias };
  }
}
