// Reads one or more MercadoPago fee Exports into the fee mirror. Which Export a
// file is comes from its header, the same way the SFTP inbox decides it.
//
//   tsx --env-file=.env scripts/ingest-gateway-exports.ts data/collection-*.xlsx
//   tsx --env-file=.env scripts/ingest-gateway-exports.ts --refresh data/*.xlsx
//
// An argument that is a *directory* is treated as an inbox instead: every file
// not already recorded in basket_payment_uploads is ingested, each file's shape
// is checked before it is written, and processed files move into `done/`. That is
// the same use case the cron runs against the SFTP landing zone, so running it
// here is how the cron's behaviour gets exercised without waiting six hours.
//
// .xlsx and .csv both work — MercadoPago's panel offers either and the adapter
// reads the machine names in the header, not the Spanish labels.
//
// Provenance is recorded per file in basket_payment_uploads, the same table the
// Upload screen writes, so a fee row can always be traced to the Export that
// produced it. Mat views are refreshed once at the end, and only when asked:
// ingesting 27 monthly files should not rebuild the views 27 times.

import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { connection } from '@shared/db/client';
import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { RefreshMaterializedViewsUseCase } from '@basket/core/use-cases/sync/RefreshMaterializedViewsUseCase';
import { IngestPaymentExportUseCase } from '@basket/core/use-cases/sync/IngestPaymentExportUseCase';
import { IngestExportInboxUseCase } from '@basket/core/use-cases/sync/IngestExportInboxUseCase';
import { FsExportInbox } from '@basket/infrastructure/exports/FsExportInbox';
import { isResolved, resolveExportSource } from '@basket/infrastructure/exports/resolveExportSource';

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const paths = args.filter((a) => !a.startsWith('--'));

if (paths.length === 0) {
  console.error('usage: tsx scripts/ingest-gateway-exports.ts [--refresh] <export.xlsx|csv|inbox-dir> [...]');
  process.exit(1);
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const dirs = paths.filter(isDir);
const files = paths.filter((p) => !isDir(p));

const ars = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => (whole === 0 ? '-' : `${((part / whole) * 100).toFixed(2)}%`);

async function main() {
  const fees = new DrizzleGatewayFeeRepository();
  const uploads = new DrizzlePaymentUploadRepository();
  const ingest = new IngestPaymentExportUseCase(fees);

  const before = await fees.count();
  console.log(`fee rows before: ${before.toLocaleString()}\n`);

  const totals = { rows: 0, gross: 0, fee: 0, tax: 0, net: 0 };

  for (const dir of dirs) {
    // `--refresh` means two things on one flag and they do not collide: for a
    // directory it re-reads files already recorded, for the mat views it rebuilds
    // them at the end.
    const inbox = new IngestExportInboxUseCase({
      inbox: new FsExportInbox(dir),
      ingest,
      uploads,
      resolve: async (file) => {
        const r = await resolveExportSource(file.path, file.name);
        return isResolved(r) ? { spec: r.spec, source: r.source } : { error: r.error, message: r.message };
      },
      uploadedBy: 'script:ingest-gateway-exports',
      retentionDays: Number(process.env.MP_SFTP_DONE_RETENTION_DAYS ?? '30'),
    });

    const result = await inbox.execute({ refresh });
    console.log(`${dir}${result.error ? ` — ${result.error}` : ''}`);
    for (const f of result.files) {
      if (f.outcome === 'ingested') {
        totals.rows += f.rows;
        totals.gross += f.grossTotal;
        totals.fee += f.feeTotal;
        totals.tax += f.taxTotal;
        totals.net += f.netTotal;
        console.log(
          `  ✓ ${f.filename} rows=${f.rows.toLocaleString()} upserted=${f.upserted.toLocaleString()} ` +
            `window=${f.windowFrom?.toISOString().slice(0, 10) ?? '-'}→${f.windowTo?.toISOString().slice(0, 10) ?? '-'} ` +
            `gross=${ars(f.grossTotal)} fee=${ars(f.feeTotal)} (${pct(f.feeTotal, f.grossTotal)}) tax=${ars(f.taxTotal)} net=${ars(f.netTotal)}`,
        );
      } else if (f.outcome === 'skipped') {
        console.log(`  · ${f.filename} ${f.error ?? 'already ingested'}`);
      } else {
        console.log(`  ✗ ${f.filename} ${f.outcome}: ${f.error}`);
      }
    }
    if (result.pruned > 0) console.log(`  pruned ${result.pruned} file(s) from done/`);
  }

  for (const file of files) {
    // Same rule as the inbox: the header decides the Export, never the filename.
    // A named file used to be read as a Cobros Export unconditionally, which
    // silently mis-parsed every all-transactions report handed to this script.
    const resolution = await resolveExportSource(file, basename(file));
    if (!isResolved(resolution)) {
      console.log(`${basename(file)}\n  ✗ ${resolution.error}: ${resolution.message}`);
      continue;
    }
    console.log(`${basename(file)}  (${resolution.spec.id})`);
    const result = await ingest.execute(resolution.source);

    totals.rows += result.rows;
    totals.gross += result.grossTotal;
    totals.fee += result.feeTotal;
    totals.tax += result.taxTotal;
    totals.net += result.netTotal;

    console.log(
      `  rows=${result.rows.toLocaleString()} upserted=${result.upserted.toLocaleString()} ` +
        `window=${result.from?.toISOString().slice(0, 10) ?? '-'}→${result.to?.toISOString().slice(0, 10) ?? '-'} ` +
        `(${Math.round(result.durationMs / 1000)}s)\n` +
        `  gross=${ars(result.grossTotal)} fee=${ars(result.feeTotal)} (${pct(result.feeTotal, result.grossTotal)}) ` +
        `tax=${ars(result.taxTotal)} (${pct(result.taxTotal, result.grossTotal)}, ${result.withTax.toLocaleString()} rows) ` +
        `net=${ars(result.netTotal)}`,
    );

    // The invariant migration 0015 promises. Checked per file rather than in
    // aggregate: a single Export whose columns moved would otherwise hide
    // inside 27 months of correct ones.
    const closes = Math.abs(
      result.grossTotal - result.refundedTotal - result.feeTotal - result.taxTotal - result.netTotal,
    );
    console.log(
      closes < 1
        ? '  ✓ gross - refunds - fee - tax = net'
        : `  ✗ gross - refunds - fee - tax - net = ${ars(closes)} — the Export's columns moved`,
    );

    await uploads.record({
      uploadedBy: 'script:ingest-gateway-exports',
      filename: basename(file),
      byteSize: statSync(file).size,
      rowTotal: result.rows,
      rowsIngested: result.upserted,
      rowsSkipped: result.skipped,
      windowFrom: result.from,
      windowTo: result.to,
      error: null,
    });
  }

  const after = await fees.count();
  console.log(
    `\nfee rows after: ${after.toLocaleString()} (+${(after - before).toLocaleString()})\n` +
      `all files: gross=${ars(totals.gross)} fee=${ars(totals.fee)} (${pct(totals.fee, totals.gross)}) ` +
      `tax=${ars(totals.tax)} (${pct(totals.tax, totals.gross)}) net=${ars(totals.net)} ARS`,
  );

  if (refresh) {
    console.log('\nrefreshing mat views...');
    for (const r of await new RefreshMaterializedViewsUseCase(
      new DrizzleMaterializedViewRepository(),
    ).execute({ concurrent: true })) {
      console.log(`  ${r.view}: ${r.durationMs}ms`);
    }
  } else {
    console.log('\nmat views NOT refreshed — re-run with --refresh after the last file.');
  }
}

main()
  .catch((err) => {
    console.error('ingest failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
