export interface SheetRow {
  rowIndex: number;
  values: Record<string, string>;
}

export interface ISheetsFetcher {
  streamRows(spreadsheetId: string, tab: string): AsyncGenerator<SheetRow, void, unknown>;
  listTabs(spreadsheetId: string): Promise<string[]>;
}
