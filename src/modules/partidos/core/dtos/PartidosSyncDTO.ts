export interface PartidosSyncStateDTO {
  lastSyncAt: string | null;
  lastCountNacional: number;
  lastCountIntl: number;
  lastError: string | null;
  lastDurationMs: number | null;
}

export interface PartidosSyncResultDTO {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  countNacional: number;
  countIntl: number;
}
