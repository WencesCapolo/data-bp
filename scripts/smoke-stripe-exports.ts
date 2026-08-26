// Reproduces all five Stripe Exports' row counts for one Window from the API
// alone, then compares each against what the mirrors hold, and asks the two
// questions the new tables exist to answer.
//
//   tsx --env-file=.env scripts/smoke-stripe-exports.ts [--from=2026-07-01] [--to=2026-08-01]
//
// Nothing is written. This is the check that phase 1 landed: if every Export's
// API count matches its mirror count for the same Window, the CSV is out of the
// loop for good.
//
// The five Exports, and what each is counted from:
//
//   pagos                   balance transactions whose source is a charge
//   clientes                customers created in the Window
//   suscripciones           subscriptions created in the Window
//   devueltas/disputadas    refunds + disputes created in the Window
//   transferencias          payouts created in the Window
//
// A caveat the numbers cannot state themselves: the Export is a report over
// *creation*, so `clientes` and `suscripciones` counted this way are the slice
// of two full mirrors, not the mirrors themselves. A mismatch there means the
// full refresh has not run since the Window, not that rows were lost.

import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { getJson } from '@basket/infrastructure/gateways/httpJson';
import { DrizzleGatewayDisputeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayDisputeRepository';
import { DrizzleGatewayPayoutRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayPayoutRepository';

const STRIPE_PLATFORM = 4;
const PAGE_SIZE = 100;

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

interface Page<T> { data: T[]; has_more: boolean }

/**
 * Counts a list endpoint by paging it.
 *
 * Stripe has no count endpoint, and the alternative — trusting `has_more` after
 * one page — cannot tell 101 rows from 40,000. `filter` exists because the
 * balance-transaction ledger carries payouts and refunds alongside charges, and
 * only the charge rows are the pagos Export.
 */
async function countAll<T extends { id: string }>(
  path: string,
  params: Record<string, string>,
  headers: Record<string, string>,
  filter: (row: T) => boolean = () => true,
): Promise<number> {
  let startingAfter: string | null = null;
  let total = 0;

  for (;;) {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const page = await getJson<Page<T>>(url.toString(), { headers });
    total += page.data.filter(filter).length;
    if (!page.has_more || page.data.length === 0) return total;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

async function mirrorCount(table: string, column: string, from: Date, to: Date): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM ${sql.raw(table)}
    WHERE platform = ${STRIPE_PLATFORM}
      AND ${sql.raw(column)} >= ${from.toISOString()}::timestamptz
      AND ${sql.raw(column)} <  ${to.toISOString()}::timestamptz
  `);
  return Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SERVICE_KEY;
  if (!key) throw new Error('set STRIPE_SECRET_KEY (or STRIPE_SERVICE_KEY)');

  const to = arg('to') ? new Date(`${arg('to')}T00:00:00Z`) : new Date();
  const from = arg('from')
    ? new Date(`${arg('from')}T00:00:00Z`)
    : new Date(to.getTime() - 30 * 86_400_000);

  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (process.env.STRIPE_API_VERSION) headers['stripe-version'] = process.env.STRIPE_API_VERSION;
  const created = { 'created[gte]': String(unix(from)), 'created[lt]': String(unix(to)) };

  console.log(`window: ${from.toISOString()} → ${to.toISOString()}\n`);

  // --- The five Exports, from the API alone ------------------------------
  const pagos = await countAll<{ id: string; source: { object: string } | string | null }>(
    'balance_transactions',
    { ...created, 'expand[]': 'data.source' },
    headers,
    (bt) => typeof bt.source === 'object' && bt.source?.object === 'charge',
  );
  const clientes = await countAll('customers', created, headers);
  const suscripciones = await countAll('subscriptions', { ...created, status: 'all' }, headers);
  const refunds = await countAll('refunds', created, headers);
  const disputes = await countAll('disputes', created, headers);
  const transferencias = await countAll('payouts', created, headers);

  // --- The same five, from the mirrors -----------------------------------
  // captured_at for fees: it is the charge date, which is what the pagos Export
  // is dated by. The ledger row's own date can fall a day later.
  const mirrors = {
    pagos: await mirrorCount('basket_payment_fees', 'captured_at', from, to),
    clientes: await mirrorCount('basket_gateway_customers', 'created_at', from, to),
    suscripciones: await mirrorCount('basket_gateway_subscriptions', 'created_at', from, to),
    disputadas: await mirrorCount('basket_gateway_disputes', 'created_at', from, to),
    transferencias: await mirrorCount('basket_gateway_payouts', 'created_at', from, to),
  };

  const rows: [string, number, number, string][] = [
    ['pagos', pagos, mirrors.pagos, ''],
    ['clientes', clientes, mirrors.clientes, ''],
    ['suscripciones', suscripciones, mirrors.suscripciones, ''],
    // Refunds are deliberately not mirrored as rows: they live on the charge as
    // refunded_amount, so only the dispute half of this Export has a table.
    ['disputadas', disputes, mirrors.disputadas, `+ ${refunds} refunds (on the charge)`],
    ['transferencias', transferencias, mirrors.transferencias, ''],
  ];

  let failed = 0;
  console.log('export           API      mirror   ');
  for (const [label, api, mirror, note] of rows) {
    const ok = api === mirror;
    if (!ok) failed += 1;
    console.log(
      `${label.padEnd(16)} ${String(api).padStart(7)}  ${String(mirror).padStart(7)}  ` +
        `${ok ? 'ok' : 'MISMATCH'}  ${note}`,
    );
  }

  // --- The two questions the new tables exist to answer -------------------
  const reversed = await new DrizzleGatewayDisputeRepository().reversedCharges(from, to);
  console.log(`\nwhich charges were reversed: ${reversed.length}`);
  for (const r of reversed.slice(0, 5)) {
    console.log(
      `  ${r.platformPaymentId}  ${r.amount} ${r.currency}  ${r.status}` +
        `  ${r.reason ?? '-'}  gross=${r.grossAmount ?? 'not ingested'}`,
    );
  }

  const arrivals = await new DrizzleGatewayPayoutRepository().arrivals(from, to);
  console.log(`\nwhat hit the bank: ${arrivals.length} arrival days`);
  for (const a of arrivals.slice(0, 10)) {
    console.log(
      `  ${a.arrivalDate?.toISOString().slice(0, 10) ?? '-'}  ` +
        `${a.amount.toLocaleString()} ${a.currency}  ${a.status}  (${a.payouts} payouts)`,
    );
  }

  console.log(`\n${failed === 0 ? 'ALL FIVE EXPORTS REPRODUCED' : `${failed} export(s) MISMATCHED`}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('smoke failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
