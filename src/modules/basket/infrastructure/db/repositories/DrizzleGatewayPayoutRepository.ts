import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';
import type { IGatewayMirrorRepository } from '@basket/core/ports/IGatewayMirror';
import { basketGatewayPayouts } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(p: GatewayPayoutProps) {
  return {
    platform: p.platform,
    payoutId: p.payoutId,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    status: p.status,
    type: p.type,
    method: p.method,
    automatic: p.automatic,
    arrivalDate: p.arrivalDate,
    createdAt: p.createdAt,
    description: p.description,
    statementDescriptor: p.statementDescriptor,
    failureCode: p.failureCode,
    balanceTransactionId: p.balanceTransactionId,
  };
}

export interface BankArrival {
  arrivalDate: Date | null;
  currency: string;
  payouts: number;
  amount: number;
  status: string;
}

export class DrizzleGatewayPayoutRepository
implements IGatewayMirrorRepository<GatewayPayoutProps> {
  constructor(private readonly database: Db = db) {}

  async upsertMany(payouts: GatewayPayoutProps[]): Promise<number> {
    if (payouts.length === 0) return 0;
    const deduped = new Map<string, GatewayPayoutProps>();
    for (const p of payouts) deduped.set(`${p.platform}:${p.payoutId}`, p);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketGatewayPayouts)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketGatewayPayouts.platform, basketGatewayPayouts.payoutId],
          set: {
            amount: sql`excluded.amount`,
            currency: sql`excluded.currency`,
            status: sql`excluded.status`,
            type: sql`excluded.type`,
            method: sql`excluded.method`,
            automatic: sql`excluded.automatic`,
            arrivalDate: sql`excluded.arrival_date`,
            createdAt: sql`excluded.created_at`,
            description: sql`excluded.description`,
            statementDescriptor: sql`excluded.statement_descriptor`,
            failureCode: sql`excluded.failure_code`,
            balanceTransactionId: sql`excluded.balance_transaction_id`,
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
      .from(basketGatewayPayouts);
    return row?.value ?? 0;
  }

  /**
   * What hit the bank between two dates.
   *
   * Bucketed on arrival_date — the bank's date — and never summed across
   * currencies: Stripe pays USD and EUR out separately and adding them would
   * invent a number that appears on no statement. Status is carried through
   * rather than filtered, so a `failed` payout is visible as a non-arrival
   * instead of vanishing.
   */
  async arrivals(from: Date, to: Date, platform = 4): Promise<BankArrival[]> {
    const rows = await this.database.execute<{
      arrival_date: Date | null; currency: string; n: number; amount: string; status: string;
    }>(sql`
      SELECT arrival_date, currency, status, COUNT(*)::int AS n, SUM(amount) AS amount
      FROM basket_gateway_payouts
      WHERE platform = ${platform}
        AND arrival_date >= ${from.toISOString()}::timestamptz
        AND arrival_date <  ${to.toISOString()}::timestamptz
      GROUP BY arrival_date, currency, status
      ORDER BY arrival_date DESC, currency
    `);
    return (rows as unknown as {
      arrival_date: Date | null; currency: string; n: number; amount: string; status: string;
    }[]).map((r) => ({
      // db.execute hands timestamps back as strings, not Dates.
      arrivalDate: r.arrival_date == null ? null : new Date(r.arrival_date),
      currency: r.currency,
      status: r.status,
      payouts: Number(r.n),
      amount: Number(r.amount),
    }));
  }
}
