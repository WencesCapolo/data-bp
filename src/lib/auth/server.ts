import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { authDb } from '@shared/db/auth-client';
import { resolveCrossSubdomainCookieConfig } from './cookie-domain';
import { authUser, authSession, authAccount, authVerification, authAllowedEmails } from './schema';

const ALLOWED_DOMAIN = '@basquetpass.tv';

// Allowlist lives in the analytics domain DB (basket_analytics), NOT the shared
// identity DB — each app authorizes its own users independently.
async function isEmailAllowed(email: string): Promise<boolean> {
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) return false;
  const rows = await db
    .select({ email: authAllowedEmails.email })
    .from(authAllowedEmails)
    .where(eq(authAllowedEmails.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],

  // Identity tables live in the shared basket_auth DB so portal sessions are found.
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),

  emailAndPassword: { enabled: false },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      // Google `hd` hint nudges the chooser to the workspace domain.
      // Real enforcement is below in the signIn hook.
      mapProfileToUser: (profile: { hd?: string; email: string; name?: string; picture?: string }) => ({
        name: profile.name ?? profile.email,
        email: profile.email,
        image: profile.picture,
      }),
    },
  },

  databaseHooks: {
    user: {
      create: {
        // Gate analytics-initiated sign-ups. Role is NOT written here: it is
        // portal-owned on the shared user row and resolved per-app from the
        // allowlist at read time (see getSessionUser).
        before: async (user) => {
          if (!(await isEmailAllowed(user.email))) {
            throw new Error(`Email ${user.email} is not authorized to access this dashboard.`);
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        // Defense-in-depth for analytics-initiated logins where the user already
        // exists (so user.create.before never ran). authUser lives in the shared DB.
        before: async (session) => {
          const rows = await authDb
            .select({ email: authUser.email })
            .from(authUser)
            .where(eq(authUser.id, session.userId))
            .limit(1);
          const email = rows[0]?.email;
          if (!email || !(await isEmailAllowed(email))) {
            throw new Error('Email is not on the allowlist.');
          }
          return { data: session };
        },
      },
    },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    crossSubDomainCookies: resolveCrossSubdomainCookieConfig(
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    ),
  },

  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
