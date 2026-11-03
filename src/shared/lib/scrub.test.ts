import { describe, expect, it } from 'vitest';
import { scrubErrorFields, scrubStack } from './scrub';

describe('scrubErrorFields', () => {
  it('scrubs every error and lastError string, at any depth, and leaves the rest', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const result = {
      syncedPayments: 12,
      failedSteps: [{ step: 'fx-rates', item: 'blue', error: 'value "abc" out of range: 1999.50' }],
      gatewayFees: [{ gateway: 'stripe', error: 'Failed query: select 1\nparams: 424242' }],
      exportInbox: { error: null, files: [{ filename: 'report.csv', error: 'row 7: {"amount":10}' }] },
      lastError: 'user someone@example.com missing',
      startedAt: at,
    };
    const out = scrubErrorFields(result);
    expect(out.syncedPayments).toBe(12);
    expect(out.startedAt).toBe(at);
    expect(out.failedSteps[0]).toEqual({ step: 'fx-rates', item: 'blue', error: 'value "…" out of range: #' });
    expect(out.gatewayFees[0]!.error).toBe('Failed query: select #');
    expect(out.exportInbox.error).toBeNull();
    expect(out.exportInbox.files[0]!.filename).toBe('report.csv');
    expect(out.exportInbox.files[0]!.error).toBe('row #: {…}');
    expect(out.lastError).toBe('user …@… missing');
    expect(result.failedSteps[0]!.error).toContain('1999.50');
  });
});

describe('scrubStack', () => {
  it('replaces the first line and keeps only the frames', () => {
    const stack = 'Error: secret 424242\n    at a (file.ts:1:1)\n    at b (file.ts:2:2)';
    expect(scrubStack(stack, 'Error', 'secret #')).toBe('Error: secret #\n    at a (file.ts:1:1)\n    at b (file.ts:2:2)');
    expect(scrubStack(undefined, 'Error', 'x')).toBeNull();
  });
});
