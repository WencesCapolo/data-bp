// What is in this Export, before anything is written.
//
//   pnpm inspect:export data/mp-allreport/ALLReport-*.csv
//
// Exists because the order in which MercadoPago's yearly reports are ingested
// matters and their filenames do not say: MP names them by generation time, so
// the only way to know which window a file covers is to read it. Print this for
// every file, then ingest oldest window first — see
// docs/handoff/mp-allreport-history-and-finish.md.
//
// Writes nothing, touches no database, and reports the same identity the ingest
// asserts, so a file that will be refused is known here rather than there.

import { basename } from 'node:path';
import { isResolved, resolveExportSource } from '@basket/infrastructure/exports/resolveExportSource';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: tsx scripts/inspect-export.ts <export.csv|xlsx> [...]');
  process.exit(1);
}

const ars = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => (whole === 0 ? '-' : `${((part / whole) * 100).toFixed(2)}%`);
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? '-';

async function main() {
  for (const file of files) {
    const resolution = await resolveExportSource(file, basename(file));
    if (!isResolved(resolution)) {
      console.log(`\n${basename(file)}\n  ✗ ${resolution.error}: ${resolution.message}`);
      continue;
    }

    const t = {
      ops: 0, gross: 0, fee: 0, tax: 0, net: 0, refunded: 0,
      withSub: 0, noCharge: 0, minMs: Infinity, maxMs: -Infinity,
    };
    const status = new Map<string, number>();
    const started = Date.now();
    for await (const row of resolution.source.stream()) {
      t.ops += 1;
      t.gross += row.grossAmount;
      t.fee += row.feeAmount;
      t.tax += row.taxAmount ?? 0;
      t.net += row.netAmount;
      t.refunded += row.refundedAmount;
      if (row.subscriptionId) t.withSub += 1;
      if (row.grossAmount === 0) t.noCharge += 1;
      status.set(row.status ?? '-', (status.get(row.status ?? '-') ?? 0) + 1);
      if (row.capturedAt) {
        const ms = row.capturedAt.getTime();
        if (ms < t.minMs) t.minMs = ms;
        if (ms > t.maxMs) t.maxMs = ms;
      }
    }

    // The identity the ingest checks. Reported here so a file that would be
    // refused is known before it is dropped into an inbox.
    const closes = t.gross - t.refunded - t.fee - t.tax - t.net;

    console.log(
      `\n${basename(file)}  (${resolution.spec.id})\n` +
        `  window     ${day(Number.isFinite(t.minMs) ? new Date(t.minMs) : null)} → ${day(t.maxMs > 0 ? new Date(t.maxMs) : null)}   ` +
        `${t.ops.toLocaleString()} operations, read in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
        `  gross      ${ars(t.gross)}\n` +
        `  fee        ${ars(t.fee)} (${pct(t.fee, t.gross)})\n` +
        `  tax        ${ars(t.tax)} (${pct(t.tax, t.gross)})\n` +
        `  net        ${ars(t.net)}\n` +
        `  refunded   ${ars(t.refunded)} (${pct(t.refunded, t.gross)})\n` +
        `  status     ${[...status].map(([k, v]) => `${k}=${v.toLocaleString()}`).join(' · ')}\n` +
        `  no charge  ${t.noCharge.toLocaleString()} operations describe a reversal whose charge fell outside this window\n` +
        `  with sub   ${t.withSub.toLocaleString()} carry a preapproval_id\n` +
        `  ${Math.abs(closes) < 1 ? '✓' : '✗'} gross − refunds − fee − tax − net = ${ars(closes)}`,
    );
  }
}

main().catch((err) => {
  console.error('inspect failed:', err);
  process.exitCode = 1;
});
