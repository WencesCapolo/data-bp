import { connection } from '@shared/db/client';
import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';
import { GetOverviewUseCase } from '@basket/core/use-cases/queries/GetOverviewUseCase';
import { GetEvolutionUseCase } from '@basket/core/use-cases/queries/GetEvolutionUseCase';
import { GetTeamsUseCase } from '@basket/core/use-cases/queries/GetTeamsUseCase';
import { GetEconomiaUseCase } from '@basket/core/use-cases/queries/GetEconomiaUseCase';
import { GetRetentionUseCase } from '@basket/core/use-cases/queries/GetRetentionUseCase';
import { GetDataQualityUseCase } from '@basket/core/use-cases/queries/GetDataQualityUseCase';

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  console.log(`  ${label.padEnd(20)} ${Date.now() - t}ms`);
  return r;
}

async function main() {
  console.log('=== BFF Query Smoke Test ===\n');
  const repo = new DrizzleAnalyticsQueryRepository();

  const overview = await time('overview', () => new GetOverviewUseCase(repo).execute());
  const evolution = await time('evolution 30d', () =>
    new GetEvolutionUseCase(repo).execute({ kind: '30d' }, 'day'),
  );
  const teams = await time('teams all', () =>
    new GetTeamsUseCase(repo).execute({ kind: 'all' }, { limit: 10 }),
  );
  const teamTrend = await time('team trend', () =>
    new GetTeamsUseCase(repo).trend(teams.ranked[0]?.teamId ?? 0),
  );
  const economia = await time('economia 30d', () =>
    new GetEconomiaUseCase(repo).execute({ kind: '30d' }),
  );
  const retention = await time('retention', () => new GetRetentionUseCase(repo).execute());
  const quality = await time('data quality', () => new GetDataQualityUseCase(repo).execute());

  console.log('\n--- OVERVIEW KPIs ---');
  console.log(JSON.stringify(overview.kpis, null, 2));
  console.log(`trend30d points: ${overview.trend30d.length}`);
  console.log(`accessBreakdown: ${overview.accessBreakdown.map(b => `${b.label}=${b.count}`).join(', ')}`);
  console.log(`subTypeBreakdown: ${overview.subTypeBreakdown.map(b => `${b.label}=${b.count}`).join(', ')}`);
  console.log(`countryBreakdown: ${overview.countryBreakdown.map(b => `${b.label}=${b.count}`).join(', ')}`);

  console.log('\n--- EVOLUTION ---');
  console.log(`points: ${evolution.series.length}, last=${JSON.stringify(evolution.series.at(-1))}`);

  console.log('\n--- TEAMS top 3 ---');
  console.log(JSON.stringify(teams.totals, null, 2));
  teams.ranked.slice(0, 3).forEach((t) =>
    console.log(`  ${t.teamName.padEnd(35)} payers=${t.uniquePayers} payments=${t.totalPayments} amount=${t.totalAmount}`),
  );

  console.log('\n--- TEAM TREND ---');
  console.log(`${teamTrend.teamName}: ${teamTrend.points.length} month(s)`);

  console.log('\n--- ECONOMÍA ---');
  console.log(`monthlyGross rows: ${economia.monthlyGross.length}, Pagos: ${economia.totals.txCount}`);
  const byPlat = new Map<string, number>();
  for (const r of economia.monthlyGross) byPlat.set(r.platformName, (byPlat.get(r.platformName) ?? 0) + r.txCount);
  console.log(`byPlatform (Pagos): ${Array.from(byPlat, ([p, n]) => `${p}=${n}`).join(', ')}`);

  console.log('\n--- RETENTION ---');
  console.log(`months: ${retention.rows.length}, latest churn=${retention.latestChurnRatePct}% retention=${retention.latestRetentionRatePct}%`);

  console.log('\n--- DATA QUALITY ---');
  console.log(JSON.stringify(quality.totals, null, 2));
  quality.issues.forEach((i) => console.log(`  ${i.code.padEnd(25)} ${i.count}`));
}

main()
  .catch((err) => {
    console.error('\n✗ Smoke failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
