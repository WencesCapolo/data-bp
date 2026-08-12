import type { GatewayFeeProps } from '../entities/GatewayFee';

export interface FeeCoverage {
  platform: number;
  /** Successful Pagos on this platform that carry a gateway id at all. */
  joinablePayments: number;
  /** …of those, how many now have a fee row. */
  withFee: number;
}

export interface IGatewayFeeRepository {
  upsertMany(fees: GatewayFeeProps[]): Promise<number>;
  count(): Promise<number>;
  /** How much of basket_payments the mirror can now answer fees for, per
   *  platform. The backfill's completion signal and the drift alarm afterwards. */
  coverage(): Promise<FeeCoverage[]>;
}
