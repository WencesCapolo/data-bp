export interface IContactosSheetsFetcher {
  getValues(tab: string): Promise<string[][]>;
}
