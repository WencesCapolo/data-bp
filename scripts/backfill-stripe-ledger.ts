// First load of the three later Stripe mirrors: clientes, disputadas,
// transferencias.
//
//   tsx --env-file=.env scripts/backfill-stripe-ledger.ts --from=2021-01-01
//   tsx --env-file=.env scripts/backfill-stripe-ledger.ts --from=2021-01-01 --only=payouts
//
// The cron does all three on every run (docs/adr/0006), but the two windowed
// ones refuse to guess a start date: with no watermark they fail rather than
// read the last month and leave years empty. This script is how the watermark
// is first set, which is why --from is required unless only customers are run.

import { connection } from '@shared/db/client';
import { composeGatewayFeeSync } from '@basket/infrastructure/sync/composeGatewayFeeSync';
import { DrizzleGatewayCustomerRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayCustomerRepository';
import { DrizzleGatewayDisputeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayDisputeRepository';
import { DrizzleGatewayPayoutRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayPayoutRepository';
import type { GatewayMirrorSyncResult } from '@basket/core/use-cases/sync/SyncGatewayMirrorUseCase';
import { platformName } from '@basket/core/value-objects/Platform';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function report(results: GatewayMirrorSyncResult[]) {
  for (const r of results) {
    console.log(
      `${r.mirror}/${r.slug}: fetched=${r.fetched.toLocaleString()} ` +
        `upserted=${r.upserted.toLocaleString()} windows=${r.windows} ` +
        `(${Math.round(r.durationMs / 1000)}s)${r.error ? `  FAILED: ${r.error}` : ''}`,
    );
  }
}

async function main() {
  const only = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const want = (name: string) => only.length === 0 || only.includes(name);
  const from = arg('from') ? new Date(`${arg('from')}T00:00:00Z`) : undefined;
  const to = arg('to') ? new Date(`${arg('to')}T00:00:00Z`) : new Date();

  const { customersUseCase, disputesUseCase, payoutsUseCase, skipped } = composeGatewayFeeSync();
  for (const s of skipped) console.warn(`skipping ${s.slug}: ${s.missing} not set`);
  if (!customersUseCase && !disputesUseCase && !payoutsUseCase) {
    throw new Error('no gateway exposes these mirrors — set STRIPE_SECRET_KEY');
  }
  if (!from && (want('disputes') || want('payouts'))) {
    throw new Error('--from=YYYY-MM-DD is required for disputes and payouts');
  }

  const customers = new DrizzleGatewayCustomerRepository();
  const disputes = new DrizzleGatewayDisputeRepository();
  const payouts = new DrizzleGatewayPayoutRepository();

  console.log('=== Stripe ledger backfill ===');
  console.log(
    `rows before: customers=${(await customers.count()).toLocaleString()} ` +
      `disputes=${(await disputes.count()).toLocaleString()} ` +
      `payouts=${(await payouts.count()).toLocaleString()}\n`,
  );

  if (want('customers') && customersUseCase) report(await customersUseCase.execute());
  if (want('disputes') && disputesUseCase) {
    report(await disputesUseCase.execute({ from, to }));
  }
  if (want('payouts') && payoutsUseCase) {
    report(await payoutsUseCase.execute({ from, to }));
  }

  console.log(
    `\nrows after: customers=${(await customers.count()).toLocaleString()} ` +
      `disputes=${(await disputes.count()).toLocaleString()} ` +
      `payouts=${(await payouts.count()).toLocaleString()}\n`,
  );

  // The customer mirror's whole purpose is the email bridge, so a row count is
  // not the measure of it — how many rows reach a Subscriber is.
  console.log('customer email coverage:');
  for (const c of await customers.emailCoverage()) {
    const pct = c.customers === 0 ? 0 : (c.matchedSubscribers / c.customers) * 100;
    console.log(
      `  ${platformName(c.platform).padEnd(12)} ${c.customers.toLocaleString()} customers, ` +
        `${c.withEmail.toLocaleString()} with email, ` +
        `${c.matchedSubscribers.toLocaleString()} match a Subscriber (${pct.toFixed(1)}%)`,
    );
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
