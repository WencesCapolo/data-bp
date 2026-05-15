export interface SyncStateRecord {
  source: string;
  lastSync: Date;
  rowCount: number | null;
}

export interface ISyncStateRepository {
  getLastSync(source: string): Promise<Date | null>;
  updateLastSync(source: string, date: Date, rowCount?: number): Promise<void>;
  findAll(): Promise<SyncStateRecord[]>;
}
