// First load of basket_fx_rates: the whole blue history, plus the Stripe rates
// derived from the fee mirror.
//
//   pnpm backfill:fx                     # everything dolarapi has, 2011 → today
//   pnpm backfill:fx --since=2024-01-01  # only what the Pagos actually need
//   pnpm backfill:fx --only=stripe       # re-derive the Stripe rows alone
//
// Safe to re-run: every row is an upsert on (day, pair, source). The cron does
// the same work incrementally (RunSyncUseCase step 8c), so this script exists
// for the first load and for re-deriving after a bulk fee ingest.

import { connection } from '@shared/db/client';
import { composeFxRateSync } from '@basket/infrastructure/sync/composeGatewayFeeSync';
import { DrizzleFxRateRepository } from '@basket/infrastructure/db/repositories/DrizzleFxRateRepository';
import { BLUE_SOURCE } from '@basket/infrastructure/fx/DolarApiBlueFetcher';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const since = arg('since');
  const only = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const wantBlue = only.length === 0 || only.includes('blue');
  const wantStripe = only.length === 0 || only.includes('stripe');

  const repo = new DrizzleFxRateRepository();
  console.log('=== FX rate backfill ===');
  console.log(`rows before: ${(await repo.count()).toLocaleString()}\n`);

  const results = await composeFxRateSync().execute({
    // `--only=stripe` still has to pass a since, so pass one that fetches
    // nothing rather than adding a flag the use case would have to interpret.
    since: wantBlue ? since : '9999-01-01',
    deriveStripe: wantStripe,
  });

  for (const r of results) {
    console.log(
      `${r.source.padEnd(7)} ${r.pair.padEnd(34)} ` +
        `fetched=${r.fetched.toLocaleString()} upserted=${r.upserted.toLocaleString()} ` +
        `since=${r.since ?? 'all'} (${(r.durationMs / 1000).toFixed(1)}s)` +
        `${r.error ? `  FAILED: ${r.error}` : ''}`,
    );
  }

  console.log(`\nrows after: ${(await repo.count()).toLocaleString()}\n`);
  console.log('coverage:');
  for (const c of await repo.coverage()) {
    console.log(
      `  ${c.source.padEnd(7)} ${`${c.baseCurrency}→${c.quoteCurrency}`.padEnd(10)} ` +
        `${c.days.toLocaleString().padStart(6)} days  ${c.firstDay} → ${c.lastDay}`,
    );
  }

  // The blue history carries every calendar day, weekends included at the
  // previous close, so a gap is a broken feed and not a closed market. Reported
  // for the span the Pagos actually cover — the 2011 tail is nobody's problem.
  const gaps = await repo.gaps(BLUE_SOURCE, 'USD', 'ARS', '2024-05-01', new Date().toISOString().slice(0, 10));
  console.log(
    `\nblue USD→ARS gaps since 2024-05-01: ${gaps.length}` +
      (gaps.length ? ` — ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? ' …' : ''}` : ''),
  );
  if (gaps.length) {
    console.log('  a gap is a broken feed, not a holiday: every calendar day should be present.');
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
