import { describe, expect, it } from 'vitest';
import { monthWindows, toProps, type MpPreapproval } from './MercadoPagoSubscriptionFetcher';

const base: MpPreapproval = {
  id: '2c9380848f2b6a5e018f2c4d1e9a0b3c',
  payer_id: 123456,
  status: 'authorized',
  date_created: '2025-03-01T12:00:00.000-04:00',
  last_modified: '2025-06-01T12:00:00.000-04:00',
  next_payment_date: '2025-07-01T12:00:00.000-04:00',
  auto_recurring: {
    frequency: 1,
    frequency_type: 'months',
    transaction_amount: 4999.5,
    currency_id: 'ars',
    start_date: '2025-03-01T12:00:00.000-04:00',
    end_date: null,
  },
};

describe('MercadoPagoSubscriptionFetcher.toProps', () => {
  it('maps the preapproval onto the gateway-agnostic row, status verbatim', () => {
    const row = toProps(base);
    expect(row.platform).toBe(0);
    expect(row.subscriptionId).toBe(base.id);
    expect(row.customerId).toBe('123456');
    expect(row.status).toBe('authorized');
    expect(row.currency).toBe('ARS');
    expect(row.amount).toBe(4999.5);
    expect(row.interval).toBe('months');
    expect(row.intervalCount).toBe(1);
    expect(row.createdAt?.toISOString()).toBe('2025-03-01T16:00:00.000Z');
    expect(row.currentPeriodStart?.toISOString()).toBe('2025-03-01T16:00:00.000Z');
    expect(row.currentPeriodEnd).toBeNull();
  });

  it('never invents a cancellation moment from last_modified', () => {
    const row = toProps({ ...base, status: 'cancelled' });
    expect(row.status).toBe('cancelled');
    expect(row.canceledAt).toBeNull();
    expect(row.endedAt).toBeNull();
    expect(row.cancelAtPeriodEnd).toBe(false);
  });

  it('tolerates a preapproval with no recurring block', () => {
    const row = toProps({ ...base, auto_recurring: null, payer_id: null });
    expect(row.amount).toBeNull();
    expect(row.currency).toBeNull();
    expect(row.customerId).toBeNull();
  });
});

describe('monthWindows', () => {
  it('tiles [since, end) with half-open slices that share boundaries and never overshoot', () => {
    const since = new Date('2021-01-01T00:00:00.000Z');
    const end = new Date('2021-03-15T12:00:00.000Z');
    const w = [...monthWindows(since, end)];
    expect(w[0].from).toEqual(since);
    expect(w[w.length - 1].to).toEqual(end);
    for (let i = 1; i < w.length; i += 1) expect(w[i].from).toEqual(w[i - 1].to);
    for (const x of w) expect(x.to.getTime()).toBeGreaterThan(x.from.getTime());
  });

  it('yields nothing when since is not before end', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect([...monthWindows(d, d)]).toEqual([]);
  });
});

describe('monthWindows', () => {
  it('tiles [since, end) with half-open slices that share boundaries and never overshoot', () => {
    const since = new Date('2021-01-01T00:00:00.000Z');
    const end = new Date('2021-03-15T12:00:00.000Z');
    const w = [...monthWindows(since, end)];
    expect(w[0].from).toEqual(since);
    expect(w[w.length - 1].to).toEqual(end);
    for (let i = 1; i < w.length; i += 1) expect(w[i].from).toEqual(w[i - 1].to);
    for (const x of w) expect(x.to.getTime()).toBeGreaterThan(x.from.getTime());
  });

  it('yields nothing when since is not before end', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect([...monthWindows(d, d)]).toEqual([]);
  });
});
