import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/reads', () => ({ readSession: vi.fn(), readAnalyticsAcceso: vi.fn() }));
vi.mock('@/lib/env', () => ({ authEnv: { portalUrl: 'https://portal.basket-app.com' } }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-url': 'https://analytics.basket-app.com/financiero' })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

import { readAnalyticsAcceso, readSession } from '@/lib/auth/reads';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { requireDashboard, requireSession } from '@/lib/auth/rbac';

const session = vi.mocked(readSession);
const acceso = vi.mocked(readAnalyticsAcceso);
const ana = { id: 'u1', email: 'ana@basquetpass.tv', name: 'Ana', image: null };

beforeEach(() => {
  session.mockReset();
  acceso.mockReset();
});

describe('requireSession (pages)', () => {
  it('redirects to the portal login with the requested URL when there is no session', async () => {
    session.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow(
      `REDIRECT https://portal.basket-app.com/login?redirectTo=${encodeURIComponent('https://analytics.basket-app.com/financiero')}`,
    );
    expect(acceso).not.toHaveBeenCalled();
  });

  it('redirects to the portal no-access page when the session has no analytics row', async () => {
    session.mockResolvedValue(ana);
    acceso.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow('REDIRECT https://portal.basket-app.com/no-access');
  });

  it('returns the user with the role derived from the Nivel', async () => {
    session.mockResolvedValue(ana);
    acceso.mockResolvedValue({ level: 'read' });
    await expect(requireSession()).resolves.toEqual({ ...ana, role: 'viewer' });
    expect(acceso).toHaveBeenCalledWith('u1');
  });
});

describe('requireDashboard', () => {
  it('admits a viewer to every dashboard', async () => {
    session.mockResolvedValue(ana);
    acceso.mockResolvedValue({ level: 'write' });
    await expect(requireDashboard('partidos')).resolves.toMatchObject({ role: 'viewer' });
  });
});

describe('getSessionUser (API routes)', () => {
  it('answers null, not a redirect, when there is no Acceso', async () => {
    session.mockResolvedValue(ana);
    acceso.mockResolvedValue(null);
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it('answers the admin user for Nivel admin', async () => {
    session.mockResolvedValue(ana);
    acceso.mockResolvedValue({ level: 'admin' });
    await expect(getSessionUser()).resolves.toEqual({ ...ana, role: 'admin' });
  });
});
