import { sql } from 'drizzle-orm';
import { db } from '@shared/db/client';
import {
  basketPayments,
  basketSyncState,
  basketTeams,
  basketUsers,
} from '@basket/infrastructure/db/schema';

export const dynamic = 'force-dynamic';

async function getStats() {
  const [u] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketUsers);
  const [p] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketPayments);
  const [t] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketTeams);
  const [active] = await db
    .select({ v: sql<number>`COUNT(DISTINCT ${basketPayments.userId})::int` })
    .from(basketPayments)
    .where(
      sql`${basketPayments.status} = 1 AND (${basketPayments.expiresAt} + INTERVAL '7 days') >= NOW()`,
    );
  const syncStates = await db.select().from(basketSyncState);
  return { users: u.v, payments: p.v, teams: t.v, active: active.v, syncStates };
}

export default async function BasketPage() {
  let stats;
  try {
    stats = await getStats();
  } catch (err) {
    return (
      <main style={{ padding: 32 }}>
        <h1>Basket Analytics — Phase 1</h1>
        <p>Database not reachable. Run:</p>
        <pre>podman compose up -d postgres</pre>
        <pre>pnpm db:push</pre>
        <pre>pnpm sync:initial</pre>
        <p style={{ color: 'crimson' }}>Error: {(err as Error).message}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui' }}>
      <h1>Basket Analytics — Phase 1 (Infrastructure)</h1>
      <section style={{ marginTop: 24 }}>
        <h2>Database counts</h2>
        <ul>
          <li>Teams: {stats.teams.toLocaleString()}</li>
          <li>Users: {stats.users.toLocaleString()}</li>
          <li>Payments: {stats.payments.toLocaleString()}</li>
          <li>Currently active subscriptions: {stats.active.toLocaleString()}</li>
        </ul>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Sync state</h2>
        {stats.syncStates.length === 0 ? (
          <p>No sync yet.</p>
        ) : (
          <ul>
            {stats.syncStates.map((s) => (
              <li key={s.source}>
                <strong>{s.source}</strong>: {s.lastSync.toISOString()} ({s.rowCount ?? '—'} rows)
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
