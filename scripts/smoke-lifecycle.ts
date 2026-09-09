// Verifies the subscriber lifecycle /financiero draws — altas, bajas, actives,
// last-charge age and lifetime — against the invariants that make it one story.
//
//   pnpm smoke:lifecycle
//
// Checks, in order:
//   1. the daily pool closes: active(d) − active(d−1) = altas + reactivados − bajas
//      on every one of the 15 days, and the series ends at the last Pago day
//   2. the monthly buckets sum to the Pagos of the month, straight off the view
//   3. month-end actives agree with basket_mat_daily_active where both exist
//   4. the last-charge bars sum to the live subscription count per Provider
//   5. lifetime: open + closed = distinct Subscribers, and open = active at the anchor
//   6. the filtered path returns the same shape over a smaller population
//   7. the live path (what a filter runs) and the mat-view path (what no filter
//      reads) agree figure for figure on an empty filter
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';
import { LIVE_STATUSES } from '@basket/core/entities/GatewaySubscription';
import type { DateRange } from '@basket/core/dtos/shared';

const ALL: DateRange = { kind: 'all' };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(50)} ${detail}`);
}

type Row = Record<string, unknown>;
const rows = async (q: string): Promise<Row[]> =>
  ((await db.execute(sql.raw(q))) as unknown) as Row[];
const num = (v: unknown): number => Number(v ?? 0);
const fmt = (v: number): string => v.toLocaleString('en-US');

async function main(): Promise<void> {
  const repo = new DrizzleAnalyticsQueryRepository();
  const t0 = Date.now();
  const econ = await repo.getEconomia(ALL);
  const lc = econ.lifecycle;
  console.log(`getEconomia(all) in ${((Date.now() - t0) / 1000).toFixed(1)}s · asOf ${lc.asOf}\n`);

  console.log('=== 1. the daily pool closes ===\n');
  const [anchor] = await rows(`
    SELECT LEAST(MAX(created_at)::date, CURRENT_DATE - 1)::text AS as_of FROM basket_v_active_payments
  `);
  check('asOf is the last Pago day', lc.asOf === String(anchor.as_of), `${lc.asOf} vs ${anchor.as_of}`);
  check('15 days', lc.daily.length === 16, `${lc.daily.length} rows (16 = anchor and the 15 before it)`);
  check('series ends at asOf', lc.daily.at(-1)?.day === lc.asOf, `${lc.daily.at(-1)?.day}`);
  let broken = 0;
  for (let i = 1; i < lc.daily.length; i += 1) {
    const cur = lc.daily[i];
    const prev = lc.daily[i - 1];
    if (cur.active - prev.active !== cur.net) broken += 1;
    if (cur.net !== cur.newSubscribers + cur.reactivated - cur.churned) broken += 1;
  }
  check('Δactive = altas + reactivados − bajas, every day', broken === 0, `${broken} days off`);
  const last = lc.daily.at(-1)!;
  const [poolNow] = await rows(`
    SELECT COUNT(DISTINCT user_id)::int AS c FROM basket_v_active_payments
    WHERE created_at::date <= '${lc.asOf}'::date AND (expires_at + INTERVAL '7 days')::date >= '${lc.asOf}'::date
  `);
  check('active at asOf = pool off the view', last.active === num(poolNow.c), `${fmt(last.active)} vs ${fmt(num(poolNow.c))}`);

  console.log('\n=== 2. monthly buckets sum to the Pagos ===\n');
  const viewMonths = await rows(`
    SELECT DATE_TRUNC('month', created_at)::date::text AS m, COUNT(*)::int AS c
    FROM basket_v_active_payments WHERE created_at < '${lc.asOf}'::date + 1
    GROUP BY 1 ORDER BY 1
  `);
  let offMonths = 0;
  for (const vm of viewMonths) {
    const mine = lc.monthly.find((r) => r.month === String(vm.m));
    const sum = mine ? mine.newSubscribers + mine.recurring + mine.reactivated + mine.oneOff : -1;
    if (sum !== num(vm.c)) offMonths += 1;
  }
  check('new + recurring + reactivated + oneOff = Pagos', offMonths === 0, `${offMonths} of ${viewMonths.length} months off`);
  const churnTotal = lc.monthly.reduce((a, r) => a + r.churned, 0);
  check('bajas exist in every complete month', lc.monthly.slice(1, -1).every((r) => r.churned > 0), `${fmt(churnTotal)} lapses in all`);

  console.log('\n=== 3. month-end actives vs basket_mat_daily_active ===\n');
  const mat = await rows(`
    SELECT DATE_TRUNC('month', day)::date::text AS m, all_active::int AS c FROM basket_mat_daily_active
    WHERE day = (DATE_TRUNC('month', day) + INTERVAL '1 month' - INTERVAL '1 day')::date
  `);
  let offActive = 0;
  let compared = 0;
  for (const r of lc.activeByMonth.filter((x) => !x.partial)) {
    const m = mat.find((x) => String(x.m) === r.month);
    if (!m) continue;
    compared += 1;
    if (num(m.c) !== r.total) offActive += 1;
  }
  check('complete months agree with the mat view', offActive === 0 && compared > 0, `${offActive} of ${compared} off`);
  const partial = lc.activeByMonth.filter((r) => r.partial);
  check('exactly one partial month, the anchor month', partial.length === 1 && partial[0].month === `${lc.asOf.slice(0, 7)}-01`, partial.map((p) => p.month).join(','));
  check('partial month active = pool at asOf', partial[0]?.total === last.active, `${fmt(partial[0]?.total ?? 0)} vs ${fmt(last.active)}`);
  check(
    'mensual + anual + otros ≥ total (a Subscriber may hold two)',
    lc.activeByMonth.every((r) => r.mensual + r.anual + r.otros >= r.total),
    `${fmt(partial[0]?.mensual ?? 0)} mensual · ${fmt(partial[0]?.anual ?? 0)} anual · ${fmt(partial[0]?.otros ?? 0)} otros at asOf`,
  );

  console.log('\n=== 4. last-charge bars sum to the live subscriptions ===\n');
  const live = await rows(`
    SELECT platform, COUNT(*)::int AS c FROM basket_gateway_subscriptions
    WHERE platform IN (0, 4) AND status IN (${LIVE_STATUSES.map((x) => `'${x}'`).join(',')})
    GROUP BY 1
  `);
  for (const l of live) {
    const mine = lc.lastCharge.filter((r) => r.platform === num(l.platform));
    const sum = mine.reduce((a, r) => a + r.count, 0);
    const unknown = mine.find((r) => r.bucket === 'unknown')?.count ?? 0;
    check(`platform ${l.platform}: buckets sum to live`, sum === num(l.c), `${fmt(sum)} vs ${fmt(num(l.c))} · ${fmt(unknown)} with no Pago (${((unknown / sum) * 100).toFixed(1)}%)`);
  }
  const zombies = lc.lastCharge.filter((r) => r.bucket === '180+').reduce((a, r) => a + r.count, 0);
  check('the 180+ band is populated (the chart has something to say)', zombies > 0, `${fmt(zombies)} live subscriptions last charged 180+ days ago`);

  console.log('\n=== 5. lifetime ===\n');
  const [payers] = await rows(`SELECT COUNT(DISTINCT user_id)::int AS c FROM basket_v_active_payments`);
  check('open + closed = distinct Subscribers', lc.lifetime.open + lc.lifetime.closed === num(payers.c), `${fmt(lc.lifetime.open)} + ${fmt(lc.lifetime.closed)} vs ${fmt(num(payers.c))}`);
  check('open = active at asOf', lc.lifetime.open === last.active, `${fmt(lc.lifetime.open)} vs ${fmt(last.active)}`);
  check('percentiles ordered', (lc.lifetime.p25Months ?? 0) <= (lc.lifetime.medianMonths ?? 0) && (lc.lifetime.medianMonths ?? 0) <= (lc.lifetime.p75Months ?? 0) && (lc.lifetime.p75Months ?? 0) <= (lc.lifetime.maxMonths ?? 0), `p25 ${lc.lifetime.p25Months} · median ${lc.lifetime.medianMonths} · mean ${lc.lifetime.meanMonths} · p75 ${lc.lifetime.p75Months} · max ${lc.lifetime.maxMonths}`);

  console.log('\n=== 6. filtered path ===\n');
  const t1 = Date.now();
  const uy = (await repo.getEconomia({ kind: '90d' }, { countries: ['Uruguay'] })).lifecycle;
  console.log(`  getEconomia(90d, Uruguay) in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  check('same anchor', uy.asOf === lc.asOf, uy.asOf);
  let brokenUy = 0;
  for (let i = 1; i < uy.daily.length; i += 1) {
    if (uy.daily[i].active - uy.daily[i - 1].active !== uy.daily[i].net) brokenUy += 1;
  }
  check('daily pool closes under a country filter', brokenUy === 0, `${brokenUy} days off`);
  check('a filter shrinks the pool', (uy.daily.at(-1)?.active ?? 0) < last.active && (uy.daily.at(-1)?.active ?? 0) > 0, `${fmt(uy.daily.at(-1)?.active ?? 0)} Uruguay vs ${fmt(last.active)} all`);
  check('90d keeps only the months it touches', uy.activeByMonth.length >= 3 && uy.activeByMonth.length <= 5, `${uy.activeByMonth.length} months`);
  check('last-charge ignores the filter (no Subscriber dimension)', JSON.stringify(uy.lastCharge) === JSON.stringify(lc.lastCharge), '');
  check('lifetime honours the filter', uy.lifetime.closed < lc.lifetime.closed, `${fmt(uy.lifetime.closed)} closed vs ${fmt(lc.lifetime.closed)}`);

  console.log('\n=== 7. live path = mat-view path on an empty filter ===\n');
  const priv = repo as unknown as {
    lifecycleLive(a: string, f: string, t: string, fw: string): Promise<unknown[]>;
    lifecycleFromMatViews(a: string, f: string, t: string): Promise<unknown[]>;
  };
  const a = `'${lc.asOf}'::date`;
  const mf = `DATE_TRUNC('month', ${a} - INTERVAL '3 months')::date`;
  const mt = `DATE_TRUNC('month', ${a})::date`;
  const t2 = Date.now();
  const viaLive = await priv.lifecycleLive(a, mf, mt, '');
  const liveMs = Date.now() - t2;
  const t3 = Date.now();
  const viaMat = await priv.lifecycleFromMatViews(a, mf, mt);
  console.log(`  live ${(liveMs / 1000).toFixed(1)}s · mat views ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  const norm = (v: unknown) => JSON.parse(JSON.stringify(v));
  const names = ['daily', 'monthly', 'activeByMonth', 'lifetime'];
  names.forEach((name, i) => {
    const same = JSON.stringify(norm(viaLive[i])) === JSON.stringify(norm(viaMat[i]));
    check(`${name}: live = mat view`, same, same ? '' : `live ${JSON.stringify(norm(viaLive[i])).slice(0, 160)} … mat ${JSON.stringify(norm(viaMat[i])).slice(0, 160)}`);
  });

  console.log(`\n${failures === 0 ? 'all green' : `${failures} check(s) failed`}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => connection.end());
