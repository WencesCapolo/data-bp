import type { GatewaySubscriptionProps } from '../entities/GatewaySubscription';

/**
 * Streams every subscription the gateway knows about.
 *
 * Deliberately NOT window-based, unlike IGatewayFeeFetcher. A fee belongs to a
 * moment and never changes; a subscription is a living object whose most
 * important field — whether it is still alive — changes long after it was
 * created. A window over `created` would never surface a cancellation of a
 * two-year-old subscription, which is precisely the event churn reporting is
 * about. So this reads the whole set each time and upserts over it.
 *
 * That is affordable because subscriptions are counted in tens of thousands,
 * not the hundreds of thousands that payments are: ~250 requests, not ~2 800.
 */
export interface IGatewaySubscriptionFetcher {
  readonly platform: number;
  readonly slug: string;
  streamSubscriptions(): AsyncGenerator<GatewaySubscriptionProps, void, unknown>;
}
