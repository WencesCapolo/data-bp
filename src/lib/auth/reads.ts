import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { authDb } from '@shared/db/auth-client';
import type { Acceso, Session } from './acceso-policy';
import { authEffectiveAccess } from './schema';
import { auth } from './server';

// Session read seam: the only Better Auth call this app makes.
export async function readSession(): Promise<Session | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
  };
}

// Acceso read seam: one uncached row per request, so a revoke denies next hit.
// Reads the effective-access view, so a super admin resolves to the admin role.
export async function readAnalyticsAcceso(userId: string): Promise<Acceso | null> {
  const rows = await authDb
    .select({ role: authEffectiveAccess.role })
    .from(authEffectiveAccess)
    .where(and(eq(authEffectiveAccess.userId, userId), eq(authEffectiveAccess.app, 'analytics')))
    .limit(1);
  return rows[0] ?? null;
}
