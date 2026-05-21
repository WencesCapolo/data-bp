import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { IFixtureMatchRepository } from '@basket/core/ports/IFixtureMatchRepository';
import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';
import { basketFixtureMatches } from '../schema';

const BATCH = 500;

export class DrizzleFixtureMatchRepository implements IFixtureMatchRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(rows: FixtureMatchProps[]): Promise<number> {
    if (rows.length === 0) return 0;
    // Dedup within batch on id (last-write-wins) to avoid ON CONFLICT double-row error.
    const dedup = new Map<number, FixtureMatchProps>();
    for (const r of rows) dedup.set(r.id, r);
    const deduped = [...dedup.values()];

    let total = 0;
    for (const part of chunk(deduped, BATCH)) {
      await this.database
        .insert(basketFixtureMatches)
        .values(part.map((r) => ({ ...r, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: basketFixtureMatches.id,
          set: {
            matchDate: sql`excluded.match_date`,
            matchTime: sql`excluded.match_time`,
            homeTeam: sql`excluded.home_team`,
            awayTeam: sql`excluded.away_team`,
            venue: sql`excluded.venue`,
            broadcaster: sql`excluded.broadcaster`,
            sourceSheet: sql`excluded.source_sheet`,
            syncedAt: sql`NOW()`,
          },
        });
      total += part.length;
    }
    return total;
  }

  async count(): Promise<number> {
    const rows = await this.database
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(basketFixtureMatches);
    return Number(rows[0]?.c ?? 0);
  }
}
