import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelemetry, scrubMessage } from './telemetry';

type Env = { url?: string; token?: string };

function setup(env: Env, fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const fetchSpy = vi.fn(fetchImpl);
  const t = createTelemetry({ env: () => env, fetch: fetchSpy as unknown as typeof fetch, now: () => 1_730_000_000_000 });
  return { t, fetchSpy };
}

function sentBody(fetchSpy: ReturnType<typeof vi.fn>, call = 0) {
  const [, init] = fetchSpy.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('server telemetry reporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing without TELEMETRY_TOKEN', async () => {
    const { t, fetchSpy } = setup({ url: 'http://127.0.0.1:3011/ingest/server' });
    t.trackServerEvent('dashboard_viewed', 'user-test-1', { dashboard: 'partidos' });
    t.reportServerError(new Error('boom'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the §6.2 payload with the bearer token to the default URL', async () => {
    const { t, fetchSpy } = setup({ token: 'test-token' });
    t.trackServerEvent('fees_ingested', 'user-test-1', { source_id: 'stripe' });
    t.reportServerError(new TypeError('bad thing'), { method: 'GET', route: '/basket', routeType: 'render' });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3011/ingest/server');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = sentBody(fetchSpy);
    expect(body).toEqual({
      v: 1,
      events: [{ name: 'fees_ingested', ts: 1_730_000_000_000, userId: 'user-test-1', props: { source_id: 'stripe' } }],
      errors: [
        {
          ts: 1_730_000_000_000,
          source: 'server',
          type: 'TypeError',
          message: 'bad thing',
          stack: expect.stringContaining('bad thing'),
          userId: null,
          context: { method: 'GET', route: '/basket', routeType: 'render' },
        },
      ],
    });
  });

  it('uses TELEMETRY_INGEST_URL when set and reports non-Error throws', async () => {
    const { t, fetchSpy } = setup({ url: 'http://127.0.0.1:9999/ingest/server', token: 'test-token' });
    t.reportServerError('plain string');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:9999/ingest/server');
    expect(sentBody(fetchSpy).errors[0]).toMatchObject({ type: 'Error', message: 'plain string' });
  });

  it('batches everything queued within 1 s into one request', async () => {
    const { t, fetchSpy } = setup({ token: 'test-token' });
    t.trackServerEvent('tab_a', null);
    await vi.advanceTimersByTimeAsync(500);
    t.trackServerEvent('tab_b', null);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchSpy).events.map((e: { name: string }) => e.name)).toEqual(['tab_a', 'tab_b']);

    t.trackServerEvent('tab_c', null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchSpy, 1).events.map((e: { name: string }) => e.name)).toEqual(['tab_c']);
  });

  it('swallows a failing ingest', async () => {
    const { t, fetchSpy } = setup({ token: 'test-token' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(() => t.trackServerEvent('dashboard_viewed', null)).not.toThrow();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(t.flush()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging ingest after 1.5 s', async () => {
    let signal: AbortSignal | undefined;
    const { t } = setup({ token: 'test-token' }, (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    t.trackServerEvent('dashboard_viewed', null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(signal?.aborted).toBe(true);
  });

  it('scrubs amounts, emails, quoted values and query params from errors', async () => {
    const { t, fetchSpy } = setup({ token: 'test-token' });
    const db = new Error(
      'Failed query: insert into "basket_payment_fees" ("email", "amount") values ($1, $2)\nparams: ana.fake@example.test,123456.78',
    );
    db.name = 'DrizzleQueryError';
    t.reportServerError(db);
    t.reportServerError(new Error(`Fee mismatch for ana.fake@example.test: $1,234.56 vs 98765 ${JSON.stringify({ name: 'Socio Sintético' })}`));
    await vi.advanceTimersByTimeAsync(1_000);

    const sent = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string;
    for (const leak of ['ana.fake', '123456', '1,234', '98765', 'Sintético', 'basket_payment_fees']) expect(sent).not.toContain(leak);
    const [query, mismatch] = sentBody(fetchSpy).errors;
    expect(query.message).toBe('Failed query: insert into "…" ("…", "…") values ($1, $2)');
    expect(query.stack.split('\n')[0]).toBe(`DrizzleQueryError: ${query.message}`);
    expect(query.stack).toMatch(/\n\s+at /);
    expect(mismatch.message).toBe('Fee mismatch for …@… # vs # {…}');
  });

  it('keeps the shape of messages without data', () => {
    expect(scrubMessage('Unexpected token < in JSON at position 0')).toBe('Unexpected token < in JSON at position #');
    expect(scrubMessage('relation does not exist')).toBe('relation does not exist');
  });
});
