// Shared by the server reporter (src/lib/telemetry.ts) and the log helper
// (src/lib/logError.ts), so an error reads the same in both places. No imports:
// client components log through it too.

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
