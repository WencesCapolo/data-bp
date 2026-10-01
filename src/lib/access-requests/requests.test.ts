import { describe, expect, it, vi } from 'vitest';
import { ALREADY_RESOLVED_NOTICE, AccessRequestRefusal, claimAccessRequest } from '@/lib/access-requests/requests';

// An executor whose UPDATE … RETURNING answers the given rows, recording the
// values it was asked to set.
function fakeExecutor(returned: { id: string; email: string; userId: string }[]) {
  const set = vi.fn();
  const exec = {
    update: () => ({
      set: (values: unknown) => {
        set(values);
        return { where: () => ({ returning: async () => returned }) };
      },
    }),
  };
  return { exec: exec as unknown as Parameters<typeof claimAccessRequest>[0], set };
}

const claim = { id: 'r1', app: 'analytics', outcome: 'aprobada' as const, deciderId: 'admin', grantedRole: 'read' };

describe('claimAccessRequest', () => {
  it('returns the claimed row with a normalized email', async () => {
    const { exec, set } = fakeExecutor([{ id: 'r1', email: ' Ana@Basquetpass.TV ', userId: 'u1' }]);
    await expect(claimAccessRequest(exec, claim)).resolves.toEqual({ id: 'r1', email: 'ana@basquetpass.tv', userId: 'u1' });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'aprobada', decidedBy: 'admin', grantedRole: 'read' }));
  });

  it('tells the losing decider the Solicitud was already resolved when no pending row matched', async () => {
    const { exec } = fakeExecutor([]);
    const result = claimAccessRequest(exec, claim);
    await expect(result).rejects.toBeInstanceOf(AccessRequestRefusal);
    await expect(result).rejects.toThrow(ALREADY_RESOLVED_NOTICE);
  });
});
