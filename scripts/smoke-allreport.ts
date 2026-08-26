// The all-transactions adapter, against a fixture that reproduces every trap the
// first real ALLReport file carried. Writes nothing and needs no database:
//
//   pnpm smoke:allreport
//
// The fixture is inline on purpose. The real file lives outside the repo (`data/`
// is gitignored and it holds a Provider's ledger), so a smoke that depended on it
// would pass on one laptop and skip everywhere else. What it reproduces:
//
//   - JSON with UNDOUBLED inner quotes in METADATA and TAXES_DISAGGREGATED, which
//     is what makes the file invalid CSV and shifts every column after it
//   - one operation with three movements: a settlement, a partial refund, and a
//     chargeback, so the fold has something to fold
//   - a second operation that is a lone settlement, dated earliest, so ordering
//     cannot be what makes the fold look right
//   - a chargeback that was later CANCELLED (the dispute we won), which arrives
//     with a POSITIVE amount and is not a second charge
//   - a cancel whose chargeback fell outside the window, which is a re-statement
//     of the charge and nothing else
//   - a movement with no SOURCE_ID, which can never join a Pago
//   - fee and taxes quoted negative on charges and positive on reversals

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MercadoPagoAllTransactionsExport } from '@basket/infrastructure/exports/MercadoPagoAllTransactionsExport';
import type { PaymentExportRow } from '@basket/core/ports/IPaymentExportSource';

const HEADER =
  'TRANSACTION_DATE,SETTLEMENT_DATE,EXTERNAL_REFERENCE,SOURCE_ID,TRANSACTION_TYPE,' +
  'TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,SETTLEMENT_CURRENCY,' +
  'METADATA,TAXES_AMOUNT,TAX_DETAIL,TAXES_DISAGGREGATED,PAYER_NAME';

const META_SUB =
  '"[{"available_tries":3,"preapproval_id":"58ab149f8233488886652475d6490649","user_type":"registered"}]"';
const META_NONE = '"[{}]"';
const TAXES =
  '"[{"financial_entity":"caba","amount":"-324.98","detail":"tax_withholding"}, ' +
  '{"financial_entity":"debitos_creditos","amount":"-77.99","detail":"tax_withholding_collector"}]"';

const ROWS = [
  // 175503622092 — settlement, then a 3.000 refund, then a chargeback of the rest
  `2026-08-20T10:00:00.000-04:00,2026-08-20T10:00:02.000-04:00,"ref-a",175503622092,SETTLEMENT,12999.00,ARS,-833.63,11762.40,ARS,${META_SUB},-402.97,iibb_caba,${TAXES},`,
  `2026-08-21T11:00:00.000-04:00,2026-08-21T11:00:02.000-04:00,"ref-a",175503622092,REFUND,-3000.00,ARS,192.45,-2807.55,ARS,${META_SUB},0.00,iibb_caba,${TAXES},`,
  `2026-08-22T12:00:00.000-04:00,2026-08-22T12:00:02.000-04:00,"ref-a",175503622092,CHARGEBACK,-9999.00,ARS,641.18,-9357.82,ARS,${META_SUB},0.00,iibb_caba,${TAXES},`,
  // 173278272715 — a lone settlement, earliest date in the file, no subscription
  `2026-08-16T09:00:00.000-04:00,2026-08-16T09:00:02.000-04:00,"ref-b",173278272715,SETTLEMENT,16999.00,ARS,-1090.15,14531.93,ARS,${META_NONE},-1376.92,iibb_santa_fe,${TAXES},`,
  // 151739780380 — settlement, chargeback, then CHARGEBACK_CANCEL: we won it
  `2026-03-24T15:08:18.000-04:00,2026-03-24T15:08:20.000-04:00,"ref-c",151739780380,SETTLEMENT,16999.00,ARS,-1293.62,15178.41,ARS,${META_NONE},-526.97,iibb_caba,${TAXES},`,
  `2026-03-24T15:08:18.000-04:00,2026-05-25T09:25:06.000-04:00,"ref-c",151739780380,CHARGEBACK,-16999.00,ARS,1293.62,-15178.41,ARS,${META_NONE},526.97,iibb_caba,${TAXES},`,
  `2026-03-24T15:08:18.000-04:00,2026-06-13T17:50:28.000-04:00,"ref-c",151739780380,CHARGEBACK_CANCEL,16999.00,ARS,-1293.62,15178.41,ARS,${META_NONE},-526.97,iibb_caba,${TAXES},`,
  // 999888777666 — the cancel alone: its chargeback fell outside this window
  `2026-02-10T08:00:00.000-04:00,2026-06-13T17:50:28.000-04:00,"ref-d",999888777666,CHARGEBACK_CANCEL,12999.00,ARS,-833.63,11762.40,ARS,${META_NONE},-402.97,iibb_caba,${TAXES},`,
  // no id at all
  `2026-08-23T09:00:00.000-04:00,,"ref-c",,SETTLEMENT,500.00,ARS,-30.00,470.00,ARS,${META_NONE},0.00,,${TAXES},`,
];

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${detail}`);
}
const round2 = (v: number) => Math.round(v * 100) / 100;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'allreport-'));
  const path = join(dir, 'ALLReport-fixture.csv');
  writeFileSync(path, `${HEADER}\n${ROWS.join('\n')}\n`);

  const rows: PaymentExportRow[] = [];
  for await (const row of new MercadoPagoAllTransactionsExport(path).stream()) rows.push(row);
  const byId = new Map(rows.map((r) => [r.platformPaymentId, r]));

  console.log('\n=== the fold ===\n');
  check('nine movements become four operations', rows.length === 4, `${rows.length} rows`);
  check('the movement without an id is dropped', !byId.has(''), 'no empty-id row');

  const folded = byId.get('175503622092');
  check('the folded operation exists', !!folded);
  if (!folded) return;

  check(
    'gross counts charges only',
    folded.grossAmount === 12999,
    `${folded.grossAmount}`,
  );
  check(
    'both reversals are summed into refunded',
    folded.refundedAmount === 12999,
    `3.000 refund + 9.999 chargeback = ${folded.refundedAmount}`,
  );
  check(
    'the fee is what was charged, net of what came back',
    folded.feeAmount === 0,
    `833.63 − 192.45 − 641.18 = ${folded.feeAmount}`,
  );
  check(
    'the withholding is the stated figure, not a residual',
    folded.taxAmount === 402.97,
    `${folded.taxAmount} (TAXES_AMOUNT, sign flipped)`,
  );
  check(
    'a chargeback outranks a refund in the status',
    folded.status === 'charged_back',
    `${folded.status}`,
  );
  check(
    'the earliest movement dates the operation',
    folded.capturedAt?.toISOString() === new Date('2026-08-20T10:00:00.000-04:00').toISOString(),
    `${folded.capturedAt?.toISOString()}`,
  );
  check(
    'the subscription id survives the broken JSON',
    folded.subscriptionId === '58ab149f8233488886652475d6490649',
    `${folded.subscriptionId}`,
  );
  check(
    'a preapproval makes it a recurring payment',
    folded.operationType === 'recurring_payment',
    `${folded.operationType}`,
  );

  const won = byId.get('151739780380');
  check(
    'a cancelled chargeback is not a second charge',
    won?.grossAmount === 16999,
    `gross ${won?.grossAmount}`,
  );
  check(
    'and it leaves nothing refunded',
    won?.refundedAmount === 0 && won?.status === 'approved',
    `refunded ${won?.refundedAmount} · ${won?.status}`,
  );
  const orphanCancel = byId.get('999888777666');
  check(
    'a cancel whose chargeback is out of window re-states the charge',
    orphanCancel?.grossAmount === 12999 && orphanCancel?.refundedAmount === 0,
    `gross ${orphanCancel?.grossAmount} · refunded ${orphanCancel?.refundedAmount}`,
  );

  const lone = byId.get('173278272715');
  check('an operation with no subscription says so', lone?.subscriptionId === null && lone?.operationType === 'regular_payment', `${lone?.operationType}`);
  check('its withholding is read from its own row', lone?.taxAmount === 1376.92, `${lone?.taxAmount}`);

  console.log('\n=== the invariant, per operation and in total ===\n');
  for (const r of rows) {
    const closes = round2(r.grossAmount - r.refundedAmount - r.feeAmount - (r.taxAmount ?? 0) - r.netAmount);
    check(`gross − refunds − fee − tax = net · ${r.platformPaymentId}`, Math.abs(closes) < 0.01, `off by ${closes}`);
  }

  await mergeGuard();

  console.log(
    failures === 0
      ? '\n✓ all checks passed\n'
      : `\n✗ ${failures} check(s) failed\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

/**
 * The merge guard, against the database.
 *
 * A report window almost never holds both a charge and its reversal — a
 * chargeback lands weeks after the payment, so a daily report is mostly
 * reversals of charges it cannot see. Such a window folds to gross 0 and a
 * negative fee, and writing that over the row that holds the charge would report
 * MercadoPago as having earned nothing on that Pago. Skipped when there is no
 * DATABASE_URL, so the fold checks above still run anywhere.
 */
async function mergeGuard() {
  if (!process.env.DATABASE_URL) {
    console.log('\n=== the merge guard ===\n\n  · skipped: no DATABASE_URL\n');
    return;
  }
  const { DrizzleGatewayFeeRepository } = await import('@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository');
  const { db, connection } = await import('@shared/db/client');
  const { sql } = await import('drizzle-orm');

  const id = 'smoke-allreport-merge-guard';
  const fees = new DrizzleGatewayFeeRepository();
  const charge = {
    platform: 0, platformPaymentId: id,
    grossAmount: 71500, currency: 'ARS', feeAmount: 1287, taxAmount: 3646.5, netAmount: 66566.5,
    settlementCurrency: 'ARS', settlementAmount: 71500, exchangeRate: null,
    refundedAmount: 0, gatewayStatus: 'approved', capturedAt: new Date('2024-07-04T12:00:00Z'),
    invoiceId: null, subscriptionId: 'sub-from-the-charge',
  };
  const reversalOnly = {
    ...charge,
    grossAmount: 0, feeAmount: -1287, taxAmount: -3646.5, netAmount: -66566.5, settlementAmount: 0,
    refundedAmount: 71500, gatewayStatus: 'charged_back',
    capturedAt: new Date('2026-08-20T12:00:00Z'), subscriptionId: null,
  };

  try {
    await db.execute(sql`DELETE FROM basket_payment_fees WHERE platform = 0 AND platform_payment_id = ${id}`);
    await fees.upsertMany([charge]);
    await fees.upsertMany([reversalOnly]);
    // Twice, because a mirror that is not idempotent is not a mirror.
    await fees.upsertMany([reversalOnly]);
    const got = (await db.execute<Record<string, string>>(sql`
      SELECT gross_amount, fee_amount, tax_amount, net_amount, refunded_amount,
             gateway_status, captured_at::date::text AS captured, subscription_id
      FROM basket_payment_fees WHERE platform = 0 AND platform_payment_id = ${id}
    `) as unknown as Record<string, string>[])[0];

    console.log('\n=== the merge guard ===\n');
    check('a reversal-only row keeps the charge', Number(got.gross_amount) === 71500, `gross ${got.gross_amount}`);
    check('it keeps the commission that was charged', Number(got.fee_amount) === 1287, `fee ${got.fee_amount}`);
    check('it keeps the withholding', Number(got.tax_amount) === 3646.5, `tax ${got.tax_amount}`);
    check('it keeps the net', Number(got.net_amount) === 66566.5, `net ${got.net_amount}`);
    check('it records what came back', Number(got.refunded_amount) === 71500, `refunded ${got.refunded_amount}`);
    check('it records the reversal itself', got.gateway_status === 'charged_back', `${got.gateway_status}`);
    check('it does not re-date the capture', got.captured === '2024-07-04', `${got.captured}`);
    check('it does not erase the subscription link', got.subscription_id === 'sub-from-the-charge', `${got.subscription_id}`);
    check('applying it twice changes nothing', Number(got.refunded_amount) === 71500, 'idempotent');
  } finally {
    await db.execute(sql`DELETE FROM basket_payment_fees WHERE platform = 0 AND platform_payment_id = ${id}`);
    await connection.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exitCode = 1;
});
