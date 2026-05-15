import { eq, sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import { User, type UserProps } from '@basket/core/entities/User';
import type { IUserRepository } from '@basket/core/ports/IUserRepository';
import { basketUsers } from '../schema';

const UPSERT_BATCH_SIZE = 500;

export class DrizzleUserRepository implements IUserRepository {
  constructor(private readonly database: Db = db) {}

  async upsertMany(users: UserProps[]): Promise<number> {
    if (users.length === 0) return 0;
    let total = 0;
    for (const batch of chunk(users, UPSERT_BATCH_SIZE)) {
      await this.database
        .insert(basketUsers)
        .values(batch)
        .onConflictDoUpdate({
          target: basketUsers.id,
          set: {
            email: sql`excluded.email`,
            firstname: sql`excluded.firstname`,
            lastname: sql`excluded.lastname`,
            loginAt: sql`excluded.login_at`,
            status: sql`excluded.status`,
            lastStatus: sql`excluded.last_status`,
            promoTeamId: sql`excluded.promo_team_id`,
            promoTeamChangedAt: sql`excluded.promo_team_changed_at`,
            playToken: sql`excluded.play_token`,
            roles: sql`excluded.roles`,
            country: sql`excluded.country`,
            emailVerified: sql`excluded.email_verified`,
            syncedAt: sql`NOW()`,
          },
        });
      total += batch.length;
    }
    return total;
  }

  async findById(id: number): Promise<User | null> {
    const rows = await this.database
      .select()
      .from(basketUsers)
      .where(eq(basketUsers.id, id))
      .limit(1);
    return rows[0] ? User.fromProps(rows[0] as UserProps) : null;
  }

  async count(): Promise<number> {
    const [row] = await this.database
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(basketUsers);
    return row?.value ?? 0;
  }

  async countByCountry(): Promise<Array<{ country: string; count: number }>> {
    const rows = await this.database
      .select({
        country: basketUsers.country,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(basketUsers)
      .groupBy(basketUsers.country);
    return rows.map((r) => ({ country: r.country ?? 'Unknown', count: r.count }));
  }

  async getKnownIds(): Promise<Set<number>> {
    const rows = await this.database.select({ id: basketUsers.id }).from(basketUsers);
    return new Set(rows.map((r) => r.id));
  }
}
