import { sql } from 'drizzle-orm';
import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const contactos = pgTable(
  'contactos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceBlock: text('source_block').notNull(),
    category: text('category').notNull(),
    league: text('league'),
    club: text('club'),
    name: text('name').notNull(),
    phone: text('phone'),
    role: text('role'),
    days: text('days'),
    rowIndex: integer('row_index').notNull(),
    extra: jsonb('extra').notNull().default(sql`'{}'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (table) => ({
    blockIdx: index('contactos_block_idx').on(table.sourceBlock),
    categoryIdx: index('contactos_category_idx').on(table.category),
    leagueIdx: index('contactos_league_idx').on(table.league),
    clubIdx: index('contactos_club_idx').on(table.club),
  }),
);

export const contactosSyncState = pgTable('contactos_sync_state', {
  id: integer('id').primaryKey().default(1),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastCount: integer('last_count').notNull().default(0),
  lastError: text('last_error'),
  lastDurationMs: integer('last_duration_ms'),
});
