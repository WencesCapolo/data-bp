import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import type { IGatewayMirrorRepository } from '@basket/core/ports/IGatewayMirror';
import { basketGatewayMovements } from '../schema';

const UPSERT_BATCH_SIZE = 500;

function toDbValues(m: GatewayMovementProps) {
  return {
    platform: m.platform,
    movementId: m.movementId,
    platformPaymentId: m.platformPaymentId,
    type: m.type,
    currency: m.currency,
    netAmount: m.netAmount.toFixed(2),
    occurredAt: m.occurredAt,
    availableAt: m.availableAt,
  };
}

export class DrizzleGatewayMovementRepository
implements IGatewayMirrorRepository<GatewayMovementProps> {
  constructor(private readonly database: Db = db) {}

  async upsertMany(movements: GatewayMovementProps[]): Promise<number> {
    if (movements.length === 0) return 0;
    const deduped = new Map<string, GatewayMovementProps>();
    for (const m of movements) deduped.set(`${m.platform}:${m.movementId}`, m);

    let total = 0;
    for (const batch of chunk([...deduped.values()], UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketGatewayMovements)
        .values(batch.map(toDbValues))
        .onConflictDoUpdate({
          target: [basketGatewayMovements.platform, basketGatewayMovements.movementId],
          set: {
            // A release date MP had not scheduled yet arrives in a later file;
            // a later file that again leaves it empty never erases it.
            availableAt: sql`COALESCE(excluded.available_at, ${basketGatewayMovements.availableAt})`,
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
      .from(basketGatewayMovements);
    return row?.value ?? 0;
  }
}
