/**
 * A payout — money leaving the Provider for the bank.
 *
 * The only record that answers "what hit the bank on date X". Net revenue does
 * not answer it: net sums what was earned in a period, while a payout moves a
 * balance that was accumulated over a different, overlapping one, minus
 * whatever the Provider held back. The two never match on a given day and are
 * not supposed to.
 *
 * Pure SETTLEMENT plane — a payout has no presentment side at all.
 */
export interface GatewayPayoutProps {
  platform: number;
  payoutId: string;
  amount: number;
  currency: string;
  /** paid | pending | in_transit | canceled | failed. */
  status: string;
  type: string | null;
  method: string | null;
  automatic: boolean | null;
  /** The bank's date — what a reconciliation is done against. */
  arrivalDate: Date | null;
  /** When the Provider scheduled it. Days earlier than arrival. */
  createdAt: Date | null;
  description: string | null;
  statementDescriptor: string | null;
  failureCode: string | null;
  balanceTransactionId: string | null;
}

export class GatewayPayout {
  constructor(private readonly props: GatewayPayoutProps) {}

  get payoutId(): string { return this.props.payoutId; }

  /** Money actually in the bank. `in_transit` and `pending` are promises, and a
   *  `failed` payout returns the balance to the Provider — counting either as
   *  received overstates the bank by whole payouts. */
  get isSettled(): boolean {
    return this.props.status === 'paid';
  }

  toJSON(): GatewayPayoutProps {
    return { ...this.props };
  }

  static fromProps(props: GatewayPayoutProps): GatewayPayout {
    return new GatewayPayout(props);
  }
}
