// Ingests one or more Pagos Exports straight from disk through the same intake
// the Sync button uses — same preview, same Sync (Pagos, amount realignment,
// mat views), same provenance row — but without the browser.
//
//   tsx --env-file=.env scripts/ingest-payment-exports.ts <file.csv> [more.csv ...]
//
// Each file is inspected first, the way the modal previews it, and its warnings
// are printed; a file the preview would refuse is skipped. Pagos whose
// Subscriber this mirror does not know are skipped, exactly as the Upload path
// skips them. Views are rebuilt per file, as a confirm does.

import { sql } from 'drizzle-orm';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { connection, db } from '@shared/db/client';
import { pagosUploadIntake } from '@basket/infrastructure/upload/PagosUploadIntake';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: tsx scripts/ingest-payment-exports.ts <export.csv> [...]');
  process.exit(1);
}

async function count(): Promise<number> {
  const rows = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM basket_payments`);
  return rows[0]?.c ?? 0;
}

const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? '-';

async function main() {
  const intake = pagosUploadIntake();
  const before = await count();
  console.log(`payments before: ${before.toLocaleString()}\n`);

  for (const file of files) {
    const filename = basename(file);
    const byteSize = statSync(file).size;

    const inspection = await intake.inspectPath(file, { uploadId: 'cli', filename, byteSize });
    if (!inspection.ok) {
      console.log(`${filename}\n  ✗ ${inspection.rejection.error}: ${inspection.rejection.message}`);
      continue;
    }
    const p = inspection.preview;
    console.log(
      `${filename}: rows=${p.rowTotal.toLocaleString()} window=${day(p.windowFrom)}→${day(p.windowTo)} ` +
        `approved=${p.approved.toLocaleString()} failed=${p.failed.toLocaleString()} wouldSkip=${p.wouldSkip.toLocaleString()}`,
    );
    for (const w of p.warnings) console.log(`  ! ${w.code}: ${w.message}`);

    const t = Date.now();
    const outcome = await intake.ingestFile({
      path: file,
      actor: 'script:ingest-payment-exports',
      filename,
      byteSize,
      rowTotal: p.rowTotal,
      windowFrom: p.windowFrom ? new Date(p.windowFrom) : null,
      windowTo: p.windowTo ? new Date(p.windowTo) : null,
    });
    if (!outcome.ok) {
      console.log(`  ✗ ingest failed: ${outcome.error}`);
      continue;
    }
    const r = outcome.result;
    console.log(
      `  ✓ ingested=${r.syncedPayments.toLocaleString()} skipped=${r.skippedPayments.toLocaleString()} ` +
        `realigned=${r.correctedAmounts.toLocaleString()} (${Math.round((Date.now() - t) / 1000)}s)`,
    );
    for (const v of r.refreshes) console.log(`    ${v.view}: ${v.durationMs}ms`);
  }

  const after = await count();
  console.log(`\npayments after: ${after.toLocaleString()} (+${(after - before).toLocaleString()})`);

  const range = await db.execute<{ min_day: string; max_day: string; gaps: number }>(sql`
    WITH d AS (
      SELECT generate_series(MIN(created_at)::date, MAX(created_at)::date, '1 day') AS dd
      FROM basket_payments
    ), c AS (
      SELECT created_at::date AS dd FROM basket_payments GROUP BY 1
    )
    SELECT MIN(d.dd)::date::text AS min_day,
           MAX(d.dd)::date::text AS max_day,
           COUNT(*) FILTER (WHERE c.dd IS NULL)::int AS gaps
    FROM d LEFT JOIN c USING (dd)
  `);
  const r = range[0];
  console.log(`\ncoverage: ${r?.min_day} → ${r?.max_day}, days with zero Pagos: ${r?.gaps}`);
}

main()
  .catch((err) => {
    console.error('ingest failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
