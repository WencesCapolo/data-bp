export interface PartidosSyncState {
  lastSyncAt: Date | null;
  lastCountNacional: number;
  lastCountIntl: number;
  lastError: string | null;
  lastDurationMs: number | null;
}

export interface IPartidosSyncStateRepository {
  get(): Promise<PartidosSyncState>;
  update(state: PartidosSyncState): Promise<void>;
}
