import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';

const SQL_PATH = resolve(process.cwd(), 'migrations/sql/0001_views.sql');

const MAT_VIEWS = [
  'basket_mat_daily_active',
  'basket_mat_monthly_lifecycle',
  'basket_mat_team_monthly',
  'basket_mat_team_daily',
  'basket_mat_revenue_daily',
] as const;

async function applyAndVerify(): Promise<void> {
  const startedAt = Date.now();
  console.log('=== Apply Mat Views ===\n');

  const content = readFileSync(SQL_PATH, 'utf8');
  console.log('→ Executing 0001_views.sql');
  await db.execute(sql.raw(content));
  console.log(`  ✓ applied in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  console.log('→ Row counts per mat view');
  for (const view of MAT_VIEWS) {
    const rows = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${view}`));
    const c = (rows as unknown as Array<{ c: number }>)[0].c;
    console.log(`  ${view.padEnd(35)} ${c.toLocaleString()} rows`);
  }

  console.log('\n→ Spot-check: today in mat_daily_active');
  const today = await db.execute(sql.raw(`
    SELECT day, all_active, real_active, voucher_active, free_active,
           mensual_basico_active, mensual_total_active, anual_total_active,
           uy_active, ar_active, cl_active, other_active
    FROM basket_mat_daily_active
    WHERE day = CURRENT_DATE
  `));
  console.log(JSON.stringify((today as unknown as unknown[])[0], null, 2));

  console.log('\n→ Spot-check: latest month in mat_monthly_lifecycle');
  const latestMonth = await db.execute(sql.raw(`
    SELECT * FROM basket_mat_monthly_lifecycle
    ORDER BY month DESC LIMIT 3
  `));
  console.log(JSON.stringify(latestMonth, null, 2));

  console.log('\n→ Spot-check: top 5 teams by total_payments (all-time)');
  const topTeams = await db.execute(sql.raw(`
    SELECT team_name, league, team_country,
           SUM(unique_payers)::int AS payers,
           SUM(total_payments)::int AS payments,
           SUM(total_amount)::numeric AS amount
    FROM basket_mat_team_monthly
    WHERE team_id <> 0
    GROUP BY team_name, league, team_country
    ORDER BY payments DESC LIMIT 5
  `));
  console.log(JSON.stringify(topTeams, null, 2));

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

applyAndVerify()
  .catch((err) => {
    console.error('\n✗ Apply views failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
