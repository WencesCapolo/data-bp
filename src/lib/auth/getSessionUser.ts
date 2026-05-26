import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { auth } from './server';
import { authUser } from './schema';
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
  const rows = await db
    .select({ role: authUser.role })
    .from(authUser)
    .where(eq(authUser.id, session.user.id))
    .limit(1);
  const role = (rows[0]?.role ?? 'viewer') as Role;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    role,
  };
}
