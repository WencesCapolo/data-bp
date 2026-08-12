// Reads a tiny window from every configured gateway and prints what came back.
// Writes nothing. Run this before the backfill: it proves the credentials work
// and that the field mapping still holds, at a cost of a handful of requests.
//
//   tsx --env-file=.env scripts/smoke-gateway-fees.ts [--days=2] [--only=stripe]

import { connection } from '@shared/db/client';
import { StripeFeeFetcher } from '@basket/infrastructure/gateways/StripeFeeFetcher';
import { MercadoPagoFeeFetcher } from '@basket/infrastructure/gateways/MercadoPagoFeeFetcher';
import type { IGatewayFeeFetcher } from '@basket/core/ports/IGatewayFeeFetcher';

const SAMPLE_SIZE = 5;

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const days = Number(arg('days') ?? 2);
  const only = (arg('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const want = (slug: string) => only.length === 0 || only.includes(slug);

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  const fetchers: IGatewayFeeFetcher[] = [];
  if (want('stripe') && process.env.STRIPE_SECRET_KEY) {
    fetchers.push(new StripeFeeFetcher({
      secretKey: process.env.STRIPE_SECRET_KEY,
      apiVersion: process.env.STRIPE_API_VERSION,
    }));
  }
  if (want('mercadopago') && process.env.MP_ACCESS_TOKEN) {
    fetchers.push(new MercadoPagoFeeFetcher({ accessToken: process.env.MP_ACCESS_TOKEN }));
  }
  if (fetchers.length === 0) {
    throw new Error('no gateway configured — set STRIPE_SECRET_KEY and/or MP_ACCESS_TOKEN');
  }

  console.log(`window: ${from.toISOString()} → ${to.toISOString()}\n`);

  for (const fetcher of fetchers) {
    let count = 0;
    let fee = 0;
    let gross = 0;
    const sample: string[] = [];

    for await (const r of fetcher.streamFees({ from, to })) {
      count += 1;
      fee += r.feeAmount;
      gross += r.settlementAmount;
      if (sample.length < SAMPLE_SIZE) {
        sample.push(
          `    ${r.platformPaymentId}  gross=${r.grossAmount} ${r.currency}` +
            `  fee=${r.feeAmount} net=${r.netAmount} ${r.settlementCurrency}` +
            `  fx=${r.exchangeRate ?? '-'}  status=${r.gatewayStatus}` +
            `  at=${r.capturedAt?.toISOString().slice(0, 19) ?? '-'}`,
        );
      }
    }

    const ratio = gross === 0 ? '-' : `${((fee / gross) * 100).toFixed(2)}%`;
    console.log(`${fetcher.slug}: ${count} transactions, fee/gross = ${ratio}`);
    // A ratio outside roughly 2-10% is the signal that a field moved or that
    // minor units are being divided by the wrong power of ten.
    for (const line of sample) console.log(line);
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('smoke failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
