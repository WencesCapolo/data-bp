// Re-reads Stripe's ledger so basket_v_cashflow_stripe_by_market (migration
// 0030) has a market for every month since --from: the fee mirror learns each
// charge's card country, and each movement learns the Pago it belongs to.
//
//   tsx --env-file=.env scripts/backfill-stripe-card-country.ts --from=2025-09-01
//
//   tsx --env-file=.env scripts/backfill-stripe-card-country.ts --from=2025-09-01 --only=fees
//
// Re-runnable: both mirrors upsert by their Stripe key. --only=fees or
// --only=payout-ledger runs one pass.

import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { composeGatewayFeeSync } from '@basket/infrastructure/sync/composeGatewayFeeSync';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const fromArg = arg('from');
  if (!fromArg) throw new Error('--from=YYYY-MM-DD is required');
  const from = new Date(`${fromArg}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) throw new Error(`--from is not a date: ${fromArg}`);
  const to = new Date();
  const only = arg('only');
  const want = (pass: string) => !only || only === pass;

  const { useCase, payoutLedgerUseCase, skipped } = composeGatewayFeeSync({ only: ['stripe'] });
  if (skipped.length > 0 || !payoutLedgerUseCase) throw new Error('STRIPE_SECRET_KEY not set');

  console.log(`=== Stripe card country backfill, ${fromArg} → ${to.toISOString().slice(0, 10)} ===`);

  const results = [
    ...(want('fees') ? await useCase.execute({ from, to, windowDays: 7 }) : [])
      .map((r) => ({ name: `fees/${r.slug}`, ...r })),
    ...(want('payout-ledger') ? await payoutLedgerUseCase.execute({ from, to }) : [])
      .map((r) => ({ name: `${r.mirror}/${r.slug}`, ...r })),
  ];
  for (const r of results) {
    console.log(
      `${r.name}: fetched=${r.fetched.toLocaleString()} upserted=${r.upserted.toLocaleString()}` +
        `${r.error ? `  FAILED: ${r.error}` : ''}`,
    );
  }

  // A charge with no country lands in Internacional; this shows how many did.
  const rows = await db.execute(sql`
    SELECT to_char(m.available_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
           COUNT(*)::int                AS charges,
           COUNT(f.card_country)::int   AS with_country
    FROM basket_gateway_movements m
    LEFT JOIN basket_payment_fees f
      ON f.platform = m.platform AND f.platform_payment_id = m.platform_payment_id
    WHERE m.platform = 4 AND m.type IN ('charge', 'payment') AND m.available_at >= ${from.toISOString()}
    GROUP BY 1 ORDER BY 1
  `);
  console.log('\ncharges with a country, by month released:');
  for (const r of rows as unknown as { month: string; charges: number; with_country: number }[]) {
    console.log(`  ${r.month}  ${r.with_country}/${r.charges}`);
  }

  if (results.some((r) => r.error)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
