-- Phase 8.4: per-match fixture rows from Google Sheets
-- Source of truth for date ranges per league/season.

CREATE TABLE IF NOT EXISTS basket_fixture_matches (
  id            INTEGER PRIMARY KEY,
  match_date    DATE,
  match_time    TEXT,
  home_team     TEXT,
  away_team     TEXT,
  venue         TEXT,
  broadcaster   TEXT,
  source_sheet  TEXT NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS basket_fixture_matches_date_idx   ON basket_fixture_matches(match_date);
CREATE INDEX IF NOT EXISTS basket_fixture_matches_source_idx ON basket_fixture_matches(source_sheet);

-- Derived phase ranges: joins fixtures → content → tournaments to recover league/country.
-- Falls back to source_sheet when content not yet ingested.
CREATE MATERIALIZED VIEW IF NOT EXISTS basket_mat_fixture_ranges AS
SELECT
  COALESCE(t.name, fm.source_sheet)                       AS league,
  COALESCE(t.country, '')                                 AS country,
  EXTRACT(YEAR FROM MIN(fm.match_date))::int              AS season_start_year,
  MIN(fm.match_date)                                      AS start_date,
  MAX(fm.match_date)                                      AS end_date,
  COUNT(*)                                                AS match_count
FROM basket_fixture_matches fm
LEFT JOIN basket_content c     ON c.id = fm.id
LEFT JOIN basket_tournaments t ON t.id = c.tournament_id
WHERE fm.match_date IS NOT NULL
GROUP BY COALESCE(t.name, fm.source_sheet), COALESCE(t.country, '');

CREATE UNIQUE INDEX IF NOT EXISTS basket_mat_fixture_ranges_pk
  ON basket_mat_fixture_ranges(league, country);
