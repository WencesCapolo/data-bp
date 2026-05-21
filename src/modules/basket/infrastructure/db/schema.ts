import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const basketTeams = pgTable('basket_teams', {
  id: integer('id').primaryKey(),
  teamName: text('team_name').notNull(),
  league: text('league').notNull(),
  country: text('country').notNull(),
  tier: smallint('tier').notNull().default(1),
  type: text('type').notNull().default('regular'),
}, (table) => ({
  leagueIdx: index('basket_teams_league_idx').on(table.league),
  countryIdx: index('basket_teams_country_idx').on(table.country),
}));

export const basketLeagues = pgTable('basket_leagues', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  country: text('country').notNull(),
  tier: smallint('tier').notNull().default(1),
  isMain: boolean('is_main').notNull().default(false),
});

export const basketUsers = pgTable('basket_users', {
  id: integer('id').primaryKey(),
  idx: text('idx'),
  email: text('email'),
  firstname: text('firstname'),
  lastname: text('lastname'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  loginAt: timestamp('login_at', { withTimezone: true }),
  status: smallint('status').notNull().default(0),
  lastStatus: bigint('last_status', { mode: 'number' }),
  promoTeamId: integer('promo_team_id'),
  promoTeamChangedAt: timestamp('promo_team_changed_at', { withTimezone: true }),
  playToken: bigint('play_token', { mode: 'number' }),
  roles: integer('roles'),
  country: text('country'),
  emailVerified: boolean('email_verified').notNull().default(false),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  countryIdx: index('basket_users_country_idx').on(table.country),
  promoTeamIdx: index('basket_users_promo_team_idx').on(table.promoTeamId),
  statusIdx: index('basket_users_status_idx').on(table.status),
}));

export const basketPayments = pgTable('basket_payments', {
  id: integer('id').primaryKey(),
  idx: text('idx'),
  userId: integer('user_id').notNull(),
  paymentEmail: text('payment_email'),
  platformPaymentId: text('platform_payment_id'),
  platform: smallint('platform').notNull(),
  productId: integer('product_id'),
  priceId: integer('price_id'),
  contentId: integer('content_id'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 10 }),
  recurrent: smallint('recurrent').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  status: smallint('status').notNull().default(0),
  statusDetail: text('status_detail'),
  keycode: text('keycode'),
  paymentCountry: text('payment_country'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  userIdIdx: index('basket_payments_user_id_idx').on(table.userId),
  createdAtIdx: index('basket_payments_created_at_idx').on(table.createdAt),
  expiresAtIdx: index('basket_payments_expires_at_idx').on(table.expiresAt),
  statusExpiresIdx: index('basket_payments_status_expires_idx').on(table.status, table.expiresAt),
  platformIdx: index('basket_payments_platform_idx').on(table.platform),
}));

export const basketFixtures = pgTable('basket_fixtures', {
  id: integer('id').primaryKey(),
  league: text('league').notNull(),
  season: text('season').notNull(),
  phase: text('phase').notNull(),
  stageNormalized: text('stage_normalized').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
}, (table) => ({
  leagueIdx: index('basket_fixtures_league_idx').on(table.league),
  datesIdx: index('basket_fixtures_dates_idx').on(table.startDate, table.endDate),
}));

export const basketTournaments = pgTable('basket_tournaments', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  country: text('country'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  countryIdx: index('basket_tournaments_country_idx').on(table.country),
}));

export const basketContent = pgTable('basket_content', {
  id: integer('id').primaryKey(),
  idx: text('idx'),
  title: text('title'),
  summary: text('summary'),
  imageId: text('image_id'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  date: timestamp('date', { withTimezone: true }),
  dateEnds: timestamp('date_ends', { withTimezone: true }),
  dateServerSpawns: timestamp('date_server_spawns', { withTimezone: true }),
  dateServerGoesLive: timestamp('date_server_goes_live', { withTimezone: true }),
  duration: integer('duration'),
  status: smallint('status'),
  type: smallint('type'),
  matchId: text('match_id'),
  venue: text('venue'),
  team1: integer('team_1'),
  team2: integer('team_2'),
  team1Name: text('team_1_name'),
  team2Name: text('team_2_name'),
  team1Score: integer('team_1_score'),
  team2Score: integer('team_2_score'),
  matchStatus: text('match_status'),
  tournamentId: integer('tournament_id'),
  country: text('country'),
  productId: integer('product_id'),
  weight: integer('weight'),
  views: bigint('views', { mode: 'number' }),
  viewsUsers: bigint('views_users', { mode: 'number' }),
  viewsSeconds: bigint('views_seconds', { mode: 'number' }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  tournamentIdx: index('basket_content_tournament_idx').on(table.tournamentId),
  countryIdx: index('basket_content_country_idx').on(table.country),
  dateIdx: index('basket_content_date_idx').on(table.date),
}));

export const basketFixtureMatches = pgTable('basket_fixture_matches', {
  id: integer('id').primaryKey(),
  matchDate: timestamp('match_date', { mode: 'date' }),
  matchTime: text('match_time'),
  homeTeam: text('home_team'),
  awayTeam: text('away_team'),
  venue: text('venue'),
  broadcaster: text('broadcaster'),
  sourceSheet: text('source_sheet').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  dateIdx: index('basket_fixture_matches_date_idx').on(table.matchDate),
  sourceIdx: index('basket_fixture_matches_source_idx').on(table.sourceSheet),
}));

export const basketSheetRows = pgTable('basket_sheet_rows', {
  sheet: text('sheet').notNull(),
  rowKey: text('row_key').notNull(),
  data: jsonb('data').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.sheet, table.rowKey] }),
  sheetIdx: index('basket_sheet_rows_sheet_idx').on(table.sheet),
}));

export const basketTeamMaster = pgTable('basket_team_master', {
  workbookLabel: text('workbook_label').notNull(),
  nameFull: text('name_full').notNull(),
  nameShort: text('name_short'),
  siglas: text('siglas'),
  stadium: text('stadium'),
  city: text('city'),
  officialPage: text('official_page'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.workbookLabel, table.nameFull] }),
  siglasIdx: index('basket_team_master_siglas_idx').on(table.siglas),
}));

export const basketCambiosEnum = pgTable('basket_cambios_enum', {
  workbookLabel: text('workbook_label').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.workbookLabel, table.label] }),
}));

export const basketDiasEnum = pgTable('basket_dias_enum', {
  workbookLabel: text('workbook_label').notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.workbookLabel, table.label] }),
}));

export const basketSyncState = pgTable('basket_sync_state', {
  source: text('source').primaryKey(),
  lastSync: timestamp('last_sync', { withTimezone: true }).notNull(),
  rowCount: integer('row_count'),
});
