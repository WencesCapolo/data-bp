import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@basket/infrastructure/sync/runLoggedSync', () => ({ runLoggedSync: vi.fn() }));
vi.mock('@basket/infrastructure/db/repositories/DrizzleSyncStateRepository', () => ({
  DrizzleSyncStateRepository: class {
    findAll = vi.fn(async () => []);
  },
}));

import { runLoggedSync } from '@basket/infrastructure/sync/runLoggedSync';
import { GET, POST } from './route';

const run = vi.mocked(runLoggedSync);
const ctx = { params: Promise.resolve({}) };
const post = () => new NextRequest('http://localhost/api/basket/sync', { method: 'POST' });
const get = () => GET(new NextRequest('http://localhost/api/basket/sync'), ctx);

describe('POST /api/basket/sync', () => {
  let lines: Record<string, unknown>[];

  beforeEach(() => {
    run.mockReset();
    lines = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(JSON.parse(String(chunk)));
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('writes one request line with its status and duration, and starts the run under its request id', async () => {
    run.mockResolvedValue({ failedSteps: [] } as never);

    const res = await POST(post(), ctx);

    expect(res.status).toBe(202);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'request', method: 'POST', route: '/api/basket/sync', status: 202, outcome: 'ok' });
    expect(lines[0]!.duration_ms).toEqual(expect.any(Number));
    expect(run).toHaveBeenCalledWith('token', 'x-sync-token');
    await vi.waitFor(async () => expect((await (await get()).json()).inFlight).toBe(false));
  });

  it('answers a failed run as lastError, scrubbed', async () => {
    run.mockRejectedValue(new Error('duplicate key value for someone@example.com'));

    await POST(post(), ctx);
    await vi.waitFor(async () => expect((await (await get()).json()).inFlight).toBe(false));

    const { lastError } = await (await get()).json();
    expect(lastError).toMatch(/^duplicate key value for/);
    expect(lastError).not.toContain('example.com');
  });
});
