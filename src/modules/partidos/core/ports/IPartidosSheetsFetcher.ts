export interface IPartidosSheetsFetcher {
  getValues(tab: string): Promise<string[][]>;
}
