import { pgTable, pgView, integer, text, timestamp, boolean } from 'drizzle-orm/pg-core';

// ── Shared identity tables (basket_auth) ────────────────────────────────────
// These MUST mirror the portal-owned physical schema exactly (drizzle/auth in the
// portal repo): timestamps WITHOUT timezone, no DB defaults (Better Auth supplies
// every value), `auth_user.role` nullable + admin-plugin ban columns,
// `auth_session.impersonated_by`. Accessed through `@shared/db/auth-client`.
export const authUser = pgTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  role: text('role'),
  banned: boolean('banned'),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
});

export const authSession = pgTable('auth_session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  impersonatedBy: text('impersonated_by'),
});

export const authAccount = pgTable('auth_account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const authVerification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

// ── Effective access (basket_auth, portal-owned view) ──────────────────────
// One row per identity and app (ADR 0010 in the portal repo): the granted role,
// or the app's admin role for a super admin who isn't banned. Analytics reads
// its own row (app = 'analytics') on every request; the portal writes grants.
export const authEffectiveAccess = pgView('auth_effective_access', {
  userId: text('user_id').notNull(),
  app: text('app').notNull(),
  role: text('role').notNull(),
  rank: integer('rank').notNull(),
  isAdmin: boolean('is_admin').notNull(),
  viaSuperadmin: boolean('via_superadmin').notNull(),
}).existing();
