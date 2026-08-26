import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { IGatewayMirrorRepository } from '@basket/core/ports/IGatewayMirror';
import { basketGatewayDisputes } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(d: GatewayDisputeProps) {
  return {
    platform: d.platform,
    disputeId: d.disputeId,
    platformPaymentId: d.platformPaymentId,
    chargeId: d.chargeId,
    amount: d.amount.toFixed(2),
    currency: d.currency,
    status: d.status,
    reason: d.reason,
    feeAmount: d.feeAmount == null ? null : d.feeAmount.toFixed(2),
    settlementCurrency: d.settlementCurrency,
    isChargeRefundable: d.isChargeRefundable,
    evidenceDueBy: d.evidenceDueBy,
    createdAt: d.createdAt,
  };
}

export interface ReversedCharge {
  platformPaymentId: string;
  disputeId: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  createdAt: Date | null;
  /** Null when the disputed charge is not in basket_payment_fees — the mirror
   *  holds disputes the Pago sync has never seen, and hiding them would
   *  understate reversals. */
  grossAmount: number | null;
}

export class DrizzleGatewayDisputeRepository
implements IGatewayMirrorRepository<GatewayDisputeProps> {
  constructor(private readonly database: Db = db) {}

  async upsertMany(disputes: GatewayDisputeProps[]): Promise<number> {
    if (disputes.length === 0) return 0;
    const deduped = new Map<string, GatewayDisputeProps>();
    for (const d of disputes) deduped.set(`${d.platform}:${d.disputeId}`, d);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketGatewayDisputes)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketGatewayDisputes.platform, basketGatewayDisputes.disputeId],
          set: {
            platformPaymentId: sql`excluded.platform_payment_id`,
            chargeId: sql`excluded.charge_id`,
            amount: sql`excluded.amount`,
            currency: sql`excluded.currency`,
            status: sql`excluded.status`,
            reason: sql`excluded.reason`,
            // COALESCE, not overwrite: a dispute re-read before its balance
            // transactions exist reports no fee, and letting that null replace a
            // fee already stored would erase it on every overlap pass.
            feeAmount: sql`COALESCE(excluded.fee_amount, basket_gateway_disputes.fee_amount)`,
            settlementCurrency: sql`COALESCE(excluded.settlement_currency, basket_gateway_disputes.settlement_currency)`,
            isChargeRefundable: sql`excluded.is_charge_refundable`,
            evidenceDueBy: sql`excluded.evidence_due_by`,
            createdAt: sql`excluded.created_at`,
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
      .from(basketGatewayDisputes);
    return row?.value ?? 0;
  }

  /**
   * Which charges were reversed, in a window over the dispute's own creation.
   *
   * The gross is joined from the fee mirror rather than recomputed, and left as
   * null when absent, so the answer never silently drops a dispute whose Pago
   * this database does not hold.
   */
  async reversedCharges(from: Date, to: Date, platform = 4): Promise<ReversedCharge[]> {
    const rows = await this.database.execute<{
      platform_payment_id: string;
      dispute_id: string;
      amount: string;
      currency: string;
      status: string;
      reason: string | null;
      created_at: Date | null;
      gross_amount: string | null;
    }>(sql`
      SELECT d.platform_payment_id, d.dispute_id, d.amount, d.currency, d.status,
             d.reason, d.created_at, f.gross_amount
      FROM basket_gateway_disputes d
      LEFT JOIN basket_payment_fees f
        ON f.platform = d.platform AND f.platform_payment_id = d.platform_payment_id
      WHERE d.platform = ${platform}
        AND d.created_at >= ${from.toISOString()}::timestamptz
        AND d.created_at <  ${to.toISOString()}::timestamptz
      ORDER BY d.created_at DESC
    `);
    return (rows as unknown as {
      platform_payment_id: string; dispute_id: string; amount: string; currency: string;
      status: string; reason: string | null; created_at: Date | null; gross_amount: string | null;
    }[]).map((r) => ({
      platformPaymentId: r.platform_payment_id,
      disputeId: r.dispute_id,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      // db.execute hands timestamps back as strings, not Dates — the typed
      // generic is a claim, not a conversion.
      createdAt: r.created_at == null ? null : new Date(r.created_at),
      grossAmount: r.gross_amount == null ? null : Number(r.gross_amount),
    }));
  }
}
