import { connection } from '@shared/db/client';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';

async function main() {
  console.log('=== Live sync run ===\n');
  const useCase = await composeRunSync();
  const t = Date.now();
  const result = await useCase.execute();
  const ms = Date.now() - t;
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nelapsed: ${ms}ms`);
}

main()
  .catch((err) => {
    console.error('live sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end({ timeout: 5 });
  });
