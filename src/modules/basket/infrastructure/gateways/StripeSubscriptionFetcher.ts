import type { GatewaySubscriptionProps } from '@basket/core/entities/GatewaySubscription';
import type { IGatewaySubscriptionFetcher } from '@basket/core/ports/IGatewaySubscriptionFetcher';
import { getJson } from './httpJson';
import { fromMinorUnits } from './money';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/subscriptions';
const PAGE_SIZE = 100;

export interface StripeSubscriptionFetcherConfig {
  secretKey: string;
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  onPage?: (fetched: number) => void;
}

interface StripePrice {
  unit_amount: number | null;
  currency: string | null;
  recurring: { interval: string; interval_count: number } | null;
}

interface StripeSubscription {
  id: string;
  customer: string | null;
  status: string;
  created: number;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  canceled_at: number | null;
  ended_at: number | null;
  trial_end: number | null;
  currency: string | null;
  items: { data: Array<{ price: StripePrice | null; quantity: number | null }> } | null;
}

interface StripeSubscriptionList {
  data: StripeSubscription[];
  has_more: boolean;
}

/**
 * Reads every subscription, on every run.
 *
 * `status=all` is essential and easy to omit: the endpoint defaults to returning
 * only *live* subscriptions, so the default would silently hide exactly the
 * cancelled ones churn reporting exists to count.
 *
 * There is no incremental mode because Stripe offers no `updated` filter on this
 * endpoint — only `created`. Cancellation is an update to an old object, so any
 * window over `created` would miss it. The Events API can report changes but only
 * retains 30 days, which makes it a supplement, not a source of truth. Re-reading
 * the full set is ~250 requests at current volume and is always correct.
 */
export class StripeSubscriptionFetcher implements IGatewaySubscriptionFetcher {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripeSubscriptionFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripeSubscriptionFetcher requires a secret key');
  }

  async *streamSubscriptions(): AsyncGenerator<GatewaySubscriptionProps> {
    let startingAfter: string | null = null;
    let fetched = 0;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      // Without this the endpoint returns live subscriptions only.
      url.searchParams.set('status', 'all');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripeSubscriptionList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const sub of page.data) yield toProps(sub);
      fetched += page.data.length;
      this.cfg.onPage?.(fetched);

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toProps(s: StripeSubscription): GatewaySubscriptionProps {
  // A subscription can hold several items; the first is the plan in every case
  // we bill. Summing them would invent a price that appears on no invoice.
  const price = s.items?.data?.[0]?.price ?? null;
  const currency = (price?.currency ?? s.currency ?? null)?.toUpperCase() ?? null;

  return {
    platform: STRIPE_PLATFORM,
    subscriptionId: s.id,
    customerId: s.customer,
    status: s.status,
    currency,
    amount: price?.unit_amount != null && price.currency
      ? fromMinorUnits(price.unit_amount, price.currency)
      : null,
    interval: price?.recurring?.interval ?? null,
    intervalCount: price?.recurring?.interval_count ?? null,
    createdAt: unix(s.created),
    currentPeriodStart: unix(s.current_period_start),
    currentPeriodEnd: unix(s.current_period_end),
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    cancelAt: unix(s.cancel_at),
    canceledAt: unix(s.canceled_at),
    endedAt: unix(s.ended_at),
    trialEnd: unix(s.trial_end),
  };
}

function unix(seconds: number | null | undefined): Date | null {
  return seconds == null ? null : new Date(seconds * 1000);
}
