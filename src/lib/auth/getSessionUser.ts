import { cache } from 'react';
import { headers } from 'next/headers';
import { addFields } from 'basket-tv-telemetry/log';
import { authEnv } from '@/lib/env';
import { resolveSessionUser, type Resolution, type SessionUser } from './acceso-policy';
import { readAnalyticsAcceso, readSession } from './reads';

export type { SessionUser } from './acceso-policy';

// Set by the proxy for every matched route; empty means "no return URL", and
// the portal then lands the person on their default page.
async function requestedUrl(): Promise<string> {
  return (await headers()).get('x-url') ?? '';
}

// Session + analytics Acceso, resolved on every request. The role comes from
// the Nivel of the `analytics` row, never from the portal-owned authUser.role.
// Cached per request: the Marco layout and the page both ask.
export const resolveRequestUser = cache(async (): Promise<Resolution> => {
  const session = await readSession();
  const acceso = session ? await readAnalyticsAcceso(session.id) : null;
  return resolveSessionUser({ session, acceso, returnTo: await requestedUrl(), portalUrl: authEnv.portalUrl });
});

// For API routes: null when there is no session or no Acceso (they answer 401).
// Pages use requireSession, which redirects instead. The user goes on the
// request's log line.
export async function getSessionUser(): Promise<SessionUser | null> {
  const r = await resolveRequestUser();
  if (r.kind !== 'allow') return null;
  addFields({ user_id: r.user.id, role: r.user.role });
  return r.user;
}
