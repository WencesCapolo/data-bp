import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { IGatewayMirrorRepository } from '@basket/core/ports/IGatewayMirror';
import { basketGatewayCustomers } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(c: GatewayCustomerProps) {
  return {
    platform: c.platform,
    customerId: c.customerId,
    email: c.email,
    name: c.name,
    country: c.country,
    currency: c.currency,
    delinquent: c.delinquent,
    description: c.description,
    createdAt: c.createdAt,
  };
}

export interface CustomerEmailCoverage {
  platform: number;
  customers: number;
  withEmail: number;
  matchedSubscribers: number;
}

export class DrizzleGatewayCustomerRepository
implements IGatewayMirrorRepository<GatewayCustomerProps> {
  constructor(private readonly database: Db = db) {}

  async upsertMany(customers: GatewayCustomerProps[]): Promise<number> {
    if (customers.length === 0) return 0;
    const deduped = new Map<string, GatewayCustomerProps>();
    for (const c of customers) deduped.set(`${c.platform}:${c.customerId}`, c);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketGatewayCustomers)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketGatewayCustomers.platform, basketGatewayCustomers.customerId],
          set: {
            email: sql`excluded.email`,
            name: sql`excluded.name`,
            country: sql`excluded.country`,
            currency: sql`excluded.currency`,
            delinquent: sql`excluded.delinquent`,
            description: sql`excluded.description`,
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
      .from(basketGatewayCustomers);
    return row?.value ?? 0;
  }

  /**
   * How much of the mirror can actually reach a Subscriber.
   *
   * The point of the table is the email bridge, so its health is not "how many
   * rows" but "how many rows join". Reported per platform because a Provider
   * whose customers carry no email at all is a different failure from one whose
   * Subscribers were never ingested.
   *
   * EXISTS, not a LEFT JOIN. Emails are not unique in basket_users, so a join
   * multiplies a customer by however many Subscribers share its address and
   * reports more customers than the table holds — it read 38,193 against a true
   * 38,170. The question is "does this customer reach a Subscriber", which is a
   * semi-join, and phrasing it as one makes the inflation impossible.
   */
  async emailCoverage(): Promise<CustomerEmailCoverage[]> {
    const rows = await this.database.execute<{
      platform: number;
      customers: number;
      with_email: number;
      matched: number;
    }>(sql`
      SELECT c.platform,
             COUNT(*)::int                                    AS customers,
             COUNT(*) FILTER (WHERE c.email IS NOT NULL)::int AS with_email,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM basket_users u WHERE LOWER(u.email) = LOWER(c.email)
             ))::int                                          AS matched
      FROM basket_gateway_customers c
      GROUP BY c.platform
      ORDER BY c.platform
    `);
    return (rows as unknown as {
      platform: number; customers: number; with_email: number; matched: number;
    }[]).map((r) => ({
      platform: Number(r.platform),
      customers: Number(r.customers),
      withEmail: Number(r.with_email),
      matchedSubscribers: Number(r.matched),
    }));
  }
}
