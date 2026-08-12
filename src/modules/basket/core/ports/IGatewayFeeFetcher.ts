import type { GatewayFeeProps } from '../entities/GatewayFee';

export interface FeeWindow {
  /** Inclusive. */
  from: Date;
  /** Exclusive, so consecutive windows never double-count a boundary second. */
  to: Date;
}

/**
 * Pulls fee/net/settlement data for one gateway over a time window.
 *
 * Window-based and streaming rather than lookup-by-id on purpose: both gateways
 * expose a bulk list endpoint that returns ~100 transactions per request, so a
 * 430k-row backfill is thousands of requests instead of hundreds of thousands.
 * The join back to Pagos happens in the database, not here — the fetcher does
 * not know or care which transactions this mirror already has.
 */
export interface IGatewayFeeFetcher {
  /** basket_payments.platform value these records belong to. */
  readonly platform: number;
  /** Short slug for logs and sync-state keys: 'stripe', 'mercadopago'. */
  readonly slug: string;

  streamFees(window: FeeWindow): AsyncGenerator<GatewayFeeProps, void, unknown>;
}
