// Reads every Stripe subscription into basket_gateway_subscriptions.
//
//   tsx --env-file=.env scripts/backfill-gateway-subscriptions.ts
//
// The normal sync does this on every run — a subscription's status changes long
// after it is created, so there is no delta to read and a full pass is the only
// correct one. This script exists to do the first pass, and to inspect the
// status mix without waiting for a cron tick.

import { connection } from '@shared/db/client';
import { composeGatewayFeeSync } from '@basket/infrastructure/sync/composeGatewayFeeSync';
import { DrizzleGatewaySubscriptionRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewaySubscriptionRepository';
import { platformName } from '@basket/core/value-objects/Platform';

async function main() {
  const { subscriptionsUseCase, skipped } = composeGatewayFeeSync();
  for (const s of skipped) console.warn(`skipping ${s.slug}: ${s.missing} not set`);
  if (!subscriptionsUseCase) {
    throw new Error('no gateway exposes subscriptions — set STRIPE_SECRET_KEY');
  }

  const repo = new DrizzleGatewaySubscriptionRepository();
  const before = await repo.count();
  console.log(`=== Gateway subscription backfill ===\nrows before: ${before.toLocaleString()}\n`);

  for (const r of await subscriptionsUseCase.execute()) {
    console.log(
      `${r.slug}: fetched=${r.fetched.toLocaleString()} upserted=${r.upserted.toLocaleString()} ` +
        `(${Math.round(r.durationMs / 1000)}s)${r.error ? `  FAILED: ${r.error}` : ''}`,
    );
  }

  console.log(`\nrows after: ${(await repo.count()).toLocaleString()}\n`);
  console.log('status mix:');
  for (const s of await repo.countByStatus()) {
    console.log(`  ${platformName(s.platform).padEnd(12)} ${s.status.padEnd(18)} ${s.count.toLocaleString()}`);
  }
}

main()
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
