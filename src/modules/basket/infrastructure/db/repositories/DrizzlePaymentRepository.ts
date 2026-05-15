import { and, eq, lte, gte, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import { Payment, type PaymentProps } from '@basket/core/entities/Payment';
import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';
import { basketPayments } from '../schema';

const UPSERT_BATCH_SIZE = 500;

interface PaymentDbRow extends Omit<PaymentProps, 'amount'> {
  amount: string;
}

function toEntityProps(row: PaymentDbRow): PaymentProps {
  return { ...row, amount: parseFloat(row.amount) };
}

function toDbValues(p: PaymentProps) {
  return { ...p, amount: p.amount.toFixed(2) };
}

export class DrizzlePaymentRepository implements IPaymentRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(payments: PaymentProps[]): Promise<number> {
    if (payments.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(payments, UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketPayments)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: basketPayments.id,
          set: {
            status: sql`excluded.status`,
            statusDetail: sql`excluded.status_detail`,
            expiresAt: sql`excluded.expires_at`,
            amount: sql`excluded.amount`,
            currency: sql`excluded.currency`,
            paymentCountry: sql`excluded.payment_country`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async findById(id: number): Promise<Payment | null> {
    const rows = await this.database
      .select()
      .from(basketPayments)
      .where(eq(basketPayments.id, id))
      .limit(1);
    return rows[0] ? Payment.fromProps(toEntityProps(rows[0] as PaymentDbRow)) : null;
  }

  async count(): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(basketPayments);
    return row?.value ?? 0;
  }

  async countActiveOn(date: Date): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`COUNT(DISTINCT user_id)::int` })
      .from(basketPayments)
      .where(
        and(
          eq(basketPayments.status, 1),
          lte(basketPayments.createdAt, date),
          gte(sql`${basketPayments.expiresAt} + INTERVAL '${sql.raw(String(Payment.GRACE_PERIOD_DAYS))} days'`, date),
        ),
      );
    return row?.value ?? 0;
  }
}
