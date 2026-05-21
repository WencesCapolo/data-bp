import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import { Tournament, type TournamentProps } from '@basket/core/entities/Tournament';
import type { ITournamentRepository } from '@basket/core/ports/ITournamentRepository';
import { basketTournaments } from '../schema';

const UPSERT_BATCH_SIZE = 500;

export class DrizzleTournamentRepository implements ITournamentRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(tournaments: TournamentProps[]): Promise<number> {
    if (tournaments.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(tournaments, UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketTournaments)
        .values(batch.map((t) => ({ ...t, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: basketTournaments.id,
          set: {
            name: sql`excluded.name`,
            country: sql`excluded.country`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async findById(id: number): Promise<Tournament | null> {
    const rows = await this.database
      .select()
      .from(basketTournaments)
      .where(eq(basketTournaments.id, id))
      .limit(1);
    return rows[0] ? Tournament.fromProps(rows[0] as TournamentProps) : null;
  }

  async count(): Promise<number> {
    const rows = await this.database
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(basketTournaments);
    return Number(rows[0]?.c ?? 0);
  }

  async getKnownIds(): Promise<Set<number>> {
    const rows = await this.database
      .select({ id: basketTournaments.id })
      .from(basketTournaments);
    return new Set(rows.map((r) => r.id));
  }
}
