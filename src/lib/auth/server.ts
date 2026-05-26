import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { authUser, authSession, authAccount, authVerification, authAllowedEmails } from './schema';

const ALLOWED_DOMAIN = '@basquetpass.tv';

async function isEmailAllowed(email: string): Promise<boolean> {
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) return false;
  const rows = await db
    .select({ email: authAllowedEmails.email })
    .from(authAllowedEmails)
    .where(eq(authAllowedEmails.email, email.toLowerCase()))
    .limit(1);
  return rows.length > 0;
}

async function roleForEmail(email: string): Promise<'admin' | 'viewer'> {
  const rows = await db
    .select({ role: authAllowedEmails.role })
    .from(authAllowedEmails)
    .where(eq(authAllowedEmails.email, email.toLowerCase()))
    .limit(1);
  const r = rows[0]?.role;
  return r === 'admin' ? 'admin' : 'viewer';
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'],

  database: drizzleAdapter(db, {
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
        before: async (user) => {
          if (!(await isEmailAllowed(user.email))) {
            throw new Error(`Email ${user.email} is not authorized to access this dashboard.`);
          }
          const role = await roleForEmail(user.email);
          return { data: { ...user, role } };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const rows = await db
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
  },

  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
