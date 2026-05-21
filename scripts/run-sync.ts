import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

async function main() {
  const { connection } = await import('@shared/db/client');
  const { composeRunSync } = await import('@basket/infrastructure/sync/composeRunSync');
  console.log('=== Live sync against', process.env.EXTERNAL_API_BASE, '===');
  try {
    const useCase = await composeRunSync();
    const t = Date.now();
    const result = await useCase.execute();
    console.log(JSON.stringify(result, null, 2));
    console.log(`done in ${Date.now() - t}ms`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('sync failed:', err);
  process.exitCode = 1;
});
