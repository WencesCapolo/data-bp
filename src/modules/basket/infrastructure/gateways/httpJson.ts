/**
 * Minimal JSON-over-HTTPS helper shared by the gateway fee fetchers.
 *
 * No vendor SDK on purpose: both fetchers need exactly one list endpoint each,
 * and the SDKs would pull in their own retry, pagination and telemetry layers
 * that we would then have to reason around during a 430k-row backfill. The one
 * thing that genuinely matters here — surviving 429s over hours of paging — is
 * ~30 lines.
 */

export interface HttpJsonOptions {
  headers?: Record<string, string>;
  /** Attempts INCLUDING the first. 5 attempts ≈ 1+2+4+8s of backoff. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Called before each retry so callers can log slow windows. */
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Retried: rate limits, gateway hiccups, and anything below 500 that is 429. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

export async function getJson<T>(url: string, options: HttpJsonOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...(options.headers ?? {}) },
        signal: controller.signal,
      });

      if (res.ok) return (await res.json()) as T;

      const body = (await res.text()).slice(0, 300);
      if (!isRetryableStatus(res.status) || attempt === maxAttempts) {
        throw new Error(`GET ${redact(url)} → ${res.status}: ${body}`);
      }
      // Retry-After wins over our own backoff — the gateway knows better when
      // it will let us back in, and guessing shorter just burns another 429.
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoffMs(attempt);
      options.onRetry?.({ attempt, status: res.status, waitMs, reason: body });
      await sleep(waitMs);
    } catch (err) {
      const error = err as Error;
      // A non-retryable HTTP status was already turned into a throw above; only
      // transport-level faults (abort, DNS, reset) reach here as retryable.
      const isHttpError = error.message.startsWith('GET ');
      if (isHttpError || attempt === maxAttempts) {
        lastError = error;
        break;
      }
      const waitMs = backoffMs(attempt);
      options.onRetry?.({ attempt, status: null, waitMs, reason: error.message });
      await sleep(waitMs);
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`GET ${redact(url)} failed`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tokens travel in headers, not the query string, but MercadoPago historically
 *  accepted `access_token=` and a copied URL in a log would leak it. */
export function redact(url: string): string {
  return url.replace(/([?&]access_token=)[^&]+/gi, '$1***');
}
