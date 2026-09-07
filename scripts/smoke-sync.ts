import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { streamCsvFile } from '@shared/lib/csvStream';
import type { ICsvFetcher, CsvFetchOptions, CsvRow } from '@basket/core/ports/ICsvFetcher';
import { DrizzleUserRepository } from '@basket/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DrizzleTeamRepository } from '@basket/infrastructure/db/repositories/DrizzleTeamRepository';
import { DrizzleTournamentRepository } from '@basket/infrastructure/db/repositories/DrizzleTournamentRepository';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import {
  mapUserRow,
  mapTournamentRow,
  mapTeamLiveRow,
  type UserCsvRow,
  type TournamentCsvRow,
  type TeamLiveCsvRow,
} from '@basket/infrastructure/sync/csvMappers';
import { RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';
import { buildSyncSteps } from '@basket/core/use-cases/sync/buildSyncSteps';
import { basketPayments, basketUsers } from '@basket/infrastructure/db/schema';

const DATA_DIR = resolve(process.cwd(), 'data');

class LocalFileCsvFetcher implements ICsvFetcher {
  constructor(private readonly map: Record<string, string>) {}
  async *streamRows<T extends CsvRow>(resource: string, _options: CsvFetchOptions = {}): AsyncGenerator<T, void, unknown> {
    const path = this.map[resource];
    if (!path) throw new Error(`No local file mapped for "${resource}"`);
    for await (const row of streamCsvFile<T>(path)) {
      yield row;
    }
  }
}

async function counts() {
  const [u] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketUsers);
  const [p] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketPayments);
  return { users: u.v, payments: p.v };
}

async function main() {
  console.log('=== Sync Smoke (idempotency) ===\n');

  const users = new DrizzleUserRepository();
  const payments = new DrizzlePaymentRepository();
  const teams = new DrizzleTeamRepository();
  const tournaments = new DrizzleTournamentRepository();
  const syncState = new DrizzleSyncStateRepository();
  const matViews = new DrizzleMaterializedViewRepository();

  const fetcher = new LocalFileCsvFetcher({
    users: resolve(DATA_DIR, 'users.csv'),
    payments: resolve(DATA_DIR, 'payments(1).csv'),
    teams: resolve(DATA_DIR, 'teams.csv'),
    tournaments: resolve(DATA_DIR, 'tournaments.csv'),
  });

  // Masters only, then the refresh: no Pagos (the live endpoint is dead), no
  // content, no Sheets, no Providers.
  const useCase = new RunSyncUseCase(
    buildSyncSteps({
      fetcher,
      syncState,
      matViews,
      tournaments: { repo: tournaments, resource: 'tournaments', mapRow: (row) => mapTournamentRow(row as unknown as TournamentCsvRow) },
      teams: { repo: teams, resource: 'teams', mapRow: (row) => mapTeamLiveRow(row as unknown as TeamLiveCsvRow) },
      users: { repo: users, resource: 'users', mapRow: (row, t) => mapUserRow(row as unknown as UserCsvRow, t) },
      payments: { repo: payments, source: null },
    }),
  );
  console.log(`steps: ${useCase.stepNames.join(' → ')}`);

  const before = await counts();
  console.log(`before: users=${before.users.toLocaleString()} payments=${before.payments.toLocaleString()}`);

  console.log('\n→ Run #1');
  const r1 = await useCase.execute();
  console.log(`  syncedUsers=${r1.syncedUsers}, syncedPayments=${r1.syncedPayments}, durationMs=${r1.durationMs}`);
  r1.refreshes.forEach((rf) => console.log(`    ${rf.view.padEnd(35)} ${rf.durationMs}ms rows=${rf.rowCount}`));

  const mid = await counts();
  console.log(`mid:    users=${mid.users.toLocaleString()} payments=${mid.payments.toLocaleString()}`);

  console.log('\n→ Run #2 (should be idempotent — counts equal)');
  const r2 = await useCase.execute();
  console.log(`  syncedUsers=${r2.syncedUsers}, syncedPayments=${r2.syncedPayments}, durationMs=${r2.durationMs}`);

  const after = await counts();
  console.log(`after:  users=${after.users.toLocaleString()} payments=${after.payments.toLocaleString()}`);

  const stable = mid.users === after.users && mid.payments === after.payments;
  console.log(`\n${stable ? '✓' : '✗'} Idempotency ${stable ? 'OK' : 'FAILED'}`);
  if (!stable) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\n✗ Smoke sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
