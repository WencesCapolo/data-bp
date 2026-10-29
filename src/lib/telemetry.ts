// Server side of the Basket.tv telemetry (basket-telemetry SPEC §6.2, §11.2):
// errors and business events go to the local ingest, batched within 1 s. A
// no-op without TELEMETRY_TOKEN (dev, tests, CI); it never throws and nothing
// waits on it, so a slow or absent telemetry service can't touch a response.

type Props = Record<string, string | number | boolean | null>;
type ServerEvent = { name: string; ts: number; userId: string | null; props: Props };
type ServerError = {
  ts: number;
  source: 'server';
  type: string;
  message: string;
  stack: string | null;
  userId: string | null;
  context: Record<string, unknown>;
};

const DEFAULT_INGEST_URL = 'http://127.0.0.1:3011/ingest/server';
const BATCH_MS = 1_000;
const TIMEOUT_MS = 1_500;
const MAX_QUEUED = 200;

/**
 * An error message without data: a DB error (`DrizzleQueryError`) carries the
 * query params (amounts, fees, emails, names) and others quote values, an email
 * or a JSON. Cut at `params:` and mask emails, quoted strings, objects and
 * numbers (money too); the shape of the error is what groups it. Mirrors cashflow-bp's
 * `mensajeSinDatos`.
 */
export function scrubMessage(message: string): string {
  return message
    .split(/\bparams:/)[0]!
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+/g, '…@…')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '"…"')
    .replace(/\{[^{}]*\}/g, '{…}')
    // `$` before a number is a SQL placeholder (`$1`) unless it looks like money.
    .replace(/\$(?=\d[\d.,]*[.,]\d|\d{4})\d[\d.,]*/g, '#')
    .replace(/(?<![\w$])-?\d[\d.,]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** The stack with the scrubbed message in place of the original (its first line repeats it), frames as they are. */
function scrubStack(stack: string | undefined, type: string, message: string): string | null {
  if (!stack) return null;
  const frames = stack.split('\n').filter((line) => /^\s+at /.test(line));
  return [`${type}: ${message}`, ...frames].join('\n');
}

export interface TelemetryDeps {
  env: () => { url?: string; token?: string };
  fetch: typeof fetch;
  now: () => number;
}

export function createTelemetry(deps: TelemetryDeps) {
  let events: ServerEvent[] = [];
  let errors: ServerError[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function send(url: string, token: string, body: string): Promise<void> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function flush(): Promise<void> {
    timer = null;
    const { url, token } = deps.env();
    if (!token || (events.length === 0 && errors.length === 0)) return Promise.resolve();
    const body = JSON.stringify({ v: 1, events, errors });
    events = [];
    errors = [];
    return send(url || DEFAULT_INGEST_URL, token, body).catch(() => {});
  }

  function enqueue(add: () => void): void {
    try {
      if (!deps.env().token || events.length + errors.length >= MAX_QUEUED) return;
      add();
      if (!timer) {
        timer = setTimeout(() => void flush(), BATCH_MS);
        timer.unref?.();
      }
    } catch {
      // Telemetry must never break the caller.
    }
  }

  return {
    reportServerError(err: unknown, context: Record<string, unknown> = {}, userId: string | null = null): void {
      enqueue(() => {
        const e = err instanceof Error ? err : new Error(String(err));
        const type = e.name || 'Error';
        const message = scrubMessage(e.message);
        errors.push({ ts: deps.now(), source: 'server', type, message, stack: scrubStack(e.stack, type, message), userId, context });
      });
    },
    trackServerEvent(name: string, userId: string | null, props: Props = {}): void {
      enqueue(() => events.push({ name, ts: deps.now(), userId, props }));
    },
    flush,
  };
}

const telemetry = createTelemetry({
  env: () => ({ url: process.env.TELEMETRY_INGEST_URL, token: process.env.TELEMETRY_TOKEN }),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
});

export const reportServerError = telemetry.reportServerError;
export const trackServerEvent = telemetry.trackServerEvent;
