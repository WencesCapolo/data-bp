// Pulls per-transaction commission, net and settlement FX from the Stripe and
// MercadoPago APIs into basket_payment_fees.
//
//   tsx --env-file=.env scripts/backfill-gateway-fees.ts [options]
//
//   --from=YYYY-MM-DD   floor; default = first Pago in basket_payments
//   --to=YYYY-MM-DD     ceiling, exclusive; default = now
//   --only=stripe       repeat or comma-separate to restrict gateways
//   --window-days=7     slice size handed to each fetcher
//
// Re-runnable: rows are upserted by (platform, platform_payment_id), so a run
// that dies mid-window can simply be repeated. Only a clean run advances the
// `fees:<slug>` watermark that later incremental syncs resume from.

import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { composeGatewayFeeSync } from '@basket/infrastructure/sync/composeGatewayFeeSync';
import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { platformName } from '@basket/core/value-objects/Platform';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`--${label} is not a date: ${value}`);
  return date;
}

async function firstPaymentDate(): Promise<Date> {
  const rows = await db.execute<{ d: Date | string | null }>(
    sql`SELECT MIN(created_at) AS d FROM basket_payments`,
  );
  const d = rows[0]?.d;
  if (!d) throw new Error('basket_payments is empty — nothing to reconcile fees against');
  return new Date(d as string);
}

async function main() {
  const only = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const windowDays = Number(arg('window-days') ?? 7);
  const to = parseDate(arg('to'), 'to') ?? new Date();
  const from = parseDate(arg('from'), 'from') ?? await firstPaymentDate();

  const { useCase, slugs, skipped } = composeGatewayFeeSync({ only });

  for (const s of skipped) {
    console.warn(`skipping ${s.slug}: ${s.missing} not set`);
  }
  if (slugs.length === 0) {
    throw new Error('no gateway configured — set STRIPE_SECRET_KEY and/or MP_ACCESS_TOKEN');
  }

  console.log(`=== Gateway fee backfill ===`);
  console.log(`gateways: ${slugs.join(', ')}`);
  console.log(`range:    ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
  console.log(`windows:  ${windowDays}d\n`);

  const fees = new DrizzleGatewayFeeRepository();
  const before = await fees.count();

  const results = await useCase.execute({
    from,
    to,
    windowDays,
    onProgress: ({ slug, window, fetched, upserted }) => {
      console.log(
        `[${slug}] ${window.from.toISOString().slice(0, 10)}` +
          `→${window.to.toISOString().slice(0, 10)}  +${fetched} fetched, ${upserted} written so far`,
      );
    },
  });

  console.log('');
  for (const r of results) {
    const secs = Math.round(r.durationMs / 1000);
    console.log(
      `${r.slug}: fetched=${r.fetched.toLocaleString()} upserted=${r.upserted.toLocaleString()} ` +
        `windows=${r.windows} (${secs}s)${r.error ? `  FAILED: ${r.error}` : ''}`,
    );
  }

  const after = await fees.count();
  console.log(`\nfee rows: ${before.toLocaleString()} → ${after.toLocaleString()} (+${(after - before).toLocaleString()})`);

  // The number that actually matters: how much of the Pagos mirror can now be
  // reported net of commission. Anything materially short of 100% on Stripe or
  // MercadoPago means windows are missing, not that the gateway has no fees.
  console.log('\ncoverage of successful Pagos carrying a gateway id:');
  for (const c of await fees.coverage()) {
    const pct = c.joinablePayments === 0 ? 0 : (c.withFee / c.joinablePayments) * 100;
    console.log(
      `  ${platformName(c.platform).padEnd(12)} ${c.withFee.toLocaleString()}/${c.joinablePayments.toLocaleString()}` +
        `  ${pct.toFixed(1)}%`,
    );
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
