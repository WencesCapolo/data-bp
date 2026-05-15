import { connection } from '@shared/db/client';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { RefreshMaterializedViewsUseCase } from '@basket/core/use-cases/sync/RefreshMaterializedViewsUseCase';

async function main() {
  const startedAt = Date.now();
  console.log('=== Refresh Mat Views ===\n');
  const repo = new DrizzleMaterializedViewRepository();
  const useCase = new RefreshMaterializedViewsUseCase(repo);
  const results = await useCase.execute({ concurrent: true });
  for (const r of results) {
    console.log(`  ${r.view.padEnd(35)} ${r.rowCount.toLocaleString().padStart(8)} rows  ${r.durationMs}ms`);
  }
  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error('\n✗ Refresh failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
