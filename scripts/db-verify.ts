// Verify the DB is ready for prod: required tables, mat views, unique
// indexes (REFRESH CONCURRENTLY needs them), and row-count sanity.
// Run after migrations + apply-views + initial-load.
import { sql } from 'drizzle-orm';
import { db, connection } from '@shared/db/client';

const MAT_VIEWS = [
  'basket_mat_daily_active',
  'basket_mat_monthly_lifecycle',
  'basket_mat_team_monthly',
  'basket_mat_revenue_daily',
  'basket_mat_fixture_ranges',
] as const;

const CORE_TABLES = [
  'basket_users',
  'basket_payments',
  'basket_teams',
  'basket_tournaments',
  'auth_user',
  'auth_session',
  'sync_state',
] as const;

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

async function tableExists(name: string): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(`SELECT to_regclass('public.${name}') IS NOT NULL AS ok`),
  )) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok === true;
}

async function rowCount(name: string): Promise<number> {
  const rows = (await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS c FROM ${name}`),
  )) as unknown as Array<{ c: number }>;
  return rows[0]?.c ?? 0;
}

async function hasUniqueIndex(view: string): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='${view}'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      ) AS ok
    `),
  )) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok === true;
}

async function pgVersion(): Promise<string> {
  const rows = (await db.execute(sql.raw(`SHOW server_version`))) as unknown as Array<{
    server_version: string;
  }>;
  return rows[0]?.server_version ?? 'unknown';
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  const ver = await pgVersion();
  const verMajor = Number(ver.split('.')[0] ?? 0);
  checks.push({
    label: `PG version ${ver}`,
    ok: verMajor >= 16,
    detail: verMajor >= 16 ? '' : 'requires >= 16',
  });

  for (const t of CORE_TABLES) {
    const exists = await tableExists(t);
    checks.push({ label: `table ${t}`, ok: exists, detail: exists ? '' : 'missing' });
  }

  for (const v of MAT_VIEWS) {
    const exists = await tableExists(v);
    if (!exists) {
      checks.push({ label: `mat view ${v}`, ok: false, detail: 'missing' });
      continue;
    }
    const idx = await hasUniqueIndex(v);
    const c = await rowCount(v);
    checks.push({
      label: `mat view ${v}`,
      ok: idx,
      detail: `rows=${c.toLocaleString()} unique_idx=${idx ? 'yes' : 'NO — REFRESH CONCURRENTLY will fail'}`,
    });
  }

  let failed = 0;
  for (const c of checks) {
    const flag = c.ok ? '✓' : '✗';
    console.log(`${flag} ${c.label.padEnd(38)} ${c.detail}`);
    if (!c.ok) failed++;
  }
  console.log('');
  await connection.end({ timeout: 5 });
  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch(async (err) => {
  console.error(err);
  await connection.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
