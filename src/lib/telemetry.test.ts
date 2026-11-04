import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEvent, withEvent } from 'basket-tv-telemetry/log';
import { RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';
import type { SyncStep } from '@basket/core/use-cases/sync/SyncStep';
import { countGatewayRetry, recordJobStep, runJob, telemetry } from './telemetry';

let lines: Record<string, unknown>[];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(JSON.parse(String(chunk)));
    return true;
  });
  vi.spyOn(telemetry, 'reportServerError');
});
afterEach(() => vi.restoreAllMocks());

// A DB error the way drizzle words it: the SQL, then the values it ran with.
function queryError(): Error {
  const err = new Error('Failed query: update basket_users set email = $1 where id = $2\nparams: someone@example.com,424242');
  err.name = 'DrizzleQueryError';
  return err;
}

// Contributions carry only the fields the line reads.
const step = (name: string, policy: 'fatal' | 'never-fatal', run: () => Promise<object>) => ({ name, policy, run }) as SyncStep;

function sync(...steps: SyncStep[]) {
  return runJob('basket_sync', 'cron', () => new RunSyncUseCase(steps).execute(recordJobStep), { gateway_retries: 0 });
}

describe('a sync run', () => {
  it('writes exactly one job line, with its steps, retries, trigger and outcome', async () => {
    await sync(
      step('users', 'fatal', async () => ({ syncedUsers: 12 })),
      step('fees', 'never-fatal', async () => {
        countGatewayRetry('stripe');
        countGatewayRetry('stripe');
        return { gatewayFees: [{ slug: 'stripe', upserted: 5 }] };
      }),
      step('fx-rates', 'never-fatal', async () => ({ fxRates: [{ source: 'blue', upserted: 0, error: 'timeout' }] })),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      kind: 'job',
      route: 'basket_sync',
      trigger: 'cron',
      outcome: 'ok',
      gateway_retries: 2,
      steps: [
        { name: 'users', ok: true, rows: 12 },
        { name: 'fees', ok: true, rows: 5 },
        { name: 'fx-rates', ok: false, rows: 0 },
      ],
    });
    expect(lines[0]!.duration_ms).toEqual(expect.any(Number));
    expect(telemetry.reportServerError).not.toHaveBeenCalled();
  });

  it('puts a failed step on its line with the message scrubbed, reports it once and carries on', async () => {
    const err = queryError();
    await sync(
      step('users', 'never-fatal', async () => {
        throw err;
      }),
      step('refresh', 'fatal', async () => ({})),
    );

    expect(lines).toHaveLength(1);
    const [users] = lines[0]!.steps as { name: string; ok: boolean; error: { type: string; message: string } }[];
    expect(users).toMatchObject({ name: 'users', ok: false, rows: 0, error: { type: 'DrizzleQueryError' } });
    expect(users!.error.message).toMatch(/^Failed query: update basket_users set email = \$1 where id = \$2/);
    expect(JSON.stringify(lines[0])).not.toMatch(/params|example\.com|424242/);
    expect(lines[0]).toMatchObject({ level: 'info', outcome: 'ok' });
    expect(telemetry.reportServerError).toHaveBeenCalledTimes(1);
    expect(telemetry.reportServerError).toHaveBeenCalledWith(err, { route_type: 'job', step: 'users' });
  });

  it('marks the line when a fatal step ends the run, and reports that error once', async () => {
    const err = queryError();
    await expect(
      sync(
        step('payments', 'fatal', async () => {
          throw err;
        }),
      ),
    ).rejects.toBe(err);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      outcome: 'error',
      error: { type: 'DrizzleQueryError' },
      steps: [{ name: 'payments', ok: false, rows: 0 }],
    });
    expect(JSON.stringify(lines[0])).not.toMatch(/params|example\.com|424242/);
    expect(telemetry.reportServerError).toHaveBeenCalledTimes(1);
  });

  it('started from a request, shares its request id', async () => {
    const request = startEvent('request', { route: '/api/basket/sync' });
    await withEvent(request, () => sync());
    expect(lines).toHaveLength(1);
    expect(lines[0]!.request_id).toBe(request.request_id);
  });
});
