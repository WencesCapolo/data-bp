import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';
import type { GatewayWindowSource, MirrorWindow } from '@basket/core/ports/IGatewayMirror';
import { getJson } from './httpJson';
import { fromMinorUnits } from './money';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/payouts';
const PAGE_SIZE = 100;

export interface StripePayoutFetcherConfig {
  secretKey: string;
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
}

interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  type: string | null;
  method: string | null;
  automatic: boolean | null;
  arrival_date: number | null;
  created: number;
  description: string | null;
  statement_descriptor: string | null;
  failure_code: string | null;
  balance_transaction: string | { id: string } | null;
}

interface StripePayoutList {
  data: StripePayout[];
  has_more: boolean;
}

/**
 * Reads payouts over a window of their creation.
 *
 * `created`, not `arrival_date`, is the window field on purpose. Stripe supports
 * both, and arrival is the date reconciliation cares about — but a payout's
 * arrival date moves while it is in transit (a bank holiday pushes it), so a
 * window over arrival would re-read a moving target and could skip a payout that
 * jumped forward past a window already closed. Creation never moves. The
 * trailing overlap covers the days a payout spends changing status.
 *
 * Payouts are a handful per currency per week — the cheapest of the five
 * Exports by two orders of magnitude.
 */
export class StripePayoutFetcher implements GatewayWindowSource<GatewayPayoutProps> {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripePayoutFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripePayoutFetcher requires a secret key');
  }

  async *stream(window: MirrorWindow): AsyncGenerator<GatewayPayoutProps> {
    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('created[gte]', String(unix(window.from)));
      url.searchParams.set('created[lt]', String(unix(window.to)));
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripePayoutList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const p of page.data) yield toProps(p);

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toProps(p: StripePayout): GatewayPayoutProps {
  return {
    platform: STRIPE_PLATFORM,
    payoutId: p.id,
    amount: fromMinorUnits(p.amount, p.currency),
    currency: p.currency.toUpperCase(),
    status: p.status,
    type: p.type,
    method: p.method,
    automatic: p.automatic ?? null,
    // A date, not a timestamp: Stripe stamps it at midnight UTC of the banking
    // day. Any local-time rendering of it will read as the previous evening.
    arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000) : null,
    createdAt: new Date(p.created * 1000),
    description: p.description,
    statementDescriptor: p.statement_descriptor,
    failureCode: p.failure_code,
    balanceTransactionId:
      typeof p.balance_transaction === 'string'
        ? p.balance_transaction
        : (p.balance_transaction?.id ?? null),
  };
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
