import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/telemetry', () => ({ reportServerError: vi.fn() }));

import { reportServerError } from '@/lib/telemetry';
import { serverError } from './responses';

const report = vi.mocked(reportServerError);

// A DB error the way drizzle words it: the SQL, then the values it ran with.
function queryError(): Error {
  const err = new Error('Failed query: select * from basket_payments where id = $1 and amount = $2\nparams: 424242,1999.50');
  err.name = 'DrizzleQueryError';
  return err;
}

describe('serverError', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    report.mockReset();
    log = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it('answers a generic 500 without the message or, in production, the stack', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = serverError(queryError(), { method: 'GET', route: '/api/basket/overview' });
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'internal_error' });
  });

  it('outside production answers the stack with the scrubbed message on its first line', async () => {
    const body = await serverError(queryError(), { method: 'GET', route: '/api/basket/overview' }).json();
    expect(body.error).toBe('internal_error');
    expect(body).not.toHaveProperty('message');
    expect(body.stack).toMatch(/^DrizzleQueryError: Failed query: select/);
    expect(body.stack).toMatch(/\n\s+at /);
    expect(body.stack).not.toContain('params');
    expect(body.stack).not.toContain('424242');
  });

  it('reports the error once, with the route pattern and status', () => {
    const err = queryError();
    serverError(err, { method: 'GET', route: '/api/basket/teams/[teamId]/daily' });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(err, {
      method: 'GET',
      route: '/api/basket/teams/[teamId]/daily',
      routeType: 'route',
      status: 500,
    });
  });

  it('logs one scrubbed line, without the query params', () => {
    serverError(queryError(), { method: 'GET', route: '/api/basket/overview' });
    expect(log).toHaveBeenCalledTimes(1);
    const args = log.mock.calls[0]!;
    expect(args).toHaveLength(1);
    const line = args[0] as string;
    expect(line).toMatch(/^\[api\] DrizzleQueryError: Failed query: select/);
    expect(line).toContain('"route":"/api/basket/overview"');
    expect(line).not.toContain('params');
    expect(line).not.toContain('424242');
    expect(line).not.toContain('1999');
  });
});
