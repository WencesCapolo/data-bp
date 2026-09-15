import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authDb } from '@shared/db/auth-client';
import { resolveCrossSubdomainCookieConfig } from './cookie-domain';
import { authUser, authSession, authAccount, authVerification } from './schema';
import { assertAuthEnv, authEnv } from '@/lib/env';

assertAuthEnv();

// Session reader only (portal ADR 0009, local ADR 0008). Same secret, same Auth
// DB, same cookie domain and cookie cache as the portal, so its session cookie
// verifies here. No plugins, no /api/auth route, no login UI: the only call is
// auth.api.getSession({ headers }). Sign-out is a link to the portal.
const SIXTY_DAYS_SECONDS = 60 * 60 * 24 * 60;
const ONE_DAY_SECONDS = 60 * 60 * 24;

export const auth = betterAuth({
  secret: authEnv.betterAuthSecret,
  // The portal origin: cookie name prefix and domain must match what it set.
  baseURL: authEnv.portalUrl,
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),
  session: {
    expiresIn: SIXTY_DAYS_SECONDS,
    updateAge: ONE_DAY_SECONDS,
    cookieCache: { enabled: true, maxAge: 60 },
  },
  advanced: {
    crossSubDomainCookies: resolveCrossSubdomainCookieConfig(authEnv.portalUrl),
  },
});
