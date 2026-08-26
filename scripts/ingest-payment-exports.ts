// Ingests one or more Pagos Exports straight from disk, the same way a confirmed
// Upload does — same mapper, same upsert, same provenance row — but without the
// browser, and without re-running the endpoint stages once per file.
//
//   tsx --env-file=.env scripts/ingest-payment-exports.ts <file.csv> [more.csv ...]
//
// Mat views are refreshed once, after the last file. Pagos whose Subscriber this
// mirror does not know are skipped, exactly as the Upload path skips them.

import { sql } from 'drizzle-orm';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { connection, db } from '@shared/db/client';
import { streamCsvFile } from '@shared/lib/csvStream';
import { DrizzleUserRepository } from '@basket/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { LoadPaymentsFromCsvUseCase } from '@basket/core/use-cases/sync/LoadPaymentsFromCsvUseCase';
import { RefreshMaterializedViewsUseCase } from '@basket/core/use-cases/sync/RefreshMaterializedViewsUseCase';
import { mapPaymentUploadRow } from '@basket/infrastructure/sync/csvMappers';
import type { PaymentUploadRow } from '@basket/core/dtos/PaymentUploadDTO';
import type { PaymentProps } from '@basket/core/entities/Payment';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: tsx scripts/ingest-payment-exports.ts <export.csv> [...]');
  process.exit(1);
}

async function count(): Promise<number> {
  const rows = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM basket_payments`);
  return rows[0]?.c ?? 0;
}

async function main() {
  const users = new DrizzleUserRepository();
  const payments = new DrizzlePaymentRepository();
  const uploads = new DrizzlePaymentUploadRepository();

  const knownUserIds = await users.getKnownIds();
  console.log(`known Subscribers: ${knownUserIds.size.toLocaleString()}`);
  const before = await count();
  console.log(`payments before: ${before.toLocaleString()}\n`);

  for (const file of files) {
    const tally = { total: 0, skipped: 0, minMs: Infinity, maxMs: -Infinity };

    async function* mapped(): AsyncGenerator<PaymentProps> {
      for await (const row of streamCsvFile<PaymentUploadRow>(file, { delimiter: ',', bom: true })) {
        tally.total += 1;
        const props = mapPaymentUploadRow(row, knownUserIds);
        if (!props) {
          tally.skipped += 1;
          continue;
        }
        const ms = props.createdAt.getTime();
        if (ms < tally.minMs) tally.minMs = ms;
        if (ms > tally.maxMs) tally.maxMs = ms;
        yield props;
      }
    }

    const t = Date.now();
    const result = await new LoadPaymentsFromCsvUseCase(payments).execute({ rows: mapped() });
    const windowFrom = Number.isFinite(tally.minMs) ? new Date(tally.minMs) : null;
    const windowTo = tally.maxMs > 0 ? new Date(tally.maxMs) : null;

    console.log(
      `${basename(file)}: rows=${tally.total.toLocaleString()} ingested=${result.inserted.toLocaleString()} ` +
        `skipped=${tally.skipped.toLocaleString()} ` +
        `window=${windowFrom?.toISOString().slice(0, 10) ?? '-'}→${windowTo?.toISOString().slice(0, 10) ?? '-'} ` +
        `(${Math.round((Date.now() - t) / 1000)}s)`,
    );

    await uploads.record({
      uploadedBy: 'script:ingest-payment-exports',
      filename: basename(file),
      byteSize: statSync(file).size,
      rowTotal: tally.total,
      rowsIngested: result.inserted,
      rowsSkipped: tally.skipped,
      windowFrom,
      windowTo,
      error: null,
    });
  }

  const after = await count();
  console.log(`\npayments after: ${after.toLocaleString()} (+${(after - before).toLocaleString()})`);

  console.log('\nrefreshing mat views...');
  const refreshes = await new RefreshMaterializedViewsUseCase(
    new DrizzleMaterializedViewRepository(),
  ).execute({ concurrent: true });
  for (const r of refreshes) console.log(`  ${r.view}: ${r.durationMs}ms`);

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
