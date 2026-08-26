import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
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

// Provenance for every confirmed Pagos Export upload. See docs/adr/0004.
export const basketPaymentUploads = pgTable('basket_payment_uploads', {
  id: serial('id').primaryKey(),
  uploadedBy: text('uploaded_by').notNull(),
  filename: text('filename').notNull(),
  byteSize: integer('byte_size').notNull(),
  rowTotal: integer('row_total').notNull(),
  rowsIngested: integer('rows_ingested').notNull(),
  rowsSkipped: integer('rows_skipped').notNull(),
  windowFrom: timestamp('window_from', { withTimezone: true }),
  windowTo: timestamp('window_to', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  createdAtIdx: index('basket_payment_uploads_created_at_idx').on(table.createdAt),
}));

// Tier fallback for uploaded Pagos, which carry no price_id. A price book of
// exact current price points, mined from labelled rows — amount ranges cannot
// be used, because ARS inflation pushed today's Básico price above yesterday's
// Total price. Monthly only: the view resolves 365 and 0 without price.
// See docs/adr/0003.
export const basketPriceTiers = pgTable('basket_price_tiers', {
  currency: varchar('currency', { length: 10 }).notNull(),
  recurrent: smallint('recurrent').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  subType: text('sub_type').notNull(),
  note: text('note'),
}, (table) => ({
  pk: primaryKey({ columns: [table.currency, table.recurrent, table.amount] }),
}));

// One row per gateway transaction, as the gateway reports it: commission, net
// and the settlement-currency plane. Keyed by (platform, platformPaymentId) and
// intentionally not FK'd to basketPayments — the gateways answer with
// transactions this mirror may not have ingested. See docs/adr/0005.
export const basketPaymentFees = pgTable('basket_payment_fees', {
  platform: smallint('platform').notNull(),
  platformPaymentId: text('platform_payment_id').notNull(),
  grossAmount: numeric('gross_amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull(),
  feeAmount: numeric('fee_amount', { precision: 14, scale: 2 }).notNull(),
  // Tax withheld at source. NULL where the gateway withholds none (Stripe), not
  // 0 — 0 would claim we know there was none. See migrations/sql/0015.
  taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }),
  netAmount: numeric('net_amount', { precision: 14, scale: 2 }).notNull(),
  settlementCurrency: varchar('settlement_currency', { length: 10 }).notNull(),
  settlementAmount: numeric('settlement_amount', { precision: 14, scale: 2 }).notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 20, scale: 10 }),
  refundedAmount: numeric('refunded_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  gatewayStatus: text('gateway_status'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  // charge -> invoice -> subscription. Both NULL for one-off charges, which
  // have no invoice at all. See docs/adr/0005.
  invoiceId: text('invoice_id'),
  subscriptionId: text('subscription_id'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.platform, table.platformPaymentId] }),
  capturedAtIdx: index('basket_payment_fees_captured_at_idx').on(table.capturedAt),
}));

// One row per gateway subscription. The only source that states churn outright
// (status, cancelAtPeriodEnd, canceledAt, endedAt) instead of inferring it from
// the gap since the last payment. Refreshed in full each sync — a cancellation
// today can belong to a subscription created years ago. See docs/adr/0005.
export const basketGatewaySubscriptions = pgTable('basket_gateway_subscriptions', {
  platform: smallint('platform').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  customerId: text('customer_id'),
  status: text('status').notNull(),
  currency: varchar('currency', { length: 10 }),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  interval: text('interval'),
  intervalCount: smallint('interval_count'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  cancelAt: timestamp('cancel_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.platform, table.subscriptionId] }),
  statusIdx: index('basket_gateway_subscriptions_status_idx').on(table.status),
  customerIdx: index('basket_gateway_subscriptions_customer_idx').on(table.customerId),
}));

// One row per gateway customer. Exists for customer_id -> email, the only
// bridge between a gateway object (subscription, dispute) and a Subscriber.
// Refreshed in full each sync: email and country change long after creation and
// the list endpoint filters on `created` only. See migrations/sql/0014.
export const basketGatewayCustomers = pgTable('basket_gateway_customers', {
  platform: smallint('platform').notNull(),
  customerId: text('customer_id').notNull(),
  email: text('email'),
  name: text('name'),
  country: varchar('country', { length: 2 }),
  currency: varchar('currency', { length: 10 }),
  delinquent: boolean('delinquent'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.platform, table.customerId] }),
}));

// One row per dispute (chargeback). amount/currency are PRESENTMENT — the
// disputed amount as the Subscriber was charged — while feeAmount is the
// gateway's non-refundable case fee in the SETTLEMENT plane. The two must never
// be added. platformPaymentId is the same join key basketPaymentFees uses.
export const basketGatewayDisputes = pgTable('basket_gateway_disputes', {
  platform: smallint('platform').notNull(),
  disputeId: text('dispute_id').notNull(),
  platformPaymentId: text('platform_payment_id').notNull(),
  chargeId: text('charge_id'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  feeAmount: numeric('fee_amount', { precision: 14, scale: 2 }),
  settlementCurrency: varchar('settlement_currency', { length: 10 }),
  isChargeRefundable: boolean('is_charge_refundable'),
  evidenceDueBy: timestamp('evidence_due_by', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.platform, table.disputeId] }),
  paymentIdx: index('basket_gateway_disputes_payment_idx').on(table.platform, table.platformPaymentId),
  createdAtIdx: index('basket_gateway_disputes_created_at_idx').on(table.createdAt),
}));

// One row per payout — money leaving the gateway for the bank. Pure SETTLEMENT
// plane; it has no presentment side. arrivalDate is the bank's date and the one
// a reconciliation is done against; createdAt is when the payout was scheduled.
export const basketGatewayPayouts = pgTable('basket_gateway_payouts', {
  platform: smallint('platform').notNull(),
  payoutId: text('payout_id').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull(),
  status: text('status').notNull(),
  type: text('type'),
  method: text('method'),
  automatic: boolean('automatic'),
  arrivalDate: timestamp('arrival_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  description: text('description'),
  statementDescriptor: text('statement_descriptor'),
  failureCode: text('failure_code'),
  balanceTransactionId: text('balance_transaction_id'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.platform, table.payoutId] }),
  arrivalDateIdx: index('basket_gateway_payouts_arrival_date_idx').on(table.arrivalDate),
}));

// One row per (day, pair, source). `rate` is quote units per one base unit —
// (USD, ARS, 'blue') is ARS per USD, (UYU, USD, 'stripe') is USD per UYU — so
// the direction is read off the key and never inferred from the magnitude.
// `source` is in the key because two rates for one day are both correct and
// disagree: Stripe converted at its own rate, ARS converts at the blue rate.
// See migrations/sql/0017 and docs/adr/0007.
export const basketFxRates = pgTable('basket_fx_rates', {
  day: date('day').notNull(),
  baseCurrency: varchar('base_currency', { length: 10 }).notNull(),
  quoteCurrency: varchar('quote_currency', { length: 10 }).notNull(),
  source: text('source').notNull(),
  rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
  /** The compra side of the same quote. Carried for audit, never converted with. */
  buyRate: numeric('buy_rate', { precision: 20, scale: 10 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
}, (table) => ({
  pk: primaryKey({ columns: [table.day, table.baseCurrency, table.quoteCurrency, table.source] }),
  pairIdx: index('basket_fx_rates_pair_idx').on(
    table.baseCurrency, table.quoteCurrency, table.source, table.day,
  ),
}));
