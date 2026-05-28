import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';

const SQL_PATH = resolve(process.cwd(), 'migrations/sql/0007_partidos.sql');

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('=== Apply 0007_partidos.sql ===');
  const content = readFileSync(SQL_PATH, 'utf8');
  await db.execute(sql.raw(content));
  console.log(`✓ applied in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  for (const t of ['partidos_nacional', 'partidos_intl', 'partidos_sync_state']) {
    const rows = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${t}`));
    const c = (rows as unknown as Array<{ c: number }>)[0].c;
    console.log(`  ${t.padEnd(25)} ${c} rows`);
  }
  await connection.end();
}

main().catch(async (err) => {
  console.error(err);
  await connection.end();
  process.exit(1);
});
