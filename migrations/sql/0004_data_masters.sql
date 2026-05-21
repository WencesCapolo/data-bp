-- Phase 8.5: workbook DATA tabs → team / cambios / dias masters.
-- Each workbook DATA tab is a multi-column-block layout (teams roster,
-- cambios enum, dias enum). Parser yields these three lists per workbook.

CREATE TABLE IF NOT EXISTS basket_team_master (
  workbook_label  TEXT NOT NULL,
  name_full       TEXT NOT NULL,
  name_short      TEXT,
  siglas          TEXT,
  stadium         TEXT,
  city            TEXT,
  official_page   TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workbook_label, name_full)
);
CREATE INDEX IF NOT EXISTS basket_team_master_siglas_idx ON basket_team_master(siglas);

CREATE TABLE IF NOT EXISTS basket_cambios_enum (
  workbook_label  TEXT NOT NULL,
  label           TEXT NOT NULL,
  position        INTEGER NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workbook_label, label)
);

CREATE TABLE IF NOT EXISTS basket_dias_enum (
  workbook_label  TEXT NOT NULL,
  label           TEXT NOT NULL,
  position        INTEGER NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workbook_label, label)
);
