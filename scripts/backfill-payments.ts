import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { basketPayments } from '@basket/infrastructure/db/schema';

const WINDOW = process.argv[2] ?? '-2years';

async function main() {
  console.log(`=== Payments backfill (window=${WINDOW}) ===\n`);

  process.env.SYNC_PAYMENTS_WINDOW = WINDOW;
  process.env.SYNC_PAYMENTS_ENABLED = 'true';

  const beforeRow = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM basket_payments`);
  const beforeCount = beforeRow[0]?.c ?? 0;
  console.log(`before: payments=${beforeCount}`);

  const t = Date.now();
  const useCase = await composeRunSync();
  const result = await useCase.execute();
  const ms = Date.now() - t;

  const afterRow = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM basket_payments`);
  const afterCount = afterRow[0]?.c ?? 0;
  console.log(`\nafter: payments=${afterCount}`);
  console.log(`delta: +${afterCount - beforeCount}`);
  console.log(`syncedPayments (stream count): ${result.syncedPayments}`);
  console.log(`elapsed: ${ms}ms (${Math.round(ms / 1000)}s)`);

  // Quick coverage check
  const range = await db.execute<{ min_day: string; max_day: string }>(sql`
    SELECT MIN(created_at)::date::text AS min_day, MAX(created_at)::date::text AS max_day
    FROM ${basketPayments}
  `);
  console.log(`\ncoverage: ${range[0]?.min_day} → ${range[0]?.max_day}`);
}

main()
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
