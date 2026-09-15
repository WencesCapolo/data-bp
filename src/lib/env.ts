// Auth config of a Session reader (portal ADR 0009, local ADR 0008): the shared
// secret, the shared Auth DB and where the portal lives. Nothing else.
const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const authEnv = {
  portalUrl: PORTAL_URL,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? '',
  authDatabaseUrl: process.env.AUTH_DATABASE_URL ?? '',
};

export function assertAuthEnv(): void {
  if (!authEnv.betterAuthSecret) throw new Error('Missing BETTER_AUTH_SECRET (must equal the portal secret).');
  if (!authEnv.authDatabaseUrl) throw new Error('Missing AUTH_DATABASE_URL (the portal Auth DB).');
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_PORTAL_URL) {
    throw new Error('Missing NEXT_PUBLIC_PORTAL_URL (the portal origin, e.g. https://portal.basket-app.com).');
  }
}
