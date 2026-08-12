import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { FeeCoverage, IGatewayFeeRepository } from '@basket/core/ports/IGatewayFeeRepository';
import { basketPaymentFees } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(f: GatewayFeeProps) {
  return {
    platform: f.platform,
    platformPaymentId: f.platformPaymentId,
    grossAmount: f.grossAmount.toFixed(2),
    currency: f.currency,
    feeAmount: f.feeAmount.toFixed(2),
    netAmount: f.netAmount.toFixed(2),
    settlementCurrency: f.settlementCurrency,
    settlementAmount: f.settlementAmount.toFixed(2),
    exchangeRate: f.exchangeRate == null ? null : String(f.exchangeRate),
    refundedAmount: f.refundedAmount.toFixed(2),
    gatewayStatus: f.gatewayStatus,
    capturedAt: f.capturedAt,
    invoiceId: f.invoiceId,
    subscriptionId: f.subscriptionId,
  };
}

export class DrizzleGatewayFeeRepository implements IGatewayFeeRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(fees: GatewayFeeProps[]): Promise<number> {
    if (fees.length === 0) return 0;
    // One gateway transaction can surface twice inside a single batch — a window
    // re-probe, an overlapping incremental run — and Postgres rejects a statement
    // whose ON CONFLICT target is hit twice by the same command. Last write wins,
    // which is what re-reading the gateway means anyway.
    const deduped = new Map<string, GatewayFeeProps>();
    for (const fee of fees) deduped.set(`${fee.platform}:${fee.platformPaymentId}`, fee);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketPaymentFees)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketPaymentFees.platform, basketPaymentFees.platformPaymentId],
          set: {
            grossAmount: sql`excluded.gross_amount`,
            currency: sql`excluded.currency`,
            feeAmount: sql`excluded.fee_amount`,
            netAmount: sql`excluded.net_amount`,
            settlementCurrency: sql`excluded.settlement_currency`,
            settlementAmount: sql`excluded.settlement_amount`,
            exchangeRate: sql`excluded.exchange_rate`,
            refundedAmount: sql`excluded.refunded_amount`,
            gatewayStatus: sql`excluded.gateway_status`,
            capturedAt: sql`excluded.captured_at`,
            invoiceId: sql`excluded.invoice_id`,
            // COALESCE, not overwrite: a re-read whose window missed the
            // invoice resolves to null, and letting that null replace a link we
            // already have would erase good data on every overlap pass.
            subscriptionId: sql`COALESCE(excluded.subscription_id, ${basketPaymentFees.subscriptionId})`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async count(): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(basketPaymentFees);
    return row?.value ?? 0;
  }

  async coverage(): Promise<FeeCoverage[]> {
    // Measured against successful Pagos that carry a gateway id, because those
    // are the only rows a fee could ever attach to. Manual, Voucher and Antel
    // have no gateway behind them and would drag an honest ratio down forever.
    const rows = await this.database.execute<{
      platform: number;
      joinable: number;
      with_fee: number;
    }>(sql`
      SELECT p.platform,
             COUNT(*)::int                          AS joinable,
             COUNT(f.platform_payment_id)::int      AS with_fee
      FROM basket_payments p
      LEFT JOIN basket_payment_fees f
        ON  f.platform            = p.platform
        AND f.platform_payment_id = p.platform_payment_id
      WHERE p.status = 1
        AND p.platform_payment_id IS NOT NULL
      GROUP BY p.platform
      ORDER BY p.platform
    `);

    return (rows as unknown as { platform: number; joinable: number; with_fee: number }[]).map((r) => ({
      platform: Number(r.platform),
      joinablePayments: Number(r.joinable),
      withFee: Number(r.with_fee),
    }));
  }
}
