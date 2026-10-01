import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@shared/db/auth-client', () => ({ authDb: {} }));
vi.mock('@/lib/env', () => ({ authEnv: { portalUrl: 'https://portal.basket-app.com' } }));
vi.mock('@/lib/auth/reads', () => ({ readSession: vi.fn() }));
vi.mock('@/lib/access-requests/invite', () => ({
  appUrlFromPortal: vi.fn(() => 'https://analytics.basket-app.com'),
  sendAccessInviteEmail: vi.fn(),
}));
vi.mock('@/lib/access-requests/requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-requests/requests')>()),
  readDecider: vi.fn(),
  readAppRoles: vi.fn(),
  approveAccessRequest: vi.fn(),
  rejectAccessRequest: vi.fn(),
}));

import { approveAccessRequestAction, rejectAccessRequestAction } from '@/app/actions/access-requests';
import { readSession } from '@/lib/auth/reads';
import { sendAccessInviteEmail } from '@/lib/access-requests/invite';
import {
  ALREADY_RESOLVED_NOTICE,
  AccessRequestRefusal,
  approveAccessRequest,
  readAppRoles,
  readDecider,
  rejectAccessRequest,
} from '@/lib/access-requests/requests';

const session = vi.mocked(readSession);
const decider = vi.mocked(readDecider);
const roles = vi.mocked(readAppRoles);
const approve = vi.mocked(approveAccessRequest);
const reject = vi.mocked(rejectAccessRequest);
const invite = vi.mocked(sendAccessInviteEmail);

const REQUEST_ID = '6b0f8d3e-6f4a-4c62-9a7e-2a1f5d8c9b10';
const admin = { id: 'admin-1', email: 'admin@basquetpass.tv', name: 'Admin', image: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(admin);
  roles.mockResolvedValue([
    { key: 'read', label: 'Lectura', rank: 10 },
    { key: 'write', label: 'Escritura', rank: 20 },
    { key: 'admin', label: 'Admin', rank: 30 },
  ]);
  approve.mockResolvedValue({ id: REQUEST_ID, email: 'ana@basquetpass.tv', userId: 'u1' });
});

describe('approveAccessRequestAction', () => {
  it('refuses a role above the actor rank and claims nothing', async () => {
    decider.mockResolvedValue({ rank: 20, isAdmin: true, viaSuperadmin: false });
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'admin' }));
    expect(result).toEqual({ intent: 'error', notice: 'No podés otorgar ese rol.' });
    expect(approve).not.toHaveBeenCalled();
  });

  it('refuses someone who is not an analytics admin', async () => {
    decider.mockResolvedValue({ rank: 20, isAdmin: false, viaSuperadmin: false });
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'read' }));
    expect(result.intent).toBe('error');
    expect(approve).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    session.mockResolvedValue(null);
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'read' }));
    expect(result.intent).toBe('error');
    expect(decider).not.toHaveBeenCalled();
  });

  it('refuses a Solicitud for another app', async () => {
    decider.mockResolvedValue({ rank: 30, isAdmin: true, viaSuperadmin: false });
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'facturacion', rol: 'read' }));
    expect(result.intent).toBe('error');
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves within the rank rule and emails a link to analytics', async () => {
    decider.mockResolvedValue({ rank: 30, isAdmin: true, viaSuperadmin: false });
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'admin' }));
    expect(approve).toHaveBeenCalledWith({}, { requestId: REQUEST_ID, app: 'analytics', role: 'admin', deciderId: 'admin-1' });
    expect(invite).toHaveBeenCalledWith({ to: 'ana@basquetpass.tv', appName: 'Analytics', appUrl: 'https://analytics.basket-app.com' });
    expect(result).toEqual({ intent: 'ok', notice: 'Solicitud aprobada: ana@basquetpass.tv es Admin en Analytics.' });
  });

  it('keeps the approval when the invite email fails, and says so', async () => {
    decider.mockResolvedValue({ rank: 30, isAdmin: true, viaSuperadmin: true });
    invite.mockRejectedValue(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'read' }));
    expect(result.intent).toBe('ok');
    expect(result.notice).toContain('No pudimos enviarle el correo de aviso.');
  });

  it('tells the losing decider of a race the Solicitud was already resolved', async () => {
    decider.mockResolvedValue({ rank: 30, isAdmin: true, viaSuperadmin: false });
    approve.mockRejectedValue(new AccessRequestRefusal(ALREADY_RESOLVED_NOTICE));
    const result = await approveAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics', rol: 'read' }));
    expect(result).toEqual({ intent: 'error', notice: 'Esta solicitud ya fue resuelta.' });
    expect(invite).not.toHaveBeenCalled();
  });
});

describe('rejectAccessRequestAction', () => {
  it('rejects for an analytics admin', async () => {
    decider.mockResolvedValue({ rank: 30, isAdmin: true, viaSuperadmin: false });
    const result = await rejectAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics' }));
    expect(reject).toHaveBeenCalledWith({}, { requestId: REQUEST_ID, app: 'analytics', deciderId: 'admin-1' });
    expect(result).toEqual({ intent: 'ok', notice: 'Solicitud rechazada.' });
  });

  it('refuses someone who is not an analytics admin', async () => {
    decider.mockResolvedValue(null);
    const result = await rejectAccessRequestAction(form({ solicitudId: REQUEST_ID, app: 'analytics' }));
    expect(result.intent).toBe('error');
    expect(reject).not.toHaveBeenCalled();
  });
});
