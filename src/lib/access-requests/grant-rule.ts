// Who may decide this app's Solicitudes, and which roles they may hand out.
// Same rule as the portal's canGrantRole (portal src/lib/roles.ts), on the
// ranks of auth_app_role: higher outranks lower within one app.

// The decider's row in auth_effective_access for this app.
export interface Decider {
  rank: number;
  isAdmin: boolean;
  viaSuperadmin: boolean;
}

export interface CatalogRole {
  key: string;
  label: string;
  rank: number;
}

// The app's admins (is_admin in this app) and super admins; nobody else sees
// the bell or may call its actions.
export function canDecide(decider: Decider | null): decider is Decider {
  return Boolean(decider && (decider.isAdmin || decider.viaSuperadmin));
}

// Roles ranked below the decider's; the app's admin role also reaches its own
// rank; a super admin grants anything.
export function canGrantRole(decider: Decider | null, role: Pick<CatalogRole, 'rank'>): boolean {
  if (!canDecide(decider)) return false;
  if (decider.viaSuperadmin) return true;
  return decider.isAdmin ? role.rank <= decider.rank : role.rank < decider.rank;
}

export function grantableRoles<R extends CatalogRole>(decider: Decider | null, roles: readonly R[]): R[] {
  return roles.filter((role) => canGrantRole(decider, role));
}
