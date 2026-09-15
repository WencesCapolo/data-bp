import { redirect } from 'next/navigation';
import { resolveRequestUser } from './getSessionUser';
import type { SessionUser } from './acceso-policy';
import { findDashboard } from '@/lib/dashboards';

export type { SessionUser };

// Page gate. No session → portal login (with the requested URL so the person
// comes back here); session without analytics Acceso → portal /no-access.
export async function requireSession(): Promise<SessionUser> {
  const r = await resolveRequestUser();
  if (r.kind !== 'allow') redirect(r.to);
  return r.user;
}

export async function requireDashboard(slug: string): Promise<SessionUser> {
  const user = await requireSession();
  const dash = findDashboard(slug);
  if (!dash) redirect('/');
  if (!dash.roles.includes(user.role)) redirect(`/?denied=${slug}`);
  return user;
}
