// Error text without data, shared by the server reporter (src/lib/telemetry.ts),
// the log helper (logError.ts), the sync state the routes answer, and core use
// cases. No imports: client components log through it too.

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

/** A stack with the scrubbed message in place of its first line (which repeats the original), frames as they are. */
export function scrubStack(stack: string | undefined, type: string, message: string): string | null {
  if (!stack) return null;
  const frames = stack.split('\n').filter((line) => /^\s+at /.test(line));
  return [`${type}: ${message}`, ...frames].join('\n');
}

const ERROR_KEYS = new Set(['error', 'lastError']);

/**
 * A copy of a result with every `error` / `lastError` string scrubbed, at any
 * depth: a Sync result nests the errors of each gateway, FX source and inbox
 * file. For state that an endpoint answers.
 */
export function scrubErrorFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => scrubErrorFields(v)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, ERROR_KEYS.has(k) && typeof v === 'string' ? scrubMessage(v) : scrubErrorFields(v)]),
  ) as T;
}
