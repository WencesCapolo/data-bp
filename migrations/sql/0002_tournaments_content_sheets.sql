-- Phase 8: Live sync — tournaments, content, sheet rows
-- Idempotent. Run after 0001.

CREATE TABLE IF NOT EXISTS basket_tournaments (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  country     TEXT,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS basket_tournaments_country_idx ON basket_tournaments(country);

CREATE TABLE IF NOT EXISTS basket_content (
  id                       INTEGER PRIMARY KEY,
  idx                      TEXT,
  title                    TEXT,
  summary                  TEXT,
  image_id                 TEXT,
  created_at               TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ,
  date                     TIMESTAMPTZ,
  date_ends                TIMESTAMPTZ,
  date_server_spawns       TIMESTAMPTZ,
  date_server_goes_live    TIMESTAMPTZ,
  duration                 INTEGER,
  status                   SMALLINT,
  type                     SMALLINT,
  match_id                 TEXT,
  venue                    TEXT,
  team_1                   INTEGER,
  team_2                   INTEGER,
  team_1_name              TEXT,
  team_2_name              TEXT,
  team_1_score             INTEGER,
  team_2_score             INTEGER,
  match_status             TEXT,
  tournament_id            INTEGER,
  country                  TEXT,
  product_id               INTEGER,
  weight                   INTEGER,
  views                    BIGINT,
  views_users              BIGINT,
  views_seconds            BIGINT,
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS basket_content_tournament_idx ON basket_content(tournament_id);
CREATE INDEX IF NOT EXISTS basket_content_country_idx    ON basket_content(country);
CREATE INDEX IF NOT EXISTS basket_content_date_idx       ON basket_content(date);

-- Generic sheet rows: (sheet, row_key) composite PK; data as JSONB
CREATE TABLE IF NOT EXISTS basket_sheet_rows (
  sheet      TEXT NOT NULL,
  row_key    TEXT NOT NULL,
  data       JSONB NOT NULL,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sheet, row_key)
);
CREATE INDEX IF NOT EXISTS basket_sheet_rows_sheet_idx ON basket_sheet_rows(sheet);

-- Teams: allow API-only teams (id/name/country) by relaxing league NOT NULL
ALTER TABLE basket_teams ALTER COLUMN league DROP NOT NULL;
