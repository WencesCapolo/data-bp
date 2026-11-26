import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import { StripeFeeFetcher } from './StripeFeeFetcher';

afterEach(() => vi.unstubAllGlobals());

const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };

function chargeTxn(id: string, paymentMethodDetails: unknown, billingCountry: string | null = null) {
  return {
    id: `txn_${id}`, type: 'charge', amount: 1000, currency: 'usd', fee: 60, net: 940,
    exchange_rate: null, created: 1_788_000_000,
    source: {
      object: 'charge', id: `ch_${id}`, payment_intent: `pi_${id}`, invoice: null,
      amount: 1000, currency: 'usd', amount_refunded: 0, status: 'succeeded', created: 1_788_000_000,
      payment_method_details: paymentMethodDetails,
      billing_details: { address: { country: billingCountry } },
    },
  };
}

function stubStripe(transactions: unknown[]) {
  vi.stubGlobal('fetch', async (input: string) => {
    const body = new URL(input).pathname.endsWith('/invoices')
      ? { data: [], has_more: false }
      : { data: transactions, has_more: false };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function collect(): Promise<GatewayFeeProps[]> {
  const out: GatewayFeeProps[] = [];
  for await (const f of new StripeFeeFetcher({ secretKey: 'sk_test' }).streamFees(window)) out.push(f);
  return out;
}

describe('StripeFeeFetcher', () => {
  it('takes the country the money came from: card, else the method, else billing', async () => {
    stubStripe([
      chargeTxn('card', { type: 'card', card: { country: 'UY' } }, 'AR'),
      chargeTxn('link', { type: 'link', link: { country: 'CL' } }, 'AR'),
      chargeTxn('billing', { type: 'link', link: {} }, 'ec'),
      chargeTxn('none', { type: 'link', link: {} }),
    ]);

    const rows = await collect();

    expect(rows.map((r) => [r.platformPaymentId, r.cardCountry])).toEqual([
      ['pi_card', 'UY'],
      ['pi_link', 'CL'],
      ['pi_billing', 'EC'],
      ['pi_none', null],
    ]);
  });
});
