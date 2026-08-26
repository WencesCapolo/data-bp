/**
 * One gateway transaction as the gateway reports it.
 *
 * Two currency planes, never mixed (see docs/adr/0005):
 *   PRESENTMENT — `currency` / `grossAmount`: what the subscriber was charged.
 *                 Reconciles against basket_payments.currency / .amount.
 *   SETTLEMENT  — `settlementCurrency` / `settlementAmount` / `feeAmount` /
 *                 `netAmount`: what the gateway moved into the account. Fees
 *                 only exist here.
 *
 * `exchangeRate` is presentment → settlement as applied on the charge date, or
 * null when the gateway does not convert (MercadoPago settles ARS into ARS), in
 * which case the two planes are the same currency.
 */
export interface GatewayFeeProps {
  platform: number;
  /** Join key into basket_payments.platform_payment_id. */
  platformPaymentId: string;
  grossAmount: number;
  currency: string;
  feeAmount: number;
  /** Tax withheld at source by the gateway, in the settlement plane, or null
   *  where the gateway withholds none. Kept apart from `feeAmount` because a
   *  commission is spent and a withholding is a tax credit that comes back —
   *  see migrations/sql/0015. Invariant: gross - fee - (tax ?? 0) = net. */
  taxAmount: number | null;
  netAmount: number;
  settlementCurrency: string;
  settlementAmount: number;
  exchangeRate: number | null;
  refundedAmount: number;
  /** Gateway-side status verbatim: 'succeeded', 'approved', 'refunded', … */
  gatewayStatus: string | null;
  capturedAt: Date | null;
  /** The invoice this charge paid, when it paid one. Null for one-off charges. */
  invoiceId: string | null;
  /** The subscription that invoice belongs to. Resolved via the invoice, since
   *  the charge itself never carries it. Null for one-off charges. */
  subscriptionId: string | null;
}

export class GatewayFee {
  constructor(private readonly props: GatewayFeeProps) {}

  get platformPaymentId(): string { return this.props.platformPaymentId; }
  get feeAmount(): number { return this.props.feeAmount; }
  get taxAmount(): number | null { return this.props.taxAmount; }

  /** Everything the gateway kept, commission and withholding together. What
   *  actually failed to arrive — use it for cash, never for comparing one
   *  gateway's pricing against another's. */
  get totalDeducted(): number {
    return this.props.feeAmount + (this.props.taxAmount ?? 0);
  }
  get netAmount(): number { return this.props.netAmount; }

  /** Commission as a share of settled gross. Null when gross is 0 (100% coupon,
   *  authorization-only), where a ratio would be a division by zero, not 0%. */
  get feeRatio(): number | null {
    if (this.props.settlementAmount === 0) return null;
    return this.props.feeAmount / this.props.settlementAmount;
  }

  /** A renewal, as opposed to a one-off purchase. */
  get isSubscriptionCharge(): boolean {
    return this.props.subscriptionId !== null;
  }

  /** A conversion happened only when the gateway settled into another currency. */
  get isConverted(): boolean {
    return this.props.settlementCurrency !== this.props.currency;
  }

  toJSON(): GatewayFeeProps {
    return { ...this.props };
  }

  static fromProps(props: GatewayFeeProps): GatewayFee {
    return new GatewayFee(props);
  }
}
