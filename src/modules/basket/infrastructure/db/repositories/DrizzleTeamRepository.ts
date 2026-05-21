import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import { Team, type TeamProps } from '@basket/core/entities/Team';
import type { ITeamRepository, TeamLiveProps } from '@basket/core/ports/ITeamRepository';
import { basketTeams } from '../schema';

const UPSERT_BATCH_SIZE = 500;

export class DrizzleTeamRepository implements ITeamRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(teams: TeamProps[]): Promise<number> {
    if (teams.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(teams, UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketTeams)
        .values(batch)
        .onConflictDoUpdate({
          target: basketTeams.id,
          set: {
            teamName: sql`excluded.team_name`,
            league: sql`excluded.league`,
            country: sql`excluded.country`,
            tier: sql`excluded.tier`,
            type: sql`excluded.type`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async findById(id: number): Promise<Team | null> {
    const rows = await this.database.select().from(basketTeams).where(eq(basketTeams.id, id)).limit(1);
    return rows[0] ? Team.fromProps(rows[0] as TeamProps) : null;
  }

  async findAll(): Promise<Team[]> {
    const rows = await this.database.select().from(basketTeams);
    return rows.map((r) => Team.fromProps(r as TeamProps));
  }

  async getKnownIds(): Promise<Set<number>> {
    const rows = await this.database.select({ id: basketTeams.id }).from(basketTeams);
    return new Set(rows.map((r) => r.id));
  }

  async count(): Promise<number> {
    const rows = await this.database
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(basketTeams);
    return Number(rows[0]?.c ?? 0);
  }

  async upsertManyFromLive(teams: TeamLiveProps[]): Promise<number> {
    if (teams.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(teams, UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketTeams)
        .values(
          batch.map((t) => ({
            id: t.id,
            teamName: t.teamName,
            league: 'Unknown',
            country: t.country || 'Unknown',
            tier: 1,
            type: 'regular',
          })),
        )
        .onConflictDoUpdate({
          target: basketTeams.id,
          set: {
            teamName: sql`excluded.team_name`,
            country: sql`excluded.country`,
          },
        });
      total += batch.length;
    }
    return total;
  }
}
