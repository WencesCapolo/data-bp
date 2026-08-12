import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewaySubscriptionProps } from '@basket/core/entities/GatewaySubscription';
import type {
  IGatewaySubscriptionRepository,
  SubscriptionStatusCount,
} from '@basket/core/ports/IGatewaySubscriptionRepository';
import { basketGatewaySubscriptions } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(s: GatewaySubscriptionProps) {
  return {
    platform: s.platform,
    subscriptionId: s.subscriptionId,
    customerId: s.customerId,
    status: s.status,
    currency: s.currency,
    amount: s.amount == null ? null : s.amount.toFixed(2),
    interval: s.interval,
    intervalCount: s.intervalCount,
    createdAt: s.createdAt,
    currentPeriodStart: s.currentPeriodStart,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cancelAt: s.cancelAt,
    canceledAt: s.canceledAt,
    endedAt: s.endedAt,
    trialEnd: s.trialEnd,
  };
}

export class DrizzleGatewaySubscriptionRepository implements IGatewaySubscriptionRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(subscriptions: GatewaySubscriptionProps[]): Promise<number> {
    if (subscriptions.length === 0) return 0;
    const deduped = new Map<string, GatewaySubscriptionProps>();
    for (const s of subscriptions) deduped.set(`${s.platform}:${s.subscriptionId}`, s);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketGatewaySubscriptions)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketGatewaySubscriptions.platform, basketGatewaySubscriptions.subscriptionId],
          set: {
            customerId: sql`excluded.customer_id`,
            status: sql`excluded.status`,
            currency: sql`excluded.currency`,
            amount: sql`excluded.amount`,
            interval: sql`excluded.interval`,
            intervalCount: sql`excluded.interval_count`,
            createdAt: sql`excluded.created_at`,
            currentPeriodStart: sql`excluded.current_period_start`,
            currentPeriodEnd: sql`excluded.current_period_end`,
            cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
            cancelAt: sql`excluded.cancel_at`,
            canceledAt: sql`excluded.canceled_at`,
            endedAt: sql`excluded.ended_at`,
            trialEnd: sql`excluded.trial_end`,
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
      .from(basketGatewaySubscriptions);
    return row?.value ?? 0;
  }

  async countByStatus(): Promise<SubscriptionStatusCount[]> {
    const rows = await this.database.execute<{ platform: number; status: string; n: number }>(sql`
      SELECT platform, status, COUNT(*)::int AS n
      FROM basket_gateway_subscriptions
      GROUP BY platform, status
      ORDER BY n DESC
    `);
    return (rows as unknown as { platform: number; status: string; n: number }[]).map((r) => ({
      platform: Number(r.platform),
      status: r.status,
      count: Number(r.n),
    }));
  }
}
