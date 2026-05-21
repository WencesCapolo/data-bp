export interface SheetRowProps {
  sheet: string;
  rowKey: string;
  data: Record<string, unknown>;
}

export interface ISheetRowRepository {
  upsertMany(rows: SheetRowProps[]): Promise<number>;
  countBySheet(sheet: string): Promise<number>;
}
