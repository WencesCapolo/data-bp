import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/telemetry', () => ({ reportServerError: vi.fn() }));
vi.mock('@basket/infrastructure/sync/composeRunSync', () => ({ composeRunSync: vi.fn(async () => ({})) }));
vi.mock('@basket/infrastructure/sync/runLoggedSync', () => ({ runLoggedSync: vi.fn() }));
vi.mock('@basket/infrastructure/db/repositories/DrizzleSyncStateRepository', () => ({
  DrizzleSyncStateRepository: class {
    findAll = vi.fn(async () => []);
  },
}));

import { reportServerError } from '@/lib/telemetry';
import { runLoggedSync } from '@basket/infrastructure/sync/runLoggedSync';
import { GET, POST } from './route';

const report = vi.mocked(reportServerError);
const run = vi.mocked(runLoggedSync);
const post = () => new NextRequest('http://localhost/api/basket/sync', { method: 'POST' });

describe('POST /api/basket/sync', () => {
  beforeEach(() => {
    report.mockReset();
    run.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports a failing sync once, as a job', async () => {
    const err = new Error('connection terminated');
    run.mockRejectedValue(err);

    expect((await POST(post())).status).toBe(202);
    await vi.waitFor(async () => expect((await (await GET()).json()).inFlight).toBe(false));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(err, { routeType: 'job', route: 'basket-sync' });
    expect((await (await GET()).json()).lastError).toBe('connection terminated');
  });

  it('reports each step the sync survived without, by step', async () => {
    run.mockResolvedValue({ failedSteps: [{ step: 'fx', error: 'timeout after 30000ms' }] } as never);

    await POST(post());
    await vi.waitFor(async () => expect((await (await GET()).json()).inFlight).toBe(false));

    expect(report).toHaveBeenCalledTimes(1);
    const [reported, context] = report.mock.calls[0]!;
    expect((reported as Error).name).toBe('SyncStepError');
    expect(context).toEqual({ routeType: 'job', route: 'basket-sync', step: 'fx' });
  });
});
