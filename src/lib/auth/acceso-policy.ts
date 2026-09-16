import type { AccesoLevel } from '@/lib/auth/schema';
import type { Role } from '@/lib/dashboards';

export interface Session {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export interface Acceso {
  level: AccesoLevel;
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

// Nivel → analytics role (spec #172): admin → admin, read and write → viewer.
// All dashboards admit both roles; the role only decides what the header shows.
export function roleFromNivel(level: AccesoLevel): Role {
  return level === 'admin' ? 'admin' : 'viewer';
}

// Pure gate. No session → portal login; a portal-valid session without an
// analytics Acceso → portal /no-access; never a refusal of its own.
export function resolveSessionUser(input: {
  session: Session | null;
  acceso: Acceso | null;
  returnTo: string;
  portalUrl: string;
}): Resolution {
  if (!input.session) return { kind: 'login', to: portalLoginUrl(input.portalUrl, input.returnTo) };
  if (!input.acceso) return { kind: 'no-access', to: `${input.portalUrl}/no-access` };
  return { kind: 'allow', user: { ...input.session, role: roleFromNivel(input.acceso.level) } };
}
