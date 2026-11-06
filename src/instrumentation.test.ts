import { afterEach, describe, expect, it, vi } from 'vitest';

const startSyncScheduler = vi.fn();
const flushTelemetryOnShutdown = vi.fn();
vi.mock('@basket/infrastructure/cron/SyncScheduler', () => ({ startSyncScheduler }));
vi.mock('@/lib/telemetry-shutdown', () => ({ flushTelemetryOnShutdown }));

const { register } = await import('./instrumentation');

describe('register', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('starts the Sync when the Node server starts, without waiting for a page', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(startSyncScheduler).toHaveBeenCalledOnce();
    expect(flushTelemetryOnShutdown).toHaveBeenCalledOnce();
  });

  it('does nothing in the Edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(startSyncScheduler).not.toHaveBeenCalled();
  });
});
