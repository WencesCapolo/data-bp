import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
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
    taxAmount: f.taxAmount == null ? null : f.taxAmount.toFixed(2),
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

/**
 * An incoming row that saw no charge — only what happened afterwards.
 *
 * MercadoPago's all-transactions report is one row per *movement*, and a report
 * window almost never holds both a charge and its reversal: a chargeback lands
 * weeks after the payment, so a **daily** report is mostly reversals of charges
 * it cannot see. The adapter folds such a window into gross 0, a negative fee
 * (the commission coming back) and a negative net — an honest description of the
 * movements it saw, and a catastrophic thing to overwrite a good row with. Left
 * unguarded, one chargeback would erase the charge, the commission and the
 * withholding of that Pago and report MercadoPago as having earned nothing on it.
 *
 * So a reversal-only row updates only what it actually knows: how much came back,
 * and that the operation was reversed.
 */
const NO_CHARGE = sql`excluded.gross_amount = 0`;

/** Take the incoming value, unless the incoming row never saw the charge. */
function keepOnReversal(column: AnyPgColumn, excludedName: string) {
  return sql`CASE WHEN ${NO_CHARGE} THEN ${column} ELSE ${sql.raw(`excluded.${excludedName}`)} END`;
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
            // Every amount is taken from the incoming row EXCEPT when that row
            // never saw the charge — see NO_CHARGE above. Whatever describes the
            // charge is kept, whatever describes the reversal advances.
            grossAmount: keepOnReversal(basketPaymentFees.grossAmount, 'gross_amount'),
            currency: keepOnReversal(basketPaymentFees.currency, 'currency'),
            feeAmount: keepOnReversal(basketPaymentFees.feeAmount, 'fee_amount'),
            taxAmount: keepOnReversal(basketPaymentFees.taxAmount, 'tax_amount'),
            netAmount: keepOnReversal(basketPaymentFees.netAmount, 'net_amount'),
            settlementCurrency: keepOnReversal(basketPaymentFees.settlementCurrency, 'settlement_currency'),
            settlementAmount: keepOnReversal(basketPaymentFees.settlementAmount, 'settlement_amount'),
            exchangeRate: keepOnReversal(basketPaymentFees.exchangeRate, 'exchange_rate'),
            // Monotone while reversal-only, so two reports that each saw one of
            // an operation's two refunds cannot talk each other down. A file that
            // saw the charge states the whole story and simply wins.
            refundedAmount: sql`CASE WHEN ${NO_CHARGE}
              THEN GREATEST(excluded.refunded_amount, ${basketPaymentFees.refundedAmount})
              ELSE excluded.refunded_amount END`,
            // A chargeback is never talked back down to a refund by a later
            // reversal-only row.
            // A row that never saw the charge cannot clear a reversal either: a
            // window holding only a cancelled chargeback reports `approved` for
            // an operation whose chargeback it never saw, and letting that win
            // would quietly un-refund a Pago. Only a file that saw the charge
            // states the whole story.
            gatewayStatus: sql`CASE
              WHEN ${NO_CHARGE} AND ${basketPaymentFees.gatewayStatus} IN ('charged_back', 'refunded')
                THEN CASE WHEN excluded.gateway_status = 'charged_back'
                       THEN excluded.gateway_status ELSE ${basketPaymentFees.gatewayStatus} END
              WHEN ${NO_CHARGE} THEN excluded.gateway_status
              ELSE excluded.gateway_status END`,
            capturedAt: keepOnReversal(basketPaymentFees.capturedAt, 'captured_at'),
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
