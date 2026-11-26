import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import { StripeBalanceLedgerFetcher } from './StripeBalanceLedgerFetcher';

afterEach(() => vi.unstubAllGlobals());

const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };
const unix = (iso: string) => Date.parse(iso) / 1000;

function bt(id: string, type: string, net: number, extra: Record<string, unknown> = {}) {
  return {
    id, type, net, currency: 'usd', source: null,
    created: unix('2026-09-05T23:30:00Z'), available_on: unix('2026-09-08T00:00:00Z'), ...extra,
  };
}

/** Answers each Stripe URL from a table keyed by the page cursor. */
function stubStripe(pages: Record<string, unknown>) {
  const asked: URL[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input);
    asked.push(url);
    const key = url.searchParams.get('starting_after') ?? 'first';
    if (!(key in pages)) return new Response('not stubbed', { status: 404 });
    return new Response(JSON.stringify(pages[key]), { status: 200 });
  });
  return asked;
}

async function collect(): Promise<GatewayMovementProps[]> {
  const out: GatewayMovementProps[] = [];
  for await (const m of new StripeBalanceLedgerFetcher({ secretKey: 'sk_test' }).stream(window)) out.push(m);
  return out;
}

describe('StripeBalanceLedgerFetcher', () => {
  it('maps the money coming in over the window, leaving out what payouts moved to the bank', async () => {
    const asked = stubStripe({
      first: {
        data: [
          bt('txn_payout', 'payout', -9000),
          bt('txn_failure', 'payout_failure', 9000),
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
      payoutId: null,
    });
    expect(rows[1].platformPaymentId).toBe('re_1');
    expect(asked[0].searchParams.get('created[gte]')).toBe(String(unix('2026-09-01T00:00:00Z')));
    expect(asked[0].searchParams.get('created[lt]')).toBe(String(unix('2026-10-01T00:00:00Z')));
  });

  it('pages through the window', async () => {
    stubStripe({
      first: { data: [bt('txn_a', 'charge', 100)], has_more: true },
      txn_a: { data: [bt('txn_b', 'charge', 200)], has_more: false },
    });

    expect((await collect()).map((r) => r.movementId)).toEqual(['txn_a', 'txn_b']);
  });

  it('reads a zero-decimal currency without dividing it by 100', async () => {
    stubStripe({ first: { data: [bt('txn_clp', 'charge', 5000, { currency: 'clp' })], has_more: false } });

    const [row] = await collect();
    expect(row.currency).toBe('CLP');
    expect(row.netAmount).toBe(5000);
  });
});
