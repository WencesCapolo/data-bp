-- Sync run log: one row per cron or token-triggered Sync, so the Calidad tab
-- can show when the mirror was last refreshed and by what. Manual Uploads keep
-- their own provenance in basket_payment_uploads (0009); the tab reads both.
-- Idempotent: safe to re-run.
--
--   node_modules/.bin/tsx --env-file=.env scripts/apply-sql.ts migrations/sql/0018_sync_runs.sql
CREATE TABLE IF NOT EXISTS basket_sync_runs (
  id                SERIAL PRIMARY KEY,
  trigger           TEXT        NOT NULL,           -- 'cron' | 'token'
  actor             TEXT        NOT NULL,           -- 'SyncScheduler' | 'x-sync-token'
  scope             TEXT        NOT NULL,           -- 'full' | 'upload'
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ NOT NULL,
  duration_ms       INTEGER     NOT NULL,
  users_synced      INTEGER,
  content_synced    INTEGER,
  payments_ingested INTEGER,
  sheets_synced     INTEGER,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS basket_sync_runs_started_at_idx
  ON basket_sync_runs(started_at);
