-- Phase 10: contactos directory table.
-- Sourced from Google Sheets GRILLA, tab "Contactos".
-- One flexible table: the sheet is a free-form multi-block directory
-- (BP internal staff + per-league club camera responsibles), so rows are
-- tagged by source_block + category rather than split into rigid tables.
--   source_block: INTERNOS | EXTERNOS | ADC | CAB | FEBAMBA | ECUADOR
--   category:     REALIZADOR | CAMARA | CONTROLADOR | PERIODISTA
--                 | CAMAROGRAFO | RESPONSABLE_CLUB

CREATE TABLE IF NOT EXISTS contactos (
  id           BIGSERIAL PRIMARY KEY,
  source_block TEXT NOT NULL,
  category     TEXT NOT NULL,
  league       TEXT,
  club         TEXT,
  name         TEXT NOT NULL,
  phone        TEXT,
  role         TEXT,
  days         TEXT,
  row_index    INTEGER NOT NULL,
  extra        JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contactos_block_idx    ON contactos(source_block);
CREATE INDEX IF NOT EXISTS contactos_category_idx ON contactos(category);
CREATE INDEX IF NOT EXISTS contactos_league_idx   ON contactos(league);
CREATE INDEX IF NOT EXISTS contactos_club_idx     ON contactos(club);

CREATE TABLE IF NOT EXISTS contactos_sync_state (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  last_sync_at     TIMESTAMPTZ,
  last_count       INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_duration_ms INTEGER,
  CONSTRAINT contactos_sync_state_singleton CHECK (id = 1)
);

INSERT INTO contactos_sync_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
