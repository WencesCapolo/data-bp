export interface QualityIssue {
  code: string;       // e.g. 'payment_no_user', 'user_no_country'
  description: string;
  count: number;
}

/** One line of the sync log: a manual Upload, an SFTP inbox ingest, a cron or
 *  token-triggered run. Newest first. */
export interface SyncLogEntry {
  at: string;
  kind: 'manual' | 'inbox' | 'cron' | 'token';
  /** Analyst email for manual, automation name otherwise. */
  actor: string;
  /** Filename + Window for uploads; what was refreshed for runs. */
  detail: string;
  rows: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface DataQualityDTO {
  generatedAt: string;
  issues: QualityIssue[];
  syncLog: SyncLogEntry[];
  totals: {
    users: number;
    payments: number;
    teams: number;
  };
}
