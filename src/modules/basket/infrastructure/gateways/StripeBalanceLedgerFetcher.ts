import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import type { GatewayWindowSource, MirrorWindow } from '@basket/core/ports/IGatewayMirror';
import { getJson } from './httpJson';
import { fromMinorUnits } from './money';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/balance_transactions';
const PAGE_SIZE = 100;

export interface StripeBalanceLedgerFetcherConfig {
  secretKey: string;
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
}

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
 * Every balance transaction over a window of their creation, one Balance
 * Movement each, dated by when it became available.
 *
 * Which payout carried a transaction is not read here: Stripe answers
 * `?payout=` only for automatic payouts, and this account pays out by hand.
 * Each manual payout sweeps the whole available balance, so
 * basket_v_cashflow_available (migration 0029) assigns a transaction to the
 * first paid payout created once it was available.
 *
 * The payouts' own movements (`payout`, `payout_failure`, …) are left out:
 * they move the money to the bank, they are not money coming in.
 */
export class StripeBalanceLedgerFetcher implements GatewayWindowSource<GatewayMovementProps> {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripeBalanceLedgerFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripeBalanceLedgerFetcher requires a secret key');
  }

  async *stream(window: MirrorWindow): AsyncGenerator<GatewayMovementProps> {
    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('created[gte]', String(unix(window.from)));
      url.searchParams.set('created[lt]', String(unix(window.to)));
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripeBalanceTransactionList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const bt of page.data) if (!bt.type.startsWith('payout')) yield toMovement(bt);

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toMovement(bt: StripeBalanceTransaction): GatewayMovementProps {
  return {
    platform: STRIPE_PLATFORM,
    movementId: bt.id,
    platformPaymentId: typeof bt.source === 'string' ? bt.source : (bt.source?.id ?? null),
    type: bt.type,
    currency: bt.currency.toUpperCase(),
    netAmount: fromMinorUnits(bt.net, bt.currency),
    occurredAt: new Date(bt.created * 1000),
    availableAt: bt.available_on ? new Date(bt.available_on * 1000) : null,
    payoutId: null,
  };
}

function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}
