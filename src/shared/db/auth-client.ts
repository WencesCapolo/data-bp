import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { authUser, authSession, authAccount, authVerification } from '@/lib/auth/schema';

// Shared identity DB (basket_auth) — owned/migrated by the portal app. This is a
// SEPARATE connection from `@shared/db/client` (basket_analytics, domain data) so
// portal's sessions are found here and SSO works across *.basket-app.com.
const authSchema = { authUser, authSession, authAccount, authVerification };

const globalForAuthDb = globalThis as unknown as {
  authConnection: ReturnType<typeof postgres> | undefined;
};

function buildConnection(): ReturnType<typeof postgres> {
  const url = process.env.AUTH_DATABASE_URL;
  if (!url) throw new Error('AUTH_DATABASE_URL not set');
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  const idleTimeout = Number(process.env.DB_IDLE_TIMEOUT_S ?? 30);
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_S ?? 10);
  return postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    prepare: false,
  });
}

export const authConnection = globalForAuthDb.authConnection ?? buildConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForAuthDb.authConnection = authConnection;
}

export const authDb = drizzle(authConnection, { schema: authSchema });
export type AuthDb = typeof authDb;
