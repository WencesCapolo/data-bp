-- Phase 9: partidos dashboard tables.
-- Sourced from Google Sheets (Ligas Argentinas + Ligas Internacionales).
-- Rows include weekly entries (week_range NOT NULL, is_month_total=false)
-- and per-month totals (week_range NULL, is_month_total=true).

CREATE TABLE IF NOT EXISTS partidos_nacional (
  id                BIGSERIAL PRIMARY KEY,
  season            TEXT NOT NULL,
  month_year        TEXT NOT NULL,
  week_range        TEXT,
  week_start        DATE,
  week_end          DATE,
  is_month_total    BOOLEAN NOT NULL DEFAULT FALSE,
  control           TEXT,
  org               TEXT NOT NULL,
  league            TEXT NOT NULL,
  total             INTEGER NOT NULL DEFAULT 0,
  tyc               INTEGER,
  direct_tv         INTEGER,
  bp_emitido        INTEGER NOT NULL DEFAULT 0,
  bp_producido      INTEGER NOT NULL DEFAULT 0,
  externo_producido INTEGER NOT NULL DEFAULT 0,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partidos_nacional_natural_key
  ON partidos_nacional (season, month_year, week_range, org, league, is_month_total);
CREATE INDEX IF NOT EXISTS partidos_nacional_league_idx ON partidos_nacional(league);
CREATE INDEX IF NOT EXISTS partidos_nacional_week_start_idx ON partidos_nacional(week_start);
CREATE INDEX IF NOT EXISTS partidos_nacional_season_idx ON partidos_nacional(season);

CREATE TABLE IF NOT EXISTS partidos_intl (
  id                BIGSERIAL PRIMARY KEY,
  season            TEXT NOT NULL,
  month_year        TEXT NOT NULL,
  week_range        TEXT,
  week_start        DATE,
  week_end          DATE,
  is_month_total    BOOLEAN NOT NULL DEFAULT FALSE,
  country           TEXT NOT NULL,
  league            TEXT NOT NULL,
  total             INTEGER NOT NULL DEFAULT 0,
  total_arg         INTEGER,
  total_fuera       INTEGER,
  bp_emitido        INTEGER NOT NULL DEFAULT 0,
  bp_producido      INTEGER NOT NULL DEFAULT 0,
  externo_producido INTEGER NOT NULL DEFAULT 0,
  granular          JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partidos_intl_natural_key
  ON partidos_intl (season, month_year, week_range, country, league, is_month_total);
CREATE INDEX IF NOT EXISTS partidos_intl_country_idx ON partidos_intl(country);
CREATE INDEX IF NOT EXISTS partidos_intl_league_idx ON partidos_intl(league);
CREATE INDEX IF NOT EXISTS partidos_intl_week_start_idx ON partidos_intl(week_start);
CREATE INDEX IF NOT EXISTS partidos_intl_season_idx ON partidos_intl(season);

CREATE TABLE IF NOT EXISTS partidos_sync_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  last_sync_at        TIMESTAMPTZ,
  last_count_nacional INTEGER NOT NULL DEFAULT 0,
  last_count_intl     INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  last_duration_ms    INTEGER,
  CONSTRAINT partidos_sync_state_singleton CHECK (id = 1)
);

INSERT INTO partidos_sync_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
