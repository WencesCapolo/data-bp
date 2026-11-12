/**
 * One movement of money inside a Provider account, as the Provider's ledger
 * states it: a settlement, a refund, a chargeback, a commission invoice.
 *
 * The fee mirror (`GatewayFee`) folds an operation's movements into one row per
 * Pago and dates it by capture: right for "what did we earn". This is the other
 * question — "when did the money become ours to spend" — so it keeps every
 * movement apart, signed in the account's frame (+ in, − out), and dated by
 * `availableAt`: MercadoPago's `MONEY_RELEASE_DATE`, or `SETTLEMENT_DATE` for a
 * refund or chargeback made after the release. Cashflow reads it.
 */
export interface GatewayMovementProps {
  platform: number;
  /** Stable across every file that carries the movement. */
  movementId: string;
  /** The operation it belongs to, when there is one. */
  platformPaymentId: string | null;
  /** Provider type verbatim (`SETTLEMENT`, `REFUND`, …); `ADJUSTMENT` when the
   *  Provider gives none. */
  type: string;
  currency: string;
  /** Signed in the account frame: what the movement did to the balance. */
  netAmount: number;
  occurredAt: Date | null;
  /** When the movement reaches the available balance (a sale's release, a late
   *  refund's own day), or null when the Provider has not scheduled it. */
  availableAt: Date | null;
}
