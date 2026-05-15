import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { streamCsvFile } from '@shared/lib/csvStream';
import { DrizzleTeamRepository } from '@basket/infrastructure/db/repositories/DrizzleTeamRepository';
import { DrizzleUserRepository } from '@basket/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { extractTeamsFromHtml } from '@basket/infrastructure/sync/extractTeamsFromHtml';
import {
  mapPaymentRow,
  mapUserRow,
  type PaymentCsvRow,
  type UserCsvRow,
} from '@basket/infrastructure/sync/csvMappers';
import { LoadUsersFromCsvUseCase } from '@basket/core/use-cases/sync/LoadUsersFromCsvUseCase';
import { LoadPaymentsFromCsvUseCase } from '@basket/core/use-cases/sync/LoadPaymentsFromCsvUseCase';
import { basketPayments, basketUsers } from '@basket/infrastructure/db/schema';

const DATA_DIR = resolve(process.cwd(), 'data');
const HTML_PATH = resolve(DATA_DIR, 'basket_dashboard_29.html');
const USERS_CSV = resolve(DATA_DIR, 'users.csv');
const PAYMENTS_CSV = resolve(DATA_DIR, 'payments(1).csv');

function logProgress(label: string): (n: number) => void {
  return (n) => process.stdout.write(`\r  ${label}: ${n.toLocaleString()}...`);
}

async function loadTeams(repo: DrizzleTeamRepository): Promise<Set<number>> {
  console.log('→ Teams (extract from HTML)');
  const teams = extractTeamsFromHtml(HTML_PATH);
  const inserted = await repo.upsertMany(teams);
  console.log(`  ✓ ${inserted.toLocaleString()} teams`);
  return new Set(teams.map((t) => t.id));
}

async function loadUsers(
  repo: DrizzleUserRepository,
  knownTeamIds: Set<number>,
): Promise<Set<number>> {
  console.log('→ Users (CSV stream)');
  const userIds = new Set<number>();

  async function* mappedStream() {
    for await (const row of streamCsvFile<UserCsvRow>(USERS_CSV)) {
      const mapped = mapUserRow(row, knownTeamIds);
      if (mapped) {
        userIds.add(mapped.id);
        yield mapped;
      }
    }
  }

  const useCase = new LoadUsersFromCsvUseCase(repo);
  const result = await useCase.execute({
    rows: mappedStream(),
    onProgress: logProgress('users'),
  });
  console.log(`\n  ✓ ${result.inserted.toLocaleString()} users`);
  return userIds;
}

async function loadPayments(
  repo: DrizzlePaymentRepository,
  knownUserIds: Set<number>,
): Promise<number> {
  console.log('→ Payments (CSV stream)');

  async function* mappedStream() {
    for await (const row of streamCsvFile<PaymentCsvRow>(PAYMENTS_CSV)) {
      const mapped = mapPaymentRow(row, knownUserIds);
      if (mapped) yield mapped;
    }
  }

  const useCase = new LoadPaymentsFromCsvUseCase(repo);
  const result = await useCase.execute({
    rows: mappedStream(),
    onProgress: logProgress('payments'),
  });
  console.log(`\n  ✓ ${result.inserted.toLocaleString()} payments`);
  return result.inserted;
}

async function verify() {
  console.log('\n→ Verification');
  const [u] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketUsers);
  const [p] = await db.select({ v: sql<number>`COUNT(*)::int` }).from(basketPayments);
  const [active] = await db
    .select({ v: sql<number>`COUNT(*)::int` })
    .from(basketPayments)
    .where(sql`${basketPayments.status} = 1`);
  const [activeUsers] = await db
    .select({ v: sql<number>`COUNT(DISTINCT ${basketPayments.userId})::int` })
    .from(basketPayments)
    .where(
      sql`${basketPayments.status} = 1 AND (${basketPayments.expiresAt} + INTERVAL '7 days') >= NOW()`,
    );
  console.log(`  users:               ${u.v.toLocaleString()}`);
  console.log(`  payments:            ${p.v.toLocaleString()}`);
  console.log(`  status=1 payments:   ${active.v.toLocaleString()} (expected ≈ 26,057)`);
  console.log(`  currently active:    ${activeUsers.v.toLocaleString()} (dashboard shows 27,658)`);
}

async function main() {
  const startedAt = Date.now();
  console.log('=== Basket Analytics — Initial Load ===\n');

  const teams = new DrizzleTeamRepository();
  const users = new DrizzleUserRepository();
  const payments = new DrizzlePaymentRepository();
  const syncState = new DrizzleSyncStateRepository();

  const knownTeamIds = await loadTeams(teams);
  const knownUserIds = await loadUsers(users, knownTeamIds);
  await loadPayments(payments, knownUserIds);

  const now = new Date();
  await syncState.updateLastSync('teams', now, knownTeamIds.size);
  await syncState.updateLastSync('users', now, knownUserIds.size);
  await syncState.updateLastSync('payments', now);

  await verify();
  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error('\n✗ Initial load failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
