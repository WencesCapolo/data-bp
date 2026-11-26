import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import type { GatewayWindowSource, MirrorWindow } from '@basket/core/ports/IGatewayMirror';
import { getJson } from './httpJson';
import { fromMinorUnits } from './money';
import { StripePayoutFetcher, type StripePayoutFetcherConfig } from './StripePayoutFetcher';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/balance_transactions';
const PAGE_SIZE = 100;

export type StripePayoutLedgerFetcherConfig = StripePayoutFetcherConfig;

interface StripeBalanceTransaction {
  id: string;
  type: string;
  currency: string;
  net: number;
  created: number;
  available_on: number | null;
  source: string | { id: string } | null;
}

interface StripeBalanceTransactionList {
  data: StripeBalanceTransaction[];
  has_more: boolean;
}

/**
 * The balance transactions each paid payout carried to the bank, one Balance
 * Movement each, tagged with the payout.
 *
 * Read per payout rather than by `created` over the window because which
 * payout a transaction rides is decided by Stripe when it sweeps the balance,
 * not by when the transaction happened: only the payout knows its contents.
 * The window is the payouts' own (by creation, as `StripePayoutFetcher`), so
 * this mirror resumes and overlaps on the same clock as the payout mirror.
 *
 * Only `paid` payouts: a failed payout's transactions return to the balance
 * and ride a later one, so reading both would count them twice. Only automatic
 * ones, because Stripe answers `?payout=` for automatic payouts only.
 */
export class StripePayoutLedgerFetcher implements GatewayWindowSource<GatewayMovementProps> {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';
  private readonly payouts: StripePayoutFetcher;

  constructor(private readonly cfg: StripePayoutLedgerFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripePayoutLedgerFetcher requires a secret key');
    this.payouts = new StripePayoutFetcher(cfg);
  }

  async *stream(window: MirrorWindow): AsyncGenerator<GatewayMovementProps> {
    const carried: string[] = [];
    for await (const p of this.payouts.stream(window)) {
      if (p.status === 'paid' && p.automatic === true) carried.push(p.payoutId);
    }
    for (const payoutId of carried) yield* this.ledgerOf(payoutId);
  }

  private async *ledgerOf(payoutId: string): AsyncGenerator<GatewayMovementProps> {
    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('payout', payoutId);
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripeBalanceTransactionList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const bt of page.data) {
        // The payout's own debit: what left for the bank, not what it carried.
        if (bt.type === 'payout') continue;
        yield toMovement(bt, payoutId);
      }

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toMovement(bt: StripeBalanceTransaction, payoutId: string): GatewayMovementProps {
  return {
    platform: STRIPE_PLATFORM,
    movementId: bt.id,
    platformPaymentId: typeof bt.source === 'string' ? bt.source : (bt.source?.id ?? null),
    type: bt.type,
    currency: bt.currency.toUpperCase(),
    netAmount: fromMinorUnits(bt.net, bt.currency),
    occurredAt: new Date(bt.created * 1000),
    availableAt: bt.available_on ? new Date(bt.available_on * 1000) : null,
    payoutId,
  };
}
