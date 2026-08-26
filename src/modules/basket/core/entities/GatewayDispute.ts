/**
 * A dispute (chargeback) — a reversal the fee mirror could not express.
 *
 * `basket_payment_fees.refunded_amount` covers refunds and only refunds. A
 * disputed charge is money taken back by the card network, plus a
 * non-refundable case fee, and before this record it was indistinguishable from
 * a charge that was never touched.
 *
 * PLANES, and the trap: `amount` is PRESENTMENT — what the Subscriber was
 * charged, in their currency, exactly like `refundedAmount`. `feeAmount` is
 * SETTLEMENT — the case fee, in the account's currency. Adding them, or
 * dividing one by the other, produces a number that means nothing.
 */
export interface GatewayDisputeProps {
  platform: number;
  disputeId: string;
  /** Same join key basket_payment_fees uses: PaymentIntent id, else charge id. */
  platformPaymentId: string;
  chargeId: string | null;
  amount: number;
  currency: string;
  /** Gateway status verbatim: warning_needs_response, lost, won, … */
  status: string;
  reason: string | null;
  feeAmount: number | null;
  settlementCurrency: string | null;
  isChargeRefundable: boolean | null;
  evidenceDueBy: Date | null;
  createdAt: Date | null;
}

/** Statuses in which the money is gone for good. `won` gives it back; the
 *  `warning_*` and `needs_response` statuses are still open cases. */
const LOST_STATUSES = new Set(['lost', 'charge_refunded']);

export class GatewayDispute {
  constructor(private readonly props: GatewayDisputeProps) {}

  get disputeId(): string { return this.props.disputeId; }
  get status(): string { return this.props.status; }

  /** Settled against us — the reversal is final. */
  get isLost(): boolean {
    return LOST_STATUSES.has(this.props.status);
  }

  /** Still contestable, so the amount is at risk rather than lost. Reporting it
   *  as a loss now means taking it back when the case is won. */
  get isOpen(): boolean {
    return !this.isLost && this.props.status !== 'won';
  }

  toJSON(): GatewayDisputeProps {
    return { ...this.props };
  }

  static fromProps(props: GatewayDisputeProps): GatewayDispute {
    return new GatewayDispute(props);
  }
}
