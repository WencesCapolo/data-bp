import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { GatewayFullSource } from '@basket/core/ports/IGatewayMirror';
import { getJson } from './httpJson';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/customers';
const PAGE_SIZE = 100;

export interface StripeCustomerFetcherConfig {
  secretKey: string;
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  onPage?: (fetched: number) => void;
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  description: string | null;
  currency: string | null;
  delinquent: boolean | null;
  created: number;
  address: { country: string | null } | null;
  deleted?: boolean;
}

interface StripeCustomerList {
  data: StripeCustomer[];
  has_more: boolean;
}

/**
 * Reads every customer, on every run.
 *
 * Full pass for the same reason as subscriptions: the list endpoint filters on
 * `created` only, and the field this mirror exists for — the email — is edited
 * long after the customer was created. A `created` window would hold a stale
 * email forever and never know it.
 *
 * ~47k Stripe customers is ~470 requests, comparable to the subscription pass
 * that already runs on the same cron.
 */
export class StripeCustomerFetcher implements GatewayFullSource<GatewayCustomerProps> {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripeCustomerFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripeCustomerFetcher requires a secret key');
  }

  async *stream(): AsyncGenerator<GatewayCustomerProps> {
    let startingAfter: string | null = null;
    let fetched = 0;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripeCustomerList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const c of page.data) {
        // A deleted customer still paginates, carrying nothing but its id. Its
        // subscriptions and charges remain, so the row is worth keeping — but
        // writing its empty email over a good one would break the only join
        // this table exists to serve.
        if (c.deleted) continue;
        yield toProps(c);
      }

      fetched += page.data.length;
      this.cfg.onPage?.(fetched);

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toProps(c: StripeCustomer): GatewayCustomerProps {
  return {
    platform: STRIPE_PLATFORM,
    customerId: c.id,
    email: c.email?.trim() || null,
    name: c.name?.trim() || null,
    country: c.address?.country?.toUpperCase() ?? null,
    currency: c.currency?.toUpperCase() ?? null,
    delinquent: c.delinquent ?? null,
    description: c.description ?? null,
    createdAt: new Date(c.created * 1000),
  };
}
