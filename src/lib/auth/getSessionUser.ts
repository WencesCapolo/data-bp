import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { auth } from './server';
import { authAllowedEmails } from './schema';
import type { Role } from '@/lib/dashboards';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  // Identity is shared across *.basket-app.com, so a valid session may have been
  // created by a sibling app (e.g. portal) and never passed through this app's
  // databaseHooks. Authorize against the analytics allowlist on every read, and
  // derive the role from it — never trust the shared, portal-owned authUser.role.
  const rows = await db
    .select({ role: authAllowedEmails.role })
    .from(authAllowedEmails)
    .where(eq(authAllowedEmails.email, session.user.email.toLowerCase()))
    .limit(1);
  if (rows.length === 0) return null;

  const role: Role = rows[0]?.role === 'admin' ? 'admin' : 'viewer';
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    role,
  };
}
