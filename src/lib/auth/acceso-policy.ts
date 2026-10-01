import { urlDeSolicitud, urlDelLanzador } from 'basket-tv-ui';
import type { Role } from '@/lib/dashboards';

// This app's key in the portal catalog (auth_app.key).
export const ANALYTICS_APP = 'analytics';

export interface Session {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

// An analytics role key from the portal catalog: 'read', 'write' or 'admin'.
export interface Acceso {
  role: string;
}

export interface SessionUser extends Session {
  role: Role;
}

export type Resolution =
  | { kind: 'allow'; user: SessionUser }
  | { kind: 'login'; to: string }
  | { kind: 'no-access'; to: string };

export function portalLoginUrl(portalUrl: string, returnTo: string): string {
  if (!returnTo) return `${portalUrl}/login`;
  return `${portalUrl}/login?redirectTo=${encodeURIComponent(returnTo)}`;
}

// Catalog role → analytics role (spec #172): admin → admin, read and write →
// viewer. All dashboards admit both; the role only decides what the header shows.
export function roleFromAcceso(role: string): Role {
  return role === 'admin' ? 'admin' : 'viewer';
}

// Pure gate. No session → portal login; a portal-valid session without an
// analytics Acceso → the portal's Solicitud form for analytics
// (/no-access?app=analytics); never a refusal of its own.
export function resolveSessionUser(input: {
  session: Session | null;
  acceso: Acceso | null;
  returnTo: string;
  portalUrl: string;
}): Resolution {
  if (!input.session) return { kind: 'login', to: portalLoginUrl(input.portalUrl, input.returnTo) };
  if (!input.acceso) return { kind: 'no-access', to: urlDeSolicitud(input.portalUrl, ANALYTICS_APP) };
  return { kind: 'allow', user: { ...input.session, role: roleFromAcceso(input.acceso.role) } };
}

// Volver rule (portal #197): the way back to the apex directory shows only
// when there is something to choose, i.e. the person holds two or more apps
// in auth_effective_access (the portal included when held).
export function lanzadorUrlFor(input: { appCount: number; portalUrl: string }): string | null {
  return input.appCount >= 2 ? urlDelLanzador(input.portalUrl) : null;
}
