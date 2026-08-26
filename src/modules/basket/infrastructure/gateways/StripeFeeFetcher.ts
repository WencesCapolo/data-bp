import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { FeeWindow, IGatewayFeeFetcher } from '@basket/core/ports/IGatewayFeeFetcher';
import { getJson } from './httpJson';
import { fromMinorUnits } from './money';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/balance_transactions';
const INVOICES_API = 'https://api.stripe.com/v1/invoices';
const PAGE_SIZE = 100;

export interface StripeFeeFetcherConfig {
  secretKey: string;
  /** Pins the request to a known API shape so a Stripe upgrade cannot silently
   *  rename a field mid-backfill. Bump deliberately, with a re-read of the
   *  changelog. */
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
}

interface StripeCharge {
  object: 'charge';
  id: string;
  payment_intent: string | null;
  invoice: string | null;
  amount: number;
  currency: string;
  amount_refunded: number;
  status: string;
  created: number;
}

interface StripeInvoice {
  id: string;
  subscription: string | null;
}

interface StripeInvoiceList {
  data: StripeInvoice[];
  has_more: boolean;
}

interface StripeBalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  fee: number;
  net: number;
  exchange_rate: number | null;
  created: number;
  type: string;
  source: StripeCharge | { object: string; id: string } | string | null;
}

interface StripeList {
  data: StripeBalanceTransaction[];
  has_more: boolean;
}

/**
 * Reads fees from the balance-transaction ledger rather than from each
 * PaymentIntent.
 *
 * Fees do not live on the PaymentIntent — they live on the balance transaction
 * the charge produced, which is also the only place the settlement amount and
 * the exchange rate Stripe actually applied are recorded. Listing the ledger
 * returns 100 transactions per request with the charge expanded inline, so
 * 155k Stripe Pagos cost ~1.6k requests instead of 155k lookups.
 *
 * `expand[]=data.source` is what makes that possible: without it each row would
 * need a second request to resolve the charge, and the PaymentIntent id we join
 * on lives on the charge, not on the ledger row.
 */
export class StripeFeeFetcher implements IGatewayFeeFetcher {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripeFeeFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripeFeeFetcher requires a secret key');
  }

  async *streamFees(window: FeeWindow): AsyncGenerator<GatewayFeeProps> {
    // Resolved up front, for the whole window, because a charge carries only an
    // invoice id — the subscription lives one hop further out. Expanding
    // `data.source.invoice` inline would be the obvious alternative and Stripe
    // rejects it: `source` is polymorphic (charge, refund, payout), and an
    // expansion path that does not apply to every member is an error, not a
    // null. One extra list pass buys the link for every charge in the window.
    const subscriptionByInvoice = await this.invoiceMap(window);

    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('created[gte]', String(unix(window.from)));
      url.searchParams.set('created[lt]', String(unix(window.to)));
      // Expanding the source inline is the whole point — see class doc.
      url.searchParams.append('expand[]', 'data.source');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const page = await getJson<StripeList>(url.toString(), {
        headers: this.headers(),
        onRetry: this.cfg.onRetry,
      });

      for (const bt of page.data) {
        const record = toFeeProps(bt, subscriptionByInvoice);
        if (record) yield record;
      }

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  /**
   * invoice id -> subscription id for every invoice created in the window.
   *
   * Keyed on the invoice's own creation time, which is when Stripe finalises it
   * and charges it — the same moment the balance transaction appears. A renewal
   * whose invoice was created just before the window boundary resolves to null
   * rather than wrongly; that is recovered on the next run, because incremental
   * syncs re-read the trailing overlap.
   */
  private async invoiceMap(window: FeeWindow): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(INVOICES_API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('created[gte]', String(unix(window.from)));
      url.searchParams.set('created[lt]', String(unix(window.to)));
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const page = await getJson<StripeInvoiceList>(url.toString(), {
        headers: this.headers(),
        onRetry: this.cfg.onRetry,
      });

      for (const inv of page.data) {
        if (inv.subscription) map.set(inv.id, inv.subscription);
      }

      if (!page.has_more || page.data.length === 0) return map;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.secretKey}`,
    };
    if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;
    return headers;
  }
}

/**
 * Keeps only ledger rows whose source is a charge.
 *
 * The ledger also carries payouts, refunds, disputes and adjustments. Those are
 * real money movements but they are not *a Pago's fee*, and they carry no
 * PaymentIntent to join on — folding them in would double-count the fee plane.
 * Refunds are instead reflected through the charge's own `amount_refunded`,
 * which the expanded source gives us for free.
 */
function toFeeProps(
  bt: StripeBalanceTransaction,
  subscriptionByInvoice: Map<string, string>,
): GatewayFeeProps | null {
  const source = bt.source;
  if (!source || typeof source === 'string' || source.object !== 'charge') return null;
  const charge = source as StripeCharge;

  // Our mirror stores the PaymentIntent id (155k rows start with `pi_`). Charges
  // created outside a PaymentIntent (legacy Checkout, direct charge API) have
  // none; their charge id is the only key that could ever match, so use it.
  const joinKey = charge.payment_intent ?? charge.id;

  return {
    platform: STRIPE_PLATFORM,
    platformPaymentId: joinKey,
    grossAmount: fromMinorUnits(charge.amount, charge.currency),
    currency: charge.currency.toUpperCase(),
    // fee/net/amount are all in the SETTLEMENT currency (bt.currency), never in
    // the charge currency. Dividing them by the charge's divisor would be wrong
    // whenever the two differ in decimal places.
    feeAmount: fromMinorUnits(bt.fee, bt.currency),
    // Stripe withholds no tax at source; the plane has nothing to report, which
    // is null rather than 0. See migrations/sql/0015.
    taxAmount: null,
    netAmount: fromMinorUnits(bt.net, bt.currency),
    settlementCurrency: bt.currency.toUpperCase(),
    settlementAmount: fromMinorUnits(bt.amount, bt.currency),
    exchangeRate: bt.exchange_rate,
    refundedAmount: fromMinorUnits(charge.amount_refunded, charge.currency),
    gatewayStatus: charge.status,
    invoiceId: charge.invoice,
    subscriptionId: charge.invoice ? (subscriptionByInvoice.get(charge.invoice) ?? null) : null,
    // The charge date, not the ledger date: it is what basket_payments.created_at
    // holds, so month buckets line up between the two tables.
    capturedAt: new Date(charge.created * 1000),
  };
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
