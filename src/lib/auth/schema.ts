import { pgTable, pgEnum, primaryKey, text, timestamp, boolean } from 'drizzle-orm/pg-core';

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

// ── Acceso (basket_auth, portal-owned) ───────────────────────────────────────
// One identity's Nivel in one sibling app. Analytics reads its own row
// (app = 'analytics') on every request; the portal writes it.
export const appAccessApp = pgEnum('auth_app_access_app', ['analytics', 'incidencias', 'generator', 'ops']);

export const appAccessLevel = pgEnum('auth_app_access_level', ['read', 'write', 'admin']);

export const authAppAccess = pgTable(
  'auth_app_access',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    app: appAccessApp('app').notNull(),
    level: appAccessLevel('level').notNull(),
    grantedBy: text('granted_by').references(() => authUser.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.app] })],
);

export type AccesoLevel = (typeof appAccessLevel.enumValues)[number];
