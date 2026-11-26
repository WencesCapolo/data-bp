import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import { StripePayoutLedgerFetcher } from './StripePayoutLedgerFetcher';

afterEach(() => vi.unstubAllGlobals());

const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };
const unix = (iso: string) => Date.parse(iso) / 1000;

function payout(id: string, status: string, automatic: boolean) {
  return {
    id, amount: 0, currency: 'usd', status, type: 'bank_account', method: 'standard', automatic,
    arrival_date: unix('2026-09-10T00:00:00Z'), created: unix('2026-09-08T00:00:00Z'),
    description: null, statement_descriptor: null, failure_code: null, balance_transaction: null,
  };
}

function bt(id: string, type: string, net: number, extra: Record<string, unknown> = {}) {
  return {
    id, type, net, currency: 'usd', source: null,
    created: unix('2026-09-05T23:30:00Z'), available_on: unix('2026-09-08T00:00:00Z'), ...extra,
  };
}

/** Answers each Stripe URL from a table keyed by path plus the params that pick the page. */
function stubStripe(pages: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input);
    const key = [url.pathname, url.searchParams.get('payout'), url.searchParams.get('starting_after')]
      .filter(Boolean)
      .join(' ');
    asked.push(key);
    if (!(key in pages)) return new Response('not stubbed', { status: 404 });
    return new Response(JSON.stringify(pages[key]), { status: 200 });
  });
  return asked;
}

async function collect(): Promise<GatewayMovementProps[]> {
  const out: GatewayMovementProps[] = [];
  for await (const m of new StripePayoutLedgerFetcher({ secretKey: 'sk_test' }).stream(window)) out.push(m);
  return out;
}

describe('StripePayoutLedgerFetcher', () => {
  it('maps what a paid payout carried, leaving out its own debit', async () => {
    stubStripe({
      '/v1/payouts': { data: [payout('po_1', 'paid', true)], has_more: false },
      '/v1/balance_transactions po_1': {
        data: [
          bt('txn_payout', 'payout', -9000),
          bt('txn_charge', 'charge', 10000, { source: 'ch_1' }),
          bt('txn_refund', 'refund', -1500, { source: { id: 're_1' } }),
          bt('txn_fee', 'stripe_fee', -500),
        ],
        has_more: false,
      },
    });

    const rows = await collect();

    expect(rows.map((r) => r.movementId)).toEqual(['txn_charge', 'txn_refund', 'txn_fee']);
    expect(rows[0]).toEqual({
      platform: 4,
      movementId: 'txn_charge',
      platformPaymentId: 'ch_1',
      type: 'charge',
      currency: 'USD',
      netAmount: 100,
      occurredAt: new Date('2026-09-05T23:30:00Z'),
      availableAt: new Date('2026-09-08T00:00:00Z'),
      payoutId: 'po_1',
    });
    expect(rows[1].platformPaymentId).toBe('re_1');
    expect(rows[2].platformPaymentId).toBeNull();
  });

  it('reads no ledger for a payout that is not paid, or not automatic', async () => {
    const asked = stubStripe({
      '/v1/payouts': {
        data: [payout('po_failed', 'failed', true), payout('po_transit', 'in_transit', true), payout('po_manual', 'paid', false)],
        has_more: false,
      },
    });

    expect(await collect()).toEqual([]);
    expect(asked).toEqual(['/v1/payouts']);
  });

  it('pages through a payout with more than one page of transactions', async () => {
    const asked = stubStripe({
      '/v1/payouts': { data: [payout('po_1', 'paid', true)], has_more: false },
      '/v1/balance_transactions po_1': { data: [bt('txn_a', 'charge', 100)], has_more: true },
      '/v1/balance_transactions po_1 txn_a': { data: [bt('txn_b', 'charge', 200)], has_more: false },
    });

    expect((await collect()).map((r) => r.movementId)).toEqual(['txn_a', 'txn_b']);
    expect(asked.at(-1)).toBe('/v1/balance_transactions po_1 txn_a');
  });

  it('reads a zero-decimal currency without dividing it by 100', async () => {
    stubStripe({
      '/v1/payouts': { data: [payout('po_1', 'paid', true)], has_more: false },
      '/v1/balance_transactions po_1': { data: [bt('txn_clp', 'charge', 5000, { currency: 'clp' })], has_more: false },
    });

    const [row] = await collect();
    expect(row.currency).toBe('CLP');
    expect(row.netAmount).toBe(5000);
  });
});
