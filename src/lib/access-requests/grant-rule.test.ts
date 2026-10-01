import { describe, expect, it } from 'vitest';
import { canDecide, canGrantRole, grantableRoles, type Decider } from '@/lib/access-requests/grant-rule';

const roles = [
  { key: 'read', label: 'Lectura', rank: 10 },
  { key: 'write', label: 'Escritura', rank: 20 },
  { key: 'admin', label: 'Admin', rank: 30 },
];

const appAdmin: Decider = { rank: 30, isAdmin: true, viaSuperadmin: false };
const writer: Decider = { rank: 20, isAdmin: false, viaSuperadmin: false };
const superAdmin: Decider = { rank: 30, isAdmin: true, viaSuperadmin: true };

describe('canDecide', () => {
  it('admits the app admin and a super admin', () => {
    expect(canDecide(appAdmin)).toBe(true);
    expect(canDecide(superAdmin)).toBe(true);
  });

  it('refuses anyone else, and someone without an Acceso', () => {
    expect(canDecide(writer)).toBe(false);
    expect(canDecide(null)).toBe(false);
  });
});

describe('canGrantRole', () => {
  it('lets the app admin role reach its own rank', () => {
    expect(grantableRoles(appAdmin, roles).map((r) => r.key)).toEqual(['read', 'write', 'admin']);
  });

  it('refuses a role above the actor rank', () => {
    expect(canGrantRole({ rank: 20, isAdmin: true, viaSuperadmin: false }, { rank: 30 })).toBe(false);
  });

  it('refuses a non-decider even below their rank', () => {
    expect(grantableRoles(writer, roles)).toEqual([]);
  });

  it('lets a super admin grant anything', () => {
    expect(canGrantRole({ rank: 0, isAdmin: false, viaSuperadmin: true }, { rank: 999 })).toBe(true);
  });
});
