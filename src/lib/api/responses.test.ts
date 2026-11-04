import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRequestLog } from 'basket-tv-telemetry/next';
import { telemetry } from '@/lib/telemetry';
import { serverError } from './responses';

// A DB error the way drizzle words it: the SQL, then the values it ran with.
function queryError(): Error {
  const err = new Error('Failed query: select * from basket_payments where id = $1 and amount = $2\nparams: 424242,1999.50');
  err.name = 'DrizzleQueryError';
  return err;
}

const ctx = { params: Promise.resolve({}) };
const get = (route: string, handler: () => Response) =>
  withRequestLog(route, handler)(new Request(`http://localhost${route}`), ctx);

describe('serverError', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    vi.spyOn(telemetry, 'reportServerError');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('answers a generic 500 without the message or, in production, the stack', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = serverError(queryError());
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'internal_error' });
  });

  it('outside production answers the stack with the scrubbed message on its first line', async () => {
    const body = await serverError(queryError()).json();
    expect(body.error).toBe('internal_error');
    expect(body).not.toHaveProperty('message');
    expect(body.stack).toMatch(/^DrizzleQueryError: Failed query: select/);
    expect(body.stack).toMatch(/\n\s+at /);
    expect(body.stack).not.toContain('params');
    expect(body.stack).not.toContain('424242');
  });

  it('in a request writes one line with the status, duration and scrubbed error, and reports once', async () => {
    const err = queryError();
    const res = await get('/api/basket/overview', () => serverError(err));

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({
      level: 'error',
      kind: 'request',
      method: 'GET',
      route: '/api/basket/overview',
      status: 500,
      outcome: 'error',
      error: { type: 'DrizzleQueryError' },
    });
    expect(line.duration_ms).toEqual(expect.any(Number));
    expect(res.headers.get('x-request-id')).toBe(line.request_id);
    expect(lines[0]).not.toMatch(/params|424242|1999/);
    expect(telemetry.reportServerError).toHaveBeenCalledTimes(1);
    expect(telemetry.reportServerError).toHaveBeenCalledWith(err, { route_type: 'route', status: 500 });
  });
});
