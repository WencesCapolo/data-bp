import type { TeamMasterRow, EnumRow } from '@basket/infrastructure/sync/sheetDataMapper';

export interface ISheetDataMasterRepository {
  upsertTeams(rows: TeamMasterRow[]): Promise<number>;
  upsertCambios(rows: EnumRow[]): Promise<number>;
  upsertDias(rows: EnumRow[]): Promise<number>;
}
