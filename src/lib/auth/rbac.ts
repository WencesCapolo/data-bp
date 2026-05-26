import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './getSessionUser';
import { findDashboard, type Role } from '@/lib/dashboards';

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  return user;
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== role) redirect('/?denied=1');
  return user;
}

export async function requireDashboard(slug: string): Promise<SessionUser> {
  const user = await requireSession();
  const dash = findDashboard(slug);
  if (!dash) redirect('/');
  if (!dash.roles.includes(user.role)) redirect(`/?denied=${slug}`);
  return user;
}
