import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { ContentProps } from '@basket/core/entities/Content';
import type { IContentRepository } from '@basket/core/ports/IContentRepository';
import { basketContent } from '../schema';

const BATCH = 500;

export class DrizzleContentRepository implements IContentRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(rows: ContentProps[]): Promise<number> {
    if (rows.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(rows, BATCH)) {
      await this.database
        .insert(basketContent)
        .values(batch.map((r) => ({ ...r, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: basketContent.id,
          set: {
            idx: sql`excluded.idx`,
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            imageId: sql`excluded.image_id`,
            createdAt: sql`excluded.created_at`,
            updatedAt: sql`excluded.updated_at`,
            date: sql`excluded.date`,
            dateEnds: sql`excluded.date_ends`,
            dateServerSpawns: sql`excluded.date_server_spawns`,
            dateServerGoesLive: sql`excluded.date_server_goes_live`,
            duration: sql`excluded.duration`,
            status: sql`excluded.status`,
            type: sql`excluded.type`,
            matchId: sql`excluded.match_id`,
            venue: sql`excluded.venue`,
            team1: sql`excluded.team_1`,
            team2: sql`excluded.team_2`,
            team1Name: sql`excluded.team_1_name`,
            team2Name: sql`excluded.team_2_name`,
            team1Score: sql`excluded.team_1_score`,
            team2Score: sql`excluded.team_2_score`,
            matchStatus: sql`excluded.match_status`,
            tournamentId: sql`excluded.tournament_id`,
            country: sql`excluded.country`,
            productId: sql`excluded.product_id`,
            weight: sql`excluded.weight`,
            views: sql`excluded.views`,
            viewsUsers: sql`excluded.views_users`,
            viewsSeconds: sql`excluded.views_seconds`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async count(): Promise<number> {
    const rows = await this.database
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(basketContent);
    return Number(rows[0]?.c ?? 0);
  }
}
