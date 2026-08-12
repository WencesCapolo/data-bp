/**
 * A gateway subscription — the only record that states churn outright.
 *
 * Everything before this table inferred cancellation from silence: if no payment
 * arrived within 60 days (monthly) or 420 (annual), the subscriber was assumed
 * gone. That conflates "cancelled", "card declined", and "gateway retrying", and
 * it can only ever report churn ~2 months late. `status` and `canceledAt` say
 * what actually happened, on the day it happened.
 */
export interface GatewaySubscriptionProps {
  platform: number;
  subscriptionId: string;
  customerId: string | null;
  /** Gateway status verbatim: active, canceled, past_due, unpaid, trialing, … */
  status: string;
  currency: string | null;
  amount: number | null;
  /** 'month' | 'year' as the gateway words it. */
  interval: string | null;
  intervalCount: number | null;
  createdAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  trialEnd: Date | null;
}

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export class GatewaySubscription {
  constructor(private readonly props: GatewaySubscriptionProps) {}

  get subscriptionId(): string { return this.props.subscriptionId; }
  get status(): string { return this.props.status; }

  /** Still generating revenue, or expected to. `past_due` counts: the gateway is
   *  still retrying and most recover — treating it as churn reports the loss
   *  early and then has to take it back. */
  get isLive(): boolean {
    return LIVE_STATUSES.has(this.props.status);
  }

  /**
   * Cancelled but still inside the paid period — the subscriber has left, the
   * revenue has not yet. Neither an active subscriber nor a completed churn,
   * and the distinction is the whole point of leading indicators: this is churn
   * that is already certain but has not landed.
   */
  get isPendingCancellation(): boolean {
    return this.props.cancelAtPeriodEnd && this.isLive;
  }

  /** When churn actually landed, as opposed to when it was requested. */
  get churnedAt(): Date | null {
    return this.props.endedAt ?? this.props.canceledAt;
  }

  toJSON(): GatewaySubscriptionProps {
    return { ...this.props };
  }

  static fromProps(props: GatewaySubscriptionProps): GatewaySubscription {
    return new GatewaySubscription(props);
  }
}
