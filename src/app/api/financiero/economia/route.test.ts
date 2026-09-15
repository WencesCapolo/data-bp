import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Only the two auth seams and the Domain DB composition are mocked; the gate
// itself (getSessionUser → resolveSessionUser) runs for real.
vi.mock('@/lib/auth/reads', () => ({ readSession: vi.fn(), readAnalyticsAcceso: vi.fn() }));
vi.mock('@/lib/env', () => ({ authEnv: { portalUrl: 'https://portal.basket-app.com' } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/api/composeRepo', () => ({ composeRepo: vi.fn(() => ({})) }));
vi.mock('@basket/core/use-cases/queries/GetEconomiaUseCase', () => ({
  GetEconomiaUseCase: class {
    execute = vi.fn(async () => ({ ok: true }));
  },
}));

import { readAnalyticsAcceso, readSession } from '@/lib/auth/reads';
import { GET } from './route';

const session = vi.mocked(readSession);
const acceso = vi.mocked(readAnalyticsAcceso);
const req = () => new NextRequest('https://analytics.basket-app.com/api/financiero/economia?range=all');

beforeEach(() => {
  session.mockReset();
  acceso.mockReset();
});

describe('GET /api/financiero/economia', () => {
  it('answers 401 JSON, not a redirect, without a session', async () => {
    session.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('answers 401 for a portal session without analytics Acceso', async () => {
    session.mockResolvedValue({ id: 'u1', email: 'x@basquetpass.tv', name: 'X', image: null });
    acceso.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it('serves a lectura Analyst', async () => {
    session.mockResolvedValue({ id: 'u1', email: 'x@basquetpass.tv', name: 'X', image: null });
    acceso.mockResolvedValue({ level: 'read' });
    expect((await GET(req())).status).toBe(200);
  });
});
